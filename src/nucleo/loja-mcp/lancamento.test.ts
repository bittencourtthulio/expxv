import { describe, expect, it } from "vitest";
import type { EntradaMcp } from "./esquema";
import { montarLancamento } from "./lancamento";
import { catalogoFalso } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

const cat = catalogoFalso();
const entrada = (id: string): EntradaMcp => cat.porId.get(id)!.entrada as EntradaMcp;
const BASE = { userData: "/u", node: "/opt/node/bin/node", nodeEhElectron: true, plataforma: "darwin" as const };

describe("lançamento pelo lançador", () => {
  it("ambiente por allowlist: declaradas + básicas, nunca chave de provedor nem variável do produto do Pane", () => {
    const e = entrada("falso-chave");
    const origem = { PATH: "/x", LANG: "pt_BR", ANTHROPIC_API_KEY: "sk-ant-NUNCA", EXPXV_LOJA_TOKEN: "tok", HOME: "/home/u" };
    const c = montarLancamento(e, { secretos: { FALSO_API_KEY: "SEGREDO-1" }, publicos: {} }, { ...BASE, origem });
    expect(c.env["FALSO_API_KEY"]).toBe("SEGREDO-1");
    expect(c.env["LANG"]).toBe("pt_BR");
    expect(c.env["ELECTRON_RUN_AS_NODE"]).toBe("1");
    expect(Object.keys(c.env).some((k) => /ANTHROPIC|LOJA|HOME/.test(k))).toBe(false);
    expect(c.executavel).toBe("/opt/node/bin/node");
    expect(c.args[0]).toContain("/u/mcp/falso-chave/node_modules/.bin/");
    expect(c.cwd).toBe("/u/mcp/falso-chave");
  });

  it("servidor remoto não passa pelo lançador", () => {
    expect(() => montarLancamento(entrada("falso-remoto"), { secretos: {}, publicos: {} }, BASE)).toThrow();
  });
});
