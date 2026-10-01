import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarForgeAzure } from "./azure";
import type { Forge } from "./forge";
import { ForgeEntradaInvalidaErro, ForgeNaoSuportadoErro, ForgePermissaoErro, ForgeRecusadoErro } from "./erros";
import { criarServidorFake, type ServidorFake } from "../../../tests/fixtures/forge/servidor-rest";

const G = "/acme/proj/_apis/git/repositories/app";
const EU = "11111111-2222-3333-4444-555555555555";
let srv: ServidorFake;
let f: Forge;
const U = { origem: "usuario" } as const;
const pr = { pullRequestId: 5, title: "Corrige", status: "active", isDraft: false, createdBy: { uniqueName: "ana@x" }, sourceRefName: "refs/heads/fix/x", targetRefName: "refs/heads/main", creationDate: "2026-09-01", labels: [{ name: "bug" }], reviewers: [{ displayName: "Bia", vote: 10 }], description: "corpo", mergeStatus: "succeeded", lastMergeSourceCommit: { commitId: "abc123" } };
beforeEach(async () => {
  srv = await criarServidorFake({
    [`GET ${G}/pullrequests`]: { json: { value: [pr, { pullRequestId: 6 }] } },
    [`GET ${G}/pullrequests/5`]: { json: pr },
    [`GET ${G}/pullrequests/5/threads`]: { json: { value: [{ threadContext: { filePath: "/a.ts", rightFileStart: { line: 3 } }, comments: [{ author: { displayName: "Caio" }, content: "olha", commentType: "text" }, { content: "sys", commentType: "system" }] }] } },
    [`GET ${G}/pullrequests/5/iterations`]: { json: { value: [{ id: 1 }, { id: 2 }] } },
    [`GET ${G}/pullrequests/5/iterations/2/changes`]: { json: { changeEntries: [{ item: { path: "/a.ts" } }] } },
    "GET /acme/proj/_apis/build/builds": { json: { value: [{ id: 77, buildNumber: "1.0", status: "completed", result: "failed", definition: { name: "CI" }, sourceBranch: "refs/heads/main", reason: "pullRequest", queueTime: "q" }] } },
    "GET /acme/_apis/connectionData": { json: { authenticatedUser: { id: EU } } },
    [`POST ${G}/pullrequests`]: { json: { ...pr, pullRequestId: 8 } },
    [`POST ${G}/pullrequests/8/labels`]: { json: {} },
    [`PATCH ${G}/pullrequests/5`]: { json: {} },
    [`POST ${G}/pullrequests/5/threads`]: { json: {} },
    [`PUT ${G}/pullrequests/5/reviewers/${EU}`]: { json: {} },
    "GET /acme/proj/_apis/build/builds/77/logs/3": { bytes: 2 * 1024 * 1024 },
  });
  f = criarForgeAzure({ repo: { host: "dev.azure.com", caminho: "acme/proj/app" }, credencial: async () => ({ esquema: "Basic", valor: ":PATSECRETO99" }), baseUrl: srv.url, permitirLoopback: true });
});
afterEach(() => srv.fechar());

