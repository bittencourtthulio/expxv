import { VERSAO_PROTOCOLO_RELAY } from "../../compartilhado/relay";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parChave } from "../../../tests/fixtures/relay/cenarios";
import { assinarProva, dadosProva, parseControle, serializar, verificarProva, type ParamsProva } from "./protocolo";

const helloOk = (): Record<string, unknown> => ({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: "host", canal: "a".repeat(32), ts: 1, nonce: randomBytes(16).toString("base64") });

describe("protocolo do relay: parser estrito (T-22.06)", () => {
  it("aceita mensagens bem formadas e recusa campo extra, tipo errado, versão errada e canal fora de 32 hex", () => {
    expect(parseControle(JSON.stringify(helloOk()))?.t).toBe("hello");
    for (const mut of [{ extra: 1 }, { v: `${VERSAO_PROTOCOLO_RELAY}x` }, { papel: "admin" }, { canal: "A".repeat(32) }, { canal: "a".repeat(31) }, { ts: "1" }, { nonce: "AAAA" }, { t: "xx" }]) {
      expect(parseControle(JSON.stringify({ ...helloOk(), ...mut })), JSON.stringify(mut)).toBeNull();
    }
    expect(parseControle(serializar({ t: "ping" }))?.t).toBe("ping");
    expect(parseControle('{"t":"ping","x":1}')).toBeNull();
    expect(parseControle('{"t":"erro","c":"porque_sim"}')).toBeNull();
  });
  it("limites: 1 KiB antes da autenticação, teto parametrizável depois", () => {
    const grande = JSON.stringify({ ...helloOk(), nonce: "A".repeat(2000) });
    expect(parseControle(grande)).toBeNull();
    expect(parseControle(JSON.stringify(helloOk()), 10)).toBeNull();
  });
  it("o parser nunca lança (entradas aleatórias, binárias, UTF-8 inválido, gigantes)", () => {
    for (let i = 0; i < 3000; i++) {
      const b = randomBytes(1 + (i % 400));
      expect(() => parseControle(b.toString("latin1"))).not.toThrow();
      expect(() => parseControle(b.toString("utf8"))).not.toThrow();
    }
    for (const x of [null, undefined, 1, {}, [], "", "{", "[]", "null", "\u0000", JSON.stringify([1]), '{"t":null}', '{"__proto__":{"t":"ok"}}']) expect(() => parseControle(x)).not.toThrow();
    expect(parseControle('{"__proto__":{"t":"ok"}}')).toBeNull();
  });
});

describe("prova de posse (AX-05)", () => {
  const p = (): ParamsProva => ({ desafio: randomBytes(16), nonceCliente: randomBytes(16), canal: "b".repeat(32), papel: "host" });
  it("assinatura correta passa; chave errada, assinatura truncada, papel trocado, canal trocado e desafio trocado falham", () => {
    const k = parChave();
    const outra = parChave();
    const base = p();
    const sig = assinarProva(k.priv, base);
    expect(verificarProva(k.pub, base, sig)).toBe(true);
    expect(verificarProva(outra.pub, base, sig)).toBe(false);
    expect(verificarProva(k.pub, base, sig.subarray(0, 63))).toBe(false);
    expect(verificarProva(k.pub, { ...base, papel: "cliente" }, sig)).toBe(false);
    expect(verificarProva(k.pub, { ...base, canal: "c".repeat(32) }, sig)).toBe(false);
    expect(verificarProva(k.pub, { ...base, desafio: randomBytes(16) }, sig)).toBe(false);
    expect(verificarProva(k.pub, { ...base, nonceCliente: randomBytes(16) }, sig)).toBe(false);
    expect(verificarProva(k.pub, { ...base, efemero: true }, sig)).toBe(false);
    expect(verificarProva(k.pub, { ...base, cli: outra.pub }, sig)).toBe(false);
    expect(verificarProva(Buffer.from("lixo"), base, sig)).toBe(false);
  });
  it("vetor conhecido: a transcrição assinada tem formato fixo (prefixo de comprimento) e determinístico", () => {
    const base: ParamsProva = { desafio: Buffer.alloc(16, 1), nonceCliente: Buffer.alloc(16, 2), canal: "0".repeat(32), papel: "cliente" };
    const a = dadosProva(base);
    expect(dadosProva(base).equals(a)).toBe(true);
    expect(a.subarray(0, 4).readUInt32BE(0)).toBe("relay-prova-v1".length);
    expect(a.subarray(4, 4 + 14).toString()).toBe("relay-prova-v1");
    expect(a.length).toBe(4 + 14 + 4 + 16 + 4 + 16 + 4 + 32 + 4 + 7 + 4 + 0 + 4 + 0);
  });
  it("não importa net/http/tls (puro)", () => {
    const fonte = readFileSync(`${__dirname}/protocolo.ts`, "utf8");
    expect([...fonte.matchAll(/from "([^"]+)"/g)].map((m) => m[1])).toEqual(["node:crypto", "../../compartilhado/relay"]);
  });
});
