// Missão ↔ trabalho (T-04.07; D-19 a D-22) e o disparo de comandos no Pane (T-04.06).
//  - criar Missão "feature" → worktree + Pane + `/expx:sprintx <pedido>`; "ocorrência" → `runx`; "pedido" →
//    `prodx-triar`; "projeto" → `buildx`;
//  - depois descobre o `trabalho_id` PELO DISCO (o que a skill gravou no worktree) e liga à Missão;
//  - trabalho criado fora do ADE aparece como "adotável";
//  - avaliadores (auditoria, QA, atenção do mergex) abrem Pane SEPARADO do implementador.
// O ADE só digita comandos e lê o disco: nunca escreve artefato do método (D-04).
import { relative, resolve } from "node:path";
import type { ComandoSugerido, GestoMetodo, PedidoDispararComando, ResultadoDisparo } from "../../compartilhado/dominio";
import type { FerramentaDetectada } from "../../compartilhado/terminais";
import type { Repositorios } from "../banco/repos";
import { gravarNaPastaDoProduto } from "../orquestracao/pasta";
import { PRODUTO } from "../produto";
import { ErroDominio, type Mission, type OrigemMissao, type Workspace } from "../dominio";
import { slugificar } from "../git";
import type { ComandoInicialEntrada, ServicoMissoes } from "../missoes/servico";
import { PaneNaoAceitaComandoErro, type ServicoPanes } from "../missoes/panes";
import { avaliarPaneDestino, comandoSugerido, gestoExigeAvaliador, harnessDaCli, type TrabalhoParaComando } from "./comandos";
import { bloquearComandoDeModuloDesligado } from "../suite/modulos";
import { CATALOGO_TERMINAIS } from "../terminais/catalogo";
import { lerLockDoProjeto } from "./instalacao";
import type { IndiceProjeto, Trabalho } from "./tipos";

export class TrabalhoNaoAdotavelErro extends ErroDominio {
  override name = "TrabalhoNaoAdotavelErro";
  constructor(readonly trabalhoId: string) {
    super(`O trabalho ${trabalhoId} não pode ser adotado (não existe, já terminou ou já tem Missão).`);
  }
}

/** Índices por raiz ABSOLUTA de worktree (saída de `git worktree list`; sem git, só a raiz do workspace). */
export type IndicesPorRaiz = ReadonlyMap<string, IndiceProjeto>;

// ---------------------------------------------------------------- origem → comando

const GESTO_DA_ORIGEM: Readonly<Record<OrigemMissao, GestoMetodo | null>> = {
  feature: "nova_feature",
  ocorrencia: "nova_ocorrencia",
  pedido: "pedido_cru",
  projeto: "projeto",
  livre: null,
};

export const gestoInicialDaOrigem = (origem: OrigemMissao): GestoMetodo | null => GESTO_DA_ORIGEM[origem];

/** Comando do primeiro Pane de uma Missão nova; `null` quando não há pedido, a origem é livre ou a CLI não suporta. */
export function comandoInicialDaMissao(e: ComandoInicialEntrada): string | null {
  const gesto = gestoInicialDaOrigem(e.origem);
  if (gesto === null) return null;
  const r = comandoSugerido(gesto, null, e.cli, e.pedido);
  return r.comando === "" ? null : r.comando;
}

// ---------------------------------------------------------------- descoberta pelo disco

const TIPOS_DA_ORIGEM: Partial<Record<OrigemMissao, Trabalho["tipo"]>> = { feature: "feature", ocorrencia: "ocorrencia" };
const nomeDaPasta = (caminho: string): string => caminho.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";

type TrabalhoBasico = Pick<Trabalho, "id" | "tipo" | "status" | "worktree" | "ultima_atividade">;
const trabalhosDe = (i: IndiceProjeto | undefined): TrabalhoBasico[] => (i?.trabalhos ?? []) as TrabalhoBasico[];

/**
 * Qual trabalho do disco é desta Missão? Só considera trabalhos NOVOS na árvore da Missão (ausentes da
 * árvore principal: o worktree traz cópia do que já estava commitado) e ainda sem Missão. Em empate sem
 * pista de nome devolve `null`: ligar o trabalho errado é pior que esperar o próximo ciclo.
 */
