// Cenário de teste do controle remoto (Fase 13): serviço REAL de servidor em loopback + Jarvis com portas falsas + banco em memória + cofre falso. Cliente de teste em
// `tests/fixtures/jarvis/cliente-remoto.ts`. Nenhuma rede externa, processo ou Electron.
import { ClienteRemoto } from "./cliente-remoto";
import { CONFIG_REMOTO_PADRAO, TEXTO_CONSENTIMENTO_REMOTO_VERSAO, type ConfigRemoto, type DispositivoVisao, type PermissaoRemota } from "../../../src/compartilhado/jarvis";
import { criarCenarioJarvis, type CenarioJarvis } from "./cenario-jarvis";
import { criarArmazemDispositivos } from "../../../src/nucleo/remoto/dispositivos";
import { carregarIdentidade, type PortaSegredos } from "../../../src/nucleo/remoto/identidade";
import { criarServicoRemoto, type DepsServicoRemoto, type ServicoRemoto } from "../../../src/nucleo/remoto/servico";

export interface CenarioRemoto {
  j: CenarioJarvis;
  relogio: { agora(): number; avancar(ms: number): void };
  servico: ServicoRemoto;
  config: ConfigRemoto;
  segredos: Map<string, string>;
  porta(): number;
  ligar(): Promise<void>;
  parear(permissao?: PermissaoRemota, o?: { confirmacao?: string | null }): Promise<{ cliente: ClienteRemoto; dispositivo: DispositivoVisao }>;
  sessao(permissao?: PermissaoRemota): Promise<ClienteRemoto>;
  eventos: string[];
  estadoTela: { bloqueada: boolean };
  fechar(): Promise<void>;
}

/** relógio que anda em tempo real e permite saltar adiante (o cliente de teste assina `ts` com `Date.now()`). */
export function relogioMovel(): { agora(): number; avancar(ms: number): void } {
  let desvio = 0;
  return { agora: () => Date.now() + desvio, avancar: (ms) => void (desvio += ms) };
}

export function criarCenarioRemoto(op: { config?: Partial<ConfigRemoto>; deps?: Partial<DepsServicoRemoto> } = {}): CenarioRemoto {
  const estadoTela = { bloqueada: false };
  const j = criarCenarioJarvis({ deps: { telaBloqueada: () => estadoTela.bloqueada } });
  const config: ConfigRemoto = { ...CONFIG_REMOTO_PADRAO, ...op.config };
  const segredos = new Map<string, string>();
  const portaSegredos: PortaSegredos = { ler: async (n) => segredos.get(n) ?? null, gravar: async (n, v) => void segredos.set(n, v) };
  const eventos: string[] = [];
  const relogio = relogioMovel();
  const dispositivos = criarArmazemDispositivos({ banco: j.banco, relogio, validade_dias: () => config.validade_dispositivo_dias });
  const servico = criarServicoRemoto({
    relogio,
    jarvis: j.servico,
    dispositivos,
    auditoria: j.auditoria,
    identidade: () => carregarIdentidade(portaSegredos),
    config: () => config,
    gravarConfig: (p) => void Object.assign(config, p),
    interfaces: () => [{ nome: "en0", ip: "192.168.1.20" }, { nome: "utun1", ip: "8.8.8.8" }],
    telaBloqueada: () => estadoTela.bloqueada,
    aoMudar: (t) => eventos.push(t),
    portaAleatoria: () => 0,
    ...op.deps,
  });
  const porta = (): number => servico.estado().transporte.porta as number;
  const ligar = async (): Promise<void> => {
    const r = await servico.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO });
    if ("erro" in r) throw new Error(`ligar falhou: ${r.erro}`);
  };
  const parear: CenarioRemoto["parear"] = async (permissao = "leitura", o = {}) => {
    const p = servico.parearIniciar(permissao);
    if ("erro" in p) throw new Error(`parear falhou: ${p.erro}`);
    const cliente = new ClienteRemoto("127.0.0.1", porta());
    const ini = await cliente.iniciarPareamento(p.codigo);
    if (!ini.ok) throw new Error(`pareamento falhou em ${ini.etapa} (${ini.status})`);
    const sasDesktop = servico.estado().sas;
    if (sasDesktop !== ini.sas) throw new Error("SAS diferente entre desktop e celular");
    const dispositivo = servico.parearConfirmarSas({ igual: true, confirmacao_permissao: o.confirmacao === undefined ? (permissao === "mensagem_direta" ? "PERMITIR" : null) : o.confirmacao });
    if (dispositivo === null) throw new Error("desktop não confirmou");
    if (!(await cliente.concluirPareamento(ini.hid, ini.chaves))) throw new Error("celular não concluiu o pareamento");
    return { cliente, dispositivo };
  };
  const sessao: CenarioRemoto["sessao"] = async (permissao = "leitura") => {
    const { cliente, dispositivo } = await parear(permissao);
    if (permissao !== "leitura" && dispositivo.permissao !== permissao) throw new Error("permissão não aplicada");
    const r = await cliente.abrirSessao();
    if (!r.ok) throw new Error(`sessão falhou (${r.status})`);
    return cliente;
  };
  return {
    j,
    relogio,
    servico,
    config,
    segredos,
    porta,
    ligar,
    parear,
    sessao,
    eventos,
    estadoTela,
    async fechar() {
      await servico.desligar("teste");
      j.fechar();
    },
  };
}
