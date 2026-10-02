// TRAVESSURAS (D-654): os bichinhos soltos "pegam" um ícone, selo ou texto pequeno da casca e o carregam para outro ponto. É SÓ VISUAL e
// reversível: o elemento REAL é deslocado pelas propriedades CSS individuais `translate`/`rotate` via Web Animations API
// (`el.animate(..., { fill: "forwards" })`), que COMPÕEM com o `transform` que o elemento já tenha. Nada de DOM, estilo inline, classe, atributo,
// estado do React nem layout mudam; restaurar = `animation.cancel()`.
//
// Defesas (todas testadas): lista branca por região/tamanho/tipo; lista PROIBIDA (terminal, campos, foco, diálogos, menus, popovers, aria-live,
// `data-sem-travessura`); ≤ 3 simultâneas e ≤ 1 por bichinho; restauração em ≤ 150 ms na primeira atividade, e imediata em visibilitychange/blur/
// troca de tela/diálogo/menu/popover/unmount/beforeunload; failsafe de 90 s por travessura; try/finally em todo caminho; e o primeiro
// pointerdown/click logo após o retorno é descartado se cair sobre um elemento que estava deslocado.
import type { Retangulo } from "./geometria";

export const LIMITE_TRAVESSURAS = 3;
export const LARGURA_MAX = 180;
export const ALTURA_MAX = 64;
export const LADO_MIN = 8;
export const FAILSAFE_MS = 90_000;
export const RESTAURAR_MS = 140;
export const JANELA_DESCARTE_MS = 250;
const VALIDADE_DO_CLIQUE_MS = 1_200;

/** Regiões onde se pode pegar coisas: menu, barra do topo, rodapé, painel de workspaces e títulos curtos da tela. */
export const REGIOES_PERMITIDAS = ".menu, .casca-topo, .rodape, .painel-ws, main h1, main h2, main h3";

/** Nunca mover: o elemento, qualquer ancestral ou qualquer descendente com isto vira recusa. */
export const PROIBIDOS = [
  ".xterm", "[class*='terminais-']", ".terminais", ".terminal", "input", "textarea", "select", "[contenteditable]:not([contenteditable='false'])",
  "dialog", "[role='dialog']", "[role='alertdialog']", "[aria-modal='true']", "[role='menu']", "[role='menubar']", "[role='listbox']", "[role='tooltip']", "[role='combobox']",
  ".bi-popover", ".pws-menu", "[popover]", "[aria-live]", "[role='status']", "[role='alert']", "[data-sem-travessura]", "[data-passeio-camada]", "[data-bichinho-slot]", ".bi", ".bi-mini", ".pb-casinha", "[hidden]", "[inert]",
].join(", ");

/** Diálogo, menu ou popover aberto: nenhuma travessura começa e as ativas se desfazem. */
export const SOBREPOSTOS = "dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true'], [role='menu'], [role='listbox'], .bi-popover, .pws-menu, [popover]:popover-open";

export const SEMENTES_DE_SELETOR = "svg, button, [class*='selo'], [class*='chip'], [class*='badge'], .rodape-item, .rodape-sinal, h1, h2, h3, span, small, strong, b";

const TEXTO_CURTO_MAX = 40;

export interface DepsClassificacao { doc: Document; win: Pick<Window, "innerWidth" | "innerHeight" | "getComputedStyle">; emMovimento: (el: Element) => boolean }

const retanguloDe = (el: Element): Retangulo => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };

/** Por que um elemento NÃO pode ser pego (texto para teste e depuração), ou `null` se pode. */
export function motivoDaRecusa(el: Element, d: DepsClassificacao): string | null {
  if (!el.isConnected) return "fora do documento";
  if (el.closest(PROIBIDOS) !== null) return "proibido";
  if (el.querySelector(PROIBIDOS) !== null) return "contém proibido";
  if (el.closest(REGIOES_PERMITIDAS) === null) return "fora das regiões permitidas";
  if (d.doc.querySelector(SOBREPOSTOS) !== null) return "sobreposto aberto";
  const foco = d.doc.activeElement;
  if (foco !== null && foco !== d.doc.body && (el.contains(foco) || foco.contains(el))) return "tem foco";
  if (d.emMovimento(el)) return "já em movimento";
  try { if (el.getAnimations().length > 0) return "já animado"; } catch { /* sem WAAPI: segue */ }
  const r = retanguloDe(el);
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  if (w < LADO_MIN || h < LADO_MIN) return "pequeno demais";
  if (w > LARGURA_MAX || h > ALTURA_MAX) return "grande demais";
  if (r.left < 0 || r.top < 0 || r.right > d.win.innerWidth || r.bottom > d.win.innerHeight) return "fora da janela";
  const estilo = d.win.getComputedStyle(el);
  if (estilo.display === "none" || estilo.visibility === "hidden" || Number(estilo.opacity) === 0) return "invisível";
  if ((estilo.translate !== undefined && estilo.translate !== "" && estilo.translate !== "none") || (estilo.rotate !== undefined && estilo.rotate !== "" && estilo.rotate !== "none")) return "já usa translate/rotate";
  return tipoDoElemento(el) === null ? "tipo fora da lista branca" : null;
}

