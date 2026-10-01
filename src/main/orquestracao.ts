/**
 * Orquestração do main (fase 3): implementa as PORTAS do MCP (`nucleo/mcp/portas.ts`) sobre os serviços
 * de domínio reais e costura hooks, wake, handoff e lançamento do piloto/workers.
 *
 * LEVEZA (P-01, P-12):
 *  - `criarOrquestracao` só guarda referências e liga o preparador de lançamento nos Panes; nada abre
 *    socket, thread, timer ou arquivo. Quem o carrega é a onda 2 do boot.
 *  - `iniciar()` (onda 2) sobe o servidor MCP numa WORKER THREAD (o SDK custa ~200 ms de carga e não pode
 *    parar o event loop do main), assina os eventos das sessões e liga o relógio de segurança.
 *  - Leitor de tela (@xterm/headless), fila de wake e hooks só trabalham para Panes orquestrados.
 */
import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { EventoTerminal } from "../compartilhado/terminais";
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import type { EstadoPane, Mission, ModoMissao, Pane, Papel, Task, Workspace } from "../nucleo/dominio";
import { argumentoInvalido, naoAutorizado, naoEncontrado, violacaoDeRegra } from "../nucleo/mcp/erros";
import {
  PORTOES,
  relogioReal,
  type AgenteDoSquad,
  type MissaoInfo,
  type PaneInfo,
  type PedidoSpawn,
  type PortaGanchos,
  type PortaMissoes,
  type PortaPanes,
  type PortaProvedores,
  type PortaRelogio,
  type Portao,
  type ProvedorInfo,
} from "../nucleo/mcp/portas";
import { TTL_PADRAO_MS, type PedidoToken } from "../nucleo/mcp/tokens";
import type { ServicoPanes, EntradaPreparoDePane, PreparoDaSessao } from "../nucleo/missoes/panes";
import type { ServicoMissoes } from "../nucleo/missoes/servico";
import type { ServicoProvedores } from "../nucleo/provedores/servico";
import { modelosDaFerramenta } from "../nucleo/terminais/catalogo";
import type { ServicoWorkspaces } from "../nucleo/workspaces/servico";
import { criarGanchosClaude, type ContextoPane } from "../nucleo/orquestracao/hooks/claude";
import { criarVigiaFallback } from "../nucleo/orquestracao/hooks/fallback";
import { criarServicoHandoff, type PersistenciaHandoff } from "../nucleo/orquestracao/handoff";
import { resolverDentroReal } from "../nucleo/orquestracao/pasta";
import {
  gravarArquivosDoComando,
  montarComandoPiloto,
  montarComandoWorker,
  prepararRespawnPiloto,
  type ArquivoDoComando,
  type ComandoPane,
  type EntradaComando,
} from "../nucleo/orquestracao/piloto";
import { MAX_PANES_PARALELOS } from "../nucleo/orquestracao/regras";
import { gravarPortao, lerPortoes } from "../nucleo/orquestracao/portoes";
import { criarFilaWake, type ItemWake } from "../nucleo/orquestracao/wake";
import { PRODUTO } from "../nucleo/produto";
import type { Barramento } from "./barramento";
import { criarLeitorDeTela, type LeitorDeTela } from "./leitor-tela";
import { iniciarServidorRemoto, type DepsDoServidorRemoto, type ServidorRemoto } from "./mcp-remoto";

/** O que a orquestração usa do gerenciador de sessões da janela. */
export interface SessoesDaOrquestracao {
  escrever(id: string, dados: string): boolean;
  assinar(fn: (evento: EventoTerminal) => void): () => void;
  observarTamanho?(fn: (id: string, colunas: number, linhas: number) => void): () => void;
}

export interface DominioDaOrquestracao {
  repos: Repositorios;
  workspaces: Pick<ServicoWorkspaces, "exigir">;
  provedores: Pick<ServicoProvedores, "providerList">;
  missoes: Pick<ServicoMissoes, "encerrar" | "transicionar">;
  panes: Pick<ServicoPanes, "abrirPane" | "encerrarPane" | "ligar" | "definirPreparador">;
}

export interface AtivosDaOrquestracao {
  /** pasta de `piloto.md`, `worker.md`, `revisor.md` e `intake.md` */
  pastaDePrompts: string;
  /** caminho absoluto de `gancho.mjs` (fora do asar no pacote) */
  scriptGancho: string;
  /** caminho absoluto de `mcp-worker.js` (fora do asar no pacote) */
  caminhoWorker: string;
}

