import { describe, expect, it } from "vitest";
import { parseComando, parseSilenciar, respostaAtrasadas, respostaConsumo, respostaGates, respostaMissoes, respostaStatus, respostaTarefas, RESPOSTA_MAX, textoAjuda } from "./comandos";
import type { LinhaTarefaConsulta } from "./portas-entrada";

const tarefa = (p: Partial<LinhaTarefaConsulta> = {}): LinhaTarefaConsulta => ({ task_id: "T-1", titulo: "Corrigir <login> & cia", story_points: 3, tempo_trabalho_ms: 3_600_000, tokens: 1234, atraso_ms: 60_000, limite_ms: 1_800_000, quem: "claude", ...p });

describe("parser de comandos (T-20.27)", () => {
  it.each([
    ["/status", { cmd: "status", args: "" }],
    ["/STATUS", { cmd: "status", args: "" }],
    ["/pedir corrige o bug", { cmd: "pedir", args: "corrige o bug" }],
    ["/pedir@meu_bot corrige", { cmd: "pedir", args: "corrige" }],
    ["/start ABCDE", { cmd: "start", args: "ABCDE" }],
    ["  /ajuda   ", { cmd: "ajuda", args: "" }],
    ["/silenciar tudo 2h", { cmd: "silenciar", args: "tudo 2h" }],
  ])("%s", (t, esperado) => {
    expect(parseComando(t, "meu_bot")).toMatchObject({ tipo: "comando", conhecido: true, ...esperado });
  });
  it("sufixo de outro bot é ignorado; texto livre; desconhecido; bot sem username ainda", () => {
    expect(parseComando("/status@outro_bot", "meu_bot")).toEqual({ tipo: "ignorar" });
    expect(parseComando("/status@meu_bot", "MEU_BOT")).toMatchObject({ cmd: "status" });
    expect(parseComando("/status@meu_bot", null)).toEqual({ tipo: "ignorar" });
    expect(parseComando("corrige o bug", "b")).toEqual({ tipo: "texto", texto: "corrige o bug" });
    expect(parseComando("/xpto", "b")).toMatchObject({ tipo: "comando", cmd: "xpto", conhecido: false });
    expect(parseComando("/", "b")).toMatchObject({ tipo: "comando", conhecido: false });
  });
  it("10 000 caracteres de argumento não travam (<= 5 ms)", () => {
    const t0 = performance.now();
    const r = parseComando(`/pedir ${"a b ".repeat(5000)}`, "b");
    expect(performance.now() - t0).toBeLessThan(5);
    expect(r.tipo === "comando" && r.args.length).toBeLessThanOrEqual(4000);
  });
  it.each([
    ["", { ms: 3_600_000, incluir_criticos: false }], ["30m", { ms: 1_800_000, incluir_criticos: false }], ["2h", { ms: 7_200_000, incluir_criticos: false }], ["45", { ms: 2_700_000, incluir_criticos: false }],
    ["tudo 2h", { ms: 7_200_000, incluir_criticos: true }], ["off", { ms: 0, incluir_criticos: false }], ["TUDO 30 min", { ms: 1_800_000, incluir_criticos: true }],
  ])("/silenciar '%s'", (a, esperado) => {
    expect(parseSilenciar(a)).toEqual(esperado);
  });
  it.each(["banana", "25h", "-3h", "0h", "tudo", "2d"])("/silenciar inválido '%s'", (a) => {
    expect(parseSilenciar(a)).toBeNull();
  });
});

describe("respostas (golden) ", () => {
  it("/status mostra 'sem fonte' quando for o caso e escapa HTML", () => {
    const r = respostaStatus({ missoes: [{ titulo: "Missão <x>", panes_trabalhando: 1, panes_aguardando: 2 }], emAndamento: [tarefa({ tokens: null, story_points: null, tempo_trabalho_ms: null })], atrasadas: 1, cotaPct: null, criticos: 2 });
    expect(r).toContain("Cota geral: sem fonte");
    expect(r).toContain("tokens sem fonte");
    expect(r).toContain("sem estimativa pts");
    expect(r).toContain("sem medição");
    expect(r).toContain("Missão &lt;x&gt;");
    expect(r).not.toContain("<x>");
  });
  it("/atrasadas lista tempo x limite e SP", () => {
    const r = respostaAtrasadas([tarefa()]);
    expect(r).toContain("trabalhando 1 h 00 — limite 30 min");
    expect(r).toContain("3 pts");
    expect(respostaAtrasadas([])).toBe("Nada atrasado.");
  });
  it("todas as respostas <= 1 500 caracteres mesmo com muitos itens longos", () => {
    const muitas = Array.from({ length: 50 }, (_, i) => tarefa({ task_id: `T-${i}`, titulo: "x".repeat(300) }));
    for (const r of [respostaTarefas(muitas, muitas), respostaAtrasadas(muitas), respostaStatus({ missoes: [], emAndamento: muitas, atrasadas: 50, cotaPct: 10, criticos: 0 }), respostaMissoes(Array.from({ length: 50 }, () => ({ titulo: "m".repeat(200), panes_trabalhando: 1, panes_aguardando: 0 }))), respostaConsumo(Array.from({ length: 50 }, (_, i) => ({ conta: `c${i}`, provedor: "claude", pct: 10 })), 10), respostaGates(Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, titulo: "t".repeat(200), workspace_id: "w", exige_humano: i % 2 === 0 }))), textoAjuda("aprovar")]) expect(r.length).toBeLessThanOrEqual(RESPOSTA_MAX + 1);
  });
  it("segredo no título de tarefa não sai", () => {
    expect(respostaTarefas([tarefa({ titulo: "usar /Users/ana/projeto/x.ts e e-mail ana@empresa.com" })], [])).not.toMatch(/\/Users|ana@/);
  });
  it("ajuda por modo", () => {
    expect(textoAjuda("consulta")).toContain("só consulta");
    expect(textoAjuda("consulta")).not.toContain("/pedir texto");
    expect(textoAjuda(null)).toContain("Nenhum workspace liberado");
    expect(textoAjuda("direto")).toContain("Modo atual: direto");
  });
});
