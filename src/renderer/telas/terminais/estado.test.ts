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

describe("estado da grade: adotar e trocar (painel que orquestra)", () => {
  const adotar = (e: EstadoGrade, id: string, grupo: string[], maximo = 9, junto: string | null = "p"): EstadoGrade => reduzir(e, { tipo: "adotar", sessao_id: id, junto_de: junto, grupo, maximo });

  it("6 workers entram ao lado do pedinte numa grade equilibrada, na ordem de chegada, e o foco fica no pedinte", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "p" });
    const ws: string[] = [];
    for (let i = 1; i <= 6; i++) {
      ws.push(`w${i}`);
      e = adotar(e, `w${i}`, ws.slice(0, -1));
      expect(e.ativa).toBe("p");
    }
    expect(e.abas).toHaveLength(1);
    expect(folhas(abaAtiva(e)!.arvore)).toEqual(["p", "w1", "w2", "w3", "w4", "w5", "w6"]);
  });

  it("preserva as outras folhas da aba e troca só a posição do pedinte", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "x" }, { tipo: "dividir", alvo: "x", orientacao: "vertical", nova: "p" }, { tipo: "focar", sessao_id: "p" });
    e = adotar(e, "w1", []);
    e = adotar(e, "w2", ["w1"]);
    expect(folhas(abaAtiva(e)!.arvore)).toEqual(["x", "p", "w1", "w2"]);
  });

  it("acima do máximo legível o worker vai para uma nova aba sem roubar o foco", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "p" });
    e = adotar(e, "w1", [], 2);
    e = adotar(e, "w2", ["w1"], 2);
    expect(e.abas).toHaveLength(2);
    expect(e.ativa).toBe("p");
    expect(folhas(e.abas[1]!.arvore)).toEqual(["w2"]);
  });

  it("é idempotente, e sem pedinte vai para nova aba sem foco (ou foca se não havia foco)", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "p" });
    e = adotar(e, "w1", []);
    expect(adotar(e, "w1", [])).toBe(e);
    const sem = adotar(e, "z", [], 9, null);
    expect(sem.abas).toHaveLength(2);
    expect(sem.ativa).toBe("p");
    expect(adotar(GRADE_VAZIA, "z", [], 9, null).ativa).toBe("z");
  });

  it("trocar mantém posição, foco, expansão e fixação", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" }, { tipo: "fixar", id: "aba-1" }, { tipo: "focar", sessao_id: "a" });
    e = reduzir(e, { tipo: "trocar", de: "a", para: "n" });
    expect(folhas(abaAtiva(e)!.arvore)).toEqual(["n", "b"]);
    expect(e.ativa).toBe("n");
    expect(e.fixadas).toEqual(["n"]);
    expect(reduzir(e, { tipo: "trocar", de: "n", para: "b" })).toBe(e);
    expect(reduzir(e, { tipo: "trocar", de: "ausente", para: "q" })).toBe(e);
  });
});

