import { StringDecoder } from "node:string_decoder";
import { arr, bool, guardaEscrita, lerCorpoArquivo, limitarLista, LIMITE_COMENTARIO, LIMITE_CORPO, num, obj, opcao, parseJson, RunnerCli, str, truncarTexto, validarCaminhoApi, validarLabel, validarLogin, validarNumero, validarRamo, validarRepo, validarTexto, classificarErroForge, type ConfigCli } from "./comum";
import { estadoCli, type OpcoesDetectar } from "./detectar";
import { ForgeEntradaInvalidaErro, ForgeMetodoMergeErro, ForgeNaoEncontradoErro } from "./erros";
import type { AcaoReview, CapacidadesForge, CheckForge, ComentarioForge, ConsultaPr, DecisaoRevisao, EntradaCriarIssue, EntradaCriarPr, EntradaMesclar, EstadoPr, ExecucaoCi, FiltroExecucao, FiltroIssue, FiltroPr, Forge, IssueDetalhe, IssueResumo, LimiteApi, MetodoMerge, OpcoesEscrita, OpcoesLeitura, OpcoesLog, PrDetalhe, PrResumo, RepoRef, ResultadoLog, ReviewForge, ResumoChecks, SituacaoCheck } from "./forge";

// T-06.18 a T-06.20 · Adaptador GitHub por `gh` (auth reaproveitada; GitHub Enterprise por hostname). Argumentos do usuário
// só entram como `--opcao=valor` (nunca viram opção), corpos por stdin; `gh api` só com caminhos validados; sem `--admin`.

const CAMPOS_RESUMO = "number,title,state,isDraft,author,headRefName,baseRefName,url,createdAt,updatedAt,labels,reviewDecision,statusCheckRollup";
const CAMPOS_DETALHE = `${CAMPOS_RESUMO},body,mergeable,files,comments,reviews`;
const LIMITE_LOG_PADRAO = 128 * 1024 * 1024;
const CAPACIDADES: CapacidadesForge = {
  prs: { listar: true, ver: true, criar: true, checkout: true, atualizarBranch: true, mesclar: true, fechar: true, prontoParaRevisao: true, revisar: true, comentar: true, comentarEmLinha: true, revisores: true, labels: true, rascunho: true, etag: true },
  checks: { doPr: true, execucoes: true, log: true, reexecutarFalhos: true },
  issues: { listar: true, ver: true, criar: true, comentar: true },
  metodosMerge: ["merge", "squash", "rebase"],
  limiteApi: true,
};

// ---- mapeamento tolerante -----------------------------------------------------------------------

const estadoPr = (s: string): EstadoPr => (/^merged$/i.test(s) ? "mesclado" : /^closed$/i.test(s) ? "fechado" : "aberto");
const decisao = (s: string): DecisaoRevisao => (s === "APPROVED" ? "aprovado" : s === "CHANGES_REQUESTED" ? "mudancas" : s === "REVIEW_REQUIRED" ? "pendente" : "nenhuma");
const login = (x: unknown): string => str(obj(x).login, "desconhecido");
const nomes = (x: unknown): string[] => arr(x).map((l) => str(obj(l).name)).filter(Boolean);

