import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../index";
import { DuplicadoErro, NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";
import { criarRepoWorkspace } from "./workspace";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  return { b, repo: criarRepoWorkspace(b) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

describe("repo workspace", () => {
  it("cria com id ws_, padrões do contrato e booleanos reais", () => {
    const { repo } = novo();
    const w = repo.criar({ nome: "Projeto", raiz: "/tmp/p", e_git: true });
    expect(w.id).toMatch(/^ws_[0-9A-Z]{26}$/);
    expect(w).toMatchObject({ e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null });
    expect(repo.obter(w.id)).toEqual(w);
  });

  it("raiz duplicada vira erro nominal; enum inválido também", () => {
    const { repo } = novo();
    repo.criar({ nome: "a", raiz: "/r" });
    expect(() => repo.criar({ nome: "b", raiz: "/r" })).toThrow(DuplicadoErro);
    expect(() => repo.criar({ nome: "b", raiz: "/s", permissao: "x" as never })).toThrow(ValorInvalidoErro);
  });

  it("obter inexistente devolve undefined; exigir lança nominal", () => {
    const { repo } = novo();
    expect(repo.obter("ws_nada")).toBeUndefined();
    expect(() => repo.exigir("ws_nada")).toThrow(NaoEncontradoErro);
  });

  it("recentes ordena por ultimo_uso_em e respeita o limite; listar pagina por cursor", () => {
    const { repo } = novo();
    const ids = Array.from({ length: 5 }, (_, i) => repo.criar({ nome: `n${i}`, raiz: `/r${i}` }).id);
    repo.marcarUso(ids[1] as string, "2026-01-01T00:00:00.000Z");
    repo.marcarUso(ids[3] as string, "2026-02-01T00:00:00.000Z");
    expect(repo.recentes(2).map((w) => w.id)).toEqual([ids[3], ids[1]]);
    const p1 = repo.listar({ limite: 2 });
    expect(p1.itens).toHaveLength(2);
    expect(p1.proximo).not.toBeNull();
    const p2 = repo.listar({ limite: 2, depois: p1.proximo });
    const p3 = repo.listar({ limite: 2, depois: p2.proximo });
    expect([...p1.itens, ...p2.itens, ...p3.itens].map((w) => w.id)).toEqual(ids);
    expect(p3.proximo).toBeNull();
  });

  it("atualizar muda só os campos dados; apagarDefinitivo apaga em cascata", () => {
    const { repo, b } = novo();
    const w = repo.criar({ nome: "a", raiz: "/r" });
    const a = repo.atualizar(w.id, { permissao: "automatico", acesso_externo: "leitura" });
    expect(a).toMatchObject({ nome: "a", permissao: "automatico", acesso_externo: "leitura" });
    repo.apagarDefinitivo(w.id);
    expect(repo.obter(w.id)).toBeUndefined();
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) n FROM workspace")?.n).toBe(0);
  });

  it("AUD-11: remover é lógico (some das listagens, linha e histórico ficam) e restaurar traz de volta", () => {
    const { repo, b } = novo();
    const w = repo.criar({ nome: "a", raiz: "/r" });
    repo.marcarUso(w.id);
    repo.remover(w.id);
    expect(repo.obter(w.id)).toBeUndefined();
    expect(repo.obterPorRaiz("/r")).toBeUndefined();
    expect(repo.recentes()).toEqual([]);
    expect(repo.listar().itens).toEqual([]);
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) n FROM workspace")?.n).toBe(1);
    expect(repo.obterRemovidoPorRaiz("/r")?.id).toBe(w.id);
    expect(repo.restaurar(w.id)).toMatchObject({ id: w.id, nome: "a" });
    expect(repo.obter(w.id)?.id).toBe(w.id);
  });
});
