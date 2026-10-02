// Layout "orquestrador + workers" (D-515 a D-517): testes por tabela da função pura (1 orq + 0..8 workers, 2+ orq, remoção, reordenação, proporções, mínimos, agrupamento).
import { describe, expect, it } from "vitest";
import { folhas, type NoPainel } from "./layout";
import {
  ALTURA_DA_LINHA_DE_BAIXO, layoutOrquestrador, MINIMO_ORQUESTRACAO, proporcaoDoOrquestrador, retangulosDaArvore, rotulosDaOrquestracao,
  type Medida, type NoOrquestracao, type Retangulo,
} from "./layout-orquestrador";

const orq = (id: string, ordem = 0): NoOrquestracao => ({ id, papel: "orquestrador", ordem });
const wk = (id: string, pai: string, ordem: number): NoOrquestracao => ({ id, papel: "worker", pai, ordem });
const workers = (n: number, pai = "O"): NoOrquestracao[] => Array.from({ length: n }, (_, i) => wk(`w${i + 1}`, pai, i + 1));
const DESK: Medida = { largura: 1600, altura: 900 };
const TELA_1280: Medida = { largura: 1280, altura: 734 };
const TELA_1920: Medida = { largura: 1920, altura: 1000 };
const rect = (rs: readonly Retangulo[], id: string): Retangulo => rs.find((r) => r.id === id) as Retangulo;
const perto = (a: number, b: number, tol = 0.6): boolean => Math.abs(a - b) <= tol;

/** Cobertura exata da área, sem sobreposição. */
function conferirCobertura(arvore: NoPainel, area: Medida): Retangulo[] {
  const rs = retangulosDaArvore(arvore, area);
  expect(rs.reduce((s, r) => s + r.largura * r.altura, 0)).toBeCloseTo(area.largura * area.altura, 0);
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i] as Retangulo; const b = rs[j] as Retangulo;
    const sobrepoe = a.x < b.x + b.largura - 0.01 && b.x < a.x + a.largura - 0.01 && a.y < b.y + b.altura - 0.01 && b.y < a.y + a.altura - 0.01;
    expect(sobrepoe).toBe(false);
  }
  return rs;
}

