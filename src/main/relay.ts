// Ligação do relay no main (Fase 22, T-22.21). SOB DEMANDA e desligado por padrão: este módulo só é importado (dinamicamente) pelo boot da onda 2 para registrar os canais `relay:*`;
// o NÚCLEO (`nucleo/remoto-estendido`, `ws-cliente`, relay-cliente) só entra por `import()` no primeiro canal chamado, e NENHUM socket/timer existe antes de `relay:ligar` com consentimento
// versionado + reconhecimento «experimental» + URL `wss://` (P-160). Reiniciar o app deixa o relay desligado; `habilitado` nunca é persistido como `true` (AX-17/AX-34).
import { ESTADO_RELAY_PADRAO, type ApiRelay, type ConfigRelay, type EstadoRelay } from "../compartilhado/relay";
import type { Banco } from "../nucleo/banco";
import type { PortaSegredos } from "../nucleo/remoto/identidade";
import type { ServicoRelay } from "../nucleo/remoto-estendido/servico";
import type { ServicoRemoto } from "../nucleo/remoto/servico";
import type { PreferenciasLigacaoJarvis } from "./jarvis";

/** porta do cofre do SO: `ler`/`gravar` por NOME; `apagar` remove a entrada (o valor vazio não é aceito pelo cofre). */
export interface PortaSegredosRelay extends PortaSegredos {
  apagar(nome: string): Promise<void>;
}
export interface DepsLigacaoRelay {
  banco: Banco;
  prefs: PreferenciasLigacaoJarvis;
  /** o serviço remoto da Fase 13 (identidade, dispositivos, tratador de protocolo); carregado sob demanda. */
  remoto: () => Promise<ServicoRemoto>;
  segredos: PortaSegredosRelay;
  emitirRenderer(canal: "relay:evento", payload: EstadoRelay): void;
  /** hash esperado (32 hex) do shell do PWA, se este build o conhece. */
  impressaoPwaEsperada?: () => string | null;
  /** alertas (Fase 20): só o nome do evento. */
  aoEvento?: (tipo: string, dispositivoId: string | null) => void;
  aviso?: (m: string) => void;
}
export interface LigacaoRelay {
  api: ApiRelay;
  /** o relay está ligado (bandeja/rodapé)? Nunca carrega o núcleo. */
  relayLigado(): boolean;
  /** pânico: igual ao do controle remoto e ainda fecha todos os sockets do relay. Sem núcleo montado, não há o que fechar. */
  panico(): Promise<void>;
  encerrar(): Promise<void>;
}

