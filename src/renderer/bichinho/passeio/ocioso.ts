// Detector barato de ociosidade do USUÁRIO (D-652): listeners passivos (pointermove/pointerdown/keydown/wheel/touchstart/focus/visibilitychange)
// e UM único setTimeout reprogramado — ao disparar, confere a hora e rearma só pelo que falta. Sem setInterval, sem rAF. Eventos são
// regulados a 1 por segundo enquanto o usuário está ativo; ao sair do ocioso, a primeira ação passa na hora (o retorno não pode esperar).
export const THROTTLE_MS = 1_000;
/** O navegador emite movimentos falsos quando o layout muda debaixo do cursor: menos que isso não conta. */
export const MOVIMENTO_MINIMO_PX = 4;
export const OCIOSIDADE_PADRAO_MIN = 3;
export const OCIOSIDADE_MIN = 1;
export const OCIOSIDADE_MAX = 30;

export type TipoAtividade = "ponteiro" | "clique" | "tecla" | "escape" | "rolagem" | "toque" | "foco" | "volta";

export interface DepsDetector {
  alvo: Pick<Window, "addEventListener" | "removeEventListener">;
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  agora: () => number;
  setT: (f: () => void, ms: number) => unknown;
  clearT: (t: unknown) => void;
  /** tempo de ociosidade em ms (relido a cada disparo; mudá-lo vale na hora via `reprogramar`). */
  ms: () => number;
  /** o tempo passou sem atividade. */
  aoOcioso: () => void;
  /** houve atividade. `quieto` diz se estava ocioso até agora. */
  aoAtividade: (tipo: TipoAtividade, quieto: boolean) => void;
}

export const limitarMinutos = (m: unknown): number => (typeof m === "number" && Number.isFinite(m) ? Math.min(OCIOSIDADE_MAX, Math.max(OCIOSIDADE_MIN, Math.round(m))) : OCIOSIDADE_PADRAO_MIN);

export function criarDetector(d: DepsDetector) {
  let ligado = false;
  let quieto = false;
  let ultima = d.agora();
  let timer: unknown = null;
  let x = Number.NaN;
  let y = Number.NaN;

  const armar = (espera: number): void => { if (timer !== null) d.clearT(timer); timer = d.setT(conferir, Math.max(0, espera)); };
  function conferir(): void {
    timer = null;
    if (!ligado) return;
    const falta = ultima + d.ms() - d.agora();
    if (falta > 0) { armar(falta); return; }
    quieto = true;
    d.aoOcioso();
  }
  const agir = (tipo: TipoAtividade): void => {
    const agora = d.agora();
    if (!quieto && agora - ultima < THROTTLE_MS && tipo !== "escape" && tipo !== "clique") return; // regula a 1/s; o timer único confere a hora ao disparar
    ultima = agora;
    const estava = quieto;
    quieto = false;
    if (estava) armar(d.ms());
    d.aoAtividade(tipo, estava);
  };
  const aoMover = (e: Event): void => {
    const p = e as PointerEvent;
    const andou = Number.isNaN(x) || Math.hypot(p.clientX - x, p.clientY - y) >= MOVIMENTO_MINIMO_PX;
    if (!andou) return;
    x = p.clientX; y = p.clientY;
    agir("ponteiro");
  };
  const aoTeclar = (e: Event): void => agir((e as KeyboardEvent).key === "Escape" ? "escape" : "tecla");
  const aoClicar = (): void => agir("clique");
  const aoRolar = (): void => agir("rolagem");
  const aoTocar = (): void => agir("toque");
  const aoFocar = (): void => agir("foco");
  const aoVoltar = (): void => { if (d.doc.visibilityState !== "hidden") agir("volta"); };
  const opc = { passive: true, capture: true } as const;

  return {
    iniciar(): void {
      if (ligado) return;
      ligado = true; quieto = false; ultima = d.agora();
      d.alvo.addEventListener("pointermove", aoMover, opc);
      d.alvo.addEventListener("pointerdown", aoClicar, opc);
      d.alvo.addEventListener("keydown", aoTeclar, opc);
      d.alvo.addEventListener("wheel", aoRolar, opc);
      d.alvo.addEventListener("touchstart", aoTocar, opc);
      d.alvo.addEventListener("focus", aoFocar, opc);
      d.doc.addEventListener("visibilitychange", aoVoltar);
      armar(d.ms());
    },
    parar(): void {
      if (!ligado) return;
      ligado = false;
      if (timer !== null) d.clearT(timer);
      timer = null; quieto = false;
      d.alvo.removeEventListener("pointermove", aoMover, true);
      d.alvo.removeEventListener("pointerdown", aoClicar, true);
      d.alvo.removeEventListener("keydown", aoTeclar, true);
      d.alvo.removeEventListener("wheel", aoRolar, true);
      d.alvo.removeEventListener("touchstart", aoTocar, true);
      d.alvo.removeEventListener("focus", aoFocar, true);
      d.doc.removeEventListener("visibilitychange", aoVoltar);
    },
    /** o tempo configurado mudou: refaz a conta já. */
    reprogramar(): void { if (ligado && !quieto) armar(ultima + d.ms() - d.agora()); },
    ocioso: (): boolean => quieto,
  };
}
export type Detector = ReturnType<typeof criarDetector>;
