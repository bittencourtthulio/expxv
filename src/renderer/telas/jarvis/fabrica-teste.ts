// APIs FALSAS da tela Jarvis (testes): sem Electron, sem rede. Contadores via vi.fn; eventos disparáveis.
import { vi } from "vitest";
import { ACOES_JARVIS, CONFIG_JARVIS_PADRAO, CONFIG_REMOTO_PADRAO, RISCO_DA_ACAO, type ApiJarvis, type ApiRemoto, type ConfirmacaoVisao, type DispositivoVisao, type EstadoJarvis, type EstadoRemoto, type ResultadoJarvis } from "../../../compartilhado/jarvis";

export const estadoJarvisFalso = (p: Partial<EstadoJarvis> = {}): EstadoJarvis => ({
  config: { ...CONFIG_JARVIS_PADRAO, ligado: true },
  confirmacoes: [],
  turnos: [],
  acoes: ACOES_JARVIS.map((a) => ({ acao: a, risco: RISCO_DA_ACAO[a] })),
  ...p,
});
export const confirmacaoFalsa = (p: Partial<ConfirmacaoVisao> = {}): ConfirmacaoVisao => ({ id: "cnf_abc123456", acao: "enviar_prompt", resumo: "Enviar ao Maestro: «finalizar a publicação»", expira_em: new Date(Date.now() + 30_000).toISOString(), ator: "jarvis", dispositivo: null, dispositivo_id: null, resolvivel_por: "desktop", ...p });
export const dispositivoFalso = (p: Partial<DispositivoVisao> = {}): DispositivoVisao => ({ id: "dev_abc123456", nome: "iPhone do Thulio", permissao: "leitura", criado_em: "2026-10-01T10:00:00Z", ultimo_uso_em: "2026-10-01T11:00:00Z", ultimo_ip: "192.168.1.9", expira_em: "2026-10-31T10:00:00Z", revogado_em: null, conectado: false, ...p });
export const estadoRemotoFalso = (p: Partial<EstadoRemoto> = {}): EstadoRemoto => ({
  transporte: { ligado: false, transporte: null, endereco: null, porta: null, persistido: false, pareando: false, codigo_expira_em: null, conectados: 0, ultimo_erro: null },
  dispositivos: [],
  pendentes: [],
  config: { ...CONFIG_REMOTO_PADRAO },
  sas: null,
  interfaces: [{ nome: "en0", ip: "192.168.1.20", privado: true }, { nome: "utun1", ip: "8.8.8.8", privado: false }],
  ...p,
});
export const respostaFalsa = (texto: string, linhas: Array<{ rotulo: string; detalhe?: string }> = [], nao_confiavel = false): ResultadoJarvis => ({ tipo: "resposta", resposta: { texto, linhas, nao_confiavel } });

export interface ApiJarvisFalsa extends ApiJarvis {
  emitir(): void;
}
export function apiJarvisFalsa(o: { estado?: EstadoJarvis; enviar?: ResultadoJarvis; erro?: boolean } = {}): ApiJarvisFalsa {
  const ouvintes = new Set<(e: { tipo: "estado" | "confirmacao_pendente" | "resolvida" }) => void>();
  let estado = o.estado ?? estadoJarvisFalso();
  return {
    estado: vi.fn(async () => {
      if (o.erro === true) throw new Error("falha de leitura");
      return estado;
    }),
    configGravar: vi.fn(async (patch) => (estado = { ...estado, config: { ...estado.config, ...patch } })),
    enviar: vi.fn(async () => o.enviar ?? respostaFalsa("ok")),
    acao: vi.fn(async () => respostaFalsa("ok")),
    confirmar: vi.fn(async () => ({ ok: true, resultado: respostaFalsa("Pedido enviado ao Maestro."), codigo: null })),
    historico: vi.fn(async () => ({ itens: [], proximo: null })),
    limparConversa: vi.fn(async () => (estado = { ...estado, turnos: [] })),
    assinar: (cb) => {
      ouvintes.add(cb);
      return () => void ouvintes.delete(cb);
    },
    assinarNavegacao: () => () => undefined,
    emitir: () => ouvintes.forEach((f) => f({ tipo: "estado" })),
  };
}
export interface ApiRemotoFalsa extends ApiRemoto {
  definirEstado(e: EstadoRemoto): void;
  emitir(): void;
}
export function apiRemotoFalsa(o: { estado?: EstadoRemoto; erro?: boolean } = {}): ApiRemotoFalsa {
  let estado = o.estado ?? estadoRemotoFalso();
  const ouvintes = new Set<(e: { tipo: "mudou" | "sas" | "pedido_pendente" }) => void>();
  const ligado = (): EstadoRemoto => ({ ...estado, transporte: { ...estado.transporte, ligado: true, transporte: "lan", endereco: "192.168.1.20", porta: 51000 } });
  return {
    estado: vi.fn(async () => {
      if (o.erro === true) throw new Error("falha de leitura");
      return estado;
    }),
    ligar: vi.fn(async () => (estado = ligado())),
    desligar: vi.fn(async () => (estado = estadoRemotoFalso({ dispositivos: estado.dispositivos }))),
    configGravar: vi.fn(async () => estado),
    parearIniciar: vi.fn(async () => ({ codigo: "ABCD-EFGH-JKLM", expira_em: new Date(Date.now() + 120_000).toISOString() })),
    parearCancelar: vi.fn(async () => true),
    parearConfirmarSas: vi.fn(async () => dispositivoFalso()),
    revogar: vi.fn(async () => true),
    permissaoDefinir: vi.fn(async (p) => dispositivoFalso({ permissao: p.permissao })),
    aprovarPedido: vi.fn(async () => true),
    panico: vi.fn(async () => (estado = estadoRemotoFalso())),
    auditoria: vi.fn(async () => ({ itens: [], proximo: null })),
    assinar: (cb) => {
      ouvintes.add(cb);
      return () => void ouvintes.delete(cb);
    },
    definirEstado: (e) => void (estado = e),
    emitir: () => ouvintes.forEach((f) => f({ tipo: "mudou" })),
  };
}

