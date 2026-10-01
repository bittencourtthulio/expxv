import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { NaoEncontradoErro, PilotoDuplicadoErro } from "../../dominio";
import { criarRepoMission } from "./mission";
import { criarRepoPane } from "./pane";
import { criarRepoWorkspace } from "./workspace";

const abertos: Banco[] = [];
function novo(bancoUsado?: (b: Banco) => Banco) {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const ws = criarRepoWorkspace(b).criar({ nome: "w", raiz: "/w" });
  const m = criarRepoMission(b).criar({ workspace_id: ws.id, modo: "agentico", origem: "livre", titulo: "t" });
  const usado = bancoUsado ? bancoUsado(b) : b;
  return { b, ws, m, missoes: criarRepoMission(b), repo: criarRepoPane(usado) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

/** Banco que falha ao executar SQL que case com o padrão, preservando a transação real. */
function comFalha(real: Banco, padrao: RegExp): Banco {
  const proxy: Banco = {
    executar: (sql, p) => {
      if (padrao.test(sql)) throw new Error("falha injetada");
      return real.executar(sql, p);
    },
    consultar: (sql, p) => real.consultar(sql, p),
    consultarUm: (sql, p) => real.consultarUm(sql, p),
    preparar: (sql) => real.preparar(sql),
    transacao: (fn) => real.transacao(() => fn(proxy)),
    fechar: () => real.fechar(),
  };
  return proxy;
}

describe("repo pane", () => {
  it("cria com id pane_ e display_id sequencial por workspace", () => {
    const { repo, ws } = novo();
    const a = repo.criar({ workspace_id: ws.id, tipo: "shell" });
    const b2 = repo.criar({ workspace_id: ws.id, tipo: "cli", cli: "claude" });
    expect(a.id).toMatch(/^pane_/);
    expect([a.display_id, b2.display_id]).toEqual([1, 2]);
    expect(a).toMatchObject({ estado: "iniciando", papel: "nenhum", eh_piloto: false });
  });

  it("display_id é independente por workspace", () => {
    const { b, repo, ws } = novo();
    const ws2 = criarRepoWorkspace(b).criar({ nome: "x", raiz: "/x" });
    repo.criar({ workspace_id: ws.id, tipo: "shell" });
    expect(repo.criar({ workspace_id: ws2.id, tipo: "shell" }).display_id).toBe(1);
  });

  it("display_id não volta após encerrar nem após apagar o Pane", () => {
    const { b, repo, ws } = novo();
    const p1 = repo.criar({ workspace_id: ws.id, tipo: "shell" });
    const p2 = repo.criar({ workspace_id: ws.id, tipo: "shell" });
    repo.encerrar(p2.id, "fechado pelo usuário");
    expect(repo.criar({ workspace_id: ws.id, tipo: "shell" }).display_id).toBe(3);
    b.executar("DELETE FROM pane WHERE id IN (?, ?)", [p1.id, p2.id]);
    expect(repo.criar({ workspace_id: ws.id, tipo: "shell" }).display_id).toBe(4);
  });

  it("cria o piloto, registra na Missão e recusa um segundo piloto ativo com erro nominal", () => {
    const { repo, ws, m, missoes } = novo();
    const piloto = repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", cli: "claude", papel: "piloto" });
    expect(piloto.eh_piloto).toBe(true);
    expect(missoes.obter(m.id)?.piloto_pane_id).toBe(piloto.id);
    expect(() => repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "piloto" })).toThrow(PilotoDuplicadoErro);
    // o contador não avançou na tentativa que falhou
    expect(repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "executor" }).display_id).toBe(2);
  });

  it("encerrar o piloto libera a vaga e limpa piloto_pane_id na mesma operação", () => {
    const { repo, ws, m, missoes } = novo();
    const p = repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "piloto" });
    const fechado = repo.encerrar(p.id, "sessão morreu");
    expect(fechado).toMatchObject({ estado: "encerrado", encerrado_motivo: "sessão morreu" });
    expect(missoes.obter(m.id)?.piloto_pane_id).toBeNull();
    const novo2 = repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "piloto", respawn_de: p.id });
    expect(novo2).toMatchObject({ respawn_de: p.id, display_id: 2 });
    expect(missoes.obter(m.id)?.piloto_pane_id).toBe(novo2.id);
  });

  it("transação reverte com falha injetada ao atualizar a Missão", () => {
    const { b, repo, ws, m, missoes } = novo((real) => comFalha(real, /UPDATE mission/));
    // piloto criado direto, sem passar pelo proxy
    const pilotoId = criarRepoPane(b).criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "piloto" }).id;
    expect(() => repo.encerrar(pilotoId, "x")).toThrow("falha injetada");
    const p = repo.obter(pilotoId);
    expect(p?.estado).not.toBe("encerrado");
    expect(p?.encerrado_motivo).toBeNull();
    expect(missoes.obter(m.id)?.piloto_pane_id).toBe(pilotoId);
  });

  it("criar também reverte por inteiro (display_id e linha) se a atualização da Missão falha", () => {
    const { repo, ws, m, b } = novo((real) => comFalha(real, /UPDATE mission/));
    expect(() => repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", papel: "piloto" })).toThrow("falha injetada");
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) n FROM pane")?.n).toBe(0);
    expect(b.consultarUm("SELECT valor FROM sequencia WHERE chave = ?", [`pane:${ws.id}`])).toBeUndefined();
  });

  it("encerrar é idempotente e inexistente é erro nominal", () => {
    const { repo, ws } = novo();
    const p = repo.criar({ workspace_id: ws.id, tipo: "shell" });
    repo.encerrar(p.id, "a");
    expect(repo.encerrar(p.id, "b").encerrado_motivo).toBe("a");
    expect(() => repo.encerrar("pane_nada", "x")).toThrow(NaoEncontradoErro);
  });

  it("lista por workspace (ativos) e por Missão, atualiza estado e sessão", () => {
    const { repo, ws, m } = novo();
    const a = repo.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "shell" });
    const c = repo.criar({ workspace_id: ws.id, tipo: "shell" });
    repo.encerrar(c.id, "x");
    expect(repo.listarPorWorkspace(ws.id, { somenteAtivos: true }).itens.map((p) => p.id)).toEqual([a.id]);
    expect(repo.listarPorWorkspace(ws.id).itens).toHaveLength(2);
    expect(repo.listarPorMissao(m.id).map((p) => p.id)).toEqual([a.id]);
    expect(repo.atualizar(a.id, { estado: "trabalhando", sessao_pty_id: "pty1" })).toMatchObject({ estado: "trabalhando", sessao_pty_id: "pty1" });
    const s = repo.registrarSessao(a.id, "conversa-1");
    expect(s.id).toMatch(/^ses_/);
    expect(repo.ultimaSessao(a.id)?.cli_ref_conversa).toBe("conversa-1");
  });

  it("missão de outro workspace é recusada", () => {
    const { b, repo, m } = novo();
    const outro = criarRepoWorkspace(b).criar({ nome: "o", raiz: "/o" });
    expect(() => repo.criar({ workspace_id: outro.id, mission_id: m.id, tipo: "shell" })).toThrow();
  });
});
