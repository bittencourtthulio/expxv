import { describe, expect, it } from "vitest";
import { criarCauda, limparAnsi, linhaDeLog, redigir } from "./saida";
import { comTil, compararVersoes, mascararCaminho, versaoValida } from "./modelo";

describe("saída limpa e redigida", () => {
  it("tira ANSI, OSC e controle; barra de progresso (\\r) fica com o último trecho", () => {
    expect(limparAnsi("\u001b[32mverde\u001b[0m ok")).toBe("verde ok");
    expect(limparAnsi("\u001b]8;;http://x\u0007link\u001b]8;;\u0007")).toBe("link");
    expect(limparAnsi("10%\r50%\r100%")).toBe("100%");
    expect(limparAnsi("a\u0000b\u0007c")).toBe("abc");
  });
  it("redige tokens, credenciais em URL e caminhos de HOME", () => {
    const t = redigir("npm_" + "A".repeat(30) + " ghp_" + "b".repeat(30) + " https://u:senha@x.com/a //registry.npmjs.org/:_authToken=abc123 password=xyz /Users/ana/proj/a.txt", undefined, "/Users/ana");
    expect(t).not.toMatch(/AAAAAAAA|bbbbbbbb|senha|abc123|xyz|ana/);
    expect(t).toContain("~/proj/a.txt");
  });
  it("usa o scrubber extra (cofre) e nunca deixa ele derrubar", () => {
    expect(redigir("valor-do-cofre", (t) => t.replace("valor-do-cofre", "***"))).toBe("***");
    expect(redigir("ok", () => { throw new Error("x"); })).toBe("ok");
  });
  it("linha vazia some; linha enorme é cortada", () => {
    expect(linhaDeLog("  \u001b[0m ")).toBeNull();
    expect(linhaDeLog("x".repeat(5000))!.length).toBeLessThan(450);
  });
  it("cauda limitada avisa que descartou", () => {
    const c = criarCauda(3);
    for (let i = 0; i < 10; i += 1) c.adicionar(`l${i}`);
    expect(c.linhas()).toEqual(["l7", "l8", "l9"]);
    expect(c.truncado()).toBe(true);
    expect(c.total()).toBe(10);
  });
});

describe("versões e caminhos", () => {
  it("compara x.y.z", () => {
    expect(compararVersoes("0.8.0", "0.9.0")).toBeLessThan(0);
    expect(compararVersoes("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compararVersoes("1.0.0", "1.0.0")).toBe(0);
    expect(compararVersoes("x", "1.0.0")).toBeNull();
    expect(versaoValida("0.9.0")).toBe(true);
    expect(versaoValida("latest")).toBe(false);
    expect(versaoValida("0.9.0; rm -rf")).toBe(false);
  });
  it("til e máscara do início do caminho", () => {
    expect(comTil("/Users/ana/Projetos/x", "/Users/ana")).toBe("~/Projetos/x");
    expect(mascararCaminho("/Users/ana/Projetos/x", "/Users/ana")).toBe("~/…/x");
    expect(mascararCaminho("/Users/ana/Projetos/x", "/Users/ana")).not.toContain("ana");
    expect(mascararCaminho("/var/www/site", "/Users/ana")).toBe("~/…/site");
  });
});
