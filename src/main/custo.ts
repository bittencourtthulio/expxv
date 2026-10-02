// Ligação do custo e do board no main (T-10.11/T-10.13), SOB DEMANDA: nada no boot. O `ServicoCusto` nasce no primeiro uso (migration já aplicada pelo banco; semear os preços
// embutidos são ~20 linhas); `iniciar()` (onda 2, ocioso) só assina `usage.observed` do proxy OpenRouter (Fase 9). Falha do custo nunca derruba o app: cada canal devolve erro
// nominal saneado. O renderer recebe só `CustoResumo`/modelos de dados (nunca caminho absoluto) e `custo:evento`/`board:evento` coalescidos em ≤ 1 / 300 ms.
import { homedir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Banco } from "../nucleo/banco/banco";
import { criarRepoConfig } from "../nucleo/banco/repos/config";
import { registrarEventoDominio } from "../nucleo/missoes/eventos";
import {
  CONFIG_CUSTO_PADRAO,
  type ConfigCusto,
  type CustoMissao,
  type CustoResumo,
  type CustoSprint,
  type EscopoAgregado,
  type EstimativaCusto,
  type EventoCusto,
  type EventosDominioCusto,
  type FonteDeUsoEstado,
  type PedidoEstimativaCusto,
  type PedidoGravarPreco,
  type PedidoRelatorioCusto,
  type PedidoResumoCusto,
  type Preco,
  type PrevisaoMissao,
  type PrevisaoPeriodo,
  type RespostaRelatorioCusto,
  type TipoEventoDominioCusto,
} from "../compartilhado/custo";
import { criarServicoCusto, type ServicoCusto } from "../nucleo/custo/servico";
import { criarFontes, type BaseArquivo } from "../nucleo/custo/fontes";
import { criarIngestao, type Ingestao, type ProcessoLeitor } from "../nucleo/custo/ingestao";
import { ErroBoard } from "../nucleo/board/erros";
import { chaveCard } from "../nucleo/custo/atribuicao";
import { NaoEncontradoErro, ValorInvalidoErro } from "../nucleo/dominio";
import { criarServicoBoard, type DepsBoard, type ServicoBoard } from "./custo-board";

// ---------------------------------------------------------------- erro nominal que atravessa o IPC (`<codigo>: <mensagem>`)
export class ErroDeCustoIpc extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(`${codigo}: ${mensagem}`);
    this.name = "ErroDeCustoIpc";
  }
}
/** Erros nominais do núcleo e do domínio passam com a mensagem; o resto vira texto genérico (nunca vaza caminho de máquina). */
export function sanearErroDeCusto(e: unknown): Error {
  if (e instanceof ErroDeCustoIpc) return e;
  if (e instanceof ErroBoard) return new ErroDeCustoIpc(e.subcodigo === null ? e.codigo : `${e.codigo}.${e.subcodigo}`, e.message);
  if (e instanceof NaoEncontradoErro) return new ErroDeCustoIpc("not_found", e.message);
  if (e instanceof ValorInvalidoErro) return new ErroDeCustoIpc("invalid", e.message);
  return new ErroDeCustoIpc("unavailable", "falha ao executar a operação de custo");
}

type Barramento = DepsBoard["barramento"];
/** Leitura dos transcripts das CLIs (T-10.06/07). Ausente ⇒ só o proxy OpenRouter alimenta o custo (testes e builds sem worker). */
export interface DependenciasIngestao {
  /** `dist/nucleo/custo/worker.js` (fora do asar no pacote). Sem ele e sem `criarWorker` não há leitura de transcript. */
  caminhoWorker?: string;
  criarWorker?: () => ProcessoLeitor;
  /** a janela está em foco (sem foco o backlog só é drenado na volta). */
  emFoco: () => boolean;
  /** config dir ABSOLUTO da conta (CLAUDE_CONFIG_DIR/CODEX_HOME dela); `null` ⇒ o padrão da máquina. */
  configDirDaConta?: (contaId: string, base: BaseArquivo) => string | null;
  /** raiz do usuário (padrão: `os.homedir()`); só para derivar `~/.claude` e `~/.codex`. */
  home?: string;
  /** variáveis de ambiente (padrão: `process.env`) para `CLAUDE_CONFIG_DIR`/`CODEX_HOME`. */
  ambiente?: Record<string, string | undefined>;
}
export interface DependenciasCusto extends Omit<DepsBoard, "custo" | "emitirRenderer"> {
  banco: Banco;
  barramento: Barramento;
  emitirRenderer: (canal: "custo:evento" | "board:evento", payload: EventoCusto | { versao: number }) => void;
  avisar?: (mensagem: string) => void;
  ingestao?: DependenciasIngestao;
}