export interface DepsOrquestracao {
  dominio: DominioDaOrquestracao;
  banco: Banco;
  barramento: Pick<Barramento, "emitir" | "emitirCoalescido"> & Partial<Pick<Barramento, "assinar">>;
  sessoes: () => Promise<SessoesDaOrquestracao>;
  /** userData: settings, config MCP e instruções por Pane ficam em `<dirApp>/panes/<pane_id>/` */
  dirApp: string;
  /** executável que roda `gancho.mjs` (process.execPath) e se ele é o Electron (precisa de ELECTRON_RUN_AS_NODE) */
  executavelNode: string;
  electronComoNode: boolean;
  ativos: AtivosDaOrquestracao;
  avisar?: (mensagem: string) => void;
  maxPanesParalelos?: number;
  relogio?: PortaRelogio;
  /** segurança: reavalia wake e lembretes de handoff com esta cadência (padrão 3 s) */
  intervaloSegurancaMs?: number;
  atrasoFechamentoMs?: number;
  // ---- injeções de teste
  iniciarServidor?: (deps: DepsDoServidorRemoto, ganchos: PortaGanchos) => Promise<ServidorRemoto>;
  leitor?: LeitorDeTela;
}

export interface Orquestracao {
  /** Onda 2: sobe o servidor MCP, assina as sessões e liga o relógio de segurança. Idempotente. */
  iniciar(): Promise<void>;
  /** Fecha servidor, fila, vigia, leitores e revoga os tokens. Idempotente. */
  encerrar(): Promise<void>;
  /** Libera um portão de intake da Missão (o usuário decide; a UI chama isto quando o canal existir). */
  liberarPortao(mission_id: string, portao: Portao): void;
  /** Define os agentes do squad da Missão (`null` = sem restrição). */
  definirSquad(mission_id: string, agentes: readonly AgenteDoSquad[] | null): void;
  readonly portas: { panes: PortaPanes; missoes: PortaMissoes; provedores: PortaProvedores };
  readonly persistencia: PersistenciaHandoff;
  readonly fila: ReturnType<typeof criarFilaWake>;
  /** Só para teste e diagnóstico. */
  servidor(): ServidorRemoto | null;
}

const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const ARGUMENTO_SEGURO_BYTES = 3_000;
const OBJETIVO_MAX = 2_000;
const CHAVE_SQUAD = (id: string): string => `orquestracao.squad.${id}`;
const AVANCO_DA_MISSAO = ["planejando", "executando"] as const;

const espera = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

