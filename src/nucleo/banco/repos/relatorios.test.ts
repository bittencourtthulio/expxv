// Migration 0014-relatorios e repositório SQLite: contrato igual ao da memória, CASCADE por workspace, UNIQUE de versão, CHECKs, e o serviço inteiro sobre SQLite.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portasFalsas, SPRINT_ID, T0, WS } from "../../../../tests/fixtures/relatorios/gerar";
import { criarRepoMemoria, type RegistroPacote, type RepoRelatorios } from "../../relatorios/repos";
import { criarRelatorios } from "../../relatorios/servico";
import { abrirBanco, type Banco } from "../banco";
import { migrar } from "../migrar";
import { MIGRACOES } from "../migracoes";
import { criarRepoRelatoriosSqlite } from "./relatorios";

const abertos: Banco[] = [];
let raiz: string;
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), "rel-sql-")); });
afterEach(async () => { abertos.splice(0).forEach((b) => b.fechar()); await rm(raiz, { recursive: true, force: true }); });

function novoBanco(workspaces: string[] = [WS, "ws_outro00000000"]): Banco {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  for (const w of workspaces) b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [w, w, `/r/${w}`, "t", "t"]);
  return b;
}
const reg = (extra: Partial<RegistroPacote> = {}): RegistroPacote => ({
  id: "rel_1", workspace_id: WS, sprint_id: "spr_a", titulo: "S — r1", versao: 1, versao_lancamento: "1.0.0", hash_fatos: "h".repeat(64), hash_geracao: "g".repeat(64), modo_redacao: "template", modo_bloco: { u_em_resumo: "template" },
  estado: "pronto", etapa: null, revisao_usuario: "rascunho", aprovado_em: null, pasta_ref: ".expxv/relatorios/spr_a/r1", bytes: 10, avisos: ["a"], metricas: { pontos_entregues: 8, meta_atingida: false, lead: null },
  verificacao: { ok: true, afirmacoes_total: 1, com_fonte: 1, violacoes: [] }, motivo_falha: null, gerado_em: "2026-03-14T12:00:00.000Z", ...extra,
});

