import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conferirIntegridade, conferirLock, ErroIntegridade, hashDeArquivo, integridadeSha512, sha256Hex, verificarAssinaturaNpm } from "./integridade";

const codigoDe = (f: () => void): string | null => { try { f(); return null; } catch (e) { return e instanceof ErroIntegridade ? e.codigo : "outro"; } };

describe("integridade de pacote", () => {
  const dados = Buffer.from("conteudo do tarball");
  it("sha512 npm e sha256 conferem; um byte alterado falha", () => {
    expect(integridadeSha512(dados)).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    expect(codigoDe(() => conferirIntegridade(dados, integridadeSha512(dados)))).toBeNull();
    expect(codigoDe(() => conferirIntegridade(dados, `sha256:${sha256Hex(dados)}`))).toBeNull();
    expect(codigoDe(() => conferirIntegridade(dados, sha256Hex(dados).toUpperCase()))).toBeNull();
    const adulterado = Buffer.from(dados); adulterado[0] = adulterado[0]! ^ 1;
    expect(codigoDe(() => conferirIntegridade(adulterado, integridadeSha512(dados)))).toBe("integridade_divergente");
    expect(codigoDe(() => conferirIntegridade(adulterado, sha256Hex(dados)))).toBe("integridade_divergente");
  });

  it("lock curado divergente é recusado", () => {
    expect(codigoDe(() => conferirLock("{}", sha256Hex("{}")))).toBeNull();
    expect(codigoDe(() => conferirLock("{ }", sha256Hex("{}")))).toBe("lock_divergente");
  });

  it("hash de arquivo em stream bate com o hash em memória", async () => {
    const d = mkdtempSync(join(tmpdir(), "integ-"));
    try {
      const f = join(d, "a.bin"); writeFileSync(f, dados);
      expect(await hashDeArquivo(f, "sha256")).toBe(sha256Hex(dados));
      expect(await hashDeArquivo(f, "sha512")).toBe(integridadeSha512(dados));
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("assinatura ECDSA do registro npm", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const chave = { keyid: "SHA256:teste", key: publicKey.export({ type: "spki", format: "der" }).toString("base64"), expires: null as string | null };
  const base = { pacote: "@falso/ok", versao: "1.0.0", integridade: integridadeSha512("x") };
  const sig = (msg: string): string => sign("sha256", Buffer.from(msg), privateKey).toString("base64");
  const boa = { keyid: chave.keyid, sig: sig(`${base.pacote}@${base.versao}:${base.integridade}`) };

  it("aceita assinatura válida", () => {
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, assinaturas: [boa], chaves: [chave] }))).toBeNull();
  });
  it("recusa: integridade trocada, versão trocada, assinatura ausente, chave desconhecida e chave expirada", () => {
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, integridade: integridadeSha512("outro"), assinaturas: [boa], chaves: [chave] }))).toBe("assinatura_invalida");
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, versao: "1.0.1", assinaturas: [boa], chaves: [chave] }))).toBe("assinatura_invalida");
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, assinaturas: [], chaves: [chave] }))).toBe("assinatura_ausente");
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, assinaturas: [boa], chaves: [] }))).toBe("chave_desconhecida");
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, assinaturas: [boa], chaves: [{ ...chave, expires: "2026-01-01T00:00:00.000Z" }], agora: new Date("2026-10-01") }))).toBe("chave_expirada");
    expect(codigoDe(() => verificarAssinaturaNpm({ ...base, assinaturas: [{ keyid: chave.keyid, sig: "AAAA" }], chaves: [chave] }))).toBe("assinatura_invalida");
  });
});
