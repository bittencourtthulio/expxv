// Dublês em memória das portas do MCP (sem banco, sem PTY). Usados pelos testes de mcp/ e orquestracao/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModoMissao, Papel } from "../../../src/nucleo/dominio";
import type { ClaimsToken } from "../../../src/nucleo/mcp/tokens";
import type {
  HandoffRegistrado,
  MissaoInfo,
  PaneInfo,
  PedidoHandoff,
  PedidoSpawn,
  PortaHandoff,
  PortaMissoes,
  PortaPanes,
  PortaProvedores,
  ProvedorInfo,
} from "../../../src/nucleo/mcp/portas";
import type { DepsTools } from "../../../src/nucleo/mcp/tools/comum";

export interface Mundo {
  raiz: string;
  panes: Map<string, PaneInfo & { linhas: string[] }>;
  missoes: Map<string, MissaoInfo>;
  provedores: ProvedorInfo[];
  avisos: string[];
  spawns: PedidoSpawn[];
  enviados: Array<{ pane_id: string; texto: string; submeter: boolean }>;
  fechados: Array<{ pane_id: string; motivo: string }>;
  concluidas: string[];
  registros: PedidoHandoff[];
  handoffs: Map<string, HandoffRegistrado>;
  revisorOk: boolean;
  falhaNoSpawn: boolean;
  deps: DepsTools;
  adicionarPane(p: Partial<PaneInfo> & { pane_id: string }): PaneInfo;
}

export function criarMundo(opcoes: { modo?: ModoMissao; portoes?: MissaoInfo["portoes_liberados"]; agentes?: MissaoInfo["agentes_do_squad"] } = {}): Mundo {
  const modo = opcoes.modo ?? "agentico";
  const raiz = mkdtempSync(join(tmpdir(), "mcp-mundo-"));
  const m: Mundo = {
    raiz,
    panes: new Map(),
    missoes: new Map(),
    provedores: [
      { provedor: "claude", cli: "claude", contas: ["conta_a"], habilitado: true },
      { provedor: "codex", cli: "codex", contas: [], habilitado: true },
      { provedor: "gemini", cli: "gemini", contas: [], habilitado: false },
    ],
    avisos: [],
    spawns: [],
    enviados: [],
    fechados: [],
    concluidas: [],
    registros: [],
    handoffs: new Map(),
    revisorOk: false,
    falhaNoSpawn: false,
    deps: undefined as unknown as DepsTools,
    adicionarPane(p) {
      const pane = { workspace_id: "ws_1", mission_id: modo === "livre" ? null : "mis_1", provedor: "claude", papel: "executor" as Papel, estado: "trabalhando" as const, task_id: null, eh_piloto: false, linhas: [] as string[], ...p };
      m.panes.set(pane.pane_id, pane);
      return pane;
    },
  };
  if (modo !== "livre") {
    m.missoes.set("mis_1", {
      mission_id: "mis_1",
      workspace_id: "ws_1",
      modo,
      estado: "executando",
      titulo: "Missão de teste",
      piloto_pane_id: "pane_p",
      portoes_liberados: opcoes.portoes ?? ["direction", "content", "build", "qa"],
      agentes_do_squad: opcoes.agentes ?? null,
    });
  }
  m.adicionarPane({ pane_id: "pane_p", papel: modo === "livre" ? "nenhum" : "piloto", eh_piloto: true, estado: "pronto" });

  const panes: PortaPanes = {
    async spawn(p) {
      if (m.falhaNoSpawn) throw new Error("boom: detalhe interno");
      m.spawns.push(p);
      const id = `pane_w${m.spawns.length}`;
      m.adicionarPane({ pane_id: id, workspace_id: p.workspace_id, mission_id: p.mission_id, provedor: p.provedor, papel: p.papel });
      return { pane_id: id };
    },
    async listar(f) {
      return [...m.panes.values()].filter((p) => p.workspace_id === f.workspace_id && p.mission_id === f.mission_id && p.estado !== "encerrado");
    },
    async obter(id) {
      return m.panes.get(id) ?? null;
    },
    async ler(id, n) {
      const p = m.panes.get(id);
      return p === undefined ? null : { linhas: p.linhas.slice(-n), estado: p.estado };
    },
    async enviar(id, texto, submeter) {
      m.enviados.push({ pane_id: id, texto, submeter });
      return true;
    },
    async fechar(id, motivo) {
      m.fechados.push({ pane_id: id, motivo });
      const p = m.panes.get(id);
      if (p !== undefined) p.estado = "encerrado";
      return true;
    },
  };
  const missoes: PortaMissoes = {
    async obter(id) {
      return m.missoes.get(id) ?? null;
    },
    async listar(f) {
      return [...m.missoes.values()].filter((x) => x.workspace_id === f.workspace_id && (f.estado === undefined || x.estado === f.estado));
    },
    async concluir(id) {
      m.concluidas.push(id);
      const x = m.missoes.get(id);
      if (x !== undefined) x.estado = "concluida";
    },
  };
  const provedores: PortaProvedores = {
    async listar() {
      return m.provedores;
    },
    async modelos(p) {
      return [{ modelo: `${p}-modelo`, niveis_esforco: ["baixo", "alto"] }];
    },
  };
  const handoff: PortaHandoff = {
    async registrar(p) {
      m.registros.push(p);
      const id = `hof_${m.registros.length}`;
      m.handoffs.set(p.pane_id, { handoff_id: id, relatorio_path: p.relatorio_path, status: p.status });
      return { handoff_id: id };
    },
    async doPane(id) {
      return m.handoffs.get(id) ?? null;
    },
    async temRevisorOk() {
      return m.revisorOk;
    },
  };
  m.deps = {
    panes,
    missoes,
    provedores,
    handoff,
    relogio: { agora: () => Date.now() },
    raiz: async () => raiz,
    maxPanesParalelos: 8,
    avisar: (msg) => m.avisos.push(msg),
  };
  return m;
}

export function claimsDe(parcial: Partial<ClaimsToken> & { tools_allow?: string[] } = {}): ClaimsToken {
  return {
    workspace_id: "ws_1",
    mission_id: "mis_1",
    pane_id: "pane_p",
    role: "piloto",
    mode: "agentico",
    tools_allow: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
    n: 1,
    ...parcial,
  };
}
