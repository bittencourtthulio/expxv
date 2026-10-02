import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { MIGRACOES, VERSAO_SUPORTADA } from "./index";

const abertos: Banco[] = [];
const novo = (): Banco => {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  return b;
};
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-10-01T12:00:00.000Z";
const indice = MIGRACOES.findIndex((m) => m.nome === "0019-remoto-relay");

describe("migration 0019-remoto-relay (Fase 22)", () => {
  it("existe, cria relay_canal e relay_evento, é idempotente", () => {
    expect(indice).toBeGreaterThan(16);
    const b = novo();
    const r = migrar(b);
    expect(r.aplicadas).toContain("0019-remoto-relay");
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["relay_canal", "relay_evento"]));
    expect(migrar(b).aplicadas).toEqual([]);
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });
  it("não altera remoto_dispositivo (mesmas colunas e dados da Fase 13); transporte vive em relay_canal", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, indice) });
    b.executar("INSERT INTO remoto_dispositivo (id,nome,chave_publica,permissao,criado_em,expira_em) VALUES ('dev_antigo','iPhone','cHVi','leitura',?,?)", [TS, TS]);
    const colunas = b.consultar<{ name: string }>("PRAGMA table_info(remoto_dispositivo)").map((c) => c.name);
    migrar(b);
    expect(b.consultar<{ name: string }>("PRAGMA table_info(remoto_dispositivo)").map((c) => c.name)).toEqual(colunas);
    expect(b.consultarUm("SELECT nome, permissao FROM remoto_dispositivo WHERE id='dev_antigo'")).toEqual({ nome: "iPhone", permissao: "leitura" });
  });
  it("CHECKs rejeitam transporte, tipo de evento e estados inválidos; CASCADE ao esquecer o dispositivo", () => {
    const b = novo();
    migrar(b);
    const disp = (id: string) => b.executar("INSERT INTO remoto_dispositivo (id,nome,chave_publica,permissao,criado_em,expira_em) VALUES (?,?,?,?,?,?)", [id, "n", "cHVi", "leitura", TS, TS]);
    disp("dev_a");
    disp("dev_b");
    b.executar("INSERT INTO relay_canal (dispositivo_id, transporte, epoca_ultima, registrado_em) VALUES ('dev_b', 'ambos', 1, ?)", [TS]);
    expect(() => b.executar("INSERT INTO relay_canal (dispositivo_id, transporte, epoca_ultima, registrado_em) VALUES ('dev_b2', 'satelite', 1, ?)", [TS])).toThrow();
    b.executar("INSERT INTO relay_canal (dispositivo_id, epoca_ultima, registrado_em) VALUES ('dev_a', 20000, ?)", [TS]);
    expect(() => b.executar("INSERT INTO relay_canal (dispositivo_id, epoca_ultima, registrado_em) VALUES ('dev_inexistente', 1, ?)", [TS])).toThrow();
    b.executar("INSERT INTO relay_evento (id, tipo, criado_em) VALUES ('e1','ligado',?)", [TS]);
    expect(() => b.executar("INSERT INTO relay_evento (id, tipo, criado_em) VALUES ('e2','hackeado',?)", [TS])).toThrow();
    b.executar("DELETE FROM remoto_dispositivo WHERE id='dev_a'");
    expect(b.consultar<{ dispositivo_id: string }>("SELECT dispositivo_id FROM relay_canal")).toEqual([{ dispositivo_id: "dev_b" }]);
  });
  it("nenhuma coluna aceita segredo, PSK, canal_id em claro nem texto de mensagem", () => {
    const b = novo();
    migrar(b);
    for (const tabela of ["relay_canal", "relay_evento"]) {
      const cols = b.consultar<{ name: string }>(`PRAGMA table_info(${tabela})`).map((c) => c.name);
      for (const c of cols) expect(c, `${tabela}.${c}`).not.toMatch(/token|senha|psk|segredo|canal_id|texto|mensagem|corpo|chave/i);
    }
  });
  it("consulta quente dos eventos recentes usa índice", () => {
    const b = novo();
    migrar(b);
    const plano = b.consultar<{ detail: string }>("EXPLAIN QUERY PLAN SELECT * FROM relay_evento ORDER BY criado_em DESC LIMIT 50").map((x) => x.detail).join(" ");
    expect(plano).toMatch(/ix_relay_evento_criado/);
  });
});
