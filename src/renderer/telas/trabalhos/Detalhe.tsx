import { useEffect, useRef } from "react";
import type { Trabalho as DadosTrabalho } from "../../../nucleo/metodo/tipos";
import { Icone } from "../../componentes/Icone";
import { Trabalho } from "../metodo/Trabalho";

interface Props { workspaceId: string; trabalho: DadosTrabalho; aoVoltar: () => void }

/** Painel lateral direito com o detalhe (plano, quadro, grafo e rastro): reaproveita o componente Trabalho do Método. Esc e "Voltar" fecham e devolvem o foco. */
export function Detalhe({ workspaceId, trabalho, aoVoltar }: Props) {
  const voltar = useRef<HTMLButtonElement>(null);
  const origem = useRef<Element | null>(null);
  useEffect(() => {
    origem.current = document.activeElement;
    voltar.current?.focus();
    return () => { if (origem.current instanceof HTMLElement && origem.current.isConnected) origem.current.focus(); };
  }, []);
  return (
    <>
      <div className="trab-veu" aria-hidden="true" onClick={aoVoltar} />
      <aside className="trab-detalhe" role="complementary" aria-label="Detalhe do trabalho" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); aoVoltar(); } }}>
        <div className="trab-detalhe-barra">
          <button type="button" ref={voltar} className="met-botao trab-voltar" onClick={aoVoltar}><Icone nome="desfazer" />Voltar</button>
          <span className="met-suave">Esc também volta</span>
        </div>
        <div className="trab-detalhe-corpo"><Trabalho key={trabalho.id} workspaceId={workspaceId} trabalho={trabalho} /></div>
      </aside>
    </>
  );
}
