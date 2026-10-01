import { describe, expect, it } from "vitest";
import { LIMITE_OSC_PENDENTE, SanitizadorOsc, sanitizarOsc } from "./osc";

const ESC = "\u001b";
const BEL = "\u0007";

function emPedacos(texto: string, tamanho: number): string {
  const s = new SanitizadorOsc();
  let saida = "";
  for (let i = 0; i < texto.length; i += tamanho) saida += s.processar(texto.slice(i, i + tamanho));
  return saida + s.pendente;
}

describe("sanitizarOsc", () => {
  it("remove OSC 52 e OSC 8 com terminador BEL ou ST, preservando o texto ao redor", () => {
    const entrada = `antes${ESC}]52;c;Y29waWFy${BEL}meio${ESC}]8;;file:///tmp/x${BEL}link${ESC}]8;;${ESC}\\fim`;
    expect(sanitizarOsc(entrada)).toBe("antesmeiolinkfim");
  });

  it("deixa passar OSC inofensivo (título, cor) e CSI", () => {
    const entrada = `${ESC}]0;titulo${BEL}${ESC}[31mvermelho${ESC}[0m${ESC}]11;rgb:0/0/0${ESC}\\`;
    expect(sanitizarOsc(entrada)).toBe(entrada);
  });

  it("OSC 52 partido em qualquer ponto entre chunks continua removido", () => {
    const entrada = `a${ESC}]52;c;Y29waWFy${BEL}b${ESC}]8;id=1;http://x${ESC}\\c${ESC}]8;;${ESC}\\d`;
    for (let tamanho = 1; tamanho <= entrada.length; tamanho++) {
      expect(emPedacos(entrada, tamanho), `chunk de ${tamanho}`).toBe("abcd");
    }
  });

  it("ESC sozinho no fim do chunk não vaza o começo de uma OSC 52", () => {
    const s = new SanitizadorOsc();
    expect(s.processar(`x${ESC}`)).toBe("x");
    expect(s.processar(`]52;c;QQ==${BEL}y`)).toBe("y");
  });

  it("ESC sozinho que não vira OSC é devolvido no chunk seguinte", () => {
    const s = new SanitizadorOsc();
    expect(s.processar(`x${ESC}`)).toBe("x");
    expect(s.processar("[31mz")).toBe(`${ESC}[31mz`);
  });

  it("OSC 52 gigante (acima do limite retido) é descartado até o fim, sem vazar o corpo", () => {
    const s = new SanitizadorOsc();
    const corpo = "A".repeat(LIMITE_OSC_PENDENTE * 3);
    let saida = s.processar(`ok${ESC}]52;c;${corpo.slice(0, 10_000)}`);
    saida += s.processar(corpo.slice(10_000, 20_000));
    saida += s.processar(`${corpo.slice(20_000)}${BEL}depois`);
    expect(saida).toBe("okdepois");
  });

  it("OSC inofensivo gigante passa em vez de travar a saída", () => {
    const s = new SanitizadorOsc();
    const saida = s.processar(`${ESC}]0;${"t".repeat(LIMITE_OSC_PENDENTE + 10)}`);
    expect(saida.length).toBeGreaterThan(LIMITE_OSC_PENDENTE);
  });
});

describe("AUD-19: forma C1 de OSC (U+009D ... U+009C), aceita pelo xterm", () => {
  it("remove OSC 52 e OSC 8 escritos com os controles de 8 bits, inclusive partidos entre chunks", () => {
    expect(sanitizarOsc("a\u009d52;c;QUJD\u009cb")).toBe("ab");
    expect(sanitizarOsc("a\u009d8;;http://x\u009clink\u009d8;;\u009cb")).toBe("alinkb");
    expect(sanitizarOsc("a\u009d52;c;QUJD\u0007b")).toBe("ab"); // introduzida em C1, terminada com BEL
    expect(sanitizarOsc("a\u001b]52;c;QUJD\u009cb")).toBe("ab"); // introduzida com ESC ], terminada em C1
    const s = new SanitizadorOsc();
    expect(s.processar("a\u009d52;c;QU") + s.processar("JD\u009cb")).toBe("ab");
  });
  it("não mexe nas OSC inofensivas (título) na forma C1", () => {
    expect(sanitizarOsc("\u009d0;titulo\u009c")).toBe("\u001b]0;titulo\u001b\\");
  });
});