export function descobrirTrabalhoDaMissao(
  missao: Pick<Mission, "origem" | "titulo" | "worktree" | "branch" | "trabalho_id">,
  ws: Pick<Workspace, "raiz">,
  indices: IndicesPorRaiz,
  jaLigados: ReadonlySet<string>,
): string | null {
  if (missao.trabalho_id !== null) return null;
  const tipo = TIPOS_DA_ORIGEM[missao.origem];
  if (tipo === undefined) return null;
  const raiz = missao.worktree === null ? ws.raiz : resolve(ws.raiz, missao.worktree);
  const principais = new Set(trabalhosDe(indices.get(ws.raiz)).map((t) => t.id));
  const candidatos = trabalhosDe(indices.get(raiz)).filter((t) => t.tipo === tipo && !jaLigados.has(t.id) && (raiz === ws.raiz || !principais.has(t.id)));
  if (candidatos.length === 0) return null;
  const slug = slugificar(missao.titulo);
  const sufixoBranch = missao.branch?.split("/").slice(1).join("/") ?? null;
  const pasta = missao.worktree === null ? null : nomeDaPasta(missao.worktree);
  const escolhe = (pred: (t: TrabalhoBasico) => boolean): TrabalhoBasico[] => candidatos.filter(pred);
  for (const pred of [
    (t: TrabalhoBasico) => sufixoBranch !== null && t.id === sufixoBranch,
    (t: TrabalhoBasico) => t.id === slug || t.id.endsWith(`-${slug}`),
    (t: TrabalhoBasico) => pasta !== null && t.worktree !== null && nomeDaPasta(t.worktree) === pasta,
  ]) {
    const achados = escolhe(pred);
    if (achados.length === 1) return (achados[0] as TrabalhoBasico).id;
  }
  // sem pista de nome: só se for o ÚNICO novo na árvore da Missão e ela tem worktree próprio
  return candidatos.length === 1 && raiz !== ws.raiz ? (candidatos[0] as TrabalhoBasico).id : null;
}

export interface Adotavel {
  trabalho_id: string;
  tipo: Trabalho["tipo"];
  titulo: string;
  estagio: string;
  /** relativo à raiz do workspace (`../repo--slug`); `null` se vive na árvore principal. */
  worktree: string | null;
}

/** Trabalhos de feature/ocorrência ainda abertos e sem Missão (criados fora do ADE). */
export function listarAdotaveis(indices: IndicesPorRaiz, wsRaiz: string, jaLigados: ReadonlySet<string>): Adotavel[] {
  const vistos = new Map<string, { t: Trabalho; raiz: string }>();
  // a árvore principal por último: o que está num worktree é a versão viva
  const raizes = [...indices.keys()].sort((a, b) => Number(a === wsRaiz) - Number(b === wsRaiz));
  for (const raiz of raizes) {
    for (const t of indices.get(raiz)?.trabalhos ?? []) {
      if ((t.tipo !== "feature" && t.tipo !== "ocorrencia") || t.status === "concluido" || jaLigados.has(t.id)) continue;
      const anterior = vistos.get(t.id);
      if (anterior === undefined || (t.ultima_atividade ?? "") >= (anterior.t.ultima_atividade ?? "")) vistos.set(t.id, { t, raiz });
    }
  }
  return [...vistos.values()].map(({ t, raiz }) => ({
    trabalho_id: t.id, tipo: t.tipo, titulo: t.titulo, estagio: t.estagio,
    worktree: raiz === wsRaiz ? null : relative(wsRaiz, raiz).replaceAll("\\", "/"),
  }));
}

/** Acha o trabalho nos índices (qualquer worktree); com duplicata vence a atividade mais recente. */
export function acharTrabalho(indices: IndicesPorRaiz, wsRaiz: string, id: string): { trabalho: Trabalho; raiz: string } | null {
  let melhor: { trabalho: Trabalho; raiz: string } | null = null;
  for (const [raiz, indice] of indices) {
    const t = indice.trabalhos.find((x) => x.id === id);
    if (t === undefined) continue;
    if (melhor === null || (t.ultima_atividade ?? "") > (melhor.trabalho.ultima_atividade ?? "") || ((t.ultima_atividade ?? "") === (melhor.trabalho.ultima_atividade ?? "") && raiz === wsRaiz)) {
      melhor = { trabalho: t, raiz };
    }
  }
  return melhor;
}

const paraComando = (t: Trabalho): TrabalhoParaComando => ({ id: t.id, tipo: t.tipo, raio: t.raio, prodx: t.prodx === null ? null : { veredito: t.prodx.veredito, assinado: t.prodx.assinado } });

// ---------------------------------------------------------------- serviço

