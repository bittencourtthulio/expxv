// Suíte de contrato compartilhada pelos dois adaptadores (T-12.08/T-12.09). Saídas gravadas, `--help` simulado, argv sem shell e sem esforço no prompt.
import { describe, expect, it } from "vitest";
import { verificarFlags, type AdaptadorHeadless } from "./adaptador";
import { criarAdaptadorClaude } from "./claude";
import { criarAdaptadorCodex } from "./codex";

const AJUDA_COMPLETA = "-p --output-format --permission-mode --strict-mcp-config --mcp-config --disable-slash-commands --no-session-persistence --model --effort --tools --json --skip-git-repo-check --ephemeral -s -C";
const SAIDA: Record<string, string> = {
  claude: '{"type":"system"}\n{"type":"result","subtype":"success","total_cost_usd":0.0421,"num_turns":4,"usage":{"input_tokens":1500,"output_tokens":700,"cache_read_input_tokens":300,"cache_creation_input_tokens":50},"result":"pronto"}\n',
  codex: '{"type":"thread.started"}\n{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":200}}\n{"type":"turn.completed","usage":{"input_tokens":500,"cached_input_tokens":0,"output_tokens":100}}\n',
};

for (const a of [criarAdaptadorClaude(), criarAdaptadorCodex()] as AdaptadorHeadless[]) {
  describe(`contrato do adaptador ${a.cli}`, () => {
    const pedido = { modelo: "modelo-x", esforco: "high", workdir: "/dados/bench/exec/r/t/a", prompt: "Crie um index.html" };
    it("monta argv separado, sem shell, com o prompt por stdin e o esforço como flag (nunca no texto)", () => {
      const c = a.montar(pedido);
      expect(c.executavel).toBe(a.executavel);
      expect(c.stdin).toBe("Crie um index.html");
      expect(c.stdin).not.toMatch(/high|effort|esforço/i);
      expect(c.args.join(" ")).toContain("modelo-x");
      expect(c.args.join(" ")).toMatch(/high/);
      expect(c.args.every((x) => typeof x === "string" && !x.includes("&&") && !x.includes(";"))).toBe(true);
    });
    it("esforço fora do conjunto da CLI não vira flag e `esforcoValido` recusa", () => {
      expect(a.esforcoValido("extra-high-mega")).toBe(false);
      expect(a.esforcoValido(null)).toBe(true);
      expect(a.montar({ ...pedido, esforco: "extra-high-mega" }).args.join(" ")).not.toContain("extra-high-mega");
    });
    it("modelo com caractere fora do padrão seguro é descartado", () => {
      expect(a.montar({ ...pedido, modelo: "x; rm -rf /" }).args.join(" ")).not.toContain("rm -rf");
    });
    it("--help completo é ok; flag removida do --help → indisponível com o motivo", () => {
      expect(verificarFlags(a, AJUDA_COMPLETA).ok).toBe(true);
      const sem = verificarFlags(a, AJUDA_COMPLETA.replace("--json", "").replace("--output-format", "").replace("--ephemeral", "").replace("--permission-mode", ""));
      expect(sem.ok).toBe(false);
      expect(sem.faltam.length).toBeGreaterThan(0);
      expect(sem.motivo).toMatch(/não oferece/);
    });
    it("interpreta uso de saída gravada; revisões ficam nulas (não existe no uso)", () => {
      const u = a.interpretarUso(SAIDA[a.cli] as string);
      expect(u.tokens_out).toBeGreaterThan(0);
      expect(u.turnos).toBeGreaterThan(0);
    });
    it("saída truncada, vazia ou lixo NUNCA lança e devolve tudo nulo", () => {
      for (const lixo of ["", "{", '{"type":"result","usage":{"input_to', "isto não é json", "\u0000\u0001", '{"type":"turn.completed","usage":'])
        expect(() => a.interpretarUso(lixo)).not.toThrow();
      expect(a.interpretarUso("{")).toEqual({ tokens_in: null, tokens_out: null, tokens_cache: null, custo_relatado_usd: null, turnos: null });
    });
    it("modo juiz: sem escrita e sem aprovação automática", () => {
      const j = a.montar({ ...pedido, somente_leitura: true }).args.join(" ");
      expect(j).not.toMatch(/bypass|dangerously|workspace-write/);
    });
  });
}

describe("claude", () => {
  const a = criarAdaptadorClaude();
  it("usa MCP vazio estrito, sem skills e sem persistência; permissões sem prompt SÓ no modo de execução", () => {
    const exec = a.montar({ modelo: null, esforco: null, workdir: "/w", prompt: "x" }).args;
    expect(exec).toEqual(expect.arrayContaining(["-p", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "bypassPermissions"]));
    expect(exec[exec.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect(a.montar({ modelo: null, esforco: null, workdir: "/w", prompt: "x", somente_leitura: true }).args).not.toContain("bypassPermissions");
  });
  it("custo relatado e tokens de cache vêm da saída gravada", () => {
    const u = a.interpretarUso(SAIDA["claude"] as string);
    expect(u).toEqual({ tokens_in: 1500, tokens_out: 700, tokens_cache: 350, custo_relatado_usd: 0.0421, turnos: 4 });
    expect(a.extrairTexto(SAIDA["claude"] as string)).toBe("pronto");
  });
  it("sem custo na saída → custo relatado nulo (nunca zero)", () => {
    expect(a.interpretarUso('{"type":"result","num_turns":1,"usage":{"input_tokens":1,"output_tokens":2}}').custo_relatado_usd).toBeNull();
  });
});

describe("codex", () => {
  const a = criarAdaptadorCodex();
  it("NUNCA monta o bypass total e usa o sandbox da própria CLI (workspace-write)", () => {
    const args = a.montar({ modelo: "m", esforco: "medium", workdir: "/w", prompt: "x" }).args;
    const t = args.join(" ");
    expect(t).not.toMatch(/dangerously|bypass|--yolo|danger-full-access/);
    expect(args[args.indexOf("-s") + 1]).toBe("workspace-write");
    expect(args).toContain("--ephemeral");
    expect(args[args.indexOf("-C") + 1]).toBe("/w");
    expect(args.at(-1)).toBe("-");
    expect(a.capacidades.sandbox).toBe("nativo");
  });
  it("--help sem o modo de sandbox da CLI → indisponível", () => {
    expect(verificarFlags(a, AJUDA_COMPLETA.replace(" -s ", " ")).ok).toBe(false);
  });
  it("soma turnos e separa o cache da entrada (não conta duas vezes)", () => {
    expect(a.interpretarUso(SAIDA["codex"] as string)).toEqual({ tokens_in: 1100, tokens_out: 300, tokens_cache: 400, custo_relatado_usd: null, turnos: 2 });
  });
});
