// T-06.37: tabela de risco do versionamento. Toda operação dos canais `vcs:*` tem um risco declarado AQUI; operação nova sem
// classificação reprova o teste. As destrutivas/remotas provam a guarda (confirmação digitada ou explícita) e que nada mudou.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarVcsSvn } from "../nucleo/vcs";
import { criarRepoGit, criarTmp, git, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import { falso } from "../../tests/fixtures/vcs/svn-util";
import { OPS_VCS } from "./ipc/vcs";
import { criarVcsMain, type VcsMain } from "./vcs";

type Risco = "leitura" | "escrita-local" | "destrutiva" | "rede-leitura" | "rede-escrita" | "rede-destrutiva";

const T = (r: Risco): Risco => r;
/** canal.op -> risco. `destrutiva`/`rede-destrutiva` exigem confirmação (testada abaixo); `rede-*` só acontece por clique do usuário. */
const RISCO: Record<string, Risco> = {
  "vcs:estagio.estagiar": T("escrita-local"), "vcs:estagio.desestagiar": T("escrita-local"), "vcs:estagio.hunk": T("escrita-local"), "vcs:estagio.ignorar": T("escrita-local"),
  "vcs:estagio.descartar": T("destrutiva"), "vcs:estagio.desfazer_descarte": T("escrita-local"), "vcs:estagio.descartes_listar": T("leitura"),
  "vcs:commit.criar": T("escrita-local"), "vcs:commit.modelo": T("leitura"), "vcs:commit.ultimo_publicado": T("leitura"),
  "vcs:ramos.listar": T("leitura"), "vcs:ramos.criar": T("escrita-local"), "vcs:ramos.trocar": T("escrita-local"), "vcs:ramos.renomear": T("escrita-local"),
  "vcs:ramos.apagar": T("destrutiva"), "vcs:ramos.upstream_definir": T("escrita-local"), "vcs:ramos.upstream_remover": T("escrita-local"), "vcs:ramos.padrao": T("leitura"),
  "vcs:ramos.tags_listar": T("leitura"), "vcs:ramos.tag_criar": T("escrita-local"), "vcs:ramos.tag_apagar": T("escrita-local"), "vcs:ramos.worktrees_listar": T("leitura"),
  "vcs:stash.listar": T("leitura"), "vcs:stash.criar": T("escrita-local"), "vcs:stash.aplicar": T("escrita-local"), "vcs:stash.pop": T("escrita-local"),
  "vcs:stash.apagar": T("escrita-local"), "vcs:stash.restaurar_apagado": T("escrita-local"), "vcs:stash.diff": T("leitura"),
  "vcs:historico.log": T("leitura"), "vcs:historico.arquivo": T("leitura"), "vcs:historico.detalhe": T("leitura"), "vcs:historico.blame": T("leitura"),
  "vcs:historico.reflog": T("leitura"), "vcs:historico.desfazer_ultima": T("escrita-local"),
  "vcs:remoto.listar": T("leitura"), "vcs:remoto.fetch": T("rede-leitura"), "vcs:remoto.pull": T("rede-escrita"), "vcs:remoto.push": T("rede-escrita"),
  "vcs:remoto.lease": T("rede-destrutiva"), "vcs:remoto.preferencia_pull": T("leitura"),
  "vcs:operacao.estado": T("leitura"), "vcs:operacao.mesclar": T("escrita-local"), "vcs:operacao.cherry_pick": T("escrita-local"), "vcs:operacao.reverter": T("escrita-local"),
  "vcs:operacao.rebase": T("escrita-local"), "vcs:operacao.rebase_interativo": T("escrita-local"), "vcs:operacao.continuar": T("escrita-local"),
  "vcs:operacao.abortar": T("escrita-local"), "vcs:operacao.pular": T("escrita-local"),
  "vcs:conflitos.listar": T("leitura"), "vcs:conflitos.ler": T("leitura"), "vcs:conflitos.resolver_hunks": T("escrita-local"),
  "vcs:conflitos.resolver_arquivo": T("escrita-local"), "vcs:conflitos.marcar_resolvido": T("escrita-local"),
  "vcs:svn.info": T("leitura"), "vcs:svn.status_servidor": T("rede-leitura"), "vcs:svn.atualizar": T("rede-escrita"), "vcs:svn.commit": T("rede-escrita"),
  "vcs:svn.adicionar": T("escrita-local"), "vcs:svn.remover": T("escrita-local"), "vcs:svn.reverter": T("destrutiva"), "vcs:svn.resolver": T("escrita-local"),
  "vcs:svn.limpar": T("escrita-local"), "vcs:svn.log": T("rede-leitura"), "vcs:svn.blame": T("rede-leitura"), "vcs:svn.conflitos": T("leitura"),
  "vcs:svn.ramos_listar": T("rede-leitura"), "vcs:svn.trocar": T("rede-escrita"), "vcs:svn.mesclar": T("escrita-local"), "vcs:svn.ramo_criar": T("rede-destrutiva"),
  "vcs:svn.auth_verificar": T("rede-leitura"),
  "vcs:forge.estado": T("leitura"), "vcs:forge.prs_listar": T("rede-leitura"), "vcs:forge.pr_ver": T("rede-leitura"), "vcs:forge.pr_criar": T("rede-escrita"),
  "vcs:forge.checks_do_pr": T("rede-leitura"), "vcs:forge.issues_listar": T("rede-leitura"),
  "vcs:missao.resumo": T("leitura"), "vcs:missao.commits": T("leitura"), "vcs:missao.diff_base": T("leitura"), "vcs:missao.comparar": T("leitura"),
};

const todas = Object.entries(OPS_VCS).flatMap(([canal, ops]) => (ops as readonly string[]).map((o) => `${canal}.${o}`));

const abertos: VcsMain[] = [];
afterEach(async () => {
  while (abertos.length) await abertos.pop()?.encerrar();
  limpar();
});
const WS = "ws_01J8ZXAMPLE0000000000000A1";
function montar(raiz?: string, abrir?: Parameters<typeof criarVcsMain>[0]["abrir"]) {
  const base = raiz === undefined ? criarRepoGit() : { raiz };
  const { banco } = novoBanco();
  const lixeira: string[] = [];
  const vcs = criarVcsMain({
    workspaces: { obter: (id) => (id === WS ? { id: WS, raiz: base.raiz } : undefined) },
    missoes: { obter: () => undefined },
    banco,
    emitir: () => undefined,
    janelaEmFoco: () => false,
    moverParaLixeira: async (p) => void lixeira.push(p),
    pastaSeguranca: criarTmp("seg-risco-"),
    ...(abrir ? { abrir } : {}),
  });
  abertos.push(vcs);
  const f = (canal: Parameters<VcsMain["familia"]>[0], op: string, args: Record<string, unknown> = {}) => vcs.familia(canal, { workspace_id: WS, mission_id: null, op, ...args });
  const eventos = () => banco.consultar<{ tipo: string }>("SELECT tipo FROM evento_dominio").map((e) => e.tipo);
  return { vcs, raiz: base.raiz, f, lixeira, eventos };
}

describe("tabela de risco (T-06.37)", () => {
  it("classifica TODAS as operações dos canais vcs:* (nenhuma sobra, nenhuma falta)", () => {
    expect(todas.filter((o) => RISCO[o] === undefined)).toEqual([]);
    expect(Object.keys(RISCO).filter((o) => !todas.includes(o))).toEqual([]);
  });

  it("cada risco tem a regra declarada: só `destrutiva`/`rede-destrutiva` exigem confirmação, e são exatamente as da lista", () => {
    const destrutivas = Object.entries(RISCO).filter(([, r]) => r === "destrutiva" || r === "rede-destrutiva").map(([o]) => o).sort();
    expect(destrutivas).toEqual(["vcs:estagio.descartar", "vcs:ramos.apagar", "vcs:remoto.lease", "vcs:svn.ramo_criar", "vcs:svn.reverter"]);
  });

  it("descartar: sem confirmar é recusado e o arquivo continua como estava (a simulação não exige)", async () => {
    const m = montar();
    writeFileSync(join(m.raiz, "README.md"), "editado\n");
    await expect(m.f("vcs:estagio", "descartar", { caminhos: ["README.md"], incluir_staged: false, simular: false, confirmar: false })).rejects.toThrow(/confirme/);
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("editado\n");
    await expect(m.f("vcs:estagio", "descartar", { caminhos: ["README.md"], incluir_staged: false, simular: true, confirmar: false })).resolves.toBeTruthy();
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("editado\n");
    expect(m.eventos()).not.toContain("vcs.descartar"); // nada foi escrito, nada foi auditado como escrita
  });

  it("apagar branch à força: exige digitar o nome EXATO; nome errado ou vazio não apaga", async () => {
    const m = montar();
    git(m.raiz, "switch", "-q", "-c", "feature/x");
    writeFileSync(join(m.raiz, "x.txt"), "x\n");
    git(m.raiz, "add", ".");
    git(m.raiz, "commit", "-q", "-m", "x");
    git(m.raiz, "switch", "-q", "main");
    for (const confirmacao of [null, "feature/y", "FEATURE/X", "feature"]) {
      await expect(m.f("vcs:ramos", "apagar", { nome: "feature/x", forcar: true, simular: false, confirmacao })).rejects.toThrow(/digitar o nome/);
    }
    expect(git(m.raiz, "branch", "--list", "feature/x").trim()).toBe("feature/x");
    await m.f("vcs:ramos", "apagar", { nome: "feature/x", forcar: true, simular: false, confirmacao: "feature/x" });
    expect(git(m.raiz, "branch", "--list", "feature/x").trim()).toBe("");
  });

  it("lease (push forçado): nunca na branch padrão; fora dela exige o nome digitado; nada é enviado sem isso", async () => {
    const m = montar();
    const bare = join(criarTmp("bare-risco-"), "o.git");
    git(m.raiz, "init", "-q", "--bare", "-b", "main", bare);
    git(m.raiz, "remote", "add", "origin", `file://${bare}`);
    await m.f("vcs:remoto", "push", { remoto: null, ramo: "main" });
    const hash = git(m.raiz, "rev-parse", "HEAD").trim();
    await expect(m.f("vcs:remoto", "lease", { remoto: null, ramo: "main", ref_esperada: hash, confirmacao: "main", simular: false })).rejects.toThrow(/branch padrão/);
    git(m.raiz, "switch", "-q", "-c", "feature/z");
    await m.f("vcs:remoto", "push", { remoto: null, ramo: "feature/z" });
    for (const confirmacao of [null, "main", "feature/zz"]) {
      await expect(m.f("vcs:remoto", "lease", { remoto: null, ramo: "feature/z", ref_esperada: hash, confirmacao, simular: false })).rejects.toThrow(/digit/i);
    }
    expect(m.eventos().filter((t) => t === "vcs.remoto")).toHaveLength(2); // só os dois pushes comuns: a recusa acontece antes de qualquer escrita
  });

  it("svn: reverter exige confirmar e criar ramo no servidor exige confirmado_servidor (ambos recusados sem tocar no servidor)", async () => {
    const f = falso();
    const raiz = criarTmp("svn-risco-");
    const m = montar(raiz, async (dir) => criarVcsSvn(dir, { executavel: f.executavel, env: f.env }));
    await expect(m.f("vcs:svn", "reverter", { caminhos: ["a.txt"], confirmar: false })).rejects.toThrow(/confirme/);
    await expect(m.f("vcs:svn", "ramo_criar", { tipo: "branch", nome: "x", mensagem: null, confirmado_servidor: false })).rejects.toThrow(/servidor/);
    expect(existsSync(f.log) ? readFileSync(f.log, "utf8") : "").not.toMatch(/\bcopy\b|\brevert\b/);
  });
});
