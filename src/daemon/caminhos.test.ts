import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../nucleo/produto";
import { caminhosDoDaemon, lerOuCriarToken } from "./caminhos";
import { PROTOCOLO_DAEMON, separarLinhas } from "./protocolo";

describe("caminhosDoDaemon", () => {
  it("socket curto (cabe nos ~100 caracteres do Unix) com hash, prefixo do produto e uid", () => {
    const c = caminhosDoDaemon("/Users/alguem/Library/Application Support/um-nome-bem-longo-de-app/dados", "darwin", 501, "/tmp");
    expect(c.socket).toBe(join("/tmp", `${PRODUTO.prefixoSocket}-501`, `${c.socket.split("/").pop()}`));
    expect(c.socket.length).toBeLessThan(100);
    expect(c.socket).toMatch(/\.sock$/);
    expect(c.socket).toContain(PRODUTO.prefixoSocket);
  });

  it("no Windows é um named pipe com o prefixo do produto", () => {
    const c = caminhosDoDaemon("C:\\Users\\u\\AppData\\Roaming\\x", "win32", "u");
    expect(c.socket.startsWith(`\\\\.\\pipe\\${PRODUTO.prefixoSocket}-`)).toBe(true);
  });

  it("pastas de dados diferentes não colidem; a mesma é estável", () => {
    const a = caminhosDoDaemon("/dados/a", "linux", 1, "/tmp");
    const b = caminhosDoDaemon("/dados/b", "linux", 1, "/tmp");
    expect(a.socket).not.toBe(b.socket);
    expect(caminhosDoDaemon("/dados/a", "linux", 1, "/tmp")).toEqual(a);
  });

  it("outra versão do protocolo usa outro socket e outra pasta (daemon antigo não é reaproveitado)", () => {
    const atual = caminhosDoDaemon("/dados/a", "linux", 1, "/tmp");
    const futura = caminhosDoDaemon("/dados/a", "linux", 1, "/tmp", PROTOCOLO_DAEMON + 1);
    expect(futura.socket).not.toBe(atual.socket);
    expect(futura.dir).not.toBe(atual.dir);
    expect(atual.dir).toBe(join("/dados/a", `sessoes-pty-v${PROTOCOLO_DAEMON}`));
    expect(atual.arquivo_token).toBe(join(atual.dir, "token"));
  });
});

describe("lerOuCriarToken", () => {
  it("cria com 0600, reaproveita o existente e recria se vier curto demais", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "tok-")), "sub");
    const arquivo = join(dir, "token");
    const t1 = lerOuCriarToken(arquivo, dir);
    expect(t1.length).toBeGreaterThanOrEqual(32);
    if (process.platform !== "win32") {
      expect(statSync(arquivo).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
    expect(lerOuCriarToken(arquivo, dir)).toBe(t1);
  });
});

describe("separarLinhas (NDJSON)", () => {
  it("junta pedaços partidos e guarda o resto", () => {
    expect(separarLinhas("", '{"a":1}\n{"b"')).toEqual({ linhas: ['{"a":1}'], resto: '{"b"' });
    expect(separarLinhas('{"b"', ":2}\n\n")).toEqual({ linhas: ['{"b":2}'], resto: "" });
  });
});