export type TipoCandidato = "icone" | "selo" | "texto" | "botao_icone";

/** Lista branca por heurística: ícone, selo/chip/badge, botão só de ícone ou rótulo de texto curto. */
export function tipoDoElemento(el: Element): TipoCandidato | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "svg") return "icone";
  const classe = typeof el.className === "string" ? el.className : "";
  if (/selo|chip|badge/.test(classe)) return "selo";
  if (tag === "button") {
    const semTexto = (el.textContent ?? "").trim() === "";
    return semTexto && el.querySelector("svg") !== null ? "botao_icone" : null;
  }
  const texto = (el.textContent ?? "").trim();
  if (el.children.length === 0 && texto.length >= 1 && texto.length <= TEXTO_CURTO_MAX && /^(h1|h2|h3|span|small|strong|b)$/.test(tag)) return "texto";
  if (/rodape-item|rodape-sinal/.test(classe) && texto.length <= TEXTO_CURTO_MAX) return "texto";
  return null;
}

/** Nada mais recortar o elemento: o retângulo do ancestral que corta o que sai dele (overflow, contain: paint, content-visibility) ou a janela. */
export function limiteDeRecorte(el: Element, d: Pick<DepsClassificacao, "win">): Retangulo {
  const janela: Retangulo = { left: 0, top: 0, right: d.win.innerWidth, bottom: d.win.innerHeight };
  let atual = el.parentElement;
  let n = 0;
  let r = janela;
  while (atual !== null && atual !== el.ownerDocument.body && n++ < 16) {
    const e = d.win.getComputedStyle(atual);
    const corta = (v: string | undefined): boolean => v !== undefined && v !== "" && v !== "visible";
    const contem = `${e.contain ?? ""} ${(e as { contentVisibility?: string }).contentVisibility ?? ""}`;
    if (corta(e.overflowX) || corta(e.overflowY) || /paint|strict|content|auto/.test(contem)) {
      const a = retanguloDe(atual);
      r = { left: Math.max(r.left, a.left), top: Math.max(r.top, a.top), right: Math.min(r.right, a.right), bottom: Math.min(r.bottom, a.bottom) };
    }
    atual = atual.parentElement;
  }
  return r;
}

/** Candidatos agora: uma varredura (≤ 300 nós) por passeio, nunca por quadro. */
export function coletarCandidatos(d: DepsClassificacao, max = 40): HTMLElement[] {
  const achados: HTMLElement[] = [];
  const nos = d.doc.querySelectorAll<HTMLElement>(SEMENTES_DE_SELETOR);
  let lidos = 0;
  for (const el of nos) {
    if (lidos++ >= 300 || achados.length >= max) break;
    if (el.closest(REGIOES_PERMITIDAS) === null) continue;
    if (motivoDaRecusa(el, d) === null) achados.push(el);
  }
  return achados;
}

/** Escolha determinística (semente) de um candidato; nunca um que já tenha dono. */
export function escolherCandidato(candidatos: readonly HTMLElement[], u: number, indisponiveis: ReadonlySet<Element>): HTMLElement | null {
  const livres = candidatos.filter((c) => !indisponiveis.has(c) && ![...indisponiveis].some((o) => o.contains(c) || c.contains(o)));
  return livres.length === 0 ? null : livres[Math.min(livres.length - 1, Math.floor(u * livres.length))]!;
}

export interface Deslocamento { dx: number; dy: number; rot: number }
const css = (d: Deslocamento): { translate: string; rotate: string } => ({ translate: `${d.dx}px ${d.dy}px`, rotate: `${d.rot}deg` });
const ZERO: Deslocamento = { dx: 0, dy: 0, rot: 0 };

interface Entrada { dono: string; atual: Deslocamento; animacoes: Set<Animation>; rectAntes: Retangulo; failsafe: unknown }

