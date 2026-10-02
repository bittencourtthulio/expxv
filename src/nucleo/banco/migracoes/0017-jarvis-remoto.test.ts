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

describe("migration 0017-jarvis-remoto", () => {
  it("é a versão 17, cria as três tabelas e é idempotente", () => {
    const b = novo();
    expect(MIGRACOES[16]?.nome).toBe("0017-jarvis-remoto");
    const r = migrar(b);
    expect(r.aplicadas).toContain("0017-jarvis-remoto");
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["remoto_dispositivo", "jarvis_auditoria", "jarvis_idempotencia"]));
    expect(migrar(b).aplicadas).toEqual([]);
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });
  it("migra da v16 sem perda", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 16) });
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [TS, TS]);
    expect(migrar(b).de).toBe(16);
    expect(b.consultarUm("SELECT nome FROM workspace WHERE id='ws_1'")).toEqual({ nome: "n" });
  });
  it("CHECKs: permissão, nome, ator e risco inválidos são recusados; sem coluna de segredo de dispositivo", () => {
    const b = novo();
    migrar(b);
    const ins = (perm: string, nome = "iPhone") => b.executar("INSERT INTO remoto_dispositivo (id,nome,chave_publica,permissao,criado_em,expira_em) VALUES (?,?,?,?,?,?)", [`dev_${Math.random()}`, nome, "cHVi", perm, TS, TS]);
    for (const p of ["leitura", "mensagem_confirmada", "mensagem_direta"]) ins(p);
    expect(() => ins("admin")).toThrow();
    expect(() => ins("leitura", "")).toThrow();
    expect(() => ins("leitura", "x".repeat(41))).toThrow();
    const cols = b.consultar<{ name: string }>("PRAGMA table_info(remoto_dispositivo)").map((c) => c.name);
    expect(cols.some((c) => /segredo|token|senha|privad/i.test(c))).toBe(false);
    expect(() => b.executar("INSERT INTO jarvis_auditoria (id,ts,ator,evento,ok) VALUES ('a',?,'hacker','x',1)", [TS])).toThrow();
    expect(() => b.executar("INSERT INTO jarvis_auditoria (id,ts,ator,evento,risco,ok) VALUES ('b',?,'jarvis','x','destrutivo',1)", [TS])).toThrow();
    b.executar("INSERT INTO jarvis_auditoria (id,ts,ator,evento,risco,ok) VALUES ('c',?,'remoto','x','escrita',1)", [TS]);
  });
  it("idempotência: (ator, dispositivo, id) único", () => {
    const b = novo();
    migrar(b);
    const ins = () => b.executar("INSERT INTO jarvis_idempotencia (ator,dispositivo_id,client_request_id,resultado_json,criado_em) VALUES ('remoto','dev_1','req-1','{}',?)", [TS]);
    ins();
    expect(ins).toThrow();
  });
});
