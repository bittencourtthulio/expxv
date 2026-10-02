import { describe, expect, it } from "vitest";
import { tomDoUso } from "../../compartilhado/sistema";
import { anuncioDeTransicao, ariaChip, pontosSparkline, sinalDoTom, textoMb, textoPct, tomGeral } from "./sistema-formato";

describe("formatação do medidor", () => {
  it("limiares: âmbar a partir de 80, vermelho a partir de 92", () => {
    expect([0, 79, 80, 91, 92, 100].map(tomDoUso)).toEqual(["normal", "normal", "aviso", "aviso", "alerta", "alerta"]);
  });
  it("tom geral é o pior dos dois; sem amostra = normal", () => {
    expect(tomGeral(null)).toBe("normal");
    expect(tomGeral({ cpu: 10, ram: 85 })).toBe("aviso");
    expect(tomGeral({ cpu: 95, ram: 85 })).toBe("alerta");
  });
  it("aria-label leva os dois números", () => {
    expect(ariaChip({ cpu: 23, ram: 61 })).toBe("CPU 23 por cento, memória 61 por cento");
    expect(ariaChip(null)).toContain("aguardando");
  });
  it("o número é sempre texto; sem amostra mostra —", () => {
    expect(textoPct(23.4)).toBe("23%");
    expect(textoPct(undefined)).toBe("—");
  });
  it("sinal textual no aviso e no alerta (cor nunca é o único sinal)", () => {
    expect([sinalDoTom("normal"), sinalDoTom("aviso"), sinalDoTom("alerta")]).toEqual(["", "▲", "!"]);
  });
  it("anúncio só ao cruzar limiar", () => {
    const a = { cpu: 85, ram: 10 };
    expect(anuncioDeTransicao("normal", "normal", a)).toBeNull();
    expect(anuncioDeTransicao("aviso", "aviso", a)).toBeNull();
    expect(anuncioDeTransicao("normal", "aviso", a)).toBe("Atenção: CPU em 85 por cento.");
    expect(anuncioDeTransicao("aviso", "alerta", { cpu: 95, ram: 96 })).toBe("Alerta: CPU e memória em 96 por cento.");
    expect(anuncioDeTransicao("alerta", "normal", { cpu: 1, ram: 1 })).toBe("CPU e memória voltaram ao normal.");
  });
  it("MB e GB", () => {
    expect(textoMb(512)).toBe("512 MB");
    expect(textoMb(1536)).toBe("1,5 GB");
  });
  it("sparkline: 100% no topo, a série encosta na direita", () => {
    expect(pontosSparkline([], 120, 26, 60)).toBe("");
    const p = pontosSparkline([0, 100], 120, 26, 60).split(" ");
    expect(p[1]).toBe("120.0,0.0");
    expect(p[0]!.endsWith(",26.0")).toBe(true);
  });
});
