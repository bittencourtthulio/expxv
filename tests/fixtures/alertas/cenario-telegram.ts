// Cenário completo do Telegram para testes: servidor falso + rede de teste (loopback) + repositório em memória + portas FALSAS (orquestrador, rigidez,
// consulta, gates, cofre). Nenhum processo, rede externa, bot real ou CLI. O poller roda de verdade contra o servidor falso.
import { dormirFalso, esperarAte, relogioFalso, type DormirFalso, type RelogioFalso } from "./ajudas";
import { criarRedeDeTeste, type RedeTeste } from "./rede-teste";
import { subirTelegramFalso, type MensagemFalsa, type TelegramFalso, type UsuarioFalso } from "./telegram-falso";
import { criarRepoRegrasMemoria } from "../../../src/nucleo/alertas/memoria";
import type { EntradaAlerta, EstadoCanal, ModoWorkspaceTelegram, PlanoRemoto } from "../../../src/compartilhado/alertas";
import { hashArgs } from "../../../src/nucleo/alertas/texto";
import { criarRepoTelegramMemoria, type RepoTelegram } from "../../../src/nucleo/telegram/repo";
import { criarServicoTelegram, type EventoServico, type ServicoTelegram } from "../../../src/nucleo/telegram/servico";
import type { DepsServicoTelegram } from "../../../src/nucleo/telegram/servico";
import type { LinhaTarefaConsulta, MotivoRecusa, PortaConsulta, PortaGates, PortaOrquestrador, PortaRigidez, GatePendente } from "../../../src/nucleo/telegram/portas-entrada";

export const planoBase = (p: Partial<PlanoRemoto> = {}): PlanoRemoto => {
  const sem: Omit<PlanoRemoto, "args_hash"> = {
    plano_id: p.plano_id ?? `pl_${Math.random().toString(36).slice(2, 10)}`,
    intencao: "bug",
    confianca: 0.9,
    squad: { id: "sq1", nome: "Squad Web" },
    pipeline: { skill: "runx", etapas: [{ id: "e1", rotulo: "causa", perfil_resumo: "claude/sonnet" }, { id: "e2", rotulo: "fix", perfil_resumo: "claude/sonnet" }] },
    workspace: "w1",
    branch_de_trabalho: "runx/fix-login",
    branch_protegida: false,
    paineis_estimados: 2,
    estimativa: { pontos: 3, tempo_trabalho_ms: 3_600_000 },
    raio: "BAIXO",
    rigidez: 2,
    acoes: ["criar_missao", "abrir_pane", "disparar_metodo"],
    destrutivo: false,
    ...p,
  };
  const { args_hash: _ignorado, ...resto } = { ...sem, args_hash: "" };
  return { ...resto, args_hash: hashArgs(resto) };
};
const recalcular = (p: PlanoRemoto): PlanoRemoto => {
  const { args_hash: _a, ...resto } = p;
  return { ...resto, args_hash: hashArgs(resto) };
};

export class OrquestradorFalso implements PortaOrquestrador {
  planos = new Map<string, PlanoRemoto>();
  propostas: Array<Parameters<PortaOrquestrador["proporPlano"]>[0]> = [];
  execucoes: Array<{ plano_id: string; aprovado_por: string; args_hash: string }> = [];
  paradas: string[] = [];
  /** muda o plano DEPOIS de proposto (TOCTOU). */
  molde: Partial<PlanoRemoto> = {};
  recusar: MotivoRecusa | null = null;
  indisponivel = false;
  atrasoMs = 0;
  async proporPlano(p: Parameters<PortaOrquestrador["proporPlano"]>[0]): Promise<PlanoRemoto | { recusado: MotivoRecusa }> {
    this.propostas.push(p);
    if (this.atrasoMs > 0) await new Promise((r) => setTimeout(r, this.atrasoMs));
    if (this.indisponivel) throw new Error("indisponivel");
    if (this.recusar !== null) return { recusado: this.recusar };
    const plano = planoBase({ workspace: p.workspace_id, ...this.molde });
    this.planos.set(plano.plano_id, plano);
    return plano;
  }
  async planoAtual(id: string): Promise<PlanoRemoto | null> {
    return this.planos.get(id) ?? null;
  }
  alterar(id: string, patch: Partial<PlanoRemoto>): void {
    const p = this.planos.get(id);
    if (p !== undefined) this.planos.set(id, recalcular({ ...p, ...patch }));
  }
  async executarPlano(plano_id: string, a: { aprovado_por: string; args_hash: string }): Promise<{ iniciado: boolean; mission_id?: string; motivo?: string }> {
    this.execucoes.push({ plano_id, ...a });
    const p = this.planos.get(plano_id);
    if (p === undefined || p.args_hash !== a.args_hash) return { iniciado: false, motivo: "args_hash" };
    return { iniciado: true, mission_id: `mis_${this.execucoes.length}` };
  }
  async pararPlano(id: string): Promise<boolean> {
    this.paradas.push(id);
    return true;
  }
  estadoPlano(): "proposto" {
    return "proposto";
  }
}

