import { arr, bool, guardaEscrita, lerCorpoArquivo, limitarLista, LIMITE_COMENTARIO, LIMITE_CORPO, num, obj, str, truncarTexto, validarNumero, validarRamo, validarRepo, validarTexto } from "./comum";
import { ForgeEntradaInvalidaErro, ForgeMetodoMergeErro, ForgeNaoEncontradoErro } from "./erros";
import type { CapacidadesForge, CheckForge, ComentarioForge, DecisaoRevisao, EntradaCriarIssue, EntradaCriarPr, EstadoPr, ExecucaoCi, FiltroExecucao, FiltroIssue, FiltroPr, Forge, IssueDetalhe, IssueResumo, MetodoMerge, OpcoesEscrita, PrDetalhe, PrResumo, ReviewForge, SituacaoCheck } from "./forge";
import { criarClienteRest, enc, estadoRest, limiteRest, naoSuportado, sigDe, type ConfigRest } from "./rest";

// Adaptador Bitbucket Cloud (API REST 2.0). Credencial injetada; nunca em log/erro. Sem checkout/atualizar branch/re-executar.

const BASE = "https://api.bitbucket.org/2.0";
const CAPACIDADES: CapacidadesForge = {
  prs: { listar: true, ver: true, criar: true, checkout: false, atualizarBranch: false, mesclar: true, fechar: true, prontoParaRevisao: true, revisar: true, comentar: true, comentarEmLinha: true, revisores: true, labels: false, rascunho: true, etag: false },
  checks: { doPr: true, execucoes: true, log: true, reexecutarFalhos: false },
  issues: { listar: true, ver: true, criar: true, comentar: true },
  metodosMerge: ["merge", "squash", "rebase"],
  limiteApi: false,
};
const ESTRATEGIA: Record<MetodoMerge, string> = { merge: "merge_commit", squash: "squash", rebase: "fast_forward" };
const UUID = /^\{?[0-9a-fA-F-]{8,40}\}?$/;

const estadoPr = (s: string): EstadoPr => (s === "MERGED" ? "mesclado" : s === "OPEN" ? "aberto" : "fechado");
const quem = (x: unknown): string => str(obj(x).nickname) || str(obj(x).display_name) || "desconhecido";
const situacao = (estado: string): SituacaoCheck => {
  const s = estado.toUpperCase();
  return s === "SUCCESSFUL" || s === "PASSED" ? "sucesso" : s === "FAILED" || s === "ERROR" ? "falha" : s === "INPROGRESS" || s === "IN_PROGRESS" || s === "PENDING" ? "pendente" : s === "STOPPED" || s === "CANCELLED" ? "cancelado" : s === "SKIPPED" ? "ignorado" : "desconhecido";
};
function revisao(x: unknown): DecisaoRevisao {
  const p = arr(x).map(obj);
  if (p.some((o) => str(o.state) === "changes_requested")) return "mudancas";
  if (p.some((o) => str(o.state) === "approved" || o.approved === true)) return "aprovado";
  return p.some((o) => str(o.role) === "REVIEWER") ? "pendente" : "nenhuma";
}
export function resumoPrBb(x: unknown): PrResumo {
  const o = obj(x);
  return { numero: num(o.id), titulo: str(o.title), estado: estadoPr(str(o.state)), rascunho: bool(o.draft), autor: quem(o.author), ramoOrigem: str(obj(obj(o.source).branch).name), ramoDestino: str(obj(obj(o.destination).branch).name), url: str(obj(obj(o.links).html).href), criadoEm: str(o.created_on), atualizadoEm: str(o.updated_on), labels: [], revisao: revisao(o.participants), checks: null };
}
const issueEstado = (s: string): "aberta" | "fechada" => (/^(new|open|on hold)$/i.test(s) ? "aberta" : "fechada");
const resumoIssue = (x: unknown): IssueResumo => {
  const o = obj(x);
  return { numero: num(o.id), titulo: str(o.title), estado: issueEstado(str(o.state)), autor: quem(o.reporter), labels: str(o.kind) ? [str(o.kind)] : [], url: str(obj(obj(o.links).html).href), criadoEm: str(o.created_on), atualizadoEm: str(o.updated_on) };
};
function comentarios(valores: unknown): { itens: ComentarioForge[]; truncado: boolean } {
  let truncado = false;
  const todos = arr(valores).map((c): ComentarioForge => {
    const o = obj(c);
    const t = truncarTexto(str(obj(o.content).raw), LIMITE_COMENTARIO);
    if (t.truncado) truncado = true;
    const r: ComentarioForge = { autor: quem(o.user), corpo: t.texto, criadoEm: str(o.created_on) };
    const ins = obj(o.inline);
    if (str(ins.path)) r.caminho = str(ins.path);
    if (ins.to !== undefined && ins.to !== null) r.linha = num(ins.to);
    return r;
  });
  const l = limitarLista(todos);
  return { itens: l.itens, truncado: truncado || l.truncado };
}
const parteId = (v: string, campo: string): string => {
  if (!UUID.test(v)) throw new ForgeEntradaInvalidaErro(campo, "UUID inválido");
  return v;
};

