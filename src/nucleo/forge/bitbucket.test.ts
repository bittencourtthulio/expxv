import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarForgeBitbucket } from "./bitbucket";
import type { Forge } from "./forge";
import { ForgeEntradaInvalidaErro, ForgeNaoSuportadoErro, ForgeRecusadoErro } from "./erros";
import { criarServidorFake, type ServidorFake } from "../../../tests/fixtures/forge/servidor-rest";

const R = "/repositories/acme/app";
let srv: ServidorFake;
let f: Forge;
const U = { origem: "usuario" } as const;
const pr = { id: 7, title: "Corrige", state: "OPEN", draft: false, author: { nickname: "ana" }, source: { branch: { name: "fix/x" } }, destination: { branch: { name: "main" } }, links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/7" } }, created_on: "2026-09-01", updated_on: "2026-09-02", participants: [{ role: "REVIEWER", state: "approved", user: { nickname: "bia" }, participated_on: "2026-09-02" }], description: "corpo" };
beforeEach(async () => {
  srv = await criarServidorFake({
    [`GET ${R}/pullrequests`]: { json: { values: [pr, { id: 8 }] } },
    [`GET ${R}/pullrequests/7`]: { json: pr },
    [`GET ${R}/pullrequests/7/diffstat`]: { json: { values: [{ new: { path: "a.ts" }, lines_added: 3, lines_removed: 1 }] } },
    [`GET ${R}/pullrequests/7/comments`]: { json: { values: [{ user: { nickname: "caio" }, content: { raw: "oi" }, inline: { path: "a.ts", to: 4 } }] } },
    [`GET ${R}/pullrequests/7/statuses`]: { json: { values: [{ name: "ci", state: "SUCCESSFUL", url: "u" }, { name: "lint", state: "FAILED" }] } },
    [`POST ${R}/pullrequests`]: { json: { ...pr, id: 9 } },
    [`POST ${R}/pullrequests/7/merge`]: { json: {} },
    [`POST ${R}/pullrequests/7/decline`]: { json: {} },
    [`POST ${R}/pullrequests/7/approve`]: { json: {} },
    [`POST ${R}/pullrequests/7/comments`]: { json: {} },
    [`PUT ${R}/pullrequests/7`]: { json: {} },
    [`GET ${R}/pipelines/`]: { json: { values: [{ uuid: "{aaaaaaaa-1}", build_number: 4, state: { name: "COMPLETED", result: { name: "FAILED" } }, target: { ref_name: "main" }, created_on: "x" }] } },
    [`GET ${R}/pipelines/%7Baaaaaaaa-1%7D/steps/%7Bbbbbbbbb-2%7D/log`]: { bytes: 3 * 1024 * 1024 },
    [`GET ${R}/issues`]: { json: { values: [{ id: 1, title: "Bug", state: "new", reporter: { nickname: "ana" } }, { id: 2, title: "Velha", state: "closed" }] } },
    [`GET ${R}/issues/1`]: { json: { id: 1, title: "Bug", state: "open", content: { raw: "detalhe" } } },
    [`GET ${R}/issues/1/comments`]: { json: { values: [] } },
    [`POST ${R}/issues`]: { json: { id: 3, title: "Nova", state: "new" } },
    [`POST ${R}/issues/1/comments`]: { json: {} },
  });
  f = criarForgeBitbucket({ repo: { host: "bitbucket.org", caminho: "acme/app" }, credencial: async () => ({ esquema: "Bearer", valor: "tok_XYZ123456" }), baseUrl: srv.url, permitirLoopback: true });
});
afterEach(() => srv.fechar());

describe("Bitbucket", () => {
  it("lista PRs com campos ausentes tolerados e filtra por estado/autor", async () => {
    const r = await f.prs.listar({ autor: "ana" });
    expect(r.itens.map((p) => p.numero)).toEqual([7]);
    expect(srv.pedidos[0]?.query).toContain("state=OPEN");
    const todos = await f.prs.listar();
    expect(todos.itens).toHaveLength(2);
    expect(todos.itens[1]?.titulo).toBe("");
  });
  it("ver junta arquivos, comentários em linha, reviews e checks", async () => {
    const d = await f.prs.ver(7);
    expect(d.arquivos).toEqual([{ caminho: "a.ts", adicoes: 3, remocoes: 1 }]);
    expect(d.comentarios[0]).toMatchObject({ autor: "caio", caminho: "a.ts", linha: 4 });
    expect(d.reviews[0]?.estado).toBe("aprovado");
    expect(d.checks).toMatchObject({ total: 2, sucesso: 1, falha: 1 });
    expect(d.revisao).toBe("aprovado");
  });
  it("criar manda rascunho/revisores por UUID e recusa revisor por nome", async () => {
    const r = await f.prs.criar({ titulo: "T", corpo: "c", head: "fix/x", base: "main", rascunho: true, revisores: ["{abcdef12-3456}"] }, U);
    expect(r.numero).toBe(9);
    const corpo = JSON.parse(srv.pedidos.at(-1)!.corpo);
    expect(corpo).toMatchObject({ draft: true, source: { branch: { name: "fix/x" } }, destination: { branch: { name: "main" } }, reviewers: [{ uuid: "{abcdef12-3456}" }] });
    await expect(f.prs.criar({ titulo: "T", head: "x", revisores: ["ana"] }, U)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.criar({ titulo: "T", head: "-x" }, U)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.criar({ titulo: "T", head: "x", labels: ["a"] }, U)).rejects.toBeInstanceOf(ForgeNaoSuportadoErro);
  });
  it("escrita exige origem; automação nunca mescla nem com aprovação", async () => {
    const antes = srv.pedidos.length;
    await expect(f.prs.mesclar(7, {}, { origem: "automacao", aprovacao: () => true })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    await expect(f.prs.fechar(7, { origem: "automacao" })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    await expect(f.prs.comentar(7, "x", {} as never)).rejects.toBeInstanceOf(ForgeRecusadoErro);
    expect(srv.pedidos.length).toBe(antes);
    await f.prs.comentar(7, "ok", { origem: "automacao", aprovacao: () => true });
    expect(srv.pedidos.length).toBe(antes + 1);
  });
  it("mesclar traduz o método; fechar, pronto, aprovar e comentário em linha", async () => {
    expect(await f.prs.mesclar(7, { metodo: "squash", apagarBranch: true }, U)).toEqual({ metodo: "squash" });
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo)).toEqual({ merge_strategy: "squash", close_source_branch: true });
    await f.prs.fechar(7, U);
    await f.prs.prontoParaRevisao(7, U);
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo)).toEqual({ draft: false });
    await f.prs.revisar(7, { acao: "aprovar" }, U);
    await f.prs.comentar(7, "linha", { ...U, local: { caminho: "a.ts", linha: 5 } });
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo)).toEqual({ content: { raw: "linha" }, inline: { path: "a.ts", to: 5 } });
    expect(srv.pedidos.map((p) => `${p.metodo} ${p.caminho}`)).toContain(`POST ${R}/pullrequests/7/decline`);
  });
  it("checks do PR, pipelines filtradas e log de 3 MB em streaming", async () => {
    expect((await f.checks.doPr(7)).map((c) => c.situacao)).toEqual(["sucesso", "falha"]);
    const ex = await f.checks.execucoes({ ramo: "main" });
    expect(ex[0]).toMatchObject({ id: "{aaaaaaaa-1}", situacao: "falha" });
    let n = 0;
    const r = await f.checks.log("{aaaaaaaa-1}/{bbbbbbbb-2}", { aoPedaco: (t) => (n += t.length) });
    expect(r).toEqual({ bytes: 3 * 1024 * 1024, truncado: false });
    expect(n).toBe(r.bytes);
    await expect(f.checks.log("../x/y", { aoPedaco: () => undefined })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
  });
  it("issues: listar (só abertas), ver, criar e comentar", async () => {
    expect((await f.issues.listar()).map((i) => i.numero)).toEqual([1]);
    expect((await f.issues.listar({ estado: "todas" })).length).toBe(2);
    expect((await f.issues.ver(1)).corpo).toBe("detalhe");
    expect((await f.issues.criar({ titulo: "Nova", corpo: "c" }, U)).numero).toBe(3);
    await f.issues.comentar(1, "oi", U);
  });
  it("capacidades coerentes: checkout/atualizar/reexecutar não suportados", async () => {
    const c = f.capacidades();
    expect([c.prs.checkout, c.prs.atualizarBranch, c.checks.reexecutarFalhos, c.prs.etag, c.limiteApi]).toEqual([false, false, false, false, false]);
    expect(() => f.prs.checkout(7, U)).toThrow(ForgeNaoSuportadoErro);
    expect(() => f.checks.reexecutarFalhos("1", U)).toThrow(ForgeNaoSuportadoErro);
    expect(await f.limiteApi()).toBeNull();
    expect((await f.prs.consultar(7)).pr?.numero).toBe(7);
  });
  it("detectar: autenticado sem expor a credencial; sem credencial degrada com instrução", async () => {
    const e = await f.detectar();
    expect(e).toMatchObject({ provedor: "bitbucket", autenticado: true, degradado: false, cli: { nome: "rest", instalada: true, versao: null } });
    expect(JSON.stringify(e)).not.toContain("tok_XYZ");
    const sem = await criarForgeBitbucket({ repo: { host: "bitbucket.org", caminho: "acme/app" }, credencial: async () => undefined, baseUrl: srv.url, permitirLoopback: true }).detectar();
    expect(sem).toMatchObject({ autenticado: false, degradado: true });
    expect(sem.instrucao).toContain("cofre");
  });
});
