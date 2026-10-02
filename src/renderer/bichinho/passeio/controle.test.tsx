// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BichinhoVisao } from "../../../compartilhado/bichinho";
import { Casinha, useCasa, useForaDoPosto } from "./casa";
import Camada from "./Camada";
import { criarControle, SEGREDO_MS, SOSSEGO_APOS_TRABALHO_MS, type ControlePasseio } from "./controle";
import { criarSorteio } from "./geometria";
import { CODIGO_SECRETO } from "./segredo";

const visao = (id: string, o: Partial<BichinhoVisao> = {}): BichinhoVisao => ({
  workspace_id: id, especie: "raposa", especie_automatica: "raposa", manual: false, motivo: [], apelido: null, estagio: "jovem", maturidade: 30, componentes: { tokens: 1, conhecimento: 1 }, tokens_total: 1,
  conhecimento_itens: { memoria: 0, chunks: null, total: 0 }, humor: "ocioso", doente: false, esforco: { nivel: 0, origem: "nenhuma", tokens_por_min: null, bytes_por_s: 0, sessoes_fluindo: 0 }, em: 1, ...o,
});
const mapa = (...v: BichinhoVisao[]): ReadonlyMap<string, BichinhoVisao> => new Map(v.map((x) => [x.workspace_id, x]));
const caixa = (el: Element, l: number, t: number, w = 28, h = 28): void => { (el as HTMLElement).getBoundingClientRect = () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => ({}) }) as DOMRect; };

/** Casa de teste: usa o mesmo gancho dos componentes reais e mostra a casinha quando o bichinho está fora. */
function CasaFalsa({ chave, ws, controle, x, y }: { chave: string; ws: string; controle: ControlePasseio; x: number; y: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCasa(chave, ws, ref, controle);
  const fora = useForaDoPosto(chave, controle);
  return <span ref={(el) => { (ref as { current: HTMLSpanElement | null }).current = el; if (el !== null) caixa(el, x, y); }} data-casa={chave}>{fora ? <Casinha /> : <i data-figura={chave} />}</span>;
}

const store = (o: Partial<{ passear: boolean; travessuras: boolean; ociosidadeMin: number; mostrar: boolean; silenciar: boolean }> = {}, visoes: ReadonlyMap<string, BichinhoVisao> = new Map()) => {
  const estado = { visoes, subiu: new Map(), mostrar: true, silenciar: false, passear: true, travessuras: true, ociosidadeMin: 1, disponivel: true, ...o };
  return { obter: () => estado, assinar: () => () => undefined, garantir: async () => undefined } as never;
};

let controle: ControlePasseio;
let avisos: string[];
let reduzido = false;

function ambiente(n: number, opc: { visoes?: BichinhoVisao[]; travessuras?: boolean } = {}) {
  const visoes = opc.visoes ?? Array.from({ length: n }, (_, i) => visao(`ws${i}`, { em: i + 1 }));
  const r = render(
    <>
      {visoes.map((v, i) => <CasaFalsa key={v.workspace_id} chave={`card:${v.workspace_id}`} ws={v.workspace_id} controle={controle} x={80} y={120 + i * 55} />)}
      <Camada controle={controle} store={store({ travessuras: opc.travessuras ?? false, ociosidadeMin: 1 }, mapa(...visoes))} />
    </>,
  );
  return { ...r, visoes };
}
const passear = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const soltos = (): number => document.querySelectorAll("[data-passeante]").length;
const ficarOcioso = (): void => passear(60_000 + 50);
const mexerMouse = (x = 500, y = 400): void => { act(() => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y })); }); };

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  avisos = [];
  reduzido = false;
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  controle = criarControle({ sorteio: criarSorteio, reduzido: () => reduzido, avisar: (t) => avisos.push(t) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("overlay: só existe durante o passeio", () => {
  it("sem passeio nada é montado e só há UM timer (o do detector de ociosidade); nenhum rAF", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container } = ambiente(3);
    expect(container.querySelector("[data-passeio-camada]")).toBeNull();
    expect(document.querySelector("[data-passeio-camada]")).toBeNull();
    expect(container.querySelectorAll("[data-casinha]")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
    passear(30_000);
    expect(vi.getTimerCount()).toBe(1);
    expect(raf).not.toHaveBeenCalled();
  });
  it("ocioso → os bichinhos saem dos cards, as casinhas aparecem e a camada é decorativa e sem cliques", () => {
    ambiente(3);
    ficarOcioso();
    expect(soltos()).toBe(3);
    const camada = document.querySelector<HTMLElement>("[data-passeio-camada]")!;
    expect(camada.getAttribute("aria-hidden")).toBe("true");
    expect(camada.className).toContain("pb-camada");
    expect(document.querySelectorAll("[data-casinha]")).toHaveLength(3);
    expect(document.querySelectorAll("[data-figura]")).toHaveLength(0);
    expect(camada.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1 + 3);
  });
  it("qualquer movimento do mouse manda TODOS de volta em ≤ 1,5 s; a camada some e as casinhas também", () => {
    ambiente(3);
    ficarOcioso();
    passear(20_000);
    expect(soltos()).toBe(3);
    mexerMouse();
    passear(1_600);
    expect(soltos()).toBe(0);
    expect(document.querySelector("[data-passeio-camada]")).toBeNull();
    expect(document.querySelectorAll("[data-casinha]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-figura]")).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(1);
  });
  it.each([["tecla", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }))], ["clique", () => window.dispatchEvent(new MouseEvent("pointerdown"))], ["foco da janela", () => window.dispatchEvent(new Event("focus"))]])("%s também os traz de volta", (_n, agir) => {
    ambiente(2);
    ficarOcioso();
    expect(soltos()).toBe(2);
    act(() => { agir(); });
    passear(1_600);
    expect(soltos()).toBe(0);
  });
  it("durante a volta o transform vai ao card com transição ≤ 1,5 s", () => {
    ambiente(1);
    ficarOcioso();
    passear(15_000);
    mexerMouse();
    const el = document.querySelector<HTMLElement>("[data-passeante]")!;
    expect(el.dataset["fase"]).toBe("voltando");
    expect(parseInt(el.style.transitionDuration, 10)).toBeLessThanOrEqual(1_500);
  });
});

