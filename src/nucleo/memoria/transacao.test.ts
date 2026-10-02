// T-08.09 / AC-08.07: fechar o Pane grava o evento de memória NA MESMA transação do `UPDATE pane`.
import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { criarRepoPane } from "../banco/repos/pane";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace } from "../../../tests/fixtures/memoria/banco";
import { criarAoEncerrar } from "./fechamento";

const abertos: Banco[] = [];
function cenario(modo: "agentico" | "livre" = "agentico") {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  const mis = modo === "livre" ? null : semearMissao(b, "mis_1", ws, "agentico");
  semearPane(b, { id: "pane_1", ws, mission: mis, papel: modo === "livre" ? "nenhum" : "piloto", display: 7 });
  return { b, repo: criarRepoPane(b) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

const eventos = (b: Banco) => b.consultar<{ conteudo: string; tipo: string }>("SELECT conteudo, tipo FROM memoria_entrada WHERE pane_id = 'pane_1'");

describe("gancho aoEncerrar do repositório de Pane", () => {
  it("o evento de fechamento nasce na mesma transação (gancho explícito)", () => {
    const { b, repo } = cenario();
    const gancho = criarAoEncerrar({});
    const p = repo.encerrar("pane_1", "usuario", (tx, pane, motivo) => gancho(tx, pane, motivo ?? undefined));
    expect(p.estado).toBe("encerrado");
    expect(eventos(b)).toEqual([{ conteudo: "Painel #7 encerrado (usuario)", tipo: "evento" }]);
  });

  it("gancho padrão (definirAoEncerrar) vale para todo encerrar; chamada repetida é idempotente e não duplica", () => {
    const { b, repo } = cenario();
    const gancho = criarAoEncerrar({});
    repo.definirAoEncerrar((tx, pane, motivo) => gancho(tx, pane, motivo ?? undefined));
    repo.encerrar("pane_1", "fim");
    repo.encerrar("pane_1", "outro");
    expect(eventos(b)).toHaveLength(1);
  });

  it("AC-08.07: falha no gancho DEPOIS do UPDATE desfaz o fechamento e não deixa memória", () => {
    const { b, repo } = cenario();
    expect(() =>
      repo.encerrar("pane_1", "usuario", () => {
        throw new Error("falha injetada");
      }),
    ).toThrow("falha injetada");
    expect(b.consultarUm<{ estado: string }>("SELECT estado FROM pane WHERE id = 'pane_1'")?.estado).toBe("pronto");
    expect(b.consultarUm<{ piloto_pane_id: string | null }>("SELECT piloto_pane_id FROM mission WHERE id = 'mis_1'")).toBeDefined();
    expect(eventos(b)).toHaveLength(0);
  });

  it("memória desligada (modo off) não grava e o Pane fecha normalmente", () => {
    const { b, repo } = cenario();
    b.executar("UPDATE memoria_config SET ativa = 0");
    b.executar("INSERT OR IGNORE INTO memoria_config (workspace_id, ativa, atualizado_em) VALUES ('ws_1', 0, '2026-10-01T10:00:00.000Z')");
    const gancho = criarAoEncerrar({});
    repo.encerrar("pane_1", "x", (tx, pane, motivo) => gancho(tx, pane, motivo ?? undefined));
    expect(eventos(b)).toHaveLength(0);
    expect(b.consultarUm<{ estado: string }>("SELECT estado FROM pane WHERE id = 'pane_1'")?.estado).toBe("encerrado");
  });

  it("sem gancho o comportamento é o de antes", () => {
    const { b, repo } = cenario("livre");
    expect(repo.encerrar("pane_1", "a").estado).toBe("encerrado");
    expect(eventos(b)).toHaveLength(0);
  });
});
