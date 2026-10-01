import { memo, useCallback, useRef, useState, type FocusEvent } from "react";
import { PRODUTO } from "../../nucleo/produto";
import { Icone } from "../componentes/Icone";
import { TELAS, type TelaId } from "./telas";

interface Props {
  ativa: TelaId;
  fixado: boolean;
  aoSelecionar: (id: TelaId) => void;
  aoFixar: () => void;
}

function temFocoVisivel(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Menu lateral: 56 px recolhido; abre a 232 px por cima com hover/foco de teclado; "fixar" empurra o conteúdo. */
export const Menu = memo(function Menu({ ativa, fixado, aoSelecionar, aoFixar }: Props) {
  const [sobre, setSobre] = useState(false);
  const [foco, setFoco] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const aberto = sobre || foco || fixado;

  const aoSairFoco = useCallback((e: FocusEvent) => {
    if (!raiz.current?.contains(e.relatedTarget as Node | null)) setFoco(false);
  }, []);

  return (
    <div
      ref={raiz}
      className="menu"
      data-aberto={aberto || undefined}
      data-fixado={fixado || undefined}
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      onFocus={(e) => temFocoVisivel(e.target) && setFoco(true)}
      onBlur={aoSairFoco}
    >
      <div className="menu-painel">
        <div className="menu-identidade">
          <span className="menu-simbolo" aria-hidden="true" />
          <strong className="menu-nome">{PRODUTO.nome}</strong>
        </div>
        <nav aria-label="Principal" className="menu-lista">
          {TELAS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="menu-item"
              title={t.rotulo}
              aria-current={t.id === ativa ? "page" : undefined}
              onClick={() => aoSelecionar(t.id)}
            >
              <Icone nome={t.icone} />
              <span className="menu-rotulo">{t.rotulo}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="menu-item menu-fixar" aria-pressed={fixado} title="Fixar menu" onClick={aoFixar}>
          <Icone nome="fixar" />
          <span className="menu-rotulo">{fixado ? "Desafixar menu" : "Fixar menu"}</span>
        </button>
      </div>
    </div>
  );
});
