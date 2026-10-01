import { aoPedirPaleta } from "../estado/navegacao";
import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from "react";

type PropsPaleta = { aoFechar: () => void };
const carregar = () => import("./PaletaComandos").then((m) => ({ default: m.PaletaConectada }));
let promessa: Promise<unknown> | null = null;
/** Componente já resolvido: com o chunk em mãos a paleta renderiza direto, SEM `React.lazy`/Suspense. */
let carregada: ComponentType<PropsPaleta> | null = null;
/**
 * Baixa o chunk da paleta (idempotente). Chamado em ocioso: o atalho então abre sem esperar rede/disco.
 * Guarda o componente resolvido: o `lazy` suspende na 1ª renderização mesmo com o módulo pronto e o React segura a
 * revelação do conteúdo por ~300 ms (medido: 1ª abertura 310 ms, as seguintes 2 ms; P-02b).
 */
export function precarregarPaleta(): Promise<unknown> {
  promessa ??= carregar().then((m) => { carregada = m.default; return m; });
  return promessa;
}
const Paleta = lazy(() => (promessa ??= carregar().then((m) => { carregada = m.default; return m; })) as ReturnType<typeof carregar>);

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌘K no macOS; Ctrl+Shift+P nos demais (Ctrl+letra puro é do processo do terminal). */
export function ehAtalhoDaPaleta(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac: boolean = EH_MAC): boolean {
  if (e.altKey) return false;
  const k = e.key.toLowerCase();
  if (mac) return e.metaKey && !e.ctrlKey && !e.shiftKey && k === "k";
  return e.ctrlKey && e.shiftKey && !e.metaKey && (k === "p" || e.code === "KeyP");
}

/** Escuta o atalho (captura: vence o xterm) e o botão do topo; monta a paleta só enquanto aberta. */
export function PaletaGatilho() {
  const [aberta, setAberta] = useState(false);
  const fechar = useCallback(() => setAberta(false), []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.type === "keydown" && ehAtalhoDaPaleta(e)) { e.preventDefault(); e.stopPropagation(); setAberta((a) => !a); }
    };
    const aoClicar = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".topo-botao-busca")) setAberta(true);
    };
    const cancelarPedido = aoPedirPaleta(() => setAberta(true)); // menu nativo
    window.addEventListener("keydown", aoTeclar, true);
    document.addEventListener("click", aoClicar);
    const ocioso = typeof requestIdleCallback === "function"
      ? requestIdleCallback(() => void precarregarPaleta(), { timeout: 3000 })
      : (setTimeout(() => void precarregarPaleta(), 1500) as unknown as number);
    return () => {
      cancelarPedido();
      window.removeEventListener("keydown", aoTeclar, true);
      document.removeEventListener("click", aoClicar);
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(ocioso); else clearTimeout(ocioso);
    };
  }, []);

  if (!aberta) return null;
  const Pronta = carregada;
  return Pronta !== null ? <Pronta aoFechar={fechar} /> : <Suspense fallback={null}><Paleta aoFechar={fechar} /></Suspense>;
}