// ---- Relay (Fase 22)
import { CONFIG_RELAY_PADRAO, ESTADO_RELAY_PADRAO, type ApiRelay, type ConfigRelay, type DispositivoRelay, type EstadoRelay, type PareamentoRelayAberto, type SasRelayVisao } from "../../../compartilhado/relay";

export const estadoRelayFalso = (p: Partial<EstadoRelay> = {}): EstadoRelay => ({ ...ESTADO_RELAY_PADRAO, ...p });
export const dispositivoRelayFalso = (p: Partial<DispositivoRelay> = {}): DispositivoRelay => ({ id: "dev_relay1234", nome: "iPhone do Thulio", permissao: "leitura", transporte: "relay", ultimo_visto_em: "2026-10-01T11:00:00Z", revogado_em: null, conectado: false, ...p });
export const pareamentoRelayFalso = (p: Partial<PareamentoRelayAberto> = {}): PareamentoRelayAberto => ({ qr: "https://pwa.exemplo.dev/app#r=wss%3A%2F%2Frelay.exemplo.com&c=ABCDEFGHJKLM&h=0123456789abcdef0123456789abcdef&p=", codigo: "ABCD-EFGH-JKLM", expira_em: new Date(Date.now() + 120_000).toISOString(), impressao_host: "0123 4567 89ab cdef 0123 4567 89ab cdef", impressao_cliente_esperada: null, ...p });
export interface ApiRelayFalsa extends ApiRelay {
  definir(o: { estado?: EstadoRelay; sas?: SasRelayVisao; dispositivos?: DispositivoRelay[]; pareamento?: PareamentoRelayAberto | { erro: "relay_desligado" | "ja_pareando" | "falhou" } }): void;
  emitir(): void;
}
export function apiRelayFalsa(o: { estado?: EstadoRelay; config?: Partial<ConfigRelay>; dispositivos?: DispositivoRelay[]; erro?: boolean; ligar?: { ok: boolean; motivo?: "url_invalida" | "falhou" } } = {}): ApiRelayFalsa {
  let estado = o.estado ?? estadoRelayFalso();
  let config: ConfigRelay = { ...CONFIG_RELAY_PADRAO, ...o.config };
  let dispositivos = o.dispositivos ?? [];
  let sas: SasRelayVisao = { situacao: "fechado", sas: null, nome_dispositivo: null };
  let pareamento: PareamentoRelayAberto | { erro: "relay_desligado" | "ja_pareando" | "falhou" } = pareamentoRelayFalso();
  const ouvintes = new Set<(e: EstadoRelay) => void>();
  return {
    estado: vi.fn(async () => {
      if (o.erro === true) throw new Error("falha de leitura");
      return estado;
    }),
    configObter: vi.fn(async () => config),
    configDefinir: vi.fn(async (p) => (config = { ...config, ...p })),
    ligar: vi.fn(async () => {
      const r = o.ligar ?? { ok: true };
      if (r.ok) estado = estadoRelayFalso({ ligado: true, situacao: "ocioso", url: config.url });
      return r;
    }),
    desligar: vi.fn(async () => ((estado = estadoRelayFalso()), { ok: true })),
    parearIniciar: vi.fn(async () => {
      sas = { situacao: "aguardando_celular", sas: null, nome_dispositivo: null };
      return pareamento;
    }),
    parearSas: vi.fn(async () => sas),
    parearDecidir: vi.fn(async (permitir: boolean) => {
      sas = { situacao: permitir ? "aguardando_celular" : "negado", sas: null, nome_dispositivo: null };
      return { ok: permitir };
    }),
    dispositivos: vi.fn(async () => dispositivos),
    revogar: vi.fn(async () => ((dispositivos = dispositivos.map((d) => ({ ...d, revogado_em: "2026-10-01T12:00:00Z" }))), { ok: true })),
    panico: vi.fn(async () => ((estado = estadoRelayFalso()), { ok: true })),
    assinar: (cb) => {
      ouvintes.add(cb);
      return () => void ouvintes.delete(cb);
    },
    definir: (p) => {
      if (p.estado !== undefined) estado = p.estado;
      if (p.sas !== undefined) sas = p.sas;
      if (p.dispositivos !== undefined) dispositivos = p.dispositivos;
      if (p.pareamento !== undefined) pareamento = p.pareamento;
    },
    emitir: () => ouvintes.forEach((f) => f(estado)),
  };
}
