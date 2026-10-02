import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlvoVcs, EventoVcs } from "../compartilhado/vcs";
import { criarVcsSvn } from "../nucleo/vcs";
import { criarRepoGit, criarTmp, git, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import { falso } from "../../tests/fixtures/vcs/svn-util";
import { criarVcsMain, sanearErro, type MissaoMinima, type VcsMain } from "./vcs";

afterEach(async () => {
  while (abertos.length) await abertos.pop()?.encerrar();
  limpar();
});
const abertos: VcsMain[] = [];

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const WS2 = "ws_01J8ZXAMPLE0000000000000B2";
const MIS = "mis_01J8ZXAMPLE0000000000000A1";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate(cond: () => boolean, ms = 8000): Promise<void> {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("tempo esgotado");
    await espera(40);
  }
}

function montar(opts: { raiz?: string; missoes?: MissaoMinima[]; abrir?: Parameters<typeof criarVcsMain>[0]["abrir"]; extra?: Partial<Parameters<typeof criarVcsMain>[0]> | undefined } = {}) {
  const base = opts.raiz === undefined ? criarRepoGit() : null;
  const raiz = opts.raiz ?? (base as { raiz: string }).raiz;
  const { banco } = novoBanco();
  const emitidos: EventoVcs[] = [];
  const lixeira: string[] = [];
  const seg = criarTmp("seg-");
  const missoes = opts.missoes ?? [];
  const vcs = criarVcsMain({
    workspaces: { obter: (id) => (id === WS ? { id: WS, raiz } : id === WS2 ? { id: WS2, raiz } : undefined) },
    missoes: { obter: (id) => missoes.find((m) => m.id === id) },
    banco,
    emitir: (_c, p) => void emitidos.push(p),
    janelaEmFoco: () => false,
    moverParaLixeira: async (p) => {
      lixeira.push(p);
      rmSync(p, { force: true, recursive: true });
    },
    pastaSeguranca: seg,
    consultarPr: false,
    ...(opts.abrir ? { abrir: opts.abrir } : {}),
    ...(opts.extra ?? {}),
  });
  abertos.push(vcs);
  const alvo: AlvoVcs = { workspace_id: WS, mission_id: null };
  const eventos = (tipo?: string): Array<Record<string, unknown>> => banco.consultar<{ tipo: string; payload_json: string }>("SELECT tipo, payload_json FROM evento_dominio ORDER BY rowid").filter((e) => tipo === undefined || e.tipo === tipo).map((e) => ({ tipo: e.tipo, ...(JSON.parse(e.payload_json) as Record<string, unknown>) }));
  const f = (canal: Parameters<VcsMain["familia"]>[0], op: string, args: Record<string, unknown> = {}, a: AlvoVcs = alvo) => vcs.familia(canal, { ...a, op, ...args });
  return { vcs, raiz, pai: base?.pai ?? null, alvo, emitidos, lixeira, seg, eventos, f, banco };
}

describe("estado", () => {
  it("repo git: resumo, capabilities, ramo padrão protegido e nenhum caminho absoluto", async () => {
    const m = montar();
    writeFileSync(join(m.raiz, "novo.txt"), "x\n");
    const e = await m.vcs.estado({ ...m.alvo, ignorados: false });
    expect(e.tipo).toBe("git");
    expect(e.local).toBe(".");
    expect(e.status.branch).toBe("main");
    expect(e.ramo_padrao).toBe("main");
    expect(e.ramo_protegido).toBe(true);
    expect(e.resumo).toMatchObject({ branch: "main", sujo: true, nao_rastreados: 1, operacao: null });
    expect(e.capabilities.stage).toBe(true);
    expect(JSON.stringify(e)).not.toContain(m.raiz);
  });

  it("pasta sem versionamento: estado vazio com instrução; workspace desconhecido é erro", async () => {
    const m = montar({ raiz: criarTmp("sem-vcs-") });
    const e = await m.vcs.estado({ ...m.alvo, ignorados: false });
    expect(e.tipo).toBe("nenhum");
    expect(e.mensagem).toMatch(/controle de versão/);
    await expect(m.vcs.estado({ workspace_id: "ws_01J8ZXAMPLE0000000000000Z9", mission_id: null, ignorados: false })).rejects.toThrow(/Workspace não encontrado/);
  });

  it("operação git em pasta sem repositório devolve erro claro", async () => {
    const m = montar({ raiz: criarTmp("sem-vcs-") });
    await expect(m.f("vcs:estagio", "estagiar", { caminhos: ["a"] })).rejects.toThrow(/não está sob controle/);
  });
});

