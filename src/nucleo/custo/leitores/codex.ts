// Leitor do rollout do Codex (T-10.05). Formato verificado na CLI instalada: `turn_context.payload.model` dá o modelo; `event_msg` com `payload.type:"token_count"`
// traz `payload.info.total_token_usage` ACUMULADO. O registro é o DELTA do total (robusto a evento repetido com o mesmo total; total que diminui = contagem reiniciada
// ⇒ novo marco). Desvio do plano, conferido nos arquivos reais: `total_tokens = input + output`, ou seja, `cached_input_tokens` está DENTRO de `input_tokens` e
// `reasoning_output_tokens` está DENTRO de `output_tokens` — por isso entrada = input − cache lido − cache escrito e saída = output (somar o raciocínio contaria duas vezes).
// Sem modelo no momento do evento ⇒ `modelo:null` (custo desconhecido). O leitor guarda estado (modelo + último total); sem estado em memória o arquivo é relido do início.
import type { RegistroExtraido } from "../../../compartilhado/custo";
import type { FabricaLeitor, LeitorFormato } from "./leitor";

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0);
interface Total {
  input: number;
  cached: number;
  write: number;
  output: number;
}
export interface EstadoCodex {
  modelo: string | null;
  anterior: Total | null;
}
const lerTotal = (t: Record<string, unknown>): Total => ({ input: num(t["input_tokens"]), cached: num(t["cached_input_tokens"]), write: num(t["cache_write_input_tokens"]), output: num(t["output_tokens"]) });

export function criarLeitorCodex(inicial?: EstadoCodex): LeitorFormato {
  const s: EstadoCodex = { modelo: inicial?.modelo ?? null, anterior: inicial?.anterior ?? null };
  return {
    estado: () => ({ modelo: s.modelo, anterior: s.anterior === null ? null : { ...s.anterior } }),
    linha(bytes): RegistroExtraido | null {
      const ctx = bytes.includes('"turn_context"');
      if (!ctx && !bytes.includes('"token_count"')) return null;
      let o: unknown;
      try {
        o = JSON.parse(bytes.toString("utf8"));
      } catch {
        return null;
      }
      if (typeof o !== "object" || o === null) return null;
      const l = o as Record<string, unknown>;
      const p = l["payload"];
      if (typeof p !== "object" || p === null) return null;
      const pl = p as Record<string, unknown>;
      if (l["type"] === "turn_context") {
        if (typeof pl["model"] === "string" && pl["model"].trim() !== "") s.modelo = pl["model"].trim();
        return null;
      }
      if (l["type"] !== "event_msg" || pl["type"] !== "token_count") return null;
      const info = pl["info"];
      if (typeof info !== "object" || info === null) return null;
      const tot = (info as Record<string, unknown>)["total_token_usage"];
      if (typeof tot !== "object" || tot === null) return null;
      const ts = typeof l["timestamp"] === "string" ? l["timestamp"] : null;
      if (ts === null || !Number.isFinite(Date.parse(ts))) return null;
      const atual = lerTotal(tot as Record<string, unknown>);
      const ant = s.anterior;
      const reinicio = ant !== null && (atual.input < ant.input || atual.output < ant.output || atual.cached < ant.cached || atual.write < ant.write);
      const base: Total = ant === null || reinicio ? { input: 0, cached: 0, write: 0, output: 0 } : ant;
      const d: Total = { input: atual.input - base.input, cached: atual.cached - base.cached, write: atual.write - base.write, output: atual.output - base.output };
      s.anterior = atual;
      if (d.input + d.output + d.cached + d.write === 0) return null; // evento repetido com o mesmo total
      const ord = typeof l["ordinal"] === "number" ? l["ordinal"] : 0;
      return {
        chave: `${ts}|${ord}|${atual.input}|${atual.output}`,
        ts,
        modelo: s.modelo,
        tokens: { entrada: Math.max(0, d.input - d.cached - d.write), cache_escrita: d.write, cache_leitura: d.cached, saida: d.output },
      };
    },
  };
}

export const fabricaCodex: FabricaLeitor = {
  id: "codex",
  retomavel: false, // só retoma com o estado (modelo + último total) em memória; sem ele relê do início
  criar: (estado) => criarLeitorCodex(estado as EstadoCodex | undefined),
};