export interface UsoObservadoPayload {
  pane_id: string;
  modelo: string | null;
  tokens_in: number;
  tokens_out: number;
  usd: number | null;
  ts: string;
  id?: string;
}
const ehUsoObservado = (p: unknown): p is UsoObservadoPayload => {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return typeof o["pane_id"] === "string" && typeof o["ts"] === "string" && typeof o["tokens_in"] === "number" && typeof o["tokens_out"] === "number" && (o["usd"] === null || typeof o["usd"] === "number") && (o["modelo"] === null || typeof o["modelo"] === "string");
};

export interface LigacaoCusto {
  servico(): ServicoCusto;
  board(): ServicoBoard;
  iniciar(): void;
  encerrar(): void;
  /** a janela voltou ao foco: drena o backlog dos transcripts tocados sem foco. */
  aoFocar(): void;
  /** localiza e começa a ler as fontes de uso do Pane (idempotente; chamada nos eventos do Pane). */
  descobrirFontes(paneId: string): Promise<void>;
  /** só para teste/diagnóstico: a ingestão ligada (ou `null`). */
  ingestao(): Ingestao | null;
  resumo(p: PedidoResumoCusto): CustoResumo | CustoMissao;
  relatorio(p: PedidoRelatorioCusto): RespostaRelatorioCusto;
  estimativa(p: PedidoEstimativaCusto): Promise<EstimativaCusto>;
  previsaoMissao(missionId: string): Promise<PrevisaoMissao>;
  previsaoPeriodo(workspaceId: string, inicio: string, fim: string): PrevisaoPeriodo;
  custoSprint(workspaceId: string, sprintId: string): CustoSprint;
  /** Fase 19: custo somado de um conjunto de cards (`trabalho_id` + `task_ref`) do workspace; card sem custo medido torna a soma incompleta (nunca 0). */
  custoDeCards(workspaceId: string, cards: ReadonlyArray<{ trabalho_id: string; task_ref: string }>): CustoSprint;
  fontes(workspaceId?: string): FonteDeUsoEstado[];
  precosListar(): Preco[];
  precoGravar(p: PedidoGravarPreco): Preco;
  precoApagar(id: string): { ok: boolean };
  reprecificar(p: { desde?: string; simular?: boolean }): { registros_reprecificados: number };
  configLer(): ConfigCusto;
  configGravar(c: ConfigCusto): ConfigCusto;
  tetoGravar(missionId: string, tetoUsd: number | null): { ok: true };
  reindexar(workspaceId?: string): Promise<{ iniciado: boolean; registros: number }>;
  diagnostico(): { texto: string };
  /** Fase 18: a porta `PortaCusto` (tempo ativo e tokens por task) sobre os agregados. */
  paraAgil(): {
    janelas(workspaceId: string, trabalhoId: string, taskRef: string): Promise<{ ativo_ms: number; tokens: number | null } | null>;
    colunas(workspaceId: string): Promise<string[] | null>;
    limiteWip(workspaceId: string, coluna: string): Promise<number | null>;
  };
}