describe("estagiar, commit e auditoria", () => {
  it("estagia arquivo e hunk, comita como usuário e audita sem a mensagem completa", async () => {
    const m = montar();
    writeFileSync(join(m.raiz, "a.txt"), Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n") + "\n");
    git(m.raiz, "add", "a.txt");
    git(m.raiz, "commit", "-q", "-m", "a");
    const novo = Array.from({ length: 40 }, (_, i) => (i === 1 ? "MUDOU 1" : i === 38 ? "MUDOU 38" : `linha ${i}`)).join("\n") + "\n";
    writeFileSync(join(m.raiz, "a.txt"), novo);
    await m.f("vcs:estagio", "hunk", { sentido: "estagiar", caminho: "a.txt", hunk: 0, linhas: null });
    expect(git(m.raiz, "diff", "--cached", "--stat")).toMatch(/1 file changed, 1 insertion/);
    writeFileSync(join(m.raiz, "b.txt"), "b\n");
    await m.f("vcs:estagio", "estagiar", { caminhos: ["b.txt"] });
    const r = (await m.f("vcs:commit", "criar", { mensagem: "feat: algo bem feito\n\ntoken=ghp_SEGREDOSEGREDOSEGREDO", amend: false, pular_hooks: false, coautores: [] })) as { hashCurto: string };
    expect(r.hashCurto).toMatch(/^[0-9a-f]{7}$/);
    const ev = m.eventos("vcs.commit");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ ok: true, assunto: "feat: algo bem feito", origem: "usuario", workspace_id: WS });
    expect(JSON.stringify(ev)).not.toContain("SEGREDO");
    expect(JSON.stringify(ev)).not.toContain(m.raiz);
  });

  it("segredo digitado NO ASSUNTO do commit também não entra na auditoria (A-04)", async () => {
    const m = montar();
    writeFileSync(join(m.raiz, "s.txt"), "s\n");
    await m.f("vcs:estagio", "estagiar", { caminhos: ["s.txt"] });
    await m.f("vcs:commit", "criar", { mensagem: "fix: usar token=ghp_SEGREDOSEGREDOSEGREDO e https://u:senha-x@host.com/r.git", amend: false, pular_hooks: false, coautores: [] });
    const ev = JSON.stringify(m.eventos("vcs.commit"));
    expect(ev).not.toContain("SEGREDO");
    expect(ev).not.toContain("senha-x");
    expect(ev).toContain("fix: usar");
  });

  it("commit sem nada estagiado falha e audita a falha", async () => {
    const m = montar();
    await expect(m.f("vcs:commit", "criar", { mensagem: "vazio", amend: false, pular_hooks: false, coautores: [] })).rejects.toThrow();
    expect(m.eventos("vcs.commit")[0]).toMatchObject({ ok: false });
  });

  it("caminho com .. vindo do núcleo é recusado sem vazar caminho absoluto", async () => {
    const m = montar();
    const erro = await m.f("vcs:estagio", "estagiar", { caminhos: ["../fora"] }).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).not.toContain(m.raiz);
  });
});

describe("descartar (rede de segurança)", () => {
  it("simular não toca em nada; sem confirmar é recusado; confirmar copia, restaura e manda o novo para a lixeira", async () => {
    const m = montar();
    writeFileSync(join(m.raiz, "README.md"), "alterado\n");
    writeFileSync(join(m.raiz, "lixo.txt"), "x\n");
    const sim = (await m.f("vcs:estagio", "descartar", { caminhos: ["README.md", "lixo.txt"], incluir_staged: false, simular: true, confirmar: false })) as { simulado: boolean; itens: unknown[] };
    expect(sim.simulado).toBe(true);
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("alterado\n");
    await expect(m.f("vcs:estagio", "descartar", { caminhos: ["README.md"], incluir_staged: false, simular: false, confirmar: false })).rejects.toThrow(/confirme/);
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("alterado\n");
    const r = (await m.f("vcs:estagio", "descartar", { caminhos: ["README.md", "lixo.txt"], incluir_staged: false, simular: false, confirmar: true })) as { idDesfazer: string | null };
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("# teste\n");
    expect(m.lixeira.map((p) => p.replace(m.raiz, ""))).toEqual(["/lixo.txt"]);
    expect(existsSync(join(m.seg, WS))).toBe(true);
    expect(readdirSync(join(m.seg, WS)).length).toBe(1);
    expect(m.eventos("vcs.descartar").at(-1)).toMatchObject({ ok: true, restaurados: 1, lixeira: 1 });
    // desfazer devolve o arquivo da cópia de segurança
    const lista = (await m.f("vcs:estagio", "descartes_listar")) as Array<{ id: string }>;
    expect(lista).toHaveLength(1);
    await m.f("vcs:estagio", "desfazer_descarte", { id: r.idDesfazer as string });
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("alterado\n");
  });
});

