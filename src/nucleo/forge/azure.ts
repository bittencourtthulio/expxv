import { arr, bool, guardaEscrita, lerCorpoArquivo, limitarLista, LIMITE_COMENTARIO, LIMITE_CORPO, num, obj, str, truncarTexto, validarLabel, validarNumero, validarRamo, validarRepo, validarTexto } from "./comum";
import { ForgeEntradaInvalidaErro, ForgeMetodoMergeErro, ForgeNaoEncontradoErro } from "./erros";
import type { CapacidadesForge, CheckForge, ComentarioForge, DecisaoRevisao, EntradaCriarPr, EstadoPr, ExecucaoCi, FiltroExecucao, FiltroPr, Forge, MetodoMerge, OpcoesEscrita, PrDetalhe, PrResumo, ReviewForge, SituacaoCheck } from "./forge";
import { criarClienteRest, enc, estadoRest, limiteRest, naoSuportado, sigDe, type ConfigRest } from "./rest";

// Adaptador Azure DevOps (REST, api-version 7.1). repo.caminho = `org/projeto/repo`. Issues (work items) ficam fora.

const BASE = "https://dev.azure.com";
const V = "7.1";
const CAPACIDADES: CapacidadesForge = {
  prs: { listar: true, ver: true, criar: true, checkout: false, atualizarBranch: false, mesclar: true, fechar: true, prontoParaRevisao: true, revisar: true, comentar: true, comentarEmLinha: true, revisores: true, labels: true, rascunho: true, etag: false },
  checks: { doPr: true, execucoes: true, log: true, reexecutarFalhos: false },
  issues: { listar: false, ver: false, criar: false, comentar: false },
  metodosMerge: ["merge", "squash", "rebase"],
  limiteApi: false,
};
const ESTRATEGIA: Record<MetodoMerge, string> = { merge: "noFastForward", squash: "squash", rebase: "rebase" };
const GUID = /^[0-9a-fA-F-]{32,36}$/;
const semRef = (r: string): string => r.replace(/^refs\/heads\//, "");

const estadoPr = (s: string): EstadoPr => (s === "completed" ? "mesclado" : s === "abandoned" ? "fechado" : "aberto");
const decisaoVoto = (votos: number[]): DecisaoRevisao => (votos.some((v) => v < 0) ? "mudancas" : votos.some((v) => v > 0) ? "aprovado" : votos.length > 0 ? "pendente" : "nenhuma");
const quem = (x: unknown): string => str(obj(x).uniqueName) || str(obj(x).displayName) || "desconhecido";
function situacao(status: string, resultado: string): SituacaoCheck {
  const r = resultado.toLowerCase();
  const s = status.toLowerCase();
  if (r === "succeeded") return "sucesso";
  if (r === "failed" || r === "partiallysucceeded") return "falha";
  if (r === "canceled") return "cancelado";
  if (s === "inprogress" || s === "notstarted" || s === "postponed" || s === "cancelling") return "pendente";
  return "desconhecido";
}

export function criarForgeAzure(cfg: ConfigRest): Forge {
  const repo = validarRepo(cfg.repo);
  const [org, proj, nome] = repo.caminho.split("/") as [string, string, string];
  if (nome === undefined) throw new ForgeEntradaInvalidaErro("repositório", "use org/projeto/repo");
  const cli = criarClienteRest("azure", cfg, BASE);
  const projeto = `${enc(org)}/${enc(proj)}`;
  const git = `${projeto}/_apis/git/repositories/${enc(nome)}`;
  const prCam = (n: number): string => `${git}/pullrequests/${validarNumero(n, "PR")}`;
  const urlWeb = (n: number): string => `${cli.base}/${projeto}/_git/${enc(nome)}/pullrequest/${n}`;
  const get = async (caminho: string, acao: string, query: Record<string, string | number> = {}, op?: { signal?: AbortSignal }): Promise<unknown> => (await cli.requisitar("GET", caminho, { acao, query: { "api-version": V, ...query }, ...sigDe(op) })).json;
  const escrever = (metodo: "POST" | "PUT" | "PATCH", caminho: string, corpo: unknown, acao: string, e: OpcoesEscrita): Promise<unknown> => cli.requisitar(metodo, caminho, { acao, corpo, query: { "api-version": V }, ...sigDe(e) }).then((r) => r.json);

  const resumo = (x: unknown): PrResumo => {
    const o = obj(x);
    const n = num(o.pullRequestId);
    return { numero: n, titulo: str(o.title), estado: estadoPr(str(o.status)), rascunho: bool(o.isDraft), autor: quem(o.createdBy), ramoOrigem: semRef(str(o.sourceRefName)), ramoDestino: semRef(str(o.targetRefName)), url: n ? urlWeb(n) : "", criadoEm: str(o.creationDate), atualizadoEm: str(o.closedDate) || str(o.creationDate), labels: arr(o.labels).map((l) => str(obj(l).name)).filter(Boolean), revisao: decisaoVoto(arr(o.reviewers).map((r) => num(obj(r).vote))), checks: null };
  };
  const buildCheck = (b: unknown): CheckForge => {
    const o = obj(b);
    const r: CheckForge = { nome: str(obj(o.definition).name) || str(o.buildNumber, "build"), situacao: situacao(str(o.status), str(o.result)), url: str(obj(obj(o._links).web).href) };
    if (str(o.startTime) || str(o.queueTime)) r.iniciadoEm = str(o.startTime) || str(o.queueTime);
    if (str(o.finishTime)) r.concluidoEm = str(o.finishTime);
    return r;
  };
  const builds = async (query: Record<string, string | number>, op?: { signal?: AbortSignal }): Promise<unknown[]> => arr(obj(await get(`${projeto}/_apis/build/builds`, "ler os builds", query, op)).value);
  const idsLog = (id: string): [string, string] => {
    const p = id.split("/");
    if (p.length !== 2 || !/^\d{1,12}$/.test(p[0]!) || !/^\d{1,12}$/.test(p[1]!)) throw new ForgeEntradaInvalidaErro("id", "use buildId/logId numéricos");
    return [p[0]!, p[1]!];
  };

  const forge: Forge = {
    provedor: "azure",
    repo,
    detectar: () => estadoRest("azure", repo, cli),
    capacidades: () => CAPACIDADES,
    limiteApi: () => Promise.resolve(null),
    prs: {
      async listar(f: FiltroPr = {}, op = {}) {
        const query: Record<string, string | number> = { "searchCriteria.status": f.estado === "fechado" ? "abandoned" : f.estado === "mesclado" ? "completed" : f.estado === "todos" ? "all" : "active", $top: limiteRest(f.limite) };
        if (f.base !== undefined) query["searchCriteria.targetRefName"] = `refs/heads/${validarRamo(f.base, "base")}`;
        if (f.head !== undefined) query["searchCriteria.sourceRefName"] = `refs/heads/${validarRamo(f.head, "head")}`;
        let itens = arr(obj(await get(`${git}/pullrequests`, "listar os PRs", query, op)).value).map(resumo);
        if (f.autor !== undefined) itens = itens.filter((p) => p.autor === f.autor);
        if (f.label !== undefined) itens = itens.filter((p) => p.labels.includes(f.label!));
        if (f.busca !== undefined) itens = itens.filter((p) => p.titulo.toLowerCase().includes(f.busca!.toLowerCase()));
        if (f.rascunho === true) itens = itens.filter((p) => p.rascunho);
        const l = limitarLista(itens);
        return { itens: l.itens, truncado: l.truncado };
      },
      async ver(n, op = {}): Promise<PrDetalhe> {
        const caminho = prCam(n);
        const tolerante = async <T>(p: Promise<T>, vazio: T): Promise<T> => p.catch((e) => (e instanceof ForgeNaoEncontradoErro ? vazio : Promise.reject(e)));
        const [p, th, its, bs] = await Promise.all([get(caminho, `ler o PR #${n}`, {}, op), get(`${caminho}/threads`, "ler os comentários", {}, op), tolerante(get(`${caminho}/iterations`, "ler as iterações", {}, op), {}), builds({ branchName: `refs/pull/${n}/merge`, $top: 20 }, op)]);
        const o = obj(p);
        if (o.pullRequestId === undefined) throw new ForgeNaoEncontradoErro(`PR #${n}`);
        let truncado = false;
        const coms: ComentarioForge[] = [];
        for (const t of arr(obj(th).value).map(obj)) {
          const ctx = obj(t.threadContext);
          for (const c of arr(t.comments).map(obj)) {
            if (str(c.commentType) === "system" || bool(c.isDeleted)) continue;
            const tx = truncarTexto(str(c.content), LIMITE_COMENTARIO);
            if (tx.truncado) truncado = true;
            const r: ComentarioForge = { autor: quem(c.author), corpo: tx.texto, criadoEm: str(c.publishedDate) };
            if (str(ctx.filePath)) r.caminho = str(ctx.filePath);
            const ln = obj(ctx.rightFileStart).line;
            if (ln !== undefined) r.linha = num(ln);
            coms.push(r);
          }
        }
        const lc = limitarLista(coms);
        const ultima = arr(obj(its).value).map((i) => num(obj(i).id)).filter((i) => i > 0).pop();
        let arquivos: { caminho: string; adicoes: number; remocoes: number }[] = [];
        let arqTrunc = false;
        if (ultima !== undefined) {
          const ch = await tolerante(get(`${caminho}/iterations/${ultima}/changes`, "ler os arquivos", {}, op), {});
          const la = limitarLista(arr(obj(ch).changeEntries).map((c) => ({ caminho: str(obj(obj(c).item).path), adicoes: 0, remocoes: 0 })));
          arquivos = la.itens;
          arqTrunc = la.truncado;
        }
        const reviews: ReviewForge[] = arr(o.reviewers).map(obj).map((r) => ({ autor: quem(r), estado: decisaoVoto([num(r.vote)]), corpo: "", criadoEm: "" }));
        const checks = limitarLista(bs.map(buildCheck));
        const corpo = truncarTexto(str(o.description), LIMITE_CORPO);
        const base = resumo(o);
        base.checks = { total: checks.itens.length, sucesso: checks.itens.filter((c) => c.situacao === "sucesso").length, falha: checks.itens.filter((c) => c.situacao === "falha").length, pendente: checks.itens.filter((c) => c.situacao === "pendente").length };
        const ms = str(o.mergeStatus);
        return { ...base, corpo: corpo.texto, arquivos, comentarios: lc.itens, reviews, checksDetalhe: checks.itens, mesclavel: ms === "succeeded" ? "sim" : ms === "conflicts" ? "nao" : "desconhecido", truncado: truncado || lc.truncado || corpo.truncado || arqTrunc || checks.truncado };
      },
      async consultar(n, _etag, op = {}) {
        return { naoModificado: false, pr: resumo(await get(prCam(n), `consultar o PR #${n}`, {}, op)), limite: null };
      },
      async criar(entrada: EntradaCriarPr, e) {
        await guardaEscrita(e, "criar um PR");
        if (entrada.head === undefined || entrada.base === undefined) throw new ForgeEntradaInvalidaErro("head/base", "obrigatórios no Azure DevOps");
        const corpo: Record<string, unknown> = { sourceRefName: `refs/heads/${validarRamo(entrada.head, "head")}`, targetRefName: `refs/heads/${validarRamo(entrada.base, "base")}`, title: validarTexto(entrada.titulo, "título", 256), description: validarTexto((await lerCorpoArquivo(entrada.corpoArquivo)) ?? entrada.corpo ?? "", "corpo", 256 * 1024, false) };
        if (entrada.rascunho === true) corpo.isDraft = true;
        for (const r of entrada.revisores ?? []) if (!GUID.test(r)) throw new ForgeEntradaInvalidaErro("revisor", "o Azure DevOps exige o id (GUID) do revisor");
        if ((entrada.revisores ?? []).length > 0) corpo.reviewers = entrada.revisores!.map((id) => ({ id }));
        const labels = (entrada.labels ?? []).map((l) => validarLabel(l));
        const criado = obj(await escrever("POST", `${git}/pullrequests`, corpo, "criar o PR", e));
        const n = num(criado.pullRequestId);
        for (const l of labels) await escrever("POST", `${prCam(n)}/labels`, { name: l }, "adicionar label", e);
        const r = resumo(criado);
        r.labels = labels;
        return r;
      },
      checkout: () => naoSuportado("azure", "Checkout de PR"),
      atualizarBranch: () => naoSuportado("azure", "Atualizar a branch do PR"),
      async mesclar(n, entrada, e) {
        await guardaEscrita(e, "mesclar o PR", true);
        const metodo = entrada.metodo ?? "merge";
        if (!(metodo in ESTRATEGIA)) throw new ForgeMetodoMergeErro(String(metodo), Object.keys(ESTRATEGIA));
        const o = obj(await get(prCam(n), `ler o PR #${n}`, {}, e));
        const commit = str(obj(o.lastMergeSourceCommit).commitId);
        if (!commit) throw new ForgeNaoEncontradoErro(`commit do PR #${n}`);
        await escrever("PATCH", prCam(n), { status: "completed", lastMergeSourceCommit: { commitId: commit }, completionOptions: { mergeStrategy: ESTRATEGIA[metodo], deleteSourceBranch: entrada.apagarBranch === true } }, `mesclar o PR #${n}`, e);
        return { metodo };
      },
      async fechar(n, e) {
        await guardaEscrita(e, "fechar o PR");
        if (e.comentario !== undefined) await escrever("POST", `${prCam(n)}/threads`, { comments: [{ parentCommentId: 0, content: validarTexto(e.comentario, "comentário", 4000), commentType: 1 }], status: "closed" }, "comentar", e);
        await escrever("PATCH", prCam(n), { status: "abandoned" }, `fechar o PR #${n}`, e);
      },
      async prontoParaRevisao(n, e) {
        await guardaEscrita(e, "marcar o PR como pronto");
        await escrever("PATCH", prCam(n), { isDraft: false }, `marcar o PR #${n} como pronto`, e);
      },
      async revisar(n, entrada, e) {
        await guardaEscrita(e, "revisar o PR");
        const comentar = (): Promise<unknown> => escrever("POST", `${prCam(n)}/threads`, { comments: [{ parentCommentId: 0, content: validarTexto(entrada.corpo ?? "", "corpo", 64 * 1024), commentType: 1 }], status: "active" }, "comentar", e);
        if (entrada.acao === "comentar") return void (await comentar());
        if (entrada.acao !== "aprovar" && entrada.acao !== "pedir-mudancas") throw new ForgeEntradaInvalidaErro("ação", "use aprovar, pedir-mudancas ou comentar");
        const eu = str(obj(obj(await get(`${enc(org)}/_apis/connectionData`, "identificar a conta", { "api-version": "7.1-preview" }, e)).authenticatedUser).id);
        if (!GUID.test(eu)) throw new ForgeNaoEncontradoErro("identidade da conta ativa");
        if (entrada.corpo) await comentar();
        await escrever("PUT", `${prCam(n)}/reviewers/${enc(eu)}`, { id: eu, vote: entrada.acao === "aprovar" ? 10 : -5 }, "registrar o voto", e);
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar no PR");
        const t: Record<string, unknown> = { comments: [{ parentCommentId: 0, content: validarTexto(corpo, "comentário", 64 * 1024), commentType: 1 }], status: "active" };
        if (e.local !== undefined) {
          const linha = validarNumero(e.local.linha, "linha");
          const arq = validarTexto(e.local.caminho, "arquivo", 1024);
          const lado = e.local.lado === "esquerda" ? "left" : "right";
          t.threadContext = { filePath: arq.startsWith("/") ? arq : `/${arq}`, [`${lado}FileStart`]: { line: linha, offset: 1 }, [`${lado}FileEnd`]: { line: linha, offset: 1 } };
        }
        await escrever("POST", `${prCam(n)}/threads`, t, `comentar no PR #${n}`, e);
      },
    },
    checks: {
      async doPr(n, op = {}) {
        return limitarLista((await builds({ branchName: `refs/pull/${validarNumero(n, "PR")}/merge`, $top: 50 }, op)).map(buildCheck)).itens;
      },
      async execucoes(f: FiltroExecucao = {}, op = {}): Promise<ExecucaoCi[]> {
        const query: Record<string, string | number> = { $top: limiteRest(f.limite) };
        if (f.ramo !== undefined) query.branchName = `refs/heads/${validarRamo(f.ramo, "ramo")}`;
        let l = (await builds(query, op)).map((b): ExecucaoCi => {
          const o = obj(b);
          const c = buildCheck(o);
          return { id: str(o.id), nome: c.nome, situacao: c.situacao, ramo: semRef(str(o.sourceBranch)), evento: str(o.reason), url: c.url, criadoEm: str(o.queueTime), atualizadoEm: str(o.finishTime) || str(o.queueTime) };
        });
        if (f.workflow !== undefined) l = l.filter((x) => x.nome === f.workflow);
        if (f.situacao !== undefined) l = l.filter((x) => x.situacao === f.situacao);
        return limitarLista(l).itens;
      },
      async log(id, op) {
        const [b, l] = idsLog(id);
        return cli.stream(`${projeto}/_apis/build/builds/${b}/logs/${l}`, { acao: "ler o log", query: { "api-version": V }, aoPedaco: op.aoPedaco, ...(op.maxBytes !== undefined ? { maxBytes: op.maxBytes } : {}), ...sigDe(op) });
      },
      reexecutarFalhos: () => naoSuportado("azure", "Re-executar build falho"),
    },
    issues: {
      listar: () => naoSuportado("azure", "Issues (work items)"),
      ver: () => naoSuportado("azure", "Issues (work items)"),
      criar: () => naoSuportado("azure", "Issues (work items)"),
      comentar: () => naoSuportado("azure", "Issues (work items)"),
    },
  };
  return forge;
}
