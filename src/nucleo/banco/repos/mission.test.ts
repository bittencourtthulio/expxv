import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { NaoEncontradoErro, TransicaoMissaoInvalidaErro, ESTADOS_MISSAO, type EstadoMissao } from "../../dominio";
import { criarRepoMission } from "./mission";
import { criarRepoWorkspace } from "./workspace";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const ws = criarRepoWorkspace(b).criar({ nome: "w", raiz: "/w", e_git: true });
  return { b, ws, repo: criarRepoMission(b) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

const base = { modo: "agentico", origem: "feature", titulo: "Missão" } as const;

describe("repo mission", () => {
  it("cria em intake com id mis_", () => {
    const { repo, ws } = novo();
    const m = repo.criar({ workspace_id: ws.id, ...base, worktree: "../w--x", branch: "feature/x" });
    expect(m.id).toMatch(/^mis_/);
    expect(m).toMatchObject({ estado: "intake", piloto_pane_id: null, concluida_em: null, worktree: "../w--x" });
  });

  it("workspace inexistente é erro nominal", () => {
    const { repo } = novo();
    expect(() => repo.criar({ workspace_id: "ws_nada", ...base })).toThrow(NaoEncontradoErro);
  });

  it("segue o caminho feliz intake→planejando→executando→revisando→concluida e grava concluida_em", () => {
    const { repo, ws } = novo();
    const m = repo.criar({ workspace_id: ws.id, ...base });
    for (const e of ["planejando", "executando", "revisando"] as const) expect(repo.transicionar(m.id, e).estado).toBe(e);
    expect(repo.obter(m.id)?.concluida_em).toBeNull();
    const fim = repo.transicionar(m.id, "concluida");
    expect(fim.estado).toBe("concluida");
    expect(fim.concluida_em).toMatch(/Z$/);
  });

  it("todas as transições fora da tabela são recusadas com erro nominal e nada muda", () => {
    const validas: Record<string, string[]> = {
      intake: ["planejando", "falhou", "abortada"],
      planejando: ["executando", "falhou", "abortada"],
      executando: ["revisando", "falhou", "abortada"],
      revisando: ["concluida", "falhou", "abortada"],
    };
    const { repo, ws, b } = novo();
    for (const de of ESTADOS_MISSAO) {
      for (const para of ESTADOS_MISSAO) {
        const m = repo.criar({ workspace_id: ws.id, ...base });
        b.executar("UPDATE mission SET estado = ? WHERE id = ?", [de, m.id]);
        if (validas[de]?.includes(para)) {
          expect(repo.transicionar(m.id, para as EstadoMissao).estado).toBe(para);
        } else {
          expect(() => repo.transicionar(m.id, para as EstadoMissao)).toThrow(TransicaoMissaoInvalidaErro);
          expect(repo.obter(m.id)?.estado).toBe(de);
        }
      }
    }
  });

  it("abortar mantém worktree e branch registrados", () => {
    const { repo, ws } = novo();
    const m = repo.criar({ workspace_id: ws.id, ...base, worktree: "../w--x", branch: "feature/x" });
    const a = repo.transicionar(m.id, "abortada");
    expect(a).toMatchObject({ worktree: "../w--x", branch: "feature/x", estado: "abortada" });
  });

  it("lista por workspace paginada, mais novas primeiro, com filtro de estado", () => {
    const { repo, ws } = novo();
    const ids = Array.from({ length: 5 }, () => repo.criar({ workspace_id: ws.id, ...base }).id);
    repo.transicionar(ids[0] as string, "planejando");
    const p1 = repo.listarPorWorkspace(ws.id, { limite: 2 });
    expect(p1.itens.map((m) => m.id)).toEqual([ids[4], ids[3]]);
    const p2 = repo.listarPorWorkspace(ws.id, { limite: 2, depois: p1.proximo });
    const p3 = repo.listarPorWorkspace(ws.id, { limite: 2, depois: p2.proximo });
    expect([...p1.itens, ...p2.itens, ...p3.itens].map((m) => m.id)).toEqual([...ids].reverse());
    expect(repo.listarPorWorkspace(ws.id, { estado: "planejando" }).itens.map((m) => m.id)).toEqual([ids[0]]);
  });

  it("definirWorktree grava worktree e branch", () => {
    const { repo, ws } = novo();
    const m = repo.criar({ workspace_id: ws.id, ...base });
    expect(repo.definirWorktree(m.id, { worktree: "../a", branch: "b" })).toMatchObject({ worktree: "../a", branch: "b" });
  });
});
