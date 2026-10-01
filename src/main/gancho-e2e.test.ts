import { describe, expect, it } from "vitest";
import { variavelDeAmbiente } from "../nucleo/produto";
import { criarGanchoE2E, ligarGanchoNoRenderer, SCRIPT_GANCHO_RENDERER } from "./gancho-e2e";

const E2E = variavelDeAmbiente("E2E");
const EXE = variavelDeAmbiente("E2E_EXECUTAVEL");
const RAIZ = variavelDeAmbiente("E2E_RAIZ");
const CLIS = variavelDeAmbiente("E2E_CLIS");

describe("gancho de teste E2E", () => {
  it("sem a variável E2E o gancho não existe, mesmo com as auxiliares definidas", () => {
    expect(criarGanchoE2E({})).toBeNull();
    expect(criarGanchoE2E({ [EXE]: "/tmp/cli", [RAIZ]: "/tmp" })).toBeNull();
    expect(criarGanchoE2E({ [E2E]: "0", [EXE]: "/tmp/cli" })).toBeNull();
    expect(criarGanchoE2E({ [E2E]: "true", [EXE]: "/tmp/cli" })).toBeNull();
  });

  it("com E2E=1 expõe só o executável, a raiz e a pasta de CLIs falsas informados", () => {
    expect(criarGanchoE2E({ [E2E]: "1" })).toEqual({ executavel: null, raiz: null, pastaClis: null });
    expect(criarGanchoE2E({ [E2E]: "1", [EXE]: "/tmp/cli", [RAIZ]: "/tmp/ws" })).toEqual({ executavel: "/tmp/cli", raiz: "/tmp/ws", pastaClis: null });
    expect(criarGanchoE2E({ [E2E]: "1", [EXE]: "" })).toEqual({ executavel: null, raiz: null, pastaClis: null });
    expect(criarGanchoE2E({ [E2E]: "1", [CLIS]: "/tmp/clis" })?.pastaClis).toBe("/tmp/clis");
  });

  it("sem a variável E2E a pasta de CLIs falsas não existe (a CLI real nunca é trocada fora de teste)", () => {
    expect(criarGanchoE2E({ [CLIS]: "/tmp/clis" })).toBeNull();
    expect(criarGanchoE2E({ [E2E]: "0", [CLIS]: "/tmp/clis" })).toBeNull();
  });
});

describe("gancho do renderer", () => {
  const falso = (carregando: boolean) => {
    const ouvintes: Array<() => void> = [];
    const scripts: string[] = [];
    return {
      ouvintes, scripts,
      wc: { on: (_e: "dom-ready", cb: () => void) => ouvintes.push(cb), isLoading: () => carregando, executeJavaScript: (c: string) => { scripts.push(c); return Promise.resolve(); } },
    };
  };
  it("sem gancho nada é injetado nem assinado", () => {
    const f = falso(false);
    ligarGanchoNoRenderer(null, f.wc);
    expect(f.ouvintes).toHaveLength(0);
    expect(f.scripts).toHaveLength(0);
  });
  it("com gancho injeta em cada dom-ready e já, se a página carregou", () => {
    const f = falso(true);
    ligarGanchoNoRenderer({ executavel: null, raiz: null }, f.wc);
    expect(f.scripts).toHaveLength(0);
    f.ouvintes[0]?.();
    expect(f.scripts).toEqual([SCRIPT_GANCHO_RENDERER]);
    const g = falso(false);
    ligarGanchoNoRenderer({ executavel: null, raiz: null }, g.wc);
    expect(g.scripts).toHaveLength(1);
  });
});

describe("AUD-29: o app empacotado ignora o gancho de teste", () => {
  it("com a variável ligada, só vale fora do pacote", () => {
    const env = { [variavelDeAmbiente("E2E")]: "1" } as NodeJS.ProcessEnv;
    expect(criarGanchoE2E(env, false)).not.toBeNull();
    expect(criarGanchoE2E(env, true)).toBeNull();
  });
});

