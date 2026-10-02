import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canaisCandidatos, canalId, chaveEnvelope, epocaDe, EPOCA_MS, novoSegredoDeCanal } from "./canal";

describe("canal rotativo (T-22.09)", () => {
  it("vetor conhecido de HKDF-SHA256: segredo 0x01*32, época 20000", () => {
    // gerado uma vez com node:crypto e CONFERIDO no PWA (tests/pwa/cripto.test.ts) com WebCrypto; muda só se a derivação mudar
    expect(canalId(Buffer.alloc(32, 1), 20000)).toBe("3bc59c1360d9c9e8304599e676ab1b61");
  });
  it("ax07_canal_rotativo: épocas diferentes dão canais diferentes e sem relação visível; mesmo segredo e época repetem", () => {
    const s = novoSegredoDeCanal();
    expect(s).toHaveLength(32);
    const ids = Array.from({ length: 60 }, (_, i) => canalId(s, 20000 + i));
    expect(new Set(ids).size).toBe(60);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(canalId(s, 20000)).toBe(ids[0]);
    // outro dispositivo (outro segredo) na mesma época: canal diferente
    expect(canalId(novoSegredoDeCanal(), 20000)).not.toBe(ids[0]);
    // nenhum prefixo comum que permita ligar épocas (distribuição: bits do primeiro byte variam)
    expect(new Set(ids.map((x) => x.slice(0, 2))).size).toBeGreaterThan(30);
  });
  it("a época é diária e os candidatos cobrem ±1 época (relógios diferentes)", () => {
    const s = randomBytes(32);
    const t = Date.parse("2026-10-01T23:59:00Z");
    expect(epocaDe(t + 120_000)).toBe(epocaDe(t) + 1);
    expect(EPOCA_MS).toBe(86_400_000);
    const [atual, ant, prox] = canaisCandidatos(s, t);
    expect(atual).toBe(canalId(s, epocaDe(t)));
    expect(ant).toBe(canalId(s, epocaDe(t) - 1));
    expect(prox).toBe(canalId(s, epocaDe(t) + 1));
    // na virada, o celular com relógio adiantado acha o canal que o host acabou de registrar
    expect(canaisCandidatos(s, t + 120_000)[0]).toBe(prox);
    expect(canaisCandidatos(s, t + 120_000)[1]).toBe(atual);
  });
  it("chaves de invólucro são separadas por rótulo e por segredo", () => {
    const s = randomBytes(32);
    expect(chaveEnvelope(s, "sessao")).toHaveLength(32);
    expect(chaveEnvelope(s, "sessao").equals(chaveEnvelope(s, "pareamento"))).toBe(false);
    expect(chaveEnvelope(s, "sessao").equals(chaveEnvelope(randomBytes(32), "sessao"))).toBe(false);
  });
});