function situacao(status: string, conclusao: string, estado: string): SituacaoCheck {
  const c = (conclusao || estado).toUpperCase();
  const s = status.toUpperCase();
  if (s && s !== "COMPLETED" && !estado) return "pendente";
  if (c === "SUCCESS" || c === "PASS") return "sucesso";
  if (c === "FAILURE" || c === "ERROR" || c === "TIMED_OUT" || c === "STARTUP_FAILURE" || c === "ACTION_REQUIRED" || c === "FAIL") return "falha";
  if (c === "PENDING" || c === "EXPECTED" || c === "QUEUED" || c === "IN_PROGRESS" || c === "WAITING") return "pendente";
  if (c === "CANCELLED" || c === "CANCEL") return "cancelado";
  if (c === "SKIPPED" || c === "NEUTRAL" || c === "STALE" || c === "SKIPPING") return "ignorado";
  return "desconhecido";
}
function checksDoRollup(x: unknown): CheckForge[] {
  return arr(x).map((c) => {
    const o = obj(c);
    const r: CheckForge = { nome: str(o.name) || str(o.context, "check"), situacao: situacao(str(o.status), str(o.conclusion), str(o.state)), url: str(o.detailsUrl) || str(o.targetUrl) };
    const w = str(o.workflowName);
    if (w) r.workflow = w;
    const i = str(o.startedAt);
    if (i) r.iniciadoEm = i;
    const f = str(o.completedAt);
    if (f) r.concluidoEm = f;
    return r;
  });
}
function resumoChecks(x: unknown): ResumoChecks | null {
  if (!Array.isArray(x)) return null;
  const l = checksDoRollup(x);
  return { total: l.length, sucesso: l.filter((c) => c.situacao === "sucesso").length, falha: l.filter((c) => c.situacao === "falha").length, pendente: l.filter((c) => c.situacao === "pendente").length };
}
export function resumoPrGh(x: unknown): PrResumo {
  const o = obj(x);
  return { numero: num(o.number), titulo: str(o.title), estado: estadoPr(str(o.state)), rascunho: bool(o.isDraft), autor: login(o.author), ramoOrigem: str(o.headRefName), ramoDestino: str(o.baseRefName), url: str(o.url), criadoEm: str(o.createdAt), atualizadoEm: str(o.updatedAt), labels: nomes(o.labels), revisao: decisao(str(o.reviewDecision)), checks: resumoChecks(o.statusCheckRollup) };
}
function comentarios(x: unknown): { itens: ComentarioForge[]; truncado: boolean } {
  let truncado = false;
  const todos = arr(x).map((c) => {
    const o = obj(c);
    const t = truncarTexto(str(o.body), LIMITE_COMENTARIO);
    if (t.truncado) truncado = true;
    return { autor: login(o.author), corpo: t.texto, criadoEm: str(o.createdAt) } satisfies ComentarioForge;
  });
  const l = limitarLista(todos);
  return { itens: l.itens, truncado: truncado || l.truncado };
}
function reviews(x: unknown): ReviewForge[] {
  return limitarLista(
    arr(x).map((r) => {
      const o = obj(r);
      const s = str(o.state);
      return { autor: login(o.author), estado: s === "COMMENTED" ? ("comentado" as const) : decisao(s === "APPROVED" || s === "CHANGES_REQUESTED" ? s : "REVIEW_REQUIRED"), corpo: truncarTexto(str(o.body), LIMITE_COMENTARIO).texto, criadoEm: str(o.submittedAt) };
    }),
  ).itens;
}
const resumoIssue = (x: unknown): IssueResumo => {
  const o = obj(x);
  return { numero: num(o.number), titulo: str(o.title), estado: /^closed$/i.test(str(o.state)) ? "fechada" : "aberta", autor: login(o.author), labels: nomes(o.labels), url: str(o.url), criadoEm: str(o.createdAt), atualizadoEm: str(o.updatedAt) };
};
const idNumerico = (id: string): string => {
  if (!/^\d{1,20}$/.test(id)) throw new ForgeEntradaInvalidaErro("id da execução", "precisa ser numérico");
  return id;
};
const limite = (n: number | undefined, padrao = 30): string => String(Math.min(Math.max(Math.trunc(n ?? padrao), 1), 200));

