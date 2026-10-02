import { describe, expect, it } from "vitest";
import type { Achado, Membro, Squad } from "../../../compartilhado/squads";
import {
  achadosDoMembro, aplicarCadeado, aplicarSubstituicoes, descreverPapel, duplicarMembro, indiceDoAchado, motivoDeNaoEnviar, mudarMembro, novoMembro, removerMembro, resumoDeAchados, slugDeNome, squadNova, temErro,
} from "./rascunho";

const membro = (slug: string, papel: Membro["papel"], extra: Partial<Membro> = {}): Membro => ({
  slug, papel, rotulo: slug, descricao: "", prompt: `membros/${slug}.md`, perfil: { cli: "claude", modelo: "opus", esforco: "alto", faixa: "alto" },
  skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: papel === "orchestrator" ? 1 : 2,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null, ...extra,
});
const squad = (): Squad => ({
  slug: "s", nome: "S", descricao: "", escopo: "desenvolvimento", rigidez_padrao: null, max_instancias_paralelas: 4, orcamento: { tempo_min: null, tokens: null, modo: "soft" },
  portoes: null, fabrica: null, origem: "usuario",
  membros: [membro("orq", "orchestrator"), membro("impl", "executor", { perfil: { cli: "claude", modelo: "sonnet", esforco: null, faixa: "medio" } }), membro("rev", "reviewer", { perfil: { cli: "codex", modelo: "gpt-5", esforco: "medium", faixa: "alto" } })],
});
const achado = (codigo: Achado["codigo"], caminho: string, severidade: Achado["severidade"] = "erro"): Achado => ({ severidade, codigo, caminho, mensagem: `m ${codigo}` });

describe("slugDeNome", () => {
  it("remove acento, minúsculas, hífens, no máximo 40 e padrão válido", () => {
    expect(slugDeNome("Squad de Pesquisa Ágil!")).toBe("squad-de-pesquisa-agil");
    expect(slugDeNome("  --X--  ")).toBe("x");
    expect(slugDeNome("")).toBe("squad");
    expect(slugDeNome("a".repeat(80))).toHaveLength(40);
    expect(slugDeNome("../etc")).toBe("etc");
  });
});

describe("squadNova / novoMembro", () => {
  it("nasce válida na forma: 1 orquestrador, executor, revisor, origem usuário", () => {
    const s = squadNova("minha", "Minha");
    expect(s.membros.map((m) => m.papel)).toEqual(["orchestrator", "executor", "reviewer"]);
    expect(s).toMatchObject({ slug: "minha", origem: "usuario", fabrica: null });
    expect(s.membros.every((m) => m.prompt === `membros/${m.slug}.md`)).toBe(true);
    expect(s.membros[0]!.max_instancias).toBe(1);
  });
  it("slug único por papel e caminho de prompt coerente", () => {
    const s = squadNova("x", "X");
    const n1 = novoMembro("executor", s.membros);
    const n2 = novoMembro("executor", [...s.membros, n1]);
    expect(new Set([...s.membros, n1, n2].map((m) => m.slug)).size).toBe(5);
    expect(n2.prompt).toBe(`membros/${n2.slug}.md`);
  });
});

describe("removerMembro / duplicarMembro / mudarMembro", () => {
  it("o orquestrador não é removível", () => {
    expect(removerMembro(squad(), "orq").membros).toHaveLength(3);
    expect(removerMembro(squad(), "impl").membros.map((m) => m.slug)).toEqual(["orq", "rev"]);
  });
  it("duplicar cria slug novo, pode trocar de CLI (modelo some) e nunca duplica orquestrador", () => {
    const s = duplicarMembro(squad(), "impl", "codex");
    const c = s.membros.find((m) => m.slug === "impl-2")!;
    expect(c.perfil.cli).toBe("codex");
    expect(c.perfil.modelo).toBeNull();
    expect(c.prompt).toBe("membros/impl-2.md");
    expect(duplicarMembro(squad(), "orq").membros).toHaveLength(3);
  });
  it("mudar é imutável", () => {
    const s = squad();
    const t = mudarMembro(s, "impl", { rotulo: "Novo" });
    expect(s.membros[1]!.rotulo).toBe("impl");
    expect(t.membros[1]!.rotulo).toBe("Novo");
  });
});