export function ligarCusto(d: DependenciasCusto): LigacaoCusto {
  const config = criarRepoConfig(d.banco);
  let svc: ServicoCusto | null = null;
  let board: ServicoBoard | null = null;
  const desassinar: Array<() => void> = [];
  const pendentes = new Map<string, { escopo: EscopoAgregado; chave: string }>();
  let fluxoLigado = false;
  let iniciado = false;
  let ing: Ingestao | null = null;
  let fontesLig: ReturnType<typeof criarFontes> | null = null;
  const ultimaDescoberta = new Map<string, number>();

  const paraRenderer = (e: EventoCusto): void => {
    try {
      d.emitirRenderer("custo:evento", e);
    } catch {
      /* a janela pode ter fechado */
    }
  };
  function publicar<T extends TipoEventoDominioCusto>(tipo: T, payload: EventosDominioCusto[T]): void {
    d.barramento.emitir(tipo, payload);
    if (tipo === "cost.updated") {
      for (const e of (payload as EventosDominioCusto["cost.updated"]).escopos) pendentes.set(`${e.escopo}|${e.chave}`, e);
      d.barramento.emitirCoalescido("custo:flush", "atualizado", null, 300);
      return;
    }
    try {
      registrarEventoDominio(d.banco, tipo, payload as unknown as Record<string, unknown>);
    } catch {
      /* auditoria nunca derruba a ingestão */
    }
    if (tipo === "cost.ceiling_reached") {
      const p = payload as EventosDominioCusto["cost.ceiling_reached"];
      paraRenderer({ tipo: "teto", mission_id: p.mission_id, usd: p.usd, teto_usd: p.teto_usd });
    } else if (tipo === "cost.ceiling_warning") {
      const p = payload as EventosDominioCusto["cost.ceiling_warning"];
      paraRenderer({ tipo: "aviso_teto", mission_id: p.mission_id, usd: p.usd, teto_usd: p.teto_usd });
    } else if (tipo === "cost.price_missing") paraRenderer({ tipo: "preco_ausente", modelo: (payload as EventosDominioCusto["cost.price_missing"]).modelo });
    else if (tipo === "usage.source_missing") {
      const p = payload as EventosDominioCusto["usage.source_missing"];
      paraRenderer({ tipo: "fonte_ausente", pane_id: p.pane_id, cli: p.cli });
    }
  }
  function ligarFluxo(): void {
    if (fluxoLigado) return;
    fluxoLigado = true;
    desassinar.push(
      d.barramento.assinar("custo:flush", () => {
        const escopos = [...pendentes.values()];
        pendentes.clear();
        if (escopos.length > 0) paraRenderer({ tipo: "atualizado", escopos });
      }),
    );
  }

  const servico = (): ServicoCusto => {
    if (svc === null) {
      ligarFluxo();
      const novo = criarServicoCusto({
        banco: d.banco,
        ...(d.relogio ? { relogio: d.relogio } : {}),
        publicar,
        config: {
          ler: () => ({ ...CONFIG_CUSTO_PADRAO, ...(config.obter<Partial<ConfigCusto>>("custo") ?? {}) }),
          gravar: (c) => config.definir("custo", c),
        },
      });
      novo.iniciarPrecos();
      svc = novo;
    }
    return svc;
  };
  const quadro = (): ServicoBoard => {
    if (board === null) board = criarServicoBoard({ ...d, custo: servico, emitirRenderer: (c, p) => d.emitirRenderer(c, p) });
    return board;
  };

  function itensDaSprint(ws: string, sprintId: string): Array<{ chave_card: string | null }> {
    // tabelas `agil_*` (Fase 18): enquanto a persistência SQLite delas não for ligada, a consulta devolve vazio e a sprint sai "sem custo", nunca 0
    try {
      return d.banco
        .consultar<{ trabalho_id: string | null; task_ref: string | null }>(
          "SELECT i.trabalho_id AS trabalho_id, i.task_ref AS task_ref FROM agil_sprint_item si JOIN agil_item i ON i.id = si.item_id JOIN agil_sprint s ON s.id = si.sprint_id WHERE si.sprint_id = ? AND s.workspace_id = ? AND si.removido_em IS NULL",
          [sprintId, ws],
        )
        .map((l) => ({ chave_card: l.trabalho_id && l.task_ref ? chaveCard(ws, l.trabalho_id, l.task_ref) : null }));
    } catch {
      return [];
    }
  }

  async function sincronizarJanelas(ws: string): Promise<void> {
    const s = servico();
    const trabalhos = d.banco.consultar<{ trabalho_id: string }>("SELECT DISTINCT trabalho_id FROM mission WHERE workspace_id = ? AND trabalho_id IS NOT NULL", [ws]);
    for (const t of trabalhos) {
      s.sincronizarJanelasDoBanco(ws, t.trabalho_id);
      try {
        const r = await d.metodo.rastro(ws, t.trabalho_id, 0);
        s.sincronizarJanelasDoRastro(ws, t.trabalho_id, r.eventos.map((e) => ({ ts: e.ts, evento: e.evento, task: e.task })));
      } catch {
        /* sem rastro: só as janelas do banco */
      }
    }
  }

  // ---------------------------------------------------------------- ingestão dos transcripts (onda 2, ocioso: nasce no primeiro Pane/fonte)
  function ingestaoLigada(): { ing: Ingestao; fontes: ReturnType<typeof criarFontes> } | null {
    const cfg = d.ingestao;
    if (cfg === undefined || (cfg.caminhoWorker === undefined && cfg.criarWorker === undefined)) return null;
    if (ing !== null && fontesLig !== null) return { ing, fontes: fontesLig };
    const home = cfg.home ?? homedir();
    const env = cfg.ambiente ?? process.env;
    const padrao = (b: BaseArquivo): string =>
      b === "claude_config"
        ? env["CLAUDE_CONFIG_DIR"] ?? join(home, ".claude")
        : b === "codex_home"
          ? env["CODEX_HOME"] ?? join(home, ".codex")
          : join(env["XDG_DATA_HOME"] !== undefined && env["XDG_DATA_HOME"] !== "" ? env["XDG_DATA_HOME"] : join(home, ".local", "share"), "opencode"); // OpenCode: só o `opencode.db` desta pasta
    const fontes = criarFontes({
      servico: servico(),
      localizarSessaoOpenCode: (caminho, p) => (ing === null ? Promise.resolve(null) : ing.localizarSessaoOpenCode(caminho, p)),
      bases: { absoluto: (b, conta) => (conta === null ? padrao(b) : cfg.configDirDaConta?.(conta, b) ?? padrao(b)) },
    });
    const caminho = cfg.caminhoWorker;
    ing = criarIngestao({
      servico: servico(),
      fontes,
      criarWorker: cfg.criarWorker ?? ((): ProcessoLeitor => new Worker(caminho as string, { workerData: { paraCustoLeitor: true } }) as unknown as ProcessoLeitor),
      lerTranscripts: () => servico().config.ler().ler_transcripts,
      emFoco: cfg.emFoco,
      ...(d.avisar === undefined ? {} : { avisar: d.avisar }),
    });
    fontesLig = fontes;
    return { ing, fontes };
  }

  async function descobrirFontes(paneId: string): Promise<void> {
    try {
      const l = ingestaoLigada();
      if (l === null || !servico().config.ler().ler_transcripts) return;
      const agora = (d.relogio ? d.relogio() : new Date()).getTime();
      if (agora - (ultimaDescoberta.get(paneId) ?? 0) < 2000) return;
      ultimaDescoberta.set(paneId, agora);
      const p = d.banco.consultarUm<{ id: string; cli: string | null; conta_id: string | null; mission_id: string | null; workspace_id: string; estado: string; conversa: string | null; cwd: string | null; criado_em: string }>(
        "SELECT p.id, p.cli, p.conta_id, p.mission_id, p.workspace_id, p.estado, p.cwd, p.criado_em, (SELECT s.cli_ref_conversa FROM sessao s WHERE s.pane_id = p.id AND s.cli_ref_conversa IS NOT NULL ORDER BY s.criado_em DESC LIMIT 1) AS conversa FROM pane p WHERE p.id = ?",
        [paneId],
      );
      if (p === undefined || p.estado === "encerrado" || p.cli === null) return;
      const pane = { id: p.id, cli: p.cli, conta_id: p.conta_id, mission_id: p.mission_id, workspace_id: p.workspace_id };
      if (p.cli === "claude" && p.conversa !== null) {
        const f = await l.fontes.localizarClaudePorConversa(pane, p.conversa);
        if (f !== null) {
          l.ing.observar(f.id);
          const abs = l.fontes.resolver(f);
          if (abs !== null) for (const sub of await l.fontes.descobrirSubagentes(pane, abs)) l.ing.observar(sub.id);
        }
      } else if (p.cli === "codex" && p.conversa !== null) {
        const f = await l.fontes.localizarCodex(pane, p.conversa);
        if (f !== null) l.ing.observar(f.id);
      } else if (p.cli === "opencode") {
        // OpenCode (P-82): `opencode.db` somente leitura; a sessão é achada no worker. Sem banco/sessão ainda ⇒ `sem_fonte` visível (tenta de novo no próximo evento do Pane)
        const f = await l.fontes.localizarOpenCode(pane, { conversa: p.conversa, cwd: p.cwd, desdeMs: Date.parse(p.criado_em) || 0 });
        if (f !== null) l.ing.observar(f.id);
        else l.fontes.registrarSemLeitor(pane);
      } else l.fontes.registrarSemLeitor(pane);
    } catch {
      d.avisar?.("custo: não foi possível localizar a fonte de uso do Pane");
    }
  }
  async function encerrarFontesDoPane(paneId: string): Promise<void> {
    try {
      ultimaDescoberta.delete(paneId);
      for (const f of servico().repo.fontes.porPane(paneId)) {
        if (f.estado === "sem_fonte" || f.base === "proxy" || f.base === "nenhuma") continue;
        if (ing !== null && ing.observadas().includes(f.id)) await ing.encerrarFonte(f.id);
        else servico().repo.fontes.atualizar(f.id, { estado: "encerrada" });
      }
    } catch {
      d.avisar?.("custo: falha ao encerrar as fontes do Pane");
    }
  }

  return {
    servico,
    board: quadro,
    aoFocar: () => ing?.aoFocar(),
    descobrirFontes,
    ingestao: () => ing,
    iniciar() {
      if (iniciado) return;
      iniciado = true;
      if (d.ingestao !== undefined) {
        desassinar.push(
          d.barramento.assinar<{ pane_id?: unknown; estado?: unknown }>("pane.state_changed", (p) => {
            if (typeof p?.pane_id === "string" && p.estado !== "encerrado") void descobrirFontes(p.pane_id);
          }),
          d.barramento.assinar<{ pane_id?: unknown }>("pane.closed", (p) => {
            if (typeof p?.pane_id === "string") void encerrarFontesDoPane(p.pane_id);
          }),
        );
        // retoma as fontes que já existiam (offset salvo): em ocioso, depois da primeira pintura
        setTimeout(() => {
          try {
            const l = ingestaoLigada();
            if (l === null) return;
            for (const f of servico().repo.fontes.listar()) if ((f.base === "claude_config" || f.base === "codex_home" || f.base === "opencode_data") && f.estado !== "encerrada") l.ing.observar(f.id);
          } catch {
            d.avisar?.("custo: não foi possível retomar as fontes de uso");
          }
        }, 0).unref?.();
      }
      desassinar.push(
        d.barramento.assinar<unknown>("usage.observed", (p) => {
          if (!ehUsoObservado(p)) return;
          try {
            servico().ingerirProxy(p);
          } catch {
            d.avisar?.("custo: uso observado do proxy ignorado");
          }
        }),
      );
    },
    encerrar() {
      void ing?.parar();
      ing = null;
      fontesLig = null;
      desassinar.splice(0).forEach((f) => f());
      iniciado = false;
      fluxoLigado = false;
    },
    resumo(p) {
      if (p.escopo === "sprint") throw new ValorInvalidoErro("escopo", "sprint: use custo:sprint");
      if (p.escopo === "workspace") d.workspace(p.chave);
      return servico().resumo(p.escopo, p.chave);
    },
    relatorio: (p) => servico().relatorio(p),
    estimativa: (p) => quadro().estimativa(p),
    previsaoMissao: (id) => quadro().previsaoMissao(id),
    previsaoPeriodo(ws, inicio, fim) {
      d.workspace(ws);
      return servico().preverPeriodo("workspace", ws, inicio, fim);
    },
    custoSprint(ws, sprintId) {
      d.workspace(ws);
      return servico().custoSprint(sprintId, itensDaSprint(ws, sprintId));
    },
    custoDeCards(ws, cards) {
      d.workspace(ws);
      return servico().custoSprint("", cards.map((c) => ({ chave_card: `${ws}|${c.trabalho_id}|${c.task_ref}` })));
    },
    fontes: (ws) => servico().fontesEstado(ws ?? null),
    precosListar: () => servico().listarPrecos(),
    precoGravar: (p) => servico().gravarPreco(p),
    precoApagar: (id) => ({ ok: servico().apagarPreco(id) }),
    reprecificar: (p) => servico().reprecificar(p),
    configLer: () => servico().config.ler(),
    configGravar: (c) => servico().config.gravar(c),
    tetoGravar(missionId, teto) {
      servico().definirTeto(missionId, teto);
      return { ok: true };
    },
    async reindexar(ws) {
      if (ws !== undefined) {
        d.workspace(ws);
        await sincronizarJanelas(ws);
      }
      return { iniciado: true, ...servico().reindexar() };
    },
    diagnostico: () => ({ texto: servico().diagnostico() }),
    paraAgil: () => ({ janelas: async (ws, trabalhoId, taskRef) => servico().janelasParaAgil(ws, trabalhoId, taskRef), colunas: (ws) => quadro().portaAgil.colunas(ws), limiteWip: (ws, c) => quadro().portaAgil.limiteWip(ws, c) }),
  };
}
