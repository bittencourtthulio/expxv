// Transporte do relay (T-22.10): adaptador entre os quadros opacos do relay e o MESMO tratador de protocolo da Fase 13 (`remoto/tratador.ts`). Recebe um quadro, decide se é novo e autêntico,
// entrega `{rota, corpo}` ao tratador com `origem: "relay"` e devolve a resposta já embalada. NÃO afrouxa nada: permissão, taxa por dispositivo, contador do canal, revogação e
// `client_request_id` continuam todos dentro do tratador. Duplicata do quadro externo é descartada (o relay pode repetir/duplicar); quadro adulterado é `invalido` (quem chamou fecha).
import type { RotaTratador, Tratador } from "../remoto/tratador";
import { codificar, codificarEnchimento, decodificar } from "./quadro";

const ROTAS: readonly RotaTratador[] = ["pareamento_inicio", "pareamento_fim", "pareamento_status", "sessao_inicio", "canal"];
export const MAX_EM_VOO = 8;
const MAX_VISTOS = 4096;

export type ResultadoQuadro = { k: "resposta"; quadro: Buffer } | { k: "ignorado"; motivo: "duplicado" | "enchimento" | "excesso" } | { k: "invalido" };
export interface TransporteRelay {
  receber(quadro: Uint8Array): Promise<ResultadoQuadro>;
  /** quadro de enchimento (mesmo formato e tamanho de um de dado pequeno). */
  enchimento(): Buffer;
  emVoo(): number;
  /** troca a chave do invólucro (rotação do segredo de canal) e esquece os nonces vistos. */
  trocarChave(chave: Buffer): void;
}
export interface DepsTransporte {
  tratador: Tratador;
  chave: Buffer;
  aleatorio?: (n: number) => Buffer;
}

export function criarTransporteRelay(d: DepsTransporte): TransporteRelay {
  let chave = d.chave;
  const vistos = new Set<string>();
  let emVoo = 0;
  const opcoes = d.aleatorio === undefined ? {} : { aleatorio: d.aleatorio };
  const lembrar = (n: string): boolean => {
    if (vistos.has(n)) return false;
    vistos.add(n);
    if (vistos.size > MAX_VISTOS) vistos.delete(vistos.values().next().value as string);
    return true;
  };
  return {
    emVoo: () => emVoo,
    trocarChave(nova) {
      chave = nova;
      vistos.clear();
    },
    enchimento: () => codificarEnchimento(chave, "h2c", opcoes),
    async receber(quadro) {
      const x = decodificar(chave, quadro, "c2h");
      if (x === null) return { k: "invalido" };
      if (!lembrar(x.nonce)) return { k: "ignorado", motivo: "duplicado" };
      if (x.tipo === "enchimento") return { k: "ignorado", motivo: "enchimento" };
      if (emVoo >= MAX_EM_VOO) return { k: "ignorado", motivo: "excesso" };
      const m = typeof x.mensagem === "object" && x.mensagem !== null ? x.mensagem : {}; // `null`/escalar autêntico: cai no 400 (regressão do fuzz)
      const ok = typeof m === "object" && m !== null && !Array.isArray(m) && Object.keys(m).sort().join(",") === "corpo,id,r";
      const o = m as { r?: unknown; id?: unknown; corpo?: unknown };
      if (!ok || typeof o.r !== "string" || !(ROTAS as readonly string[]).includes(o.r) || typeof o.id !== "number" || !Number.isSafeInteger(o.id) || o.id < 0) {
        return { k: "resposta", quadro: codificar(chave, { id: typeof o.id === "number" && Number.isSafeInteger(o.id) ? o.id : 0, status: 400, corpo: { e: "quadro_invalido" } }, "h2c", opcoes) };
      }
      emVoo++;
      try {
        const r = await d.tratador.tratar({ rota: o.r as RotaTratador, corpo: o.corpo, origem: "relay" });
        return { k: "resposta", quadro: codificar(chave, { id: o.id, status: r.status, corpo: r.corpo }, "h2c", opcoes) };
      } catch {
        return { k: "resposta", quadro: codificar(chave, { id: o.id, status: 500, corpo: { e: "falhou" } }, "h2c", opcoes) };
      } finally {
        emVoo--;
      }
    },
  };
}
