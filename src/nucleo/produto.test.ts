import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUTO, variavelDeAmbiente } from "./produto";

describe("PRODUTO", () => {
  it("deriva todos os identificadores do mesmo id", () => {
    expect(PRODUTO.scheme).toBe(`${PRODUTO.id}-app`);
    expect(PRODUTO.protocoloUrl).toBe(PRODUTO.id);
    expect(PRODUTO.appId).toBe(`com.expx.${PRODUTO.id}`);
    expect(PRODUTO.pastaNoProjeto).toBe(`.${PRODUTO.id}`);
    expect(PRODUTO.prefixoSocket.startsWith(PRODUTO.id)).toBe(true);
    expect(PRODUTO.prefixoSubagentes.startsWith(PRODUTO.id)).toBe(true);
    expect(PRODUTO.prefixoPaineis.startsWith(PRODUTO.id)).toBe(true);
    expect(PRODUTO.prefixoEnv).toBe(`${PRODUTO.id.toUpperCase()}_`);
  });

  it("monta variáveis de ambiente com o prefixo do produto", () => {
    expect(variavelDeAmbiente("E2E")).toBe(`${PRODUTO.id.toUpperCase()}_E2E`);
  });

  it("mantém package.json e electron-builder alinhados ao produto", () => {
    const raiz = resolve(__dirname, "../..");
    const pkg = JSON.parse(readFileSync(resolve(raiz, "package.json"), "utf8")) as { name: string };
    expect(pkg.name).toBe(PRODUTO.id);
    const builder = readFileSync(resolve(raiz, "electron-builder.yml"), "utf8");
    expect(builder).toContain(`appId: ${PRODUTO.appId}`);
    expect(builder).toContain(`productName: ${PRODUTO.nome}`);
  });

  it("separa a identidade de dados do nome (D-341, AU-18)", () => {
    expect(PRODUTO.idDados).toMatch(/^[a-z][a-z0-9]{2,23}$/);
    expect(Array.isArray(PRODUTO.idsAnteriores)).toBe(true);
    for (const anterior of PRODUTO.idsAnteriores) {
      expect(anterior).toMatch(/^[a-z][a-z0-9]{2,23}$/);
      expect(anterior).not.toBe(PRODUTO.idDados);
    }
    expect(PRODUTO.canalPadrao).toBe("stable");
    expect(PRODUTO.nomeDeExibicao).toBe(PRODUTO.nome);
  });
});
