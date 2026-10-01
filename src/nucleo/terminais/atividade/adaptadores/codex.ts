import type { AdaptadorAtividade, AtividadeTerminal, LinhaSubagente, SinalSubagente } from "../contrato";

const ID_AGENTE = /^[A-Za-z0-9_-]{1,80}$/;
const ID_CONVERSA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/; // sem `-` inicial (AUD-24)
const EVENTOS = ["SubagentStart", "SubagentStop", "PreToolUse", "PostToolUse", "UserPromptSubmit", "PermissionRequest", "Stop"] as const;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

function cortar(valor: string, limite: number): string {
  const limpo = valor.replace(/\s+$/g, "");
  return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}

/** O Codex prefixa ferramentas de colaboração (`collaborationspawn_agent`); o prefixo só atrapalha a leitura. */
const nomeDaFerramenta = (nome: string): string => nome.replace(/^collaboration/, "");

function resumoDaEntrada(entrada: unknown): string | null {
  const dados = typeof entrada === "object" && entrada !== null ? entrada as Record<string, unknown> : {};
  for (const chave of ["command", "path", "file_path", "pattern", "query", "url", "task_name"]) {
    const valor = texto(dados[chave]);
    if (valor !== null) return valor.replace(/\s+/g, " ");
  }
  return null;
}

function textoDaResposta(resposta: unknown): string {
  if (typeof resposta === "string") return resposta;
  if (resposta === undefined || resposta === null) return "";
  try { return JSON.stringify(resposta); } catch { return ""; }
}

/**
 * Codex: hooks de linha de comando injetados por `-c` (nada é gravado na configuração da pessoa) e
 * `--dangerously-bypass-hook-trust`, porque a revisão de confiança é por hash e o comando muda a cada sessão.
 * O flag também confia nos hooks do repositório, então (P-09/D-14, AUD-02) só vale em workspace `automatico`:
 * em `seguro` nada é injetado e a sinaleira cai na heurística de ociosidade, marcada como estimada.
 * Cada hook é assíncrono e só repassa o JSON de entrada ao endpoint local da sessão com `curl`.
 */
export const adaptadorCodex: AdaptadorAtividade = {
  ferramenta_id: "codex",

  argumentosDeObservacao(alvo) {
    if (alvo.permissao !== "automatico") return [];
    // só aspas duplas no comando: vale igual no sh e no cmd; a URL não tem aspas nem apóstrofos
    const comando = `curl -s -m 5 -X POST -H "content-type: application/json" --data-binary @- "${alvo.url}"`;
    return ["--dangerously-bypass-hook-trust", ...EVENTOS.flatMap((evento) => ["-c", `hooks.${evento}=[{hooks=[{type="command",command='${comando}',async=true,timeout=5}]}]`])];
  },

  conversaDoHook(corpo): string | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    if (texto(c["agent_id"]) !== null) return null; // hook de subagente carrega o id da conversa principal, mas o que vale é o da raiz
    const id = c["session_id"];
    return typeof id === "string" && ID_CONVERSA.test(id) ? id : null;
  },

  interpretarAtividade(corpo): AtividadeTerminal | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    switch (c["hook_event_name"]) {
      case "UserPromptSubmit":
      case "PreToolUse":
      case "PostToolUse": return "trabalhando";
      case "PermissionRequest": return "aguardando";
      case "Stop": return texto(c["agent_id"]) === null ? "pronto" : null; // fim de subagente não é fim do agente principal
      default: return null;
    }
  },

  interpretar(corpo): SinalSubagente | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    const id = texto(c["agent_id"]);
    if (id === null || !ID_AGENTE.test(id)) return null; // sem agent_id é a conversa principal, não um subagente
    const tipo = texto(c["agent_type"]);
    const rotulo = cortar(tipo === null || tipo === "default" ? `subagente ${id.slice(-4)}` : tipo, 60);
    switch (c["hook_event_name"]) {
      case "SubagentStart": return { tipo: "iniciado", subagente_id: id, rotulo, descricao: null, arquivo: null };
      case "SubagentStop": return { tipo: "concluido", subagente_id: id, arquivo: null, resumo: texto(c["last_assistant_message"]) === null ? null : cortar(c["last_assistant_message"] as string, 1200) };
      case "PreToolUse": {
        const nome = nomeDaFerramenta(texto(c["tool_name"]) ?? "ferramenta");
        const resumo = resumoDaEntrada(c["tool_input"]);
        return { tipo: "atividade", subagente_id: id, rotulo, linhas: [{ papel: "ferramenta", texto: cortar(resumo === null ? nome : `${nome}: ${resumo}`, 300) }] };
      }
      case "PostToolUse": {
        const resposta = textoDaResposta(c["tool_response"]).trim();
        const linhas: LinhaSubagente[] = resposta === "" ? [] : [{ papel: "resultado", texto: cortar(resposta, 300) }];
        return { tipo: "atividade", subagente_id: id, rotulo, linhas };
      }
      default: return null;
    }
  },

  analisarLinha: () => [],
};