export interface DepsRegistro {
  doc: Document;
  win: Pick<Window, "addEventListener" | "removeEventListener" | "innerWidth" | "innerHeight" | "getComputedStyle">;
  setT: (f: () => void, ms: number) => unknown;
  clearT: (t: unknown) => void;
  agora: () => number;
}

/**
 * Registro ÚNICO das travessuras ativas. Toda animação criada passa por aqui; `restaurarTudo` é idempotente e nunca lança.
 */
export function criarRegistro(d: DepsRegistro) {
  const entradas = new Map<Element, Entrada>();
  let armadilha: { ate: number; elementos: Array<{ atual: Retangulo; original: Retangulo }>; usada: boolean; limpar: () => void } | null = null;
  let observadores: MutationObserver[] = [];
  let telaAoIniciar: string | null = null;
  const aoSumir = new Set<() => void>();

  const tela = (): string | null => d.doc.querySelector<HTMLElement>("[data-tela]:not([hidden])")?.dataset["tela"] ?? null;
  const cancelar = (e: Entrada): void => { for (const a of e.animacoes) { try { a.cancel(); } catch { /* já cancelada */ } } e.animacoes.clear(); };

  function soltarObservadores(): void { for (const o of observadores) { try { o.disconnect(); } catch { /* idem */ } } observadores = []; }
  function observar(): void {
    if (observadores.length > 0 || typeof MutationObserver === "undefined") return;
    telaAoIniciar = tela();
    try {
      const a = new MutationObserver(() => { if (d.doc.querySelector(SOBREPOSTOS) !== null) restaurarTudo({ animado: false }); });
      a.observe(d.doc.body, { childList: true, subtree: false });
      const b = new MutationObserver(() => { if (tela() !== telaAoIniciar || d.doc.querySelector(SOBREPOSTOS) !== null) restaurarTudo({ animado: false }); });
      const principal = d.doc.querySelector("main");
      if (principal !== null) b.observe(principal, { attributes: true, attributeFilter: ["hidden"], subtree: true });
      observadores = [a, b];
    } catch { /* sem observador: os pontos de checagem dos trechos cobrem */ }
  }

  function pegar(el: Element, dono: string): boolean {
    if (entradas.has(el) || entradas.size >= LIMITE_TRAVESSURAS) return false;
    if ([...entradas.values()].some((e) => e.dono === dono)) return false;
    const e: Entrada = { dono, atual: ZERO, animacoes: new Set(), rectAntes: retanguloDe(el), failsafe: null };
    e.failsafe = d.setT(() => restaurar(el, { animado: false }), FAILSAFE_MS);
    entradas.set(el, e);
    observar();
    return true;
  }

  /** Desloca o elemento de onde está para `para` em `ms`, com as keyframes calculadas UMA vez (nada por quadro). */
  function mover(el: Element, para: Deslocamento, ms: number, opc: { easing?: string; meio?: Deslocamento } = {}): void {
    const e = entradas.get(el);
    if (e === undefined) return;
    try {
      const quadros: Keyframe[] = [css(e.atual), ...(opc.meio === undefined ? [] : [css(opc.meio)]), css(para)];
      const anterior = [...e.animacoes];
      const a = el.animate(quadros, { duration: Math.max(1, ms), easing: opc.easing ?? "linear", fill: "forwards" });
      e.animacoes.add(a);
      for (const velha of anterior) { try { velha.cancel(); } catch { /* idem */ } e.animacoes.delete(velha); }
      e.atual = para;
    } catch { restaurar(el, { animado: false }); }
  }

  function restaurar(el: Element, opc: { animado: boolean }): void {
    const e = entradas.get(el);
    if (e === undefined) return;
    entradas.delete(el);
    if (entradas.size === 0) soltarObservadores();
    try { if (e.failsafe !== null) d.clearT(e.failsafe); } catch { /* idem */ }
    try {
      if (opc.animado && e.animacoes.size > 0) {
        const estilo = d.win.getComputedStyle(el);
        const de = { translate: estilo.translate && estilo.translate !== "none" ? estilo.translate : css(e.atual).translate, rotate: estilo.rotate && estilo.rotate !== "none" ? estilo.rotate : css(e.atual).rotate };
        const volta = el.animate([de, { translate: "0px 0px", rotate: "0deg" }], { duration: RESTAURAR_MS, easing: "cubic-bezier(.2,.8,.3,1)", fill: "none" });
        cancelar(e); // a animação de volta cobre o quadro: o elemento não pisca
        e.animacoes.add(volta);
        const fim = (): void => { try { volta.cancel(); } catch { /* idem */ } };
        volta.onfinish = fim;
        d.setT(fim, RESTAURAR_MS + 40); // garantia: mesmo sem `finish`, nada fica para trás
        return;
      }
    } catch { /* cai no cancelamento seco abaixo */ }
    finally { if (!opc.animado) cancelar(e); }
    cancelar(e);
  }

  function restaurarDe(dono: string, opc: { animado: boolean }): void {
    for (const [el, e] of [...entradas]) if (e.dono === dono) restaurar(el, opc);
    if (entradas.size === 0) soltarObservadores();
  }

  function restaurarTudo(opc: { animado: boolean }): void {
    const lista = [...entradas.entries()];
    if (lista.length === 0) return;
    // `try/finally`: mesmo se medir ou animar lançar, o cancelamento seco abaixo roda
    try {
      if (opc.animado) armarDescarte(lista.map(([el, e]) => ({ el, e })));
      for (const [el] of lista) { try { restaurar(el, opc); } catch { /* segue para o próximo */ } }
    } finally {
      for (const e of entradas.values()) { try { cancelar(e); } catch { /* idem */ } } // sobra de algum `restaurar` interrompido
      entradas.clear();
      soltarObservadores();
      for (const f of [...aoSumir]) { try { f(); } catch { /* idem */ } }
    }
  }

  /** Depois de restaurar com animação: o primeiro pointerdown/click sobre onde o elemento ESTAVA ou ONDE ele voltará é descartado. */
  function armarDescarte(lista: Array<{ el: Element; e: Entrada }>): void {
    desarmar();
    const elementos = lista.map(({ el, e }) => {
      const r = retanguloDe(el);
      return { atual: r, original: { left: r.left - e.atual.dx, top: r.top - e.atual.dy, right: r.right - e.atual.dx, bottom: r.bottom - e.atual.dy } };
    });
    const t0 = d.agora();
    const dentro = (r: Retangulo, x: number, y: number): boolean => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
    const sobreDeslocado = (ev: MouseEvent): boolean => elementos.some((x) => dentro(x.atual, ev.clientX, ev.clientY) || dentro(x.original, ev.clientX, ev.clientY));
    let pointerDescartado = false;
    const ouvir = (ev: Event): void => {
      const m = ev as MouseEvent;
      const agora = d.agora();
      if (ev.type === "pointerdown" || ev.type === "mousedown") {
        if (agora - t0 > JANELA_DESCARTE_MS || !sobreDeslocado(m)) return;
        pointerDescartado = true;
        ev.preventDefault(); ev.stopPropagation();
      } else if (pointerDescartado && agora - t0 <= VALIDADE_DO_CLIQUE_MS) { // mouseup/click do MESMO gesto
        ev.preventDefault(); ev.stopPropagation();
        if (ev.type === "click") desarmar();
      }
    };
    const tipos = ["pointerdown", "mousedown", "mouseup", "pointerup", "click"] as const;
    for (const t of tipos) d.win.addEventListener(t, ouvir, true);
    const timer = d.setT(() => desarmar(), VALIDADE_DO_CLIQUE_MS);
    const limpar = (): void => { for (const t of tipos) d.win.removeEventListener(t, ouvir, true); d.clearT(timer); };
    armadilha = { ate: t0 + JANELA_DESCARTE_MS, elementos, usada: false, limpar };
  }
  function desarmar(): void { if (armadilha !== null) { armadilha.limpar(); armadilha = null; } }

  return {
    pegar, mover, restaurar, restaurarDe, restaurarTudo,
    ativas: (): number => entradas.size,
    estaMovido: (el: Element): boolean => entradas.has(el),
    emMovimento: (el: Element): boolean => [...entradas.keys()].some((k) => k === el || k.contains(el) || el.contains(k)),
    elementos: (): ReadonlySet<Element> => new Set(entradas.keys()),
    donoDe: (el: Element): string | undefined => entradas.get(el)?.dono,
    deslocamentoDe: (el: Element): Deslocamento | undefined => entradas.get(el)?.atual,
    aoRestaurarTudo(f: () => void): () => void { aoSumir.add(f); return () => void aoSumir.delete(f); },
    /** só para o teste do invariante: nada de listeners/observadores/timers residuais. */
    residuos: (): { entradas: number; armadilha: boolean; observadores: number } => ({ entradas: entradas.size, armadilha: armadilha !== null, observadores: observadores.length }),
    desarmar,
  };
}
export type RegistroTravessuras = ReturnType<typeof criarRegistro>;
