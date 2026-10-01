import { StringDecoder } from "node:string_decoder";
import { arr, bool, classificarErroForge, guardaEscrita, lerCorpoArquivo, limitarLista, LIMITE_COMENTARIO, LIMITE_CORPO, num, obj, opcao, parseJson, RunnerCli, str, truncarTexto, validarCaminhoApi, validarLabel, validarLogin, validarNumero, validarRamo, validarRepo, validarTexto, type ConfigCli } from "./comum";
import { estadoCli, type OpcoesDetectar } from "./detectar";
import { ForgeEntradaInvalidaErro, ForgeMetodoMergeErro, ForgeNaoEncontradoErro } from "./erros";
import type { AcaoReview, CapacidadesForge, CheckForge, ComentarioForge, ConsultaPr, EntradaCriarIssue, EntradaCriarPr, EntradaMesclar, EstadoPr, ExecucaoCi, FiltroExecucao, FiltroIssue, FiltroPr, Forge, IssueDetalhe, IssueResumo, MetodoMerge, OpcoesEscrita, OpcoesLeitura, OpcoesLog, PrDetalhe, PrResumo, RepoRef, ResultadoLog, ReviewForge, SituacaoCheck } from "./forge";

// T-06.22 · Adaptador GitLab por `glab api` (REST v4; auth da CLI reaproveitada; self-hosted por hostname). Mesmo padrão do
// GitHub: valores do usuário só em query codificada ou JSON por stdin; caminhos validados; sem token em argv.

const LIMITE_LOG_PADRAO = 128 * 1024 * 1024;
const CAPACIDADES: CapacidadesForge = {
  prs: { listar: true, ver: true, criar: true, checkout: true, atualizarBranch: true, mesclar: true, fechar: true, prontoParaRevisao: true, revisar: true, comentar: true, comentarEmLinha: true, revisores: true, labels: true, rascunho: true, etag: false },
  checks: { doPr: true, execucoes: true, log: true, reexecutarFalhos: true },
  issues: { listar: true, ver: true, criar: true, comentar: true },
  metodosMerge: ["merge", "squash", "rebase"],
  limiteApi: false,
};