describe("1 orquestrador: coluna esquerda + workers à direita como ⌘D / ⌘⇧D", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])("1 orq + %i workers: orquestrador à esquerda em altura total e todos os workers cabem na área da direita", (n) => {
    for (const area of [DESK, TELA_1280, TELA_1920]) {
      const r = layoutOrquestrador([orq("O"), ...workers(n)], { area });
      expect(r.excedentes).toEqual([]);
      expect(r.arvore).not.toBeNull();
      const rs = conferirCobertura(r.arvore as NoPainel, area);
      expect(rs).toHaveLength(1 + n);
      const o = rect(rs, "O");
      expect(o.x).toBe(0);
      expect(o.y).toBe(0);
      expect(perto(o.altura, area.altura)).toBe(true);
      if (n > 0) expect(perto(o.largura, area.largura * proporcaoDoOrquestrador(n), 1)).toBe(true);
      for (let i = 1; i <= n; i++) {
        const w = rect(rs, `w${i}`);
        expect(w.x).toBeGreaterThanOrEqual(o.largura - 0.01);
        expect(w.largura).toBeGreaterThanOrEqual(MINIMO_ORQUESTRACAO.largura - 0.01);
        expect(w.altura).toBeGreaterThanOrEqual(MINIMO_ORQUESTRACAO.altura - 0.01);
      }
    }
  });

  it("a sequência de divisões segue o ⌘D: 1º ocupa a direita inteira; 2º divide em cima/baixo; 3º divide a linha de baixo em esquerda/direita; 4º divide a de cima", () => {
    const rs = (n: number): Retangulo[] => retangulosDaArvore(layoutOrquestrador([orq("O"), ...workers(n)], { area: DESK }).arvore as NoPainel, DESK);
    const um = rs(1);
    expect(rect(um, "w1")).toMatchObject({ y: 0 });
    expect(perto(rect(um, "w1").altura, 900)).toBe(true);
    const dois = rs(2);
    expect(rect(dois, "w1").x).toBeCloseTo(rect(dois, "w2").x, 1); // mesma coluna
    expect(rect(dois, "w2").y).toBeGreaterThan(rect(dois, "w1").y); // o novo vem ABAIXO
    expect(perto(rect(dois, "w1").largura, rect(dois, "w2").largura)).toBe(true);
    const tres = rs(3);
    expect(rect(tres, "w3").y).toBeCloseTo(rect(tres, "w2").y, 1); // divide a linha de baixo...
    expect(rect(tres, "w3").x).toBeGreaterThan(rect(tres, "w2").x); // ...e o novo vem à DIREITA
    expect(perto(rect(tres, "w1").largura, rect(tres, "w2").largura + rect(tres, "w3").largura)).toBe(true);
    const quatro = rs(4);
    expect(rect(quatro, "w4").y).toBeCloseTo(rect(quatro, "w1").y, 1); // a maior célula era a de cima: divide ela
    expect(rect(quatro, "w4").x).toBeGreaterThan(rect(quatro, "w1").x);
  });

  it("proporções: 50% da largura até 2 workers e 45% a partir do 3º", () => {
    expect(proporcaoDoOrquestrador(1)).toBe(0.5);
    expect(proporcaoDoOrquestrador(2)).toBe(0.5);
    expect(proporcaoDoOrquestrador(3)).toBe(0.45);
    expect(proporcaoDoOrquestrador(8)).toBe(0.45);
    const raiz = layoutOrquestrador([orq("O"), ...workers(3)], { area: DESK }).arvore as Extract<NoPainel, { tipo: "divisao" }>;
    expect(raiz).toMatchObject({ orientacao: "vertical", proporcao: 0.45 });
    expect(raiz.primeiro).toEqual({ tipo: "terminal", sessao_id: "O" });
  });

  it("a ordem das folhas é: orquestrador, depois os workers na ordem de chegada de cima para baixo e da esquerda para a direita nas divisões", () => {
    const r = layoutOrquestrador([orq("O"), ...workers(2)], { area: DESK });
    expect(folhas(r.arvore as NoPainel)).toEqual(["O", "w1", "w2"]);
  });
});

