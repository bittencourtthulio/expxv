import { describe, expect, it } from "vitest";
import { GRADE_VAZIA, abaAtiva, layoutDoEstado, painelsVisiveis, podeGravarLayout, reduzir, type AcaoGrade, type EstadoGrade } from "./estado";
import { folhas } from "./layout";

const rodar = (...acoes: AcaoGrade[]): EstadoGrade => acoes.reduce(reduzir, GRADE_VAZIA);

describe("estado da grade", () => {
  it("nova aba foca a sessão; nova-aba de sessão já existente só foca (sem duplicar)", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "nova-aba", sessao_id: "b" }, { tipo: "nova-aba", sessao_id: "a" });
    expect(e.abas).toHaveLength(2);
    expect(e.ativa).toBe("a");
  });

  it("dividir põe a nova sessão no foco; só a aba ativa é visível (as outras ficam desmontadas)", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "nova-aba", sessao_id: "z" }, { tipo: "focar", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" });
    expect(e.ativa).toBe("b");
    expect(painelsVisiveis(e)).toEqual(["a", "b"]);
    expect(e.abas).toHaveLength(2);
  });

  it("dividir com a sessão nova já em outra aba é ignorado", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "nova-aba", sessao_id: "b" });
    expect(reduzir(e, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" })).toBe(e);
  });

  it("fechar painel colapsa a divisão; fechar a última de uma aba remove a aba e foca a vizinha", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" });
    e = reduzir(e, { tipo: "fechar", sessao_id: "b" });
    expect(abaAtiva(e)!.arvore).toEqual({ tipo: "terminal", sessao_id: "a" });
    e = reduzir(reduzir(e, { tipo: "nova-aba", sessao_id: "c" }), { tipo: "fechar", sessao_id: "c" });
    expect(e.ativa).toBe("a");
    expect(reduzir(e, { tipo: "fechar", sessao_id: "a" }).ativa).toBeNull();
  });

  it("expandir alterna e mostra um painel só; fechar o expandido volta ao normal", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "horizontal", nova: "b" });
    e = reduzir(e, { tipo: "expandir" });
    expect(painelsVisiveis(e)).toEqual(["b"]);
    expect(reduzir(e, { tipo: "expandir" }).expandido).toBeNull();
    expect(reduzir(e, { tipo: "fechar", sessao_id: "b" }).expandido).toBeNull();
  });

  it("abas por número e por passo dão a volta; painel vizinho circula dentro da aba", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "nova-aba", sessao_id: "b" }, { tipo: "nova-aba", sessao_id: "c" });
    expect(reduzir(e, { tipo: "aba-numero", numero: 1 }).ativa).toBe("a");
    expect(reduzir(e, { tipo: "aba-numero", numero: 9 })).toBe(e);
    expect(reduzir(e, { tipo: "aba-passo", passo: 1 }).ativa).toBe("a"); // c → a
    e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" });
    expect(reduzir(e, { tipo: "painel-passo", passo: 1 }).ativa).toBe("a");
  });

  it("restaurar reconstrói as abas do layout sem duplicar sessões e recupera o foco", () => {
    const layout = { versao: 2 as const, ativa: "b", fixadas: [], abas: [{ arvore: { tipo: "divisao" as const, orientacao: "vertical" as const, primeiro: { tipo: "terminal" as const, sessao_id: "a" }, segundo: { tipo: "terminal" as const, sessao_id: "b" } } }] };
    const e = reduzir(GRADE_VAZIA, { tipo: "restaurar", layout, sessoes: ["a", "b", "c"] });
    expect(e.abas.map((x) => folhas(x.arvore))).toEqual([["a", "b"], ["c"]]);
    expect(e.ativa).toBe("b");
    const de_novo = reduzir(e, { tipo: "restaurar", layout, sessoes: ["a", "b", "c"] });
    expect(de_novo.abas.flatMap((x) => folhas(x.arvore))).toEqual(["a", "b", "c"]);
  });

  it("sessões que sumiram saem da árvore", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" });
    expect(folhas(abaAtiva(reduzir(e, { tipo: "sumiram", sessoes: ["b"] }))!.arvore)).toEqual(["a"]);
  });

  it("fixar alterna a fixação da raiz da aba", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" });
    const fixada = reduzir(e, { tipo: "fixar", id: e.abas[0]!.id });
    expect(fixada.fixadas).toEqual(["a"]);
    expect(reduzir(fixada, { tipo: "fixar", id: e.abas[0]!.id }).fixadas).toEqual([]);
  });
});

describe("persistência", () => {
  it("layoutDoEstado ignora sessões desconhecidas do store", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "fantasma" });
    expect(layoutDoEstado(e, (id) => id === "a").abas).toEqual([{ arvore: { tipo: "terminal", sessao_id: "a" } }]);
  });
  it("só grava depois da recuperação e sem abertura em curso", () => {
    expect(podeGravarLayout(false, 0)).toBe(false);
    expect(podeGravarLayout(true, 1)).toBe(false);
    expect(podeGravarLayout(true, 0)).toBe(true);
  });
});
