import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Fronteiras da Fase 9: `fetch`/`http(s)` só em `nucleo/rede`; `nucleo/**` do cofre/decisor/intenção não importa Electron nem abre conexão.
const RAIZ = resolve(__dirname, "../..");
const fontes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? fontes(c) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [c] : [];
  });

describe("fronteiras de rede e Electron", () => {
  const meus = [...fontes(join(RAIZ, "nucleo/cofre")), ...fontes(join(RAIZ, "nucleo/harness/decisor")), join(RAIZ, "nucleo/harness/intencao.ts")];
  it("cofre, decisor e intenção não usam fetch, http(s), net nem Electron", () => {
    expect(meus.length).toBeGreaterThan(8);
    for (const f of meus) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/\bfetch\s*\(|from "node:https?"|from "node:net"|from "node:tls"|from "electron"|require\("electron"\)/);
    }
  });
  it("a camada de rede não usa fetch (usa http/https) nem Electron", () => {
    for (const f of fontes(join(RAIZ, "nucleo/rede"))) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/\bfetch\s*\(|from "electron"/);
    }
  });
});
