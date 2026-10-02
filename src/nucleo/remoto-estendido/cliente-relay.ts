// Cliente do host para o relay (T-22.10): UMA conexão de saída por canal. Registrar (prova de posse) -> manter (ping 25-30 s) -> reconectar (backoff exponencial com jitter 1->60 s e teto de
// tentativas por minuto) -> encerrar (<= 1 s). Os quadros vão ao `transporte-relay` (E2E por dentro, MESMO tratador da Fase 13). Garantias:
//  * relay hostil (adultera, repete, reordena, descarta, atrasa, duplica, fecha): nunca executa duas vezes, nunca aceita quadro inválido, fecha a conexão ao primeiro adulterado (AX-02/03);
//  * relay fora do ar = «indisponível», NUNCA revogação; nenhuma exceção escapa (AX-30); `fechar()` deixa 0 sockets;
//  * UM timer pendente por vez (handshake, ping ou espera da reconexão); nenhum timer fora da janela de conexão (P-160/P-167);
//  * NUNCA liga sozinho: quem chama decide (o serviço do main, depois do consentimento); nada é persistido aqui.
import { LIMITES_RELAY, VERSAO_PROTOCOLO_RELAY, urlDoCanalRelay } from "../../compartilhado/relay";
import { dadosProva, parseControle, serializar } from "../relay/protocolo";
import type { IdentidadeServidor } from "../remoto/identidade";
import { canalId, epocaDe } from "./canal";
import type { TransporteRelay } from "./transporte-relay";
import { ErroWs, type ConexaoWs, type OpcoesWs } from "./ws-cliente";
import { randomBytes } from "node:crypto";

export type EstadoCliente = "parado" | "conectando" | "registrado" | "indisponivel";
export type EventoCliente = "conectado" | "desconectado" | "quadro_invalido" | "relay_indisponivel";
export interface DepsClienteRelay {
  url: string;
  /** segredo de canal do dispositivo (ou segredo efêmero do pareamento): rotaciona o `canal_id` por época. */
  segredo: Buffer;
  identidade: Pick<IdentidadeServidor, "publicaSpki" | "assinar">;
  /** SPKI do dispositivo que poderá ocupar o slot do cliente (omitido no canal de pareamento). */
  clientePub?: Buffer;
  efemero?: boolean;
  transporte: TransporteRelay;
  relogio: { agora(): number };
  /** agenda `fn` daqui a `ms`; devolve o cancelamento. Injetado nos testes (relógio virtual). */
  agendar: (fn: () => void, ms: number) => () => void;
  abrirWs: (o: OpcoesWs) => ConexaoWs;
  /** fração aleatória em [0,1) (jitter). */
  aleatorio?: () => number;
  bytes?: (n: number) => Buffer;
  /** envia quadros de enchimento a cada ping (padrão: true). */
  padding?: boolean;
  aoEstado?: (e: EstadoCliente) => void;
  /** só nomes de evento: sem conteúdo, sem IP, sem canal. */
  aoEvento?: (e: EventoCliente) => void;
}
export interface ClienteRelay {
  iniciar(): void;
  fechar(): void;
  /** avisa o relay (assinado pelo canal já provado) para esquecer o canal e fecha. Otimização: a revogação de verdade é do host (AX-15). */
  desregistrar(): void;
  estado(): EstadoCliente;
  /** atraso (ms) da próxima reconexão agendada, ou null. */
  proximaTentativaEm(): number | null;
}

export function backoff(tentativa: number, aleatorio: () => number): number {
  const base = Math.min(LIMITES_RELAY.backoff_max_ms, LIMITES_RELAY.backoff_min_ms * 2 ** Math.max(0, tentativa));
  return Math.round(Math.min(LIMITES_RELAY.backoff_max_ms, base * (0.8 + 0.4 * aleatorio())));
}

/** teto de tentativas por minuto: com `tentativas_por_min` conexões na janela de 60 s, a próxima espera até a mais antiga sair da janela (defesa em camadas com o backoff). */
export function aplicarTeto(instantes: readonly number[], agora: number, espera: number): number {
  const recentes = instantes.filter((t) => agora - t <= 60_000);
  if (recentes.length >= LIMITES_RELAY.tentativas_por_min) return Math.max(espera, 60_000 - (agora - (recentes[0] as number)) + 1);
  return espera;
}

