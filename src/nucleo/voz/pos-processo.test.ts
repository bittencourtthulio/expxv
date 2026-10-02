import { describe, expect, it } from "vitest";
import { aplicarDicionario, contarPalavras, juntarFalas, prepararTextoDitado, promptDoMotor, sanitizarParaPty } from "./pos-processo";

const termos = [{ termo: "config.json", dica: null }, { termo: "Supabase", dica: "super base" }, { termo: "API", dica: null }];

describe("pós-processamento do ditado", () => {
  it("config.json e Supabase do dicionário sobrevivem à grafia do motor", () => {
    expect(aplicarDicionario("abra o Config.JSON e conecte no supabase", termos)).toBe("abra o config.json e conecte no Supabase");
    expect(aplicarDicionario("a apis e a api", termos)).toBe("a apis e a API");
  });

  it("ordem estável: termo longo vence o curto", () => {
    const t = [{ termo: "API", dica: null }, { termo: "API key", dica: null }];
    expect(aplicarDicionario("minha api key", t)).toBe("minha API key");
    expect(aplicarDicionario("minha api key", [...t].reverse())).toBe("minha API key");
  });

  it("sanitização remove ESC, CSI, OSC, controles, CR/LF e nunca termina em quebra de linha", () => {
    const sujo = "ls\x1b[31m -la\r\nrm -rf /\x1b]52;c;ZGFkb3M=\x07 feito\x00\x07\t fim\r\n";
    const limpo = sanitizarParaPty(sujo);
    expect(limpo).toBe("ls -la rm -rf / feito fim");
    expect(limpo).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(sanitizarParaPty("a‮b​c")).toBe("abc");
  });

  it("teto de 4 000 caracteres", () => {
    expect(sanitizarParaPty("a ".repeat(5_000)).length).toBeLessThanOrEqual(4_000);
  });

  it("falas consecutivas viram 'A B'", () => {
    expect(juntarFalas("primeira", " segunda ")).toBe("primeira segunda");
    expect(juntarFalas("", "x")).toBe("x");
    expect(contarPalavras("um dois  três")).toBe(3);
  });

  it("caminho completo: bruto -> dicionário -> sanitização", () => {
    expect(prepararTextoDitado("abra \x1b[31mconfig.json\r\n", termos)).toBe("abra config.json");
  });

  it("dica do motor lista os termos com teto", () => {
    expect(promptDoMotor(termos)).toBe("config.json, Supabase (super base), API");
    expect(promptDoMotor(termos, 12)).toBe("config.json");
  });
});