export function criarOrquestracao(deps: DepsOrquestracao): Orquestracao {
  const { dominio, banco, barramento, dirApp } = deps;
  const { repos } = dominio;
  const avisar = (m: string): void => deps.avisar?.(m);
  const relogio = deps.relogio ?? relogioReal;
  const maximo = deps.maxPanesParalelos ?? MAX_PANES_PARALELOS;
  const leitor = deps.leitor ?? criarLeitorDeTela();

  let servidor: ServidorRemoto | null = null;
  let servidorPromessa: Promise<ServidorRemoto> | null = null;
  let iniciado = false;
  let encerrado = false;
  let relogioDeSeguranca: NodeJS.Timeout | null = null;
  const desligar: Array<() => void> = [];
  /** Panes que esta orquestração lançou/acompanha (token, leitor de tela, vigia). */
  const orquestrados = new Set<string>();
  const sessaoParaPane = new Map<string, string | null>();
  const ultimoEstado = new Map<string, EstadoPane>();

  // ---------------------------------------------------------------- leitura de dados
  const raizDe = (ws: Workspace, missao: Mission | undefined): string => (missao?.worktree != null ? resolve(ws.raiz, missao.worktree) : ws.raiz);

  async function raiz(workspace_id: string, mission_id: string | null): Promise<string> {
    const ws = dominio.workspaces.exigir(workspace_id);
    const missao = mission_id === null ? undefined : repos.mission.obter(mission_id);
    return raizDe(ws, missao);
  }

  const taskDoPane = (pane_id: string): Task | undefined =>
    banco.consultarUm<Task>("SELECT * FROM task WHERE pane_id = ? ORDER BY id DESC LIMIT 1", [pane_id]);

  function paneInfo(p: Pane): PaneInfo {
    return {
      pane_id: p.id,
      workspace_id: p.workspace_id,
      mission_id: p.mission_id,
      provedor: p.cli ?? "terminal",
      papel: p.papel,
      estado: p.estado,
      task_id: taskDoPane(p.id)?.id ?? null,
      eh_piloto: p.eh_piloto,
    };
  }

  const portoesDe = (mission_id: string): Portao[] => lerPortoes(repos.config, mission_id);

  function squadDe(mission_id: string): AgenteDoSquad[] | null {
    const v = repos.config.obter<unknown>(CHAVE_SQUAD(mission_id));
    if (!Array.isArray(v)) return null;
    return v.filter((a): a is AgenteDoSquad => typeof a === "object" && a !== null && typeof (a as AgenteDoSquad).agente_id === "string" && typeof (a as AgenteDoSquad).papel === "string");
  }

  function missaoInfo(m: Mission): MissaoInfo {
    return {
      mission_id: m.id,
      workspace_id: m.workspace_id,
      modo: m.modo,
      estado: m.estado,
      titulo: m.titulo,
      piloto_pane_id: m.piloto_pane_id,
      portoes_liberados: portoesDe(m.id),
      agentes_do_squad: squadDe(m.id),
    };
  }

  // ---------------------------------------------------------------- envio ao Pane
  async function enviarAoPane(pane_id: string, texto: string, submeter: boolean): Promise<boolean> {
    const pane = repos.pane.obter(pane_id);
    if (pane === undefined || pane.estado === "encerrado" || pane.sessao_pty_id === null) return false;
    // sem controles (ESC, Ctrl+C…): o texto de um Pane nunca vira comando de terminal para outro
    const limpo = texto.replace(/\r\n?/g, "\n").replace(CONTROLE, "");
    if (limpo === "") return false;
    try {
      const g = await deps.sessoes();
      if (limpo.includes("\n")) {
        // várias linhas entram como colagem (bracketed paste) e o Enter vai depois
        if (!g.escrever(pane.sessao_pty_id, `\u001b[200~${limpo}\u001b[201~`)) return false;
        if (submeter) {
          await espera(80);
          return g.escrever(pane.sessao_pty_id, "\r");
        }
        return true;
      }
      return g.escrever(pane.sessao_pty_id, submeter ? `${limpo}\r` : limpo);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- wake, vigia e handoff
  const fila = criarFilaWake({
    enviar: (pane_id, texto) => enviarAoPane(pane_id, texto, true),
    estado: (pane_id) => repos.pane.obter(pane_id)?.estado ?? null,
    emitir: (tipo, payload) => barramento.emitir(tipo, payload),
    aoEntregar: (itens) => {
      for (const i of itens) banco.executar("DELETE FROM wake_pendente WHERE handoff_id = ?", [i.handoff_id]);
    },
  });

  const vigia = criarVigiaFallback({
    relogio,
    handoffRegistrado: async (pane_id) => (await persistencia.doPane(pane_id)) !== null,
    enviarLembrete: (pane_id, texto) => enviarAoPane(pane_id, texto, true),
    emitir: (tipo, payload) => barramento.emitir(tipo, payload),
  });

  const persistencia: PersistenciaHandoff = {
    async gravar(d) {
      return banco.transacao(() => {
        const task = repos.task.obter(d.task_id);
        if (task === undefined) throw naoEncontrado(`Card não encontrado: ${d.task_id}.`);
        if (d.mission_id === null || task.mission_id !== d.mission_id) throw naoAutorizado("O card não pertence à Missão deste token.");
        if (task.pane_id !== null && task.pane_id !== d.de_pane_id) throw naoAutorizado("O card pertence a outro Pane.");
        const missao = repos.mission.obter(task.mission_id);
        const hof = repos.handoff.criar({
          task_id: task.id,
          de_pane_id: d.de_pane_id,
          para_pane_id: missao?.piloto_pane_id ?? null,
          resumo: d.resumo,
          relatorio_path: d.relatorio_path,
          status: d.status,
        });
        if ((d.status === "ok" || d.status === "parcial") && (task.estado === "aberta" || task.estado === "reivindicada")) {
          repos.task.mudarEstado(task.id, "entregue", { pane_id: d.de_pane_id });
        }
        // AUD-05: o aviso ao piloto nasce na MESMA transação do handoff; só sai da tabela depois de entregue
        if (hof.para_pane_id !== null) {
          banco.executar(
            "INSERT INTO wake_pendente (handoff_id,destino_pane_id,origem_pane_id,task_ref,status,resumo,relatorio_path,criado_em) VALUES (?,?,?,?,?,?,?,?)",
            [hof.id, hof.para_pane_id, d.de_pane_id, task.task_ref, d.status, d.resumo, d.relatorio_path, new Date().toISOString()],
          );
        }
        barramento.emitirCoalescido("missoes:mudou", task.mission_id, { workspace_id: d.workspace_id, mission_id: task.mission_id }, 50);
        return { handoff_id: hof.id, para_pane_id: hof.para_pane_id, task_ref: task.task_ref };
      });
    },
    async doPane(pane_id) {
      const h = banco.consultarUm<{ id: string; relatorio_path: string | null; status: string }>(
        "SELECT id, relatorio_path, status FROM handoff WHERE de_pane_id = ? ORDER BY id DESC LIMIT 1",
        [pane_id],
      );
      return h === undefined ? null : { handoff_id: h.id, relatorio_path: h.relatorio_path, status: h.status as never };
    },
    async temRevisorOk(mission_id) {
      return (
        banco.consultarUm(
          "SELECT 1 AS x FROM handoff h JOIN task t ON t.id = h.task_id JOIN pane p ON p.id = h.de_pane_id WHERE t.mission_id = ? AND h.status = 'ok' AND p.papel = 'revisor' LIMIT 1",
          [mission_id],
        ) !== undefined
      );
    },
  };

  async function fecharPane(pane_id: string, motivo: string): Promise<boolean> {
    const pane = repos.pane.obter(pane_id);
    if (pane === undefined || pane.estado === "encerrado") return false;
    limparPane(pane_id);
    await dominio.panes.encerrarPane(pane_id, motivo);
    return true;
  }

  function limparPane(pane_id: string): void {
    servidor?.revogar(pane_id);
    fila.descartar(pane_id);
    try { banco.executar("DELETE FROM wake_pendente WHERE destino_pane_id = ?", [pane_id]); } catch { /* o Pane acabou: nada a acordar */ }
    vigia.parar(pane_id);
    orquestrados.delete(pane_id);
    ultimoEstado.delete(pane_id);
    const sessao = repos.pane.obter(pane_id)?.sessao_pty_id;
    if (sessao !== null && sessao !== undefined) {
      leitor.liberar(sessao);
      sessaoParaPane.delete(sessao);
    }
  }

  const servicoHandoff = criarServicoHandoff({
    raiz,
    persistencia,
    fila,
    fecharPane: (pane_id, motivo) => fecharPane(pane_id, motivo),
    ...(deps.atrasoFechamentoMs === undefined ? {} : { atrasoFechamentoMs: deps.atrasoFechamentoMs }),
    emitir: (tipo, payload) => barramento.emitir(tipo, payload),
  });

  const ganchos = criarGanchosClaude({
    handoff: servicoHandoff,
    fila,
    raiz,
    pastaDePrompts: deps.ativos.pastaDePrompts,
    emitir: (tipo, payload) => barramento.emitir(tipo, payload),
    async contexto(pane_id): Promise<ContextoPane | null> {
      const pane = repos.pane.obter(pane_id);
      if (pane === undefined || pane.mission_id === null) return null;
      const task = taskDoPane(pane_id);
      return {
        workspace_id: pane.workspace_id,
        mission_id: pane.mission_id,
        papel: pane.papel,
        task_id: task?.id ?? null,
        task_ref: task?.task_ref ?? null,
        briefing_path: task?.briefing_path ?? null,
      };
    },
  });

  // ---------------------------------------------------------------- servidor MCP (worker thread)
  function depsDoServidor(portas: Orquestracao["portas"]): DepsDoServidorRemoto {
    return {
      panes: portas.panes,
      missoes: portas.missoes,
      provedores: portas.provedores,
      handoff: servicoHandoff,
      raiz,
      maxPanesParalelos: maximo,
      avisar: (m) => barramento.emitir("orquestracao.aviso", { mensagem: m }),
    };
  }

  function garantirServidor(): Promise<ServidorRemoto> {
    servidorPromessa ??= (
      deps.iniciarServidor !== undefined
        ? deps.iniciarServidor(depsDoServidor(portas), ganchos)
        : iniciarServidorRemoto({ caminhoWorker: deps.ativos.caminhoWorker, deps: depsDoServidor(portas), ganchos, dirSegredo: dirApp })
    ).then((s) => {
      servidor = s;
      return s;
    });
    servidorPromessa.catch(() => { servidorPromessa = null; });
    return servidorPromessa;
  }

  // ---------------------------------------------------------------- lançamento do piloto e dos workers
  function aliviarArgumentos(comando: ComandoPane, dir: string): ComandoPane {
    const argumentos = [...comando.argumentos];
    const arquivos = [...comando.arquivos];
    const i = argumentos.indexOf("--append-system-prompt");
    const valor = i >= 0 ? argumentos[i + 1] : undefined;
    // o argv de uma sessão aceita 4 KB por argumento: instruções longas vão para arquivo
    if (i >= 0 && valor !== undefined && Buffer.byteLength(valor) > ARGUMENTO_SEGURO_BYTES) {
      const caminho = join(dir, "instrucoes.md");
      arquivos.push({ caminho, conteudo: valor } satisfies ArquivoDoComando);
      argumentos.splice(i, 2, "--append-system-prompt-file", caminho);
    }
    const ultimo = argumentos[argumentos.length - 1];
    if (ultimo !== undefined && Buffer.byteLength(ultimo) > ARGUMENTO_SEGURO_BYTES + 500) {
      argumentos[argumentos.length - 1] = Buffer.from(ultimo).subarray(0, ARGUMENTO_SEGURO_BYTES + 400).toString("utf8").replace(/\uFFFD+$/, "");
    }
    return { ...comando, argumentos, arquivos };
  }

  async function objetivoDoPiloto(e: EntradaPreparoDePane): Promise<string | null> {
    if (e.pedido.prompt_inicial !== undefined && e.pedido.prompt_inicial.trim() !== "") return e.pedido.prompt_inicial.slice(0, OBJETIVO_MAX);
    if (e.missao === undefined) return null;
    try {
      const brief = await readFile(join(raizDe(e.workspace, e.missao), PRODUTO.pastaNoProjeto, "missoes", e.missao.id, "brief.md"), "utf8");
      return brief.trim() === "" ? null : `Pedido da Missão:\n\n${brief.trim()}`.slice(0, OBJETIVO_MAX);
    } catch {
      return null;
    }
  }

  /** O preparador que o serviço de Panes chama entre criar o Pane e abrir a sessão. */
  async function preparar(e: EntradaPreparoDePane): Promise<PreparoDaSessao | null> {
    const { pane, missao, workspace } = e;
    if (missao === undefined || missao.modo === "livre" || pane.papel === "nenhum") return null;
    const card = e.pedido.contexto?.["card"] as { task_id?: unknown; task_ref?: unknown; briefing_path?: unknown } | undefined;
    const ehWorker = !pane.eh_piloto && typeof card?.task_id === "string" && typeof card.task_ref === "string";
    if (!pane.eh_piloto && !ehWorker) return null;

    let s: ServidorRemoto;
    try {
      s = await garantirServidor();
    } catch (erro) {
      avisar(`O MCP do app não subiu; o Pane ${pane.display_id} abre sem orquestração (${erro instanceof Error ? erro.message : "erro"}).`);
      return null;
    }
    const base: EntradaComando = {
      ferramenta: e.ferramenta.id,
      executavel: pane.executavel_id ?? "",
      // as aprovações automáticas (D-14) já entram pelo catálogo das sessões; aqui nunca se repetem
      permissao: "seguro",
      servidor: { url: s.url, urlGanchos: s.urlGanchos, emitirToken: (p: PedidoToken) => s.emitirToken(p), revogar: (id) => s.revogar(id) },
      dirApp,
      pane_id: pane.id,
      workspace_id: workspace.id,
      mission_id: missao.id,
      modo: missao.modo as ModoMissao,
      ganchos: { executavelNode: deps.executavelNode, electronComoNode: deps.electronComoNode, script: deps.ativos.scriptGancho },
      pastaDePrompts: deps.ativos.pastaDePrompts,
    };
    let comando: ComandoPane;
    if (pane.eh_piloto) {
      const objetivo = await objetivoDoPiloto(e);
      if (e.pedido.respawn_de !== undefined && e.pedido.respawn_de !== null) {
        s.revogar(e.pedido.respawn_de);
        comando = (await prepararRespawnPiloto({ ...base, objetivo, conta_id: pane.conta_id, handoff_da_missao: null, conteudo_persistido: false })).comando;
      } else {
        comando = await montarComandoPiloto({ ...base, objetivo });
      }
    } else {
      comando = await montarComandoWorker({
        ...base,
        papel: pane.papel as "executor" | "explorador" | "revisor",
        task_id: card?.task_id as string,
        task_ref: card?.task_ref as string,
        briefing_path: typeof card?.briefing_path === "string" ? card.briefing_path : null,
      });
    }
    const pronto = aliviarArgumentos(comando, join(dirApp, "panes", pane.id));
    await gravarArquivosDoComando(dirApp, pronto.arquivos);
    orquestrados.add(pane.id);
    if (pronto.estrategia_handoff === "fallback") vigia.iniciar(pane.id);
    return { argumentos: pronto.argumentos, ambiente: pronto.ambiente };
  }

  // ---------------------------------------------------------------- portas
  const panesPorta: PortaPanes = {
    async spawn(p: PedidoSpawn) {
      let cwd: string | undefined;
      if (p.mission_id === null) {
        // fora de Missão: Pane comum no workspace (sem card, sem orquestração)
        const ws = dominio.workspaces.exigir(p.workspace_id);
        if (p.cwd !== null) {
          const alvo = await resolverDentroReal(ws.raiz, p.cwd);
          if (alvo === null) throw argumentoInvalido('O campo "cwd" precisa ficar dentro do workspace.');
          cwd = alvo;
        }
        const aberto = await dominio.panes.abrirPane({ workspace_id: ws.id, cli: p.provedor, papel: p.papel, modelo: p.modelo, conta_id: p.conta_id, ...(cwd === undefined ? {} : { cwd }) });
        return { pane_id: aberto.pane.id };
      }
      const missao = repos.mission.exigir(p.mission_id);
      const ws = dominio.workspaces.exigir(missao.workspace_id);
      const base = raizDe(ws, missao);
      if (p.cwd !== null) {
        const alvo = await resolverDentroReal(base, p.cwd);
        if (alvo === null) throw argumentoInvalido('O campo "cwd" precisa ficar dentro da árvore da Missão.');
        cwd = alvo;
      }
      let briefing: string | null = null;
      if (p.briefing_path !== null) {
        const real = await resolverDentroReal(base, p.briefing_path);
        if (real === null) throw argumentoInvalido('O campo "briefing_path" precisa ser um arquivo existente dentro da árvore da Missão.');
        briefing = relative(await realpath(base), real).split("\\").join("/");
      }
      const numero = (banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM task WHERE mission_id = ?", [missao.id])?.n ?? 0) + 1;
      const ref = `t-${numero}`;
      const task = repos.task.criar({ mission_id: missao.id, task_ref: ref, titulo: p.agente_id ?? `Card ${ref}`, papel: p.papel, briefing_path: briefing });
      try {
        const aberto = await dominio.panes.abrirPane({
          missao_id: missao.id,
          cli: p.provedor,
          papel: p.papel,
          modelo: p.modelo,
          conta_id: p.conta_id,
          ...(cwd === undefined ? {} : { cwd }),
          contexto: { card: { task_id: task.id, task_ref: ref, briefing_path: briefing } },
        });
        repos.task.mudarEstado(task.id, "reivindicada", { pane_id: aberto.pane.id });
        leitorRegistrar(aberto.pane.sessao_pty_id);
        void avancarMissao(missao.id, p.papel);
        return { pane_id: aberto.pane.id };
      } catch (erro) {
        try { repos.task.mudarEstado(task.id, "descartada"); } catch { /* o card já não importa */ }
        throw erro;
      }
    },

    async listar(f) {
      const lista =
        f.mission_id === null
          ? repos.pane.listarPorWorkspace(f.workspace_id, { somenteAtivos: true, limite: 500 }).itens.filter((p) => p.mission_id === null)
          : repos.pane.listarPorMissao(f.mission_id).filter((p) => p.estado !== "encerrado" && p.workspace_id === f.workspace_id);
      return lista.map(paneInfo);
    },

    async obter(pane_id) {
      const p = repos.pane.obter(pane_id);
      return p === undefined ? null : paneInfo(p);
    },

    async ler(pane_id, ultimas) {
      const p = repos.pane.obter(pane_id);
      if (p === undefined) return null;
      let linhas: string[] = [];
      if (p.sessao_pty_id !== null) {
        leitorRegistrar(p.sessao_pty_id);
        linhas = (await leitor.ler(p.sessao_pty_id, ultimas)) ?? [];
      }
      return { linhas, estado: p.estado };
    },

    enviar: (pane_id, texto, submeter) => enviarAoPane(pane_id, texto, submeter),
    fechar: (pane_id, motivo) => fecharPane(pane_id, motivo),
  };

  function leitorRegistrar(sessao: string | null | undefined): void {
    if (sessao === null || sessao === undefined || encerrado) return;
    leitor.registrar(sessao);
  }

  /** A Missão acompanha o trabalho: o primeiro worker a leva a `executando`; o revisor, a `revisando`. */
  async function avancarMissao(mission_id: string, papel: Papel): Promise<void> {
    try {
      let atual = repos.mission.obter(mission_id)?.estado;
      if (atual === undefined) return;
      if (atual === "intake" || atual === "planejando") {
        for (const passo of AVANCO_DA_MISSAO) {
          atual = repos.mission.obter(mission_id)?.estado;
          if (atual === "intake" && passo === "planejando") await dominio.missoes.transicionar(mission_id, "planejando");
          else if (atual === "planejando" && passo === "executando") await dominio.missoes.transicionar(mission_id, "executando");
        }
      }
      if (papel === "revisor" && repos.mission.obter(mission_id)?.estado === "executando") await dominio.missoes.transicionar(mission_id, "revisando");
    } catch (e) {
      avisar(`A Missão ${mission_id} não avançou de estado: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const missoesPorta: PortaMissoes = {
    async obter(id) {
      const m = repos.mission.obter(id);
      return m === undefined ? null : missaoInfo(m);
    },
    async listar(f) {
      return repos.mission.listarPorWorkspace(f.workspace_id, { ...(f.estado === undefined ? {} : { estado: f.estado }), limite: 100 }).itens.map(missaoInfo);
    },
    async concluir(id) {
      // a tool já confere, mas a porta não depende dela: concluir sem handoff ok de revisor nunca acontece
      if (!(await persistencia.temRevisorOk(id))) throw violacaoDeRegra("reviewer_required", "A Missão exige um handoff ok de um revisor.");
      const r = await dominio.missoes.encerrar(id);
      if (r === null) throw naoEncontrado(`Missão não encontrada: ${id}.`);
    },
  };

  const provedoresPorta: PortaProvedores = {
    async listar() {
      const lista = await dominio.provedores.providerList();
      return lista.map((p): ProvedorInfo => ({ provedor: p.provider, cli: p.cli, contas: p.accounts.map((c) => c.account_id), habilitado: p.enabled }));
    },
    // lista estática por CLI (catalogo.ts); CLI sem valor conhecido só tem o padrão dela
    async modelos(provedor) {
      return modelosDaFerramenta(provedor);
    },
  };

  const portas = { panes: panesPorta, missoes: missoesPorta, provedores: provedoresPorta };

  // ---------------------------------------------------------------- eventos das sessões
  function paneDaSessao(sessao_id: string): string | null {
    const conhecido = sessaoParaPane.get(sessao_id);
    if (conhecido !== undefined) return conhecido;
    const achado = banco.consultarUm<{ id: string }>("SELECT id FROM pane WHERE sessao_pty_id = ? ORDER BY criado_em DESC, id DESC LIMIT 1", [sessao_id])?.id ?? null;
    if (achado !== null) sessaoParaPane.set(sessao_id, achado);
    return achado;
  }

  function aoEvento(ev: EventoTerminal): void {
    if (encerrado) return;
    if (ev.tipo === "saida") {
      leitor.alimentar(ev.sessao_id, ev.dados); // barato: ignora sessão sem leitor
      return;
    }
    if (ev.tipo !== "atividade" && ev.tipo !== "estado" && ev.tipo !== "encerramento") return;
    const pane_id = paneDaSessao(ev.sessao_id);
    if (pane_id === null || !orquestrados.has(pane_id)) return;
    const pane = repos.pane.obter(pane_id);
    if (pane === undefined) return;
    if (ultimoEstado.get(pane_id) === pane.estado) return;
    ultimoEstado.set(pane_id, pane.estado);
    fila.aoMudarEstado(pane_id, pane.estado);
    vigia.aoMudarEstado(pane_id, pane.estado);
    if (pane.estado === "encerrado") limparPane(pane_id);
  }

  /**
   * Panes orquestrados que o daemon manteve vivos (app reiniciado): voltam ao conjunto para que o
   * encerramento/descarte deles revogue o token (que sobrevive a reinício) e limpe fila e vigia.
   */
  /** Pane que terminou por qualquer caminho (abortar a Missão, fim do processo, descarte pelo serviço): revoga e limpa. */
  function varrerEncerrados(): void {
    if (encerrado) return;
    for (const id of [...orquestrados]) {
      const p = repos.pane.obter(id);
      if (p === undefined || p.estado === "encerrado") limparPane(id);
    }
  }

  function recuperarOrquestrados(): void {
    const linhas = banco.consultar<{ id: string }>(
      "SELECT p.id FROM pane p JOIN mission m ON m.id = p.mission_id WHERE p.estado <> 'encerrado' AND p.papel <> 'nenhum' AND m.modo <> 'livre'",
    );
    for (const l of linhas) orquestrados.add(l.id);
  }

  /**
   * AUD-04: o Bearer do MCP viaja em HTTP claro no loopback e a porta é reaproveitada entre inícios. Se a porta
   * anterior foi tomada por outro processo, as sessões recuperadas (URL antiga no ambiente) falariam com ele:
   * os tokens dos Panes recuperados são revogados e o Pane fica "sem MCP". Token com mais de 24 h já expirou
   * (o ambiente de uma CLI em execução não muda): avisa que o Pane precisa ser recriado.
   */
  function avaliarRecuperadosSemMcp(): void {
    const s = servidor;
    const ids = [...orquestrados];
    if (s === null || ids.length === 0) return;
    if (s.portaAnterior !== null && !s.portaReutilizada) {
      for (const id of ids) s.revogar(id);
      avisar(`A porta do MCP mudou (a anterior está ocupada por outro processo): ${ids.length} Pane(s) recuperado(s) ficaram sem MCP. Recrie-os para voltar a orquestrar.`);
      barramento.emitir("orquestracao.panes_sem_mcp", { pane_ids: ids, motivo: "porta_ocupada" });
      return;
    }
    const limite = Date.now() - TTL_PADRAO_MS;
    const expirados = ids.filter((id) => {
      const criado = Date.parse(repos.pane.obter(id)?.criado_em ?? "");
      return Number.isFinite(criado) && criado < limite;
    });
    if (expirados.length > 0) {
      avisar(`${expirados.length} Pane(s) têm mais de 24 h: o token do MCP expirou e a CLI em execução não o troca. Recrie o Pane para voltar a orquestrar.`);
      barramento.emitir("orquestracao.panes_sem_mcp", { pane_ids: expirados, motivo: "token_expirado" });
    }
  }

  /**
   * AUD-05: reentrega os avisos que a queda do app deixou pelo caminho (handoff gravado, wake não entregue).
   * Piloto que já terminou ou sumiu: descarta o registro. A fila ignora duplicata do mesmo handoff.
   */
  function restaurarWakes(): void {
    const linhas = banco.consultar<{ handoff_id: string; destino_pane_id: string; origem_pane_id: string; task_ref: string; status: ItemWake["status"]; resumo: string; relatorio_path: string | null }>(
      "SELECT handoff_id, destino_pane_id, origem_pane_id, task_ref, status, resumo, relatorio_path FROM wake_pendente ORDER BY criado_em, rowid",
    );
    for (const l of linhas) {
      const destino = repos.pane.obter(l.destino_pane_id);
      if (destino === undefined || destino.estado === "encerrado") {
        banco.executar("DELETE FROM wake_pendente WHERE handoff_id = ?", [l.handoff_id]);
        continue;
      }
      orquestrados.add(l.destino_pane_id);
      fila.enfileirar({ destino_pane_id: l.destino_pane_id, origem_pane_id: l.origem_pane_id, task_id: l.task_ref, handoff_id: l.handoff_id, status: l.status, resumo: l.resumo, relatorio_path: l.relatorio_path });
    }
  }

  // ---------------------------------------------------------------- ciclo de vida
  // O preparador fica ligado desde a criação: a Missão criada antes de `iniciar()` também é orquestrada.
  dominio.panes.definirPreparador(preparar);

  return {
    async iniciar() {
      if (iniciado || encerrado) return;
      iniciado = true;
      await garantirServidor().catch((e: unknown) => {
        avisar(`Servidor MCP indisponível: ${e instanceof Error ? e.message : String(e)}`);
      });
      try {
        await dominio.panes.ligar(); // o serviço de Panes atualiza o banco ANTES de este ouvinte ler o estado
        recuperarOrquestrados();
        avaliarRecuperadosSemMcp();
        restaurarWakes();
        // toda mudança de Missão/Pane (já coalescida) confere os Panes que terminaram
        const parar = barramento.assinar?.("missoes:mudou", () => varrerEncerrados());
        if (parar !== undefined) desligar.push(parar);
        const g = await deps.sessoes();
        if (encerrado) return;
        desligar.push(g.assinar(aoEvento));
        if (g.observarTamanho !== undefined) {
          desligar.push(g.observarTamanho((id, c, l) => leitor.redimensionar(id, c, l)));
        }
      } catch (e) {
        avisar(`Orquestração sem eventos de sessão: ${e instanceof Error ? e.message : String(e)}`);
      }
      const passo = deps.intervaloSegurancaMs ?? 3_000;
      relogioDeSeguranca = setInterval(() => {
        void fila.sondar().catch(() => undefined);
        void vigia.avaliar().catch(() => undefined);
      }, passo);
      relogioDeSeguranca.unref();
    },

    async encerrar() {
      if (encerrado) return;
      encerrado = true;
      dominio.panes.definirPreparador(null);
      if (relogioDeSeguranca !== null) clearInterval(relogioDeSeguranca);
      relogioDeSeguranca = null;
      while (desligar.length > 0) desligar.pop()?.();
      // NÃO revoga os tokens: sair do app não encerra os Panes (o daemon os mantém) e o token persistente
      // precisa valer depois de reiniciar. A revogação acontece ao encerrar/descartar o Pane (limparPane).
      for (const id of [...orquestrados]) {
        fila.descartar(id);
        vigia.parar(id);
      }
      orquestrados.clear();
      leitor.fechar();
      const s = servidor ?? (await servidorPromessa?.catch(() => null)) ?? null;
      await s?.fechar().catch(() => undefined);
      servidor = null;
    },

    liberarPortao(mission_id, portao) {
      if (!PORTOES.includes(portao)) throw argumentoInvalido("Portão inválido.");
      repos.mission.exigir(mission_id);
      gravarPortao(repos.config, mission_id, portao);
    },

    definirSquad(mission_id, agentes) {
      repos.mission.exigir(mission_id);
      if (agentes === null) repos.config.remover(CHAVE_SQUAD(mission_id));
      else repos.config.definir(CHAVE_SQUAD(mission_id), agentes);
    },

    portas,
    persistencia,
    fila,
    servidor: () => servidor,
  };
}
