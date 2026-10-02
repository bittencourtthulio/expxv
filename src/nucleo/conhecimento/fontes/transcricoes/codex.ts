// Parser de transcrição do Codex (`<CODEX_HOME>/sessions/AAAA/MM/DD/rollout-*.jsonl`), TOLERANTE e SEM saída de ferramenta nem raciocínio.
// Forma esperada (NÃO confirmada em todas as versões): `{type:"response_item", payload:{type:"message", role, content:[{type:"input_text"|"output_text", text}]}}`
// e `payload.type:"function_call"` (nome da ferramenta). Qualquer outra forma é ignorada.
import type { Troca } from "../../chunking/transcricao";
import type { ResultadoParse } from "./claude";

interface Item {
  type?: string;
  payload?: { type?: string; role?: string; name?: string; content?: Array<{ type?: string; text?: string }> };
}

export function parsearCodex(jsonl: string, offsetInicial = 0): ResultadoParse {
  const trecho = Buffer.from(jsonl, "utf8").subarray(offsetInicial);
  const q = trecho.lastIndexOf(0x0a);
  if (q < 0) return { trocas: [], offset: offsetInicial };
  const completo = trecho.subarray(0, q + 1).toString("utf8");
  const trocas: Troca[] = [];
  let atual: { usuario: string; resposta: string; ferramentas: string[] } | null = null;
  const fechar = (): void => {
    if (atual && atual.usuario.trim() !== "" && atual.resposta.trim() !== "") trocas.push({ ...atual, arquivos: [] });
    atual = null;
  };
  for (const linha of completo.split("\n")) {
    if (linha.trim() === "") continue;
    let o: Item;
    try {
      o = JSON.parse(linha);
    } catch {
      continue;
    }
    const p = o.payload;
    if (!p) continue;
    if (p.type === "message") {
      const t = (p.content ?? [])
        .filter((b) => (b.type === "input_text" || b.type === "output_text") && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();
      if (t === "") continue;
      if (p.role === "user") {
        if (/^<(?:environment_context|user_instructions)/.test(t)) continue;
        fechar();
        atual = { usuario: t, resposta: "", ferramentas: [] };
      } else if (p.role === "assistant" && atual) atual.resposta = t;
    } else if (p.type === "function_call" && p.name && atual && !atual.ferramentas.includes(p.name)) atual.ferramentas.push(p.name);
  }
  fechar();
  return { trocas, offset: offsetInicial + Buffer.byteLength(completo, "utf8") };
}
