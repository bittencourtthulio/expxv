// Porta de transporte do atualizador (Fase 21, T-21.14). O atualizador NÃO abre socket: o único módulo de saída de rede do app é
// `src/nucleo/rede/cliente-http.ts` (D-58/D-114), que exige consentimento por host, https, host fixo, teto de bytes e não segue redirecionamento a outro host.
// O adaptador abaixo liga esta porta a ele; os testes usam o MESMO cliente real contra servidor falso em loopback.
import type { ClienteRede } from "../../rede/cliente-http";

export interface PedidoTransporte {
  /** começa com `/`; sem query, fragmento ou `..`. */
  caminho: string;
  cabecalhos?: Record<string, string>;
  timeout_ms?: number;
  max_bytes?: number;
  ocioso_ms?: number;
  sinal?: AbortSignal;
}
export interface RespostaTransporte {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: Buffer;
}
export interface RespostaStreamTransporte {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: AsyncIterable<Buffer>;
  cancelar(): void;
}
export interface Transporte {
  requisitar(p: PedidoTransporte): Promise<RespostaTransporte>;
  stream(p: PedidoTransporte): Promise<RespostaStreamTransporte>;
}

/** Cabeçalhos que o atualizador pode enviar: nenhum identifica a instalação (AU-24). */
const CABECALHOS_PERMITIDOS = new Set(["if-none-match", "accept"]);

export function caminhoDeFeedValido(caminho: string): boolean {
  return /^\/[A-Za-z0-9._~\/-]*$/.test(caminho) && !caminho.includes("..") && !caminho.includes("//") && caminho.length <= 300;
}

export function transporteDoClienteRede(cliente: ClienteRede, destino: { host: string; porta?: number; token: string }): Transporte {
  const montar = (p: PedidoTransporte) => {
    if (!caminhoDeFeedValido(p.caminho)) throw new Error("caminho de feed inválido");
    const cabecalhos: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.cabecalhos ?? {})) if (CABECALHOS_PERMITIDOS.has(k.toLowerCase())) cabecalhos[k] = v;
    return {
      host: destino.host,
      caminho: p.caminho,
      metodo: "GET" as const,
      cabecalhos,
      tokenDeConsentimento: destino.token,
      ...(destino.porta !== undefined ? { porta: destino.porta } : {}),
      ...(p.timeout_ms !== undefined ? { timeout_ms: p.timeout_ms } : {}),
      ...(p.max_bytes !== undefined ? { max_bytes: p.max_bytes } : {}),
      ...(p.ocioso_ms !== undefined ? { ocioso_ms: p.ocioso_ms } : {}),
      ...(p.sinal !== undefined ? { sinal: p.sinal } : {}),
    };
  };
  return {
    async requisitar(p) {
      const r = await cliente.requisitar(montar(p));
      return { status: r.status, cabecalhos: r.cabecalhos, corpo: r.corpo };
    },
    async stream(p) {
      const r = await cliente.stream(montar(p));
      return { status: r.status, cabecalhos: r.cabecalhos, corpo: r.corpo, cancelar: () => r.cancelar() };
    },
  };
}
