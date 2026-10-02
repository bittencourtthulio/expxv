// T-22.24: fuzz do manifesto do PWA (pwa/verificar.js): lerManifesto, assinaturaValida e verificarManifesto nunca lançam; só passa o que está estruturalmente certo.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { carregar, type Verificar } from "../pwa/carregar";
import { ENTRADAS, criarRnd, jsonHostil, medir, mutar } from "./gerador";

describe("fuzz: manifesto do PWA", async () => {
  const v = await carregar<Verificar & { MANIFESTO_MAX: number }>("pwa/verificar.js");
  const base = Buffer.from(JSON.stringify({ versao: 3, arquivos: { "index.html": { sha256: "a".repeat(64), tamanho: 10 }, "app.js": { sha256: "b".repeat(64), tamanho: 99 } } }));
  it(`${ENTRADAS} manifestos mutados: lerManifesto nunca lança e o resultado respeita os limites`, async () => {
    const r = criarRnd(5);
    let bons = 0;
    const m = await medir(200, ENTRADAS / 200, () => {
      const k = r.int(10);
      const b = k < 7 ? mutar(base, r) : k < 9 ? Buffer.from(jsonHostil(r)) : r.bytes(r.int(3000));
      const x = v.lerManifesto(new Uint8Array(b));
      if (x !== null) {
        bons++;
        expect(Object.keys(x.arquivos)).toContain("index.html");
        expect(Number.isSafeInteger(x.versao) && x.versao >= 1).toBe(true);
        for (const n of Object.keys(x.arquivos)) expect(n).not.toMatch(/(^|\/)\.\.?(\/|$)|^\//);
      }
    });
    expect(bons).toBeGreaterThan(100);
    expect(m.maiorLoteMs).toBeLessThan(2000);
    expect(m.maiorAtrasoMs).toBeLessThan(50);
    expect(v.lerManifesto(new Uint8Array(v.MANIFESTO_MAX + 1))).toBeNull();
    expect(v.lerManifesto(null as never)).toBeNull();
  });
  it("assinatura: mutação do manifesto, da assinatura ou da chave nunca valida; 2 000 verificações assíncronas sem exceção", async () => {
    const r = criarRnd(6);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    const sig = sign(null, base, privateKey).toString("base64");
    expect(await v.assinaturaValida(new Uint8Array(base), sig, [pub])).toBe(true);
    expect((await v.verificarManifesto({ manifestoBytes: new Uint8Array(base), assinaturaB64: sig, chaves: [pub], versaoInstalada: 3 })).ok).toBe(false); // sem rollback
    for (let i = 0; i < 2000; i++) {
      const k = r.int(4);
      const b = k === 0 ? mutar(base, r) : base;
      const s = k === 1 ? mutar(Buffer.from(sig), r).toString("latin1") : k === 2 ? r.bytes(r.int(100)).toString("base64") : sig;
      const c = k === 3 ? [mutar(Buffer.from(pub), r).toString("latin1"), ""] : [pub];
      const ok = await v.assinaturaValida(new Uint8Array(b), s, c);
      // base64 não canônico (bits finais de preenchimento) decodifica para os MESMOS bytes: vale comparar bytes, não texto
      if (ok) expect(b.equals(base) && Buffer.from(s, "base64").equals(Buffer.from(sig, "base64")) && Buffer.from(c[0] as string, "base64").equals(Buffer.from(pub, "base64"))).toBe(true);
    }
    for (const s of [undefined, null, 1, {}, "=".repeat(1000)]) expect(await v.assinaturaValida(new Uint8Array(base), s as never, [pub])).toBe(false);
  }, 30_000);
});
