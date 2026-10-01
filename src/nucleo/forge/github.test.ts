import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarForgeGithub, separarCabecalhos } from "./github";
import { ForgeAutenticacaoErro, ForgeBranchProtegidaErro, ForgeCliAusenteErro, ForgeEntradaInvalidaErro, ForgeMetodoMergeErro, ForgePermissaoErro, ForgeRateLimitErro, ForgeRecusadoErro } from "./erros";
import type { Forge, OpcoesEscrita } from "./forge";
import { criarFake, fixtureJson, type Fake, type RegraFake } from "../../../tests/fixtures/forge/ajudante";

const REPO = { host: "github.com", caminho: "acme/app" };
const USUARIO: OpcoesEscrita = { origem: "usuario" };
let fake: Fake | undefined;
afterEach(() => {
  fake?.limpar();
  fake = undefined;
});
function montar(regras: RegraFake[]): { f: Forge; fake: Fake } {
  fake = criarFake(regras);
  return { f: criarForgeGithub({ repo: REPO, cwd: fake.cwd, executavel: fake.gh, executor: fake.executor, env: fake.env }), fake };
}
const argvs = (fk: Fake): string[][] => fk.chamadas().map((c) => c.argv);

describe("PRs: listar e ver (T-06.18)", () => {
  it("lista com filtros; campo ausente nunca lança", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "list"], saida: fixtureJson("gh/pr-list.json") }]);
    const r = await f.prs.listar({ autor: "ana", label: "bug", base: "main", busca: "login", rascunho: false });
    expect(r.itens).toHaveLength(3);
    expect(r.itens[0]).toMatchObject({ numero: 12, estado: "aberto", autor: "ana", ramoOrigem: "fix/login", revisao: "aprovado", labels: ["bug"], checks: { total: 3, sucesso: 1, falha: 1, pendente: 1 } });
    expect(r.itens[1]).toMatchObject({ rascunho: true, checks: null, revisao: "nenhuma" });
    expect(r.itens[2]).toMatchObject({ numero: 14, titulo: "Sem campos", autor: "desconhecido" });
    const a = argvs(fk)[0]!;
    expect(a).toEqual(expect.arrayContaining(["--repo=github.com/acme/app", "--state=open", "--author=ana", "--label=bug", "--base=main", "--search=login"]));
  });
  it("ver devolve corpo, arquivos, comentários, reviews e checks", async () => {
    const { f } = montar([{ quando: ["pr", "view"], saida: fixtureJson("gh/pr-view.json") }]);
    const pr = await f.prs.ver(12);
    expect(pr).toMatchObject({ numero: 12, revisao: "mudancas", mesclavel: "sim", truncado: false });
    expect(pr.corpo).toContain("Fecha #7");
    expect(pr.arquivos).toEqual([{ caminho: "src/a.ts", adicoes: 10, remocoes: 2 }, { caminho: "src/b.ts", adicoes: 1, remocoes: 0 }]);
    expect(pr.comentarios[0]).toMatchObject({ autor: "caio", corpo: "Olha isso" });
    expect(pr.reviews.map((r) => r.estado)).toEqual(["mudancas", "aprovado"]);
    expect(pr.checksDetalhe[0]).toMatchObject({ nome: "ci", situacao: "sucesso" });
  });
  it("corpo enorme é truncado com marcação; JSON corrompido não lança", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "view"], saida: { number: 1, body: "x".repeat(200_000) } }]);
    const pr = await f.prs.ver(1);
    expect(pr.truncado).toBe(true);
    expect(pr.corpo).toContain("[… texto truncado]");
    expect(pr.corpo.length).toBeLessThan(70_000);
    fk.definir([{ quando: ["pr", "list"], saida: "isto não é json" }]);
    expect((await f.prs.listar()).itens).toEqual([]);
  });
  it("consultar usa ETag condicional e entende 304 e cabeçalhos de rate limit", async () => {
    const corpo = JSON.stringify({ number: 12, title: "T", state: "closed", merged: true, user: { login: "ana" }, head: { ref: "a" }, base: { ref: "main" }, html_url: "u", labels: [{ name: "x" }] });
    const { f, fake: fk } = montar([{ regex: "If-None-Match", saida: "HTTP/2.0 304 Not Modified\r\nEtag: \"abc\"\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4990\r\nX-Ratelimit-Reset: 1900000000\r\n\r\n", codigo: 1, stderr: "gh: HTTP 304\n" }, { quando: ["api", "-i"], saida: `HTTP/2.0 200 OK\r\nEtag: W/"novo1"\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4989\r\nX-Ratelimit-Reset: 1900000000\r\n\r\n${corpo}` }]);
    const a = await f.prs.consultar(12);
    expect(a).toMatchObject({ naoModificado: false, etag: 'W/"novo1"', pr: { numero: 12, estado: "mesclado", labels: ["x"] }, limite: { restante: 4989 } });
    const b = await f.prs.consultar(12, 'W/"novo1"');
    expect(b).toMatchObject({ naoModificado: true, etag: 'W/"novo1"', limite: { restante: 4990 } });
    expect(argvs(fk)[1]).toContain('--header=If-None-Match: W/"novo1"');
    await expect(f.prs.consultar(12, "x\nInjetado: 1")).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    expect(separarCabecalhos("sem cabecalho").status).toBe(0);
  });
});