describe("2 ou mais orquestradores: linha de cima = orquestradores, linha de baixo = workers", () => {
  it.each([[2, 0], [2, 1], [2, 3], [2, 5], [2, 6], [3, 4], [4, 8]])("%i orq + %i workers: orquestradores lado a lado em partes iguais, workers abaixo", (o, n) => {
    const orqs = Array.from({ length: o }, (_, i) => orq(`O${i + 1}`, i));
    const ws = Array.from({ length: n }, (_, i) => wk(`w${i + 1}`, `O${(i % o) + 1}`, i + 1));
    const r = layoutOrquestrador([...orqs, ...ws], { area: TELA_1920 });
    expect(r.excedentes).toEqual([]);
    const rs = conferirCobertura(r.arvore as NoPainel, TELA_1920);
    const topo = orqs.map((x) => rect(rs, x.id));
    topo.forEach((t) => { expect(t.y).toBe(0); expect(perto(t.largura, TELA_1920.largura / o, 1)).toBe(true); });
    const alturaTopo = n === 0 ? TELA_1920.altura : TELA_1920.altura * (1 - ALTURA_DA_LINHA_DE_BAIXO);
    topo.forEach((t) => expect(perto(t.altura, alturaTopo, 1)).toBe(true));
    for (const w of ws) expect(rect(rs, w.id).y).toBeGreaterThanOrEqual(alturaTopo - 1);
    // linha de baixo: 55–60% da altura
    if (n > 0) expect(ALTURA_DA_LINHA_DE_BAIXO).toBeGreaterThanOrEqual(0.55);
    if (n > 0) expect(ALTURA_DA_LINHA_DE_BAIXO).toBeLessThanOrEqual(0.6);
  });

  it("sem workers a linha de cima ocupa 100% da altura", () => {
    const r = layoutOrquestrador([orq("A", 0), orq("B", 1)], { area: DESK });
    const rs = conferirCobertura(r.arvore as NoPainel, DESK);
    expect(rs.every((x) => perto(x.altura, 900))).toBe(true);
    expect(r.arvore).toMatchObject({ tipo: "divisao", orientacao: "vertical", proporcao: 0.5 });
  });

  it("os workers de orquestradores diferentes ficam AGRUPADOS por pai (ordem do pai, depois a de chegada), mesmo chegando intercalados", () => {
    const nos = [orq("A", 0), orq("B", 1), wk("b1", "B", 1), wk("a1", "A", 2), wk("b2", "B", 3), wk("a2", "A", 4), wk("a3", "A", 5)];
    const r = layoutOrquestrador(nos, { area: TELA_1920 });
    expect(folhas(r.arvore as NoPainel)).toEqual(["A", "B", "a1", "a2", "a3", "b1", "b2"]);
  });

  it("a linha de baixo se ajusta: em 1280 de largura 5 workers ficam em 2 linhas (3 em cima e 2 embaixo); em 1920 cabem todos numa linha só", () => {
    const nos = [orq("A", 0), orq("B", 1), ...Array.from({ length: 5 }, (_, i) => wk(`w${i + 1}`, "A", i + 1))];
    const rs = retangulosDaArvore(layoutOrquestrador(nos, { area: TELA_1280 }).arvore as NoPainel, TELA_1280);
    const ys = [...new Set(rs.filter((x) => x.id.startsWith("w")).map((x) => Math.round(x.y)))];
    expect(ys).toHaveLength(2);
    expect(rs.filter((x) => x.id.startsWith("w") && Math.round(x.y) === Math.min(...ys))).toHaveLength(3);
    const larga = retangulosDaArvore(layoutOrquestrador(nos, { area: TELA_1920 }).arvore as NoPainel, TELA_1920);
    expect(new Set(larga.filter((x) => x.id.startsWith("w")).map((x) => Math.round(x.y))).size).toBe(1);
  });
});

describe("remoção, reordenação e pureza", () => {
  it("fechar um worker reflui a grade: o resultado é igual ao de calcular só com os que sobraram", () => {
    const todos = [orq("O"), ...workers(5)];
    const sem = todos.filter((n) => n.id !== "w3");
    const r = layoutOrquestrador(sem, { area: DESK });
    expect([...folhas(r.arvore as NoPainel)].sort()).toEqual(["O", "w1", "w2", "w4", "w5"]);
    expect(folhas(r.arvore as NoPainel)[0]).toBe("O");
    expect(layoutOrquestrador(sem, { area: DESK })).toEqual(r);
    conferirCobertura(r.arvore as NoPainel, DESK);
  });
  it("o último worker fechado deixa o orquestrador sozinho (folha única); o orquestrador fechado com workers deixa só os workers como grade de baixo", () => {
    expect(layoutOrquestrador([orq("O")], { area: DESK }).arvore).toEqual({ tipo: "terminal", sessao_id: "O" });
  });
  it("a ordem de entrada NÃO muda o resultado (a `ordem` manda); entrada não é alterada; ids repetidos contam uma vez", () => {
    const base = [orq("A", 0), orq("B", 1), wk("x", "A", 3), wk("y", "B", 1), wk("z", "A", 2)];
    const copia = JSON.parse(JSON.stringify(base)) as NoOrquestracao[];
    const a = layoutOrquestrador(base, { area: DESK });
    const b = layoutOrquestrador([...base].reverse(), { area: DESK });
    expect(b).toEqual(a);
    expect(base).toEqual(copia);
    expect(layoutOrquestrador([...base, wk("x", "A", 9)], { area: DESK })).toEqual(a);
    expect(folhas(a.arvore as NoPainel)).toEqual(["A", "B", "z", "x", "y"]);
  });
  it("sem orquestrador no grupo não há layout (o comportamento comum fica com o chamador)", () => {
    expect(layoutOrquestrador(workers(3), { area: DESK })).toEqual({ arvore: null, excedentes: [], orquestradores: [] });
    expect(layoutOrquestrador([], { area: DESK }).arvore).toBeNull();
  });
});

