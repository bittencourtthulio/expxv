// Serviço do relay no host (T-22.21, núcleo; o main o monta SOB DEMANDA, depois do consentimento). Reúne: ligar/desligar (consentimento versionado + reconhecimento «experimental» + URL `wss://`),
// um cliente por dispositivo (canal rotativo, E2E por dentro, MESMO tratador da Fase 13), o canal EFÊMERO do pareamento, revogação e pânico. Garantias:
//  * desligado = 0 sockets e 0 timers (nada é criado antes de `ligar`); NUNCA religa sozinho e `habilitado` nunca é persistido como `true` (AX-17/AX-34);
//  * a decisão humana (SAS, «Permitir», aprovação de pedidos) é SEMPRE no desktop (D-21); o dispositivo nasce `leitura` (AX-28);
//  * relay fora do ar = «indisponível», nunca revogação, e nenhuma exceção escapa (AX-30);
//  * eventos só com nome (sem IP, sem `canal_id`, sem conteúdo).
import {
  ESTADO_RELAY_PADRAO,
  PERMISSAO_INICIAL_RELAY,
  TEXTO_CONSENTIMENTO_RELAY_VERSAO,
  validarConfigRelayParcial,
  validarUrlRelay,
  type ConfigRelay,
  type DispositivoRelay,
  type ErroLigarRelay,
  type EstadoRelay,
  type PareamentoRelayAberto,
  type SasRelayVisao,
  type SituacaoPareamentoRelay,
  type SituacaoRelay,
  type TipoEventoRelay,
} from "../../compartilhado/relay";
import type { EstadoRemoto, PermissaoRemota } from "../../compartilhado/jarvis";
import type { IdentidadeServidor, PortaSegredos } from "../remoto/identidade";
import type { Tratador } from "../remoto/tratador";
import { chaveEnvelope, epocaDe } from "./canal";
import { lerConfigRelay } from "./config";
import { criarClienteRelay, type ClienteRelay, type EstadoCliente } from "./cliente-relay";
import { impressaoDaIdentidade, impressaoHex } from "./impressao-digital";
import { chaveEfemera, criarMensagemRelay, montarLink, nomeSegredoCanal, segredoEfemero } from "./pareamento-relay";
import type { RepoRelay } from "./repo";
import { criarRevogacao, type Revogacao } from "./revogacao";
import { criarTransporteRelay } from "./transporte-relay";
import { abrirWs as abrirWsReal, type ConexaoWs, type OpcoesWs } from "./ws-cliente";

const LOOPBACK_TESTE = /^ws:\/\/127\.0\.0\.1:\d{1,5}(?:\/[A-Za-z0-9._~\-/]*)?$/;
/** `wss://` válido; `ws://127.0.0.1` só com NODE_ENV=test (como o `ws-cliente`: uma só regra de exceção). */
export const urlAceita = (url: string, ambiente: string | undefined = process.env["NODE_ENV"]): boolean => validarUrlRelay(url) || (ambiente === "test" && LOOPBACK_TESTE.test(url));
/** porta estreita do serviço remoto da Fase 13 (o `ServicoRemoto` real a satisfaz). */
export interface PortaRemoto {
  prepararRelay(): Promise<boolean>;
  liberarRelay(): void;
  tratador(): Tratador;
  parearIniciar(p: PermissaoRemota): { codigo: string; expira_em: string } | { erro: string };
  parearCancelar(): boolean;
  parearConfirmarSas(p: { igual: boolean; confirmacao_permissao: string | null }): { id: string; nome: string; permissao: PermissaoRemota } | null;
  estado(): Pick<EstadoRemoto, "sas" | "dispositivos" | "transporte">;
  revogar(id: string): Promise<boolean>;
  panico(): Promise<unknown>;
  chaveDoDispositivo(id: string): Buffer | null;
  aoRevogarDispositivo(cb: (id: string) => void): void;
  registrarMensagemRelay(f: ReturnType<typeof criarMensagemRelay> | null): void;
}
export interface DepsServicoRelay {
  remoto: PortaRemoto;
  repo: RepoRelay;
  identidade: () => Promise<IdentidadeServidor>;
  segredos: PortaSegredos & { apagar?: (nome: string) => Promise<void> };
  relogio: { agora(): number };
  config: () => ConfigRelay;
  gravarConfig: (patch: Partial<ConfigRelay>) => void;
  agendar: (fn: () => void, ms: number) => () => void;
  abrirWs?: (o: OpcoesWs) => ConexaoWs;
  aleatorio?: () => number;
  bytes?: (n: number) => Buffer;
  /** hash esperado (32 hex) do shell do PWA, se o host o conhece. */
  impressaoPwaEsperada?: () => string | null;
  aoMudar?: (e: EstadoRelay) => void;
  /** alertas (Fase 20): só o nome do evento. */
  aoEvento?: (tipo: TipoEventoRelay, dispositivoId: string | null) => void;
}