describe("regras de saída", () => {
  it("workspace com agente trabalhando NÃO passeia; os ociosos sim", () => {
    ambiente(0, { visoes: [visao("a", { humor: "trabalhando", em: 3 }), visao("b", { em: 2 }), visao("c", { em: 1, esforco: { nivel: 2, origem: "estimado", tokens_por_min: null, bytes_por_s: 9, sessoes_fluindo: 1 } })] });
    ficarOcioso();
    expect([...document.querySelectorAll("[data-passeante]")].map((e) => e.getAttribute("data-passeante"))).toEqual(["card:b"]);
  });
  it("trabalho que começa no workspace do bichinho o traz de volta; só sai de novo depois do sossego", () => {
    const a = visao("a", { em: 2 });
    const b = visao("b", { em: 1 });
    ambiente(0, { visoes: [a, b] });
    ficarOcioso();
    expect(soltos()).toBe(2);
    act(() => controle.definirVisoes(mapa(visao("a", { humor: "trabalhando", em: 3 }), b)));
    passear(1_600);
    expect([...document.querySelectorAll("[data-passeante]")].map((e) => e.getAttribute("data-passeante"))).toEqual(["card:b"]);
    act(() => controle.definirVisoes(mapa(visao("a", { em: 4 }), b)));
    passear(SOSSEGO_APOS_TRABALHO_MS - 2_000);
    expect(document.querySelector("[data-passeante='card:a']")).toBeNull();
    passear(3_000);
    expect(document.querySelector("[data-passeante='card:a']")).not.toBeNull();
  });
  it("reduzir movimento (sistema) e 'Silenciar animações': ninguém passeia", () => {
    reduzido = true;
    ambiente(2);
    ficarOcioso();
    expect(soltos()).toBe(0);
    cleanup();
    reduzido = false;
    controle = criarControle({ sorteio: criarSorteio, reduzido: () => false });
    render(<><CasaFalsa chave="card:a" ws="a" controle={controle} x={80} y={120} /><Camada controle={controle} store={store({ silenciar: true }, mapa(visao("a")))} /></>);
    ficarOcioso();
    expect(soltos()).toBe(0);
  });
  it("preferência desligada: ninguém passeia; tempo configurável (1 a 30 min)", () => {
    render(<><CasaFalsa chave="card:a" ws="a" controle={controle} x={80} y={120} /><Camada controle={controle} store={store({ passear: false }, mapa(visao("a")))} /></>);
    ficarOcioso();
    expect(soltos()).toBe(0);
    cleanup();
    controle = criarControle({ sorteio: criarSorteio, reduzido: () => false });
    render(<><CasaFalsa chave="card:a" ws="a" controle={controle} x={80} y={120} /><Camada controle={controle} store={store({ ociosidadeMin: 5 }, mapa(visao("a")))} /></>);
    passear(4 * 60_000);
    expect(soltos()).toBe(0);
    passear(60_000 + 100);
    expect(soltos()).toBe(1);
  });
  it("limite de 8 soltos: só os mais recentes", () => {
    ambiente(11);
    ficarOcioso();
    expect(soltos()).toBe(8);
    expect(document.querySelector("[data-passeante='card:ws0']")).toBeNull();
    expect(document.querySelector("[data-passeante='card:ws10']")).not.toBeNull();
  });
  it("janela oculta: pausa total (todos voltam na hora, nada novo sai); ao voltar, a atividade zera a ociosidade", () => {
    ambiente(2);
    ficarOcioso();
    expect(soltos()).toBe(2);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(soltos()).toBe(0);
    passear(120_000);
    expect(soltos()).toBe(0);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    passear(1_000);
    expect(soltos()).toBe(0);
  });
  it("homes fora da janela (card rolado para fora) não saem", () => {
    render(<><CasaFalsa chave="card:a" ws="a" controle={controle} x={80} y={-300} /><Camada controle={controle} store={store({}, mapa(visao("a")))} /></>);
    ficarOcioso();
    expect(soltos()).toBe(0);
  });
});