export function criarForgeBitbucket(cfg: ConfigRest): Forge {
  const repo = validarRepo(cfg.repo);
  const [ws, slug] = repo.caminho.split("/") as [string, string];
  const cli = criarClienteRest("bitbucket", cfg, BASE);
  const raiz = `repositories/${enc(ws)}/${enc(slug)}`;
  const pr = (n: number): string => `${raiz}/pullrequests/${validarNumero(n, "PR")}`;
  const get = async (caminho: string, acao: string, query: Record<string, string | number> = {}, op?: { signal?: AbortSignal }): Promise<unknown> => (await cli.requisitar("GET", caminho, { acao, query, ...sigDe(op) })).json;
  const escrever = (metodo: "POST" | "PUT", caminho: string, corpo: unknown, acao: string, e: OpcoesEscrita): Promise<unknown> => cli.requisitar(metodo, caminho, { acao, corpo, ...sigDe(e) }).then((r) => r.json);

  const forge: Forge = {
    provedor: "bitbucket",
    repo,
    detectar: () => estadoRest("bitbucket", repo, cli),
    capacidades: () => CAPACIDADES,
    limiteApi: () => Promise.resolve(null),
    prs: {
      async listar(f: FiltroPr = {}, op = {}) {
        const estados = f.estado === "fechado" ? ["DECLINED"] : f.estado === "mesclado" ? ["MERGED"] : f.estado === "todos" ? ["OPEN", "MERGED", "DECLINED"] : ["OPEN"];
        const o = (await cli.requisitar("GET", `${raiz}/pullrequests?${estados.map((s) => `state=${s}`).join("&")}`, { acao: "listar os PRs", query: { pagelen: limiteRest(f.limite) }, ...sigDe(op) })).json;
        let itens = arr(obj(o).values).map(resumoPrBb);
        if (f.autor !== undefined) itens = itens.filter((p) => p.autor === f.autor);
        if (f.base !== undefined) itens = itens.filter((p) => p.ramoDestino === f.base);
        if (f.head !== undefined) itens = itens.filter((p) => p.ramoOrigem === f.head);
        if (f.busca !== undefined) itens = itens.filter((p) => p.titulo.toLowerCase().includes(f.busca!.toLowerCase()));
        if (f.rascunho === true) itens = itens.filter((p) => p.rascunho);
        const l = limitarLista(itens);
        return { itens: l.itens, truncado: l.truncado };
      },
      async ver(n, op = {}): Promise<PrDetalhe> {
        const caminho = pr(n);
        const [p, stat, coms, sts] = await Promise.all([get(caminho, `ler o PR #${n}`, {}, op), get(`${caminho}/diffstat`, "ler os arquivos", { pagelen: 100 }, op), get(`${caminho}/comments`, "ler os comentários", { pagelen: 100 }, op), get(`${caminho}/statuses`, "ler os checks", { pagelen: 100 }, op)]);
        const o = obj(p);
        if (o.id === undefined) throw new ForgeNaoEncontradoErro(`PR #${n}`);
        const corpo = truncarTexto(str(o.description), LIMITE_CORPO);
        const arqs = limitarLista(arr(obj(stat).values).map((v) => ({ caminho: str(obj(obj(v).new).path) || str(obj(obj(v).old).path), adicoes: num(obj(v).lines_added), remocoes: num(obj(v).lines_removed) })));
        const com = comentarios(obj(coms).values);
        const checks = limitarLista(arr(obj(sts).values).map((c): CheckForge => ({ nome: str(obj(c).name) || str(obj(c).key, "check"), situacao: situacao(str(obj(c).state)), url: str(obj(c).url), iniciadoEm: str(obj(c).created_on) })));
        const reviews: ReviewForge[] = arr(o.participants)
          .map(obj)
          .filter((x) => str(x.role) === "REVIEWER" || str(x.state) !== "")
          .map((x) => ({ autor: quem(x.user), estado: str(x.state) === "changes_requested" ? ("mudancas" as const) : str(x.state) === "approved" || x.approved === true ? ("aprovado" as const) : ("pendente" as const), corpo: "", criadoEm: str(x.participated_on) }));
        const resumo = resumoPrBb(o);
        const total = checks.itens.length;
        resumo.checks = { total, sucesso: checks.itens.filter((c) => c.situacao === "sucesso").length, falha: checks.itens.filter((c) => c.situacao === "falha").length, pendente: checks.itens.filter((c) => c.situacao === "pendente").length };
        return { ...resumo, corpo: corpo.texto, arquivos: arqs.itens, comentarios: com.itens, reviews, checksDetalhe: checks.itens, mesclavel: "desconhecido", truncado: corpo.truncado || com.truncado || arqs.truncado };
      },
      async consultar(n, _etag, op = {}) {
        return { naoModificado: false, pr: resumoPrBb(await get(pr(n), `consultar o PR #${n}`, {}, op)), limite: null };
      },
      async criar(entrada: EntradaCriarPr, e) {
        await guardaEscrita(e, "criar um PR");
        if ((entrada.labels ?? []).length > 0) naoSuportado("bitbucket", "Labels em PR");
        if (entrada.head === undefined) throw new ForgeEntradaInvalidaErro("head", "obrigatório no Bitbucket");
        const corpo: Record<string, unknown> = { title: validarTexto(entrada.titulo, "título", 256), description: validarTexto((await lerCorpoArquivo(entrada.corpoArquivo)) ?? entrada.corpo ?? "", "corpo", 256 * 1024, false), source: { branch: { name: validarRamo(entrada.head, "head") } } };
        if (entrada.base !== undefined) corpo.destination = { branch: { name: validarRamo(entrada.base, "base") } };
        if (entrada.rascunho === true) corpo.draft = true;
        if ((entrada.revisores ?? []).length > 0) corpo.reviewers = entrada.revisores!.map((r) => ({ uuid: parteId(r, "revisor") }));
        return resumoPrBb(await escrever("POST", `${raiz}/pullrequests`, corpo, "criar o PR", e));
      },
      checkout: () => naoSuportado("bitbucket", "Checkout de PR"),
      atualizarBranch: () => naoSuportado("bitbucket", "Atualizar a branch do PR"),
      async mesclar(n, entrada, e) {
        await guardaEscrita(e, "mesclar o PR", true);
        const corpo: Record<string, unknown> = {};
        if (entrada.metodo !== undefined) {
          if (!(entrada.metodo in ESTRATEGIA)) throw new ForgeMetodoMergeErro(String(entrada.metodo), Object.keys(ESTRATEGIA));
          corpo.merge_strategy = ESTRATEGIA[entrada.metodo];
        }
        if (entrada.apagarBranch === true) corpo.close_source_branch = true;
        await escrever("POST", `${pr(n)}/merge`, corpo, `mesclar o PR #${n}`, e);
        return { metodo: entrada.metodo ?? "merge" };
      },
      async fechar(n, e) {
        await guardaEscrita(e, "fechar o PR");
        if (e.comentario !== undefined) await escrever("POST", `${pr(n)}/comments`, { content: { raw: validarTexto(e.comentario, "comentário", 4000) } }, "comentar", e);
        await escrever("POST", `${pr(n)}/decline`, {}, `fechar o PR #${n}`, e);
      },
      async prontoParaRevisao(n, e) {
        await guardaEscrita(e, "marcar o PR como pronto");
        await escrever("PUT", pr(n), { draft: false }, `marcar o PR #${n} como pronto`, e);
      },
      async revisar(n, entrada, e) {
        await guardaEscrita(e, "revisar o PR");
        if (entrada.acao === "aprovar") await escrever("POST", `${pr(n)}/approve`, {}, "aprovar", e);
        else if (entrada.acao === "pedir-mudancas") {
          if (entrada.corpo) await escrever("POST", `${pr(n)}/comments`, { content: { raw: validarTexto(entrada.corpo, "corpo", 64 * 1024) } }, "comentar", e);
          await escrever("POST", `${pr(n)}/request-changes`, {}, "pedir mudanças", e);
        } else if (entrada.acao === "comentar") await escrever("POST", `${pr(n)}/comments`, { content: { raw: validarTexto(entrada.corpo ?? "", "corpo", 64 * 1024) } }, "comentar", e);
        else throw new ForgeEntradaInvalidaErro("ação", "use aprovar, pedir-mudancas ou comentar");
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar no PR");
        const c: Record<string, unknown> = { content: { raw: validarTexto(corpo, "comentário", 64 * 1024) } };
        if (e.local !== undefined) {
          const linha = validarNumero(e.local.linha, "linha");
          c.inline = e.local.lado === "esquerda" ? { path: validarTexto(e.local.caminho, "arquivo", 1024), from: linha } : { path: validarTexto(e.local.caminho, "arquivo", 1024), to: linha };
        }
        await escrever("POST", `${pr(n)}/comments`, c, `comentar no PR #${n}`, e);
      },
    },
    checks: {
      async doPr(n, op = {}) {
        const o = obj(await get(`${pr(n)}/statuses`, `ler os checks do PR #${n}`, { pagelen: 100 }, op));
        return limitarLista(arr(o.values).map((c): CheckForge => ({ nome: str(obj(c).name) || str(obj(c).key, "check"), situacao: situacao(str(obj(c).state)), url: str(obj(c).url), iniciadoEm: str(obj(c).created_on) }))).itens;
      },
      async execucoes(f: FiltroExecucao = {}, op = {}): Promise<ExecucaoCi[]> {
        const o = obj(await get(`${raiz}/pipelines/`, "listar as execuções", { sort: "-created_on", pagelen: limiteRest(f.limite) }, op));
        let l = arr(o.values).map((x): ExecucaoCi => {
          const p = obj(x);
          const st = obj(p.state);
          const res = str(obj(st.result).name);
          return { id: str(p.uuid), nome: `Pipeline #${num(p.build_number)}`, situacao: situacao(res || str(st.name)), ramo: str(obj(p.target).ref_name), evento: str(obj(p.trigger).name), url: "", criadoEm: str(p.created_on), atualizadoEm: str(p.completed_on) || str(p.created_on) };
        });
        if (f.ramo !== undefined) l = l.filter((x) => x.ramo === f.ramo);
        if (f.situacao !== undefined) l = l.filter((x) => x.situacao === f.situacao);
        return limitarLista(l).itens;
      },
      async log(id, op) {
        const [p, s] = id.split("/");
        if (p === undefined || s === undefined || id.split("/").length !== 2) throw new ForgeEntradaInvalidaErro("id", "use pipelineUuid/stepUuid");
        return cli.stream(`${raiz}/pipelines/${enc(parteId(p, "pipeline"))}/steps/${enc(parteId(s, "passo"))}/log`, { acao: "ler o log", aoPedaco: op.aoPedaco, ...(op.maxBytes !== undefined ? { maxBytes: op.maxBytes } : {}), ...sigDe(op) });
      },
      reexecutarFalhos: () => naoSuportado("bitbucket", "Re-executar pipeline falho"),
    },
    issues: {
      async listar(f: FiltroIssue = {}, op = {}) {
        let l = arr(obj(await get(`${raiz}/issues`, "listar as issues", { pagelen: limiteRest(f.limite) }, op)).values).map(resumoIssue);
        const est = f.estado ?? "aberta";
        if (est !== "todas") l = l.filter((i) => i.estado === est);
        if (f.autor !== undefined) l = l.filter((i) => i.autor === f.autor);
        if (f.label !== undefined) l = l.filter((i) => i.labels.includes(f.label!));
        if (f.busca !== undefined) l = l.filter((i) => i.titulo.toLowerCase().includes(f.busca!.toLowerCase()));
        return limitarLista(l).itens;
      },
      async ver(n, op = {}): Promise<IssueDetalhe> {
        const c = `${raiz}/issues/${validarNumero(n, "issue")}`;
        const [i, coms] = await Promise.all([get(c, `ler a issue #${n}`, {}, op), get(`${c}/comments`, "ler os comentários", { pagelen: 100 }, op)]);
        const o = obj(i);
        if (o.id === undefined) throw new ForgeNaoEncontradoErro(`Issue #${n}`);
        const corpo = truncarTexto(str(obj(o.content).raw), LIMITE_CORPO);
        const com = comentarios(obj(coms).values);
        return { ...resumoIssue(o), corpo: corpo.texto, comentarios: com.itens, truncado: corpo.truncado || com.truncado };
      },
      async criar(entrada: EntradaCriarIssue, e) {
        await guardaEscrita(e, "criar uma issue");
        return resumoIssue(await escrever("POST", `${raiz}/issues`, { title: validarTexto(entrada.titulo, "título", 256), content: { raw: validarTexto(entrada.corpo ?? "", "corpo", 256 * 1024, false) } }, "criar a issue", e));
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar na issue");
        await escrever("POST", `${raiz}/issues/${validarNumero(n, "issue")}/comments`, { content: { raw: validarTexto(corpo, "comentário", 64 * 1024) } }, `comentar na issue #${n}`, e);
      },
    },
  };
  return forge;
}
