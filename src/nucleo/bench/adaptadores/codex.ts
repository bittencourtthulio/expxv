// Adaptador do Codex (T-12.09): `sandbox: nativo` (modo `workspace-write` da própria CLI; `sandbox-exec` NÃO se aninha, pois falharia). NUNCA o bypass total (`--dangerously-bypass-approvals-and-sandbox`
// nem `--yolo`, D-14). Config dedicada por `CODEX_HOME`. Outras CLIs ficam `nao_suportado` até existir adaptador.
import { SEGURO, USO_VAZIO, numero, type AdaptadorHeadless, type PedidoMontagem, type UsoInterpretado } from "./adaptador";

const EFEITOS = new Set(["minimal", "low", "medium", "high"]);

export function criarAdaptadorCodex(): AdaptadorHeadless {
  return {
    cli: "codex",
    executavel: "codex",
    capacidades: { esforco: "flag", sandbox: "nativo", sem_mcp: false, sem_skills: false, harness_zero: "parcial" },
    flagsExigidas: ["--json", "--skip-git-repo-check", "--ephemeral", "-s", "-C"],
    variavelConfig: "CODEX_HOME",
    esforcoValido: (e) => e === null || EFEITOS.has(e),
    flagsSandboxDaCli: (somenteLeitura) => ["-s", somenteLeitura ? "read-only" : "workspace-write"],
    montar(p: PedidoMontagem, executavel = "codex") {
      const args = ["exec", "--json", ...(["-s", p.somente_leitura === true ? "read-only" : "workspace-write"]), "--skip-git-repo-check", "--ephemeral", "-C", p.workdir];
      if (p.modelo !== null && SEGURO.test(p.modelo)) args.push("-m", p.modelo);
      if (p.esforco !== null && EFEITOS.has(p.esforco)) args.push("-c", `model_reasoning_effort="${p.esforco}"`);
      args.push("-");
      return { executavel, args, stdin: p.prompt };
    },
    extrairTexto(saida: string): string {
      let texto = "";
      for (const l of saida.split(/\r?\n/)) {
        if (!l.startsWith("{")) continue;
        try {
          const o = JSON.parse(l) as { item?: { type?: string; text?: string }; msg?: { type?: string; message?: string } };
          if (o.item?.type === "agent_message" && typeof o.item.text === "string") texto = o.item.text;
          else if (o.msg?.type === "agent_message" && typeof o.msg.message === "string") texto = o.msg.message;
        } catch { /* linha truncada */ }
      }
      return texto;
    },
    interpretarUso(saida: string): UsoInterpretado {
      try {
        let tin = 0, tout = 0, cache = 0, turnos = 0, achou = false;
        for (const l of saida.split(/\r?\n/)) {
          if (!l.startsWith("{")) continue;
          let o: Record<string, unknown>;
          try { o = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
          if (o["type"] !== "turn.completed") continue;
          const u = (typeof o["usage"] === "object" && o["usage"] !== null ? o["usage"] : {}) as Record<string, unknown>;
          const i = numero(u["input_tokens"]), s = numero(u["output_tokens"]);
          if (i === null && s === null) continue;
          achou = true;
          turnos++;
          const c = numero(u["cached_input_tokens"]) ?? 0;
          tin += Math.max(0, (i ?? 0) - c); tout += s ?? 0; cache += c;
        }
        // o Codex conta `input_tokens` já com o que veio do cache: separamos (entrada sem cache + cache) para o custo não contar duas vezes
        return achou ? { tokens_in: tin, tokens_out: tout, tokens_cache: cache, custo_relatado_usd: null, turnos } : USO_VAZIO;
      } catch {
        return USO_VAZIO;
      }
    },
  };
}