describe("comportamento ao longo do passeio", () => {
  it("passam por andando, fazendo algo e deitam para dormir em lugares DIFERENTES; reagem a trocar de fase com poucos timers", () => {
    ambiente(3);
    ficarOcioso();
    const fases = new Set<string>();
    const acoes = new Set<string>();
    const posicoes = new Map<string, string>();
    for (let t = 0; t < 600; t++) {
      passear(1_000);
      for (const el of document.querySelectorAll<HTMLElement>("[data-passeante]")) {
        fases.add(el.dataset["fase"]!);
        if (el.dataset["acao"]) acoes.add(el.dataset["acao"]);
        if (el.dataset["fase"] === "dormindo") posicoes.set(el.dataset["passeante"]!, el.style.transform);
      }
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1 + 3 + 1);
    }
    expect([...fases]).toEqual(expect.arrayContaining(["andando", "fazendo_algo", "deitando", "dormindo"]));
    expect(acoes.size).toBeGreaterThanOrEqual(3);
    expect(new Set(posicoes.values()).size).toBe(posicoes.size); // ninguém dorme no mesmo ponto
    expect(posicoes.size).toBe(3);
  });
  it("a escolha do lugar de sono é determinística pela semente do workspace", () => {
    const rodar = (): Record<string, string> => {
      cleanup(); document.body.innerHTML = "";
      controle = criarControle({ sorteio: criarSorteio, reduzido: () => false });
      vi.setSystemTime(10_000);
      ambiente(2);
      ficarOcioso();
      const r: Record<string, string> = {};
      for (let t = 0; t < 400; t++) { passear(1_000); for (const el of document.querySelectorAll<HTMLElement>("[data-passeante]")) if (el.dataset["fase"] === "dormindo" && r[el.dataset["passeante"]!] === undefined) r[el.dataset["passeante"]!] = el.style.transform; }
      return r;
    };
    const a = rodar();
    const b = rodar();
    expect(Object.keys(a).length).toBe(2);
    expect(b).toEqual(a);
  });
  it("sem rAF e sem setInterval durante o passeio; publica poucas vezes por passeante (P-651)", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const intervalo = vi.spyOn(globalThis, "setInterval");
    let publicacoes = 0;
    ambiente(8);
    controle.assinar(() => { publicacoes++; });
    ficarOcioso();
    publicacoes = 0;
    passear(5 * 60_000);
    expect(raf).not.toHaveBeenCalled();
    expect(intervalo).not.toHaveBeenCalled();
    expect(soltos()).toBe(8);
    // orçamento P-651: ≤ 12 publicações por passeante por minuto (cada uma = 1 render do overlay)
    expect(publicacoes / 8 / 5).toBeLessThanOrEqual(12);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1 + 8 + 1);
  });
  it("unmount da camada: tudo limpo (listeners, timers, passeantes)", () => {
    const { unmount } = ambiente(2);
    ficarOcioso();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(controle._soltos()).toBe(0);
    expect(controle.registro.residuos()).toEqual({ entradas: 0, armadilha: false, observadores: 0 });
  });
});

