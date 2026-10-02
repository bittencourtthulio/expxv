import { describe, expect, it } from "vitest";
import { MENSAGEM_MAX, PANES_MAX, diferencaSnapshot, limparTexto, montarSnapshot, type LinhaPane } from "./snapshot";

const pane = (i: number, estado = "trabalhando", extra: Partial<LinhaPane> = {}): LinhaPane => ({ pane_id: `p${i}`, display_id: String(i), label: `painel ${i}`, estado, ultima_mensagem: `msg ${i}`, pergunta_pendente: null, atualizado_em: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, ...extra });

describe("snapshot", () => {
  it("<= 10 painéis, aguardando primeiro, sempre untrusted (50 painéis)", () => {
    const todos = Array.from({ length: 50 }, (_, i) => pane(i, i === 40 ? "aguardando" : "trabalhando"));
    const s = montarSnapshot(todos);
    expect(s).toHaveLength(PANES_MAX);
    expect(s[0]?.display_id).toBe("40");
    expect(s.every((p) => p.untrusted === true)).toBe(true);
  });
  it("cada mensagem <= 300, sem ANSI/OSC/controle, segredo mascarado (AC-14)", () => {
    const sujo = `\u001b[31mvermelho\u001b[0m \u001b]0;titulo\u0007 chave sk-ant-api03-${"C".repeat(40)} ` + "z".repeat(5000);
    const [p] = montarSnapshot([pane(1, "trabalhando", { ultima_mensagem: sujo })]);
    expect(p?.last_message.length).toBeLessThanOrEqual(MENSAGEM_MAX);
    expect(p?.last_message).not.toMatch(/\u001b|\u0007|sk-ant-api03/);
  });
  it("pergunta pendente só quando aguardando; encerrados somem", () => {
    const s = montarSnapshot([pane(1, "trabalhando", { pergunta_pendente: "continuar?" }), pane(2, "aguardando", { pergunta_pendente: "continuar?" }), pane(3, "encerrado")]);
    expect(s.find((p) => p.display_id === "1")?.pending_question).toBeNull();
    expect(s.find((p) => p.display_id === "2")?.pending_question).toBe("continuar?");
    expect(s.some((p) => p.display_id === "3")).toBe(false);
  });
  it("diferença só devolve o que mudou (P-61)", () => {
    const a = montarSnapshot([pane(1), pane(2)]);
    const b = montarSnapshot([pane(1), pane(2, "aguardando")]);
    expect(diferencaSnapshot(a, b).map((p) => p.display_id)).toEqual(["2"]);
    expect(diferencaSnapshot(a, a)).toEqual([]);
  });
  it("texto de painel com HTML é mantido como texto (quem renderiza usa textContent/JSX)", () => {
    expect(limparTexto("<img src=x onerror=alert(1)> **negrito**", 100)).toContain("<img");
  });
});
