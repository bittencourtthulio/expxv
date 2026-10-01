import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "./banco";
import { migrar } from "./migrar";
import { proximoValor } from "./sequencia";

const abertos: Banco[] = [];
function novo(): Banco {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  return b;
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("sequencia (display_id persistido)", () => {
  it("começa em 1 e incrementa por chave, de forma independente", () => {
    const b = novo();
    expect([proximoValor(b, "pane:a"), proximoValor(b, "pane:a"), proximoValor(b, "pane:b")]).toEqual([1, 2, 1]);
  });

  it("nunca volta depois de apagar as linhas que usavam os números", () => {
    const b = novo();
    const ts = "2026-01-01T00:00:00.000Z";
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [ts, ts]);
    const criarPane = (id: string) =>
      b.transacao((tx) => {
        const d = proximoValor(tx, "pane:ws_1");
        tx.executar(
          "INSERT INTO pane (id,workspace_id,display_id,tipo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)",
          [id, "ws_1", d, "shell", "nenhum", "pronto", ts, ts],
        );
        return d;
      });
    expect([criarPane("pane_1"), criarPane("pane_2"), criarPane("pane_3")]).toEqual([1, 2, 3]);
    b.executar("DELETE FROM pane");
    expect(criarPane("pane_4")).toBe(4);
  });

  it("rollback da transação não consome o número de forma visível para o próximo commit (contador é transacional)", () => {
    const b = novo();
    expect(() =>
      b.transacao((tx) => {
        proximoValor(tx, "x");
        throw new Error("falha");
      }),
    ).toThrow();
    expect(proximoValor(b, "x")).toBe(1);
  });

  it("display_id é único por workspace", () => {
    const b = novo();
    const ts = "2026-01-01T00:00:00.000Z";
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [ts, ts]);
    const ins = (id: string) =>
      b.executar(
        "INSERT INTO pane (id,workspace_id,display_id,tipo,papel,estado,criado_em,atualizado_em) VALUES (?,'ws_1',1,'shell','nenhum','pronto',?,?)",
        [id, ts, ts],
      );
    ins("pane_1");
    expect(() => ins("pane_2")).toThrow(/UNIQUE/i);
  });
});
