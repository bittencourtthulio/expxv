// Adaptador do Claude Code (T-12.08). Flags reais [LAC]: confirmadas por `verificarFlags` (--help) a cada Run e pela validação mínima autorizada (P-37). Sandbox EXTERNO (sandbox-exec);
// MCP vazio e `--strict-mcp-config` (sem MCP do app nem do usuário); `--disable-slash-commands` (sem skills); conta/config dedicada por `CLAUDE_CONFIG_DIR` (sem hooks nem CLAUDE.md do usuário).
// Nunca `--bare` (ignora o login por assinatura). `revisoes = null` no MVP.
import { SEGURO, USO_VAZIO, numero, ultimoObjetoJson, type AdaptadorHeadless, type PedidoMontagem, type UsoInterpretado } from "./adaptador";

const EFEITOS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function criarAdaptadorClaude(): AdaptadorHeadless {
  return {
    cli: "claude",
    executavel: "claude",
    capacidades: { esforco: "flag", sandbox: "externo", sem_mcp: true, sem_skills: true, harness_zero: "garantido" },
    flagsExigidas: ["--output-format", "--permission-mode", "--strict-mcp-config", "--mcp-config", "--disable-slash-commands", "--no-session-persistence", "--model", "--effort"],
    variavelConfig: "CLAUDE_CONFIG_DIR",
    esforcoValido: (e) => e === null || EFEITOS.has(e),
    montar(p: PedidoMontagem, executavel = "claude") {
      const args = ["-p", "--output-format", "json", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--no-session-persistence"];
      if (p.somente_leitura === true) args.push("--tools", "Read", "--permission-mode", "default");
      else args.push("--permission-mode", "bypassPermissions");
      if (p.modelo !== null && SEGURO.test(p.modelo)) args.push("--model", p.modelo);
      if (p.esforco !== null && EFEITOS.has(p.esforco)) args.push("--effort", p.esforco);
      return { executavel, args, stdin: p.prompt };
    },
    extrairTexto(saida: string): string {
      try { return ultimoObjetoJson(saida, (o) => (o["type"] === "result" && typeof o["result"] === "string" ? o["result"] : null)) ?? ""; } catch { return ""; }
    },
    interpretarUso(saida: string): UsoInterpretado {
      try {
        return ultimoObjetoJson(saida, (o) => {
          if (o["type"] !== "result") return null;
          const u = (typeof o["usage"] === "object" && o["usage"] !== null ? o["usage"] : {}) as Record<string, unknown>;
          const cache = (numero(u["cache_read_input_tokens"]) ?? 0) + (numero(u["cache_creation_input_tokens"]) ?? 0);
          return { tokens_in: numero(u["input_tokens"]), tokens_out: numero(u["output_tokens"]), tokens_cache: numero(u["input_tokens"]) === null ? null : cache, custo_relatado_usd: numero(o["total_cost_usd"]), turnos: numero(o["num_turns"]) };
        }) ?? USO_VAZIO;
      } catch {
        return USO_VAZIO;
      }
    },
  };
}
