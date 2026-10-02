import { describe, expect, it } from "vitest";
import {
  CAUDA_MAX_BYTES, TRECHO_FALHA_MAX, classificarFechamento, classificarSaidaEspontanea, criarMemoriaDeFechados, limparCauda, linhasDaCauda, trechoDaFalha, type FechadoPor, type WorkerFechado,
} from "./ciclo-worker";

const w = (id: string, extra: Partial<WorkerFechado> = {}): WorkerFechado => ({
  pane_id: id, mission_id: "m1", workspace_id: "ws", papel: "explorador", provedor: "claude", task_id: null, estado: "concluido", fechado_por: "auto", codigo: 0, fechado_em: 1_000, cauda: "oi", ...extra,
});

describe("classificarFechamento (tabela fechado_por × handoff)", () => {
  const T: Array<[FechadoPor, "ok" | "parcial" | "bloqueado" | "falhou" | null, string]> = [
    ["auto", "ok", "concluido"], ["auto", "parcial", "concluido"], ["auto", null, "concluido"], ["auto", "falhou", "falhou"], ["auto", "bloqueado", "fechado"],
    ["orquestrador", "ok", "concluido"], ["orquestrador", null, "fechado"], ["orquestrador", "falhou", "falhou"],
    ["dono", "ok", "concluido"], ["dono", null, "fechado"],
    ["erro", null, "falhou"], ["erro", "ok", "falhou"],
  ];
  for (const [por, status, esperado] of T) {
    it(`${por} + handoff ${status ?? "nenhum"} => ${esperado}`, () => {
      expect(classificarFechamento({ fechado_por: por, handoff: status === null ? null : { status } })).toBe(esperado);
    });
  }
});

describe("saída espontânea da CLI", () => {
  it("código 0 conclui; qualquer outro código ou sinal (código nulo) é falha", () => {
    expect(classificarSaidaEspontanea({ codigo: 0 })).toBe("concluida");
    expect(classificarSaidaEspontanea({ codigo: 1 })).toBe("falhou");
    expect(classificarSaidaEspontanea({ codigo: 143 })).toBe("falhou");
    expect(classificarSaidaEspontanea({ codigo: null })).toBe("falhou");
  });
});

describe("limparCauda", () => {
  const sem = (t: string): string => t;
  it("tira ANSI, OSC e controles; mantém quebras de linha e tabs", () => {
    const t = limparCauda(["\u001b[1;31mvermelho\u001b[0m", "\u001b]0;título\u0007corpo\u0007x", "a\tb\u0000\u0008c"], sem);
    expect(t).toBe("vermelho\ncorpox\na\tbc");
  });
  it("passa pelo redator (segredo nunca sobra) ANTES de cortar", () => {
    const t = limparCauda(["token: sk-abcdefghijklmnopqrstuvwxyz0123456789", "fim"], (x) => x.replace(/sk-[A-Za-z0-9]+/g, "[REDIGIDO]"));
    expect(t).not.toContain("sk-abcdef");
    expect(t).toContain("[REDIGIDO]");
  });
  it("corta nos últimos 16 KB, em início de linha, sem ultrapassar o teto", () => {
    const linhas = Array.from({ length: 3_000 }, (_, i) => `linha ${String(i).padStart(5, "0")} ${"x".repeat(20)}`);
    const t = limparCauda(linhas, sem);
    expect(Buffer.byteLength(t)).toBeLessThanOrEqual(CAUDA_MAX_BYTES);
    expect(t.endsWith("linha 02999 xxxxxxxxxxxxxxxxxxxx")).toBe(true);
    expect(t.startsWith("linha ")).toBe(true);
  });
  it("não parte um caractere multibyte ao cortar", () => {
    const t = limparCauda(["é".repeat(20_000)], sem);
    expect(Buffer.byteLength(t)).toBeLessThanOrEqual(CAUDA_MAX_BYTES);
    expect(t).not.toContain("�");
  });
  it("vazio continua vazio", () => { expect(limparCauda([], sem)).toBe(""); });
});

describe("memória de workers fechados (só processo, 10 min)", () => {
  it("guarda e devolve; depois do prazo some (descartada na leitura)", () => {
    let t = 1_000;
    const m = criarMemoriaDeFechados({ agora: () => t, ttlMs: 600_000 });
    m.registrar(w("p1", { fechado_em: t }));
    t += 599_999;
    expect(m.obter("p1")?.cauda).toBe("oi");
    t += 2;
    expect(m.obter("p1")).toBeUndefined();
    expect(m.tamanho()).toBe(0);
  });
  it("lista por Missão e respeita o teto de entradas (a mais antiga sai)", () => {
    let t = 1;
    const m = criarMemoriaDeFechados({ agora: () => t, max: 3 });
    for (const id of ["a", "b", "c", "d"]) { t += 1; m.registrar(w(id, { fechado_em: t, mission_id: id === "d" ? "m2" : "m1" })); }
    expect(m.obter("a")).toBeUndefined();
    expect(m.daMissao("m1").map((x) => x.pane_id)).toEqual(["b", "c"]);
    expect(m.daMissao("m2").map((x) => x.pane_id)).toEqual(["d"]);
  });
  it("registrar de novo o mesmo Pane substitui; descartar e limpar esvaziam", () => {
    const m = criarMemoriaDeFechados({ agora: () => 5 });
    m.registrar(w("p", { cauda: "um", fechado_em: 5 }));
    m.registrar(w("p", { cauda: "dois", fechado_em: 5 }));
    expect(m.obter("p")?.cauda).toBe("dois");
    m.descartar("p");
    expect(m.obter("p")).toBeUndefined();
    m.registrar(w("q", { fechado_em: 5 }));
    m.limpar();
    expect(m.tamanho()).toBe(0);
  });
});

describe("recortes da cauda", () => {
  it("linhasDaCauda devolve as últimas N linhas", () => {
    expect(linhasDaCauda("a\nb\nc\nd", 2)).toEqual(["c", "d"]);
    expect(linhasDaCauda("", 5)).toEqual([]);
  });
  it("trechoDaFalha respeita o teto", () => {
    const longa = Array.from({ length: 400 }, (_, i) => `linha ${i}`).join("\n");
    expect(trechoDaFalha(longa).length).toBeLessThanOrEqual(TRECHO_FALHA_MAX);
    expect(trechoDaFalha("curta")).toBe("curta");
  });
});
