// Atalhos globais e pedidos da paleta (⌘K) para "Executar projeto". Um ouvinte de teclado barato; o resto é lazy.
import { interpretarAtalhoExecutar } from "../../nucleo/executar/maquina";
import { storeExecutar, type StoreExecutar } from "./executar";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * F5 alterna (executa/para); Shift+F5 para; Ctrl/Cmd+Shift+F5 reinicia. No macOS (F5 exige fn): ⌘R, ⌘. e ⌘⇧R.
 * Capturado ANTES do terminal para valer também com o foco dentro do xterm (o terminal receberia a sequência de F5).
 */
export function ligarAtalhosExecutar(
  store: StoreExecutar = storeExecutar,
  alvo: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  mac: boolean = EH_MAC,
): () => void {
  const f = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.defaultPrevented || k.repeat) return;
    const acao = interpretarAtalhoExecutar(k, mac);
    if (acao === null) return;
    k.preventDefault();
    k.stopPropagation();
    if (acao === "alternar") void store.alternar();
    else if (acao === "parar") void store.parar();
    else void store.reiniciar();
  };
  alvo.addEventListener("keydown", f, true);
  return () => alvo.removeEventListener("keydown", f, true);
}

// ---- paleta: "Executar configuração…" abre o menu do botão; os demais comandos chamam o store direto
export type PedidoExecutar = "escolher";
const ouvintes = new Set<(p: PedidoExecutar) => void>();
export function pedirExecutar(p: PedidoExecutar): void { [...ouvintes].forEach((o) => o(p)); }
export function aoPedirExecutar(o: (p: PedidoExecutar) => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); }
