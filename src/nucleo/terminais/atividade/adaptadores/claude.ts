import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { AdaptadorAtividade, AtividadeTerminal, LinhaSubagente, SinalSubagente } from "../contrato";

const LIMITE_LINHA = 600;
const ID_AGENTE = /^[A-Za-z0-9_-]{1,80}$/;
const ID_CONVERSA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/; // sem `-` inicial (AUD-24)

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

function cortar(valor: string, limite = LIMITE_LINHA): string {
  const limpo = valor.replace(/\s+$/g, "");
  return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}

/** Só aceita o transcript de subagente do Claude Code: `.../subagents/agent-<id>.jsonl`, caminho absoluto. */
function arquivoValido(valor: unknown): string | null {
  const caminho = texto(valor);
  if (caminho === null || !isAbsolute(caminho) || caminho.includes("\0")) return null;
  return basename(dirname(caminho)) === "subagents" && /^agent-[A-Za-z0-9_-]+\.jsonl$/.test(basename(caminho)) ? caminho : null;
}

function descricaoDoMeta(arquivo: string | null): string | null {
  if (arquivo === null) return null;
  try {
    const meta = JSON.parse(readFileSync(arquivo.replace(/\.jsonl$/, ".meta.json"), "utf8")) as { description?: unknown };
    return texto(meta.description);
  } catch { return null; }
}

function resumoDaFerramenta(nome: string, entrada: unknown): string {
  const dados = typeof entrada === "object" && entrada !== null ? entrada as Record<string, unknown> : {};
  for (const chave of ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt"]) {
    const valor = texto(dados[chave]);
    if (valor !== null) return cortar(`${nome}: ${valor.replace(/\s+/g, " ")}`, 300);
  }
  return nome;
}

function textoDoResultado(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  if (Array.isArray(conteudo)) return conteudo.map((b) => (typeof b === "object" && b !== null && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join("\n");
  return "";
}

export const adaptadorClaude: AdaptadorAtividade = {
  ferramenta_id: "claude",

  argumentosDeObservacao(alvo) {
    const gancho = { type: "http", url: alvo.url, timeout: 5 };
    const eventos = ["SubagentStart", "SubagentStop", "UserPromptSubmit", "PostToolUse", "Notification", "Stop"];
    const configuracao = { hooks: Object.fromEntries(eventos.map((evento) => [evento, [{ hooks: [gancho] }]])) };
    return ["--settings", alvo.gravarArquivo("claude-hooks.json", JSON.stringify(configuracao))];
  },

  conversaDoHook(corpo): string | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    if (texto(c["agent_id"]) !== null) return null; // hook de subagente carrega o id da conversa principal, mas o que vale é o da raiz
    // só vale a conversa que a CLI já gravou em disco (o arquivo é `<id>.jsonl`): `--resume` de um id sem arquivo falha com "No conversation found"
    const arquivo = texto(c["transcript_path"]);
    if (arquivo === null || !isAbsolute(arquivo) || !arquivo.endsWith(".jsonl") || !existsSync(arquivo)) return null;
    const id = basename(arquivo, ".jsonl");
    return ID_CONVERSA.test(id) ? id : null;
  },

  interpretarAtividade(corpo): AtividadeTerminal | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    switch (c["hook_event_name"]) {
      case "UserPromptSubmit":
      case "PostToolUse": return "trabalhando"; // PostToolUse também tira o agente de "aguardando" depois da aprovação
      case "Stop": return "pronto";
      case "Notification":
        if (c["notification_type"] === "permission_prompt" || c["notification_type"] === "elicitation_dialog") return "aguardando";
        return c["notification_type"] === "idle_prompt" ? "pronto" : null;
      default: return null;
    }
  },

  interpretar(corpo): SinalSubagente | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    const id = texto(c["agent_id"]);
    if (id === null || !ID_AGENTE.test(id)) return null;
    if (c["hook_event_name"] === "SubagentStart") {
      const principal = texto(c["transcript_path"]);
      const sessao = texto(c["session_id"]);
      const derivado = principal !== null && sessao !== null && ID_AGENTE.test(sessao) && isAbsolute(principal)
        ? arquivoValido(join(dirname(principal), sessao, "subagents", `agent-${id}.jsonl`)) : null;
      return { tipo: "iniciado", subagente_id: id, rotulo: cortar(texto(c["agent_type"]) ?? "subagente", 60), descricao: descricaoDoMeta(derivado), arquivo: derivado };
    }
    if (c["hook_event_name"] === "SubagentStop") return { tipo: "concluido", subagente_id: id, arquivo: arquivoValido(c["agent_transcript_path"]), resumo: texto(c["last_assistant_message"]) === null ? null : cortar(c["last_assistant_message"] as string, 1200) };
    return null;
  },

  analisarLinha(linha): LinhaSubagente[] {
    let registro: { type?: unknown; message?: { content?: unknown } };
    try { registro = JSON.parse(linha) as typeof registro; } catch { return []; }
    const conteudo = registro.message?.content;
    if (registro.type === "user" && typeof conteudo === "string") return [{ papel: "prompt", texto: cortar(conteudo) }];
    if (!Array.isArray(conteudo)) return [];
    const saida: LinhaSubagente[] = [];
    for (const bloco of conteudo as Array<Record<string, unknown>>) {
      if (registro.type === "assistant" && bloco["type"] === "text" && texto(bloco["text"]) !== null) saida.push({ papel: "texto", texto: cortar(bloco["text"] as string) });
      else if (registro.type === "assistant" && bloco["type"] === "tool_use") saida.push({ papel: "ferramenta", texto: resumoDaFerramenta(String(bloco["name"] ?? "ferramenta"), bloco["input"]) });
      else if (registro.type === "user" && bloco["type"] === "tool_result") {
        const resultado = textoDoResultado(bloco["content"]).trim();
        if (resultado !== "") saida.push({ papel: "resultado", texto: cortar(resultado, 300) });
      }
    }
    return saida;
  },
};
