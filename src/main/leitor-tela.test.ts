import { describe, expect, it } from "vitest";
import { criarLeitorDeTela } from "./leitor-tela";

describe("leitor de tela dos Panes", () => {
  it("devolve o texto da tela sem escapes e só as últimas N linhas", async () => {
    const l = criarLeitorDeTela({ colunas: 40, linhas: 5 });
    l.registrar("s1");
    for (let i = 1; i <= 500; i++) l.alimentar("s1", `\u001b[32mlinha ${i}\u001b[0m\r\n`);
    const ultimas = await l.ler("s1", 100);
    expect(ultimas).toHaveLength(100);
    expect(ultimas?.[99]).toBe("linha 500");
    expect(ultimas?.[0]).toBe("linha 401");
    expect(ultimas?.join("\n")).not.toContain("\u001b");
    l.fechar();
  });

  it("junta linhas quebradas pela largura e ignora o que não foi registrado", async () => {
    const l = criarLeitorDeTela({ colunas: 10, linhas: 5 });
    l.alimentar("nao", "x"); // ignorado
    expect(await l.ler("nao", 5)).toBeNull();
    l.registrar("s2");
    l.alimentar("s2", "abcdefghijklmnopqrst\r\nfim\r\n");
    expect(await l.ler("s2", 10)).toEqual(["abcdefghijklmnopqrst", "fim"]);
    l.fechar();
  });

  it("o que chega antes de o xterm carregar não se perde, e liberar apaga a sessão", async () => {
    let liberar!: () => void;
    const { Terminal } = await import("@xterm/headless");
    const l = criarLeitorDeTela({ carregar: () => new Promise((r) => { liberar = () => r(Terminal as never); }) });
    l.registrar("s3");
    l.alimentar("s3", "cedo\r\n");
    liberar();
    expect(await l.ler("s3", 5)).toEqual(["cedo"]);
    l.liberar("s3");
    expect(l.tem("s3")).toBe(false);
    expect(await l.ler("s3", 5)).toBeNull();
  });
});
