import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUTO } from "../produto";
import { EXTENSOES_ANEXO, formatarCaminhoParaPrompt, LIMITES_ANEXOS, prepararAnexos, sanitizarNome } from "./anexos";

let raiz = "";
let fora = "";
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anexos-raiz-"));
  fora = mkdtempSync(join(tmpdir(), "anexos-fora-"));
});
afterEach(() => { rmSync(raiz, { recursive: true, force: true }); rmSync(fora, { recursive: true, force: true }); });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ENTRADAS = join(PRODUTO.pastaNoProjeto, "entradas");

describe("sanitizarNome e formatarCaminhoParaPrompt", () => {
  it("remove diretórios, controle e traversal, e mantém a extensão", () => {
    expect(sanitizarNome("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizarNome("a\nb\u0000c.png")).toBe("a_b_c.png");
    expect(sanitizarNome("..\\..\\logo.svg")).toBe("logo.svg");
    expect(sanitizarNome("...")).toBe("arquivo");
  });
  it("nome longo é truncado em 80 caracteres e mantém a extensão", () => {
    const longo = sanitizarNome(`${"x".repeat(200)}.png`);
    expect(longo.length).toBeLessThanOrEqual(LIMITES_ANEXOS.nome_max);
    expect(longo.endsWith(".png")).toBe(true);
    expect(sanitizarNome("y".repeat(300)).length).toBeLessThanOrEqual(LIMITES_ANEXOS.nome_max);
  });
  it("caminho seguro sai puro; com espaço, aspas ou $ sai entre aspas simples escapadas; controle é recusado", () => {
    expect(formatarCaminhoParaPrompt(`${ENTRADAS}/s/1-a.png`)).toBe(`${ENTRADAS}/s/1-a.png`);
    expect(formatarCaminhoParaPrompt("minha pasta/a.png")).toBe("'minha pasta/a.png'");
    expect(formatarCaminhoParaPrompt("it's.png")).toBe("'it'\\''s.png'");
    expect(formatarCaminhoParaPrompt("$(rm -rf).png")).toBe("'$(rm -rf).png'");
    expect(formatarCaminhoParaPrompt("a;b.png")).toBe("'a;b.png'");
    expect(() => formatarCaminhoParaPrompt("a\nb.png")).toThrow();
  });
  it("allowlist de dev é ampla e nunca inclui chaves, executáveis nem arquivo de ambiente", () => {
    for (const e of [".png", ".pdf", ".ts", ".tsx", ".js", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".css", ".html", ".yml", ".yaml", ".toml", ".sh", ".log", ".patch", ".diff", ".zip", ".csv", ".md", ".json", ".txt"]) {
      expect(EXTENSOES_ANEXO.has(e), e).toBe(true);
    }
    for (const e of [".env", ".exe", ".dmg", ".pem", ".key"]) expect(EXTENSOES_ANEXO.has(e), e).toBe(false);
  });
});

describe("prepararAnexos: bytes colados", () => {
  it("grava em <pasta do produto>/entradas/<sessao>/, cria .gitignore interno com *, devolve relativo e texto sem quebra de linha", async () => {
    const r = await prepararAnexos(raiz, "sessao_abc", [{ nome: "image.png", bytes: PNG }], 1700);
    expect(r.caminhos).toEqual([join(ENTRADAS, "sessao_abc", "1700-image.png")]);
    expect(r.texto).toBe(`${r.caminhos[0]} `);
    expect(r.texto).not.toMatch(/[\r\n]/);
    expect([...readFileSync(join(raiz, r.caminhos[0]!))]).toEqual([...PNG]);
    expect(readFileSync(join(raiz, PRODUTO.pastaNoProjeto, ".gitignore"), "utf8").trim()).toBe("*");
  });
  it("colisão de nome não sobrescreve", async () => {
    const a = await prepararAnexos(raiz, "sessao_abc", [{ nome: "p.png", bytes: PNG }], 5);
    const b = await prepararAnexos(raiz, "sessao_abc", [{ nome: "p.png", bytes: new Uint8Array([1, 2]) }], 5);
    expect(b.caminhos[0]).not.toBe(a.caminhos[0]);
    expect(readFileSync(join(raiz, a.caminhos[0]!)).length).toBe(4);
  });
  it("recusa fora da lista, arquivo de ambiente (todas as formas), vazio, grande demais e itens demais, sem gravar nada", async () => {
    await expect(prepararAnexos(raiz, "sessao_abc", [{ nome: "x.exe", bytes: PNG }])).rejects.toThrow(/Tipo de arquivo/);
    for (const nome of [".env", ".env.local", ".env.production", ".ENV", "pasta/.env.local"]) {
      await expect(prepararAnexos(raiz, "sessao_abc", [{ nome, bytes: PNG }]), nome).rejects.toThrow(/Tipo de arquivo/);
    }
    await expect(prepararAnexos(raiz, "sessao_abc", [{ nome: "a.png", bytes: new Uint8Array(0) }])).rejects.toThrow(/vazio/);
    await expect(prepararAnexos(raiz, "sessao_abc", [{ nome: "a.png", bytes: new Uint8Array(LIMITES_ANEXOS.bytes + 1) }])).rejects.toThrow(/grande demais/);
    await expect(prepararAnexos(raiz, "sessao_abc", Array.from({ length: 11 }, () => ({ nome: "a.png", bytes: PNG })))).rejects.toThrow(/1 a 10/);
    await expect(prepararAnexos(raiz, "sessao_abc", [])).rejects.toThrow();
    expect(existsSync(join(raiz, PRODUTO.pastaNoProjeto))).toBe(false);
  });
  it("aceita código, log e patch", async () => {
    const ok = await prepararAnexos(raiz, "sessao_abc", [{ nome: "erro.log", bytes: PNG }, { nome: "app.tsx", bytes: PNG }, { nome: "a.patch", bytes: PNG }], 1);
    expect(ok.caminhos).toHaveLength(3);
  });
  it("nome hostil não escapa da pasta da sessão e nome longo é truncado no disco", async () => {
    const r = await prepararAnexos(raiz, "sessao_abc", [{ nome: "../../../fora.png", bytes: PNG }], 9);
    expect(r.caminhos[0]).toBe(join(ENTRADAS, "sessao_abc", "9-fora.png"));
    const l = await prepararAnexos(raiz, "sessao_abc", [{ nome: `${"n".repeat(300)}.png`, bytes: PNG }], 9);
    expect(l.caminhos[0]!.split("/").pop()!.length).toBeLessThanOrEqual(LIMITES_ANEXOS.nome_max + 12);
  });
});

describe("prepararAnexos: arquivo arrastado (caminho)", () => {
  it("arquivo dentro da raiz é usado onde está, sem cópia", async () => {
    mkdirSync(join(raiz, "referencias"));
    writeFileSync(join(raiz, "referencias", "logo.png"), PNG);
    const r = await prepararAnexos(raiz, "sessao_abc", [{ caminho: join(raiz, "referencias", "logo.png") }]);
    expect(r.caminhos).toEqual([join("referencias", "logo.png")]);
    expect(existsSync(join(raiz, PRODUTO.pastaNoProjeto))).toBe(false);
  });
  it("arquivo fora da raiz é copiado para entradas/; nome com espaço vai entre aspas", async () => {
    writeFileSync(join(fora, "meu print.png"), PNG);
    const r = await prepararAnexos(raiz, "sessao_abc", [{ caminho: join(fora, "meu print.png") }]);
    expect(r.caminhos[0]).toBe(join(ENTRADAS, "sessao_abc", "meu print.png"));
    expect(r.texto).toBe(`'${r.caminhos[0]}' `);
    expect(readFileSync(join(raiz, r.caminhos[0]!)).length).toBe(4);
  });
  it("recusa pasta, inexistente, relativo, arquivo de ambiente e extensão fora da lista", async () => {
    writeFileSync(join(fora, ".env"), "SEGREDO=1");
    writeFileSync(join(fora, ".env.local"), "SEGREDO=1");
    writeFileSync(join(fora, "a.exe"), "x");
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: fora }])).rejects.toThrow(/regular|pasta/i);
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(fora, "nao.png") }])).rejects.toThrow(/não encontrado/);
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: "relativo.png" }])).rejects.toThrow(/inválido/);
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(fora, ".env") }])).rejects.toThrow(/Tipo de arquivo/);
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(fora, ".env.local") }])).rejects.toThrow(/Tipo de arquivo/);
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(fora, "a.exe") }])).rejects.toThrow(/Tipo de arquivo/);
    expect(existsSync(join(raiz, PRODUTO.pastaNoProjeto))).toBe(false);
  });
  it("arquivo de ambiente dentro da própria raiz também é recusado", async () => {
    writeFileSync(join(raiz, ".env.local"), "X=1");
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(raiz, ".env.local") }])).rejects.toThrow(/Tipo de arquivo/);
  });
  it("symlink dentro da raiz apontando para fora é recusado (arquivo e pasta), inclusive escondendo arquivo de ambiente", async () => {
    writeFileSync(join(fora, "real.png"), PNG);
    symlinkSync(join(fora, "real.png"), join(raiz, "atalho.png"));
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(raiz, "atalho.png") }])).rejects.toThrow(/fora/);
    symlinkSync(fora, join(raiz, "pasta-atalho"));
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(raiz, "pasta-atalho", "real.png") }])).rejects.toThrow(/fora/);
    writeFileSync(join(fora, ".env"), "X=1");
    symlinkSync(join(fora, ".env"), join(raiz, "inocente.png"));
    await expect(prepararAnexos(raiz, "sessao_abc", [{ caminho: join(raiz, "inocente.png") }])).rejects.toThrow();
    expect(existsSync(join(raiz, PRODUTO.pastaNoProjeto))).toBe(false);
  });
  it("symlink que aponta para dentro da raiz é aceito pelo destino real", async () => {
    mkdirSync(join(raiz, "docs"));
    writeFileSync(join(raiz, "docs", "a.md"), "x");
    symlinkSync(join(raiz, "docs", "a.md"), join(raiz, "atalho.md"));
    const r = await prepararAnexos(raiz, "sessao_abc", [{ caminho: join(raiz, "atalho.md") }]);
    expect(r.caminhos).toEqual([join("docs", "a.md")]);
  });
});