export interface DependenciasMetodoMissao {
  repos: Pick<Repositorios, "mission" | "pane">;
  workspaces: { exigir(id: string): Workspace };
  missoes: Pick<ServicoMissoes, "criar" | "definirTrabalho">;
  panes: Pick<ServicoPanes, "abrirPane" | "enviarComando">;
  detector: { detectar(): Promise<FerramentaDetectada[]> };
  /** Índices do método por raiz absoluta (o main mantém; teste injeta). */
  indices: (workspaceId: string) => Promise<IndicesPorRaiz>;
  /**
   * Fase 15: contexto prévio do RAG para o texto do gesto ("" = nada). Opcional: sem a porta (RAG desligado/fora) o disparo é o de antes.
   * O disparo espera no máximo `ESPERA_CONTEXTO_MS`; falha, lentidão ou vazio nunca bloqueiam.
   */
  contextoPrevio?: (workspaceId: string, texto: string, arquivos: string[]) => Promise<string>;
  /**
   * Módulos da suíte desligados no workspace (D-480): comando de módulo desligado sai vazio com o motivo "ligue em Método › Módulos da suíte". Opcional: sem a porta, nada muda.
   * SÍNCRONO e barato (um arquivo pequeno).
   */
  modulosDesligados?: (workspaceId: string) => ReadonlySet<string>;
  /**
   * D-620: depois de abrir o Pane, espera até este tempo (ms) para ver se a CLI morreu na largada (não instalada, sem login, cwd inválido) e então devolve `falhou` com a causa
   * em vez de "enviado". Padrão 0 (sem espera; teste injeta). O main passa `ESPERA_CONFIRMACAO_ENTREGA_MS`.
   */
  confirmarEntregaMs?: number;
}

/** Janela em que o disparo observa a CLI recém-aberta antes de afirmar "entregue" (curta: a UI espera esta resposta). */
export const ESPERA_CONFIRMACAO_ENTREGA_MS = 700;
const PASSO_CONFIRMACAO_MS = 40;

/** Teto de espera do contexto prévio no disparo (mesmo orçamento do despachante do Maestro). */
export const ESPERA_CONTEXTO_MS = 150;
/** Gestos cujo argumento é texto livre do pedido (os demais levam um id de trabalho e não ganham contexto). */
const GESTOS_COM_CONTEXTO: readonly GestoMetodo[] = ["nova_feature", "nova_ocorrencia", "pedido_cru", "projeto"];

export interface PedidoComandoSugerido {
  workspace_id: string;
  trabalho_id: string | null;
  gesto: GestoMetodo;
  argumento: string | null;
}

export interface LigacaoFeita {
  mission_id: string;
  trabalho_id: string;
}

export interface ServicoMetodoMissao {
  /** Liga às Missões sem trabalho o que as skills já gravaram no disco. Idempotente. */
  sincronizarLigacoes(workspaceId: string): Promise<LigacaoFeita[]>;
  adotaveis(workspaceId: string): Promise<Adotavel[]>;
  adotar(workspaceId: string, trabalhoId: string): Promise<Mission>;
  comandoSugeridoPara(p: PedidoComandoSugerido): Promise<ComandoSugerido>;
  disparar(p: PedidoDispararComando): Promise<ResultadoDisparo>;
}

const ATIVAS = ["intake", "planejando", "executando", "revisando"] as const;

