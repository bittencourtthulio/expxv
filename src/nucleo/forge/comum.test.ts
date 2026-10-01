import { describe, expect, it } from "vitest";
import { guardaEscrita, limitarLista, opcao, semSegredos, str, num, obj, arr, truncarTexto, validarCaminhoApi, validarHost, validarRamo, validarRepo, validarTexto } from "./comum";
import { ForgeEntradaInvalidaErro, ForgeRecusadoErro } from "./erros";

describe("redação de segredos", () => {
  it("remove tokens, cabeçalhos e credenciais de URL", () => {
    const t = semSegredos("ghp_ABCDEFGHIJKLMNOPQRSTUV12 glpat-abcdefghijklmnop12 github_pat_ABCDEFGHIJKLMNOP12 https://u:p@h.com/x Authorization: Bearer abcdef12345 PRIVATE-TOKEN: xyz123 password=hunter2");
    expect(t).not.toMatch(/ghp_|glpat-|github_pat_|u:p@|abcdef12345|xyz123|hunter2/);
  });
});
describe("validação de argumentos", () => {
  it("ramo: nunca começa com '-' nem tem metacaracteres", () => {
    expect(validarRamo("feat/ok-1")).toBe("feat/ok-1");
    for (const ruim of ["-x", "--upload-pack=y", "a..b", "a b", "a~1", "a^", "a:b", "a?b", "a[b", "x.lock", "/x", "x/", "a@{1}", "a\nb", ""]) expect(() => validarRamo(ruim), ruim).toThrow(ForgeEntradaInvalidaErro);
  });
  it("texto livre: sem NUL e com teto; opcao() cola nome=valor", () => {
    expect(() => validarTexto("a\u0000b", "t")).toThrow(ForgeEntradaInvalidaErro);
    expect(() => validarTexto("x".repeat(1001), "t")).toThrow(ForgeEntradaInvalidaErro);
    expect(() => validarTexto("  ", "t")).toThrow();
    expect(opcao("title", "-R outro")).toBe("--title=-R outro");
  });
  it("host e repo", () => {
    expect(validarHost("GHE.Acme.com:8443")).toBe("ghe.acme.com:8443");
    for (const r of ["-a/b", "a", "../x/y", "a/b/../c"]) expect(() => validarRepo({ host: "github.com", caminho: r }), r).toThrow(ForgeEntradaInvalidaErro);
    expect(validarRepo({ host: "gitlab.com", caminho: "g/s/p.git" }).caminho).toBe("g/s/p");
  });
  it("`gh api`/`glab api`: só caminhos da lista de prefixos", () => {
    for (const ok of ["rate_limit", "repos/acme/app", "repos/acme/app/pulls/7/comments", "repos/acme/app/actions/runs/1"]) expect(validarCaminhoApi(ok, "github")).toBe(ok);
    for (const ruim of ["/user", "user", "graphql", "repos/acme/app/../../x", "https://evil.com/x", "repos/a/b/hooks", "orgs/x/members", "repos/acme/app/pulls#x", "repos/acme/app?x=1&y=$(id)", "gists"]) expect(() => validarCaminhoApi(ruim, "github"), ruim).toThrow(ForgeEntradaInvalidaErro);
    expect(validarCaminhoApi("projects/acme%2Fapp/merge_requests/3/notes", "gitlab")).toContain("merge_requests");
    expect(() => validarCaminhoApi("admin/users", "gitlab")).toThrow();
    expect(() => validarCaminhoApi("projects/x/../../admin", "gitlab")).toThrow();
  });
});
describe("guarda de escrita", () => {
  it("usuário passa; automação só com aprovação; mesclar nunca por automação; origem inválida recusa", async () => {
    await expect(guardaEscrita({ origem: "usuario" }, "x")).resolves.toBeUndefined();
    await expect(guardaEscrita({ origem: "automacao", aprovacao: () => true }, "x")).resolves.toBeUndefined();
    await expect(guardaEscrita({ origem: "automacao" }, "x")).rejects.toBeInstanceOf(ForgeRecusadoErro);
    await expect(guardaEscrita({ origem: "automacao", aprovacao: () => true }, "mesclar", true)).rejects.toMatchObject({ motivo: "automacao-nao-mescla" });
    await expect(guardaEscrita({ origem: "usuario" }, "mesclar", true)).resolves.toBeUndefined();
    await expect(guardaEscrita({ origem: "ADMIN" as never }, "x")).rejects.toMatchObject({ motivo: "origem-invalida" });
    await expect(guardaEscrita(undefined, "x")).rejects.toBeInstanceOf(ForgeRecusadoErro);
  });
});
describe("JSON tolerante", () => {
  it("campos ausentes ou de tipo errado nunca lançam", () => {
    expect(str(undefined)).toBe("");
    expect(str(null, "x")).toBe("x");
    expect(num("12")).toBe(12);
    expect(num({})).toBe(0);
    expect(obj([])).toEqual({});
    expect(arr("x")).toEqual([]);
    expect(truncarTexto("abc", 10)).toEqual({ texto: "abc", truncado: false });
    expect(truncarTexto("abcdef", 3).truncado).toBe(true);
    expect(limitarLista([1, 2, 3], 2)).toEqual({ itens: [1, 2], truncado: true });
  });
});
