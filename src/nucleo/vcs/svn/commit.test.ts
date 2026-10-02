import { describe, expect, it } from "vitest";
import { atualizarSvn, commitarSvn, listarConflitosSvn, parseCommitSaida, parseUpdateSaida } from "./commit";
import { SvnRecusadoErro } from "./comum";
import { chamadas, falso, lerFixtureSvn, mensagemGravada } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

const cfg = () => {
  const f = falso();
  return { f, cwd: pastaTmp("svn-cm-"), op: { executavel: f.executavel, env: f.env } };
};

describe("svn/commit", () => {
  it("mensagem UTF-8 vai por -F (arquivo), NUNCA por argv; devolve a revisão", async () => {
    const { f, cwd, op } = cfg();
    const msg = "feat: ação ✓ --password=oops\nsegunda linha";
    const r = await commitarSvn(cwd, { ...op, mensagem: msg, origem: "usuario", caminhos: ["a.txt", "src"] });
    expect(r.revisao).toBe(7);
    const c = chamadas(f.log)[0] as string[];
    expect(c).toEqual(expect.arrayContaining(["commit", "-F", "--encoding", "UTF-8", "--non-interactive"]));
    expect(c.join("\n")).not.toContain("password");
    expect(c.slice(c.indexOf("--") + 1)).toEqual(["a.txt", "src"]);
    expect(mensagemGravada(f.log)).toBe(msg);
  });
  it("mensagem vazia/NUL e origem inválida são recusadas antes de rodar", async () => {
    const { f, cwd, op } = cfg();
    await expect(commitarSvn(cwd, { ...op, mensagem: "  ", origem: "usuario" })).rejects.toBeInstanceOf(SvnRecusadoErro);
    await expect(commitarSvn(cwd, { ...op, mensagem: "a\0b", origem: "usuario" })).rejects.toBeInstanceOf(SvnRecusadoErro);
    await expect(commitarSvn(cwd, { ...op, mensagem: "ok", origem: "robo" as never })).rejects.toBeInstanceOf(SvnRecusadoErro);
    expect(chamadas(f.log).filter((c) => c[0] === "commit")).toHaveLength(0);
  });
  it("automação NUNCA comita no tronco por padrão (info é do tronco no fixture)", async () => {
    const { f, cwd, op } = cfg();
    await expect(commitarSvn(cwd, { ...op, mensagem: "x", origem: "automacao" })).rejects.toMatchObject({ motivo: "automacao-tronco" });
    expect(chamadas(f.log).filter((c) => c[0] === "commit")).toHaveLength(0);
    await expect(commitarSvn(cwd, { ...op, mensagem: "x", origem: "automacao", automacaoNoTronco: true })).resolves.toMatchObject({ revisao: 7 });
  });
  it("parseCommitSaida", () => {
    expect(parseCommitSaida("Sending a\nCommitted revision 12.\n")).toBe(12);
    expect(parseCommitSaida("")).toBeNull();
  });
});

describe("svn/update e conflitos", () => {
  it("parseia update --accept postpone: itens, conflito de texto, revisão e resumo", () => {
    const r = parseUpdateSaida(lerFixtureSvn("update-conflito.txt"));
    expect(r.revisao).toBe(5);
    expect(r.itens).toEqual([{ acao: "conflito", propriedade: null, caminho: "a.txt", arvore: false }]);
    expect(r.conflitos).toHaveLength(1);
    expect(r.resumo).toContain("Text conflicts: 1");
  });
  it("conflito de árvore (coluna 4) e propriedade são reconhecidos", () => {
    const r = parseUpdateSaida("Updating '.':\n   C b.txt\nA    novo\n C   .\nUpdated to revision 9.\n");
    expect(r.itens.map((i) => [i.caminho, i.acao, i.propriedade, i.arvore])).toEqual([["b.txt", "atualizado", null, true], ["novo", "adicionado", null, false], [".", "atualizado", "conflito", false]].map((x) => x));
    expect(r.conflitos.map((c) => c.caminho)).toEqual(["b.txt", "."]);
  });
  it("update ignora externals por padrão e segue externals externos só com confirmação", async () => {
    const { f, cwd, op } = cfg();
    const r = await atualizarSvn(cwd, op);
    expect(r.conflitos).toHaveLength(1);
    const c = chamadas(f.log)[0] as string[];
    expect(c).toEqual(expect.arrayContaining(["update", "--accept", "postpone", "--ignore-externals"]));
    await expect(atualizarSvn(cwd, { ...op, seguirExternals: true })).rejects.toMatchObject({ motivo: "externals-externos", detalhe: ["https://example.com/x/y"] });
    const antes = chamadas(f.log).filter((x) => x[0] === "update").length;
    await atualizarSvn(cwd, { ...op, seguirExternals: true, confirmouExternalsExternos: true });
    const ultimo = chamadas(f.log).filter((x) => x[0] === "update");
    expect(ultimo).toHaveLength(antes + 1);
    expect(ultimo.at(-1)).not.toContain("--ignore-externals");
  });
  it("fila de conflitos vem do status local", async () => {
    const { cwd, op } = cfg();
    expect((await listarConflitosSvn(cwd, op)).length).toBeGreaterThanOrEqual(0);
  });
});