describe("aplicarCadeado (CT-14.18)", () => {
  it("troca a CLI de todos, mantém faixa e papel, e modelo inexistente vira default com aviso por membro", () => {
    const r = aplicarCadeado(squad(), "codex", ["gpt-5", "o3"]);
    expect(r.squad.membros.map((m) => m.perfil.cli)).toEqual(["codex", "codex", "codex"]);
    expect(r.squad.membros.map((m) => m.perfil.faixa)).toEqual(["alto", "medio", "alto"]);
    expect(r.squad.membros.map((m) => m.papel)).toEqual(["orchestrator", "executor", "reviewer"]);
    expect(r.squad.membros.map((m) => m.perfil.modelo)).toEqual([null, null, "gpt-5"]);
    expect(r.avisos.map((a) => a.membro).sort()).toEqual(["impl", "orq"]);
    expect(r.avisos[0]!.mensagem).toMatch(/default/);
  });
  it("orquestrador mantém CLI com contrato de intake quando a escolhida não tem", () => {
    const r = aplicarCadeado(squad(), "gemini", ["gemini-pro"]);
    expect(r.squad.membros[0]!.perfil.cli).toBe("claude");
    expect(r.squad.membros[1]!.perfil.cli).toBe("gemini");
    expect(r.avisos.some((a) => a.membro === "orq" && /intake/.test(a.mensagem))).toBe(true);
  });
});

describe("achados", () => {
  it("indiceDoAchado lê membros[N] e achadosDoMembro filtra", () => {
    const a = [achado("modelo_invalido", "membros[2].perfil.modelo"), achado("sem_revisor", "membros"), achado("prompt_grande", "membros[0].prompt", "aviso")];
    expect(indiceDoAchado(a[0]!)).toBe(2);
    expect(indiceDoAchado(a[1]!)).toBeNull();
    expect(achadosDoMembro(a, 0)).toHaveLength(1);
    expect(achadosDoMembro(a, 2)[0]!.codigo).toBe("modelo_invalido");
  });
  it("resumo e temErro", () => {
    const a = [achado("sem_revisor", "membros"), achado("esforco_indicativo", "membros[1]", "aviso"), achado("sem_orquestrador", "membros")];
    expect(resumoDeAchados(a)).toEqual({ erros: 2, avisos: 1 });
    expect(temErro(a)).toBe(true);
    expect(temErro([a[1]!])).toBe(false);
  });
  it("motivoDeNaoEnviar: squad inválida desabilita Enviar com o motivo; sem orquestrador também", () => {
    expect(motivoDeNaoEnviar(squad(), [])).toBeNull();
    expect(motivoDeNaoEnviar(squad(), [achado("sem_revisor", "membros")])).toContain("m sem_revisor");
    const sem = { ...squad(), membros: squad().membros.slice(1) };
    expect(motivoDeNaoEnviar(sem, [])).toMatch(/orquestrador/);
    expect(motivoDeNaoEnviar(squad(), [achado("esforco_indicativo", "membros[1]", "aviso")])).toBeNull();
  });
});

describe("aplicarSubstituicoes (pré-voo)", () => {
  it("troca a CLI só dos membros listados e zera o modelo que a nova CLI não conhece", () => {
    const s = aplicarSubstituicoes(squad(), [{ membro: "rev", de: "codex", para: "claude" }]);
    expect(s.membros[2]!.perfil).toMatchObject({ cli: "claude", modelo: null });
    expect(s.membros[0]!.perfil.cli).toBe("claude");
  });
});

describe("descreverPapel", () => {
  it("rótulos em português", () => {
    expect(descreverPapel("orchestrator")).toBe("Orquestrador");
    expect(descreverPapel("reviewer")).toBe("Revisor");
  });
});
