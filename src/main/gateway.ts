// Gateway MCP no main (Fase 7C): liga o núcleo (`nucleo/gateway-mcp`) à Loja, ao banco e à orquestração. SOB DEMANDA: nada é importado nem criado no boot onda 1
// (o main faz `import()` quando o servidor MCP sobe ou a tela Loja abre). O gateway NÃO escuta porta: `POST /gateway` vive no servidor loopback do app (D-370); este
// módulo só responde `listar`/`chamar` por Pane (via RPC da thread do MCP). Servidores de terceiro rodam AQUI, com segredos do cofre; o Pane nunca os vê.
import { randomBytes } from "node:crypto";
import type {
  ConfigGateway, EntradaAuditoriaGateway, EstadoGateway, EventoGateway, FerramentaGateway, PedidoAuditoriaGateway, PedidoConfigGateway, PedidoFerramentasGateway, PedidoFiltroGateway,
} from "../compartilhado/catalogo";
import { ErroMcp } from "../nucleo/mcp/erros";
import type { FerramentaGatewayMcp, PortaGateway, ResultadoGatewayMcp } from "../nucleo/mcp/portas";
import { criarAgregador, type Agregador } from "../nucleo/gateway-mcp/agregador";
import { ehToolDoGateway } from "../nucleo/gateway-mcp/injecao";
import { desserializarPane, papelDoGateway, serializarPane } from "../nucleo/gateway-mcp/persistencia";
import { RETENCAO_AUDITORIA_DIAS, type RepoGateway } from "../nucleo/gateway-mcp/repositorio";
import { riscoDaFerramenta } from "../nucleo/gateway-mcp/risco";
import { decidirFerramenta, indexarRegras } from "../nucleo/gateway-mcp/politica";
import { sanearTexto } from "../nucleo/gateway-mcp/sanear";
import type { Conectar, ModoMissaoGw, SnapshotGateway } from "../nucleo/gateway-mcp/tipos";
import type { DecisaoGate } from "../nucleo/loja-mcp";
import type { AlvoPaneLoja, PortaLojaDoPane } from "./loja-mcp";

/** O que o gateway usa da Loja (subconjunto de `PortaLojaDoPane`). */
export type PortaLojaParaGateway = Pick<PortaLojaDoPane, "servidoresDoPane" | "servidoresValidos" | "lancamentoDoServidor">;

export interface AlvoPaneGateway extends AlvoPaneLoja {
  /** papel do Pane (`piloto|executor|explorador|revisor|nenhum`) */
  papel: string;
}

export interface DepsGatewayMain {
  repo: RepoGateway;
  loja: () => PortaLojaParaGateway | null;
  /** o Pane existe e não está encerrado */
  paneAtivo: (paneId: string) => boolean;
  raizDoWorkspace: (workspaceId: string) => string | null;
  emitirRenderer: (e: EventoGateway) => void;
  /** nomes/descrições já conhecidos de um servidor (Loja: último teste), usados se o servidor não puder ser consultado agora */
  ferramentasConhecidas?: (servidorId: string) => Array<{ nome: string; descricao: string | null }>;
  /** injeção de teste: substitui o conector real (SDK) */
  conectar?: Conectar;
  agora?: () => number;
  /** o servidor MCP do app está de pé (a tela mostra "disponível") */
  servidorDisponivel?: () => boolean;
}

export interface GatewayMain extends PortaGateway {
  ativoPara(workspaceId: string): boolean;
  /** Pane que abre: se o gateway está ligado no workspace e há servidores permitidos, grava o snapshot e devolve os ids; senão `null` (segue a injeção direta da Loja). */
  registrarPane(alvo: AlvoPaneGateway): Promise<{ ids: string[] } | null>;
  /** gate `pre-mcp` para `mcp__ev_gateway__*`: só Pane com snapshot vivo e gateway ligado (o filtro fino é do próprio gateway). */
  gate(paneId: string, ferramenta: string): DecisaoGate;
  liberar(paneId: string): void;
  estado(): EstadoGateway;
  configLer(workspaceId: string): ConfigGateway;
  configGravar(p: PedidoConfigGateway): ConfigGateway;
  ferramentas(p: PedidoFerramentasGateway): Promise<FerramentaGateway[]>;
  filtroDefinir(p: PedidoFiltroGateway): { ok: boolean };
  auditoria(p: PedidoAuditoriaGateway): EntradaAuditoriaGateway[];
  revogarPane(paneId: string): { ok: boolean };
  /** manutenção ociosa (onda 2): poda snapshots vencidos e auditoria > 30 dias */
  ocioso(): void;
  encerrar(): Promise<void>;
}

