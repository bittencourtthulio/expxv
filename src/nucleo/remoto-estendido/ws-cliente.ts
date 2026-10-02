// Cliente WebSocket de SAÍDA do host para o relay (T-22.05). ÚNICO lugar do app com `new WebSocket` (D-366; D-114 vale para o resto): usa o `WebSocket` GLOBAL do Node/Electron,
// sem biblioteca. Só `wss://` (e `ws://127.0.0.1` apenas com NODE_ENV=test); host vem da configuração; credencial, query, IP e nome local recusados; redirecionamento não é seguido
// (a especificação do WebSocket nem permite); nenhum erro cita URL ou caminho; tetos de quadro e de fila; `sinal` de cancelamento fecha na hora. Sem proxy autoconfigurado:
// o runtime do Node não consulta proxy do sistema para WebSocket.
import { validarUrlRelay } from "../../compartilhado/relay";

export type CodigoWs = "url_invalida" | "url_insegura" | "sem_websocket" | "falhou" | "quadro_grande" | "fila_cheia";
export class ErroWs extends Error {
  override name = "ErroWs";
  constructor(readonly codigo: CodigoWs) {
    super(codigo); // só o código: a mensagem nunca carrega URL, caminho ou texto do runtime
  }
}

export interface WsBruto {
  readyState: number;
  bufferedAmount: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(d: unknown): void;
  close(code?: number): void;
}
export type ConstrutorWs = new (url: string) => WsBruto;

export interface ConexaoWs {
  readonly aberta: boolean;
  /** `false` = não enviou (fechado, quadro acima do teto ou fila cheia; nesse último caso o socket é fechado). */
  enviar(dados: Uint8Array | string): boolean;
  fechar(codigo?: number): void;
}
export interface OpcoesWs {
  url: string;
  aoAbrir(): void;
  aoMensagem(dados: Uint8Array | string): void;
  aoFechar(codigo: number): void;
  aoErro?: (codigo: CodigoWs) => void;
  sinal?: AbortSignal;
  maxQuadro?: number;
  maxFila?: number;
  /** injetáveis (teste). `ctor: null` simula runtime sem WebSocket. */
  ctor?: ConstrutorWs | null;
  ambiente?: string;
}

const LOOPBACK_TESTE = /^ws:\/\/127\.0\.0\.1(?::\d{1,5})?(?:\/[A-Za-z0-9._~\-/]*)?$/;
const ABERTO = 1;

export function abrirWs(o: OpcoesWs): ConexaoWs {
  const ambiente = o.ambiente ?? process.env["NODE_ENV"];
  if (/^ws:/i.test(o.url)) {
    if (ambiente !== "test" || !LOOPBACK_TESTE.test(o.url)) throw new ErroWs("url_insegura");
  } else if (!validarUrlRelay(o.url)) throw new ErroWs("url_invalida");
  if (o.ctor === null || (o.ctor === undefined && typeof (globalThis as { WebSocket?: unknown }).WebSocket !== "function")) throw new ErroWs("sem_websocket");
  const maxQuadro = o.maxQuadro ?? 64 * 1024 + 64;
  const maxFila = o.maxFila ?? 1024 * 1024;
  let ws: WsBruto;
  try {
    ws = o.ctor === undefined ? (new WebSocket(o.url) as unknown as WsBruto) : new o.ctor(o.url); // o ÚNICO `new WebSocket` do app (D-366)
  } catch {
    throw new ErroWs("falhou");
  }
  ws.binaryType = "arraybuffer";
  let fechado = false;
  const concluir = (codigo: number): void => {
    if (fechado) return;
    fechado = true;
    o.sinal?.removeEventListener("abort", aoCancelar);
    o.aoFechar(codigo);
  };
  const fecharSocket = (codigo: number): void => {
    try {
      ws.close(codigo);
    } catch {
      /* já fechado */
    }
    concluir(codigo);
  };
  function aoCancelar(): void {
    fecharSocket(1000);
  }
  ws.onopen = () => {
    if (!fechado) o.aoAbrir();
  };
  ws.onmessage = (e) => {
    if (fechado) return;
    const d = e.data;
    const tam = typeof d === "string" ? Buffer.byteLength(d) : d instanceof ArrayBuffer ? d.byteLength : ArrayBuffer.isView(d) ? d.byteLength : -1;
    if (tam < 0 || tam > maxQuadro) return fecharSocket(1009);
    o.aoMensagem(typeof d === "string" ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array((d as ArrayBufferView).buffer, (d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteLength));
  };
  ws.onclose = (e) => concluir(typeof e?.code === "number" ? e.code : 1006);
  ws.onerror = () => {
    o.aoErro?.("falhou"); // NUNCA repassa o evento (pode conter URL)
    // medido no Node 22: se a conexão FALHA antes de abrir, o runtime dispara `error` e NUNCA `close` (readyState fica 0). Falha antes de abrir é terminal.
    if (ws.readyState !== ABERTO) fecharSocket(1006);
  };
  if (o.sinal !== undefined) {
    if (o.sinal.aborted) fecharSocket(1000);
    else o.sinal.addEventListener("abort", aoCancelar, { once: true });
  }
  return {
    get aberta() {
      return !fechado && ws.readyState === ABERTO;
    },
    enviar(dados) {
      if (fechado || ws.readyState !== ABERTO) return false;
      const tam = typeof dados === "string" ? Buffer.byteLength(dados) : dados.byteLength;
      if (tam > maxQuadro) return false;
      if (ws.bufferedAmount > maxFila) {
        fecharSocket(1008);
        return false;
      }
      try {
        ws.send(dados);
      } catch {
        return false;
      }
      return true;
    },
    fechar(codigo = 1000) {
      fecharSocket(codigo);
    },
  };
}