describe("ramos, stash e histórico", () => {
  it("cria, troca, lista; apagar à força exige o nome digitado", async () => {
    const m = montar();
    await m.f("vcs:ramos", "criar", { nome: "feature/x", de: null, trocar: true });
    writeFileSync(join(m.raiz, "f.txt"), "f\n");
    git(m.raiz, "add", ".");
    git(m.raiz, "commit", "-q", "-m", "f");
    const t = (await m.f("vcs:ramos", "trocar", { destino: "main", estrategia: null })) as { trocou: boolean };
    expect(t.trocou).toBe(true);
    const lista = (await m.f("vcs:ramos", "listar", { remotos: false })) as Array<{ nome: string; atual: boolean }>;
    expect(lista.find((r) => r.atual)?.nome).toBe("main");
    await expect(m.f("vcs:ramos", "apagar", { nome: "feature/x", forcar: true, simular: false, confirmacao: null })).rejects.toThrow(/digitar o nome/);
    await expect(m.f("vcs:ramos", "apagar", { nome: "feature/x", forcar: true, simular: false, confirmacao: "outro" })).rejects.toThrow(/digitar o nome/);
    const sim = (await m.f("vcs:ramos", "apagar", { nome: "feature/x", forcar: false, simular: true, confirmacao: null })) as { requerForcar: boolean; apagado: boolean };
    expect(sim.apagado).toBe(false);
    expect(sim.requerForcar).toBe(true);
    const ok = (await m.f("vcs:ramos", "apagar", { nome: "feature/x", forcar: true, simular: false, confirmacao: "feature/x" })) as { apagado: boolean };
    expect(ok.apagado).toBe(true);
    expect(m.eventos("vcs.ramo").map((e) => e["acao"])).toEqual(expect.arrayContaining(["criar", "trocar", "apagar"]));
    expect(((await m.f("vcs:ramos", "padrao")) as { nome: string }).nome).toBe("main");
  });

  it("stash cria, lista e pop; histórico lista commits e detalha", async () => {
    const m = montar();
    writeFileSync(join(m.raiz, "README.md"), "mudou\n");
    const c = (await m.f("vcs:stash", "criar", { mensagem: "meu stash", nao_rastreados: false, manter_indice: false })) as { criado: boolean };
    expect(c.criado).toBe(true);
    expect(((await m.f("vcs:stash", "listar")) as unknown[]).length).toBe(1);
    const p = (await m.f("vcs:stash", "pop", { indice: 0, restaurar_indice: false })) as { aplicado: boolean };
    expect(p.aplicado).toBe(true);
    const log = (await m.f("vcs:historico", "log", { limite: 10, cursor: null, rev: null, todos: false, busca: null, regex: false, autor: null, caminho: null })) as { commits: Array<{ assunto: string; hash: string }> };
    expect(log.commits[0]?.assunto).toBe("inicial");
    const d = (await m.f("vcs:historico", "detalhe", { rev: log.commits[0]?.hash })) as { diff: { arquivos: unknown[] } };
    expect(d.diff.arquivos.length).toBe(1);
    expect(m.eventos("vcs.stash").length).toBeGreaterThanOrEqual(2);
  });
});