const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const qs = (p: Record<string, string | number | undefined>): string => {
  const partes = Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${enc(String(v))}`);
  return partes.length ? `?${partes.join("&")}` : "";
};
const limite = (n: number | undefined, padrao = 30): number => Math.min(Math.max(Math.trunc(n ?? padrao), 1), 100);
const usuario = (x: unknown): string => str(obj(x).username, "desconhecido");
const nomesLabels = (x: unknown): string[] => arr(x).map((l) => (typeof l === "string" ? l : str(obj(l).name))).filter(Boolean);
const estadoMr = (s: string): EstadoPr => (s === "merged" ? "mesclado" : s === "closed" || s === "locked" ? "fechado" : "aberto");
const PREFIXO_DRAFT = /^\s*(\[draft\]|\(draft\)|draft:)\s*/i;
const idNumerico = (id: string, campo: string): string => {
  if (!/^\d{1,20}$/.test(id)) throw new ForgeEntradaInvalidaErro(campo, "precisa ser numérico");
  return id;
};
function situacao(s: string): SituacaoCheck {
  if (s === "success") return "sucesso";
  if (s === "failed") return "falha";
  if (["pending", "running", "created", "waiting_for_resource", "preparing", "scheduled"].includes(s)) return "pendente";
  if (s === "canceled" || s === "canceling") return "cancelado";
  if (s === "skipped" || s === "manual") return "ignorado";
  return "desconhecido";
}

export function resumoMrGl(x: unknown): PrResumo {
  const o = obj(x);
  const titulo = str(o.title);
  const hp = obj(o.head_pipeline);
  const st = situacao(str(hp.status));
  return {
    numero: num(o.iid),
    titulo: titulo.replace(PREFIXO_DRAFT, ""),
    estado: estadoMr(str(o.state)),
    rascunho: bool(o.draft) || bool(o.work_in_progress) || PREFIXO_DRAFT.test(titulo),
    autor: usuario(o.author),
    ramoOrigem: str(o.source_branch),
    ramoDestino: str(o.target_branch),
    url: str(o.web_url),
    criadoEm: str(o.created_at),
    atualizadoEm: str(o.updated_at),
    labels: nomesLabels(o.labels),
    revisao: "nenhuma",
    checks: o.head_pipeline ? { total: 1, sucesso: st === "sucesso" ? 1 : 0, falha: st === "falha" ? 1 : 0, pendente: st === "pendente" ? 1 : 0 } : null,
  };
}
const resumoIssue = (x: unknown): IssueResumo => {
  const o = obj(x);
  return { numero: num(o.iid), titulo: str(o.title), estado: str(o.state) === "closed" ? "fechada" : "aberta", autor: usuario(o.author), labels: nomesLabels(o.labels), url: str(o.web_url), criadoEm: str(o.created_at), atualizadoEm: str(o.updated_at) };
};
function notas(x: unknown): { itens: ComentarioForge[]; truncado: boolean } {
  let truncado = false;
  const todos = arr(x)
    .filter((n) => !bool(obj(n).system))
    .map((n) => {
      const o = obj(n);
      const t = truncarTexto(str(o.body), LIMITE_COMENTARIO);
      if (t.truncado) truncado = true;
      const c: ComentarioForge = { autor: usuario(o.author), corpo: t.texto, criadoEm: str(o.created_at) };
      const pos = obj(o.position);
      if (str(pos.new_path)) c.caminho = str(pos.new_path);
      if (pos.new_line !== undefined && pos.new_line !== null) c.linha = num(pos.new_line);
      return c;
    });
  const l = limitarLista(todos);
  return { itens: l.itens, truncado: truncado || l.truncado };
}
const contarLinhas = (diff: string): { adicoes: number; remocoes: number } => {
  let adicoes = 0;
  let remocoes = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) adicoes++;
    else if (l.startsWith("-") && !l.startsWith("---")) remocoes++;
  }
  return { adicoes, remocoes };
};

export interface ConfigGitlab extends Omit<ConfigCli, "provedor"> {
  repo: RepoRef;
}

export function criarForgeGitlab(cfg: ConfigGitlab): Forge {
  const repo = validarRepo(cfg.repo);
  const runner = new RunnerCli({ ...cfg, provedor: "gitlab" });
  const H = opcao("hostname", repo.host);
  const P = `projects/${enc(repo.caminho)}`;
  const sig = (e: OpcoesEscrita | OpcoesLeitura): { signal?: AbortSignal } => (e.signal ? { signal: e.signal } : {});

  const ler = async (caminho: string, acao: string, op: OpcoesLeitura = {}): Promise<unknown> => parseJson(await runner.ok(["api", H, validarCaminhoApi(caminho, "gitlab")], acao, sig(op)));
  const escrever = async (metodo: "POST" | "PUT", caminho: string, corpo: unknown, acao: string, e: OpcoesEscrita): Promise<unknown> =>
    parseJson(await runner.ok(["api", H, opcao("method", metodo), "--header=Content-Type: application/json", "--input=-", validarCaminhoApi(caminho, "gitlab")], acao, { tipo: "escrita", stdin: JSON.stringify(corpo), ...sig(e) }));
  const mr = (n: number): string => `${P}/merge_requests/${validarNumero(n, "MR")}`;

  const forge: Forge = {
    provedor: "gitlab",
    repo,
    detectar: (op: OpcoesDetectar = {}) => estadoCli("gitlab", repo, runner.cwd, { executor: cfg.executor, executavel: runner.executavel, ...(cfg.env ? { env: cfg.env } : {}), ...op } as OpcoesDetectar),
    capacidades: () => CAPACIDADES,
    limiteApi: async () => null,
    prs: {
      async listar(f: FiltroPr = {}, op = {}) {
        const q: Record<string, string | number | undefined> = { state: f.estado === "fechado" ? "closed" : f.estado === "mesclado" ? "merged" : f.estado === "todos" ? "all" : "opened", per_page: limite(f.limite) };
        if (f.autor !== undefined) q.author_username = validarLogin(f.autor);
        if (f.label !== undefined) q.labels = validarLabel(f.label);
        if (f.base !== undefined) q.target_branch = validarRamo(f.base);
        if (f.head !== undefined) q.source_branch = validarRamo(f.head);
        if (f.busca !== undefined) q.search = validarTexto(f.busca, "busca", 256);
        if (f.rascunho === true) q.wip = "yes";
        const l = limitarLista(arr(await ler(`${P}/merge_requests${qs(q)}`, "listar os MRs", op)).map(resumoMrGl));
        return { itens: l.itens, truncado: l.truncado };
      },
      async ver(n, op = {}): Promise<PrDetalhe> {
        const base = mr(n);
        const o = obj(await ler(base, `ler o MR !${n}`, op));
        if (o.iid === undefined) throw new ForgeNaoEncontradoErro(`MR !${n}`);
        const [diffs, nts, aprov, pipes] = await Promise.all([ler(`${base}/diffs?per_page=100`, "ler os arquivos do MR", op), ler(`${base}/notes?per_page=100`, "ler os comentários do MR", op), ler(`${base}/approvals`, "ler as aprovações do MR", op), ler(`${base}/pipelines`, "ler os pipelines do MR", op)]);
        const corpo = truncarTexto(str(o.description), LIMITE_CORPO);
        const com = notas(nts);
        const arqs = limitarLista(arr(diffs).map((d) => ({ caminho: str(obj(d).new_path) || str(obj(d).old_path), ...(({ adicoes, remocoes }) => ({ adicoes, remocoes }))(contarLinhas(str(obj(d).diff))) })));
        const aprovados: ReviewForge[] = arr(obj(aprov).approved_by).map((a) => ({ autor: usuario(obj(a).user), estado: "aprovado" as const, corpo: "", criadoEm: "" }));
        const pid = num(obj(arr(pipes)[0]).id);
        const checksDetalhe: CheckForge[] = pid > 0 ? await jobsDoPipeline(pid, op) : [];
        const resumo = resumoMrGl(o);
        const ds = str(o.detailed_merge_status);
        return { ...resumo, revisao: aprovados.length > 0 ? "aprovado" : resumo.revisao, corpo: corpo.texto, arquivos: arqs.itens, comentarios: com.itens, reviews: aprovados, checksDetalhe, mesclavel: ds === "mergeable" || o.merge_status === "can_be_merged" ? "sim" : bool(o.has_conflicts) || ds === "conflict" ? "nao" : "desconhecido", truncado: corpo.truncado || com.truncado || arqs.truncado };
      },
      async consultar(n, _etag, op = {}): Promise<ConsultaPr> {
        return { naoModificado: false, pr: resumoMrGl(await ler(mr(n), `consultar o MR !${n}`, op)), limite: null };
      },
      async criar(entrada: EntradaCriarPr, e) {
        await guardaEscrita(e, "criar um MR");
        const titulo = validarTexto(entrada.titulo, "título", 256);
        if (entrada.head === undefined) throw new ForgeEntradaInvalidaErro("head", "informe a branch de origem do MR");
        const origem = validarRamo(entrada.head, "head");
        const destino = entrada.base !== undefined ? validarRamo(entrada.base, "base") : str(obj(await ler(P, "ler o projeto")).default_branch);
        if (destino === "") throw new ForgeNaoEncontradoErro("branch padrão do projeto");
        const ids: number[] = [];
        for (const r of entrada.revisores ?? []) {
          const u = obj(arr(await ler(`users${qs({ username: validarLogin(r, "revisor") })}`, "buscar o revisor"))[0]);
          if (u.id === undefined) throw new ForgeNaoEncontradoErro(`Usuário ${r}`);
          ids.push(num(u.id));
        }
        const corpo = (await lerCorpoArquivo(entrada.corpoArquivo)) ?? entrada.corpo ?? "";
        const body: Record<string, unknown> = { source_branch: origem, target_branch: destino, title: entrada.rascunho === true ? `Draft: ${titulo}` : titulo, description: validarTexto(corpo, "corpo", 256 * 1024, false) };
        if (entrada.labels?.length) body.labels = entrada.labels.map((l) => validarLabel(l)).join(",");
        if (ids.length) body.reviewer_ids = ids;
        return resumoMrGl(await escrever("POST", `${P}/merge_requests`, body, "criar o MR", e));
      },
      async checkout(n, e) {
        await guardaEscrita(e, "trocar de branch para o MR");
        await runner.ok(["mr", "checkout", String(validarNumero(n, "MR")), opcao("repo", `${repo.host}/${repo.caminho}`)], `fazer checkout do MR !${n}`, { tipo: "escrita", ...sig(e) });
      },
      async atualizarBranch(n, e) {
        await guardaEscrita(e, "atualizar a branch do MR");
        await escrever("PUT", `${mr(n)}/rebase`, {}, `atualizar a branch do MR !${n}`, e);
      },
      async mesclar(n, entrada: EntradaMesclar, e) {
        await guardaEscrita(e, "mesclar o MR", true); // automação NUNCA mescla
        const base = mr(n);
        const p = obj(await ler(P, "ler as regras do projeto"));
        const mm = str(p.merge_method, "merge");
        const so = str(p.squash_option, "default_off");
        const permitidos: MetodoMerge[] = [];
        if (so !== "always") permitidos.push("merge");
        if (so !== "never") permitidos.push("squash");
        if (mm !== "merge" && so !== "always") permitidos.push("rebase");
        const metodo = entrada.metodo ?? (so === "always" || so === "default_on" ? "squash" : "merge");
        if (!permitidos.includes(metodo)) throw new ForgeMetodoMergeErro(metodo, permitidos);
        if (metodo === "rebase") await escrever("PUT", `${base}/rebase`, {}, `rebasear o MR !${n}`, e);
        await escrever("PUT", `${base}/merge`, { squash: metodo === "squash", should_remove_source_branch: entrada.apagarBranch === true }, `mesclar o MR !${n}`, e);
        return { metodo };
      },
      async fechar(n, e) {
        await guardaEscrita(e, "fechar o MR");
        if (e.comentario !== undefined) await escrever("POST", `${mr(n)}/notes`, { body: validarTexto(e.comentario, "comentário", 4000) }, "comentar no MR", e);
        await escrever("PUT", mr(n), { state_event: "close" }, `fechar o MR !${n}`, e);
      },
      async prontoParaRevisao(n, e) {
        await guardaEscrita(e, "marcar o MR como pronto");
        const o = obj(await ler(mr(n), `ler o MR !${n}`));
        await escrever("PUT", mr(n), { title: str(o.title).replace(PREFIXO_DRAFT, "") }, `marcar o MR !${n} como pronto`, e);
      },
      async revisar(n, entrada: { acao: AcaoReview; corpo?: string }, e) {
        await guardaEscrita(e, "revisar o MR");
        if (entrada.acao !== "aprovar" && entrada.acao !== "pedir-mudancas" && entrada.acao !== "comentar") throw new ForgeEntradaInvalidaErro("ação", "use aprovar, pedir-mudancas ou comentar");
        const corpo = entrada.corpo ?? "";
        if (entrada.acao !== "aprovar" && corpo.trim() === "") throw new ForgeEntradaInvalidaErro("corpo", "obrigatório neste tipo de revisão");
        if (entrada.acao === "aprovar") {
          await escrever("POST", `${mr(n)}/approve`, {}, `aprovar o MR !${n}`, e);
          if (corpo.trim() !== "") await escrever("POST", `${mr(n)}/notes`, { body: validarTexto(corpo, "corpo", 64 * 1024) }, "comentar no MR", e);
          return;
        }
        const texto = validarTexto(corpo, "corpo", 64 * 1024);
        await escrever("POST", `${mr(n)}/notes`, { body: entrada.acao === "pedir-mudancas" ? `Mudanças solicitadas:\n\n${texto}` : texto }, `revisar o MR !${n}`, e);
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar no MR");
        const texto = validarTexto(corpo, "comentário", 64 * 1024);
        if (e.local === undefined) {
          await escrever("POST", `${mr(n)}/notes`, { body: texto }, `comentar no MR !${n}`, e);
          return;
        }
        const caminho = validarTexto(e.local.caminho, "arquivo", 1024);
        const linha = validarNumero(e.local.linha, "linha");
        const refs = obj(obj(await ler(mr(n), `ler o MR !${n}`)).diff_refs);
        const sha = (k: string): string => {
          const v = str(refs[k]);
          if (!/^[0-9a-f]{7,64}$/i.test(v)) throw new ForgeNaoEncontradoErro(`referências de diff do MR !${n}`);
          return v;
        };
        const posicao: Record<string, unknown> = { position_type: "text", base_sha: sha("base_sha"), start_sha: sha("start_sha"), head_sha: sha("head_sha") };
        if (e.local.lado === "esquerda") Object.assign(posicao, { old_path: caminho, new_path: caminho, old_line: linha });
        else Object.assign(posicao, { old_path: caminho, new_path: caminho, new_line: linha });
        await escrever("POST", `${mr(n)}/discussions`, { body: texto, position: posicao }, `comentar na linha ${linha}`, e);
      },
    },
    checks: {
      async doPr(n, op = {}) {
        const pipes = arr(await ler(`${mr(n)}/pipelines`, `ler os pipelines do MR !${n}`, op));
        const pid = num(obj(pipes[0]).id);
        return pid > 0 ? jobsDoPipeline(pid, op) : [];
      },
      async execucoes(f: FiltroExecucao = {}, op = {}): Promise<ExecucaoCi[]> {
        const q: Record<string, string | number | undefined> = { per_page: limite(f.limite) };
        if (f.ramo !== undefined) q.ref = validarRamo(f.ramo);
        const l = arr(await ler(`${P}/pipelines${qs(q)}`, "listar os pipelines", op)).map((x): ExecucaoCi => {
          const o = obj(x);
          return { id: str(o.id), nome: str(o.name) || `Pipeline #${str(o.id)}`, situacao: situacao(str(o.status)), ramo: str(o.ref), evento: str(o.source), url: str(o.web_url), criadoEm: str(o.created_at), atualizadoEm: str(o.updated_at) };
        });
        return limitarLista(f.situacao ? l.filter((x) => x.situacao === f.situacao) : l).itens;
      },
      async log(id, op: OpcoesLog): Promise<ResultadoLog> {
        const dec = new StringDecoder("utf8");
        let bytes = 0;
        const r = await runner.rodar(["api", H, validarCaminhoApi(`${P}/jobs/${idNumerico(id, "id do job")}/trace`, "gitlab")], {
          timeoutMs: 600_000,
          maxBytes: op.maxBytes ?? LIMITE_LOG_PADRAO,
          encerrarNoLimite: true,
          ...sig(op),
          aoStdout: (p) => {
            bytes += p.length;
            const t = dec.write(p);
            if (t) op.aoPedaco(t);
          },
        });
        const resto = dec.end();
        if (resto) op.aoPedaco(resto);
        if (r.codigo !== 0 && !r.encerradoPorLimite) throw classificarErroForge("gitlab", r.stderr || "falha", `ler o log do job ${id}`, r.codigo);
        return { bytes, truncado: r.truncado || r.encerradoPorLimite };
      },
      async reexecutarFalhos(id, e) {
        await guardaEscrita(e, "re-executar o pipeline");
        await escrever("POST", `${P}/pipelines/${idNumerico(id, "id do pipeline")}/retry`, {}, `re-executar o pipeline ${id}`, e);
      },
    },
    issues: {
      async listar(f: FiltroIssue = {}, op = {}) {
        const q: Record<string, string | number | undefined> = { state: f.estado === "fechada" ? "closed" : f.estado === "todas" ? "all" : "opened", per_page: limite(f.limite) };
        if (f.autor !== undefined) q.author_username = validarLogin(f.autor);
        if (f.label !== undefined) q.labels = validarLabel(f.label);
        if (f.busca !== undefined) q.search = validarTexto(f.busca, "busca", 256);
        return limitarLista(arr(await ler(`${P}/issues${qs(q)}`, "listar as issues", op)).map(resumoIssue)).itens;
      },
      async ver(n, op = {}): Promise<IssueDetalhe> {
        const base = `${P}/issues/${validarNumero(n, "issue")}`;
        const o = obj(await ler(base, `ler a issue #${n}`, op));
        if (o.iid === undefined) throw new ForgeNaoEncontradoErro(`Issue #${n}`);
        const corpo = truncarTexto(str(o.description), LIMITE_CORPO);
        const com = notas(await ler(`${base}/notes?per_page=100`, "ler os comentários da issue", op));
        return { ...resumoIssue(o), corpo: corpo.texto, comentarios: com.itens, truncado: corpo.truncado || com.truncado };
      },
      async criar(entrada: EntradaCriarIssue, e) {
        await guardaEscrita(e, "criar uma issue");
        const body: Record<string, unknown> = { title: validarTexto(entrada.titulo, "título", 256), description: validarTexto(entrada.corpo ?? "", "corpo", 256 * 1024, false) };
        if (entrada.labels?.length) body.labels = entrada.labels.map((l) => validarLabel(l)).join(",");
        return resumoIssue(await escrever("POST", `${P}/issues`, body, "criar a issue", e));
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar na issue");
        await escrever("POST", `${P}/issues/${validarNumero(n, "issue")}/notes`, { body: validarTexto(corpo, "comentário", 64 * 1024) }, `comentar na issue #${n}`, e);
      },
    },
  };

  async function jobsDoPipeline(pid: number, op: OpcoesLeitura): Promise<CheckForge[]> {
    return limitarLista(
      arr(await ler(`${P}/pipelines/${pid}/jobs?per_page=100`, "ler os jobs do pipeline", op)).map((j): CheckForge => {
        const o = obj(j);
        const c: CheckForge = { nome: str(o.name, "job"), situacao: situacao(str(o.status)), url: str(o.web_url) };
        if (str(o.stage)) c.workflow = str(o.stage);
        if (str(o.started_at)) c.iniciadoEm = str(o.started_at);
        if (str(o.finished_at)) c.concluidoEm = str(o.finished_at);
        return c;
      }),
    ).itens;
  }
  return forge;
}
