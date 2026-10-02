// build/distribuicao.json e scripts/lib/distribuicao.mjs (T-21.02): manifesto de build SEM segredo; `habilitada` nasce false (D-342).
import { readFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAVES_PUBLICAS_DE_TESTE, chavePublicaBem, lerDistribuicao, validarDistribuicao } from "../../scripts/lib/distribuicao.mjs";

const RAIZ = resolve(__dirname, "..", "..");
const real = (): Record<string, any> => JSON.parse(readFileSync(join(RAIZ, "build", "distribuicao.json"), "utf8"));
const com = (alt: (o: Record<string, any>) => void): Record<string, any> => {
  const o = real();
  alt(o);
  return o;
};

describe("build/distribuicao.json", () => {
  it("o arquivo versionado é válido e a atualização nasce DESLIGADA, sem chave nem host real", () => {
    const o = lerDistribuicao(RAIZ);
    expect(o.atualizacao.habilitada).toBe(false);
    expect(o.atualizacao.canal_padrao).toBe("stable");
    expect(o.atualizacao.chaves_aceitas).toEqual([]);
    expect(o.atualizacao.feed.host).toMatch(/\.invalid$/);
    expect(o.assinatura.exigir).toBe(false);
    expect(o.banco.adaptador).toBe("node:sqlite");
  });

  it("recusa: canal desconhecido, `habilitada` não booleano, chave malformada, URL com credencial, campo extra", () => {
    const ruins: Array<[string, Record<string, any>]> = [
      ["canal", com((o) => (o.atualizacao.canal_padrao = "alpha"))],
      ["canais", com((o) => (o.atualizacao.canais = ["stable", "nightly"]))],
      ["habilitada", com((o) => (o.atualizacao.habilitada = "false"))],
      ["chave curta", com((o) => (o.atualizacao.chaves_aceitas = ["abc"]))],
      ["3 chaves", com((o) => (o.atualizacao.chaves_aceitas = [CHAVES_PUBLICAS_DE_TESTE[0], CHAVES_PUBLICAS_DE_TESTE[1], "a".repeat(43) + "="]))],
      ["credencial", com((o) => (o.atualizacao.feed.caminho_base = "https://u:p@x.test/"))],
      ["host com esquema", com((o) => (o.atualizacao.feed.host = "https://x.test"))],
      ["host com porta", com((o) => (o.atualizacao.feed.host = "x.test:8080"))],
      ["caminho com ..", com((o) => (o.atualizacao.feed.caminho_base = "/a/../b"))],
      ["campo extra", com((o) => (o.atualizacao.token = "x"))],
      ["raiz extra", com((o) => (o.extra = 1))],
      ["rollout", com((o) => (o.atualizacao.rollout.staging_padrao = 101))],
      ["banco", com((o) => (o.banco.adaptador = "mongo"))],
      ["esquema", com((o) => (o.versao_esquema = 2))],
    ];
    for (const [nome, o] of ruins) expect(validarDistribuicao(o).ok, nome).toBe(false);
    expect(validarDistribuicao(null).ok).toBe(false);
    expect(validarDistribuicao([]).ok).toBe(false);
  });

  it("URL com credencial é recusada mesmo em campo permitido (AU-23)", () => {
    const o = com((x) => (x.atualizacao.feed.caminho_base = "/ok"));
    (o as any).banco.adaptador = "node:sqlite";
    expect(validarDistribuicao(o).ok).toBe(true);
    const r = validarDistribuicao(com((x) => (x.atualizacao.feed.host = "u:p@x.test")));
    expect(r.ok).toBe(false);
  });

  it("chave pública: base64 de exatamente 32 bytes", () => {
    expect(chavePublicaBem(CHAVES_PUBLICAS_DE_TESTE[0] as string)).toBe(true);
    expect(chavePublicaBem("")).toBe(false);
    expect(chavePublicaBem(Buffer.alloc(31).toString("base64"))).toBe(false);
  });

  it("o perfil release recusa chave de teste e exige chave e host reais para ligar a atualização (P-331/P-334)", () => {
    const comTeste = com((o) => (o.atualizacao.chaves_aceitas = [CHAVES_PUBLICAS_DE_TESTE[0]]));
    expect(validarDistribuicao(comTeste, { perfil: "local" }).ok).toBe(true);
    expect(validarDistribuicao(comTeste, { perfil: "release" }).erros.join()).toMatch(/chave pública de teste/);
    const ligadaSemChave = com((o) => (o.atualizacao.habilitada = true));
    expect(validarDistribuicao(ligadaSemChave, { perfil: "release" }).ok).toBe(false);
    const real1 = "A".repeat(43) + "=";
    const ligadaHostFalso = com((o) => ((o.atualizacao.habilitada = true), (o.atualizacao.chaves_aceitas = [real1])));
    expect(validarDistribuicao(ligadaHostFalso, { perfil: "release" }).erros.join()).toMatch(/host de feed real/);
    const ok = com((o) => ((o.atualizacao.habilitada = true), (o.atualizacao.chaves_aceitas = [real1]), (o.atualizacao.feed.host = "releases.exemplo.com")));
    expect(validarDistribuicao(ok, { perfil: "release" }).ok).toBe(true);
  });

  it("as chaves públicas de teste correspondem às sementes fixas das fixtures (nunca são chaves reais)", () => {
    const pre = Buffer.from("302e020100300506032b657004220420", "hex");
    const derivadas = ["expx-chave-de-teste-atual-0001", "expx-chave-de-teste-proxima-001"].map((s) => {
      const k = createPrivateKey({ key: Buffer.concat([pre, createHash("sha256").update(s).digest()]), format: "der", type: "pkcs8" });
      return createPublicKey(k).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
    });
    expect([...CHAVES_PUBLICAS_DE_TESTE]).toEqual(derivadas);
  });

  it("arquivo versionado não contém segredo nem credencial", () => {
    const texto = readFileSync(join(RAIZ, "build", "distribuicao.json"), "utf8");
    expect(texto).not.toMatch(/(-----BEGIN|ghp_|github_pat_|@[a-z0-9.-]+\/|password|secret)/i);
  });
});