/** Separa cabeçalhos e corpo de `gh api -i`. */
export function separarCabecalhos(saida: string): { status: number; cab: Record<string, string>; corpo: string } {
  const m = /\r?\n\r?\n/.exec(saida);
  const topo = m ? saida.slice(0, m.index) : saida.startsWith("HTTP/") ? saida : "";
  const corpo = m ? saida.slice(m.index + m[0].length) : topo ? "" : saida;
  const linhas = topo.split(/\r?\n/);
  const status = Number(/^HTTP\/\S+\s+(\d{3})/.exec(linhas[0] ?? "")?.[1] ?? 0);
  const cab: Record<string, string> = {};
  for (const l of linhas.slice(1)) {
    const i = l.indexOf(":");
    if (i > 0) cab[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return { status, cab, corpo };
}
export function limiteDeCabecalhos(cab: Record<string, string>): LimiteApi | null {
  const l = Number(cab["x-ratelimit-limit"]);
  const r = Number(cab["x-ratelimit-remaining"]);
  const t = Number(cab["x-ratelimit-reset"]);
  return Number.isFinite(l) && Number.isFinite(r) && Number.isFinite(t) && cab["x-ratelimit-limit"] !== undefined ? { limite: l, restante: r, reiniciaEm: t } : null;
}

export interface ConfigGithub extends Omit<ConfigCli, "provedor"> {
  repo: RepoRef;
}

export function criarForgeGithub(cfg: ConfigGithub): Forge {
  const repo = validarRepo(cfg.repo);
  const runner = new RunnerCli({ ...cfg, provedor: "github" });
  const R = opcao("repo", `${repo.host}/${repo.caminho}`);
  const H = opcao("hostname", repo.host);
  const caminhoRepo = `repos/${repo.caminho}`;

  const api = async (caminho: string, acao: string, op: OpcoesLeitura = {}): Promise<unknown> => parseJson(await runner.ok(["api", H, validarCaminhoApi(caminho, "github")], acao, op.signal ? { signal: op.signal } : {}));
  const apiEscrita = async (metodo: "POST" | "PUT" | "PATCH", caminho: string, corpo: unknown, acao: string, e: OpcoesEscrita): Promise<unknown> =>
    parseJson(await runner.ok(["api", H, opcao("method", metodo), "--input=-", validarCaminhoApi(caminho, "github")], acao, { tipo: "escrita", stdin: JSON.stringify(corpo), ...(e.signal ? { signal: e.signal } : {}) }));
  const lerPrResumo = async (n: number, op: OpcoesLeitura = {}): Promise<PrResumo> => resumoPrGh(await runner.json(["pr", "view", String(n), R, "--json", CAMPOS_RESUMO], `ler o PR #${n}`, op.signal ? { signal: op.signal } : {}));
  const sig = (e: OpcoesEscrita): { signal?: AbortSignal } => (e.signal ? { signal: e.signal } : {});

  const forge: Forge = {
    provedor: "github",
    repo,
    detectar: (op: OpcoesDetectar = {}) => estadoCli("github", repo, runner.cwd, { executor: cfg.executor, executavel: runner.executavel, ...(cfg.env ? { env: cfg.env } : {}), ...op } as OpcoesDetectar),
    capacidades: () => CAPACIDADES,
    async limiteApi(op = {}) {
      const j = obj(obj(obj(await api("rate_limit", "ler o limite da API", op)).resources).core);
      return j.limit === undefined ? null : { limite: num(j.limit), restante: num(j.remaining), reiniciaEm: num(j.reset) };
    },
    prs: {
      async listar(f: FiltroPr = {}, op = {}) {
        const args = ["pr", "list", R, "--json", CAMPOS_RESUMO, opcao("limit", limite(f.limite)), opcao("state", f.estado === "fechado" ? "closed" : f.estado === "mesclado" ? "merged" : f.estado === "todos" ? "all" : "open")];
        if (f.autor !== undefined) args.push(opcao("author", validarLogin(f.autor)));
        if (f.label !== undefined) args.push(opcao("label", validarLabel(f.label)));
        if (f.base !== undefined) args.push(opcao("base", validarRamo(f.base)));
        if (f.head !== undefined) args.push(opcao("head", validarRamo(f.head)));
        if (f.busca !== undefined) args.push(opcao("search", validarTexto(f.busca, "busca", 256)));
        if (f.rascunho === true) args.push("--draft");
        const l = limitarLista(arr(await runner.json(args, "listar os PRs", op.signal ? { signal: op.signal } : {})).map(resumoPrGh));
        return { itens: l.itens, truncado: l.truncado };
      },
      async ver(n, op = {}): Promise<PrDetalhe> {
        const o = obj(await runner.json(["pr", "view", String(validarNumero(n, "PR")), R, "--json", CAMPOS_DETALHE], `ler o PR #${n}`, op.signal ? { signal: op.signal } : {}));
        if (o.number === undefined) throw new ForgeNaoEncontradoErro(`PR #${n}`);
        const corpo = truncarTexto(str(o.body), LIMITE_CORPO);
        const com = comentarios(o.comments);
        const arqs = limitarLista(arr(o.files).map((f) => ({ caminho: str(obj(f).path), adicoes: num(obj(f).additions), remocoes: num(obj(f).deletions) })));
        const m = str(o.mergeable);
        return { ...resumoPrGh(o), corpo: corpo.texto, arquivos: arqs.itens, comentarios: com.itens, reviews: reviews(o.reviews), checksDetalhe: checksDoRollup(o.statusCheckRollup), mesclavel: m === "MERGEABLE" ? "sim" : m === "CONFLICTING" ? "nao" : "desconhecido", truncado: corpo.truncado || com.truncado || arqs.truncado };
      },
      async consultar(n, etag, op = {}): Promise<ConsultaPr> {
        validarNumero(n, "PR");
        const args = ["api", "-i", H];
        if (etag !== undefined) {
          if (!/^(W\/)?"[\w+/=.:-]{1,200}"$/.test(etag)) throw new ForgeEntradaInvalidaErro("ETag", "formato inválido");
          args.push(`--header=If-None-Match: ${etag}`);
        }
        args.push(validarCaminhoApi(`${caminhoRepo}/pulls/${n}`, "github"));
        const r = await runner.rodar(args, op.signal ? { signal: op.signal } : {});
        const { status, cab, corpo } = separarCabecalhos(r.stdout);
        const lim = limiteDeCabecalhos(cab);
        if (status === 304 || (r.codigo !== 0 && /HTTP 304|304 Not Modified/i.test(r.stderr + r.stdout))) return { naoModificado: true, ...(etag ? { etag } : {}), limite: lim };
        if (r.codigo !== 0) throw classificarErroForge("github", r.stderr || r.stdout, `consultar o PR #${n}`, r.codigo);
        const o = obj(parseJson(corpo));
        const estado: EstadoPr = bool(o.merged) || str(o.merged_at) !== "" ? "mesclado" : str(o.state) === "closed" ? "fechado" : "aberto";
        const pr: PrResumo = { numero: num(o.number, n), titulo: str(o.title), estado, rascunho: bool(o.draft), autor: login(o.user), ramoOrigem: str(obj(o.head).ref), ramoDestino: str(obj(o.base).ref), url: str(o.html_url), criadoEm: str(o.created_at), atualizadoEm: str(o.updated_at), labels: nomes(o.labels), revisao: "nenhuma", checks: null };
        return { naoModificado: false, ...(cab.etag ? { etag: cab.etag } : {}), pr, limite: lim };
      },
      async criar(entrada: EntradaCriarPr, e) {
        await guardaEscrita(e, "criar um PR");
        const args = ["pr", "create", R, opcao("title", validarTexto(entrada.titulo, "título", 256)), "--body-file=-"];
        if (entrada.base !== undefined) args.push(opcao("base", validarRamo(entrada.base, "base")));
        if (entrada.head !== undefined) args.push(opcao("head", validarRamo(entrada.head, "head")));
        if (entrada.rascunho === true) args.push("--draft");
        for (const r of entrada.revisores ?? []) args.push(opcao("reviewer", validarLogin(r, "revisor")));
        for (const l of entrada.labels ?? []) args.push(opcao("label", validarLabel(l)));
        const corpo = (await lerCorpoArquivo(entrada.corpoArquivo)) ?? entrada.corpo ?? "";
        const saida = await runner.ok(args, "criar o PR", { tipo: "escrita", stdin: validarTexto(corpo, "corpo", 256 * 1024, false), ...sig(e) });
        const n = Number(/\/pull\/(\d+)/.exec(saida)?.[1]);
        if (!Number.isSafeInteger(n) || n <= 0) throw new ForgeNaoEncontradoErro("PR recém-criado (a CLI não devolveu a URL)");
        return lerPrResumo(n);
      },
      async checkout(n, e) {
        await guardaEscrita(e, "trocar de branch para o PR");
        await runner.ok(["pr", "checkout", String(validarNumero(n, "PR")), R], `fazer checkout do PR #${n}`, { tipo: "escrita", ...sig(e) });
      },
      async atualizarBranch(n, e) {
        await guardaEscrita(e, "atualizar a branch do PR");
        await runner.ok(["pr", "update-branch", String(validarNumero(n, "PR")), R, ...(e.rebase === true ? ["--rebase"] : [])], `atualizar a branch do PR #${n}`, { tipo: "escrita", ...sig(e) });
      },
      async mesclar(n, entrada: EntradaMesclar, e) {
        await guardaEscrita(e, "mesclar o PR", true); // automação NUNCA mescla, nem com aprovação
        validarNumero(n, "PR");
        const cfgRepo = obj(await api(caminhoRepo, "ler as regras do repositório"));
        const permitidos: MetodoMerge[] = [];
        if (cfgRepo.allow_merge_commit !== false) permitidos.push("merge");
        if (cfgRepo.allow_squash_merge !== false) permitidos.push("squash");
        if (cfgRepo.allow_rebase_merge !== false) permitidos.push("rebase");
        const metodo = entrada.metodo ?? permitidos[0];
        if (metodo === undefined || !permitidos.includes(metodo)) throw new ForgeMetodoMergeErro(entrada.metodo ?? "(nenhum)", permitidos);
        const args = ["pr", "merge", String(n), R, `--${metodo}`];
        if (entrada.apagarBranch === true) args.push("--delete-branch");
        await runner.ok(args, `mesclar o PR #${n}`, { tipo: "escrita", ...sig(e) });
        return { metodo };
      },
      async fechar(n, e) {
        await guardaEscrita(e, "fechar o PR");
        const args = ["pr", "close", String(validarNumero(n, "PR")), R];
        if (e.comentario !== undefined) args.push(opcao("comment", validarTexto(e.comentario, "comentário", 4000)));
        await runner.ok(args, `fechar o PR #${n}`, { tipo: "escrita", ...sig(e) });
      },
      async prontoParaRevisao(n, e) {
        await guardaEscrita(e, "marcar o PR como pronto");
        await runner.ok(["pr", "ready", String(validarNumero(n, "PR")), R], `marcar o PR #${n} como pronto`, { tipo: "escrita", ...sig(e) });
      },
      async revisar(n, entrada: { acao: AcaoReview; corpo?: string }, e) {
        await guardaEscrita(e, "revisar o PR");
        const flag = entrada.acao === "aprovar" ? "--approve" : entrada.acao === "pedir-mudancas" ? "--request-changes" : entrada.acao === "comentar" ? "--comment" : null;
        if (flag === null) throw new ForgeEntradaInvalidaErro("ação", "use aprovar, pedir-mudancas ou comentar");
        if (entrada.acao !== "aprovar" && (entrada.corpo ?? "").trim() === "") throw new ForgeEntradaInvalidaErro("corpo", "obrigatório neste tipo de revisão");
        await runner.ok(["pr", "review", String(validarNumero(n, "PR")), R, flag, "--body-file=-"], `revisar o PR #${n}`, { tipo: "escrita", stdin: validarTexto(entrada.corpo ?? "", "corpo", 64 * 1024, false), ...sig(e) });
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar no PR");
        validarNumero(n, "PR");
        const texto = validarTexto(corpo, "comentário", 64 * 1024);
        if (e.local === undefined) {
          await runner.ok(["pr", "comment", String(n), R, "--body-file=-"], `comentar no PR #${n}`, { tipo: "escrita", stdin: texto, ...sig(e) });
          return;
        }
        const caminho = validarTexto(e.local.caminho, "arquivo", 1024);
        const linha = validarNumero(e.local.linha, "linha");
        const sha = str(obj(await runner.json(["pr", "view", String(n), R, "--json", "headRefOid"], `ler o commit do PR #${n}`)).headRefOid);
        if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new ForgeNaoEncontradoErro(`commit do PR #${n}`);
        await apiEscrita("POST", `${caminhoRepo}/pulls/${n}/comments`, { body: texto, commit_id: sha, path: caminho, line: linha, side: e.local.lado === "esquerda" ? "LEFT" : "RIGHT" }, `comentar na linha ${linha}`, e);
      },
    },
    checks: {
      async doPr(n, op = {}) {
        const r = await runner.rodar(["pr", "checks", String(validarNumero(n, "PR")), R, "--json", "name,state,bucket,link,workflow,startedAt,completedAt"], op.signal ? { signal: op.signal } : {});
        const j = parseJson(r.stdout);
        if (!Array.isArray(j)) {
          if (/no checks reported/i.test(r.stderr + r.stdout)) return [];
          throw classificarErroForge("github", r.stderr || r.stdout, `ler os checks do PR #${n}`, r.codigo); // `gh pr checks` sai com 1/8 se há falha/pendência: o JSON vale mesmo assim
        }
        return limitarLista(
          j.map((c): CheckForge => {
            const o = obj(c);
            const x: CheckForge = { nome: str(o.name, "check"), situacao: situacao("", str(o.bucket), str(o.state)), url: str(o.link) };
            if (str(o.workflow)) x.workflow = str(o.workflow);
            if (str(o.startedAt)) x.iniciadoEm = str(o.startedAt);
            if (str(o.completedAt)) x.concluidoEm = str(o.completedAt);
            return x;
          }),
        ).itens;
      },
      async execucoes(f: FiltroExecucao = {}, op = {}): Promise<ExecucaoCi[]> {
        const args = ["run", "list", R, "--json", "databaseId,displayTitle,name,workflowName,status,conclusion,headBranch,event,url,createdAt,updatedAt", opcao("limit", limite(f.limite))];
        if (f.ramo !== undefined) args.push(opcao("branch", validarRamo(f.ramo)));
        if (f.workflow !== undefined) args.push(opcao("workflow", validarTexto(f.workflow, "workflow", 256)));
        const l = arr(await runner.json(args, "listar as execuções", op.signal ? { signal: op.signal } : {})).map((x): ExecucaoCi => {
          const o = obj(x);
          return { id: str(o.databaseId), nome: str(o.workflowName) || str(o.name) || str(o.displayTitle), situacao: situacao(str(o.status), str(o.conclusion), ""), ramo: str(o.headBranch), evento: str(o.event), url: str(o.url), criadoEm: str(o.createdAt), atualizadoEm: str(o.updatedAt) };
        });
        return limitarLista(f.situacao ? l.filter((x) => x.situacao === f.situacao) : l).itens;
      },
      async log(id, op: OpcoesLog): Promise<ResultadoLog> {
        const dec = new StringDecoder("utf8");
        let bytes = 0;
        const r = await runner.rodar(["run", "view", idNumerico(id), R, op.somenteFalhos === true ? "--log-failed" : "--log"], {
          timeoutMs: 600_000,
          maxBytes: op.maxBytes ?? LIMITE_LOG_PADRAO,
          encerrarNoLimite: true,
          ...(op.signal ? { signal: op.signal } : {}),
          aoStdout: (p) => {
            bytes += p.length;
            const t = dec.write(p);
            if (t) op.aoPedaco(t);
          },
        });
        const resto = dec.end();
        if (resto) op.aoPedaco(resto);
        if (r.codigo !== 0 && !r.encerradoPorLimite) throw classificarErroForge("github", r.stderr || "falha", `ler o log da execução ${id}`, r.codigo);
        return { bytes, truncado: r.truncado || r.encerradoPorLimite };
      },
      async reexecutarFalhos(id, e) {
        await guardaEscrita(e, "re-executar a execução");
        await runner.ok(["run", "rerun", idNumerico(id), R, "--failed"], `re-executar a execução ${id}`, { tipo: "escrita", ...sig(e) });
      },
    },
    issues: {
      async listar(f: FiltroIssue = {}, op = {}) {
        const args = ["issue", "list", R, "--json", "number,title,state,author,labels,url,createdAt,updatedAt", opcao("limit", limite(f.limite)), opcao("state", f.estado === "fechada" ? "closed" : f.estado === "todas" ? "all" : "open")];
        if (f.autor !== undefined) args.push(opcao("author", validarLogin(f.autor)));
        if (f.label !== undefined) args.push(opcao("label", validarLabel(f.label)));
        if (f.busca !== undefined) args.push(opcao("search", validarTexto(f.busca, "busca", 256)));
        return limitarLista(arr(await runner.json(args, "listar as issues", op.signal ? { signal: op.signal } : {})).map(resumoIssue)).itens;
      },
      async ver(n, op = {}): Promise<IssueDetalhe> {
        const o = obj(await runner.json(["issue", "view", String(validarNumero(n, "issue")), R, "--json", "number,title,state,author,labels,url,createdAt,updatedAt,body,comments"], `ler a issue #${n}`, op.signal ? { signal: op.signal } : {}));
        if (o.number === undefined) throw new ForgeNaoEncontradoErro(`Issue #${n}`);
        const corpo = truncarTexto(str(o.body), LIMITE_CORPO);
        const com = comentarios(o.comments);
        return { ...resumoIssue(o), corpo: corpo.texto, comentarios: com.itens, truncado: corpo.truncado || com.truncado };
      },
      async criar(entrada: EntradaCriarIssue, e) {
        await guardaEscrita(e, "criar uma issue");
        const args = ["issue", "create", R, opcao("title", validarTexto(entrada.titulo, "título", 256)), "--body-file=-"];
        for (const l of entrada.labels ?? []) args.push(opcao("label", validarLabel(l)));
        const saida = await runner.ok(args, "criar a issue", { tipo: "escrita", stdin: validarTexto(entrada.corpo ?? "", "corpo", 256 * 1024, false), ...sig(e) });
        const n = Number(/\/issues\/(\d+)/.exec(saida)?.[1]);
        if (!Number.isSafeInteger(n) || n <= 0) throw new ForgeNaoEncontradoErro("issue recém-criada (a CLI não devolveu a URL)");
        return resumoIssue(await runner.json(["issue", "view", String(n), R, "--json", "number,title,state,author,labels,url,createdAt,updatedAt"], `ler a issue #${n}`));
      },
      async comentar(n, corpo, e) {
        await guardaEscrita(e, "comentar na issue");
        await runner.ok(["issue", "comment", String(validarNumero(n, "issue")), R, "--body-file=-"], `comentar na issue #${n}`, { tipo: "escrita", stdin: validarTexto(corpo, "comentário", 64 * 1024), ...sig(e) });
      },
    },
  };
  return forge;
}