describe("estado da grade: layout orquestrador + workers (D-515 a D-517)", () => {
  const nos = (orqs: string[], ws: Array<[string, string]>): AcaoGrade => ({
    tipo: "orquestracao", area: { largura: 1600, altura: 900 },
    nos: [...orqs.map((id, i) => ({ id, papel: "orquestrador" as const, ordem: i })), ...ws.map(([id, pai], i) => ({ id, papel: "worker" as const, pai, ordem: 100 + i }))],
  });
  const adotar = (e: EstadoGrade, id: string, junto: string | null): EstadoGrade => reduzir(e, { tipo: "adotar", sessao_id: id, junto_de: junto, grupo: [], maximo: 9 });
  const arvoreDe = (e: EstadoGrade): Extract<ReturnType<typeof abaAtiva>, object>["arvore"] => abaAtiva(e)!.arvore;

  it("1 orquestrador: coluna esquerda com proporção, workers à direita; o foco fica no orquestrador", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "O" });
    const ws: Array<[string, string]> = [];
    for (let i = 1; i <= 6; i++) {
      ws.push([`w${i}`, "O"]);
      e = reduzir(e, nos(["O"], ws));
      e = adotar(e, `w${i}`, "O");
      expect(e.ativa).toBe("O");
    }
    expect(e.abas).toHaveLength(1);
    expect(folhas(arvoreDe(e))[0]).toBe("O");
    expect(arvoreDe(e)).toMatchObject({ tipo: "divisao", orientacao: "vertical", proporcao: 0.45, primeiro: { tipo: "terminal", sessao_id: "O" } });
    expect([...folhas(arvoreDe(e))].sort()).toEqual(["O", "w1", "w2", "w3", "w4", "w5", "w6"]);
  });

  it("2 orquestradores na mesma aba: linha de cima = orquestradores, abaixo os workers agrupados pelo pai", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "A" }, { tipo: "dividir", alvo: "A", orientacao: "vertical", nova: "B" });
    e = reduzir(e, nos(["A", "B"], [["b1", "B"], ["a1", "A"], ["a2", "A"]]));
    for (const [id, pai] of [["b1", "B"], ["a1", "A"], ["a2", "A"]] as const) e = adotar(e, id, pai);
    expect(arvoreDe(e)).toMatchObject({ tipo: "divisao", orientacao: "horizontal" });
    expect(folhas(arvoreDe(e))).toEqual(["A", "B", "a1", "a2", "b1"]);
  });

  it("fechar um worker reflui a grade; fechar o foco volta ao orquestrador", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "O" });
    const ws: Array<[string, string]> = [["w1", "O"], ["w2", "O"], ["w3", "O"]];
    e = reduzir(e, nos(["O"], ws));
    for (const [id] of ws) e = adotar(e, id, "O");
    e = reduzir(e, { tipo: "focar", sessao_id: "w2" });
    e = reduzir(e, { tipo: "fechar", sessao_id: "w2" });
    expect(e.ativa).toBe("O");
    expect(folhas(arvoreDe(e))).toEqual(["O", "w1", "w3"]);
    expect(arvoreDe(e)).toMatchObject({ proporcao: 0.5 }); // com 2 workers a proporção volta a 50%
    e = reduzir(reduzir(e, { tipo: "fechar", sessao_id: "w1" }), { tipo: "fechar", sessao_id: "w3" });
    expect(arvoreDe(e)).toEqual({ tipo: "terminal", sessao_id: "O" });
  });

  it("terminais comuns da aba ficam onde estavam e o grupo ocupa o lugar do orquestrador", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "x" }, { tipo: "dividir", alvo: "x", orientacao: "vertical", nova: "O" }, { tipo: "focar", sessao_id: "x" });
    e = reduzir(e, nos(["O"], [["w1", "O"], ["w2", "O"]]));
    e = adotar(adotar(e, "w1", "O"), "w2", "O");
    expect(folhas(arvoreDe(e))).toEqual(["x", "O", "w1", "w2"]);
    expect(e.ativa).toBe("x");
  });

  it("janela pequena: o worker que não cabe com tamanho legível vai para outra aba sem roubar o foco", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "O" });
    e = reduzir(e, { ...nos(["O"], [["w1", "O"], ["w2", "O"], ["w3", "O"], ["w4", "O"], ["w5", "O"]]), area: { largura: 700, altura: 400 } } as AcaoGrade);
    for (const id of ["w1", "w2", "w3", "w4", "w5"]) e = adotar(e, id, "O");
    expect(e.abas.length).toBeGreaterThan(1);
    expect(e.ativa).toBe("O");
    expect(e.abas.flatMap((a) => folhas(a.arvore)).sort()).toEqual(["O", "w1", "w2", "w3", "w4", "w5"]);
  });

  it("sem papéis registrados o comportamento é o de sempre (grade equilibrada); terminais comuns não mudam", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "p" });
    e = adotar(e, "w1", "p");
    expect(arvoreDe(e)).toMatchObject({ tipo: "divisao" });
    expect((arvoreDe(e) as { proporcao?: number }).proporcao).toBeUndefined();
    const comum = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" }, { tipo: "fechar", sessao_id: "b" });
    expect(abaAtiva(comum)!.arvore).toEqual({ tipo: "terminal", sessao_id: "a" });
  });

  it("a ação `orquestracao` é idempotente (mesmo estado) e guarda papel de quem ainda está na grade", () => {
    let e = rodar({ tipo: "nova-aba", sessao_id: "O" });
    const a = nos(["O"], [["w1", "O"]]);
    e = reduzir(e, a);
    expect(reduzir(e, a)).toBe(e);
    e = adotar(e, "w1", "O");
    const semW1 = reduzir(e, nos(["O"], []));
    expect(semW1.orquestracao?.["w1"]).toMatchObject({ papel: "worker", pai: "O" }); // ainda na grade: o fechamento precisa do papel
  });
});