export interface ConsultaFalsa extends PortaConsulta {
  chamadas: Array<{ metodo: string; workspaces: string[] }>;
  tarefas: Record<string, LinhaTarefaConsulta[]>;
}
export function consultaFalsa(): ConsultaFalsa {
  const c: ConsultaFalsa = {
    chamadas: [],
    tarefas: { w1: [{ task_id: "T-1", titulo: "Corrigir login", story_points: 3, tempo_trabalho_ms: 1_800_000, tokens: 5000, atraso_ms: 120_000, limite_ms: 1_200_000, quem: "claude" }], w2: [{ task_id: "T-SECRETA", titulo: "Workspace não permitido", story_points: null, tempo_trabalho_ms: null, tokens: null }] },
    async missoesAtivas(ws) {
      c.chamadas.push({ metodo: "missoes", workspaces: ws });
      return ws.includes("w1") ? [{ id: "m1", titulo: "Login", workspace_id: "w1", panes_trabalhando: 1, panes_aguardando: 0 }] : [];
    },
    async tarefasEmAndamento(ws) {
      c.chamadas.push({ metodo: "tarefas", workspaces: ws });
      return ws.flatMap((w) => c.tarefas[w] ?? []);
    },
    async atrasadas(ws) {
      c.chamadas.push({ metodo: "atrasadas", workspaces: ws });
      return ws.flatMap((w) => c.tarefas[w] ?? []).filter((t) => (t.atraso_ms ?? 0) > 0);
    },
    cotaGeralPct: () => 42,
    consumo: async () => [{ conta: "conta-a", provedor: "claude", pct: 42 }],
    alertasCriticosNaoLidos: () => 1,
    nomeWorkspace: (w) => ({ w1: "App Web", w2: "Outro" })[w] ?? null,
  };
  return c;
}

export interface Cenario {
  falso: TelegramFalso;
  rede: RedeTeste;
  repo: RepoTelegram;
  relogio: RelogioFalso;
  dormir: DormirFalso;
  servico: ServicoTelegram;
  orq: OrquestradorFalso;
  consulta: ConsultaFalsa;
  regras: ReturnType<typeof criarRepoRegrasMemoria>;
  alertas: EntradaAlerta[];
  eventos: EventoServico[];
  rigidezExige: { exige: boolean; falhar: boolean };
  gates: GatePendente[];
  gatesDecididos: Array<{ id: string; decisao: string; origem: string }>;
  canal: { estado: EstadoCanal; desligado: number };
  consentimento: { ok: boolean };
  silencios: Array<{ ate: string | null; criticos: boolean }>;
  /** pareia `user_id` pelo fluxo real (código -> /start -> Permitir no desktop). */
  parear(user_id: number, o?: { workspaces?: Array<{ workspace_id: string; modo: ModoWorkspaceTelegram; padrao?: boolean }>; nome?: string }): Promise<{ autorizado_id: string; usuario: UsuarioFalso }>;
  ligar(forcar?: boolean): void;
  botMensagens(chat_id: number): MensagemFalsa[];
  esperarBot(chat_id: number, n: number, ms?: number): Promise<MensagemFalsa[]>;
  esperarOcioso(): Promise<void>;
  fechar(): Promise<void>;
}

