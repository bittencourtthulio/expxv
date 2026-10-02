// Parser de transcrição do Claude Code (`~/.claude/projects/<slug>/<sessao>.jsonl`), TOLERANTE: extrai a mensagem do usuário, a resposta
// final do assistente e o resumo das tools (nome + caminhos). NUNCA devolve saída de ferramenta (`tool_result`) nem raciocínio
// (`thinking`). Linha ilegível é ignorada. Incremental: devolve o offset (em bytes) consumido.
import type { Troca } from "../../chunking/transcricao";

interface Bloco {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

const CAMINHOS_INPUT = ["file_path", "path", "notebook_path"];

export interface ResultadoParse {
  trocas: Troca[];
  /** bytes consumidos (só linhas completas); guarde em `rag_fonte.ultimo_offset`. */
  offset: number;
}

function textoDe(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  if (!Array.isArray(conteudo)) return "";
  return (conteudo as Bloco[])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

export function parsearClaude(jsonl: string, offsetInicial = 0): ResultadoParse {
  const bytes = Buffer.from(jsonl, "utf8");
  const trecho = bytes.subarray(offsetInicial);
  const ultimaQuebra = trecho.lastIndexOf(0x0a);
  if (ultimaQuebra < 0) return { trocas: [], offset: offsetInicial };
  const completo = trecho.subarray(0, ultimaQuebra + 1).toString("utf8");
  const trocas: Troca[] = [];
  let atual: { usuario: string; resposta: string; ferramentas: string[]; arquivos: string[] } | null = null;
  const fechar = (): void => {
    if (atual && atual.usuario.trim() !== "" && atual.resposta.trim() !== "") trocas.push(atual);
    atual = null;
  };
  for (const linha of completo.split("\n")) {
    if (linha.trim() === "") continue;
    let o: { type?: string; isSidechain?: boolean; message?: { role?: string; content?: unknown } };
    try {
      o = JSON.parse(linha);
    } catch {
      continue;
    }
    if (o.isSidechain === true || !o.message) continue;
    const c = o.message.content;
    if (o.type === "user" || o.message.role === "user") {
      if (Array.isArray(c) && (c as Bloco[]).every((b) => b.type === "tool_result")) continue; // saída de ferramenta: fora
      const t = textoDe(c).trim();
      if (t === "" || /^<(?:command-|local-command-|system-reminder)/.test(t)) continue;
      fechar();
      atual = { usuario: t, resposta: "", ferramentas: [], arquivos: [] };
    } else if ((o.type === "assistant" || o.message.role === "assistant") && atual) {
      if (Array.isArray(c)) {
        for (const b of c as Bloco[]) {
          if (b.type === "tool_use" && b.name) {
            if (!atual.ferramentas.includes(b.name)) atual.ferramentas.push(b.name);
            for (const k of CAMINHOS_INPUT) {
              const v = b.input?.[k];
              if (typeof v === "string" && atual.arquivos.length < 20 && !atual.arquivos.includes(v)) atual.arquivos.push(v);
            }
          }
        }
      }
      const t = textoDe(c).trim();
      if (t !== "") atual.resposta = t; // a resposta FINAL é a última com texto
    }
  }
  fechar();
  return { trocas, offset: offsetInicial + Buffer.byteLength(completo, "utf8") };
}
