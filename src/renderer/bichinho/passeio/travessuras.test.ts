// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAILSAFE_MS, LIMITE_TRAVESSURAS, RESTAURAR_MS, coletarCandidatos, criarRegistro, escolherCandidato, motivoDaRecusa, tipoDoElemento } from "./travessuras";

const caixa = (el: Element, l = 20, t = 100, w = 24, h = 24): void => { (el as HTMLElement).getBoundingClientRect = () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => ({}) }) as DOMRect; };
const deps = () => ({ doc: document, win: window, emMovimento: () => false });

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

/** monta `<div class=menu>…</div>` com o HTML dado e devolve o elemento marcado com data-alvo. */
function montar(html: string, regiao = "menu"): HTMLElement {
  const raiz = document.createElement("div");
  raiz.className = regiao;
  raiz.innerHTML = html;
  document.body.append(raiz);
  const alvo = raiz.querySelector<HTMLElement>("[data-alvo]")!;
  for (const e of raiz.querySelectorAll("*")) caixa(e);
  return alvo;
}

describe("lista branca", () => {
  it.each([
    ["ícone svg", `<button aria-label="x"><svg data-alvo class="icone"></svg></button>`, "icone"],
    ["selo", `<span data-alvo class="menu-selo">3</span>`, "selo"],
    ["chip", `<span data-alvo class="meu-chip">ok</span>`, "selo"],
    ["botão só de ícone", `<button data-alvo><svg></svg></button>`, "botao_icone"],
    ["rótulo curto", `<span data-alvo>Terminais</span>`, "texto"],
    ["título curto", `<h3 data-alvo>Início</h3>`, "texto"],
  ])("aceita %s", (_n, html, tipo) => {
    const el = montar(html);
    expect(tipoDoElemento(el)).toBe(tipo);
    expect(motivoDaRecusa(el, deps())).toBeNull();
  });
  it("aceita títulos curtos dentro de main", () => {
    document.body.innerHTML = `<main><h2 data-alvo>Missões</h2></main>`;
    const el = document.querySelector<HTMLElement>("[data-alvo]")!;
    caixa(el);
    expect(motivoDaRecusa(el, deps())).toBeNull();
  });
});

