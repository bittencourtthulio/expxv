import { describe, expect, it } from "vitest";
import { formatarBytes, formatarVelocidade, ParserProgressoGit, parsearLinhaProgresso } from "./progresso";

// Saída sintética no formato REAL do `git clone --progress` (stderr; atualizações separadas por \r, linhas finais por \n).
const SAIDA_GIT = [
  "Cloning into 'repo'...\n",
  "remote: Enumerating objects: 1234, done.\n",
  "remote: Counting objects:   0% (1/1234)\rremote: Counting objects:  50% (617/1234)\rremote: Counting objects: 100% (1234/1234), done.\n",
  "remote: Compressing objects:  45% (200/444)\rremote: Compressing objects: 100% (444/444), done.\n",
  "Receiving objects:   1% (13/1234), 12.00 KiB | 24.00 KiB/s\rReceiving objects:  45% (555/1234), 1.20 MiB | 2.40 MiB/s\rReceiving objects: 100% (1234/1234), 5.00 MiB | 3.10 MiB/s, done.\n",
  "remote: Total 1234 (delta 700), reused 1200 (delta 680), pack-reused 0 (from 0)\n",
  "Resolving deltas:  50% (350/700)\rResolving deltas: 100% (700/700), done.\n",
  "Updating files: 100% (20/20), done.\n",
].join("");

describe("parsearLinhaProgresso", () => {
  it("Receiving com bytes e velocidade", () => {
    expect(parsearLinhaProgresso("Receiving objects:  45% (555/1234), 1.20 MiB | 2.40 MiB/s")).toEqual({
      fase: "recebendo", percentual: 45, bytes: Math.round(1.2 * 1024 ** 2), velocidade_bps: Math.round(2.4 * 1024 ** 2), texto: "Receiving objects:  45% (555/1234), 1.20 MiB | 2.40 MiB/s",
    });
  });
  it("linha final com `, done.`", () => {
    const e = parsearLinhaProgresso("Receiving objects: 100% (1234/1234), 5.00 MiB | 3.10 MiB/s, done.");
    expect(e?.percentual).toBe(100);
    expect(e?.bytes).toBe(5 * 1024 ** 2);
  });
  it("Resolving deltas, Compressing e Counting (com prefixo remote:)", () => {
    expect(parsearLinhaProgresso("Resolving deltas:  50% (350/700)")).toMatchObject({ fase: "resolvendo", percentual: 50 });
    expect(parsearLinhaProgresso("remote: Compressing objects:  45% (200/444)")).toMatchObject({ fase: "comprimindo", percentual: 45 });
    expect(parsearLinhaProgresso("remote: Counting objects: 100% (1234/1234), done.")).toMatchObject({ fase: "contando", percentual: 100 });
  });
  it("Enumerating não tem percentual; Updating files vira extraindo", () => {
    expect(parsearLinhaProgresso("remote: Enumerating objects: 1234, done.")).toMatchObject({ fase: "contando", percentual: null });
    expect(parsearLinhaProgresso("Updating files:  50% (10/20)")).toMatchObject({ fase: "extraindo", percentual: 50 });
  });
  it("Cloning into e Submodule", () => {
    expect(parsearLinhaProgresso("Cloning into 'repo'...")?.fase).toBe("conectando");
    expect(parsearLinhaProgresso("Submodule 'lib' (https://x/y) registered for path 'lib'")?.fase).toBe("submodulos");
  });
  it("ignora o que não é progresso e nunca passa de 100", () => {
    expect(parsearLinhaProgresso("remote: Total 1234 (delta 700), reused 1200")).toBeNull();
    expect(parsearLinhaProgresso("fatal: repository not found")).toBeNull();
    expect(parsearLinhaProgresso("")).toBeNull();
    expect(parsearLinhaProgresso("Receiving objects: 999% (1/1)")?.percentual).toBe(100);
  });
  it("unidades B, KiB, GiB", () => {
    expect(parsearLinhaProgresso("Receiving objects:  1% (1/9), 512 bytes")?.bytes).toBe(512); // o git escreve "bytes" para valores pequenos
    expect(parsearLinhaProgresso("Receiving objects:  1% (1/9), 2.00 GiB | 10.00 MiB/s")?.bytes).toBe(2 * 1024 ** 3);
    expect(parsearLinhaProgresso("Receiving objects:  1% (1/9), 3 B | 1 KiB/s")).toMatchObject({ bytes: 3, velocidade_bps: 1024 });
  });
});

describe("ParserProgressoGit (pedaços arbitrários)", () => {
  it("o resultado não depende de como o stderr é fatiado", () => {
    const inteiro = new ParserProgressoGit();
    const tudo = [...inteiro.alimentar(SAIDA_GIT), ...inteiro.encerrar()];
    for (const tamanho of [1, 3, 7, 16, 64, 500]) {
      const p = new ParserProgressoGit();
      const partes: typeof tudo = [];
      for (let i = 0; i < SAIDA_GIT.length; i += tamanho) partes.push(...p.alimentar(SAIDA_GIT.slice(i, i + tamanho)));
      partes.push(...p.encerrar());
      expect(partes).toEqual(tudo);
    }
    const fases = tudo.map((e) => e.fase);
    expect(fases[0]).toBe("conectando");
    expect(fases).toContain("recebendo");
    expect(fases).toContain("resolvendo");
    expect(tudo.filter((e) => e.fase === "recebendo").map((e) => e.percentual)).toEqual([1, 45, 100]);
    expect(tudo.at(-1)).toMatchObject({ fase: "extraindo", percentual: 100 });
  });
  it("buffer sem fim por mais de 8 KiB é descartado (nunca cresce sem limite)", () => {
    const p = new ParserProgressoGit();
    expect(p.alimentar("x".repeat(20_000))).toEqual([]);
    expect(p.alimentar("\rReceiving objects:  10% (1/10)\n")).toHaveLength(1);
  });
});

describe("formatarBytes", () => {
  it.each([[null, ""], [0, "0 B"], [900, "900 B"], [1024, "1,0 KiB"], [1.5 * 1024 ** 2, "1,5 MiB"], [250 * 1024 ** 2, "250 MiB"], [3 * 1024 ** 3, "3,0 GiB"]])("%s -> %s", (n, t) => expect(formatarBytes(n)).toBe(t));
  it("velocidade", () => {
    expect(formatarVelocidade(2 * 1024 ** 2)).toBe("2,0 MiB/s");
    expect(formatarVelocidade(null)).toBe("");
  });
});
