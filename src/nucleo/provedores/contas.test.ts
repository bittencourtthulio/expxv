import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ValorInvalidoErro } from "../dominio";
import { criarTmp, limpar, novoBanco } from "../../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "./contas";

afterEach(limpar);

function montar() {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("dados-");
  return { banco, repos, dados, contas: criarServicoContas({ banco, repos, pastaDeDados: dados }) };
}

describe("contas", () => {
  it.skipIf(process.platform === "win32")("cria o config dir isolado com modo 0700 em <dados>/contas/<id>", () => {
    const { contas, dados } = montar();
    const c = contas.criar("claude", "Pessoal");
    expect(c.config_dir_ref).toBe(`contas/${c.id}`);
    const abs = join(dados, "contas", c.id);
    expect(existsSync(abs)).toBe(true);
    expect(statSync(abs).mode & 0o777).toBe(0o700);
    expect(contas.configDirAbsoluto(c)).toBe(abs);
  });

  it("guarda só a referência (relativa), nunca segredo nem caminho absoluto", () => {
    const { contas, repos } = montar();
    const c = contas.criar("codex", "Trabalho");
    const gravada = repos.conta.exigir(c.id);
    expect(gravada.config_dir_ref).not.toMatch(/^\//);
    expect(JSON.stringify(gravada)).not.toMatch(/token|senha|key/i);
  });

  it("ambiente da conta: CLAUDE_CONFIG_DIR para claude, CODEX_HOME para codex, nada para as demais", () => {
    const { contas, dados } = montar();
    const a = contas.criar("claude", "A");
    const b = contas.criar("codex", "B");
    const c = contas.criar("gemini", "C");
    expect(contas.ambienteDaConta(a)).toEqual({ CLAUDE_CONFIG_DIR: join(dados, "contas", a.id) });
    expect(contas.ambienteDaConta(b)).toEqual({ CODEX_HOME: join(dados, "contas", b.id) });
    expect(contas.ambienteDaConta(c)).toEqual({});
    expect(c.config_dir_ref).toBeNull();
  });

  it("recusa provedor desconhecido e rótulo vazio, longo ou repetido", () => {
    const { contas } = montar();
    expect(() => contas.criar("nada", "x")).toThrow(ValorInvalidoErro);
    expect(() => contas.criar("claude", "   ")).toThrow(ValorInvalidoErro);
    expect(() => contas.criar("claude", "a".repeat(61))).toThrow(ValorInvalidoErro);
    expect(() => contas.criar("claude", "com\nquebra")).toThrow(ValorInvalidoErro);
    contas.criar("claude", "Única");
    expect(() => contas.criar("claude", "única")).toThrow(/já existe/);
    expect(() => contas.criar("codex", "Única")).not.toThrow();
  });

  it("habilita e desabilita; id desconhecido devolve null", () => {
    const { contas } = montar();
    const c = contas.criar("claude", "X");
    expect(contas.habilitar(c.id, false)?.habilitada).toBe(false);
    expect(contas.habilitar(c.id, true)?.habilitada).toBe(true);
    expect(contas.habilitar("conta_inexistente", true)).toBeNull();
  });

  it("uma falha ao criar a pasta não deixa a conta no banco", () => {
    const { banco, repos } = montar();
    const contas = criarServicoContas({ banco, repos, pastaDeDados: "/proc/nao-gravavel/dados" });
    expect(() => contas.criar("claude", "Quebrada")).toThrow();
    expect(repos.conta.listar().itens).toHaveLength(0);
  });

  it("referência com .. nunca vira caminho absoluto fora da pasta de dados", () => {
    const { contas } = montar();
    expect(contas.configDirAbsoluto({ config_dir_ref: "../../etc" } as never)).toBeNull();
    expect(contas.configDirAbsoluto({ config_dir_ref: "/etc" } as never)).toBeNull();
    expect(contas.configDirAbsoluto({ config_dir_ref: null } as never)).toBeNull();
  });
});