describe("migration 0014-relatorios", () => {
  it("é a versão 14, cria as tabelas e índices, e aplica sobre o banco das fases anteriores", () => {
    expect(MIGRACOES[13]?.nome).toBe("0014-relatorios");
    const b = novoBanco();
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["relatorio_config", "relatorio_pacote", "relatorio_arquivo", "relatorio_ajuste", "relatorio_exportacao", "relatorio_divulgacao"]));
    const i = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((x) => x.name);
    expect(i).toEqual(expect.arrayContaining(["ix_relatorio_pacote_ws", "ix_relatorio_pacote_hash", "ix_relatorio_divulgacao_pacote"]));
    expect(t).toEqual(expect.arrayContaining(["agil_sprint", "workspace"]));
  });
  it("UNIQUE de versão por (workspace, sprint), CHECK de estado/modo/variante e tamanho do texto de ajuste", () => {
    const b = novoBanco();
    const repo = criarRepoRelatoriosSqlite(b);
    repo.pacoteInserir(reg());
    expect(() => repo.pacoteInserir(reg({ id: "rel_2" }))).toThrow();
    expect(() => repo.pacoteInserir(reg({ id: "rel_3", versao: 2, estado: "invalido" as never }))).toThrow();
    expect(() => repo.pacoteInserir(reg({ id: "rel_4", versao: 3, modo_redacao: "x" as never }))).toThrow();
    expect(() => repo.ajusteGravar(WS, "spr_a", "u_em_resumo", "x".repeat(20001), "t")).toThrow();
    expect(() => repo.envioInserir({ id: "env_1", pacote_id: "rel_1", workspace_id: WS, canal: "telegram", variante: "gigante" as never, texto: "x", estado: "rascunho", criado_em: "t", enviado_em: null, erro: null })).toThrow();
  });
  it("CASCADE por workspace: apagar o workspace apaga pacotes, arquivos, ajustes, config, exportações e fila", () => {
    const b = novoBanco();
    const repo = criarRepoRelatoriosSqlite(b);
    repo.pacoteInserir(reg());
    repo.arquivosSubstituir("rel_1", [{ nome: "a.md", formato: "md", publico: "interno", sha256: "s", bytes: 1, revisao: "na" }]);
    repo.ajusteGravar(WS, "spr_a", "u_em_resumo", "t", "t");
    repo.configGravar(WS, { gerar_ao_fechar: true, redacao_modo: "template", consentimento_llm_em: null, csv_bom: true, consentimento_canais: {}, hashtags: [], cta: null }, "t");
    repo.exportacaoInserir({ id: "exp_1", pacote_id: "rel_1", modo: "zip", destino: "/x", arquivos: ["a.md"], bytes: 1, em: "t" });
    repo.envioInserir({ id: "env_1", pacote_id: "rel_1", workspace_id: WS, canal: "telegram", variante: "curta", texto: "x", estado: "rascunho", criado_em: "t", enviado_em: null, erro: null });
    b.executar("DELETE FROM workspace WHERE id = ?", [WS]);
    for (const t of ["relatorio_pacote", "relatorio_arquivo", "relatorio_ajuste", "relatorio_config", "relatorio_exportacao", "relatorio_divulgacao"]) expect(b.consultarUm(`SELECT COUNT(*) AS n FROM ${t}`)?.["n"], t).toBe(0);
  });
  it("consulta quente (listar por workspace) usa índice e é rápida", () => {
    const b = novoBanco();
    const repo = criarRepoRelatoriosSqlite(b);
    b.transacao((x) => { for (let i = 1; i <= 500; i++) { const v = reg({ id: `rel_${i}`, sprint_id: `spr_${i % 50}`, versao: Math.floor(i / 50) + 1 }); x.executar("INSERT INTO relatorio_pacote (id, workspace_id, sprint_id, titulo, versao, versao_lancamento, hash_fatos, hash_geracao, modo_redacao, estado, pasta_ref, gerado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [v.id, WS, v.sprint_id, "t", v.versao, null, "h", "g", "template", "pronto", "p", `2026-03-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`]); } });
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) repo.pacotesListar(WS);
    expect((performance.now() - t0) / 20).toBeLessThan(5 * 4);
    const plano = b.consultar<{ detail: string }>("EXPLAIN QUERY PLAN SELECT * FROM relatorio_pacote WHERE workspace_id = ? ORDER BY gerado_em DESC", [WS]).map((x) => x.detail).join(" ");
    expect(plano).toMatch(/ix_relatorio_pacote_ws|sqlite_autoindex/);
  });
});

function contrato(nome: string, novo: () => RepoRelatorios): void {
  describe(`contrato do repositório: ${nome}`, () => {
    it("pacotes: inserir, atualizar, obter, listar com filtro, última versão e busca por geração (só prontos)", () => {
      const r = novo();
      r.pacoteInserir(reg());
      r.pacoteInserir(reg({ id: "rel_2", versao: 2, hash_geracao: "x".repeat(64), estado: "falhou", gerado_em: "2026-03-15T12:00:00.000Z" }));
      r.pacoteInserir(reg({ id: "rel_3", sprint_id: "spr_b", gerado_em: "2026-03-16T12:00:00.000Z" }));
      expect(r.pacoteObter("rel_1")).toEqual(reg());
      expect(r.ultimaVersao(WS, "spr_a")).toBe(2);
      expect(r.ultimaVersao(WS, "spr_zzz")).toBe(0);
      expect(r.pacotesListar(WS).map((p) => p.id)).toEqual(["rel_3", "rel_2", "rel_1"]);
      expect(r.pacotesListar(WS, { sprint_id: "spr_a" }).map((p) => p.id)).toEqual(["rel_2", "rel_1"]);
      expect(r.pacotesListar(WS, { estado: "falhou" }).map((p) => p.id)).toEqual(["rel_2"]);
      expect(r.pacotesListar("ws_outro00000000")).toEqual([]);
      expect(r.pacotePorGeracao(WS, "spr_a", "g".repeat(64))?.id).toBe("rel_1");
      expect(r.pacotePorGeracao(WS, "spr_a", "x".repeat(64))).toBeUndefined();
      r.pacoteAtualizar("rel_1", { estado: "obsoleto", revisao_usuario: "aprovado", aprovado_em: "2026-03-20T00:00:00.000Z", avisos: [] });
      expect(r.pacoteObter("rel_1")).toMatchObject({ estado: "obsoleto", revisao_usuario: "aprovado", aprovado_em: "2026-03-20T00:00:00.000Z", avisos: [] });
      expect(r.pacotePorGeracao(WS, "spr_a", "g".repeat(64))).toBeUndefined();
    });
    it("arquivos: substituir é tudo-ou-nada e ordenado por nome", () => {
      const r = novo();
      r.pacoteInserir(reg());
      r.arquivosSubstituir("rel_1", [{ nome: "b.md", formato: "md", publico: "cliente", sha256: "2", bytes: 2, revisao: "rascunho" }, { nome: "a.csv", formato: "csv", publico: "interno", sha256: "1", bytes: 1, revisao: "na" }]);
      expect(r.arquivosListar("rel_1").map((a) => a.nome)).toEqual(["a.csv", "b.md"]);
      r.arquivosSubstituir("rel_1", [{ nome: "c.md", formato: "md", publico: "cliente", sha256: "3", bytes: 3, revisao: "aprovado" }]);
      expect(r.arquivosListar("rel_1")).toEqual([{ nome: "c.md", formato: "md", publico: "cliente", sha256: "3", bytes: 3, revisao: "aprovado" }]);
    });
    it("ajustes humanos por workspace e sprint (upsert e remoção)", () => {
      const r = novo();
      r.ajusteGravar(WS, "spr_a", "u_em_resumo", "um", "t");
      r.ajusteGravar(WS, "spr_a", "u_em_resumo", "dois", "t");
      r.ajusteGravar(WS, "spr_a", "u_novidades", "tres", "t");
      r.ajusteGravar("ws_outro00000000", "spr_a", "u_em_resumo", "outro", "t");
      expect([...r.ajustesListar(WS, "spr_a")].sort()).toEqual([["u_em_resumo", "dois"], ["u_novidades", "tres"]]);
      r.ajusteApagar(WS, "spr_a", "u_em_resumo");
      expect([...r.ajustesListar(WS, "spr_a")]).toEqual([["u_novidades", "tres"]]);
    });
    it("fila de divulgação: inserir, atualizar, obter e listar", () => {
      const r = novo();
      r.pacoteInserir(reg());
      r.envioInserir({ id: "env_1", pacote_id: "rel_1", workspace_id: WS, canal: "telegram", variante: "curta", texto: "t", estado: "rascunho", criado_em: "2026-03-14T12:00:00.000Z", enviado_em: null, erro: null });
      r.envioAtualizar("env_1", { estado: "enviado", enviado_em: "2026-03-14T13:00:00.000Z" });
      expect(r.envioObter("env_1")).toMatchObject({ estado: "enviado", enviado_em: "2026-03-14T13:00:00.000Z" });
      expect(r.enviosListar("rel_1")).toHaveLength(1);
      expect(r.envioObter("nao")).toBeUndefined();
    });
    it("config por workspace (round-trip)", () => {
      const r = novo();
      const c = { gerar_ao_fechar: false, redacao_modo: "llm" as const, consentimento_llm_em: "2026-03-14T12:00:00.000Z", csv_bom: false, consentimento_canais: { telegram: { aceito_em: "t", versao_texto: "v" } }, hashtags: ["a"], cta: "oi" };
      r.configGravar(WS, c, "t");
      expect(r.configObter(WS)).toEqual(c);
      expect(r.configObter("ws_outro00000000")).toBeUndefined();
    });
  });
}
contrato("memória", () => criarRepoMemoria());
contrato("SQLite", () => criarRepoRelatoriosSqlite(novoBanco()));

describe("serviço sobre SQLite", () => {
  it("fechar sprint -> pacote -> ajuste -> r2 -> aprovar, com tudo persistido", async () => {
    const banco = novoBanco();
    const repo = criarRepoRelatoriosSqlite(banco);
    const r = criarRelatorios({ repo, portas: portasFalsas({ workspace: { raiz: () => raiz } }), relogio: () => T0 });
    const a = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    r.ajusteGravar(WS, SPRINT_ID, "u_em_resumo", "Resumo da equipe.");
    const b = await r.regenerar(WS, a.pacote_id);
    expect(b.pacote_id).not.toBe(a.pacote_id);
    await r.aprovar(WS, b.pacote_id, true);
    const r2 = criarRelatorios({ repo: criarRepoRelatoriosSqlite(banco), portas: portasFalsas({ workspace: { raiz: () => raiz } }), relogio: () => T0 });
    expect(r2.listar(WS).map((p) => [p.versao, p.revisao_usuario])).toEqual([[2, "aprovado"], [1, "rascunho"]]);
    expect((await r2.previa(WS, b.pacote_id, "usuario.md")).conteudo).toContain("Resumo da equipe.");
    expect(banco.consultarUm("SELECT COUNT(*) AS n FROM relatorio_arquivo")?.["n"]).toBeGreaterThan(20);
  });
});