describe("Azure DevOps", () => {
  it("lista PRs mapeando estado, ramos, labels e voto; campos ausentes não lançam", async () => {
    const r = await f.prs.listar({ label: "bug" });
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ numero: 5, ramoOrigem: "fix/x", ramoDestino: "main", revisao: "aprovado", autor: "ana@x" });
    expect(srv.pedidos[0]?.query).toContain("api-version=7.1");
    expect((await f.prs.listar()).itens[1]?.titulo).toBe("");
  });
  it("ver traz threads (sem sistema), arquivos da última iteração e builds", async () => {
    const d = await f.prs.ver(5);
    expect(d.comentarios).toHaveLength(1);
    expect(d.comentarios[0]).toMatchObject({ autor: "Caio", caminho: "/a.ts", linha: 3 });
    expect(d.arquivos[0]?.caminho).toBe("/a.ts");
    expect(d.checksDetalhe[0]?.situacao).toBe("falha");
    expect(d.mesclavel).toBe("sim");
    expect(srv.pedidos.some((p) => p.caminho.endsWith("/builds") && p.query.includes("branchName=refs%2Fpull%2F5%2Fmerge"))).toBe(true);
  });
  it("criar com rascunho, labels e revisor por GUID (recusa nome)", async () => {
    const r = await f.prs.criar({ titulo: "T", head: "fix/x", base: "main", rascunho: true, labels: ["bug"], revisores: [EU] }, U);
    expect(r.numero).toBe(8);
    const corpo = JSON.parse(srv.pedidos.find((p) => p.metodo === "POST" && p.caminho.endsWith("/pullrequests"))!.corpo);
    expect(corpo).toMatchObject({ sourceRefName: "refs/heads/fix/x", targetRefName: "refs/heads/main", isDraft: true, reviewers: [{ id: EU }] });
    expect(srv.pedidos.some((p) => p.caminho.endsWith("/8/labels"))).toBe(true);
    await expect(f.prs.criar({ titulo: "T", head: "x", base: "main", revisores: ["ana"] }, U)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.criar({ titulo: "T", head: "x" }, U)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
  });
  it("mesclar usa o commit do PR e a estratégia; automação nunca mescla", async () => {
    await expect(f.prs.mesclar(5, {}, { origem: "automacao", aprovacao: () => true })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    expect(await f.prs.mesclar(5, { metodo: "rebase", apagarBranch: true }, U)).toEqual({ metodo: "rebase" });
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo)).toEqual({ status: "completed", lastMergeSourceCommit: { commitId: "abc123" }, completionOptions: { mergeStrategy: "rebase", deleteSourceBranch: true } });
  });
  it("fechar, pronto e comentário em linha com threadContext", async () => {
    await f.prs.fechar(5, U);
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo)).toEqual({ status: "abandoned" });
    await f.prs.prontoParaRevisao(5, U);
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo)).toEqual({ isDraft: false });
    await f.prs.comentar(5, "ali", { ...U, local: { caminho: "a.ts", linha: 9 } });
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo).threadContext).toEqual({ filePath: "/a.ts", rightFileStart: { line: 9, offset: 1 }, rightFileEnd: { line: 9, offset: 1 } });
  });
  it("revisar vota com a identidade de connectionData", async () => {
    await f.prs.revisar(5, { acao: "aprovar" }, U);
    const v = srv.pedidos.at(-1)!;
    expect(v.caminho).toBe(`${G}/pullrequests/5/reviewers/${EU}`);
    expect(JSON.parse(v.corpo)).toEqual({ id: EU, vote: 10 });
    await f.prs.revisar(5, { acao: "pedir-mudancas", corpo: "ajuste" }, U);
    expect(JSON.parse(srv.pedidos.at(-1)!.corpo).vote).toBe(-5);
  });
  it("checks, execuções e log de 2 MB em streaming; id inválido recusado", async () => {
    expect((await f.checks.doPr(5))[0]?.nome).toBe("CI");
    expect((await f.checks.execucoes({ ramo: "main" }))[0]).toMatchObject({ id: "77", ramo: "main", situacao: "falha" });
    const r = await f.checks.log("77/3", { aoPedaco: () => undefined });
    expect(r).toEqual({ bytes: 2 * 1024 * 1024, truncado: false });
    await expect(f.checks.log("77/../3", { aoPedaco: () => undefined })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
  });
  it("issues e outros recursos não suportados têm capacidade false", () => {
    const c = f.capacidades();
    expect([c.issues.listar, c.prs.checkout, c.prs.atualizarBranch, c.checks.reexecutarFalhos]).toEqual([false, false, false, false]);
    expect(() => f.issues.listar()).toThrow(ForgeNaoSuportadoErro);
    expect(() => f.prs.checkout(5, U)).toThrow(ForgeNaoSuportadoErro);
  });
  it("403 do servidor explica permissão e a credencial não vaza; detectar sem credencial degrada", async () => {
    srv.rota(`PATCH ${G}/pullrequests/5`, { status: 403, texto: "TF401027 PATSECRETO99 forbidden" });
    const e = await f.prs.fechar(5, U).catch((x: Error) => x);
    expect(e).toBeInstanceOf(ForgePermissaoErro);
    expect(JSON.stringify({ m: (e as Error).message, d: (e as { detalhe?: string }).detalhe })).not.toContain("PATSECRETO99");
    const sem = await criarForgeAzure({ repo: { host: "dev.azure.com", caminho: "acme/proj/app" }, credencial: async () => undefined, baseUrl: srv.url, permitirLoopback: true }).detectar();
    expect(sem).toMatchObject({ autenticado: false, degradado: true });
    expect(sem.instrucao).toContain("Personal Access Token");
  });
});
