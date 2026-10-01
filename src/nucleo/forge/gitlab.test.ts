import { afterEach, describe, expect, it } from "vitest";
import { criarFake, type Fake, type RegraFake } from "../../../tests/fixtures/forge/ajudante";
import { criarForgeGitlab } from "./gitlab";
import { ForgeAutenticacaoErro, ForgeBranchProtegidaErro, ForgeCliAusenteErro, ForgeEntradaInvalidaErro, ForgeMetodoMergeErro, ForgePermissaoErro, ForgeRecusadoErro } from "./erros";
import type { Forge } from "./forge";

let fake: Fake;
afterEach(() => fake?.limpar());
const U = { origem: "usuario" } as const;

function montar(regras: RegraFake[], extra: { executavel?: string } = {}): Forge {
  fake = criarFake(regras);
  return criarForgeGitlab({ cwd: fake.cwd, executavel: extra.executavel ?? fake.glab, executor: fake.executor, env: fake.env, repo: { host: "gitlab.com", caminho: "acme/app" } });
}
const argvs = (): string[] => fake.chamadas().map((c) => c.argv.join(" "));

describe("GitLab · leitura de MRs", () => {
  it("lista com filtros codificados, mapeia estados e tolera campos ausentes", async () => {
    const f = montar([{ regex: "merge_requests\\?", arquivo: "glab/mr-list.json" }]);
    const r = await f.prs.listar({ autor: "ana", label: "bug", busca: "a b&c" });
    expect(r.itens.map((p) => [p.numero, p.estado, p.rascunho, p.titulo])).toEqual([[5, "aberto", true, "Ajusta rota"], [6, "mesclado", false, "Feature"], [7, "aberto", false, ""]]);
    expect(r.itens[0]!.checks).toEqual({ total: 1, sucesso: 0, falha: 1, pendente: 0 });
    expect(r.itens[1]!.labels).toEqual(["x"]);
    const a = fake.chamadas()[0]!;
    expect(a.argv.slice(0, 3)).toEqual(["api", "--hostname=gitlab.com", expect.stringContaining("projects/acme%2Fapp/merge_requests?")]);
    expect(a.argv[2]).toContain("author_username=ana");
    expect(a.argv[2]).toContain("search=a%20b%26c");
    expect(a.promptOff).toBe(true);
  });

  it("ver junta MR, arquivos, comentários (sem system), aprovações e jobs", async () => {
    const f = montar([
      { regex: "merge_requests/5/diffs", arquivo: "glab/mr-diffs.json" },
      { regex: "merge_requests/5/notes", arquivo: "glab/mr-notes.json" },
      { regex: "merge_requests/5/approvals", saida: { approved_by: [{ user: { username: "eva" } }] } },
      { regex: "merge_requests/5/pipelines", saida: [{ id: 77 }] },
      { regex: "pipelines/77/jobs", arquivo: "glab/jobs.json" },
      { regex: "merge_requests/5$", arquivo: "glab/mr-view.json" },
    ]);
    const d = await f.prs.ver(5);
    expect(d.corpo).toContain("Fecha #3");
    expect(d.arquivos).toEqual([{ caminho: "src/a.ts", adicoes: 2, remocoes: 1 }, { caminho: "src/b.ts", adicoes: 1, remocoes: 0 }]);
    expect(d.comentarios.map((c) => c.autor)).toEqual(["caio", "dani"]);
    expect(d.comentarios[1]).toMatchObject({ caminho: "src/a.ts", linha: 3 });
    expect(d.reviews[0]).toMatchObject({ autor: "eva", estado: "aprovado" });
    expect(d.revisao).toBe("aprovado");
    expect(d.checksDetalhe.map((c) => c.situacao)).toEqual(["sucesso", "falha"]);
    expect(d.mesclavel).toBe("sim");
  });

  it("JSON inválido ou vazio nunca lança na listagem", async () => {
    const f = montar([{ regex: "merge_requests\\?", saida: "isto não é json" }]);
    expect((await f.prs.listar()).itens).toEqual([]);
  });

  it("capacidades são fiéis (sem ETag, sem limite de API) e consultar não usa condicional", async () => {
    const f = montar([{ regex: "merge_requests/5$", arquivo: "glab/mr-view.json" }]);
    expect(f.capacidades().prs.etag).toBe(false);
    expect(await f.limiteApi()).toBeNull();
    const c = await f.prs.consultar(5, '"abc"');
    expect(c.naoModificado).toBe(false);
    expect(c.pr?.numero).toBe(5);
  });
});

