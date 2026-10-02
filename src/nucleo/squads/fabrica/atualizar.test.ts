import { describe, expect, it } from "vitest";
import type { Membro, Squad } from "../tipos";
import { compararComFabrica, estadoDaUnidade, hashDeMembro, hashesDaSquad, proveniencia } from "./atualizar";

const m = (slug: string, extra: Partial<Membro> = {}): Membro => ({
  slug, papel: "executor", rotulo: slug, descricao: "d", prompt: `membros/${slug}.md`,
  perfil: { cli: "claude", modelo: "sonnet", esforco: "medio", faixa: "medio" },
  skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: 1,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null, ...extra,
});
const sq = (membros: Membro[], extra: Partial<Squad> = {}): Squad => ({
  slug: "fab", nome: "Fab", descricao: "d", escopo: "desenvolvimento", rigidez_padrao: null, max_instancias_paralelas: 4,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, portoes: null, fabrica: { id: "fab", versao: 1 }, origem: "fabrica", membros, ...extra,
});

describe("3 vias por unidade", () => {
  const casos: Array<[string, string | undefined, string | undefined, string | undefined, string]> = [
    ["tudo igual", "a", "a", "a", "igual"],
    ["usuário == antigo, fábrica mudou", "a", "a", "b", "atualizavel"],
    ["usuário editou, fábrica igual", "a", "x", "a", "editado"],
    ["usuário editou, fábrica mudou", "a", "x", "b", "editado"],
    ["usuário já tem o texto novo", "a", "b", "b", "igual"],
    ["membro novo na fábrica", undefined, undefined, "n", "novo"],
    ["usuário criou o mesmo slug com outro texto", undefined, "u", "n", "editado"],
    ["removido na fábrica, usuário intacto", "a", "a", undefined, "removido"],
    ["removido na fábrica, usuário editou", "a", "x", undefined, "removido"],
    ["usuário apagou o membro: nunca recria", "a", undefined, "b", "editado"],
    ["membro só do usuário", undefined, "u", undefined, "igual"],
  ];
  for (const [nome, a, u, n, esperado] of casos) it(nome, () => expect(estadoDaUnidade(a, u, n)).toBe(esperado));
});

describe("compararComFabrica (CT-14.11)", () => {
  const original = sq([m("orq", { papel: "orchestrator" }), m("impl"), m("rev", { papel: "reviewer" })]);
  const textos = { orq: "orq v1", impl: "impl v1", rev: "rev v1" };
  const prov = proveniencia(original, textos);

  it("editei um prompt e a fábrica subiu: o editado fica intocado, os outros ficam atualizáveis", () => {
    const novoTextos = { orq: "orq v2", impl: "impl v2", rev: "rev v1" };
    const novo = hashesDaSquad(sq([...original.membros], { fabrica: { id: "fab", versao: 2 } }), novoTextos);
    const usuario = hashesDaSquad(original, { orq: "orq v1", impl: "impl EDITADO PELO USUÁRIO", rev: "rev v1" });
    const r = compararComFabrica(prov, usuario, { versao: 2, arquivos: novo });
    expect(r.versao_nova).toBe(2);
    expect(r.membros).toEqual([
      { membro: "impl", estado: "editado" },
      { membro: "orq", estado: "atualizavel" },
    ]);
  });

  it("mudar slug e nome da cópia não conta como edição (a unidade squad.json usa só campos da squad)", () => {
    const copia = { ...original, slug: "minha", nome: "Minha", origem: "usuario" as const, fabrica: null };
    const r = compararComFabrica(prov, hashesDaSquad(copia, textos), { versao: 1, arquivos: hashesDaSquad(original, textos) });
    expect(r).toEqual({ versao_nova: null, membros: [] });
  });

  it("trocar a CLI de um membro (cadeado) é edição daquele membro; os demais seguem atualizáveis", () => {
    const copia = { ...original, membros: [original.membros[0]!, m("impl", { perfil: { cli: "codex", modelo: null, esforco: null, faixa: "medio" } }), original.membros[2]!] };
    const novo = hashesDaSquad(original, { orq: "orq v2", impl: "impl v2", rev: "rev v1" });
    const r = compararComFabrica(prov, hashesDaSquad(copia, textos), { versao: 2, arquivos: novo });
    expect(r.membros.find((x) => x.membro === "impl")?.estado).toBe("editado");
    expect(r.membros.find((x) => x.membro === "orq")?.estado).toBe("atualizavel");
  });

  it("membro novo e removido na fábrica; campos da squad atualizáveis aparecem como @squad", () => {
    const novoSq = sq([original.membros[0]!, original.membros[1]!, m("extra"), original.membros[2]!], { descricao: "nova descrição", fabrica: { id: "fab", versao: 3 } });
    const novo = hashesDaSquad(novoSq, { ...textos, extra: "x" });
    delete novo["membros/rev.md"];
    const r = compararComFabrica(prov, hashesDaSquad(original, textos), { versao: 3, arquivos: novo });
    expect(r.membros).toEqual([
      { membro: "extra", estado: "novo" },
      { membro: "rev", estado: "removido" },
      { membro: "@squad", estado: "atualizavel" },
    ]);
  });

  it("hashDeMembro muda com o prompt e com qualquer metadado", () => {
    const base = hashDeMembro(m("a"), "x");
    expect(hashDeMembro(m("a"), "y")).not.toBe(base);
    expect(hashDeMembro(m("a", { max_instancias: 3 }), "x")).not.toBe(base);
    expect(hashDeMembro(m("a"), "x")).toBe(base);
  });
});