describe("terminais por workspace (D-570): trocar o conjunto, proporção e modo foco", () => {
  it("`substituir` entra com o estado guardado do workspace (abas, foco, expandido) sem misturar com o que saiu", () => {
    const a = rodar({ tipo: "nova-aba", sessao_id: "a1" }, { tipo: "dividir", alvo: "a1", orientacao: "vertical", nova: "a2" }, { tipo: "expandir" });
    const b = rodar({ tipo: "nova-aba", sessao_id: "b1" });
    const emB = reduzir(a, { tipo: "substituir", estado: b });
    expect(emB.abas.flatMap((x) => folhas(x.arvore))).toEqual(["b1"]);
    expect(emB.ativa).toBe("b1");
    expect(emB.expandido).toBeNull();
    const deVolta = reduzir(emB, { tipo: "substituir", estado: a });
    expect(deVolta).toEqual(a);
    expect(deVolta.expandido).toBe("a2");
  });

  it("`substituir` mantém a medida do corpo atual e acrescenta como aba (sem roubar o foco) a sessão que nasceu com o workspace oculto", () => {
    const a = rodar({ tipo: "nova-aba", sessao_id: "a1" });
    const medido = reduzir(GRADE_VAZIA, { tipo: "orquestracao", nos: [], area: { largura: 800, altura: 600 } });
    const e = reduzir(medido, { tipo: "substituir", estado: a, faltantes: ["a9", "a1"] });
    expect(e.area).toEqual({ largura: 800, altura: 600 });
    expect(e.abas.flatMap((x) => folhas(x.arvore))).toEqual(["a1", "a9"]);
    expect(e.ativa).toBe("a1");
  });

  it("`proporcao` grava a razão da divisão certa (limitada a 10–90%) e é idempotente", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" }, { tipo: "dividir", alvo: "b", orientacao: "horizontal", nova: "c" });
    const r = reduzir(e, { tipo: "proporcao", a: "a", b: "b", razao: 0.7 });
    const raiz = r.abas[0]!.arvore as { proporcao?: number; segundo: { proporcao?: number } };
    expect(raiz.proporcao).toBe(0.7);
    expect(raiz.segundo.proporcao).toBeUndefined();
    expect(reduzir(r, { tipo: "proporcao", a: "a", b: "b", razao: 0.7 })).toBe(r);
    const interna = reduzir(r, { tipo: "proporcao", a: "b", b: "c", razao: 0.99 });
    expect((interna.abas[0]!.arvore as { segundo: { proporcao?: number } }).segundo.proporcao).toBe(0.9);
    expect(reduzir(r, { tipo: "proporcao", a: "x", b: "y", razao: 0.3 })).toBe(r);
    // e o layout gravável leva a proporção
    expect(layoutDoEstado(r, () => true).abas[0]!.arvore).toMatchObject({ proporcao: 0.7 });
  });

  it("modo foco (painel expandido e foco único) vai ao layout e volta em `restaurar`", () => {
    const e = rodar({ tipo: "nova-aba", sessao_id: "a" }, { tipo: "dividir", alvo: "a", orientacao: "vertical", nova: "b" }, { tipo: "expandir" });
    const layout = layoutDoEstado(e, () => true, true);
    expect(layout.expandido).toBe("b");
    expect(layout.foco_unico).toBe(true);
    const volta = reduzir(GRADE_VAZIA, { tipo: "restaurar", layout: { ...layout, ativa: "b" }, sessoes: ["a", "b"] });
    expect(volta.expandido).toBe("b");
    // painel expandido que não existe mais (ou não é o ativo) não volta
    expect(reduzir(GRADE_VAZIA, { tipo: "restaurar", layout, sessoes: ["a"] }).expandido).toBeNull();
    // sem modo foco, o layout não ganha campos novos
    const simples = layoutDoEstado(rodar({ tipo: "nova-aba", sessao_id: "a" }), () => true);
    expect(simples).toEqual({ versao: 2, ativa: "a", abas: [{ arvore: { tipo: "terminal", sessao_id: "a" } }], fixadas: [] });
  });

  it("`restaurar` preserva papéis e medida já conhecidos (a restauração tardia do disco não perde a orquestração)", () => {
    const base = reduzir(rodar({ tipo: "nova-aba", sessao_id: "O" }), { tipo: "orquestracao", nos: [{ id: "O", papel: "orquestrador", ordem: 1 }], area: { largura: 900, altura: 500 } });
    const r = reduzir(base, { tipo: "restaurar", layout: null, sessoes: ["O"] });
    expect(r.orquestracao?.["O"]?.papel).toBe("orquestrador");
    expect(r.area).toEqual({ largura: 900, altura: 500 });
  });
});
