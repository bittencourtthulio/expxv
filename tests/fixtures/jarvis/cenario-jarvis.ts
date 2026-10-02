// Cenário de teste do Jarvis (Fase 13): banco em memória + relógio falso + portas FALSAS com contadores. Nenhum processo, rede, CLI ou Maestro real.
import { vi } from "vitest";
import { planoBase } from "../alertas/cenario-telegram";
import type { PlanoRemoto } from "../../../src/compartilhado/alertas";
import { CONFIG_JARVIS_PADRAO, type ConfigJarvis } from "../../../src/compartilhado/jarvis";
import { abrirBanco, type Banco } from "../../../src/nucleo/banco/banco";
import { migrar } from "../../../src/nucleo/banco/migrar";
import { hashArgs } from "../../../src/nucleo/alertas/texto";
import { criarAuditoriaJarvis, criarIdempotencia, type AuditoriaJarvis } from "../../../src/nucleo/jarvis/auditoria";
import type { PortaClassificadorLlm } from "../../../src/nucleo/jarvis/classificador";
import type { AlvoControle, PortaConsulta, PortaControle, PortaGates, PortaNavegacao, PortaOrquestradorJarvis, PortaPaineis, PortaRigidez } from "../../../src/nucleo/jarvis/portas";
import { criarServicoJarvis, type DepsServicoJarvis, type ServicoJarvis } from "../../../src/nucleo/jarvis/servico";
import type { LinhaPane } from "../../../src/nucleo/jarvis/snapshot";

export interface RelogioFalsoJ {
  agora(): number;
  avancar(ms: number): void;
}
export const relogioFalso = (t0 = Date.parse("2026-10-01T12:00:00Z")): RelogioFalsoJ => {
  let t = t0;
  return { agora: () => t, avancar: (ms) => void (t += ms) };
};

export const planoRecalculado = (p: Partial<PlanoRemoto> = {}): PlanoRemoto => planoBase(p);

export interface CenarioJarvis {
  banco: Banco;
  relogio: RelogioFalsoJ;
  servico: ServicoJarvis;
  auditoria: AuditoriaJarvis;
  config: ConfigJarvis;
  plano: { atual: PlanoRemoto | null };
  orquestrador: { proporPlano: ReturnType<typeof vi.fn>; planoAtual: ReturnType<typeof vi.fn>; executarPlano: ReturnType<typeof vi.fn>; pararPlano: ReturnType<typeof vi.fn> };
  gates: { itens: Array<{ id: string; titulo: string; workspace_id: string; exige_humano: boolean }>; decidir: ReturnType<typeof vi.fn> };
  controle: { itens: AlvoControle[]; alvos: ReturnType<typeof vi.fn>; pausar: ReturnType<typeof vi.fn>; parar: ReturnType<typeof vi.fn> };
  navegacao: { abrirPane: ReturnType<typeof vi.fn> };
  paineis: { itens: LinhaPane[] };
  estado: { telaBloqueada: boolean; rigidezExige: boolean; llm: PortaClassificadorLlm | null };
  eventos: string[];
  fechar(): void;
}

export function criarCenarioJarvis(op: { config?: Partial<ConfigJarvis>; deps?: Partial<DepsServicoJarvis> } = {}): CenarioJarvis {
  const banco = abrirBanco(":memory:");
  migrar(banco);
  const relogio = relogioFalso();
  const config: ConfigJarvis = { ...CONFIG_JARVIS_PADRAO, ligado: true, ...op.config };
  const plano: { atual: PlanoRemoto | null } = { atual: null };
  const estado = { telaBloqueada: false, rigidezExige: false, llm: null as PortaClassificadorLlm | null };
  const orquestrador = {
    proporPlano: vi.fn(async () => {
      plano.atual = planoBase({ workspace: "w1", workspace_id: "ws_1" });
      return plano.atual;
    }),
    planoAtual: vi.fn(async () => plano.atual),
    executarPlano: vi.fn(async () => ({ iniciado: true, mission_id: "mis_1" })),
    pararPlano: vi.fn(async () => true),
  };
  const gates = {
    itens: [{ id: "g1", titulo: "Aprovar build", workspace_id: "ws_1", exige_humano: false }, { id: "g2", titulo: "Assinar prodx", workspace_id: "ws_1", exige_humano: true }],
    decidir: vi.fn(async () => ({ ok: true })),
  };
  const itensControle: AlvoControle[] = [{ id: "pl_a", rotulo: "Blog novo", estado: "executando" }, { id: "pl_b", rotulo: "Blog antigo", estado: "executando" }, { id: "pl_c", rotulo: "Loja", estado: "executando" }];
  const controle = { itens: itensControle, alvos: vi.fn(async () => itensControle), pausar: vi.fn(async () => true), parar: vi.fn(async () => true) };
  const navegacao = { abrirPane: vi.fn(async (ref: string) => ({ ok: ref !== "999" })) };
  const paineis = { itens: [{ pane_id: "p1", display_id: "1", label: "piloto", estado: "aguardando", ultima_mensagem: "terminei", pergunta_pendente: "posso seguir?", atualizado_em: "2026-10-01T11:59:00Z" }] as LinhaPane[] };
  const eventos: string[] = [];
  const consulta: PortaConsulta = {
    missoesAtivas: async () => [{ id: "mis_1", titulo: "Blog novo", workspace_id: "ws_1", panes_trabalhando: 2, panes_aguardando: 1 }],
    tarefasEmAndamento: async () => [],
    atrasadas: async () => [],
    cotaGeralPct: () => 42,
    consumo: async () => [{ conta: "pessoal", provedor: "claude", pct: 37 }],
    alertasCriticosNaoLidos: () => 1,
    nomeWorkspace: () => "W1",
  };
  const portaGates: PortaGates = {
    pendentes: async () => gates.itens,
    decidir: gates.decidir as PortaGates["decidir"],
  };
  const rigidez: PortaRigidez = { exigeDesktop: () => ({ exige: estado.rigidezExige, motivo: estado.rigidezExige ? "rigidez_do_workspace" : "" }) };
  const auditoria = criarAuditoriaJarvis({ banco, relogio });
  const deps: DepsServicoJarvis = {
    relogio,
    auditoria,
    idempotencia: criarIdempotencia({ banco, relogio }),
    config: () => config,
    workspaceAtual: () => "ws_1",
    workspaces: () => ["ws_1"],
    consulta: () => consulta,
    paineis: () => ({ listar: async () => paineis.itens }) as PortaPaineis,
    orquestrador: () => orquestrador as unknown as PortaOrquestradorJarvis,
    gates: () => portaGates,
    controle: () => controle as unknown as PortaControle,
    navegacao: () => navegacao as unknown as PortaNavegacao,
    rigidez: () => rigidez,
    llm: () => estado.llm,
    telaBloqueada: () => estado.telaBloqueada,
    aoMudar: (t) => eventos.push(t),
    ...op.deps,
  };
  return { banco, relogio, servico: criarServicoJarvis(deps), auditoria, config, plano, orquestrador, gates, controle, navegacao, paineis, estado, eventos, fechar: () => banco.fechar() };
}

export const hashDe = hashArgs;
