import { useEffect, useRef, useState, type ReactElement } from "react";

/** O que a busca precisa do SearchAddon (estrutural: o teste usa um falso). */
export interface MotorBusca {
  findNext(termo: string, opcoes?: { caseSensitive?: boolean; incremental?: boolean }): boolean;
  findPrevious(termo: string, opcoes?: { caseSensitive?: boolean; incremental?: boolean }): boolean;
  clearDecorations(): void;
}

/** Cmd+F no macOS e Ctrl+Shift+F nos demais; Ctrl+F puro é "avançar caractere" no readline e segue para o processo. */
export function ehAtalhoDeBusca(e: Pick<KeyboardEvent, "type" | "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey">, mac: boolean): boolean {
  if (e.type !== "keydown" || e.key.toLowerCase() !== "f" || e.altKey) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}

export function BuscaTerminal({ busca, aoFechar }: { busca: MotorBusca; aoFechar(): void }): ReactElement {
  const [termo, setTermo] = useState("");
  const [maiusculas, setMaiusculas] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); campo.current?.select(); }, []);
  const procurar = (t: string, incremental: boolean, voltar = false): void => {
    if (t === "") { busca.clearDecorations(); return; }
    if (voltar) busca.findPrevious(t, { caseSensitive: maiusculas }); else busca.findNext(t, { caseSensitive: maiusculas, incremental });
  };
  return (
    <div className="terminal-busca" role="search" aria-label="Buscar no terminal">
      <input
        ref={campo}
        type="search"
        className="terminal-busca__campo"
        placeholder="Buscar no terminal"
        aria-label="Termo de busca"
        value={termo}
        onChange={(e) => { setTermo(e.target.value); procurar(e.target.value, true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); aoFechar(); }
          else if (e.key === "Enter") { e.preventDefault(); procurar(termo, false, e.shiftKey); }
        }}
      />
      <button type="button" className="terminal-busca__botao" aria-pressed={maiusculas} aria-label="Diferenciar maiúsculas" title="Diferenciar maiúsculas" onClick={() => setMaiusculas(!maiusculas)}>Aa</button>
      <button type="button" className="terminal-busca__botao" aria-label="Resultado anterior" title="Anterior (Shift+Enter)" onClick={() => procurar(termo, false, true)}>↑</button>
      <button type="button" className="terminal-busca__botao" aria-label="Próximo resultado" title="Próximo (Enter)" onClick={() => procurar(termo, false)}>↓</button>
      <button type="button" className="terminal-busca__botao" aria-label="Fechar busca" title="Fechar (Esc)" onClick={aoFechar}>×</button>
    </div>
  );
}
