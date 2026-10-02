// Gancho global da captura (Fase 11): sempre montado no App, mas minúsculo. Só escuta pedidos (paleta, menu, atalho global) e, no PRIMEIRO, carrega o fluxo lazy (P-47: nada no JS inicial).
import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { ade } from "../../ade";
import { aoPedirCaptura, pedirCaptura, type PedidoCaptura } from "../../estado/captura-acoes";
import { ATALHOS_CAPTURA_PADRAO } from "../../../compartilhado/captura";
import { ehAtalho } from "../../voz/logica";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const Fluxo = lazy(() => import("./Fluxo"));

export function HostCaptura(): ReactElement | null {
  const [pedido, setPedido] = useState<{ pedido: PedidoCaptura; serial: number } | null>(null);
  useEffect(() => aoPedirCaptura((p) => setPedido((a) => ({ pedido: p, serial: (a?.serial ?? 0) + 1 }))), []);
  // atalho global (opt-in): o main só avisa; quem decide o que fazer é o fluxo
  useEffect(() => ade()?.captura?.assinar((e) => { if (e.tipo === "atalho") pedirCaptura(e.acao === "regiao" ? "regiao-tela" : "quadros-tela"); }), []);
  // atalhos dentro do app (os do menu seriam iguais; os globais são opt-in e vêm do main): ⌘⇧5 região, ⌘⇧6 quadros (Ctrl+Shift+5/6 fora do macOS)
  useEffect(() => {
    if (ade()?.captura === undefined) return;
    const k = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const t = { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey };
      if (ehAtalho(t, ATALHOS_CAPTURA_PADRAO.regiao, EH_MAC)) { e.preventDefault(); pedirCaptura("regiao-tela"); }
      else if (ehAtalho(t, ATALHOS_CAPTURA_PADRAO.quadros, EH_MAC)) { e.preventDefault(); pedirCaptura("quadros-tela"); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  if (pedido === null) return null;
  return <Suspense fallback={null}><Fluxo pedido={pedido.pedido} serial={pedido.serial} /></Suspense>;
}