describe("GitLab · escrita", () => {
  it("criar: corpo e título vão por JSON em stdin (nunca argv), rascunho e revisor resolvido", async () => {
    const f = montar([
      { regex: "users\\?username=rev1", saida: [{ id: 42 }] },
      { regex: "--method=POST.*merge_requests$", saida: { iid: 9, title: "Draft: -x --admin", state: "opened", web_url: "u" } },
    ]);
    const pr = await f.prs.criar({ titulo: "-x --admin", corpo: "corpo\ncom linhas", head: "feat/a", base: "main", rascunho: true, revisores: ["rev1"], labels: ["a", "b"] }, U);
    expect(pr.numero).toBe(9);
    const post = fake.chamadas().find((c) => c.argv.includes("--method=POST"))!;
    expect(post.argv).toContain("--input=-");
    expect(post.argv.join(" ")).not.toContain("--admin");
    expect(JSON.parse(post.stdin)).toMatchObject({ source_branch: "feat/a", target_branch: "main", title: "Draft: -x --admin", description: "corpo\ncom linhas", labels: "a,b", reviewer_ids: [42] });
  });

  it("automação: sem aprovação recusa; com aprovação cria; mesclar é sempre recusado", async () => {
    const f = montar([{ regex: "--method=POST.*merge_requests$", saida: { iid: 1 } }, { regex: ".*", saida: {} }]);
    await expect(f.prs.criar({ titulo: "t", head: "a", base: "main" }, { origem: "automacao" })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    await expect(f.prs.criar({ titulo: "t", head: "a", base: "main" }, { origem: "automacao", aprovacao: () => true })).resolves.toMatchObject({ numero: 1 });
    await expect(f.prs.mesclar(5, {}, { origem: "automacao", aprovacao: () => true })).rejects.toMatchObject({ motivo: "automacao-nao-mescla" });
    await expect(f.prs.fechar(5, { origem: "x" as never })).rejects.toBeInstanceOf(ForgeRecusadoErro);
    expect(argvs().some((a) => /merge_requests\/\d+\/merge$/.test(a))).toBe(false);
  });

  it("mesclar respeita as regras do projeto (squash proibido, rebase só com merge_method != merge)", async () => {
    const f = montar([{ regex: "projects/acme%2Fapp$", saida: { merge_method: "merge", squash_option: "never" } }]);
    await expect(f.prs.mesclar(5, { metodo: "squash" }, U)).rejects.toBeInstanceOf(ForgeMetodoMergeErro);
    await expect(f.prs.mesclar(5, { metodo: "rebase" }, U)).rejects.toMatchObject({ permitidos: ["merge"] });
  });

  it("mesclar squash chama PUT merge com squash true e apagar branch; rebase faz PUT rebase antes", async () => {
    const f = montar([{ regex: "projects/acme%2Fapp$", saida: { merge_method: "rebase_merge", squash_option: "default_off" } }, { regex: "--method=PUT", saida: {} }]);
    expect(await f.prs.mesclar(5, { metodo: "squash", apagarBranch: true }, U)).toEqual({ metodo: "squash" });
    expect(JSON.parse(fake.chamadas().find((c) => /\/merge$/.test(c.argv.join(" ")))!.stdin)).toEqual({ squash: true, should_remove_source_branch: true });
    await f.prs.mesclar(5, { metodo: "rebase" }, U);
    const a = argvs();
    expect(a.findIndex((x) => x.includes("/rebase"))).toBeLessThan(a.map((x, i) => (x.includes("/merge") ? i : -1)).filter((i) => i >= 0).pop()!);
  });

  it("comentário em linha usa diff_refs do MR; pronto remove o prefixo Draft", async () => {
    const f = montar([
      { regex: "merge_requests/5$", saida: { iid: 5, title: "Draft: Rota", diff_refs: { base_sha: "aaaaaaa1", start_sha: "bbbbbbb2", head_sha: "ccccccc3" } } },
      { regex: "--method=", saida: {} },
    ]);
    await f.prs.comentar(5, "ajuste aqui", { ...U, local: { caminho: "src/a.ts", linha: 12 } });
    const disc = fake.chamadas().find((c) => c.argv.join(" ").includes("/discussions"))!;
    expect(JSON.parse(disc.stdin).position).toMatchObject({ position_type: "text", head_sha: "ccccccc3", new_path: "src/a.ts", new_line: 12 });
    await f.prs.prontoParaRevisao(5, U);
    const put = fake.chamadas().filter((c) => c.argv.includes("--method=PUT")).pop()!;
    expect(JSON.parse(put.stdin)).toEqual({ title: "Rota" });
  });

  it("revisar aprova por /approve e pedir mudanças exige corpo", async () => {
    const f = montar([{ regex: "--method=", saida: {} }]);
    await f.prs.revisar(5, { acao: "aprovar" }, U);
    expect(argvs().some((a) => a.includes("merge_requests/5/approve"))).toBe(true);
    await expect(f.prs.revisar(5, { acao: "pedir-mudancas" }, U)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
  });

  it("checkout usa `glab mr checkout` com número validado", async () => {
    const f = montar([{ quando: ["mr", "checkout"], saida: "" }]);
    await f.prs.checkout(5, U);
    expect(fake.chamadas()[0]!.argv.slice(0, 3)).toEqual(["mr", "checkout", "5"]);
    await expect(f.prs.checkout(-1 as number, U)).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
  });
});

describe("GitLab · pipelines e issues", () => {
  it("lista execuções com filtro de ramo e transmite o log de 50 MB em streaming sem acumular", async () => {
    const f = montar([{ regex: "pipelines\\?", saida: [{ id: 1, status: "failed", ref: "main", source: "push", web_url: "u" }, { id: 2, status: "running", ref: "main" }] }, { regex: "jobs/10/trace", bytes: 50 * 1024 * 1024 }]);
    expect((await f.checks.execucoes({ ramo: "main", situacao: "falha" })).map((e) => e.id)).toEqual(["1"]);
    let total = 0;
    const r = await f.checks.log("10", { aoPedaco: (t) => (total += t.length) });
    expect(r).toEqual({ bytes: 50 * 1024 * 1024, truncado: false });
    expect(total).toBe(50 * 1024 * 1024);
  }, 60_000);

  it("log respeita maxBytes e marca truncado; id não numérico é recusado", async () => {
    const f = montar([{ regex: "trace", bytes: 4 * 1024 * 1024 }]);
    const r = await f.checks.log("3", { aoPedaco: () => undefined, maxBytes: 1024 * 1024 });
    expect(r.truncado).toBe(true);
    await expect(f.checks.log("3/../x", { aoPedaco: () => undefined })).rejects.toBeInstanceOf(ForgeEntradaInvalidaErro);
  });

  it("reexecutar falhos faz POST retry; issues listam, criam e comentam", async () => {
    const f = montar([
      { regex: "issues\\?", saida: [{ iid: 3, title: "Bug", state: "closed", author: { username: "x" }, labels: ["b"], web_url: "u" }] },
      { regex: "--method=POST.*issues$", saida: { iid: 4, title: "Nova", state: "opened" } },
      { regex: "--method=POST", saida: {} },
    ]);
    await f.checks.reexecutarFalhos("77", U);
    expect(argvs().some((a) => a.includes("pipelines/77/retry"))).toBe(true);
    expect((await f.issues.listar({ estado: "todas" }))[0]).toMatchObject({ numero: 3, estado: "fechada" });
    expect((await f.issues.criar({ titulo: "Nova", corpo: "c", labels: ["b"] }, U)).numero).toBe(4);
    await f.issues.comentar(4, "oi", U);
    expect(JSON.parse(fake.chamadas().pop()!.stdin)).toEqual({ body: "oi" });
  });
});

describe("GitLab · erros e detecção", () => {
  it("classifica 403, 401 e branch protegida sem vazar token", async () => {
    const f = montar([{ regex: "merge_requests\\?", stderr: "glab: 403 Forbidden glpat-ABCDEFGHIJKLMNOP1234", codigo: 1 }, { regex: "merge_requests/5$", stderr: "401 Unauthorized", codigo: 1 }]);
    const e1 = await f.prs.listar().catch((e: Error) => e);
    expect(e1).toBeInstanceOf(ForgePermissaoErro);
    expect(JSON.stringify(e1) + (e1 as Error).message).not.toContain("glpat-ABCDEFG");
    await expect(f.prs.ver(5)).rejects.toBeInstanceOf(ForgeAutenticacaoErro);
    fake.definir([{ regex: ".*", stderr: "405 Method Not Allowed: branch protection, approvals required", codigo: 1 }]);
    await expect(f.prs.mesclar(5, { metodo: "merge" }, U)).rejects.toBeInstanceOf(ForgeBranchProtegidaErro);
  });

  it("glab ausente vira ForgeCliAusenteErro e detectar() devolve estado degradado com instrução", async () => {
    const f = montar([], { executavel: "/inexistente/glab" });
    await expect(f.prs.listar()).rejects.toBeInstanceOf(ForgeCliAusenteErro);
    const s = await f.detectar();
    expect(s).toMatchObject({ provedor: "gitlab", degradado: true, autenticado: false, cli: { instalada: false } });
    expect(s.instrucao).toContain("glab");
  });

  it("detectar() reconhece conta logada do host e nunca expõe token", async () => {
    const f = montar([{ quando: ["--version"], saida: "glab 1.45.0 (2026-01-01)\n" }, { quando: ["auth", "status"], arquivo: "glab/auth-status.txt" }]);
    const s = await f.detectar();
    expect(s).toMatchObject({ autenticado: true, degradado: false, cli: { instalada: true, versao: "1.45.0" } });
    expect(s.contas[0]).toMatchObject({ host: "gitlab.com", usuario: "thulio" });
    expect(JSON.stringify(s)).not.toMatch(/token found|\*{5}/i);
  });
});
