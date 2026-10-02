// Portas do núcleo Telegram. A rede é a `src/nucleo/rede` (única que abre sockets): o adaptador real implementa `PortaRedeSegredo`
// sobre `criarClienteRede` estendido com `caminho_template`/`segredos` (T-20.18). Aqui não existe fetch/http.
export interface PedidoSegredo {
  host: string;
  porta?: number;
  metodo: "GET" | "POST";
  /** ex.: `/bot{token}/getUpdates` — o caminho real só existe DENTRO do cliente de rede; log/erro mostram o template. */
  caminho_template: string;
  segredos: Record<string, string>;
  corpo?: string;
  cabecalhos?: Record<string, string>;
  timeout_ms: number;
  max_bytes: number;
  sinal?: AbortSignal;
}
export interface RespostaSegredo {
  status: number;
  texto: string;
  /** cabeçalhos em minúsculas (usa-se `retry-after`). */
  cabecalhos?: Record<string, string>;
}
export interface PortaRedeSegredo {
  requisitar(p: PedidoSegredo): Promise<RespostaSegredo>;
}

export interface RelogioTg {
  agora(): number;
}
export interface DormirPorta {
  /** resolve após `ms`; rejeita com `AbortError` se `sinal` abortar. */
  dormir(ms: number, sinal?: AbortSignal): Promise<void>;
}
export const dormirReal: DormirPorta = {
  dormir: (ms, sinal) =>
    new Promise<void>((resolve, reject) => {
      if (sinal?.aborted === true) return reject(new DOMException("abortado", "AbortError"));
      const t = setTimeout(() => {
        sinal?.removeEventListener("abort", aoAbortar);
        resolve();
      }, ms);
      const aoAbortar = (): void => {
        clearTimeout(t);
        reject(new DOMException("abortado", "AbortError"));
      };
      sinal?.addEventListener("abort", aoAbortar, { once: true });
    }),
};