describe("merge com conflito resolvido pela UI", () => {
  it("mescla, lista conflito, resolve hunk e continua", async () => {
    const m = montar();
    git(m.raiz, "checkout", "-q", "-b", "outro");
    writeFileSync(join(m.raiz, "README.md"), "# do outro\n");
    git(m.raiz, "commit", "-qam", "outro");
    git(m.raiz, "checkout", "-q", "main");
    writeFileSync(join(m.raiz, "README.md"), "# do main\n");
    git(m.raiz, "commit", "-qam", "main");
    const r = (await m.f("vcs:operacao", "mesclar", { rev: "outro", sem_ff: false, squash: false, mensagem: null, simular: false })) as { resultado: string; conflitos: string[] };
    expect(r.resultado).toBe("conflito");
    const est = await m.vcs.estado({ ...m.alvo, ignorados: false });
    expect(est.operacao?.operacao).toBe("merge");
    expect(est.resumo.operacao).toBe("merge");
    const lista = (await m.f("vcs:conflitos", "listar")) as Array<{ caminho: string }>;
    expect(lista.map((c) => c.caminho)).toEqual(["README.md"]);
    const lido = (await m.f("vcs:conflitos", "ler", { caminho: "README.md" })) as { hunks: Array<{ id: number }> };
    const res = (await m.f("vcs:conflitos", "resolver_hunks", { caminho: "README.md", resolucoes: { [String(lido.hunks[0]?.id)]: "deles" }, marcar: true })) as { restantes: number; marcado: boolean };
    expect(res).toEqual({ restantes: 0, marcado: true });
    const fim = (await m.f("vcs:operacao", "continuar")) as { resultado: string };
    expect(fim.resultado).toBe("ok");
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("# do outro\n");
    expect(m.eventos("vcs.conflito").length).toBe(1);
    expect(m.eventos("vcs.operacao").length).toBe(2);
  });
});