export function criarServicoMetodoMissao(deps: DependenciasMetodoMissao): ServicoMetodoMissao {
  const { repos } = deps;
  const SEM_DESLIGADOS: ReadonlySet<string> = new Set();
  const desligadosDe = (workspaceId: string): ReadonlySet<string> => {
    try { return deps.modulosDesligados?.(workspaceId) ?? SEM_DESLIGADOS; } catch { return SEM_DESLIGADOS; }
  };

  const missoesDoWorkspace = (workspaceId: string): Mission[] => {
    const todas: Mission[] = [];
    let depois: string | null = null;
    do {
      const pagina = repos.mission.listarPorWorkspace(workspaceId, { limite: 200, depois });
      todas.push(...pagina.itens);
      depois = pagina.proximo;
    } while (depois !== null && todas.length < 5_000);
    return todas;
  };
  const ligados = (missoes: Mission[]): Set<string> => new Set(missoes.flatMap((m) => (m.trabalho_id === null ? [] : [m.trabalho_id])));

  /** CLI padrão para Panes novos: a primeira do lock que esteja instalada; senão claude, senão opencode. */
  async function cliPadrao(ws: Workspace): Promise<string | null> {
    const [ferramentas, { lock }] = await Promise.all([deps.detector.detectar(), lerLockDoProjeto(ws.raiz)]);
    const instalada = (id: string): boolean => ferramentas.some((f) => f.id === id && f.instalado && f.executavel_id !== null);
    const ordem = [...lock.harness.filter((h) => harnessDaCli(h) !== null), "claude", "opencode"];
    return ordem.find(instalada) ?? null;
  }

  /** Grava o contexto do RAG na pasta do produto (`contexto/`) e devolve o argumento apontando para o arquivo (uma linha só); sem contexto, o argumento original. */
  async function argumentoComContexto(ws: Workspace, gesto: GestoMetodo, argumento: string | null): Promise<string | null> {
    const texto = (argumento ?? "").trim();
    if (deps.contextoPrevio === undefined || texto === "" || !GESTOS_COM_CONTEXTO.includes(gesto)) return argumento;
    let relogio: NodeJS.Timeout | undefined;
    try {
      const limite = new Promise<string>((ok) => {
        relogio = setTimeout(() => ok(""), ESPERA_CONTEXTO_MS);
        relogio.unref?.();
      });
      const md = await Promise.race([deps.contextoPrevio(ws.id, texto, []), limite]);
      if (typeof md !== "string" || md.trim() === "") return argumento;
      const rel = `${PRODUTO.pastaNoProjeto}/contexto/${Date.now().toString(36)}-${gesto}.md`;
      await gravarNaPastaDoProduto(ws.raiz, rel, md);
      return `${texto} — Contexto prévio: ${rel}`;
    } catch {
      return argumento;
    } finally {
      if (relogio !== undefined) clearTimeout(relogio);
    }
  }

  /** Observa o Pane recém-aberto por até `confirmarEntregaMs`: devolve o motivo (ou "") se a CLI já encerrou, `null` se segue viva. */
  async function cliSaiuNaLargada(paneId: string): Promise<string | null> {
    const limite = Date.now() + (deps.confirmarEntregaMs ?? 0);
    for (;;) {
      const pane = repos.pane.obter(paneId);
      if (pane === undefined || pane.estado === "encerrado") return pane?.encerrado_motivo == null || pane.encerrado_motivo === "processo_encerrado" ? "" : pane.encerrado_motivo;
      if (Date.now() >= limite) return null;
      await new Promise<void>((ok) => setTimeout(ok, PASSO_CONFIRMACAO_MS));
    }
  }

  const recusa = (motivo: string | null): ResultadoDisparo => ({ ok: false, pane_id: null, comando: null, motivo, estado: "falhou", entrega: null });

  return {
    async sincronizarLigacoes(workspaceId) {
      const ws = deps.workspaces.exigir(workspaceId);
      const missoes = missoesDoWorkspace(workspaceId);
      const pendentes = missoes.filter((m) => m.trabalho_id === null && (ATIVAS as readonly string[]).includes(m.estado) && TIPOS_DA_ORIGEM[m.origem] !== undefined);
      if (pendentes.length === 0) return [];
      const indices = await deps.indices(workspaceId);
      const jaLigados = ligados(missoes);
      const feitas: LigacaoFeita[] = [];
      for (const m of pendentes) {
        const id = descobrirTrabalhoDaMissao(m, ws, indices, jaLigados);
        if (id === null) continue;
        try {
          await deps.missoes.definirTrabalho(m.id, id);
          jaLigados.add(id);
          feitas.push({ mission_id: m.id, trabalho_id: id });
        } catch {
          // ligado a outra Missão no meio do caminho ou Missão sumiu: tenta no próximo ciclo
        }
      }
      return feitas;
    },

    async adotaveis(workspaceId) {
      const ws = deps.workspaces.exigir(workspaceId);
      return listarAdotaveis(await deps.indices(workspaceId), ws.raiz, ligados(missoesDoWorkspace(workspaceId)));
    },

    async adotar(workspaceId, trabalhoId) {
      const ws = deps.workspaces.exigir(workspaceId);
      const item = (await this.adotaveis(workspaceId)).find((a) => a.trabalho_id === trabalhoId);
      if (item === undefined) throw new TrabalhoNaoAdotavelErro(trabalhoId);
      return deps.missoes.criar(
        { workspace_id: ws.id, modo: "livre", origem: item.tipo === "ocorrencia" ? "ocorrencia" : "feature", titulo: item.titulo.slice(0, 120) || trabalhoId, pedido: "", clis: {} },
        { trabalho_id: trabalhoId, ...(item.worktree === null ? { sem_worktree: true } : { worktree_existente: { worktree: item.worktree, branch: null } }) },
      );
    },

    async comandoSugeridoPara(p) {
      const ws = deps.workspaces.exigir(p.workspace_id);
      const indices = p.trabalho_id === null ? new Map<string, IndiceProjeto>() : await deps.indices(p.workspace_id);
      const achado = p.trabalho_id === null ? null : acharTrabalho(indices, ws.raiz, p.trabalho_id);
      if (p.trabalho_id !== null && achado === null) {
        return { comando: "", pane_separado: gestoExigeAvaliador(p.gesto), somente_humano: false, motivo_bloqueio: "Trabalho não encontrado neste workspace." };
      }
      const { lock } = await lerLockDoProjeto(ws.raiz);
      const harness = lock.harness.includes("claude") || !lock.harness.includes("opencode") ? "claude" : "opencode";
      return bloquearComandoDeModuloDesligado(comandoSugerido(p.gesto, achado === null ? null : paraComando(achado.trabalho), harness, p.argumento), desligadosDe(ws.id));
    },

    async disparar(p) {
      const ws = deps.workspaces.exigir(p.workspace_id);
      const indices = p.trabalho_id === null ? new Map<string, IndiceProjeto>() : await deps.indices(p.workspace_id);
      const achado = p.trabalho_id === null ? null : acharTrabalho(indices, ws.raiz, p.trabalho_id);
      if (p.trabalho_id !== null && achado === null) return recusa("Trabalho não encontrado neste workspace.");

      const paneAlvo = p.pane_id === null ? undefined : repos.pane.obter(p.pane_id);
      if (p.pane_id !== null && (paneAlvo === undefined || paneAlvo.workspace_id !== ws.id)) return recusa("Pane não encontrado neste workspace.");

      const cli = paneAlvo === undefined ? await cliPadrao(ws) : paneAlvo.cli;
      if (cli === null) return recusa("Nenhuma CLI compatível com os comandos do método está instalada: instale o Claude Code ou OpenCode.");

      const desligados = desligadosDe(ws.id);
      const sugestaoBase = bloquearComandoDeModuloDesligado(comandoSugerido(p.gesto, achado === null ? null : paraComando(achado.trabalho), cli, p.argumento), desligados);
      if (sugestaoBase.comando === "") return recusa(sugestaoBase.motivo_bloqueio);
      // Fase 15: contexto prévio do RAG anexado ao argumento (só se o comando com ele continuar válido; senão, o original)
      const comContexto = await argumentoComContexto(ws, p.gesto, p.argumento);
      const reforcado = comContexto === p.argumento ? sugestaoBase : bloquearComandoDeModuloDesligado(comandoSugerido(p.gesto, achado === null ? null : paraComando(achado.trabalho), cli, comContexto), desligados);
      const sugestao = reforcado.comando === "" ? sugestaoBase : reforcado;

      try {
        if (paneAlvo !== undefined) {
          const aval = avaliarPaneDestino(p.gesto, paneAlvo);
          if (!aval.ok) return recusa(aval.motivo);
          await deps.panes.enviarComando(paneAlvo.id, sugestao.comando);
          return { ok: true, pane_id: paneAlvo.id, comando: sugestao.comando, motivo: null, sessao_id: paneAlvo.sessao_pty_id ?? null, estado: "entregue", entrega: "escrita" };
        }
        const missao = achado === null ? undefined : missoesDoWorkspace(ws.id).find((m) => m.trabalho_id === achado.trabalho.id && (ATIVAS as readonly string[]).includes(m.estado));
        // cwd = worktree do trabalho; só precisa forçar quando a Missão não conhece o worktree que a skill criou
        const cwd = achado !== null && achado.raiz !== ws.raiz && (missao === undefined || missao.worktree === null) ? achado.raiz : undefined;
        const aberto = await deps.panes.abrirPane({
          ...(missao === undefined ? { workspace_id: ws.id } : { missao_id: missao.id }),
          cli,
          papel: sugestao.pane_separado ? "revisor" : missao === undefined ? "nenhum" : "executor",
          prompt_inicial: sugestao.comando,
          ...(cwd === undefined ? {} : { cwd }),
        });
        const saiu = await cliSaiuNaLargada(aberto.pane.id);
        if (saiu !== null) {
          return { ok: false, pane_id: aberto.pane.id, comando: sugestao.comando, motivo: `A CLI ${(CATALOGO_TERMINAIS.find((f) => f.id === cli)?.nome ?? cli)} saiu antes de receber o comando${saiu === "" ? "" : ` (${saiu})`}. Confirme que ela está instalada e autenticada: abra o terminal deste workspace, rode a CLI uma vez e tente de novo.`, sessao_id: aberto.sessao_id, estado: "falhou", entrega: null };
        }
        return { ok: true, pane_id: aberto.pane.id, comando: sugestao.comando, motivo: null, sessao_id: aberto.sessao_id, estado: "entregue", entrega: "prompt_inicial" };
      } catch (erro) {
        if (erro instanceof PaneNaoAceitaComandoErro || erro instanceof ErroDominio) return recusa(erro.message);
        throw erro;
      }
    },
  };
}
