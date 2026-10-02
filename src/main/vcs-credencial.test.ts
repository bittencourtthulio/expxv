import { describe, expect, it } from "vitest";
import type { Cofre } from "../nucleo/cofre";
import { nomeCredencialForge } from "../nucleo/forge/credencial";
import { credencialDoCofre } from "./vcs-credencial";

function cofreFalso(itens: Record<string, string>, bloqueado = false): Cofre {
  return {
    existe: async (n: string) => n in itens,
    obter: async (n: string) => {
      if (bloqueado) throw Object.assign(new Error(`cofre bloqueado (${n})`), { name: "CofreErro" });
      return itens[n] as string;
    },
  } as unknown as Cofre;
}

describe("credencial de forge pelo cofre (Bitbucket/Azure)", () => {
  it("nome derivado do host em UPPER_SNAKE", () => {
    expect(nomeCredencialForge("bitbucket.org")).toBe("FORGE_BITBUCKET_ORG");
    expect(nomeCredencialForge("dev.azure.com")).toBe("FORGE_DEV_AZURE_COM");
    expect(nomeCredencialForge("git.minha-empresa.com.br:8443")).toBe("FORGE_GIT_MINHA_EMPRESA_COM_BR_8443");
  });
  it("sem entrada: undefined (o forge responde 'sem autenticação'); com ':' vira Basic, sem vira Bearer", async () => {
    expect(await credencialDoCofre(async () => cofreFalso({}))("bitbucket.org")).toBeUndefined();
    expect(await credencialDoCofre(async () => cofreFalso({ FORGE_DEV_AZURE_COM: ":pat123456" }))("dev.azure.com")).toEqual({ esquema: "Basic", valor: ":pat123456" });
    expect(await credencialDoCofre(async () => cofreFalso({ FORGE_BITBUCKET_ORG: "tok-abcdef" }))("bitbucket.org")).toEqual({ esquema: "Bearer", valor: "tok-abcdef" });
  });
  it("cofre bloqueado ou com falha: undefined, sem propagar mensagem", async () => {
    expect(await credencialDoCofre(async () => cofreFalso({ FORGE_BITBUCKET_ORG: "x" }, true))("bitbucket.org")).toBeUndefined();
    expect(await credencialDoCofre(async () => { throw new Error("segredo-vazado"); })("bitbucket.org")).toBeUndefined();
  });
  it("host inválido não consulta o cofre", async () => {
    let consultas = 0;
    const f = credencialDoCofre(async () => { consultas++; return cofreFalso({}); });
    expect(await f("")).toBeUndefined();
    expect(consultas).toBe(0);
  });
});