describe("remotos (file:// local, sem rede)", () => {
  function comRemoto() {
    const m = montar();
    const bare = join(criarTmp("bare-"), "origem.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    git(m.raiz, "remote", "add", "origin", `file://${bare}`);
    return { m, bare };
  }
  it("push (define upstream), fetch e pull simulado; tudo auditado", async () => {
    const { m } = comRemoto();
    const p = (await m.f("vcs:remoto", "push", { remoto: null, ramo: "main" })) as { upstreamDefinido: boolean };
    expect(p.upstreamDefinido).toBe(true);
    const f = (await m.f("vcs:remoto", "fetch", { remoto: null, todos: false, podar: false })) as { remotos: string[] };
    expect(f.remotos).toContain("origin");
    const pl = (await m.f("vcs:remoto", "pull", { modo: "ff-only", remoto: null, ramo: null, simular: true })) as { resultado: string };
    expect(["ja-atualizado", "simulado"]).toContain(pl.resultado);
    expect((await m.f("vcs:remoto", "listar")) as unknown[]).toHaveLength(1);
    expect(m.eventos("vcs.remoto").map((e) => e["acao"])).toEqual(["push", "fetch"]);
  });
  it("lease: recusado no branch padrão e sem confirmação digitada", async () => {
    const { m } = comRemoto();
    await m.f("vcs:remoto", "push", { remoto: null, ramo: "main" });
    const hash = git(m.raiz, "rev-parse", "HEAD").trim();
    await expect(m.f("vcs:remoto", "lease", { remoto: null, ramo: "main", ref_esperada: hash, confirmacao: "main", simular: false })).rejects.toThrow(/branch padrão/);
    git(m.raiz, "checkout", "-q", "-b", "feature/z");
    await m.f("vcs:remoto", "push", { remoto: null, ramo: "feature/z" });
    await expect(m.f("vcs:remoto", "lease", { remoto: null, ramo: "feature/z", ref_esperada: hash, confirmacao: null, simular: false })).rejects.toThrow(/digitar o nome/);
    await expect(m.f("vcs:remoto", "lease", { remoto: null, ramo: "feature/z", ref_esperada: hash, confirmacao: "errado", simular: false })).rejects.toThrow(/digitar o nome/);
    const sim = (await m.f("vcs:remoto", "lease", { remoto: null, ramo: "feature/z", ref_esperada: hash, confirmacao: null, simular: true })) as { simulado: boolean; enviado: boolean };
    expect(sim).toMatchObject({ simulado: true, enviado: false });
  });
});

describe("observação", () => {
  it("emite vcs:mudou ao editar, conta referências e para ao liberar", async () => {
    const m = montar();
    const r1 = await m.vcs.observar({ ...m.alvo, ativo: true });
    expect(r1.tipo).toBe("git");
    await m.vcs.observar({ ...m.alvo, ativo: true });
    await ate(() => m.emitidos.length > 0 && m.emitidos.some((e) => !e.resumo.calculando));
    writeFileSync(join(m.raiz, "mudanca.txt"), "x\n");
    await ate(() => m.emitidos.some((e) => e.resumo.nao_rastreados === 1));
    const ultimo = m.emitidos.at(-1) as EventoVcs;
    expect(ultimo).toMatchObject({ workspace_id: WS, mission_id: null });
    await m.vcs.observar({ ...m.alvo, ativo: false });
    const antes = m.emitidos.length;
    writeFileSync(join(m.raiz, "mais.txt"), "y\n");
    await ate(() => m.emitidos.length > antes); // ainda há uma referência
    await m.vcs.observar({ ...m.alvo, ativo: false });
    await espera(150);
    const depois = m.emitidos.length;
    writeFileSync(join(m.raiz, "terceiro.txt"), "z\n");
    await espera(900);
    expect(m.emitidos.length).toBe(depois);
  });
});

describe("Missão ↔ VCS", () => {
  function comMissao() {
    const m0 = criarRepoGit("repo");
    const wt = join(m0.pai, "repo--minha");
    git(m0.raiz, "worktree", "add", "-q", "-b", "feature/minha", wt);
    writeFileSync(join(wt, "m.txt"), "m\n");
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "feat: primeira task");
    const hash = git(wt, "rev-parse", "HEAD").trim();
    mkdirSync(join(m0.raiz, "docs/entregas/minha"), { recursive: true });
    writeFileSync(join(m0.raiz, "docs/entregas/minha/ENTREGA.md"), `---\ncommits:\n  - task: T-01\n    commit: ${hash.slice(0, 10)}\n  - task: T-02\n    commit: deadbeef\n---\n`);
    const missao: MissaoMinima = { id: MIS, workspace_id: WS, worktree: "../repo--minha", branch: "feature/minha", trabalho_id: "minha" };
    const m = montar({ raiz: m0.raiz, missoes: [missao] });
    return { m, wt, hash };
  }

  it("resumo, commits da ENTREGA.md, diff contra a base e comparação", async () => {
    const { m } = comMissao();
    const r = (await m.vcs.missao({ mission_id: MIS, op: "resumo" })) as { branch: string; worktree: string; existe: boolean; base: string; resumo: { branch: string; sujo: boolean } };
    expect(r).toMatchObject({ branch: "feature/minha", worktree: "../repo--minha", existe: true, base: "main" });
    expect(r.resumo.branch).toBe("feature/minha");
    const c = (await m.vcs.missao({ mission_id: MIS, op: "commits" })) as Array<{ task: string; assunto: string | null; existe: boolean }>;
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ task: "T-01", assunto: "feat: primeira task", existe: true });
    expect(c[1]).toMatchObject({ task: "T-02", existe: false });
    const d = (await m.vcs.missao({ mission_id: MIS, op: "diff_base", caminho: null })) as { arquivos: Array<{ caminho: string }> };
    expect(d.arquivos.map((a) => a.caminho)).toEqual(["m.txt"]);
    const cmp = (await m.vcs.missao({ mission_id: MIS, op: "comparar" })) as { ahead: number; base: string };
    expect(cmp).toMatchObject({ ahead: 1, base: "main" });
  });

  it("o alvo mission_id opera na árvore da Missão e o estado mostra local relativo", async () => {
    const { m } = comMissao();
    const e = await m.vcs.estado({ workspace_id: WS, mission_id: MIS, ignorados: false });
    expect(e.status.branch).toBe("feature/minha");
    expect(e.local).toBe("../repo--minha");
    expect(JSON.stringify(e)).not.toContain(m.raiz);
    await m.f("vcs:ramos", "criar", { nome: "fix/na-missao", de: null, trocar: true }, { workspace_id: WS, mission_id: MIS });
    expect(git(m.raiz, "branch", "--show-current").trim()).toBe("main");
  });

  it("recusa missão de outro workspace, worktree que escapa e pasta inexistente", async () => {
    const { m } = comMissao();
    await expect(m.vcs.estado({ workspace_id: WS2, mission_id: MIS, ignorados: false })).rejects.toThrow(/Missão não encontrada/);
    const escapa = montar({ raiz: m.raiz, missoes: [{ id: MIS, workspace_id: WS, worktree: "../../etc", branch: null, trabalho_id: null }] });
    await expect(escapa.vcs.estado({ workspace_id: WS, mission_id: MIS, ignorados: false })).rejects.toThrow(/fora do workspace|não existe/);
    const tmpFora = criarTmp("fora-");
    const fora = montar({ raiz: m.raiz, missoes: [{ id: MIS, workspace_id: WS, worktree: tmpFora, branch: null, trabalho_id: null }] });
    await expect(fora.vcs.estado({ workspace_id: WS, mission_id: MIS, ignorados: false })).rejects.toThrow(/fora do workspace/);
    const inex = montar({ raiz: m.raiz, missoes: [{ id: MIS, workspace_id: WS, worktree: "../repo--sumiu", branch: null, trabalho_id: null }] });
    await expect(inex.vcs.estado({ workspace_id: WS, mission_id: MIS, ignorados: false })).rejects.toThrow(/não existe mais/);
  });
});