describe("travessuras com os elementos reais da casca", () => {
  let animacoes: Array<{ el: Element; cancelada: boolean; keyframes: Keyframe[] }>;
  beforeEach(() => {
    animacoes = [];
    (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, keyframes: Keyframe[]) {
      const a = { el: this, keyframes, cancelada: false, onfinish: null as null | (() => void), cancel() { a.cancelada = true; } };
      animacoes.push(a);
      return a;
    };
  });
  afterEach(() => { delete (Element.prototype as unknown as { animate?: unknown }).animate; });

  function casca() {
    const menu = document.createElement("nav");
    menu.className = "menu";
    menu.innerHTML = `<button id="b1" aria-label="Início"><svg id="i1" class="icone"></svg></button><button id="b2" aria-label="Terminais"><svg id="i2" class="icone"></svg></button><span id="s1" class="menu-selo">2</span><span id="t1">Início</span><span id="t2">Terminais</span>`;
    document.body.append(menu);
    menu.querySelectorAll("*").forEach((e, i) => caixa(e, 12, 100 + i * 34, 24, 24));
    const campo = document.createElement("input"); campo.id = "campo"; document.body.append(campo);
    return menu;
  }
  const deslocados = (): Element[] => [...document.querySelectorAll("*")].filter((e) => controle.registro.estaMovido(e));

  it("durante a travessura um elemento REAL é deslocado via translate/rotate; ao mexer o mouse tudo volta e nada fica residual", () => {
    casca();
    ambiente(0, { visoes: [visao("a", { em: 3 }), visao("b", { em: 2 }), visao("c", { em: 1 })], travessuras: true });
    ficarOcioso();
    let achou = false;
    for (let t = 0; t < 900 && !achou; t++) { passear(1_000); achou = controle.registro.ativas() > 0 && animacoes.some((a) => (a.keyframes[a.keyframes.length - 1] as { translate?: string }).translate !== "0px 0px"); }
    expect(achou).toBe(true);
    const antes = document.body.innerHTML;
    expect(deslocados().length).toBeGreaterThan(0);
    expect(deslocados().length).toBeLessThanOrEqual(3);
    for (const el of deslocados()) { expect(el.closest("#campo")).toBeNull(); expect(el.tagName).not.toBe("INPUT"); }
    const dom = document.body.innerHTML;
    expect(dom).toBe(antes); // nada de DOM/estilo/classe/atributo mudou
    mexerMouse();
    passear(300);
    expect(deslocados()).toHaveLength(0);
    passear(1_700);
    expect(controle.registro.residuos().entradas).toBe(0);
    expect(animacoes.every((a) => a.cancelada)).toBe(true);
    expect(document.querySelectorAll("*")).toBeTruthy();
    expect(soltos()).toBe(0);
  });
  it("a preferência de travessuras desligada não desloca nada", () => {
    casca();
    ambiente(0, { visoes: [visao("a"), visao("b")], travessuras: false });
    ficarOcioso();
    for (let t = 0; t < 300; t++) passear(1_000);
    expect(animacoes).toHaveLength(0);
  });
  it("trabalho volta ao workspace do bichinho que levava o elemento: o elemento volta", () => {
    casca();
    const a = visao("a", { em: 3 }); const b = visao("b", { em: 2 }); const c = visao("c", { em: 1 });
    ambiente(0, { visoes: [a, b, c], travessuras: true });
    ficarOcioso();
    let dono: string | undefined;
    for (let t = 0; t < 900 && dono === undefined; t++) { passear(1_000); const el = deslocados()[0]; if (el !== undefined) dono = controle.registro.donoDe(el); }
    expect(dono).toBeDefined();
    const ws = dono!.replace("card:", "");
    act(() => controle.definirVisoes(mapa(...[a, b, c].map((v) => (v.workspace_id === ws ? visao(ws, { humor: "trabalhando", em: v.em }) : v)))));
    passear(1_000);
    expect(deslocados().filter((e) => controle.registro.donoDe(e) === dono)).toHaveLength(0);
  });
});