describe("PRs: escrita (T-06.18)", () => {
  it("criar: corpo do PR.md por stdin, rascunho/revisores/labels; título nunca vira opção", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "create"], saida: "https://github.com/acme/app/pull/12\n" }, { quando: ["pr", "view"], saida: fixtureJson("gh/pr-view.json") }]);
    writeFileSync(join(fk.cwd, "PR.md"), "# Descrição\nvem do arquivo\n");
    const pr = await f.prs.criar({ titulo: "--admin", corpo: "ignorado", corpoArquivo: join(fk.cwd, "PR.md"), base: "main", head: "feat/x", rascunho: true, revisores: ["ana", "bia"], labels: ["bug", "p1"] }, USUARIO);
    expect(pr.numero).toBe(12);
    const c = fk.chamadas()[0]!;
    expect(c.argv).toEqual(expect.arrayContaining(["--title=--admin", "--body-file=-", "--base=main", "--head=feat/x", "--draft", "--reviewer=ana", "--reviewer=bia", "--label=bug", "--label=p1", "--repo=github.com/acme/app"]));
    expect(c.argv).not.toContain("--admin");
    expect(c.stdin).toBe("# Descrição\nvem do arquivo\n");
  });
  it("sem PR.md legível usa `corpo`", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "create"], saida: "https://github.com/acme/app/pull/3\n" }, { quando: ["pr", "view"], saida: {} }]);
    await f.prs.criar({ titulo: "t", corpo: "corpo direto", corpoArquivo: "/nao/existe/PR.md" }, USUARIO);
    expect(fk.chamadas()[0]!.stdin).toBe("corpo direto");
  });
  it("escrita exige origem 'usuario' ou aprovação injetada; sem isso nada roda", async () => {
    const { f, fake: fk } = montar([{ regex: ".", saida: "https://github.com/acme/app/pull/1\n" }]);
    await expect(f.prs.criar({ titulo: "t" }, { origem: "automacao" })).rejects.toMatchObject({ motivo: "sem-aprovacao" });
    await expect(f.prs.criar({ titulo: "t" }, { origem: "automacao", aprovacao: () => false })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    await expect(f.prs.fechar(1, { origem: "x" as never })).rejects.toMatchObject({ motivo: "origem-invalida" });
    await expect(f.prs.comentar(1, "oi", {} as never)).rejects.toBeInstanceOf(ForgeRecusadoErro);
    expect(fk.chamadas()).toHaveLength(0);
    await f.prs.fechar(1, { origem: "automacao", aprovacao: async () => true });
    expect(argvs(fk)[0]).toEqual(["pr", "close", "1", "--repo=github.com/acme/app"]);
  });
  it("automação NUNCA mescla, nem com aprovação", async () => {
    const { f, fake: fk } = montar([{ regex: ".", saida: {} }]);
    await expect(f.prs.mesclar(1, {}, { origem: "automacao", aprovacao: () => true })).rejects.toMatchObject({ motivo: "automacao-nao-mescla" });
    expect(fk.chamadas()).toHaveLength(0);
  });
  it("mesclar respeita as regras do repositório e nunca usa --admin", async () => {
    const { f, fake: fk } = montar([{ quando: ["api", "--hostname=github.com", "repos/acme/app"], saida: { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false } }, { quando: ["pr", "merge"], saida: "" }]);
    await expect(f.prs.mesclar(5, { metodo: "merge" }, USUARIO)).rejects.toBeInstanceOf(ForgeMetodoMergeErro);
    await expect(f.prs.mesclar(5, { metodo: "rebase" }, USUARIO)).rejects.toMatchObject({ permitidos: ["squash"] });
    expect(await f.prs.mesclar(5, { apagarBranch: true }, USUARIO)).toEqual({ metodo: "squash" });
    const m = argvs(fk).find((a) => a[1] === "merge")!;
    expect(m).toEqual(["pr", "merge", "5", "--repo=github.com/acme/app", "--squash", "--delete-branch"]);
    expect(JSON.stringify(argvs(fk))).not.toContain("admin");
  });
  it("erros de branch protegida, permissão e autenticação explicam a causa", async () => {
    const { f, fake: fk } = montar([{ quando: ["api"], saida: {} }, { quando: ["pr", "merge"], stderr: "GraphQL: Pull request is not mergeable: Base branch policy prohibits the merge. (mergePullRequest)\n", codigo: 1 }]);
    const e1 = await f.prs.mesclar(1, {}, USUARIO).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ForgeBranchProtegidaErro);
    expect((e1 as Error).message).toMatch(/protegida.*revisão obrigatória/);
    fk.definir([{ quando: ["pr", "close"], stderr: "GraphQL: Resource not accessible by personal access token (closePullRequest)\nHTTP 403\n", codigo: 1 }]);
    const e2 = await f.prs.fechar(1, USUARIO).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(ForgePermissaoErro);
    expect((e2 as Error).message).toMatch(/Sem permissão.*conta ativa/);
    fk.definir([{ quando: ["pr", "ready"], stderr: "To get started with GitHub CLI, please run:  gh auth login\n", codigo: 4 }]);
    await expect(f.prs.prontoParaRevisao(1, USUARIO)).rejects.toBeInstanceOf(ForgeAutenticacaoErro);
  });
  it("checkout, atualizar branch, pronto, revisar e comentar usam os subcomandos certos", async () => {
    const { f, fake: fk } = montar([{ regex: ".", saida: "" }]);
    await f.prs.checkout(7, USUARIO);
    await f.prs.atualizarBranch(7, { ...USUARIO, rebase: true });
    await f.prs.prontoParaRevisao(7, USUARIO);
    await f.prs.revisar(7, { acao: "aprovar" }, USUARIO);
    await f.prs.revisar(7, { acao: "pedir-mudancas", corpo: "ajuste" }, USUARIO);
    await expect(f.prs.revisar(7, { acao: "comentar" }, USUARIO)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await f.prs.comentar(7, "texto geral", USUARIO);
    const a = argvs(fk);
    expect(a[0]).toEqual(["pr", "checkout", "7", "--repo=github.com/acme/app"]);
    expect(a[1]).toContain("--rebase");
    expect(a[3]).toContain("--approve");
    expect(a[4]).toContain("--request-changes");
    expect(fk.chamadas()[4]!.stdin).toBe("ajuste");
    expect(a[5]).toEqual(["pr", "comment", "7", "--repo=github.com/acme/app", "--body-file=-"]);
  });
  it("comentário em linha usa `gh api` com o commit do PR e JSON em stdin", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "view"], saida: { headRefOid: "abc1234def" } }, { quando: ["api"], saida: {} }]);
    await f.prs.comentar(7, "problema aqui", { ...USUARIO, local: { caminho: "src/a.ts", linha: 10 } });
    const c = fk.chamadas()[1]!;
    expect(c.argv).toEqual(["api", "--hostname=github.com", "--method=POST", "--input=-", "repos/acme/app/pulls/7/comments"]);
    expect(JSON.parse(c.stdin)).toEqual({ body: "problema aqui", commit_id: "abc1234def", path: "src/a.ts", line: 10, side: "RIGHT" });
  });
});

