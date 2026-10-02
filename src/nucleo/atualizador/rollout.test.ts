import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bucketDeRollout, dentroDoRollout, gerarIdInstalacao } from "./rollout";

const ids = Array.from({ length: 2000 }, (_, i) => gerarIdInstalacao((n) => createHash("sha256").update(`semente-${i}`).digest().subarray(0, n)));

describe("rollout determinístico (T-21.13, AU-16)", () => {
  it("o bucket é estável para o mesmo (idInstalacao, versão) e fica em 0..99", () => {
    const a = bucketDeRollout(ids[0]!, "1.1.0");
    expect(bucketDeRollout(ids[0]!, "1.1.0")).toBe(a);
    for (const id of ids.slice(0, 200)) {
      const b = bucketDeRollout(id, "1.1.0");
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
  it("staging 0 ninguém, 100 todos, 10/50 aproximadamente a fração (HMAC uniforme)", () => {
    const conta = (s: number) => ids.filter((id) => dentroDoRollout(id, "2.0.0", s)).length;
    expect(conta(0)).toBe(0);
    expect(conta(100)).toBe(ids.length);
    expect(conta(10)).toBeGreaterThan(ids.length * 0.06);
    expect(conta(10)).toBeLessThan(ids.length * 0.14);
    expect(conta(50)).toBeGreaterThan(ids.length * 0.44);
    expect(conta(50)).toBeLessThan(ids.length * 0.56);
  });
  it("o grupo muda por versão (os mesmos usuários não são sempre os primeiros)", () => {
    const g1 = new Set(ids.filter((id) => dentroDoRollout(id, "1.0.0", 10)));
    const g2 = ids.filter((id) => dentroDoRollout(id, "1.0.1", 10));
    const comum = g2.filter((id) => g1.has(id)).length;
    expect(comum).toBeLessThan(g2.length * 0.5);
  });
  it("crescer o staging só adiciona gente (monotônico)", () => {
    const g10 = ids.filter((id) => dentroDoRollout(id, "3.0.0", 10));
    for (const id of g10) expect(dentroDoRollout(id, "3.0.0", 50)).toBe(true);
  });
  it("id de instalação é UUID v4 e depende só da fonte de bytes injetada", () => {
    const id = gerarIdInstalacao((n) => new Uint8Array(n));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