describe("mínimos legíveis e tetos", () => {
  it("área pequena: o que não cabe com tamanho legível vira excedente (outra aba), e cada painel que ficou respeita o mínimo", () => {
    const area: Medida = { largura: 900, altura: 500 };
    const r = layoutOrquestrador([orq("O"), ...workers(8)], { area });
    expect(r.excedentes.length).toBeGreaterThan(0);
    const rs = retangulosDaArvore(r.arvore as NoPainel, area);
    for (const w of rs.filter((x) => x.id !== "O")) {
      expect(w.largura).toBeGreaterThanOrEqual(MINIMO_ORQUESTRACAO.largura - 0.01);
      expect(w.altura).toBeGreaterThanOrEqual(MINIMO_ORQUESTRACAO.altura - 0.01);
    }
    expect(rs.length + r.excedentes.length).toBe(9);
    expect(new Set([...rs.map((x) => x.id), ...r.excedentes]).size).toBe(9);
  });
  it("mínimo é configurável", () => {
    const area: Medida = { largura: 900, altura: 500 };
    const frouxo = layoutOrquestrador([orq("O"), ...workers(4)], { area, minimo: { largura: 100, altura: 60 } });
    expect(frouxo.excedentes).toEqual([]);
    const apertado = layoutOrquestrador([orq("O"), ...workers(4)], { area, minimo: { largura: 400, altura: 300 } });
    expect(apertado.excedentes.length).toBeGreaterThan(0);
  });
  it("teto de 8 workers por orquestrador: o 9º e o 10º são excedentes", () => {
    const r = layoutOrquestrador([orq("O"), ...workers(10)], { area: TELA_1920 });
    expect(r.excedentes).toEqual(["w9", "w10"]);
    expect(folhas(r.arvore as NoPainel)).toHaveLength(9);
  });
  it("2 orq em tela estreita: workers além das colunas×linhas que cabem viram excedente; orquestradores nunca", () => {
    const area: Medida = { largura: 700, altura: 600 };
    const r = layoutOrquestrador([orq("A", 0), orq("B", 1), ...workers(6, "A")], { area });
    expect(folhas(r.arvore as NoPainel).slice(0, 2)).toEqual(["A", "B"]);
    expect(r.excedentes.length).toBeGreaterThan(0);
  });
});

describe("rótulos e cores por orquestrador", () => {
  it("um orquestrador: '↳ orq.'; dois ou mais: letras e cor por orquestrador, workers herdam do pai", () => {
    const um = rotulosDaOrquestracao([orq("O"), wk("w1", "O", 1)]);
    expect(um["w1"]).toEqual({ rotulo: "↳ orq.", cor: 0 });
    expect(um["O"]).toBeUndefined(); // o cabeçalho do orquestrador único já diz "orquestrando"
    const dois = rotulosDaOrquestracao([orq("A", 0), orq("B", 1), wk("w1", "B", 1), wk("w2", "A", 2), wk("w3", "desconhecido", 3)]);
    expect(dois["A"]).toEqual({ rotulo: "orq. A", cor: 0 });
    expect(dois["B"]).toEqual({ rotulo: "orq. B", cor: 1 });
    expect(dois["w1"]).toEqual({ rotulo: "↳ orq. B", cor: 1 });
    expect(dois["w2"]).toEqual({ rotulo: "↳ orq. A", cor: 0 });
    expect(dois["w3"]?.rotulo).toBe("↳ orq. A"); // pai desconhecido vale o primeiro
  });
});