export function ligarRelay(d: DepsLigacaoRelay): LigacaoRelay {
  let nucleo: Promise<ServicoRelay> | null = null;
  let pronto: ServicoRelay | null = null;
  const configAtual = async (): Promise<ConfigRelay> => (await import("../nucleo/remoto-estendido/config")).lerConfigRelay(d.prefs.obter("relay_config"));

  async function montar(): Promise<ServicoRelay> {
    const [{ criarServicoRelay }, { lerConfigRelay }, { criarRepoRelay }, { carregarIdentidade }] = await Promise.all([import("../nucleo/remoto-estendido/servico"), import("../nucleo/remoto-estendido/config"), import("../nucleo/remoto-estendido/repo"), import("../nucleo/remoto/identidade")]);
    const relogio = { agora: () => Date.now() };
    const remoto = await d.remoto();
    const cfg = (): ConfigRelay => lerConfigRelay(d.prefs.obter("relay_config"));
    const svc = criarServicoRelay({
      remoto,
      repo: criarRepoRelay({ banco: d.banco, relogio }),
      identidade: () => carregarIdentidade(d.segredos),
      segredos: d.segredos,
      relogio,
      config: cfg,
      gravarConfig: (patch) => void d.prefs.definir("relay_config", { ...cfg(), ...patch, habilitado: false, experimental: true }),
      agendar: (fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return () => clearTimeout(t);
      },
      ...(d.impressaoPwaEsperada === undefined ? {} : { impressaoPwaEsperada: d.impressaoPwaEsperada }),
      aoMudar: (e) => d.emitirRenderer("relay:evento", e),
      aoEvento: (tipo, id) => d.aoEvento?.(tipo, id),
    });
    pronto = svc;
    return svc;
  }
  const obter = (): Promise<ServicoRelay> => (nucleo ??= montar().catch((e: unknown) => {
    nucleo = null;
    throw e;
  }));

  const api: ApiRelay = {
    // leitura barata: sem núcleo montado, o relay é «desligado» e nada é carregado
    estado: async () => (pronto === null ? { ...ESTADO_RELAY_PADRAO } : pronto.estado()),
    configObter: async () => (pronto === null ? configAtual() : pronto.config()),
    async configDefinir(patch) {
      // com o relay desligado e sem pedir para ligar, grava SEM montar o núcleo (nada do relay é importado só por mexer na configuração)
      if (pronto === null && (patch as { habilitado?: unknown }).habilitado !== true) {
        const [{ validarConfigRelayParcial }, { lerConfigRelay }] = await Promise.all([import("../compartilhado/relay"), import("../nucleo/remoto-estendido/config")]);
        const v = validarConfigRelayParcial(patch);
        if (!v.ok) throw new Error("configuração recusada");
        const { habilitado: _h, ...resto } = v.valor;
        void _h;
        const atual = lerConfigRelay(d.prefs.obter("relay_config"));
        await d.prefs.definir("relay_config", { ...atual, ...resto, habilitado: false, experimental: true });
        return lerConfigRelay(d.prefs.obter("relay_config"));
      }
      const r = await (await obter()).configDefinir(patch);
      if ("erro" in r) throw new Error("configuração recusada");
      return r;
    },
    ligar: async () => (await obter()).ligar(),
    desligar: async () => (pronto === null ? { ok: true } : pronto.desligar()),
    parearIniciar: async () => (await obter()).parearIniciar(),
    parearSas: async () => (pronto === null ? { situacao: "fechado" as const, sas: null, nome_dispositivo: null } : pronto.parearSas()),
    parearDecidir: async (permitir) => (pronto === null ? { ok: false } : pronto.parearDecidir(permitir)),
    // sem núcleo montado: lista direto do serviço remoto (sem sockets, sem importar o cliente do relay)
    async dispositivos() {
      if (pronto !== null) return pronto.dispositivos();
      const [{ visaoDispositivos }, { criarRepoRelay }] = await Promise.all([import("../nucleo/remoto-estendido/servico"), import("../nucleo/remoto-estendido/repo")]);
      return visaoDispositivos((await d.remoto()).estado().dispositivos, criarRepoRelay({ banco: d.banco, relogio: { agora: () => Date.now() } }));
    },
    async revogar(id) {
      if (pronto !== null) return pronto.revogar(id);
      // sem núcleo montado: dispositivo que só usa a LAN revoga direto; quem TEM canal no relay passa pelo serviço, que apaga o segredo do cofre (A-08)
      const { criarRepoRelay } = await import("../nucleo/remoto-estendido/repo");
      if (criarRepoRelay({ banco: d.banco, relogio: { agora: () => Date.now() } }).obter(id) !== null) return (await obter()).revogar(id);
      return { ok: await (await d.remoto()).revogar(id) };
    },
    panico: async () => (await obter()).panico(),
    assinar: () => () => undefined, // o renderer assina pelo preload; esta ponta só existe para o contrato
  };
  return {
    api,
    relayLigado: () => pronto?.estado().ligado === true,
    async panico() {
      if (pronto === null) return;
      await pronto.panico();
    },
    async encerrar() {
      const n = nucleo === null ? null : await nucleo.catch(() => null);
      nucleo = null;
      pronto = null;
      await n?.desligar(); // o relay nunca sobrevive ao app
    },
  };
}