export interface ServicoRelay {
  estado(): EstadoRelay;
  config(): ConfigRelay;
  configDefinir(patch: unknown): Promise<ConfigRelay | { erro: string }>;
  ligar(): Promise<{ ok: boolean; motivo?: ErroLigarRelay }>;
  desligar(): Promise<{ ok: boolean }>;
  parearIniciar(): Promise<PareamentoRelayAberto | { erro: "relay_desligado" | "ja_pareando" | "falhou" }>;
  parearSas(): SasRelayVisao;
  parearDecidir(permitir: boolean): Promise<{ ok: boolean }>;
  dispositivos(): DispositivoRelay[];
  revogar(id: string): Promise<{ ok: boolean }>;
  panico(): Promise<{ ok: boolean }>;
  /** só para teste: quantos sockets/timers o serviço mantém. */
  _recursos(): { clientes: number; efemero: boolean; timers: number };
}

type DispositivoVisaoRemoto = Pick<EstadoRemoto["dispositivos"][number], "id" | "nome" | "permissao" | "ultimo_uso_em" | "revogado_em" | "conectado">;
/** lista os dispositivos com o transporte de cada um (sem relay_canal = `lan`). Barata e sem socket: o main a usa até com o relay desligado. */
export function visaoDispositivos(lista: readonly DispositivoVisaoRemoto[], repo: Pick<RepoRelay, "transporteDe">): DispositivoRelay[] {
  return lista.map((x) => ({ id: x.id, nome: x.nome, permissao: x.permissao, transporte: repo.transporteDe(x.id), ultimo_visto_em: x.ultimo_uso_em, revogado_em: x.revogado_em, conectado: x.conectado }));
}

