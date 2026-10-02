// CLI headless do chat (DEC-7): argv SEPARADOS (nunca shell), prompt por stdin, assinatura do usuário (nunca chave de API própria).
// Confirmado por `--help` local em 2026-09-30 (claude 2.1.286, codex-cli 0.157.1, opencode 1.18.33); o que NÃO foi confirmado
// (forma exata dos eventos) fica em parsers tolerantes e atrás de `verificarFlags`. Gemini: adaptador experimental, desligado.
// Nunca `--bare` (ignora o login por assinatura), nunca `--dangerously-bypass-*`, nunca `--auto`.
import type { PerfilChat } from "./tipos";

export interface ComandoHeadless {
  executavel: string;
  args: string[];
  /** prompt vai por stdin (`null` = vai no argv curto). */
  stdin: string | null;
  /** pasta neutra vazia (cwd); o chamador cria em `<userData>/chat/cwd`. */
  cwdNeutro: true;
}

export interface OpcoesComando {
  sistema: string;
  prompt: string;
  /** só usado pelo OpenCode (arquivo de contexto longo). */
  arquivoContexto?: string;
  pastaNeutra: string;
}

const EFEITO_CLAUDE = new Set(["low", "medium", "high", "xhigh", "max"]);
const EFEITO_CODEX = new Set(["minimal", "low", "medium", "high"]);
const seguro = (v: string): boolean => /^[A-Za-z0-9._:/@+-]{1,80}$/.test(v);

export function montarComando(perfil: PerfilChat, o: OpcoesComando): ComandoHeadless {
  const modelo = perfil.modelo !== null && seguro(perfil.modelo) ? perfil.modelo : null;
  switch (perfil.cli) {
    case "claude": {
      const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--system-prompt", o.sistema];
      if (modelo) args.push("--model", modelo);
      if (perfil.esforco && EFEITO_CLAUDE.has(perfil.esforco)) args.push("--effort", perfil.esforco);
      return { executavel: "claude", args, stdin: o.prompt, cwdNeutro: true };
    }
    case "codex": {
      const args = ["exec", "--json", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", o.pastaNeutra];
      if (modelo) args.push("-m", modelo);
      if (perfil.esforco && EFEITO_CODEX.has(perfil.esforco)) args.push("-c", `model_reasoning_effort="${perfil.esforco}"`);
      args.push("-");
      return { executavel: "codex", args, stdin: `${o.sistema}\n\n${o.prompt}`, cwdNeutro: true };
    }
    case "opencode": {
      const args = ["run", "--format", "json", "--pure", "--dir", o.pastaNeutra];
      if (modelo) args.push("-m", modelo);
      if (perfil.esforco && seguro(perfil.esforco)) args.push("--variant", perfil.esforco);
      if (o.arquivoContexto) args.push("-f", o.arquivoContexto);
      args.push(o.arquivoContexto ? "Responda conforme o contexto anexado." : o.prompt.slice(0, 4000));
      return { executavel: "opencode", args, stdin: null, cwdNeutro: true };
    }
    case "gemini":
      return { executavel: "gemini", args: ["-p", o.prompt.slice(0, 8000), "--output-format", "stream-json"], stdin: null, cwdNeutro: true };
  }
}

/** Flags que o adaptador usa por CLI (para `verificarFlags` contra `--help`). */
export const FLAGS_EXIGIDAS: Readonly<Record<string, readonly string[]>> = {
  claude: ["--output-format", "--include-partial-messages", "--tools", "--disable-slash-commands", "--no-session-persistence", "--system-prompt"],
  codex: ["--json", "--skip-git-repo-check", "--ephemeral", "-s"],
  opencode: ["--format", "--pure", "--dir"],
  gemini: ["--output-format"],
};

/** Confere se a ajuda da CLI cita todas as flags exigidas. Ausente → CLI `indisponivel` com o motivo. */
export function verificarFlags(cli: string, ajuda: string): { ok: boolean; motivo?: string } {
  const faltam = (FLAGS_EXIGIDAS[cli] ?? []).filter((f) => !ajuda.includes(f));
  return faltam.length === 0 ? { ok: true } : { ok: false, motivo: `a CLI não oferece: ${faltam.join(", ")}` };
}

/** Extrai o TEXTO de uma linha de saída JSON (tolerante). Ferramentas e raciocínio são ignorados. */
export function extrairTexto(cli: string, linha: string): string {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(linha) as Record<string, unknown>;
  } catch {
    return "";
  }
  if (cli === "claude") {
    if (o.type === "stream_event") {
      const ev = o.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") return ev.delta.text;
    }
    return "";
  }
  if (cli === "codex") {
    const item = (o.item ?? (o.msg as Record<string, unknown> | undefined)) as { type?: string; text?: string; message?: string } | undefined;
    if (item && (item.type === "agent_message" || item.type === "assistant_message") && typeof (item.text ?? item.message) === "string") return (item.text ?? item.message) as string;
    return "";
  }
  const t = (o as { type?: string; text?: string; part?: { type?: string; text?: string } });
  if (t.part?.type === "text" && typeof t.part.text === "string") return t.part.text;
  if (t.type === "text" && typeof t.text === "string") return t.text;
  return "";
}

export const SAIDA_MAX_BYTES = 1024 * 1024;
export const TIMEOUT_HEADLESS_MS = 120_000;