describe("segurança dos argumentos", () => {
  it("branch/label/usuário/número maliciosos são rejeitados antes de rodar", async () => {
    const { f, fake: fk } = montar([{ regex: ".", saida: [] }]);
    await expect(f.prs.listar({ head: "--upload-pack=evil" })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.listar({ base: "a b" })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.listar({ autor: "--json" })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.listar({ label: "a,b" })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.criar({ titulo: "t", head: "-x" }, USUARIO)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.ver(-1)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.prs.ver(1.5)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    await expect(f.checks.log("1; rm -rf /", { aoPedaco: () => undefined })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
    expect(() => criarForgeGithub({ repo: { host: "github.com", caminho: "--upload-pack=x/y" }, cwd: fk.cwd })).toThrow(ForgeEntradaInvalidaErro);
    expect(() => criarForgeGithub({ repo: { host: "gi thub", caminho: "a/b" }, cwd: fk.cwd })).toThrow(ForgeEntradaInvalidaErro);
    expect(fk.chamadas()).toHaveLength(0);
  });
  it("título/busca com sinais de opção viram valor de `--opcao=`, nunca argumento solto", async () => {
    const { f, fake: fk } = montar([{ regex: ".", saida: [] }]);
    await f.prs.listar({ busca: "--web -R outro/repo" });
    expect(argvs(fk)[0]).toContain("--search=--web -R outro/repo");
    expect(argvs(fk)[0]!.filter((x) => x === "--web" || x === "-R")).toEqual([]);
  });
  it("token na saída de erro nunca aparece na mensagem, e nada de token vai em argv", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "close"], stderr: "falhou com ghp_ABCDEFGHIJKLMNOPQRSTUV1234 e https://ghp_XYZ123456789012345678@github.com/a/b.git Authorization: Bearer abc.def.ghi\n", codigo: 1 }]);
    const e = (await f.prs.fechar(1, USUARIO).catch((x: unknown) => x)) as Error & { detalhe?: string };
    const tudo = `${e.message}\n${e.detalhe ?? ""}\n${JSON.stringify(e)}`;
    expect(tudo).not.toMatch(/ghp_|abc\.def\.ghi/);
    expect(JSON.stringify(fk.chamadas())).not.toMatch(/ghp_|gho_|Bearer/);
  });
  it("sem a CLI instalada o erro é nominal e traz a instrução", async () => {
    fake = criarFake();
    const f = criarForgeGithub({ repo: REPO, cwd: fake.cwd, executavel: join(fake.dir, "sem-gh"), executor: fake.executor });
    const e = await f.prs.listar().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForgeCliAusenteErro);
    expect((e as Error).message).toMatch(/brew install gh/);
  });
  it("rate limit vira erro nominal", async () => {
    const { f } = montar([{ quando: ["pr", "list"], stderr: "gh: API rate limit exceeded for user ID 1. (HTTP 403)\n", codigo: 1 }]);
    await expect(f.prs.listar()).rejects.toBeInstanceOf(ForgeRateLimitErro);
  });
});

