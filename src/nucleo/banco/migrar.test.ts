import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco, type Banco } from "./banco";
import { BancoVersaoFuturaErro, migrar, versaoAtual, type Migracao } from "./migrar";
import { MIGRACOES, VERSAO_SUPORTADA } from "./migracoes";

const abertos: Banco[] = [];
const pastas: string[] = [];
function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "expxv-migrar-"));
  pastas.push(p);
  return p;
}
function abrir(caminho: string): Banco {
  const b = abrirBanco(caminho);
  abertos.push(b);
  return b;
}
afterEach(() => {
  for (const b of abertos.splice(0)) b.fechar();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function colunas(b: Banco, tabela: string): string[] {
  return b.consultar<{ name: string }>(`PRAGMA table_info(${tabela})`).map((c) => c.name);
}
function tabelas(b: Banco): string[] {
  return b
    .consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((t) => t.name);
}

const destinos: Array<[string, () => string]> = [
  [":memory:", () => ":memory:"],
  ["arquivo temporário", () => join(pasta(), "m.db")],
];

describe.each(destinos)("migração do zero (%s)", (_n, caminho) => {
  it("cria todas as tabelas do contrato §1 e avança user_version", () => {
    const b = abrir(caminho());
    const r = migrar(b);
    expect(r.de).toBe(0);
    expect(r.para).toBe(VERSAO_SUPORTADA);
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
    // tabelas das fases seguintes (ex.: harness, 0005) têm testes próprios; aqui só o núcleo do contrato §1
    expect(tabelas(b)).toEqual(
      expect.arrayContaining(["config", "conta", "evento_dominio", "handoff", "layout", "mission", "pane", "sequencia", "sessao", "task", "wake_pendente", "workspace"]),
    );
  });

  it("tem as colunas-chave do contrato", () => {
    const b = abrir(caminho());
    migrar(b);
    const comuns = ["id", "criado_em", "atualizado_em"];
    for (const t of ["workspace", "mission", "pane", "sessao", "conta", "task", "handoff", "layout"]) {
      expect(colunas(b, t), t).toEqual(expect.arrayContaining(comuns));
    }
    expect(colunas(b, "workspace")).toEqual(
      expect.arrayContaining(["nome", "raiz", "e_git", "acesso_externo", "permissao", "ultimo_uso_em"]),
    );
    expect(colunas(b, "mission")).toEqual(
      expect.arrayContaining(["workspace_id", "modo", "origem", "trabalho_id", "titulo", "estado", "worktree", "branch", "piloto_pane_id", "concluida_em"]),
    );
    expect(colunas(b, "pane")).toEqual(
      expect.arrayContaining([
        "mission_id", "workspace_id", "display_id", "tipo", "cli", "executavel_id", "conta_id", "modelo", "esforco",
        "papel", "eh_piloto", "estado", "sessao_pty_id", "respawn_de", "cwd", "encerrado_motivo",
      ]),
    );
    expect(colunas(b, "sessao")).toEqual(expect.arrayContaining(["pane_id", "cli_ref_conversa", "ultimo_uso_em"]));
    expect(colunas(b, "conta")).toEqual(expect.arrayContaining(["provedor", "rotulo", "config_dir_ref", "habilitada"]));
    expect(colunas(b, "task")).toEqual(
      expect.arrayContaining(["mission_id", "task_ref", "titulo", "briefing_path", "papel", "estado", "pane_id", "handoff_id"]),
    );
    expect(colunas(b, "handoff")).toEqual(
      expect.arrayContaining(["task_id", "de_pane_id", "para_pane_id", "resumo", "relatorio_path", "status"]),
    );
    expect(colunas(b, "evento_dominio")).toEqual(expect.arrayContaining(["id", "tipo", "payload_json", "criado_em"]));
    expect(colunas(b, "layout")).toEqual(expect.arrayContaining(["workspace_id", "json"]));
    expect(colunas(b, "config")).toEqual(expect.arrayContaining(["chave", "valor_json"]));
    expect(colunas(b, "sequencia")).toEqual(expect.arrayContaining(["chave", "valor"]));
  });

  it("é idempotente: rodar de novo não muda nada", () => {
    const b = abrir(caminho());
    migrar(b);
    const antes = b.consultar("SELECT type, name, sql FROM sqlite_master ORDER BY name");
    const r = migrar(b);
    expect(r.de).toBe(VERSAO_SUPORTADA);
    expect(r.aplicadas).toEqual([]);
    expect(b.consultar("SELECT type, name, sql FROM sqlite_master ORDER BY name")).toEqual(antes);
  });

  it("aplica CHECKs e chaves estrangeiras do contrato", () => {
    const b = abrir(caminho());
    migrar(b);
    const ts = "2026-01-01T00:00:00.000Z";
    expect(() =>
      b.executar(
        "INSERT INTO workspace (id,nome,raiz,e_git,acesso_externo,permissao,criado_em,atualizado_em) VALUES ('ws_1','n','/r',0,'invalido','seguro',?,?)",
        [ts, ts],
      ),
    ).toThrow(/CHECK/i);
    expect(() =>
      b.executar(
        "INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES ('mis_1','ws_inexistente','livre','livre','t','intake',?,?)",
        [ts, ts],
      ),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("handoff.resumo é limitado a 400 caracteres", () => {
    const b = abrir(caminho());
    migrar(b);
    const ts = "2026-01-01T00:00:00.000Z";
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [ts, ts]);
    b.executar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES ('mis_1','ws_1','livre','livre','t','intake',?,?)", [ts, ts]);
    b.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES ('task_1','mis_1','t-1','x','executor','aberta',?,?)", [ts, ts]);
    const ins = (resumo: string) =>
      b.executar("INSERT INTO handoff (id,task_id,resumo,status,criado_em,atualizado_em) VALUES (?,?,?,?,?,?)", [
        `h_${resumo.length}`, "task_1", resumo, "ok", ts, ts,
      ]);
    expect(() => ins("a".repeat(400))).not.toThrow();
    expect(() => ins("a".repeat(401))).toThrow(/CHECK/i);
  });
});

describe("migrar: falhas e versões", () => {
  const boa: Migracao = {
    versao: 1,
    nome: "boa",
    aplicar: (b) => b.executar("CREATE TABLE a (v INTEGER)"),
  };
  const ruim: Migracao = {
    versao: 2,
    nome: "ruim",
    aplicar: (b) => {
      b.executar("CREATE TABLE b (v INTEGER)");
      b.executar("INSERT INTO tabela_que_nao_existe VALUES (1)");
    },
  };

  it("falha no meio faz rollback da migration e user_version não avança", () => {
    const b = abrir(":memory:");
    expect(() => migrar(b, { migracoes: [boa, ruim] })).toThrow(/tabela_que_nao_existe/);
    expect(versaoAtual(b)).toBe(1); // a boa foi commitada, a ruim não
    expect(tabelas(b)).toEqual(["a"]);
  });

  it("falha na primeira deixa o banco intacto na versão 0", () => {
    const b = abrir(":memory:");
    const primeiraRuim: Migracao = { ...ruim, versao: 1 };
    expect(() => migrar(b, { migracoes: [primeiraRuim] })).toThrow();
    expect(versaoAtual(b)).toBe(0);
    expect(tabelas(b)).toEqual([]);
  });

  it("recusa banco de versão maior com BancoVersaoFuturaErro", () => {
    const b = abrir(":memory:");
    b.executar(`PRAGMA user_version = ${VERSAO_SUPORTADA + 5}`);
    let erro: unknown;
    try {
      migrar(b);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(BancoVersaoFuturaErro);
    expect((erro as BancoVersaoFuturaErro).name).toBe("BancoVersaoFuturaErro");
    expect((erro as BancoVersaoFuturaErro).versaoDoBanco).toBe(VERSAO_SUPORTADA + 5);
    expect((erro as BancoVersaoFuturaErro).versaoSuportada).toBe(VERSAO_SUPORTADA);
    expect(tabelas(b)).toEqual([]); // nada foi tocado
  });

  it("rejeita lista de migrações fora de ordem ou com buraco", () => {
    const b = abrir(":memory:");
    expect(() => migrar(b, { migracoes: [{ ...boa, versao: 2 }] })).toThrow(/sequ/i);
  });

  it("exporta as migrações reais em sequência 1..N", () => {
    expect(MIGRACOES.map((m) => m.versao)).toEqual(MIGRACOES.map((_m, i) => i + 1));
    expect(VERSAO_SUPORTADA).toBe(MIGRACOES.length);
  });
});

describe("backup antes de migrar", () => {
  it("banco novo não gera backup", () => {
    const dir = pasta();
    const caminho = join(dir, "n.db");
    const b = abrir(caminho);
    const r = migrar(b, { caminho });
    expect(r.backup).toBeUndefined();
    expect(readdirSync(dir).filter((f) => f.includes(".bak"))).toEqual([]);
  });

  it("banco existente com migração pendente é copiado antes", () => {
    const dir = pasta();
    const caminho = join(dir, "e.db");
    const b = abrir(caminho);
    const m1: Migracao = { versao: 1, nome: "um", aplicar: (x) => x.executar("CREATE TABLE a (v INTEGER)") };
    const m2: Migracao = { versao: 2, nome: "dois", aplicar: (x) => x.executar("CREATE TABLE c (v INTEGER)") };
    migrar(b, { caminho, migracoes: [m1] });
    b.executar("INSERT INTO a VALUES (1)");
    const r = migrar(b, { caminho, migracoes: [m1, m2] });
    expect(r.backup).toBeDefined();
    expect(existsSync(r.backup as string)).toBe(true);
    const copia = abrirBanco(r.backup as string);
    try {
      expect(copia.consultarUm<{ user_version: number }>("PRAGMA user_version")?.user_version).toBe(1);
      expect(copia.consultar("SELECT * FROM a")).toHaveLength(1);
      expect(copia.consultar("SELECT name FROM sqlite_master WHERE name='c'")).toHaveLength(0);
    } finally {
      copia.fechar();
    }
  });

  it("sem migração pendente não gera backup", () => {
    const dir = pasta();
    const caminho = join(dir, "s.db");
    const b = abrir(caminho);
    migrar(b, { caminho });
    const r = migrar(b, { caminho });
    expect(r.backup).toBeUndefined();
  });
});
