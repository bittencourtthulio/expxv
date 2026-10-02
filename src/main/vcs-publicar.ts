// "Commit e push" / "Enviar PR" / "Atualizar" no main (D-630..D-639, D-690..D-693). O botão NUNCA executa git de escrita: ele (1) calcula fatos locais e baratos, (2) prepara o resumo
// do diálogo, (3) monta uma instrução em PT-BR (modelo versionado e editável), grava-a na pasta do produto do repositório e (4) ENTREGA uma linha ao
// agente (CLI de IA) com o contrato de entrega confirmada (D-620). Quem roda `git commit`/`git push`/`gh pr create` é a CLI, com as aprovações normais.
// Leituras: pelo `VcsMain` (estado, remotos, forge) e por `rodarGit` com executor "não confiável" (allowlist: rev-list, diff --numstat, log). Sem rede aqui,
// exceto a consulta ÚNICA do PR (`gh`) pedida pelo acompanhamento, depois do push. Nada de credencial é lido, guardado ou impresso.
import { access, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { AlvoVcs, EstadoVcs } from "../compartilhado/vcs";
import type { ArquivoPublicacao, CliPublicacao, EstadoGh, EstadoPublicacao, PedidoEnviarInstrucao, PedidoPedirMerge, PreparoAtualizar, PreparoPublicacao, ResultadoAtualizar, ResultadoBuscaRemoto, ResultadoEnviarInstrucao, ResultadoIgnorarSuite, TipoPublicacao } from "../compartilhado/vcs-publicar";
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import type { Remoto } from "../compartilhado/vcs-tipos";
import { registrarEventoDominio } from "../nucleo/missoes/eventos";
import { gravarNaPastaDoProduto } from "../nucleo/orquestracao/pasta";
import { harnessDaCli } from "../nucleo/metodo/comandos";
import { lerLockDoProjeto } from "../nucleo/metodo/instalacao";
import { ESPERA_CONFIRMACAO_ENTREGA_MS } from "../nucleo/metodo/missao";
import type { ServicoPanes } from "../nucleo/missoes/panes";
import { PRODUTO } from "../nucleo/produto";
import { CATALOGO_TERMINAIS } from "../nucleo/terminais/catalogo";
import type { FerramentaDetectada } from "../compartilhado/terminais";
import { executorPadrao } from "../nucleo/vcs/executor";
import { LITERAL, rodarGit, type OpcoesGitCmd } from "../nucleo/vcs/git/comum";
import {
  arquivosEmConflito,
  carregarModelo,
  carregarModeloMerge,
  classificarFalhaPull,
  ehArquivoSensivel,
  ehDaSuite,
  ehRamoPadrao,
  entregarInstrucao,
  frasePushNoPadrao,
  gravarExclusoes,
  incluivelNoCommit,
  LIMITE_CAMINHOS_SUITE,
  linhaDeEntrega,
  linhasDeExclusao,
  montarInstrucao,
  montarInstrucaoMerge,
  naPastaDoProduto,
  parsearRemotoGithub,
  separarSensiveis,
  sugerirNomeRamo,
  TEXTO_DIVERGIU,
  urlGithubSegura,
  validarNomeRamo,
  type ContextoPublicacao,
  type DependenciasEntrega,
  type ModeloPrompt,
  type PaneDeCli,
} from "../nucleo/vcs/publicar";
import { sanearErro, type VcsMain } from "./vcs";

export const TTL_REMOTO_MS = 60_000;
export const TTL_GH_MS = 45_000;
/** Quanto o estado espera o `gh auth status` antes de responder `desconhecido` (a verificação segue em segundo plano e entra no cache). */
export const ESPERA_GH_MS = 2_500;
/** Intervalo mínimo entre dois `git fetch --prune` automáticos do mesmo workspace (o clique em "Atualizar" ignora). */
export const TTL_FETCH_MS = 60_000;
const PRIMEIROS = 8;
const LIMITE_ARQUIVOS_NA_INSTRUCAO = 200;
const MAX_PASTAS_EXPANDIDAS = 20;
const MAX_ARQUIVOS_EXPANDIDOS = 2_000;

const ERRO = (m: string): Error => Object.assign(new Error(m), { name: "VcsErro" });

export interface DependenciasVcsPublicar {
  vcs: Pick<VcsMain, "estado" | "familia">;
  workspaces: { obter(id: string): { id: string; raiz: string } | undefined };
  banco: Pick<Banco, "executar" | "consultarUm">;
  repos: Pick<Repositorios, "pane">;
  panes: Pick<ServicoPanes, "abrirPane" | "enviarComando">;
  detector: { detectar(): Promise<FerramentaDetectada[]> };
  abrirExterno: (url: string) => void | Promise<void>;
  /** Só testes. */
  gravar?: typeof gravarNaPastaDoProduto;
  modelo?: (tipo: TipoPublicacao) => Promise<ModeloPrompt>;
  modeloMerge?: () => Promise<ModeloPrompt>;
  git?: (raiz: string, args: readonly string[], op?: OpcoesGitCmd) => Promise<{ stdout: string; codigo: number | null }>;
  agora?: () => number;
  confirmarEntregaMs?: number;
  esperaGhMs?: number;
}

export interface VcsPublicar {
  estado(p: { workspace_id: string; consultar_pr: boolean }): Promise<EstadoPublicacao>;
  preparar(tipo: TipoPublicacao, p: { workspace_id: string; sessao_foco: string | null }): Promise<PreparoPublicacao>;
  enviar(p: PedidoEnviarInstrucao): Promise<ResultadoEnviarInstrucao>;
  abrirUrl(p: { workspace_id: string; url: string }): Promise<boolean>;
  buscarRemoto(p: { workspace_id: string; forcar: boolean }): Promise<ResultadoBuscaRemoto>;
  prepararAtualizar(p: { workspace_id: string; sessao_foco: string | null }): Promise<PreparoAtualizar>;
  atualizar(p: { workspace_id: string }): Promise<ResultadoAtualizar>;
  pedirMerge(p: PedidoPedirMerge): Promise<ResultadoEnviarInstrucao>;
  ignorarSuite(p: { workspace_id: string }): Promise<ResultadoIgnorarSuite>;
}

interface Item { caminho: string; situacao: ArquivoPublicacao["situacao"] }

interface Coleta {
  raiz: string;
  est: EstadoVcs;
  fatos: EstadoPublicacao;
  remoto: string;
  /** rastreados alterados (sem ignorados nem a pasta do produto). Pode incluir segredos: quem lista separa. */
  rastreadas: Item[];
  /** novos (não rastreados) no nível do `git status` normal (pasta termina em `/`), sem a suíte. Pode incluir segredos. */
  novas: Item[];
  /** não rastreados da suíte ExpxDev / do app, como o status os mostra. */
  suite: string[];
}

const cliDeIa = (id: string): boolean => CATALOGO_TERMINAIS.some((f) => f.id === id && f.id !== "terminal");

function situacaoDe(m: EstadoVcs["status"]["arquivos"][number]): ArquivoPublicacao["situacao"] {
  if (m.tipo === "conflito") return "conflito";
  if (m.tipo === "naorastreado") return "novo";
  if (m.tipo === "renomeado" || m.tipo === "copiado") return "renomeado";
  if (m.indice === "D" || m.arvore === "D") return "removido";
  if (m.indice === "A") return "novo";
  return "modificado";
}

export function criarVcsPublicar(deps: DependenciasVcsPublicar): VcsPublicar {
  const agora = deps.agora ?? Date.now;
  const git = deps.git ?? ((raiz, args, op) => rodarGit(raiz, args, { executor: executorPadrao.comConfianca("nao_confiavel"), timeoutMs: 8_000, maxBytes: 4 * 1024 * 1024, ...op }));
  const gravar = deps.gravar ?? gravarNaPastaDoProduto;
  const modelo = deps.modelo ?? ((t: TipoPublicacao) => carregarModelo(t));
  const esperaGh = deps.esperaGhMs ?? ESPERA_GH_MS;

  const cacheRemoto = new Map<string, { em: number; nome: string; repo: string | null }>();
  const cacheGh = new Map<string, { em: number; valor: EstadoGh; pendente: Promise<EstadoGh> | null }>();
  const cacheBase = new Map<string, number | null>();

  const alvo = (workspace_id: string): AlvoVcs => ({ workspace_id, mission_id: null });
  const ws = (id: string): { id: string; raiz: string } => {
    const w = deps.workspaces.obter(id);
    if (w === undefined) throw ERRO("Workspace não encontrado.");
    return w;
  };
  const saneado = async <T>(raiz: string, f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) { throw sanearErro(e, [raiz]); }
  };

  // ---- fatos locais (cache curto) -----------------------------------------------------------------------------------------------

  async function remotoGithub(id: string): Promise<{ nome: string; repo: string | null }> {
    const c = cacheRemoto.get(id);
    if (c !== undefined && agora() - c.em < TTL_REMOTO_MS) return c;
    let nome = "origin";
    let repo: string | null = null;
    try {
      const lista = (await deps.vcs.familia("vcs:remoto", { ...alvo(id), op: "listar" })) as Remoto[];
      const origin = lista.find((r) => r.nome === "origin");
      if (origin !== undefined) {
        const p = parsearRemotoGithub(origin.url);
        repo = p === null ? null : `${p.dono}/${p.repo}`;
      }
      nome = origin?.nome ?? nome;
    } catch {
      repo = null;
    }
    const novo = { em: agora(), nome, repo };
    cacheRemoto.set(id, novo);
    return novo;
  }

  async function verificarGh(id: string): Promise<EstadoGh> {
    try {
      const r = (await deps.vcs.familia("vcs:forge", { ...alvo(id), op: "estado" })) as { forge: { cli: { instalada: boolean }; autenticado: boolean } | null };
      if (r.forge === null) return "ausente";
      if (!r.forge.cli.instalada) return "ausente";
      return r.forge.autenticado ? "ok" : "nao_autenticado";
    } catch {
      return "desconhecido";
    }
  }

  async function estadoGh(id: string): Promise<EstadoGh> {
    const c = cacheGh.get(id);
    if (c !== undefined && agora() - c.em < TTL_GH_MS) return c.valor;
    if (c?.pendente != null) return Promise.race([c.pendente, new Promise<EstadoGh>((ok) => setTimeout(() => ok("desconhecido"), esperaGh).unref())]);
    const pendente = verificarGh(id).then((valor) => {
      cacheGh.set(id, { em: agora(), valor, pendente: null });
      return valor;
    });
    cacheGh.set(id, { em: c?.em ?? 0, valor: c?.valor ?? "desconhecido", pendente });
    return Promise.race([pendente, new Promise<EstadoGh>((ok) => setTimeout(() => ok("desconhecido"), esperaGh).unref())]);
  }

  async function contarAFrenteDaBase(raiz: string, id: string, branch: string, base: string, oid: string | null): Promise<number | null> {
    const chave = `${id}\0${branch}\0${base}\0${oid ?? ""}`;
    if (cacheBase.has(chave)) return cacheBase.get(chave) ?? null;
    let n: number | null = null;
    if (validarNomeRamo(base).ok) {
      for (const ref of [base, `origin/${base}`]) {
        const r = await git(raiz, ["rev-list", "--count", `${ref}..HEAD`], { tolerar: [128, 1] }).catch(() => null);
        if (r !== null && r.codigo === 0 && /^\d+$/.test(r.stdout.trim())) { n = Number(r.stdout.trim()); break; }
      }
    }
    if (cacheBase.size > 200) cacheBase.clear();
    cacheBase.set(chave, n);
    return n;
  }

  /**
   * O status agrupa pastas não rastreadas (`src/`) e a CONTAGEM fica nesse nível (uma pasta nova vale 1, como no git; D-691). Só para listar e enxergar
   * segredos dentro delas (preparar/enviar), expande cada pasta em arquivos (`ls-files --others`, pathspec literal): devolve as novas sem as pastas que só
   * têm segredo e os NOMES sensíveis achados dentro.
   */
  async function expandirNovas(raiz: string, lista: Item[]): Promise<{ novas: Item[]; sensiveis: string[]; arquivos: Item[] }> {
    const sensiveis: string[] = [];
    const saida: Item[] = [];
    const arquivos: Item[] = [];
    let expandidas = 0;
    for (const item of lista) {
      if (!item.caminho.endsWith("/") || expandidas >= MAX_PASTAS_EXPANDIDAS) { saida.push(item); arquivos.push(item); continue; }
      expandidas++;
      const r = await git(raiz, ["ls-files", "-z", "--others", "--exclude-standard", "--", item.caminho], { tolerar: [128, 1], env: LITERAL }).catch(() => null);
      if (r === null || r.codigo !== 0) { saida.push(item); arquivos.push(item); continue; }
      const nomes = r.stdout.split("\0").filter((n) => n !== "" && !naPastaDoProduto(n)).slice(0, MAX_ARQUIVOS_EXPANDIDOS);
      if (nomes.length === 0) continue;
      const parte = separarSensiveis(nomes);
      sensiveis.push(...parte.sensiveis);
      if (parte.comuns.length > 0) saida.push(item);
      for (const n of parte.comuns) arquivos.push({ caminho: n, situacao: "novo" });
    }
    return { novas: saida, sensiveis, arquivos };
  }

  async function coletar(id: string, consultarPr: boolean): Promise<Coleta> {
    const w = ws(id);
    return saneado(w.raiz, async () => {
      const est = await deps.vcs.estado({ ...alvo(id), ignorados: false });
      const semGit: EstadoPublicacao = { git: false, remoto_github: false, repo: null, gh: "desconhecido", branch: null, ramo_padrao: null, no_padrao: false, alteradas: 0, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente: 0, a_frente_base: null, tem_upstream: false, operacao_em_curso: false, oid: null, pr: null };
      if (est.tipo !== "git") return { raiz: w.raiz, est, fatos: semGit, remoto: "origin", rastreadas: [], novas: [], suite: [] };
      const r = await remotoGithub(id);
      const rastreadas: Item[] = [];
      const novas: Item[] = [];
      const suite: string[] = [];
      for (const m of est.status.arquivos) {
        if (m.tipo === "ignorado") continue;
        if (m.tipo === "naorastreado") {
          if (ehDaSuite(m.caminho)) suite.push(m.caminho);
          else novas.push({ caminho: m.caminho, situacao: "novo" });
        } else if (!naPastaDoProduto(m.caminho)) rastreadas.push({ caminho: m.caminho, situacao: situacaoDe(m) });
      }
      const branch = est.status.branch;
      const noPadrao = ehRamoPadrao(branch, est.ramo_padrao);
      const github = r.repo !== null;
      const gh: EstadoGh = github ? await estadoGh(id) : "desconhecido";
      const aFrenteBase = github && branch !== null && !noPadrao && est.ramo_padrao !== null ? await contarAFrenteDaBase(w.raiz, id, branch, est.ramo_padrao, est.status.oid) : null;
      let pr: EstadoPublicacao["pr"] = null;
      if (consultarPr && github && gh === "ok" && branch !== null && !noPadrao) pr = await prDoBranch(id, branch);
      const fatos: EstadoPublicacao = {
        git: true, remoto_github: github, repo: r.repo, gh, branch, ramo_padrao: est.ramo_padrao, no_padrao: noPadrao,
        alteradas: separarSensiveis(rastreadas.map((m) => m.caminho)).comuns.length,
        novas: novas.filter((m) => !ehArquivoSensivel(m.caminho)).length,
        suite: { itens: suite.length, caminhos: suite.slice(0, LIMITE_CAMINHOS_SUITE) },
        atras: est.status.upstream === null ? 0 : est.status.behind, upstream: est.status.upstream,
        a_frente: est.status.ahead, a_frente_base: aFrenteBase, tem_upstream: est.status.upstream !== null,
        operacao_em_curso: est.operacao !== null, oid: est.resumo.oid, pr,
      };
      return { raiz: w.raiz, est, fatos, remoto: r.nome, rastreadas, novas, suite };
    });
  }

  /** UMA consulta ao `gh` (rede), só quando o acompanhamento detectou o push. Falha vira `null`. */
  async function prDoBranch(id: string, branch: string): Promise<EstadoPublicacao["pr"]> {
    try {
      const r = (await deps.vcs.familia("vcs:forge", { ...alvo(id), op: "prs_listar", estado: "todos", limite: 50 } as AlvoVcs & { op: string })) as { itens: Array<{ numero: number; url: string; estado: string; ramoOrigem: string }> };
      const achado = r.itens.find((p) => p.ramoOrigem === branch && p.estado === "aberto") ?? r.itens.find((p) => p.ramoOrigem === branch);
      return achado === undefined || !urlGithubSegura(achado.url) ? null : { numero: achado.numero, url: achado.url, estado: achado.estado };
    } catch {
      return null;
    }
  }

  // ---- contexto para o diálogo e para a instrução ---------------------------------------------------------------------------------

  async function somarLinhas(raiz: string): Promise<{ adicionadas: number; removidas: number }> {
    const r = await git(raiz, ["diff", "--numstat", "--no-ext-diff", "--no-textconv", "HEAD"], { tolerar: [128, 1] }).catch(() => null);
    let adicionadas = 0;
    let removidas = 0;
    if (r === null || r.codigo !== 0) return { adicionadas, removidas };
    for (const linha of r.stdout.split("\n")) {
      const m = /^(\d+)\t(\d+)\t(.+)$/.exec(linha);
      if (m === null) continue;
      const caminho = m[3] as string;
      if (naPastaDoProduto(caminho) || separarSensiveis([caminho]).sensiveis.length > 0) continue;
      adicionadas += Number(m[1]);
      removidas += Number(m[2]);
    }
    return { adicionadas, removidas };
  }

  async function assuntosRecentes(raiz: string): Promise<string[]> {
    const r = await git(raiz, ["log", "-10", "--format=%s", "--no-show-signature"], { tolerar: [128, 1] }).catch(() => null);
    return r === null || r.codigo !== 0 ? [] : r.stdout.split("\n").map((s) => s.trim()).filter((s) => s !== "").slice(0, 10);
  }

  async function hooksDoProjeto(raiz: string): Promise<string[]> {
    const existe = (rel: string): Promise<boolean> => access(join(raiz, rel)).then(() => true, () => false);
    const achados: string[] = [];
    for (const [rel, nome] of [[".husky", "husky"], [".pre-commit-config.yaml", "pre-commit"], ["lefthook.yml", "lefthook"], [".lefthook.yml", "lefthook"], [".git/hooks/pre-commit", "git:pre-commit"], [".git/hooks/commit-msg", "git:commit-msg"], [".git/hooks/pre-push", "git:pre-push"]] as const) {
      if (!achados.includes(nome) && (await existe(rel))) achados.push(nome);
    }
    return achados;
  }

  async function listaDeClis(raiz: string): Promise<{ clis: CliPublicacao[]; padrao: string | null }> {
    const ferramentas = await deps.detector.detectar().catch(() => [] as FerramentaDetectada[]);
    const instaladas = ferramentas.filter((f) => f.instalado && f.executavel_id !== null && cliDeIa(f.id));
    const { lock } = await lerLockDoProjeto(raiz).catch(() => ({ lock: { harness: [] as string[] } }));
    const ordem = [...lock.harness.filter((h) => harnessDaCli(h) !== null), "claude", "opencode", ...instaladas.map((f) => f.id)];
    const padrao = ordem.find((id) => instaladas.some((f) => f.id === id)) ?? null;
    return { clis: instaladas.map((f) => ({ id: f.id, nome: f.nome })), padrao };
  }

  function paneDaSessao(id: string, sessaoId: string): PaneDeCli | undefined {
    const linha = deps.banco.consultarUm<{ id: string }>("SELECT id FROM pane WHERE sessao_pty_id = ? AND estado <> 'encerrado' LIMIT 1", [sessaoId]);
    if (linha === undefined) return undefined;
    const p = deps.repos.pane.obter(linha.id);
    if (p === undefined || p.cli === null) return undefined;
    return { id: p.id, workspace_id: p.workspace_id, cli: p.cli, estado: p.estado, sessao_pty_id: p.sessao_pty_id, mission_id: p.mission_id, cwd: p.cwd };
  }

  /** Rastreados e novos SEM segredos (já com as pastas expandidas só para achar segredo), e os nomes sensíveis separados. */
  async function listaDeTrabalho(c: Coleta): Promise<{ rastreadas: Item[]; novas: Item[]; itens: Item[]; expandidos: Item[]; comuns: string[]; sensiveis: string[] }> {
    const exp = await expandirNovas(c.raiz, c.novas);
    const rastreadas = c.rastreadas.filter((m) => !ehArquivoSensivel(m.caminho));
    const novas = exp.novas.filter((m) => !ehArquivoSensivel(m.caminho));
    const sensiveis = [...c.rastreadas, ...c.novas].map((m) => m.caminho).filter(ehArquivoSensivel).concat(exp.sensiveis);
    const itens = [...rastreadas, ...novas];
    // para a instrução (nomes dentro das pastas novas): `novas`/`itens` ficam no nível do status (contagem honesta)
    const expandidos = [...rastreadas, ...exp.arquivos.filter((m) => !ehArquivoSensivel(m.caminho))];
    return { rastreadas, novas, itens, expandidos, comuns: expandidos.map((i) => i.caminho), sensiveis };
  }

  // ---- API ------------------------------------------------------------------------------------------------------------------------

  async function estado(p: { workspace_id: string; consultar_pr: boolean }): Promise<EstadoPublicacao> {
    return (await coletar(p.workspace_id, p.consultar_pr)).fatos;
  }

  async function preparar(tipo: TipoPublicacao, p: { workspace_id: string; sessao_foco: string | null }): Promise<PreparoPublicacao> {
    const c = await coletar(p.workspace_id, false);
    const f = c.fatos;
    if (!f.git) throw ERRO("Esta pasta não é um repositório git.");
    if (!f.remoto_github || f.repo === null) throw ERRO("O remoto origin não aponta para o GitHub (github.com).");
    if (f.ramo_padrao === null) throw ERRO("Não foi possível descobrir o branch padrão do repositório.");
    const lista = await listaDeTrabalho(c);
    const { sensiveis, comuns } = lista;
    const arquivos: ArquivoPublicacao[] = lista.itens.slice(0, PRIMEIROS).map((i) => ({ caminho: i.caminho, situacao: i.situacao, sensivel: false }));
    const linhas = await somarLinhas(c.raiz);
    const { clis, padrao } = await listaDeClis(c.raiz);
    const foco = p.sessao_foco === null ? undefined : paneDaSessao(p.workspace_id, p.sessao_foco);
    const cliFoco = foco !== undefined && foco.workspace_id === p.workspace_id && foco.estado !== "encerrado" && (foco.mission_id ?? null) === null && (foco.cwd ?? null) === null && cliDeIa(foco.cli) ? foco.cli : null;
    return {
      tipo, workspace_id: p.workspace_id, branch: f.branch, remoto: c.remoto, repo: f.repo, ramo_padrao: f.ramo_padrao, no_padrao: f.no_padrao,
      total_arquivos: lista.rastreadas.length, novos: lista.novas.length,
      suite: { itens: c.suite.length, caminhos: c.suite.slice(0, LIMITE_CAMINHOS_SUITE), incluiveis: c.suite.filter(incluivelNoCommit).length },
      adicionadas: linhas.adicionadas, removidas: linhas.removidas, arquivos, mais: Math.max(0, lista.itens.length - PRIMEIROS),
      sensiveis: sensiveis.slice(0, 20), a_frente: f.a_frente, tem_upstream: f.tem_upstream, sugestao_ramo: sugerirNomeRamo(comuns),
      clis, cli_padrao: padrao, cli_foco: cliFoco,
    };
  }

  function auditar(id: string, payload: Record<string, unknown>): void {
    try { registrarEventoDominio(deps.banco as Banco, "vcs.publicar", { workspace_id: id, mission_id: null, ...payload }); } catch { /* auditoria nunca derruba o fluxo */ }
  }

  function dependenciasDeEntrega(id: string, raiz: string): DependenciasEntrega {
    const confirmarMs = deps.confirmarEntregaMs ?? ESPERA_CONFIRMACAO_ENTREGA_MS;
    return {
      paneDaSessao: (sessaoId) => paneDaSessao(id, sessaoId),
      cliPadrao: async () => (await listaDeClis(raiz)).padrao,
      cliDeIa,
      escrever: async (paneId, linha) => {
        await deps.panes.enviarComando(paneId, linha);
        return { sessao_id: deps.repos.pane.obter(paneId)?.sessao_pty_id ?? null };
      },
      abrir: async (cli, linha) => {
        const r = await deps.panes.abrirPane({ workspace_id: id, cli, papel: "nenhum", prompt_inicial: linha });
        return { pane_id: r.pane.id, sessao_id: r.sessao_id ?? null };
      },
      saiuNaLargada: async (paneId) => {
        const limite = agora() + confirmarMs;
        for (;;) {
          const pane = deps.repos.pane.obter(paneId);
          if (pane === undefined || pane.estado === "encerrado") return pane?.encerrado_motivo == null || pane.encerrado_motivo === "processo_encerrado" ? "" : pane.encerrado_motivo;
          if (agora() >= limite) return null;
          await new Promise<void>((ok) => setTimeout(ok, 40));
        }
      },
      nomeDaCli: (cli) => CATALOGO_TERMINAIS.find((f) => f.id === cli)?.nome ?? cli,
    };
  }

  const falha = (motivo: string): ResultadoEnviarInstrucao => ({ estado: "falhou", motivo, pane_id: null, sessao_id: null, entrega: null, instrucao_rel: null });

  /** Grava a instrução na pasta do produto e a ENTREGA ao agente (contrato D-620); se não entregar, apaga o arquivo. */
  async function entregarArquivo(w: { id: string; raiz: string }, nome: string, texto: string, p: { sessao_foco: string | null; cli: string | null; modo_painel: "auto" | "novo" }): Promise<ResultadoEnviarInstrucao> {
    const carimbo = new Date(agora()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const rel = `${PRODUTO.pastaNoProjeto}/publicar/${carimbo}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}-${nome}.md`;
    const absoluto = await saneado(w.raiz, () => gravar(w.raiz, rel, texto));
    const r = await entregarInstrucao(dependenciasDeEntrega(w.id, w.raiz), { workspace_id: w.id, sessao_foco: p.sessao_foco, cli: p.cli, modo_painel: p.modo_painel }, linhaDeEntrega(rel));
    if (r.estado !== "entregue") await rm(absoluto, { force: true }).catch(() => undefined);
    return { ...r, instrucao_rel: r.estado === "entregue" ? rel : null };
  }

  async function enviar(p: PedidoEnviarInstrucao): Promise<ResultadoEnviarInstrucao> {
    const w = ws(p.workspace_id);
    const c = await coletar(p.workspace_id, false);
    const f = c.fatos;
    const tipo = p.tipo;
    // Tudo é conferido DE NOVO aqui: o renderer só pede, quem decide é o main com o estado real do repositório.
    if (!f.git) return falha("Esta pasta não é um repositório git.");
    if (!f.remoto_github || f.repo === null) return falha("O remoto origin não aponta para o GitHub (github.com).");
    if (f.ramo_padrao === null) return falha("Não foi possível descobrir o branch padrão do repositório.");
    if (f.operacao_em_curso) return falha("Há um merge/rebase em andamento: conclua ou aborte antes.");
    if (tipo === "pr" && f.gh !== "ok") return falha("Instale/autentique o gh (gh auth login).");
    const o = p.opcoes;
    const suiteIncluivel = c.suite.filter(incluivelNoCommit);
    const levaSuite = o.incluir_suite && suiteIncluivel.length > 0;
    if (tipo === "commit_push" && f.alteradas + f.novas === 0 && f.a_frente === 0 && !levaSuite) return falha("Nada para commitar.");

    if (o.criar_ramo) {
      const v = validarNomeRamo(o.nome_ramo ?? "");
      if (!v.ok) return falha(v.motivo);
      if (ehRamoPadrao(v.nome, f.ramo_padrao)) return falha("Escolha um nome diferente do branch padrão.");
    } else if (f.no_padrao) {
      if (tipo === "pr") return falha("Crie um branch primeiro: o PR não sai do branch padrão.");
      if (f.branch === null || o.confirmar_padrao !== frasePushNoPadrao(f.branch)) return falha(`O branch atual é o padrão (${f.branch ?? "?"}). Crie um branch novo ou confirme digitando "${frasePushNoPadrao(f.branch ?? "main")}".`);
    }
    if (o.criar_ramo && o.confirmar_padrao !== null) return falha("A confirmação de push no branch padrão só vale sem criar branch novo.");

    const lista = await listaDeTrabalho(c);
    const { sensiveis, comuns } = lista;
    if (tipo === "commit_push" && comuns.length === 0 && f.a_frente === 0 && !levaSuite) return falha("As únicas alterações são de arquivos de ambiente/chaves, que não entram no commit.");
    const linhas = await somarLinhas(c.raiz);
    const ctx: ContextoPublicacao = {
      repo: f.repo, remoto: c.remoto, ramo_padrao: f.ramo_padrao, ramo_atual: f.branch,
      arquivos: lista.expandidos.slice(0, LIMITE_ARQUIVOS_NA_INSTRUCAO).map((i) => ({ caminho: i.caminho, situacao: i.situacao })),
      total_arquivos: lista.expandidos.length, adicionadas: linhas.adicionadas, removidas: linhas.removidas,
      sensiveis, assuntos: await assuntosRecentes(c.raiz), hooks: await hooksDoProjeto(c.raiz), a_frente: f.a_frente,
      suite_incluir: levaSuite ? suiteIncluivel : [], suite_ignorar: levaSuite ? [] : suiteIncluivel,
    };
    const instrucao = montarInstrucao(tipo, await modelo(tipo), ctx, o);
    if (!instrucao.ok) return falha(instrucao.motivo);

    const r = await entregarArquivo(w, tipo === "pr" ? "pr" : "commit-push", instrucao.texto, p);
    auditar(p.workspace_id, {
      acao: tipo, estado: r.estado, entrega: r.entrega, cli: p.cli, modelo_versao: instrucao.versao, criar_ramo: o.criar_ramo, incluir_nao_rastreados: o.incluir_nao_rastreados,
      incluir_suite: levaSuite, push_no_padrao_confirmado: o.confirmar_padrao !== null, rascunho: o.pr?.rascunho ?? null, arquivos: lista.rastreadas.length, novos: lista.novas.length, suite_itens: c.suite.length, sensiveis_excluidos: sensiveis.length,
    });
    return r;
  }

  // ---- Atualizar (pull) (D-693) ---------------------------------------------------------------------------------------------------

  const ultimoFetch = new Map<string, number>();
  const fetchEmVoo = new Map<string, Promise<ResultadoBuscaRemoto>>();

  /** `git rev-list --count HEAD..@{u}`: commits do upstream que faltam (null = sem upstream). */
  async function contarAtras(raiz: string): Promise<number | null> {
    const r = await git(raiz, ["rev-list", "--count", "HEAD..@{u}"], { tolerar: [128, 1] }).catch(() => null);
    return r !== null && r.codigo === 0 && /^\d+$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null;
  }

  async function nomesDoUpstream(raiz: string): Promise<string[]> {
    const r = await git(raiz, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "HEAD...@{u}"], { tolerar: [128, 1] }).catch(() => null);
    return r === null || r.codigo !== 0 ? [] : r.stdout.split("\0").filter((n) => n !== "");
  }

  async function buscarRemoto(p: { workspace_id: string; forcar: boolean }): Promise<ResultadoBuscaRemoto> {
    const id = p.workspace_id;
    const w = ws(id);
    const r = await remotoGithub(id);
    if (r.repo === null) return { buscou: false, atras: 0, erro: null };
    const atras = async (): Promise<number> => (await saneado(w.raiz, () => contarAtras(w.raiz)).catch(() => null)) ?? 0;
    const ult = ultimoFetch.get(id);
    if (!p.forcar && ult !== undefined && agora() - ult < TTL_FETCH_MS) return { buscou: false, atras: await atras(), erro: null };
    const emVoo = fetchEmVoo.get(id);
    if (emVoo !== undefined) return emVoo;
    ultimoFetch.set(id, agora());
    const exec = (async (): Promise<ResultadoBuscaRemoto> => {
      try {
        await deps.vcs.familia("vcs:remoto", { ...alvo(id), op: "fetch", remoto: null, todos: false, podar: true } as AlvoVcs & { op: string });
        return { buscou: true, atras: await atras(), erro: null };
      } catch (e) {
        return { buscou: false, atras: await atras(), erro: classificarFalhaPull(sanearErro(e, [w.raiz]).message).texto };
      } finally {
        fetchEmVoo.delete(id);
      }
    })();
    fetchEmVoo.set(id, exec);
    return exec;
  }

  /** Fatos comuns ao preparo e ao pull; recusa (com motivo) o que não faz sentido. */
  async function contextoDoPull(id: string): Promise<{ c: Coleta; upstream: string; atras: number } | string> {
    const c = await coletar(id, false);
    const f = c.fatos;
    if (!f.git) return "Esta pasta não é um repositório git.";
    if (!f.remoto_github || f.repo === null) return "O remoto origin não aponta para o GitHub (github.com).";
    if (f.branch === null) return "HEAD destacado: troque para um branch antes de atualizar.";
    const upstream = c.est.status.upstream;
    if (upstream === null) return "Este branch não tem upstream: nada para trazer.";
    return { c, upstream, atras: (await saneado(c.raiz, () => contarAtras(c.raiz))) ?? f.atras };
  }

  async function prepararAtualizar(p: { workspace_id: string; sessao_foco: string | null }): Promise<PreparoAtualizar> {
    const x = await contextoDoPull(p.workspace_id);
    if (typeof x === "string") throw ERRO(x);
    const { c, upstream, atras } = x;
    const f = c.fatos;
    const nomes = atras > 0 ? await nomesDoUpstream(c.raiz) : [];
    const log = atras > 0 ? await git(c.raiz, ["log", "-5", "--format=%s", "--no-show-signature", "HEAD..@{u}"], { tolerar: [128, 1] }).catch(() => null) : null;
    const assuntos = log === null || log.codigo !== 0 ? [] : log.stdout.split("\n").map((s) => s.trim()).filter((s) => s !== "").slice(0, 5);
    const { clis, padrao } = await listaDeClis(c.raiz);
    const foco = p.sessao_foco === null ? undefined : paneDaSessao(p.workspace_id, p.sessao_foco);
    const cliFoco = foco !== undefined && foco.workspace_id === p.workspace_id && foco.estado !== "encerrado" && (foco.mission_id ?? null) === null && (foco.cwd ?? null) === null && cliDeIa(foco.cli) ? foco.cli : null;
    return {
      workspace_id: p.workspace_id, branch: f.branch, upstream, remoto: c.remoto, repo: f.repo ?? "", commits: atras, a_frente: f.a_frente,
      arquivos_tocados: nomes.length, arquivos: nomes.slice(0, PRIMEIROS), mais: Math.max(0, nomes.length - PRIMEIROS), assuntos,
      conflita: arquivosEmConflito(c.rastreadas.map((m) => m.caminho), nomes).slice(0, PRIMEIROS),
      divergiu: f.a_frente > 0 && atras > 0, operacao_em_curso: f.operacao_em_curso, clis, cli_padrao: padrao, cli_foco: cliFoco,
    };
  }

  async function atualizar(p: { workspace_id: string }): Promise<ResultadoAtualizar> {
    const id = p.workspace_id;
    const res = (estado: ResultadoAtualizar["estado"], motivo: string | null, trouxe = 0, sugerir = false): ResultadoAtualizar => {
      auditar(id, { acao: "atualizar", estado, trouxe });
      return { estado, motivo, trouxe, sugerir_commitar: sugerir };
    };
    const x = await contextoDoPull(id);
    if (typeof x === "string") return res("recusado", x);
    const { c, atras } = x;
    const f = c.fatos;
    if (f.operacao_em_curso) return res("recusado", "Há um merge/rebase em andamento: conclua ou aborte antes.");
    if (atras === 0) return res("ja_atualizado", null);
    if (f.a_frente > 0) return res("divergiu", TEXTO_DIVERGIU);
    const nomes = await nomesDoUpstream(c.raiz);
    const conflita = arquivosEmConflito(c.rastreadas.map((m) => m.caminho), nomes);
    if (conflita.length > 0) {
      const lista = conflita.slice(0, 5).join(", ") + (conflita.length > 5 ? ` e mais ${conflita.length - 5}` : "");
      return res("recusado", `Você alterou localmente arquivos que o remoto também mudou (${lista}): faça o commit ou guarde com stash antes de atualizar.`, 0, true);
    }
    try {
      const r = (await deps.vcs.familia("vcs:remoto", { ...alvo(id), op: "pull", modo: "ff-only", remoto: null, ramo: null, simular: false } as AlvoVcs & { op: string })) as { resultado: string; antes: string | null; depois: string | null };
      cacheBase.clear();
      if (r.resultado === "ja-atualizado") return res("ja_atualizado", null);
      if (r.resultado !== "ok") return res("falhou", "O pull não terminou como esperado: confira o repositório.");
      let trouxe = atras;
      if (r.antes !== null && r.depois !== null && /^[0-9a-f]{7,64}$/.test(r.antes) && /^[0-9a-f]{7,64}$/.test(r.depois)) {
        const n = await git(c.raiz, ["rev-list", "--count", `${r.antes}..${r.depois}`], { tolerar: [128, 1] }).catch(() => null);
        if (n !== null && n.codigo === 0 && /^\d+$/.test(n.stdout.trim())) trouxe = Number(n.stdout.trim());
      }
      return res("ok", null, trouxe);
    } catch (e) {
      const k = classificarFalhaPull(sanearErro(e, [c.raiz]).message);
      if (k.tipo === "divergiu") return res("divergiu", k.texto);
      if (k.tipo === "arvore_suja") return res("recusado", k.texto, 0, true);
      return res("falhou", k.texto);
    }
  }

  async function pedirMerge(p: PedidoPedirMerge): Promise<ResultadoEnviarInstrucao> {
    const w = ws(p.workspace_id);
    const x = await contextoDoPull(p.workspace_id);
    if (typeof x === "string") return falha(x);
    const { c, upstream, atras } = x;
    const f = c.fatos;
    if (f.operacao_em_curso) return falha("Há um merge/rebase em andamento: conclua ou aborte antes.");
    if (f.branch === null || f.repo === null) return falha("Branch ou repositório indisponível.");
    const instrucao = montarInstrucaoMerge(await (deps.modeloMerge ?? (() => carregarModeloMerge()))(), { repo: f.repo, remoto: c.remoto, ramo: f.branch, upstream, a_frente: f.a_frente, atras, arquivos_do_upstream: await nomesDoUpstream(c.raiz) });
    if (!instrucao.ok) return falha(instrucao.motivo);
    const r = await entregarArquivo(w, "merge", instrucao.texto, p);
    auditar(p.workspace_id, { acao: "pedir_merge", estado: r.estado, entrega: r.entrega, cli: p.cli, modelo_versao: instrucao.versao, a_frente: f.a_frente, atras });
    return r;
  }

  // ---- Pastas da suíte: ignorar neste computador (D-692) --------------------------------------------------------------------------

  async function ignorarSuite(p: { workspace_id: string }): Promise<ResultadoIgnorarSuite> {
    const c = await coletar(p.workspace_id, false);
    if (!c.fatos.git) throw ERRO("Esta pasta não é um repositório git.");
    const linhas = linhasDeExclusao(c.suite);
    if (linhas.length === 0) return { estado: "nada", linhas: 0 };
    return saneado(c.raiz, async () => {
      // `--git-path` resolve o `info/exclude` certo também em worktree (diretório comum do git); a saída é relativa ao cwd ou absoluta
      const r = await git(c.raiz, ["rev-parse", "--git-path", "info/exclude"], { tolerar: [128, 1] });
      const saida = r.stdout.trim();
      if (r.codigo !== 0 || saida === "") throw ERRO("Não foi possível localizar o .git deste repositório.");
      const arquivo = resolve(c.raiz, saida);
      if (basename(arquivo) !== "exclude" || basename(dirname(arquivo)) !== "info") throw ERRO("Caminho inesperado para o exclude local do git.");
      const n = await gravarExclusoes(arquivo, linhas);
      auditar(p.workspace_id, { acao: "ignorar_suite", linhas: n, itens: c.suite.length });
      return { estado: n > 0 ? "ok" : "nada", linhas: n } as ResultadoIgnorarSuite;
    });
  }

  async function abrirUrl(p: { workspace_id: string; url: string }): Promise<boolean> {
    ws(p.workspace_id);
    if (!urlGithubSegura(p.url)) return false;
    await deps.abrirExterno(p.url);
    return true;
  }

  return { estado, preparar, enviar, abrirUrl, buscarRemoto, prepararAtualizar, atualizar, pedirMerge, ignorarSuite };
}