describe("lista proibida: nunca é escolhido", () => {
  const casos: Array<[string, string, string]> = [
    ["input", `<input data-alvo>`, "menu"],
    ["textarea", `<textarea data-alvo></textarea>`, "menu"],
    ["select", `<select data-alvo></select>`, "menu"],
    ["contenteditable", `<span data-alvo contenteditable="true">x</span>`, "menu"],
    ["dentro do xterm", `<div class="xterm"><span data-alvo>x</span></div>`, "menu"],
    ["dentro de área de terminais-*", `<div class="terminais-saida"><span data-alvo>x</span></div>`, "menu"],
    ["dentro de dialog", `<dialog open><span data-alvo>x</span></dialog>`, "menu"],
    ["role=dialog", `<div role="dialog"><span data-alvo>x</span></div>`, "menu"],
    ["role=alertdialog", `<div role="alertdialog"><span data-alvo>x</span></div>`, "menu"],
    ["aria-modal", `<div aria-modal="true"><span data-alvo>x</span></div>`, "menu"],
    ["role=menu aberto", `<div role="menu"><span data-alvo>x</span></div>`, "menu"],
    ["role=listbox", `<div role="listbox"><span data-alvo>x</span></div>`, "menu"],
    ["aria-live", `<div aria-live="polite"><span data-alvo>x</span></div>`, "menu"],
    ["role=status", `<div role="status"><span data-alvo>x</span></div>`, "menu"],
    ["role=alert", `<div role="alert"><span data-alvo>x</span></div>`, "menu"],
    ["data-sem-travessura no próprio", `<span data-alvo data-sem-travessura>x</span>`, "menu"],
    ["dentro de data-sem-travessura (botão Terminar)", `<div data-sem-travessura><span data-alvo>x</span></div>`, "menu"],
    ["popover do bichinho", `<div class="bi-popover"><span data-alvo>x</span></div>`, "menu"],
    ["menu flutuante dos cartões", `<div class="pws-menu"><span data-alvo>x</span></div>`, "menu"],
    ["contém um campo", `<div data-alvo><input></div>`, "menu"],
    ["hidden", `<div hidden><span data-alvo>x</span></div>`, "menu"],
    ["sprite do bichinho", `<svg data-alvo class="bi"></svg>`, "menu"],
    ["a própria camada", `<div data-passeio-camada><span data-alvo>x</span></div>`, "menu"],
    ["fora das regiões permitidas", `<span data-alvo>x</span>`, "outra-coisa"],
  ];
  it.each(casos)("%s", (_n, html, regiao) => {
    const el = montar(html, regiao);
    expect(motivoDaRecusa(el, deps())).not.toBeNull();
    expect(coletarCandidatos(deps())).not.toContain(el);
  });
  it("elemento com foco e o contêiner do foco", () => {
    const el = montar(`<div data-alvo><button id="f">x</button></div><span>ok</span>`);
    document.getElementById("f")!.focus();
    expect(motivoDaRecusa(el, deps())).toBe("tem foco");
    const botao = document.getElementById("f")!;
    expect(motivoDaRecusa(botao, deps())).toBe("tem foco");
  });
  it("tamanho: grande demais, pequeno demais; fora da janela; invisível", () => {
    const g = montar(`<span data-alvo>x</span>`); caixa(g, 10, 100, 181, 20);
    expect(motivoDaRecusa(g, deps())).toBe("grande demais");
    const alto = montar(`<span data-alvo>x</span>`); caixa(alto, 10, 100, 20, 65);
    expect(motivoDaRecusa(alto, deps())).toBe("grande demais");
    const p = montar(`<span data-alvo>x</span>`); caixa(p, 10, 100, 4, 4);
    expect(motivoDaRecusa(p, deps())).toBe("pequeno demais");
    const f = montar(`<span data-alvo>x</span>`); caixa(f, 5000, 100, 20, 20);
    expect(motivoDaRecusa(f, deps())).toBe("fora da janela");
    const neg = montar(`<span data-alvo>x</span>`); caixa(neg, -10, 100, 20, 20);
    expect(motivoDaRecusa(neg, deps())).toBe("fora da janela");
    const i = montar(`<span data-alvo style="visibility:hidden">x</span>`);
    expect(motivoDaRecusa(i, deps())).toBe("invisível");
    const d = montar(`<span data-alvo style="display:none">x</span>`);
    expect(motivoDaRecusa(d, deps())).toBe("invisível");
  });
  it("com diálogo/menu/popover aberto em qualquer lugar nada é escolhido", () => {
    const el = montar(`<span data-alvo>x</span>`);
    const dlg = document.createElement("div"); dlg.setAttribute("role", "dialog"); document.body.append(dlg);
    expect(motivoDaRecusa(el, deps())).toBe("sobreposto aberto");
    expect(coletarCandidatos(deps())).toEqual([]);
  });
  it("já em movimento, já animado e quem já usa translate/rotate", () => {
    const a = montar(`<span data-alvo>x</span>`);
    expect(motivoDaRecusa(a, { ...deps(), emMovimento: () => true })).toBe("já em movimento");
    const b = montar(`<span data-alvo>x</span>`);
    (b as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [{}];
    expect(motivoDaRecusa(b, deps())).toBe("já animado");
    const c = montar(`<span data-alvo style="translate: 5px 0px">x</span>`);
    expect(motivoDaRecusa(c, deps())).toBe("já usa translate/rotate");
  });
  it("texto longo, botão com texto e elemento fora do documento não são candidatos", () => {
    const longo = montar(`<span data-alvo>${"x".repeat(41)}</span>`);
    expect(tipoDoElemento(longo)).toBeNull();
    const botao = montar(`<button data-alvo>Salvar</button>`);
    expect(tipoDoElemento(botao)).toBeNull();
    const solto = document.createElement("span");
    expect(motivoDaRecusa(solto, deps())).toBe("fora do documento");
  });
  it("escolha determinística por semente e nunca um que já tenha dono (nem ancestral/descendente)", () => {
    const raiz = document.createElement("div");
    const xs = Array.from({ length: 5 }, () => { const s = document.createElement("span"); raiz.append(s); return s; });
    expect(escolherCandidato(xs, 0.5, new Set())).toBe(escolherCandidato(xs, 0.5, new Set()));
    const sem = escolherCandidato(xs, 0.0, new Set([xs[0]!]));
    expect(sem).toBe(xs[1]);
    expect(escolherCandidato(xs, 0.9, new Set(xs))).toBeNull();
    expect(escolherCandidato([xs[0]!], 0.1, new Set([raiz]))).toBeNull();
  });
});

// ---- registro (WAAPI com dublê) ----
function dubla(el: Element) {
  const todas: Array<{ cancel: ReturnType<typeof vi.fn>; keyframes: Keyframe[]; onfinish: (() => void) | null; cancelada: boolean }> = [];
  (el as unknown as { animate: unknown }).animate = vi.fn((keyframes: Keyframe[]) => {
    const a = { keyframes, onfinish: null as null | (() => void), cancelada: false, cancel: vi.fn(() => { a.cancelada = true; }) };
    todas.push(a);
    return a;
  });
  return todas;
}
function registro() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  return criarRegistro({ doc: document, win: window, setT: (f, t) => setTimeout(f, t), clearT: (t) => clearTimeout(t as never), agora: () => Date.now() });
}
const mk = (n: number): HTMLElement[] => Array.from({ length: n }, (_, i) => { const s = document.createElement("span"); s.id = `e${i}`; s.textContent = "x"; caixa(s, 20 + i * 30, 100); document.body.append(s); return s; });
const semResiduos = (r: ReturnType<typeof registro>, els: Element[], anim: Array<Array<{ cancelada: boolean }>>) => {
  expect(r.residuos()).toEqual({ entradas: 0, armadilha: false, observadores: 0 });
  for (const lista of anim) for (const a of lista) expect(a.cancelada).toBe(true);
  for (const e of els) expect(r.estaMovido(e)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
};

describe("registro de travessuras: invariante de restauração", () => {
  it("anima SÓ translate/rotate (compõe com transform) e nunca mexe em DOM, estilo, classe ou atributo", () => {
    const r = registro();
    const [a] = mk(1);
    const antes = a!.outerHTML;
    const anim = dubla(a!);
    expect(r.pegar(a!, "slot")).toBe(true);
    r.mover(a!, { dx: 50, dy: -20, rot: 8 }, 600);
    expect(Object.keys(anim[0]!.keyframes[1]!)).toEqual(["translate", "rotate"]);
    expect(anim[0]!.keyframes[1]).toEqual({ translate: "50px -20px", rotate: "8deg" });
    expect(a!.outerHTML).toBe(antes);
    r.restaurarTudo({ animado: false });
  });
  it("limites: ≤ 3 simultâneas e ≤ 1 por bichinho", () => {
    const r = registro();
    const els = mk(5);
    els.forEach(dubla);
    expect(r.pegar(els[0]!, "a")).toBe(true);
    expect(r.pegar(els[1]!, "a")).toBe(false);
    expect(r.pegar(els[1]!, "b")).toBe(true);
    expect(r.pegar(els[2]!, "c")).toBe(true);
    expect(r.pegar(els[3]!, "d")).toBe(false);
    expect(r.pegar(els[0]!, "z")).toBe(false);
    expect(r.ativas()).toBe(LIMITE_TRAVESSURAS);
    r.restaurarTudo({ animado: false });
  });
  it("(a) primeira atividade: restaura em ≤ 150 ms e não deixa nada", () => {
    const r = registro();
    const els = mk(2);
    const anim = els.map(dubla);
    els.forEach((e, i) => { r.pegar(e, `d${i}`); r.mover(e, { dx: 40, dy: 10, rot: 5 }, 500); });
    r.restaurarTudo({ animado: true });
    const voltas = anim.map((l) => l[l.length - 1]!);
    expect(els.every((e) => (e.animate as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].duration <= 150)).toBe(true);
    expect(RESTAURAR_MS).toBeLessThanOrEqual(150);
    vi.advanceTimersByTime(RESTAURAR_MS + 60);
    expect(voltas.every((a) => a.cancelada)).toBe(true);
    r.desarmar();
    semResiduos(r, els, anim);
  });
  it.each([
    ["visibilitychange/blur/unmount/beforeunload (seco)", (r: ReturnType<typeof registro>) => r.restaurarTudo({ animado: false })],
    ["trabalho voltou (por dono)", (r: ReturnType<typeof registro>) => { r.restaurarDe("d0", { animado: true }); r.restaurarDe("d1", { animado: true }); vi.advanceTimersByTime(300); }],
    ["failsafe de 90 s", () => { vi.advanceTimersByTime(FAILSAFE_MS + 10); }],
  ])("%s: nenhum elemento fica com animação residual", (_n, caminho) => {
    const r = registro();
    const els = mk(2);
    const anim = els.map(dubla);
    els.forEach((e, i) => { r.pegar(e, `d${i}`); r.mover(e, { dx: 40, dy: 10, rot: 5 }, 500); });
    (caminho as (r: ReturnType<typeof registro>) => void)(r);
    vi.advanceTimersByTime(500);
    r.desarmar();
    semResiduos(r, els, anim);
  });
  it("(f) exceção ao animar: o elemento é restaurado e nada fica", () => {
    const r = registro();
    const [a, b] = mk(2);
    const anim = dubla(a!);
    r.pegar(a!, "x");
    r.mover(a!, { dx: 10, dy: 0, rot: 0 }, 100);
    (a!.animate as unknown) = () => { throw new Error("falhou"); };
    expect(() => r.mover(a!, { dx: 20, dy: 0, rot: 0 }, 100)).not.toThrow();
    expect(r.estaMovido(a!)).toBe(false);
    expect(anim[0]!.cancelada).toBe(true);
    // e a restauração animada que lança também termina limpa
    dubla(b!);
    r.pegar(b!, "y");
    r.mover(b!, { dx: 10, dy: 0, rot: 0 }, 100);
    (b!.animate as unknown) = () => { throw new Error("falhou"); };
    expect(() => r.restaurarTudo({ animado: true })).not.toThrow();
    r.desarmar();
    expect(r.residuos()).toEqual({ entradas: 0, armadilha: false, observadores: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("(c) diálogo/menu/popover que aparece no body desfaz tudo na hora; troca de tela também", async () => {
    document.body.innerHTML = `<main><div data-tela="a"></div><div data-tela="b" hidden></div></main>`;
    const r = registro();
    const [a] = mk(1);
    const anim = dubla(a!);
    r.pegar(a!, "x"); r.mover(a!, { dx: 5, dy: 5, rot: 1 }, 100);
    expect(r.residuos().observadores).toBe(2);
    const dlg = document.createElement("div"); dlg.setAttribute("role", "dialog"); document.body.append(dlg);
    await Promise.resolve(); await Promise.resolve();
    expect(r.ativas()).toBe(0);
    expect(anim[0]!.cancelada).toBe(true);
    expect(r.residuos().observadores).toBe(0);
    dlg.remove();
    const [b] = mk(1);
    const anim2 = dubla(b!);
    r.pegar(b!, "y"); r.mover(b!, { dx: 5, dy: 5, rot: 1 }, 100);
    document.querySelector("[data-tela=a]")!.setAttribute("hidden", ""); document.querySelector("[data-tela=b]")!.removeAttribute("hidden");
    await Promise.resolve(); await Promise.resolve();
    expect(r.ativas()).toBe(0);
    expect(anim2[0]!.cancelada).toBe(true);
    expect(r.residuos()).toEqual({ entradas: 0, armadilha: false, observadores: 0 });
  });
});

describe("descarte do primeiro clique após o retorno", () => {
  function clique(tipo: string, x: number, y: number): { cancelado: boolean; propagou: boolean } {
    let propagou = false;
    const spy = () => { propagou = true; };
    document.addEventListener(tipo, spy);
    const ev = new MouseEvent(tipo, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    document.removeEventListener(tipo, spy);
    return { cancelado: ev.defaultPrevented, propagou };
  }
  function cena() {
    const r = registro();
    const [a] = mk(1);
    caixa(a!, 100, 100, 24, 24);
    dubla(a!);
    r.pegar(a!, "x");
    r.mover(a!, { dx: 200, dy: 0, rot: 0 }, 100);
    return { r, a: a! };
  }
  it("descarta pointerdown e click sobre onde o elemento estava deslocado (nos primeiros 250 ms)", () => {
    const { r, a } = cena();
    caixa(a, 300, 100, 24, 24); // posição deslocada medida ao restaurar
    r.restaurarTudo({ animado: true });
    vi.advanceTimersByTime(100);
    const p = clique("pointerdown", 310, 110);
    expect(p).toEqual({ cancelado: true, propagou: false });
    const c = clique("click", 310, 110);
    expect(c).toEqual({ cancelado: true, propagou: false });
    // depois do click o descarte acaba: o próximo gesto passa
    expect(clique("pointerdown", 310, 110).cancelado).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(r.residuos().armadilha).toBe(false);
  });
  it("descarta também onde o elemento VOLTARÁ (a posição original)", () => {
    const { r, a } = cena();
    caixa(a, 300, 100, 24, 24);
    r.restaurarTudo({ animado: true });
    expect(clique("pointerdown", 110, 110).cancelado).toBe(true); // 300 - 200 = 100 (origem)
    vi.advanceTimersByTime(2_000);
  });
  it("NÃO descarta clique longe de qualquer elemento deslocado, nem depois de 250 ms", () => {
    const { r, a } = cena();
    caixa(a, 300, 100, 24, 24);
    r.restaurarTudo({ animado: true });
    expect(clique("pointerdown", 700, 500).cancelado).toBe(false);
    vi.advanceTimersByTime(260);
    expect(clique("pointerdown", 310, 110).cancelado).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(r.residuos().armadilha).toBe(false);
  });
  it("restauração seca (sem retorno do usuário) não arma descarte", () => {
    const { r } = cena();
    r.restaurarTudo({ animado: false });
    expect(r.residuos().armadilha).toBe(false);
  });
});
