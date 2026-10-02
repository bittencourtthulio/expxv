import { afterEach, describe, expect, it } from "vitest";
import { ESPECIES } from "../../../compartilhado/bichinho";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { MIGRACOES } from "./index";

const abertos: Banco[] = [];
const novo = (): Banco => { const b = abrirBanco(":memory:"); abertos.push(b); return b; };
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-10-01T12:00:00.000Z";
const ws = (b: Banco, id: string): void => void b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [id, id, `/${id}`, TS, TS]);

describe("migration 0021-bichinho-especies", () => {
  it("vem logo depois da 0020, acrescenta colunas e é idempotente", () => {
    const b = novo();
    expect(MIGRACOES.findIndex((m) => m.nome === "0021-bichinho-especies")).toBe(MIGRACOES.findIndex((m) => m.nome === "0020-bichinho") + 1);
    migrar(b);
    const cols = b.consultar<{ name: string }>("SELECT name FROM pragma_table_info('workspace_bichinho')").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["especie_manual", "variante", "tarefas_concluidas", "reatribuido_de"]));
    expect(migrar(b).aplicadas).toEqual([]);
  });

  it("preserva linhas existentes (ordem da primeira atribuição, maturidade, estágio, manual e apelido) e aceita as 100 espécies", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 20) });
    for (const id of ["ws_c", "ws_a", "ws_b"]) ws(b, id);
    const ins = (id: string, esp: string, manual: number, apelido: string | null, mat: number, est: string) =>
      b.executar("INSERT INTO workspace_bichinho (workspace_id,especie,especie_manual,apelido,maturidade_max,estagio,atualizado_em) VALUES (?,?,?,?,?,?,?)", [id, esp, manual, apelido, mat, est, TS]);
    ins("ws_c", "raposa", 0, null, 12, "filhote");
    ins("ws_a", "raposa", 1, "Rex", 55, "adulto");
    ins("ws_b", "gato", 0, null, 0, "ovo");
    expect(migrar(b).aplicadas).toEqual(["0021-bichinho-especies"]);
    const linhas = b.consultar<{ workspace_id: string; especie_manual: number; maturidade_max: number; estagio: string; apelido: string | null; variante: number; tarefas_concluidas: number; reatribuido_de: string | null }>("SELECT * FROM workspace_bichinho ORDER BY rowid");
    expect(linhas.map((l) => l.workspace_id)).toEqual(["ws_c", "ws_a", "ws_b"]);
    expect(linhas[1]).toMatchObject({ especie_manual: 1, apelido: "Rex", maturidade_max: 55, estagio: "adulto", variante: 0, tarefas_concluidas: 0, reatribuido_de: null });
    expect(versaoAtual(b)).toBe(MIGRACOES.length);
    // as 100 cabem; o resto continua recusado
    b.executar("DELETE FROM workspace_bichinho");
    for (let i = 0; i < ESPECIES.length; i++) { ws(b, `w${i}`); b.executar("INSERT INTO workspace_bichinho (workspace_id,especie,atualizado_em) VALUES (?,?,?)", [`w${i}`, ESPECIES[i]!, TS]); }
    expect(b.consultar("SELECT 1 FROM workspace_bichinho")).toHaveLength(100);
    expect(() => b.executar("INSERT INTO workspace_bichinho (workspace_id,especie,atualizado_em) VALUES ('ws_a','dragao',?)", [TS])).toThrow();
  });

  it("recusa variante fora de 0 a 3 e remove a linha junto com o workspace", () => {
    const b = novo();
    migrar(b);
    ws(b, "ws_a");
    expect(() => b.executar("INSERT INTO workspace_bichinho (workspace_id,especie,variante,atualizado_em) VALUES ('ws_a','gato',4,?)", [TS])).toThrow();
    b.executar("INSERT INTO workspace_bichinho (workspace_id,especie,variante,atualizado_em) VALUES ('ws_a','gato',3,?)", [TS]);
    b.executar("DELETE FROM workspace WHERE id = 'ws_a'");
    expect(b.consultar("SELECT 1 FROM workspace_bichinho")).toHaveLength(0);
  });
});