export async function montarCenario(o: { deps?: Partial<DepsServicoTelegram>; escalaTempo?: number; limitesPadrao?: boolean } = {}): Promise<Cenario> {
  const relogio = relogioFalso();
  const falso = await subirTelegramFalso({ escalaTempo: o.escalaTempo ?? 100, agora: () => relogio.agora() });
  const rede = criarRedeDeTeste();
  const repo = criarRepoTelegramMemoria();
  const dormir = dormirFalso();
  const orq = new OrquestradorFalso();
  const consulta = consultaFalsa();
  const regras = criarRepoRegrasMemoria();
  const alertas: EntradaAlerta[] = [];
  const eventos: EventoServico[] = [];
  const rigidezExige = { exige: false, falhar: false };
  const rigidez: PortaRigidez = { exigeDesktop: () => { if (rigidezExige.falhar) throw new Error("porta fora"); return { exige: rigidezExige.exige, motivo: rigidezExige.exige ? "rigidez_do_workspace" : "" }; } };
  const gates: GatePendente[] = [];
  const gatesDecididos: Cenario["gatesDecididos"] = [];
  const portaGates: PortaGates = { pendentes: async (ws) => gates.filter((g) => ws.includes(g.workspace_id)), decidir: async (id, decisao, origem) => (gatesDecididos.push({ id, decisao, origem }), { ok: true }) };
  const canal = { estado: "ativo" as EstadoCanal, desligado: 0 };
  const consentimento = { ok: true };
  const silencios: Cenario["silencios"] = [];
  const travas = new Set<string>();
  const servico = criarServicoTelegram({
    canal_id: "c1",
    repo,
    rede,
    token: () => falso.token,
    consentimentoValido: () => consentimento.ok,
    host: "127.0.0.1",
    porta: falso.porta,
    relogio,
    dormir,
    aleatorio: () => 0.5,
    orquestrador: orq,
    rigidez,
    consulta,
    gates: portaGates,
    regras,
    alertas: { emitir: (e) => void alertas.push(e) },
    estadoCanal: () => canal.estado,
    desligarCanal: () => {
      canal.estado = "desligado";
      canal.desligado++;
    },
    silenciarCanal: (ate, criticos) => void silencios.push({ ate, criticos }),
    eventos: (e) => void eventos.push(e),
    travas,
    // por padrão o limite de taxa é folgado (os testes não esperam o relógio); `limitesPadrao: true` usa os limites reais
    ...(o.limitesPadrao === true ? {} : { config: { msg_por_min: 6000, rajada_msg: 1000 } }),
    ...(o.deps ?? {}),
  });
  const c: Cenario = {
    falso, rede, repo, relogio, dormir, servico, orq, consulta, regras, alertas, eventos, rigidezExige, gates, gatesDecididos, canal, consentimento, silencios,
    async parear(user_id, op = {}) {
      const usuario = falso.usuario(user_id, { nome: op.nome ?? `Pessoa ${user_id}`, username: `u${user_id}` });
      const { codigo } = servico.iniciarPareamento();
      usuario.enviar(`/start ${codigo.replace("-", "")}`);
      // o pareamento é tratado pelo `tratar` do poller; para não exigir o poller ligado aqui, drena direto
      const ups = await servico.api.getUpdates({ timeout: 0 });
      for (const u of ups) await servico.entrada.tratar(u);
      if (ups.length > 0) await servico.api.getUpdates({ offset: Math.max(...ups.map((u) => u.update_id)) + 1, timeout: 0 });
      const pedido = eventos.filter((e): e is Extract<EventoServico, { tipo: "pareamento" }> => e.tipo === "pareamento" && e.pedido !== undefined).at(-1)?.pedido;
      if (pedido === undefined) throw new Error("pareamento não gerou pedido");
      const aut = await servico.decidirPareamento(pedido.pedido_id, true);
      if (aut === null) throw new Error("pareamento negado");
      const ws = op.workspaces ?? [{ workspace_id: "w1", modo: "aprovar" as const, padrao: true }];
      await servico.configurarAutorizado(aut.id, { workspaces: ws.map((w) => ({ workspace_id: w.workspace_id, modo: w.modo, padrao: w.padrao ?? false })), confirmacao: "DIRETO" });
      return { autorizado_id: aut.id, usuario };
    },
    ligar(forcar = false) {
      if (forcar) return void servico.poller.iniciar();
      const r = servico.ligarEntrada();
      if (!r.ok) throw new Error(`ligarEntrada: ${r.erro}`);
    },
    botMensagens: (chat_id) => falso.mensagens.filter((m) => m.chat_id === chat_id),
    async esperarBot(chat_id, n, ms = 3000) {
      await esperarAte(() => c.botMensagens(chat_id).length >= n, ms);
      return c.botMensagens(chat_id);
    },
    async esperarOcioso() {
      await esperarAte(() => falso.pendentes() === 0 && falso.getUpdatesAbertos() === 1, 3000);
      await new Promise((r) => setTimeout(r, 20));
    },
    async fechar() {
      await servico.poller.parar();
      await falso.fechar();
    },
  };
  return c;
}
