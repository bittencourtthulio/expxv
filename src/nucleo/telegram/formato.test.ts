import { describe, expect, it } from "vitest";
import { contarVisiveis, dividir, escaparHtml, htmlParaTexto, lerCallback, montarCallback, montarHtml, novoNonce, teclado, LIMITE_API } from "./formato";
import { subirTelegramFalso } from "../../../tests/fixtures/alertas/telegram-falso";

// gerador pseudo-aleatório determinístico
function lcg(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const ALFABETO = ["a", "b", " ", "\n", "<", ">", "&", "😀", "é", "‮", "​", "&amp;", "<b>", "</b>", "<i>x</i>", "ç", "<script>"];

describe("formato HTML (T-20.21)", () => {
  it("escapa só & < >", () => {
    expect(escaparHtml(`a & <b> "c"`)).toBe(`a &amp; &lt;b&gt; "c"`);
  });
  it("contagem visível é DEPOIS do parse", () => {
    expect(contarVisiveis("<b>oi</b> &amp; &lt;")).toBe(6);
    expect(htmlParaTexto("<b>a</b> &amp; &lt;x&gt;")).toBe("a & <x>");
  });
  it("montarHtml escapa valores e mantém só b/i/code", () => {
    expect(montarHtml([{ t: "b", v: "[Atrasada]" }, { t: "texto", v: " x<y" }, { t: "code", v: "T-1&" }])).toBe("<b>[Atrasada]</b> x&lt;y<code>T-1&amp;</code>");
  });
  it("divide em linhas inteiras, sem tag desbalanceada e sem passar do limite", () => {
    const linhas = Array.from({ length: 200 }, (_, i) => `<b>[${i}]</b> linha com texto &amp; <i>itálico</i>`);
    const partes = dividir(linhas.join("\n"), 500);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) {
      expect(contarVisiveis(p)).toBeLessThanOrEqual(500);
      expect((p.match(/<b>/g) ?? []).length).toBe((p.match(/<\/b>/g) ?? []).length);
      expect((p.match(/<i>/g) ?? []).length).toBe((p.match(/<\/i>/g) ?? []).length);
      expect(p).not.toMatch(/&(?![a-z]+;)/);
    }
    expect(partes.map(htmlParaTexto).join("\n").replace(/\n+/g, "\n")).toContain("[199]");
  });
  it("linha única gigante é quebrada com as tags fechadas e reabertas", () => {
    const partes = dividir(`<b>${"a".repeat(1200)}</b>`, 500);
    expect(partes).toHaveLength(3);
    for (const p of partes) expect(p.startsWith("<b>") && p.endsWith("</b>")).toBe(true);
  });
  it("propriedade: 1 000 entradas aleatórias viram HTML aceito pelo servidor falso e <= 4096 visíveis", async () => {
    const falso = await subirTelegramFalso();
    try {
      const r = lcg(42);
      for (let i = 0; i < 1000; i++) {
        const n = Math.floor(r() * 60);
        let bruto = "";
        for (let k = 0; k < n; k++) bruto += ALFABETO[Math.floor(r() * ALFABETO.length)];
        if (i % 97 === 0) bruto = "x".repeat(10_000) + bruto;
        const html = montarHtml([{ t: "b", v: "[T]" }, { t: "texto", v: ` ${bruto}` }]);
        for (const parte of dividir(html, 3500)) {
          expect(contarVisiveis(parte)).toBeLessThanOrEqual(LIMITE_API);
          const v = falso.validarMensagem(parte);
          expect(v, `entrada ${i}`).toBeNull();
        }
      }
    } finally {
      await falso.fechar();
    }
  });
  it("callback_data: nonce opaco; formato inválido ou >= 65 bytes recusado antes do envio", () => {
    const n = novoNonce();
    expect(n).toHaveLength(22);
    expect(lerCallback(montarCallback("a", n))).toEqual({ acao: "a", nonce: n });
    expect(lerCallback(`a:${"x".repeat(60)}`)).toBeNull();
    expect(lerCallback("z:" + n)).toBeNull();
    expect(lerCallback("a:" + n + "é")).toBeNull();
    expect(lerCallback(42)).toBeNull();
    expect(() => teclado([[{ rotulo: "Aprovar", dado: "a:curto" }]])).toThrow();
    expect(teclado([[{ rotulo: "Aprovar", dado: montarCallback("a", n) }]])[0]?.[0]?.callback_data).toBe(`a:${n}`);
    expect(new Set(Array.from({ length: 1000 }, novoNonce)).size).toBe(1000);
  });
});
