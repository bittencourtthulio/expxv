import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { MIGRACOES, VERSAO_SUPORTADA } from "./index";

const abertos: Banco[] = [];
const novo = (): Banco => { const b = abrirBanco(":memory:"); abertos.push(b); return b; };
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-10-01T12:00:00.000Z";

describe("migration 0020-bichinho", () => {
  it("cria workspace_bichinho com as colunas do contrato, é idempotente e vem depois da 0019", () => {
    const b = novo();
    expect(MIGRACOES.findIndex((m) => m.nome === "0020-bichinho")).toBeGreaterThan(MIGRACOES.findIndex((m) => m.nome === "0019-remoto-relay"));
    expect(migrar(b).aplicadas).toContain("0020-bichinho");
    const cols = b.consultar<{ name: string }>("SELECT name FROM pragma_table_info('workspace_bichinho')").map((c) => c.name);
    // as colunas da 0020 continuam lá, na mesma ordem; a 0021 só acrescenta no fim
    expect(cols.slice(0, 7)).toEqual(["workspace_id", "especie", "especie_manual", "apelido", "maturidade_max", "estagio", "atualizado_em"]);
    expect(migrar(b).aplicadas).toEqual([]);
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });

  it("recusa espécie, estágio e apelido fora do contrato; apaga junto com o workspace", () => {
    const b = novo();
    migrar(b);
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_A','a','/a',?,?)", [TS, TS]);
    const ins = (esp: string, est: string, apelido: string | null, mat = 0) => b.executar("INSERT INTO workspace_bichinho (workspace_id,especie,apelido,maturidade_max,estagio,atualizado_em) VALUES ('ws_A',?,?,?,?,?)", [esp, apelido, mat, est, TS]);
    expect(() => ins("dragao", "ovo", null)).toThrow();
    expect(() => ins("gato", "imortal", null)).toThrow();
    expect(() => ins("gato", "ovo", "x".repeat(25))).toThrow();
    expect(() => ins("gato", "ovo", null, 101)).toThrow();
    ins("gato", "jovem", "Mia", 30);
    b.executar("DELETE FROM workspace WHERE id = 'ws_A'");
    expect(b.consultar("SELECT 1 FROM workspace_bichinho")).toHaveLength(0);
  });
});