export function criarGatewayMain(d: DepsGatewayMain): GatewayMain {
  const agora = d.agora ?? Date.now;
  const snapshots = new Map<string, SnapshotGateway>();
  /** snapshot já filtrado por validade que o agregador lê (preenchido logo antes de cada chamada, sem `await` no meio) */
  const validados = new Map<string, SnapshotGateway>();
  let agregador: Agregador | null = null;
  // o SDK do MCP (cliente) só é carregado na PRIMEIRA conexão a um servidor de terceiro (P-01: nada disso no boot)
  let conector: Promise<Conectar> | null = null;
  const conectorSobDemanda: Conectar = async (id, ctx) => {
    conector ??= import("../nucleo/gateway-mcp/conector").then((m) => m.criarConector({ resolver: (sid, c) => loja().lancamentoDoServidor(sid, c.raiz) }));
    return (await conector)(id, ctx);
  };

  const loja = (): PortaLojaParaGateway => {
    const l = d.loja();
    if (l === null) throw new ErroMcp("unavailable", "A Loja de MCPs não está ativa.");
    return l;
  };

  function hidratar(paneId: string): SnapshotGateway | null {
    const vivo = snapshots.get(paneId);
    if (vivo !== undefined) return d.paneAtivo(paneId) ? vivo : (liberar(paneId), null);
    if (!d.paneAtivo(paneId)) return null;
    let reg;
    try { reg = d.repo.obterPane(paneId); } catch { return null; }
    if (reg === null) return null;
    const p = desserializarPane(reg, "gateway", d.raizDoWorkspace(reg.workspace_id), agora());
    if (p === null) return null;
    const s: SnapshotGateway = { pane_id: p.pane_id, workspace_id: p.workspace_id, mission_id: p.mission_id, agente_id: p.agente_id, papel: papelDoGateway(p.papel), modo: p.modo, servidores: p.ids, raiz: p.raiz };
    snapshots.set(paneId, s);
    return s;
  }

  function criar(): Agregador {
    agregador ??= criarAgregador({
      snapshot: (paneId) => validados.get(paneId) ?? null,
      config: (ws) => d.repo.config(ws),
      regras: (ws) => d.repo.regras(ws),
      conectar: d.conectar ?? conectorSobDemanda,
      auditar: (e) => d.repo.registrarAuditoria({ id: `gwa_${randomBytes(8).toString("hex")}`, em: new Date(agora()).toISOString(), ...e }),
      evento: (e) => d.emitirRenderer(e),
      agora,
    });
    return agregador;
  }

  /** Snapshot validado AGORA: ids ainda instalados/permitidos. `null` = sem acesso. */
  async function validar(paneId: string): Promise<SnapshotGateway | null> {
    const s = hidratar(paneId);
    if (s === null) return null;
    let ids: string[];
    try { ids = await loja().servidoresValidos(s.servidores); } catch { ids = []; }
    const v = { ...s, servidores: ids };
    validados.set(paneId, v);
    return v;
  }

  return {
    ativoPara: (ws) => d.repo.config(ws).ativo,

    async registrarPane(alvo) {
      if (!d.repo.config(alvo.workspace_id).ativo) return null;
      const l = d.loja();
      if (l === null) return null;
      const ids = await l.servidoresDoPane(alvo);
      if (ids.length === 0) return null;
      const s: SnapshotGateway = {
        pane_id: alvo.pane_id, workspace_id: alvo.workspace_id, mission_id: alvo.missao_id, agente_id: alvo.agente_id, papel: papelDoGateway(alvo.papel), modo: alvo.modo as ModoMissaoGw,
        servidores: ids, raiz: alvo.raiz,
      };
      snapshots.set(alvo.pane_id, s);
      try {
        d.repo.gravarPane(serializarPane({ pane_id: s.pane_id, workspace_id: s.workspace_id, mission_id: s.mission_id, papel: s.papel, modo: s.modo, via: "gateway", ids, agente_id: s.agente_id, raiz: s.raiz }, d.raizDoWorkspace(s.workspace_id), agora()));
      } catch { /* sem persistência o Pane só não sobrevive a um restart do app */ }
      return { ids };
    },

    gate(paneId, ferramenta) {
      if (!ehToolDoGateway(ferramenta)) return { permitido: true, motivo: null };
      const s = hidratar(paneId);
      if (s === null || !d.repo.config(s.workspace_id).ativo) return { permitido: false, motivo: "O gateway de MCPs não está habilitado para este Pane." };
      return { permitido: true, motivo: null };
    },

    async listar(paneId): Promise<{ tools: FerramentaGatewayMcp[] }> {
      if ((await validar(paneId)) === null) return { tools: [] };
      return criar().listar(paneId);
    },

    async chamar(paneId, nome, args): Promise<ResultadoGatewayMcp> {
      if ((await validar(paneId)) === null) throw new ErroMcp("unavailable", "O gateway não está disponível para este Pane.");
      return criar().chamar(paneId, nome, args);
    },

    liberar,

    estado() {
      const c = agregador?.contadores() ?? { chamadas: 0, bloqueadas: 0, limitadas: 0 };
      return { disponivel: d.servidorDisponivel?.() ?? true, panes_ativos: snapshots.size, servidores_conectados: agregador?.servidoresConectados() ?? 0, ...c };
    },

    configLer: (ws) => d.repo.config(ws),
    configGravar: (p) => d.repo.gravarConfig(p, new Date(agora()).toISOString()),

    async ferramentas(p) {
      const raiz = d.raizDoWorkspace(p.workspace_id);
      const cfg = d.repo.config(p.workspace_id);
      const regras = indexarRegras(d.repo.regras(p.workspace_id));
      let vivas: Array<{ nome: string; descricao: string; risco: "leitura" | "escrita" | "desconhecido"; servidor_id: string; ferramenta: string }> | null = null;
      try {
        if ((await loja().servidoresValidos([p.servidor_id])).length === 1) {
          const lista = await criar().ferramentasDoServidor(p.servidor_id, raiz, cfg.ocioso_s);
          vivas = lista.map((f) => ({ nome: f.nome, descricao: f.descricao, risco: f.risco, servidor_id: f.servidor_id, ferramenta: f.ferramenta }));
        }
      } catch { vivas = null; }
      const base = vivas ?? (d.ferramentasConhecidas?.(p.servidor_id) ?? []).map((f) => ({ nome: f.nome, descricao: sanearTexto(f.descricao, 400), risco: riscoDaFerramenta({ nome: f.nome, somente_leitura: null, destrutiva: null }), servidor_id: p.servidor_id, ferramenta: f.nome }));
      return base.map((f): FerramentaGateway => {
        const dec = decidirFerramenta({ modo: "squad", papel: p.papel, servidor_id: p.servidor_id, ferramenta: f.ferramenta, risco: f.risco, regras });
        return { servidor_id: p.servidor_id, nome: f.ferramenta, descricao: f.descricao === "" ? null : f.descricao, habilitada: dec.permitida, explicita: dec.explicita, risco: f.risco };
      });
    },

    filtroDefinir(p) {
      d.repo.definirRegra(p.workspace_id, { servidor_id: p.servidor_id, ferramenta: p.ferramenta, papel: p.papel, habilitada: p.habilitada }, new Date(agora()).toISOString());
      return { ok: true };
    },

    auditoria: (p) => d.repo.listarAuditoria(p.workspace_id, p.limite),

    revogarPane(paneId) {
      const tinha = snapshots.has(paneId) || d.repo.obterPane(paneId) !== null;
      snapshots.delete(paneId);
      validados.delete(paneId);
      try { d.repo.removerPane(paneId); } catch { /* ignora */ }
      agregador?.revogarPane(paneId);
      d.emitirRenderer({ versao: 1, tipo: "pane_revogado", pane_id: paneId });
      return { ok: tinha };
    },

    ocioso() {
      try {
        d.repo.podarPanes(new Date(agora()).toISOString());
        d.repo.podarAuditoria(new Date(agora() - RETENCAO_AUDITORIA_DIAS * 86_400_000).toISOString());
      } catch { /* manutenção é melhor esforço */ }
    },

    async encerrar() {
      snapshots.clear();
      validados.clear();
      await agregador?.encerrar();
    },
  };

  function liberar(paneId: string): void {
    snapshots.delete(paneId);
    validados.delete(paneId);
    agregador?.revogarPane(paneId);
    if (!d.paneAtivo(paneId)) { try { d.repo.removerPane(paneId); } catch { /* ignora */ } }
  }
}
