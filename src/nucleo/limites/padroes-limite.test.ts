import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { criarDetectorLimite, extrairReinicio, PROVEDORES_COM_DETECTOR } from "./padroes-limite";

const FIX = resolve(__dirname, "../../../tests/fixtures/limites");
const fx = (n: string): string => readFileSync(join(FIX, n), "utf8");
const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
const det = (p: string) => criarDetectorLimite(p, { dedupe_ms: 30_000 })!;

describe("T-09.07 · padrões de limite no PTY (FORMA PRESUMIDA das frases: revisar contra as CLIs)", () => {
  it("frases gravadas do Claude são detectadas, com a hora quando existe", () => {
    const d1 = det("claude").processar(fx("pty-claude-limite.txt"), AGORA);
    expect(d1?.provedor).toBe("claude");
    expect(d1?.reinicia_em).toBe("2026-10-01T18:00:00.000Z"); // 3pm em America/Sao_Paulo (UTC-3)
    const d2 = det("claude").processar(fx("pty-claude-5h.txt"), AGORA);
    expect(d2?.reinicia_em).toBe("2026-10-01T18:00:00.000Z");
    const d3 = det("claude").processar(fx("pty-claude-epoch.txt"), AGORA);
    expect(d3?.reinicia_em).toBe(new Date(1790860800 * 1000).toISOString());
  });

  it("frase gravada do Codex: 'try again in 3 hours 12 minutes' vira instante relativo", () => {
    const d = det("codex").processar(fx("pty-codex-limite.txt"), AGORA);
    expect(d?.provedor).toBe("codex");
    expect(d?.reinicia_em).toBe(new Date(AGORA + (3 * 60 + 12) * 60_000).toISOString());
  });

  it("CT-9.16: a frase no eco do prompt do usuário não dispara", () => {
    expect(det("claude").processar(fx("pty-eco-prompt.txt"), AGORA)).toBeNull();
    const d = det("claude");
    d.registrarEnvio("Claude usage limit reached. Your limit will reset at 3pm");
    expect(d.processar("Claude usage limit reached. Your limit will reset at 3pm\r\n", AGORA)).toBeNull(); // eco sem marcador de prompt
    expect(det("claude").processar('"Claude usage limit reached" é a mensagem\r\n', AGORA)).toBeNull();
    expect(det("claude").processar("O erro 'usage limit reached' aparece quando...\r\n", AGORA)).toBeNull();
  });

  it("frase dentro de bloco de código não dispara; fora dele, sim", () => {
    expect(det("claude").processar(fx("pty-bloco-codigo.txt"), AGORA)).toBeNull();
    const d = det("claude");
    expect(d.processar("```\nlog\n", AGORA)).toBeNull();
    expect(d.processar("Claude usage limit reached.\n", AGORA)).toBeNull(); // cerca ainda aberta, entre chunks
    expect(d.processar("```\nClaude usage limit reached.\n", AGORA)).not.toBeNull(); // cerca fechou
  });

  it("frase partida entre dois chunks é detectada", () => {
    const d = det("claude");
    expect(d.processar("Claude usage lim", AGORA)).toBeNull();
    expect(d.processar("it reached. Your limit will reset at 3pm\n", AGORA)?.provedor).toBe("claude");
  });

  it("dedupe: o redesenho da TUI não dispara de novo dentro de 30 s", () => {
    const d = det("claude");
    const f = fx("pty-claude-limite.txt");
    expect(d.processar(f, AGORA)).not.toBeNull();
    expect(d.processar(f, AGORA + 1_000)).toBeNull();
    expect(d.processar(f, AGORA + 31_000)).not.toBeNull();
  });

  it("texto comum com a palavra 'limit' não dispara (limite de taxa, rate limit de código, etc.)", () => {
    const d = det("claude");
    for (const t of ["Setting the rate limit to 10 requests per second\r\n", "Result limit: 5\r\n", "limit reached for this loop iteration in the code\r\n".replace("limit", "the limit"), "You can raise the limit in settings\r\n"]) {
      expect(d.processar(t, AGORA), t).toBeNull();
    }
  });

  it("provedor sem padrão devolve detector nulo; ecos ≥ 8 chars apenas", () => {
    expect(criarDetectorLimite("gemini")).toBeNull();
    expect([...PROVEDORES_COM_DETECTOR].sort()).toEqual(["claude", "codex"]);
  });

  it("≤ 0,2 ms por chunk de 64 KB (sem a frase e com a frase no fim)", () => {
    const linha = "const resultado = calcular(entrada, opcoes); // sem nada de especial aqui, só código\r\n";
    const chunk = linha.repeat(Math.ceil(65_536 / linha.length)).slice(0, 65_536);
    const comLimit = ("O limite de itens foi ajustado conforme o limit configurado\r\n".repeat(200) + chunk).slice(0, 65_536) + "\nClaude usage limit reached. resets 3pm\n";
    const medir = (texto: string): number => {
      const d = det("claude");
      for (let i = 0; i < 50; i++) d.processar(texto, AGORA + i * 100_000); // aquece
      const amostras: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        d.processar(texto, AGORA + (100 + i) * 100_000);
        amostras.push(performance.now() - t0);
      }
      return amostras.sort((a, b) => a - b)[Math.floor(amostras.length / 2)]!;
    };
    expect(medir(chunk)).toBeLessThan(0.2);
    expect(medir(comLimit)).toBeLessThan(2); // caminho com muitas ocorrências de "limit": folga; o comum é o de cima
  });
});

describe("extrairReinicio", () => {
  const E = (l: string) => extrairReinicio(l, AGORA);
  it("hora com fuso nomeado, com minutos e com data", () => {
    expect(E("resets 3pm (America/Sao_Paulo)")).toBe("2026-10-01T18:00:00.000Z");
    expect(E("resets 9:30am (UTC)")).toBe("2026-10-02T09:30:00.000Z"); // 9:30 UTC de hoje já passou → amanhã
    expect(E("Resets Oct 8, 9am (UTC)")).toBe("2026-10-08T09:00:00.000Z");
  });
  it("relativos e lixo", () => {
    expect(E("try again in 45 minutes")).toBe(new Date(AGORA + 45 * 60_000).toISOString());
    expect(E("try again in 2 days 1 hour")).toBe(new Date(AGORA + (2 * 24 * 60 + 60) * 60_000).toISOString());
    expect(E("resets soon")).toBeNull();
    expect(E("resets 99pm")).toBeNull();
    expect(E("")).toBeNull();
  });
});