describe("SVN (svn falso)", () => {
  it("info sem caminho absoluto; criar ramo no servidor exige confirmação; reverter exige confirmar", async () => {
    const raiz = criarTmp("svn-wc-");
    mkdirSync(join(raiz, ".svn"));
    const f = falso();
    const m = montar({ raiz, abrir: async (dir) => criarVcsSvn(dir, { executavel: f.executavel, env: f.env }) });
    const info = (await m.f("vcs:svn", "info")) as { url_relativa: string; revisao: number };
    expect(info.url_relativa).toBe("^/trunk");
    expect(JSON.stringify(info)).not.toContain(raiz);
    await expect(m.f("vcs:svn", "ramo_criar", { tipo: "branch", nome: "x", mensagem: null, confirmado_servidor: false })).rejects.toThrow(/servidor/);
    await expect(m.f("vcs:svn", "reverter", { caminhos: ["a.txt"], confirmar: false })).rejects.toThrow(/confirme/);
    expect(m.eventos("vcs.svn").some((e) => e["acao"] === "ramo_criar" && e["ok"] === false)).toBe(true);
    await expect(m.f("vcs:ramos", "listar", { remotos: false })).rejects.toThrow(/só para repositórios git/);
  });
});

describe("fetch em segundo plano (P-22): opt-in, só observando, nunca push", () => {
  function comOrigem(extra: NonNullable<Parameters<typeof montar>[0]>["extra"]) {
    const m = montar({ extra: { intervaloFundoMs: 1000, ...extra } });
    const bare = join(criarTmp("bare-fundo-"), "origem.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    git(m.raiz, "remote", "add", "origin", `file://${bare}`);
    return { m, bare };
  }
  const fundo = (m: ReturnType<typeof montar>) => m.eventos("vcs.remoto").filter((e) => e["acao"] === "fetch_fundo");

  it("desligado por padrão: observar não toca no remoto", async () => {
    const { m } = comOrigem({ janelaEmFoco: () => true, preferencia: () => undefined });
    await m.vcs.observar({ ...m.alvo, ativo: true });
    await espera(1500);
    expect(fundo(m)).toEqual([]);
  });
  it("ligado e com a janela em foco: busca do remoto, audita e para quando ninguém observa mais; sem foco não busca", async () => {
    let foco = false;
    const { m, bare } = comOrigem({ janelaEmFoco: () => foco, preferencia: (c) => (c === "vcs_fetch_segundo_plano" ? true : undefined) });
    await m.vcs.observar({ ...m.alvo, ativo: true });
    await espera(1500);
    expect(fundo(m)).toEqual([]); // sem foco: pausado
    foco = true;
    await ate(() => fundo(m).length > 0);
    expect(fundo(m)[0]).toMatchObject({ ok: true, acao: "fetch_fundo" });
    await m.vcs.observar({ ...m.alvo, ativo: false });
    await espera(150);
    const n = fundo(m).length;
    await espera(1500);
    expect(fundo(m).length).toBe(n); // liberado: timer parado
    expect(m.eventos("vcs.remoto").some((e) => e["acao"] === "push")).toBe(false);
    expect(git(bare, "for-each-ref")).toBe(""); // nada foi enviado ao remoto
  });
  it("preferência desligada depois: o timer segue mas não busca (relida a cada tick)", async () => {
    let ligado = true;
    const { m } = comOrigem({ janelaEmFoco: () => true, preferencia: () => ligado });
    await m.vcs.observar({ ...m.alvo, ativo: true });
    await ate(() => fundo(m).length > 0);
    ligado = false;
    await espera(200);
    const n = fundo(m).length;
    await espera(1500);
    expect(fundo(m).length).toBe(n);
  });
});

describe("PR da Missão no forge (opt-in) e credencial do cofre", () => {
  const forgeFalso = (itens: unknown[], visto: { chamadas: number }) => ({ provedor: "github", prs: { listar: async () => { visto.chamadas++; return { itens, truncado: false }; } } }) as never;
  function comMissaoPr(extra: Partial<Parameters<typeof criarVcsMain>[0]>, entrega: string | null) {
    const m0 = criarRepoGit("repo");
    git(m0.raiz, "worktree", "add", "-q", "-b", "feature/pr", join(m0.pai, "repo--pr"));
    if (entrega !== null) {
      mkdirSync(join(m0.raiz, "docs/entregas/pr"), { recursive: true });
      writeFileSync(join(m0.raiz, "docs/entregas/pr/ENTREGA.md"), entrega);
    }
    const missao: MissaoMinima = { id: MIS, workspace_id: WS, worktree: "../repo--pr", branch: "feature/pr", trabalho_id: "pr" };
    return montar({ raiz: m0.raiz, missoes: [missao], extra });
  }
  const pr = { numero: 3, titulo: "x", estado: "aberto", url: "https://github.com/a/b/pull/3", checks: { total: 3, sucesso: 1, falha: 2, pendente: 0 } };

  it("sem a preferência não consulta o forge (sem rede); com ela, checks vermelhos deixam a sinaleira amarela e ENTREGA.md velho é só sinalizado", async () => {
    const visto = { chamadas: 0 };
    const desligado = comMissaoPr({ abrirForge: async () => forgeFalso([pr], visto), preferencia: () => undefined }, null);
    const r0 = (await desligado.vcs.missao({ mission_id: MIS, op: "resumo" })) as { pr: unknown; pr_sinaleira: unknown };
    expect(r0).toMatchObject({ pr: null, pr_sinaleira: null });
    expect(visto.chamadas).toBe(0);

    const entrega = "---\npr: 9\n---\n";
    const ligado = comMissaoPr({ abrirForge: async () => forgeFalso([pr], visto), preferencia: (c) => (c === "vcs_pr_inicio" ? true : undefined) }, entrega);
    const r1 = (await ligado.vcs.missao({ mission_id: MIS, op: "resumo" })) as { pr: { numero: number; checks_falhando: number }; pr_sinaleira: { cor: string; motivo: string; entrega_desatualizada: boolean } };
    expect(visto.chamadas).toBe(1);
    expect(r1.pr).toMatchObject({ numero: 3, checks_falhando: 2 });
    expect(r1.pr_sinaleira).toEqual({ cor: "amarela", motivo: "2 checks falhando no PR #3", entrega_desatualizada: true });
    expect(readFileSync(join(ligado.raiz, "docs/entregas/pr/ENTREGA.md"), "utf8")).toBe(entrega); // o disco nunca é reescrito
  });

  it("Bitbucket/Azure: a credencial do forge sai do cofre (FORGE_<HOST>), sem passar pelo renderer", async () => {
    let cred: ((h: string) => Promise<unknown>) | undefined;
    const lidos: string[] = [];
    const cofre = { existe: async (n: string) => n === "FORGE_BITBUCKET_ORG", obter: async (n: string) => (lidos.push(n), "tok-bitbucket") } as never;
    const m = montar({ extra: { cofre: async () => cofre, abrirForge: async (o) => { cred = o.credencial as never; return { provedor: "bitbucket", detectar: async () => null } as never; } } });
    await m.f("vcs:forge", "estado");
    expect(await cred?.("bitbucket.org")).toEqual({ esquema: "Bearer", valor: "tok-bitbucket" });
    expect(await cred?.("dev.azure.com")).toBeUndefined();
    expect(lidos).toEqual(["FORGE_BITBUCKET_ORG"]);
    expect(JSON.stringify(m.eventos())).not.toContain("tok-bitbucket");
  });
});

describe("sanearErro", () => {
  it("troca caminhos conhecidos, remove credenciais em URL e prefixa o código nominal", () => {
    class NomeInvalidoErro extends Error { override name = "NomeInvalidoErro"; }
    const e = sanearErro(new NomeInvalidoErro("falhou em /Users/fulano/proj/src e https://usuario:senha@host.com/x.git em /tmp/area/repo"), ["/tmp/area/repo"]);
    expect(e.message).toBe("[nome-invalido] falhou em <caminho> e https://host.com/x.git em .");
    expect(sanearErro("texto", []).message).toBe("Falha no versionamento.");
  });
});