export function criarServicoRelay(d: DepsServicoRelay): ServicoRelay {
  const abrirWs = d.abrirWs ?? abrirWsReal;
  const clientes = new Map<string, ClienteRelay>();
  const situacoes = new Map<string, EstadoCliente>();
  const recentes = new Map<string, number>();
  let ligado = false;
  let identidade: IdentidadeServidor | null = null;
  let efemero: ClienteRelay | null = null;
  let cancelarTimerPar: (() => void) | null = null;
  let resultadoPar: SituacaoPareamentoRelay = "fechado";
  let decidido = false;
  let ultimo = "";
  let operacao: Promise<unknown> = Promise.resolve();

  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const p = operacao.then(f, f);
    operacao = p.catch(() => undefined);
    return p;
  };
  const evento = (tipo: TipoEventoRelay, id: string | null = null, motivo: string | null = null): void => {
    try {
      d.repo.evento(tipo, id, motivo);
    } catch {
      /* auditoria nunca derruba o serviço */
    }
    try {
      d.aoEvento?.(tipo, id);
    } catch {
      /* callback do dono */
    }
  };
  const situacao = (): SituacaoRelay => {
    if (!ligado) return "desligado";
    const todos = [...situacoes.values()];
    if (todos.length === 0) return "ocioso";
    if (todos.some((s) => s === "registrado")) return "conectado";
    if (todos.some((s) => s === "indisponivel")) return "indisponivel";
    return "conectando";
  };
  const estado = (): EstadoRelay => {
    const s = situacao();
    return {
      ...ESTADO_RELAY_PADRAO,
      ligado,
      situacao: s,
      conectado: s === "conectado",
      url: ligado ? d.config().url : "",
      dispositivos: ligado ? d.remoto.estado().dispositivos.filter((x) => x.revogado_em === null && d.repo.obter(x.id) !== null).length : 0,
    };
  };
  const mudou = (): void => {
    const e = estado();
    const chave = JSON.stringify(e);
    if (chave === ultimo) return;
    ultimo = chave;
    try {
      d.aoMudar?.(e);
    } catch {
      /* ouvinte do dono */
    }
  };

  const apagarSegredo = async (nome: string): Promise<void> => void (await (d.segredos.apagar?.(nome) ?? d.segredos.gravar(nome, "")));
  const revogacao: Revogacao = criarRevogacao({
    clientes: clientes as never,
    efemero: () => efemero,
    cancelarPareamento: () => encerrarPareamento("fechado"),
    apagarSegredo: (nome) => apagarSegredo(nome),
    marcarRevogado: (id) => {
      situacoes.delete(id);
      d.repo.marcarRevogado(id);
    },
    evento: (tipo, id, motivo) => {
      evento(tipo, id, motivo);
      mudou();
    },
    revogarTodosNoHost: () => d.remoto.panico(),
    dispositivosComCanal: () => d.repo.listar().map((l) => l.dispositivo_id),
    aoMudar: mudou,
  });
  d.remoto.aoRevogarDispositivo((id) => {
    // com o relay desligado também: quem tem canal registrado perde o segredo do cofre na hora (A-08), não só no próximo `ligar`
    if (ligado || clientes.has(id) || d.repo.obter(id) !== null) revogacao.aoRevogado(id);
  });

  function encerrarPareamento(resultado: SituacaoPareamentoRelay): void {
    cancelarTimerPar?.();
    cancelarTimerPar = null;
    const e = efemero;
    efemero = null;
    situacoes.delete("__efemero");
    if (e !== null) e.fechar();
    if (resultado !== "concluido") {
      try {
        d.remoto.parearCancelar();
      } catch {
        /* sem pareamento aberto */
      }
    }
    resultadoPar = resultado;
    mudou();
  }

  const montarCliente = (o: { segredo: Buffer; chave: Buffer; clientePub?: Buffer; efemero?: boolean; chaveSituacao: string }): ClienteRelay => {
    const c = criarClienteRelay({
      url: d.config().url,
      segredo: o.segredo,
      identidade: identidade as IdentidadeServidor,
      ...(o.clientePub === undefined ? {} : { clientePub: o.clientePub }),
      ...(o.efemero === true ? { efemero: true } : {}),
      transporte: criarTransporteRelay({ tratador: d.remoto.tratador(), chave: o.chave, ...(d.bytes === undefined ? {} : { aleatorio: d.bytes }) }),
      relogio: d.relogio,
      agendar: d.agendar,
      abrirWs,
      ...(d.aleatorio === undefined ? {} : { aleatorio: d.aleatorio }),
      padding: d.config().padding,
      aoEstado: (e) => {
        situacoes.set(o.chaveSituacao, e);
        mudou();
      },
      aoEvento: (e) => {
        if (o.efemero === true) return;
        const id = o.chaveSituacao;
        if (e === "conectado") evento("conectado", id);
        else if (e === "desconectado") evento("desconectado", id);
        else if (e === "quadro_invalido") evento("quadro_invalido", id);
        else evento("relay_indisponivel", id);
      },
    });
    return c;
  };

  const iniciando = new Set<string>();
  async function iniciarCliente(id: string): Promise<boolean> {
    if (!ligado || clientes.has(id) || iniciando.has(id) || identidade === null) return false;
    iniciando.add(id); // reserva SÍNCRONA: dois pedidos seguidos nunca criam dois clientes (o primeiro ficaria órfão: A-03)
    try {
      const pub = d.remoto.chaveDoDispositivo(id);
      const bruto = await d.segredos.ler(nomeSegredoCanal(id));
      // o cofre pode demorar (prompt do Keychain): desligar, pânico ou revogação no meio do caminho valem (A-08)
      if (!ligado || clientes.has(id) || d.remoto.chaveDoDispositivo(id) === null || pub === null || bruto === null || bruto === "") return false;
      const segredo = Buffer.from(bruto, "base64");
      if (segredo.length !== 32) return false;
      const c = montarCliente({ segredo, chave: chaveEnvelope(segredo, "sessao"), clientePub: pub, chaveSituacao: id });
      clientes.set(id, c);
      situacoes.set(id, "parado");
      c.iniciar();
      d.repo.atualizarEpoca(id, epocaDe(d.relogio.agora()));
      return true;
    } finally {
      iniciando.delete(id);
    }
  }

  const mensagemRelay = criarMensagemRelay({
    canais: d.repo,
    segredos: d.segredos,
    relogio: d.relogio,
    recentes,
    ...(d.bytes === undefined ? {} : { bytes: d.bytes }),
    aoSegredoEntregue: (id) => {
      // o canal definitivo sobe agora; o efêmero encerra logo depois de a resposta sair (some no primeiro uso)
      void iniciarCliente(id).then(() => mudou());
      evento("pareamento_concluido", id);
      cancelarTimerPar?.();
      cancelarTimerPar = d.agendar(() => encerrarPareamento("concluido"), 750);
      resultadoPar = "concluido";
    },
    revogar: (id) => d.remoto.revogar(id),
    adiar: (fn, ms) => void d.agendar(fn, ms),
  });

  return {
    estado,
    config: () => d.config(),
    async configDefinir(patch) {
      const v = validarConfigRelayParcial(patch);
      if (!v.ok) return { erro: v.erro };
      const { habilitado, ...resto } = v.valor;
      const antes = d.config();
      // `habilitado` nunca é gravado: vira ligar/desligar (e o reconhecimento é consumido por `ligar`)
      if (ligado && resto.url !== undefined && resto.url !== antes.url) return { erro: "desligue_antes_de_trocar_a_url" };
      d.gravarConfig({ ...resto, habilitado: false, experimental: true });
      if (habilitado === true && !ligado) await this.ligar();
      if (habilitado === false && ligado) await this.desligar();
      mudou();
      return d.config();
    },
    ligar: () =>
      serial(async () => {
        if (ligado) return { ok: false, motivo: "ja_ligado" as const };
        const cfg = d.config();
        if (cfg.consentimento_versao !== TEXTO_CONSENTIMENTO_RELAY_VERSAO) return { ok: false, motivo: "consentimento_ausente" as const };
        if (!cfg.reconhecimento_experimental) return { ok: false, motivo: "reconhecimento_ausente" as const };
        if (!urlAceita(cfg.url)) return { ok: false, motivo: "url_invalida" as const };
        try {
          if (!(await d.remoto.prepararRelay())) return { ok: false, motivo: "falhou" as const };
          identidade = await d.identidade();
        } catch {
          return { ok: false, motivo: "falhou" as const };
        }
        ligado = true;
        d.remoto.registrarMensagemRelay(mensagemRelay);
        d.gravarConfig({ reconhecimento_experimental: false, habilitado: false, experimental: true }); // o reconhecimento vale por UMA ligação
        try {
          d.repo.purgar();
        } catch {
          /* retenção é oportunista */
        }
        evento("ligado");
        for (const l of d.repo.listar()) {
          if (d.remoto.chaveDoDispositivo(l.dispositivo_id) !== null && l.revogado_em === null) await iniciarCliente(l.dispositivo_id).catch(() => false);
          else {
            // revogado/expirado enquanto o relay estava desligado: o segredo de canal não pode sobrar no cofre
            if (l.revogado_em === null) d.repo.marcarRevogado(l.dispositivo_id);
            await apagarSegredo(nomeSegredoCanal(l.dispositivo_id)).catch(() => undefined);
          }
        }
        mudou();
        return { ok: true };
      }),
    desligar: () =>
      serial(async () => {
        if (!ligado) return { ok: true };
        ligado = false;
        for (const c of clientes.values()) c.fechar();
        clientes.clear();
        situacoes.clear();
        encerrarPareamento("fechado");
        recentes.clear();
        d.remoto.liberarRelay();
        evento("desligado");
        mudou();
        return { ok: true };
      }),
    parearIniciar: () =>
      serial(async () => {
        if (!ligado || identidade === null) return { erro: "relay_desligado" as const };
        if (efemero !== null) encerrarPareamento("fechado"); // um por vez: reabrir cancela o anterior (como a Fase 13)
        const r = d.remoto.parearIniciar(PERMISSAO_INICIAL_RELAY);
        if ("erro" in r) return { erro: "falhou" as const };
        const segredo = segredoEfemero(r.codigo);
        const c = montarCliente({ segredo, chave: chaveEfemera(r.codigo), efemero: true, chaveSituacao: "__efemero" });
        efemero = c;
        situacoes.set("__efemero", "parado");
        resultadoPar = "aguardando_celular";
        decidido = false;
        c.iniciar();
        cancelarTimerPar?.();
        const ttl = Math.max(1_000, Date.parse(r.expira_em) - d.relogio.agora()) + 60_000;
        cancelarTimerPar = d.agendar(() => {
          if (efemero === c) {
            evento("pareamento_falhou", null, "expirou");
            encerrarPareamento("expirado");
          }
        }, ttl);
        evento("pareamento_aberto");
        const cfg = d.config();
        const hostHex = impressaoHex(identidade.publicaSpki());
        const pwa = d.impressaoPwaEsperada?.() ?? null;
        mudou();
        return {
          qr: montarLink({ pwaOrigem: cfg.pwa_origem, relayUrl: cfg.url, codigo: r.codigo, impressaoHostHex: hostHex, impressaoPwaHex: pwa }),
          codigo: r.codigo,
          expira_em: r.expira_em,
          impressao_host: impressaoDaIdentidade(identidade.publicaSpki()),
          impressao_cliente_esperada: pwa === null ? null : pwa.match(/.{1,4}/g)?.join(" ") ?? null,
        };
      }),
    parearSas() {
      if (efemero !== null && !decidido) {
        const sas = d.remoto.estado().sas;
        if (sas !== null) return { situacao: "aguardando_decisao", sas, nome_dispositivo: null };
      }
      return { situacao: resultadoPar, sas: null, nome_dispositivo: null };
    },
    parearDecidir: (permitir) =>
      serial(async () => {
        if (efemero === null) return { ok: false };
        const r = d.remoto.parearConfirmarSas({ igual: permitir, confirmacao_permissao: null });
        if (!permitir || r === null) {
          if (!permitir) {
            evento("pareamento_falhou", null, "negado");
            encerrarPareamento("negado");
          }
          return { ok: false };
        }
        recentes.set(r.id, d.relogio.agora()); // só este dispositivo, e só agora, pode pedir o segredo de canal
        decidido = true;
        resultadoPar = "aguardando_celular";
        mudou();
        return { ok: true };
      }),
    dispositivos: () => visaoDispositivos(d.remoto.estado().dispositivos, d.repo),
    revogar: async (id) => {
      const ok = await d.remoto.revogar(id).catch(() => false); // o armazém avisa `aoRevogado`: fecha o canal, apaga o segredo, registra
      return { ok };
    },
    panico: () =>
      serial(async () => {
        const estava = ligado;
        ligado = false;
        await revogacao.panico();
        situacoes.clear();
        recentes.clear();
        efemero = null;
        cancelarTimerPar?.();
        cancelarTimerPar = null;
        resultadoPar = "fechado";
        d.remoto.liberarRelay();
        d.gravarConfig({ habilitado: false, reconhecimento_experimental: false });
        void estava;
        mudou();
        return { ok: true };
      }),
    _recursos: () => ({ clientes: clientes.size, efemero: efemero !== null, timers: (cancelarTimerPar === null ? 0 : 1) }),
  };
}
export { lerConfigRelay };
