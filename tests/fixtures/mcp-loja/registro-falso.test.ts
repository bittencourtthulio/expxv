import { afterEach, describe, expect, it } from "vitest";
import { iniciarRegistroFalso, type RegistroFalso } from "./registro-falso";

let reg: RegistroFalso | null = null;
afterEach(async () => { await reg?.fechar(); reg = null; });

describe("registro npm/PyPI falso", () => {
  it("serve metadados npm (inclusive com escopo) e PyPI só em 127.0.0.1", async () => {
    reg = await iniciarRegistroFalso([{ pacote: "@a/b", versao: "1.0.0", integridade: "x" }], [{ pacote: "py", versao: "2.0", sha256: "ab" }]);
    expect(reg.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const npm = await (await fetch(`${reg.url}/@a%2Fb/1.0.0`)).json() as { dist: { integrity: string } };
    expect(npm.dist.integrity).toBe("x");
    const py = await (await fetch(`${reg.url}/pypi/py/2.0/json`)).json() as { urls: Array<{ digests: { sha256: string } }> };
    expect(py.urls[0]!.digests.sha256).toBe("ab");
    expect(reg.requisicoes.map((r) => r.metodo)).toEqual(["GET", "GET"]);
  });

  it("404 para o que não existe e 405 para qualquer método que não seja GET (somente leitura)", async () => {
    reg = await iniciarRegistroFalso();
    expect((await fetch(`${reg.url}/nada/1.0.0`)).status).toBe(404);
    expect((await fetch(`${reg.url}/pypi/nada/1/json`)).status).toBe(404);
    expect((await fetch(`${reg.url}/x/1.0.0`, { method: "PUT", body: "{}" })).status).toBe(405);
    expect(reg.requisicoes.at(-1)).toEqual({ metodo: "PUT", caminho: "/x/1.0.0" });
  });
});
