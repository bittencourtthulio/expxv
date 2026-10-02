import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { textoDoErro } from "./logica";

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return <div className="mp-carregando" role="status" aria-busy="true">{texto}</div>;
}

export function FaixaErro({ erro, aoTentar }: { erro: unknown; aoTentar?: () => void }) {
  return (
    <div className="mp-faixa" data-tom="erro" role="alert">
      <span>{textoDoErro(erro)}</span>
      {aoTentar !== undefined && <button type="button" onClick={aoTentar}>Tentar de novo</button>}
    </div>
  );
}

/** Copia para a área de transferência do renderer (nunca para fora do app). Devolve se conseguiu. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export function BotaoCopiar({ texto, rotulo, visivel = "Copiar", aoCopiar }: { texto: string; rotulo: string; visivel?: string; aoCopiar?: (ok: boolean) => void }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="mp-btn mp-mini" aria-label={rotulo} onClick={() => void copiarTexto(texto).then((r) => { setOk(r); aoCopiar?.(r); setTimeout(() => setOk(false), 1500); })}>
      {ok ? "Copiado" : visivel}
    </button>
  );
}

export interface ItemMenu { id: string; rotulo: string; desabilitado?: boolean; marcado?: boolean; tipo?: "item" | "check" | "radio"; separador?: boolean; aoEscolher: () => void }

/** Menu suspenso acessível (button[aria-haspopup=menu] + role=menu); setas, Home/End, Esc e clique fora. */
export function Menu({ rotulo, itens, extra, className = "", aoAbrir }: { rotulo: string; itens: readonly ItemMenu[]; extra?: ReactNode; className?: string; aoAbrir?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent): void => { if (raiz.current !== null && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  useEffect(() => { if (aberto) raiz.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus(); }, [aberto]);
  const teclar = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") { e.stopPropagation(); setAberto(false); raiz.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus(); return; }
    const alvos = [...(raiz.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = alvos.indexOf(document.activeElement as HTMLElement);
    const ir = e.key === "ArrowDown" ? (i + 1) % alvos.length : e.key === "ArrowUp" ? (i - 1 + alvos.length) % alvos.length : e.key === "Home" ? 0 : e.key === "End" ? alvos.length - 1 : -1;
    if (ir >= 0 && alvos.length > 0) { e.preventDefault(); alvos[ir]?.focus(); }
  };
  return (
    <div className={`mp-menu ${className}`} ref={raiz} onKeyDown={teclar}>
      <button type="button" className="mp-btn" aria-haspopup="menu" aria-expanded={aberto} aria-controls={aberto ? idMenu : undefined} onClick={() => { if (!aberto) aoAbrir?.(); setAberto((a) => !a); }}>{rotulo} ▾</button>
      {aberto && (
        <div className="mp-menu-lista" role="menu" id={idMenu} aria-label={rotulo}>
          {extra}
          {itens.map((it) => (
            <button
              key={it.id}
              type="button"
              role={it.tipo === "check" ? "menuitemcheckbox" : it.tipo === "radio" ? "menuitemradio" : "menuitem"}
              aria-checked={it.tipo === "check" || it.tipo === "radio" ? it.marcado === true : undefined}
              aria-disabled={it.desabilitado === true ? true : undefined}
              data-separador={it.separador === true ? "" : undefined}
              onClick={() => { if (it.desabilitado === true) return; it.aoEscolher(); if (it.tipo !== "check" && it.tipo !== "radio") setAberto(false); }}
            >
              {it.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