describe("atalho escondido (Konami)", () => {
  const konami = (): void => { for (const k of CODIGO_SECRETO) act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); }); };
  it("a sequência certa faz TODOS saírem na hora, mesmo trabalhando e sem ociosidade; a errada não", () => {
    ambiente(0, { visoes: [visao("a", { em: 2, humor: "trabalhando" }), visao("b", { em: 1 })] });
    for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "x", "ArrowDown"]) act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); });
    passear(500);
    expect(soltos()).toBe(0);
    konami();
    passear(500);
    expect(soltos()).toBe(2);
  });
  it("faz a parada: todos correm ao centro e dançam; movimento do mouse e teclas NÃO encerram; clique ou Esc encerram", () => {
    ambiente(3);
    konami();
    const dancou = new Set<string>();
    for (let t = 0; t < 12; t++) {
      passear(500);
      mexerMouse(100 + t * 30, 100);
      for (const el of document.querySelectorAll<HTMLElement>("[data-passeante]")) if (el.dataset["acao"] === "dancar") dancou.add(el.dataset["passeante"]!);
    }
    expect(dancou.size).toBe(3);
    expect(soltos()).toBe(3);
    act(() => { window.dispatchEvent(new MouseEvent("pointerdown")); });
    passear(1_700);
    expect(soltos()).toBe(0);
  });
  it("Esc encerra e 40 s também", () => {
    ambiente(2);
    konami();
    passear(300);
    expect(soltos()).toBe(2);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    passear(1_700);
    expect(soltos()).toBe(0);
    konami();
    passear(SEGREDO_MS + 2_000);
    expect(soltos()).toBe(0);
  });
  it("com movimento reduzido: aviso 'animações silenciadas' e pose estática de ~1 s, sem movimento", () => {
    reduzido = true;
    ambiente(2);
    konami();
    expect(avisos.join(" ")).toMatch(/Animações silenciadas/);
    expect(soltos()).toBe(2);
    for (const el of document.querySelectorAll<HTMLElement>("[data-passeante]")) expect(el.style.transitionDuration).toBe("0ms");
    passear(1_100);
    expect(soltos()).toBe(0);
  });
  it("NÃO aparece no ⌘K, na ajuda de atalhos nem em tooltips: nenhum arquivo da UI (fora do passeio e do Slot) o cita", () => {
    const raiz = join(__dirname, "..", "..");
    const achados: string[] = [];
    const varrer = (dir: string): void => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) { if (!caminho.endsWith(join("bichinho", "passeio"))) varrer(caminho); continue; }
        if (!/\.(tsx?|css)$/.test(nome) || /\.test\./.test(nome)) continue;
        if (/konami|"ArrowUp",\s*"ArrowUp"|atalho escondido|segredo dos bichinhos|parada dos bichinhos/i.test(readFileSync(caminho, "utf8")) && nome !== "Slot.tsx") achados.push(caminho);
      }
    };
    varrer(raiz);
    expect(achados).toEqual([]);
    const slot = readFileSync(join(raiz, "bichinho", "Slot.tsx"), "utf8");
    expect(slot).not.toMatch(/(aria-label|title)=(\{`[^`]*|"[^"]*)(shift|passeio|segredo)/i);
  });
});
