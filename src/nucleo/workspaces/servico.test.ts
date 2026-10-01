import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NaoEncontradoErro } from "../dominio";
import { criarRepoGit, criarTmp, limpar, novoBanco } from "../../../tests/fixtures/dominio/ambiente";
import { PastaInexistenteErro, PastaInvalidaErro, PastaSemPermissaoErro, criarServicoWorkspaces } from "./servico";

afterEach(limpar);

function montar(escolhida: string | null = null) {
  const { repos } = novoBanco();
  const servico = criarServicoWorkspaces({ repos, escolherPasta: async () => escolhida });
  return { repos, servico };
}

describe("workspaces: abrir", () => {
  it("pasta inexistente vira erro nominal", async () => {
    const { servico } = montar();
    await expect(servico.abrir(join(criarTmp(), "nao-existe"))).rejects.toBeInstanceOf(PastaInexistenteErro);
  });

  it("caminho relativo ou arquivo vira erro nominal", async () => {
    const { servico } = montar();
    const dir = criarTmp();
    writeFileSync(join(dir, "a.txt"), "x");
    await expect(servico.abrir("relativo/pasta")).rejects.toBeInstanceOf(PastaInvalidaErro);
    await expect(servico.abrir(join(dir, "a.txt"))).rejects.toBeInstanceOf(PastaInvalidaErro);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("pasta sem permissão vira erro nominal", async () => {
    const { servico } = montar();
    const dir = criarTmp();
    const fechada = join(dir, "fechada");
    mkdirSync(fechada);
    chmodSync(fechada, 0o000);
    try {
      await expect(servico.abrir(fechada)).rejects.toBeInstanceOf(PastaSemPermissaoErro);
    } finally {
      chmodSync(fechada, 0o755);
    }
  });

  it("abre, detecta git, define como atual e usa padrões seguros", async () => {
    const { servico } = montar();
    const { raiz } = criarRepoGit();
    const simples = criarTmp();
    const ws = await servico.abrir(raiz);
    expect(ws).toMatchObject({ e_git: true, acesso_externo: "nenhum", permissao: "seguro", nome: "repo" });
    expect(ws?.ultimo_uso_em).not.toBeNull();
    expect((await servico.estado()).atual?.id).toBe(ws?.id);
    const outro = await servico.abrir(simples);
    expect(outro?.e_git).toBe(false);
    expect((await servico.estado()).atual?.id).toBe(outro?.id);
  });

  it("abrir de novo a mesma pasta reaproveita o workspace", async () => {
    const { servico } = montar();
    const dir = criarTmp();
    const a = await servico.abrir(dir);
    const b = await servico.abrir(dir);
    expect(b?.id).toBe(a?.id);
    expect((await servico.estado()).recentes).toHaveLength(1);
  });

  it("caminho null usa o diálogo injetado; cancelar devolve null sem mudar nada", async () => {
    const dir = criarTmp();
    const { servico } = montar(dir);
    expect((await servico.abrir(null))?.raiz).toBe(dir);
    const { servico: cancelado } = montar(null);
    expect(await cancelado.abrir(null)).toBeNull();
    expect((await cancelado.estado()).atual).toBeNull();
  });
});

describe("workspaces: recentes, atual, remover", () => {
  it("recentes são limitados a 20, os mais recentes primeiro", async () => {
    const { servico } = montar();
    const base = criarTmp();
    let ultimo = "";
    for (let i = 0; i < 25; i++) {
      const p = join(base, `p${String(i).padStart(2, "0")}`);
      mkdirSync(p);
      const ws = await servico.abrir(p);
      ultimo = ws?.id ?? "";
      await new Promise((r) => setTimeout(r, 2));
    }
    const { recentes, atual } = await servico.estado();
    expect(recentes).toHaveLength(20);
    expect(recentes[0]?.id).toBe(ultimo);
    expect(atual?.id).toBe(ultimo);
  });

  it("definir_atual persiste em config e sobrevive a um serviço novo", async () => {
    const { repos, servico } = montar();
    const a = await servico.abrir(criarTmp());
    await servico.abrir(criarTmp());
    await servico.definirAtual(a?.id as string);
    const outro = criarServicoWorkspaces({ repos, escolherPasta: async () => null });
    expect((await outro.estado()).atual?.id).toBe(a?.id);
    expect(await servico.definirAtual("ws_inexistente")).toBeNull();
  });

  it("remover tira da lista e NUNCA apaga do disco", async () => {
    const { servico } = montar();
    const dir = criarTmp();
    writeFileSync(join(dir, "importante.txt"), "não apague");
    const ws = await servico.abrir(dir);
    expect(await servico.remover(ws?.id as string)).toBe(true);
    expect(existsSync(join(dir, "importante.txt"))).toBe(true);
    const e = await servico.estado();
    expect(e.recentes).toHaveLength(0);
    expect(e.atual).toBeNull();
    expect(await servico.remover(ws?.id as string)).toBe(false);
  });

  it("AUD-11: remover mantém o histórico de Missões; reabrir o mesmo caminho restaura workspace e histórico; apagarHistorico é explícito", async () => {
    const { repos, servico } = montar();
    const dir = criarTmp();
    const ws = (await servico.abrir(dir))!;
    const missao = repos.mission.criar({ workspace_id: ws.id, modo: "livre", origem: "livre", titulo: "histórico importante" });
    expect(await servico.remover(ws.id)).toBe(true);
    expect(servico.obter(ws.id)).toBeUndefined();
    expect(repos.mission.obter(missao.id)?.titulo).toBe("histórico importante"); // sem cascata
    const de_novo = (await servico.abrir(dir))!;
    expect(de_novo.id).toBe(ws.id); // mesmo workspace, não um novo
    expect((await servico.estado()).atual?.id).toBe(ws.id);
    expect(repos.mission.obter(missao.id)?.workspace_id).toBe(ws.id);
    // apagar de verdade só pela ação separada (funciona também com o workspace já removido)
    await servico.remover(ws.id);
    expect(await servico.apagarHistorico(ws.id)).toBe(true);
    expect(repos.mission.obter(missao.id)).toBeUndefined();
    expect(await servico.apagarHistorico(ws.id)).toBe(false);
  });

  it("permissão muda só entre seguro e automático; acesso externo também é configurável", async () => {
    const { servico } = montar();
    const ws = await servico.abrir(criarTmp());
    expect((await servico.definirPermissao(ws?.id as string, "automatico"))?.permissao).toBe("automatico");
    expect(servico.permissaoDe(ws?.id as string)).toBe("automatico");
    expect(servico.permissaoDe("ws_nada")).toBe("seguro");
    expect(servico.permissaoDe(null)).toBe("automatico"); // atual
    expect((await servico.definirAcessoExterno(ws?.id as string, "leitura"))?.acesso_externo).toBe("leitura");
    expect(await servico.definirPermissao("ws_nada", "seguro")).toBeNull();
    await expect(servico.definirPermissao(ws?.id as string, "qualquer" as never)).rejects.toThrow();
  });
});

describe("workspaces: cwd e worktrees", () => {
  it("resolverCwd(id) é a raiz do workspace; nunca aceita caminho", async () => {
    const { servico } = montar();
    const dir = criarTmp();
    const ws = await servico.abrir(dir);
    expect(servico.resolverCwd(ws?.id as string)).toBe(dir);
    expect(() => servico.resolverCwd("ws_inexistente")).toThrow(NaoEncontradoErro);
    expect(() => servico.resolverCwd("/etc")).toThrow(NaoEncontradoErro);
    expect(() => servico.resolverCwd("../..")).toThrow(NaoEncontradoErro);
  });

  it("resolverCwd(null) é o workspace atual; sem atual, o diretório pessoal", async () => {
    const { servico } = montar();
    expect(servico.resolverCwd(null)).toBe(homedir());
    const dir = criarTmp();
    await servico.abrir(dir);
    expect(servico.resolverCwd(null)).toBe(dir);
  });

  it("resolverCwd falha com erro nominal quando a pasta sumiu do disco", async () => {
    const { servico } = montar();
    const base = criarTmp();
    const p = join(base, "some");
    mkdirSync(p);
    const ws = await servico.abrir(p);
    const { rmSync } = await import("node:fs");
    rmSync(p, { recursive: true });
    expect(() => servico.resolverCwd(ws?.id as string)).toThrow(PastaInexistenteErro);
  });

  it("lista worktrees com caminho relativo e principal", async () => {
    const { servico } = montar();
    const { raiz, pai } = criarRepoGit();
    const { git } = await import("../../../tests/fixtures/dominio/ambiente");
    git(raiz, "worktree", "add", "-q", "-b", "feature/x", join(pai, "repo--x"));
    const ws = await servico.abrir(raiz);
    const lista = await servico.worktrees(ws?.id as string);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ caminho: ".", principal: true, branch: "main", sujo: false });
    expect(lista[1]).toMatchObject({ caminho: "../repo--x", principal: false, branch: "feature/x" });
  });

  it("workspace fora de git não tem worktrees; id desconhecido é erro nominal", async () => {
    const { servico } = montar();
    const ws = await servico.abrir(criarTmp());
    expect(await servico.worktrees(ws?.id as string)).toEqual([]);
    await expect(servico.worktrees("ws_nada")).rejects.toBeInstanceOf(NaoEncontradoErro);
  });
});

describe("workspaces: permissão padrão da config", () => {
  it("novos workspaces nascem com a permissão padrão; 'automatico' só se for exatamente esse valor", async () => {
    const { repos } = novoBanco();
    let padrao: string = "automatico";
    const servico = criarServicoWorkspaces({ repos, escolherPasta: async () => null, permissaoPadrao: () => padrao as never });
    const a = await servico.abrir(criarTmp());
    expect(a?.permissao).toBe("automatico");
    padrao = "qualquer";
    const b = await servico.abrir(criarTmp());
    expect(b?.permissao).toBe("seguro");
  });
  it("reabrir um workspace existente não muda a permissão dele", async () => {
    const { repos } = novoBanco();
    let padrao: string = "seguro";
    const servico = criarServicoWorkspaces({ repos, escolherPasta: async () => null, permissaoPadrao: () => padrao as never });
    const dir = criarTmp();
    await servico.abrir(dir);
    padrao = "automatico";
    expect((await servico.abrir(dir))?.permissao).toBe("seguro");
  });
});
