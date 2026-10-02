import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { CANAIS_VCS, OPS_VCS, VALIDADORES_VCS } from "./vcs";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const MIS = "mis_01J8ZXAMPLE0000000000000A1";
const alvo = { workspace_id: WS, mission_id: null };

describe("contrato vcs:*", () => {
  it("todo canal vcs:* do contrato tem validador e nenhum validador é órfão", () => {
    const doContrato = CANAIS_INVOKE.filter((c) => c.startsWith("vcs:") && !c.startsWith("vcs:publicar_")).sort();
    expect(Object.keys(VALIDADORES_VCS).sort()).toEqual(doContrato);
    expect(doContrato).toHaveLength(14);
    expect([...CANAIS_VCS].sort()).toEqual(doContrato);
  });

  it("as ops de cada família têm validador próprio", () => {
    for (const [canal, ops] of Object.entries(OPS_VCS)) expect(ops.length, canal).toBeGreaterThan(0);
    expect(OPS_VCS["vcs:ramos"]).toContain("apagar");
    expect(OPS_VCS["vcs:remoto"]).toContain("lease");
  });
});

describe("validadores estritos", () => {
  const v = VALIDADORES_VCS;
  it("aceita payload válido", () => {
    expect(v["vcs:estado"]({ ...alvo, ignorados: false }).ok).toBe(true);
    expect(v["vcs:estagio"]({ ...alvo, op: "estagiar", caminhos: ["src/a.ts"] }).ok).toBe(true);
    expect(v["vcs:missao"]({ mission_id: MIS, op: "commits" }).ok).toBe(true);
    expect(v["vcs:ramos"]({ workspace_id: WS, mission_id: MIS, op: "listar", remotos: true }).ok).toBe(true);
  });
  it("recusa campo desconhecido, ausente e op inexistente", () => {
    expect(v["vcs:estado"]({ ...alvo, ignorados: false, cwd: "/tmp" }).ok).toBe(false);
    expect(v["vcs:estado"]({ ...alvo }).ok).toBe(false);
    expect(v["vcs:estagio"]({ ...alvo, op: "formatar", caminhos: [] }).ok).toBe(false);
    expect(v["vcs:estagio"]({ ...alvo, caminhos: [] }).ok).toBe(false);
    expect(v["vcs:estagio"]({ ...alvo, op: "estagiar", caminhos: ["a"], extra: 1 }).ok).toBe(false);
  });
  it("recusa caminho absoluto, com .., NUL, unidade, hífen inicial e longo demais (AUD-23)", () => {
    for (const c of ["/etc/passwd", "../x", "a/../../x", "a\0b", "C:\\x", "C:/x", "-rf", "", "a".repeat(4097)]) {
      expect(v["vcs:estagio"]({ ...alvo, op: "estagiar", caminhos: [c] }).ok, c).toBe(false);
    }
  });
  it("recusa nome de ref/rev perigoso e id de outro tipo", () => {
    for (const n of ["--upload-pack=x", "a b", "a;b", "a..b", "x@{1}", "$(x)"]) {
      expect(v["vcs:ramos"]({ ...alvo, op: "criar", nome: n, de: null, trocar: false }).ok, n).toBe(false);
    }
    expect(v["vcs:estado"]({ workspace_id: MIS, mission_id: null, ignorados: false }).ok).toBe(false);
    expect(v["vcs:missao"]({ mission_id: WS, op: "commits" }).ok).toBe(false);
  });
  it("lista de caminhos tem teto e inteiros têm faixa", () => {
    expect(v["vcs:estagio"]({ ...alvo, op: "estagiar", caminhos: Array.from({ length: 20_001 }, (_, i) => `a${i}`) }).ok).toBe(false);
    expect(v["vcs:stash"]({ ...alvo, op: "pop", indice: -1, restaurar_indice: false }).ok).toBe(false);
    expect(v["vcs:historico"]({ ...alvo, op: "log", limite: 99999, cursor: null, rev: null, todos: false, busca: null, regex: false, autor: null, caminho: null }).ok).toBe(false);
  });
  it("resolucoes de hunk: só valores conhecidos", () => {
    const base = { ...alvo, op: "resolver_hunks", caminho: "a.ts", marcar: true };
    expect(v["vcs:conflitos"]({ ...base, resolucoes: { "0": "nossa", "1": { editar: "x" } } }).ok).toBe(true);
    expect(v["vcs:conflitos"]({ ...base, resolucoes: { "0": "tudo" } }).ok).toBe(false);
    expect(v["vcs:conflitos"]({ ...base, resolucoes: { a: "nossa" } }).ok).toBe(false);
  });
});