describe("checks, Actions e logs (T-06.19)", () => {
  it("checks do PR: o JSON vale mesmo com saída 1/8; sem checks devolve lista vazia", async () => {
    const { f, fake: fk } = montar([{ quando: ["pr", "checks"], saida: [{ name: "ci", state: "FAILURE", bucket: "fail", link: "u", workflow: "CI" }, { name: "lint", state: "PENDING", bucket: "pending", link: "" }, { name: "x", state: "SKIPPED", bucket: "skipping", link: "" }], codigo: 1 }]);
    const c = await f.checks.doPr(3);
    expect(c.map((x) => x.situacao)).toEqual(["falha", "pendente", "ignorado"]);
    expect(c[0]!.workflow).toBe("CI");
    fk.definir([{ quando: ["pr", "checks"], stderr: "no checks reported on the 'x' branch\n", codigo: 1 }]);
    expect(await f.checks.doPr(3)).toEqual([]);
  });
  it("execuções de workflow com filtro por situação", async () => {
    const { f, fake: fk } = montar([{ quando: ["run", "list"], saida: fixtureJson("gh/run-list.json") }]);
    const todas = await f.checks.execucoes({ ramo: "main" });
    expect(todas.map((r) => [r.id, r.situacao])).toEqual([["9001", "falha"], ["9002", "pendente"]]);
    expect((await f.checks.execucoes({ situacao: "falha" })).map((r) => r.id)).toEqual(["9001"]);
    expect(argvs(fk)[0]).toContain("--branch=main");
  });
  it("re-executar falhos é escrita (automação precisa de aprovação)", async () => {
    const { f, fake: fk } = montar([{ quando: ["run", "rerun"], saida: "" }]);
    await expect(f.checks.reexecutarFalhos("9001", { origem: "automacao" })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    await f.checks.reexecutarFalhos("9001", USUARIO);
    expect(argvs(fk)[0]).toEqual(["run", "rerun", "9001", "--repo=github.com/acme/app", "--failed"]);
  });
  it("log de 50 MB em streaming, sem acumular e sem travar", async () => {
    const { f } = montar([{ quando: ["run", "view"], bytes: 50 * 1024 * 1024 }]);
    let total = 0;
    let maior = 0;
    const t0 = Date.now();
    const r = await f.checks.log("9001", { aoPedaco: (t) => ((total += t.length), (maior = Math.max(maior, t.length))) });
    expect(r).toEqual({ bytes: 50 * 1024 * 1024, truncado: false });
    expect(total).toBe(50 * 1024 * 1024);
    expect(maior).toBeLessThanOrEqual(1024 * 1024); // pedaços pequenos, nunca o log inteiro
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);
  it("log acima do teto é cortado e o processo encerrado; cancelar também", async () => {
    const { f } = montar([{ quando: ["run", "view"], bytes: 50 * 1024 * 1024 }]);
    let total = 0;
    const r = await f.checks.log("9001", { aoPedaco: (t) => (total += t.length), maxBytes: 2 * 1024 * 1024 });
    expect(r.truncado).toBe(true);
    expect(total).toBeLessThanOrEqual(2 * 1024 * 1024 + 4);
    const ac = new AbortController();
    ac.abort();
    await expect(f.checks.log("9001", { aoPedaco: () => undefined, signal: ac.signal })).rejects.toThrow();
  }, 60_000);
  it("log falho vira erro nominal; somenteFalhos usa --log-failed", async () => {
    const { f, fake: fk } = montar([{ quando: ["run", "view"], stderr: "HTTP 404: Not Found\n", codigo: 1 }]);
    await expect(f.checks.log("1", { aoPedaco: () => undefined, somenteFalhos: true })).rejects.toMatchObject({ codigo: "nao-encontrado" });
    expect(argvs(fk)[0]).toContain("--log-failed");
  });
});

describe("issues (T-06.20) e limite da API", () => {
  it("lista, vê, cria e comenta", async () => {
    const issue = { number: 7, title: "Bug", state: "OPEN", author: { login: "ana" }, labels: [{ name: "bug" }], url: "https://github.com/acme/app/issues/7", body: "descrição", comments: [{ author: { login: "bia" }, body: "ok", createdAt: "d" }] };
    const { f, fake: fk } = montar([{ quando: ["issue", "list"], saida: [issue] }, { quando: ["issue", "view"], saida: issue }, { quando: ["issue", "create"], saida: "https://github.com/acme/app/issues/7\n" }, { quando: ["issue", "comment"], saida: "" }]);
    expect((await f.issues.listar({ estado: "todas", label: "bug" }))[0]).toMatchObject({ numero: 7, estado: "aberta", labels: ["bug"] });
    expect(await f.issues.ver(7)).toMatchObject({ corpo: "descrição", comentarios: [{ autor: "bia" }] });
    const nova = await f.issues.criar({ titulo: "Novo", corpo: "c", labels: ["bug"] }, USUARIO);
    expect(nova.numero).toBe(7);
    await f.issues.comentar(7, "comentário", USUARIO);
    expect(fk.chamadas().find((c) => c.argv[1] === "create")!.stdin).toBe("c");
    expect(fk.chamadas().find((c) => c.argv[1] === "comment")!.stdin).toBe("comentário");
  });
  it("limiteApi lê `gh api rate_limit`", async () => {
    const { f, fake: fk } = montar([{ quando: ["api"], saida: { resources: { core: { limit: 5000, remaining: 42, reset: 1900000000 } } } }]);
    expect(await f.limiteApi()).toEqual({ limite: 5000, restante: 42, reiniciaEm: 1900000000 });
    expect(argvs(fk)[0]).toEqual(["api", "--hostname=github.com", "rate_limit"]);
  });
  it("capacidades() descreve o que o GitHub faz", () => {
    const { f } = montar([]);
    expect(f.capacidades().prs).toMatchObject({ mesclar: true, comentarEmLinha: true, etag: true });
    expect(f.capacidades().metodosMerge).toEqual(["merge", "squash", "rebase"]);
  });
});