export function criarClienteRelay(d: DepsClienteRelay): ClienteRelay {
  const rnd = d.aleatorio ?? Math.random;
  const bytes = d.bytes ?? randomBytes;
  let estado: EstadoCliente = "parado";
  let ws: ConexaoWs | null = null;
  let cancelarTimer: (() => void) | null = null;
  let ac: AbortController | null = null;
  let tentativas = 0;
  const instantes: number[] = [];
  let epocaAtual = 0;
  let etapa: "hello" | "prova" | "ativo" = "hello";
  let canal = "";
  let nonceCliente: Buffer = Buffer.alloc(0);
  let avisouIndisponivel = false;
  let esperandoPong = false;
  let proxima: number | null = null;
  let geracao = 0;

  const mudar = (e: EstadoCliente): void => {
    if (estado === e) return;
    estado = e;
    try {
      d.aoEstado?.(e);
    } catch {
      /* callback do dono não derruba o cliente */
    }
  };
  const evento = (e: EventoCliente): void => {
    try {
      d.aoEvento?.(e);
    } catch {
      /* idem */
    }
  };
  const limparTimer = (): void => {
    cancelarTimer?.();
    cancelarTimer = null;
    proxima = null;
  };
  const timer = (fn: () => void, ms: number): void => {
    limparTimer();
    cancelarTimer = d.agendar(() => {
      cancelarTimer = null;
      proxima = null;
      try {
        fn();
      } catch {
        derrubar("falhou");
      }
    }, ms);
  };
  /** canal efêmero de pareamento: época fixa 0 (o celular só tem o código, não tem relógio sincronizado); definitivo: época diária. */
  const epocaDoCanal = (): number => (d.efemero === true ? 0 : epocaDe(d.relogio.agora()));
  const jitterPing = (): number => LIMITES_RELAY.ping_min_ms + Math.floor(rnd() * (LIMITES_RELAY.ping_max_ms - LIMITES_RELAY.ping_min_ms));

  function conectar(): void {
    const minha = ++geracao;
    mudar("conectando");
    etapa = "hello";
    esperandoPong = false;
    epocaAtual = epocaDoCanal();
    canal = canalId(d.segredo, epocaAtual);
    const agora = d.relogio.agora();
    while (instantes.length > 0 && agora - (instantes[0] as number) > 60_000) instantes.shift();
    instantes.push(agora);
    ac = new AbortController();
    try {
      ws = d.abrirWs({
        url: urlDoCanalRelay(d.url), // a URL configurada é a do relay; quem conecta fala no caminho de canal (A-06)
        sinal: ac.signal,
        aoAbrir: () => {
          if (minha !== geracao) return;
          try {
            nonceCliente = bytes(16);
            ws?.enviar(serializar({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: "host", canal, ts: d.relogio.agora(), nonce: nonceCliente.toString("base64") }));
            timer(() => derrubar("handshake"), LIMITES_RELAY.handshake_ms);
          } catch {
            derrubar("falhou");
          }
        },
        aoMensagem: (m) => {
          if (minha !== geracao) return;
          try {
            if (typeof m === "string") void controle(m);
            else void dados(m);
          } catch {
            derrubar("falhou");
          }
        },
        aoFechar: () => {
          if (minha !== geracao) return;
          ws = null;
          derrubar("fechado");
        },
        aoErro: () => undefined, // o fechamento vem em seguida; o erro nunca traz URL
      });
    } catch (e) {
      ws = null;
      if (e instanceof ErroWs && (e.codigo === "url_invalida" || e.codigo === "url_insegura" || e.codigo === "sem_websocket")) {
        // configuração impossível: não adianta tentar de novo
        limparTimer();
        mudar("indisponivel");
        evento("relay_indisponivel");
        return;
      }
      derrubar("falhou");
    }
  }

  async function controle(texto: string): Promise<void> {
    const c = parseControle(texto, 1024);
    if (c === null) return derrubar("protocolo");
    if (etapa === "hello" && c.t === "desafio") {
      const desafio = Buffer.from(c.n, "base64");
      const params = { desafio, nonceCliente, canal, papel: "host" as const, cli: d.clientePub, efemero: d.efemero };
      const sig = d.identidade.assinar(dadosProva(params));
      etapa = "prova";
      ws?.enviar(JSON.stringify({ t: "prova", pub: d.identidade.publicaSpki().toString("base64"), sig: sig.toString("base64"), ...(d.clientePub === undefined ? {} : { cli: d.clientePub.toString("base64") }), ...(d.efemero === true ? { ef: 1 } : {}) }));
      return;
    }
    if (etapa === "prova" && c.t === "ok") {
      etapa = "ativo";
      avisouIndisponivel = false;
      mudar("registrado");
      evento("conectado");
      timer(tick, jitterPing());
      return;
    }
    if (etapa === "ativo" && c.t === "pong") {
      // `pong` que não responde a um `ping` NOSSO é ignorado: um relay hostil não zera o backoff com pongs espontâneos (F-1 da auditoria)
      if (!esperandoPong) return;
      esperandoPong = false;
      tentativas = 0; // só uma conexão ESTÁVEL (que respondeu ao ping) zera o backoff: relay que aceita e derruba em seguida não vira tempestade
      return;
    }
    return derrubar("protocolo"); // `erro`, mensagem fora de ordem ou desconhecida
  }

  async function dados(q: Uint8Array): Promise<void> {
    if (etapa !== "ativo") return derrubar("protocolo");
    const minha = geracao;
    const r = await d.transporte.receber(q);
    if (minha !== geracao) return; // a conexão mudou enquanto o tratador trabalhava
    if (r.k === "invalido") {
      evento("quadro_invalido");
      return derrubar("quadro_invalido"); // o primeiro quadro adulterado fecha (AX-02)
    }
    if (r.k === "resposta") ws?.enviar(r.quadro);
  }

  function tick(): void {
    if (estado !== "registrado" || ws === null) return;
    if (esperandoPong) return derrubar("sem_pong");
    if (epocaDoCanal() !== epocaAtual) {
      // virada de época: o canal_id muda; reconecta já (as sessões vivem no tratador e seguem valendo)
      derrubar("epoca", true);
      return;
    }
    esperandoPong = true;
    ws.enviar(serializar({ t: "ping" }));
    if (d.padding !== false) ws.enviar(d.transporte.enchimento());
    timer(tick, jitterPing());
  }

  function derrubar(motivo: string, imediato = false): void {
    if (estado === "parado") return;
    geracao++; // invalida callbacks da conexão antiga
    limparTimer();
    ac?.abort();
    ac = null;
    try {
      ws?.fechar(1000);
    } catch {
      /* já fechado */
    }
    ws = null;
    const estava = estado === "registrado";
    if (estava) evento("desconectado");
    if (motivo !== "epoca" && !avisouIndisponivel) {
      avisouIndisponivel = true;
      evento("relay_indisponivel");
    }
    mudar(imediato ? "conectando" : "indisponivel");
    // espera: backoff exponencial com jitter; teto de tentativas por minuto
    const agora = d.relogio.agora();
    let espera = imediato ? 0 : backoff(tentativas, rnd);
    tentativas++;
    espera = aplicarTeto(instantes, agora, espera);
    timer(conectar, espera);
    proxima = espera;
  }

  const api: ClienteRelay = {
    iniciar() {
      if (estado !== "parado") return;
      tentativas = 0;
      conectar();
    },
    fechar() {
      const eraParado = estado === "parado";
      geracao++;
      limparTimer();
      ac?.abort();
      ac = null;
      try {
        ws?.fechar(1000);
      } catch {
        /* já fechado */
      }
      ws = null;
      mudar("parado");
      if (!eraParado) evento("desconectado");
    },
    desregistrar() {
      if (etapa === "ativo" && estado === "registrado" && ws !== null) {
        try {
          ws.enviar(serializar({ t: "desregistrar" }));
        } catch {
          /* o host segue autoritativo */
        }
      }
      api.fechar();
    },
    estado: () => estado,
    proximaTentativaEm: () => proxima,
  };
  return api;
}
