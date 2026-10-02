// Adaptador de TESTE de `PortaRedeSegredo` sobre `src/nucleo/rede` (o único módulo com sockets), só loopback. Substitui `{token}` no caminho
// DENTRO do adaptador (como o cliente de rede estendido da T-20.18 fará), aborta de verdade (`stream().cancelar()`) e sanitiza qualquer
// erro: o token nunca aparece em log nem em exceção.
import { criarClienteRede, criarRegistroConsentimento } from "../../../src/nucleo/rede";
import type { PedidoSegredo, PortaRedeSegredo, RespostaSegredo } from "../../../src/nucleo/telegram/portas";

export interface RedeTeste extends PortaRedeSegredo {
  logs: string[];
  chamadas: number;
  /** nº de requisições em andamento (para provar 0 sockets abertos). */
  emVoo(): number;
}

export function criarRedeDeTeste(): RedeTeste {
  const consentimento = criarRegistroConsentimento();
  consentimento.permitirHost("127.0.0.1");
  const logs: string[] = [];
  let tokenVisto = "";
  const cliente = criarClienteRede({ consentimento, permitirLoopbackHttp: true, resolverProxy: () => null, log: (l) => logs.push(l), scrub: (t) => (tokenVisto === "" ? t : t.split(tokenVisto).join("/bot***/")) });
  let emVoo = 0;
  const r: RedeTeste = {
    logs,
    chamadas: 0,
    emVoo: () => emVoo,
    async requisitar(p: PedidoSegredo): Promise<RespostaSegredo> {
      r.chamadas++;
      const token = p.segredos.token ?? "";
      tokenVisto = token;
      const caminho = p.caminho_template.replace("{token}", token);
      emVoo++;
      try {
        const tk = consentimento.conceder("127.0.0.1", { validade_ms: 5_000 });
        const resp = await cliente.stream({ host: p.host, caminho, metodo: p.metodo, ...(p.corpo === undefined ? {} : { corpo: p.corpo }), ...(p.cabecalhos === undefined ? {} : { cabecalhos: p.cabecalhos }), tokenDeConsentimento: tk, timeout_ms: p.timeout_ms, max_bytes: p.max_bytes, ocioso_ms: p.timeout_ms, ...(p.porta === undefined ? {} : { porta: p.porta }) });
        const aoAbortar = (): void => resp.cancelar();
        if (p.sinal?.aborted === true) aoAbortar();
        p.sinal?.addEventListener("abort", aoAbortar, { once: true });
        try {
          const partes: Buffer[] = [];
          for await (const parte of resp.corpo) partes.push(parte);
          const cab = resp.cabecalhos;
          return { status: resp.status, texto: Buffer.concat(partes).toString("utf8"), cabecalhos: cab };
        } finally {
          p.sinal?.removeEventListener("abort", aoAbortar);
        }
      } catch (e) {
        if (p.sinal?.aborted === true) throw new DOMException("abortado", "AbortError");
        throw new Error(`rede: ${(e as { codigo?: string }).codigo ?? "falha"}`);
      } finally {
        emVoo--;
      }
    },
  };
  return r;
}
