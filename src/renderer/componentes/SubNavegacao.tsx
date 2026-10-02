import { useEffect, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Icone } from "./Icone";
import { agruparItens, indiceDaTecla, inicialDoRotulo, type ItemSubNav } from "./subnavegacao-logica";
import "./subnavegacao.css";

export type { ItemSubNav } from "./subnavegacao-logica";
export type DefAba<T extends string> = { id: T; rotulo: string };

export const idAba = (base: string, id: string): string => `${base}-aba-${id}`;
export const idPainel = (base: string): string => `${base}-painel`;

const CONSULTA_ESTREITA = "(max-width: 719px)";
/** Janela estreita (< 720 px): a barra vira lista no topo; o ARIA acompanha a orientação visual. */
function useEstreita(): boolean {
  const [estreita, setEstreita] = useState(() => (typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA_ESTREITA).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(CONSULTA_ESTREITA);
    const aoMudar = (): void => setEstreita(mq.matches);
    aoMudar();
    mq.addEventListener?.("change", aoMudar);
    return () => mq.removeEventListener?.("change", aoMudar);
  }, []);
  return estreita;
}

export interface PropsSubNavegacao<T extends string> {
  itens: readonly ItemSubNav<T>[];
  ativo: T;
  onMudar: (id: T) => void;
  /** Nome acessível da lista (ex.: "Seções da gestão ágil"). */
  rotulo: string;
  /** Prefixo dos ids (aba/painel); único por tela. */
  base: string;
  /** Conteúdo do painel ativo: ocupa 100% do espaço restante. */
  children?: ReactNode;
  /** @deprecated A barra não recolhe mais (sempre visível e discreta); mantido só para compatibilidade das telas. */
  recolhivel?: boolean;
  /** Controles extras no topo da coluna do conteúdo (filtros, ações). Ficam FORA do tabpanel. */
  barra?: ReactNode;
  /** Classe extra do contêiner raiz. */
  className?: string;
  /** Classe do painel (rolagem/padding próprios da tela). */
  classePainel?: string;
}

/**
 * Sub-navegação lateral da tela (substitui abas no topo): coluna à esquerda DENTRO da tela + painel que preenche o resto.
 * Padrão ARIA único: `tablist` vertical (aria-orientation) com `tab`/`tabpanel`, ativação automática, tabindex roving,
 * ↑/↓ (e ←/→), Home/End. Discreta: sem fundo e sem recolher. Responsivo por CSS: < 720 px vira lista no topo.
 */
export function SubNavegacao<T extends string>({ itens, ativo, onMudar, rotulo, base, children, barra, className, classePainel }: PropsSubNavegacao<T>): ReactElement {
  const estreita = useEstreita();
  const teclar = (e: KeyboardEvent<HTMLElement>, i: number): void => {
    const alvo = indiceDaTecla(e.key, i, itens.length);
    if (alvo < 0) return;
    e.preventDefault();
    const proximo = itens[alvo];
    if (proximo === undefined) return;
    onMudar(proximo.id);
    document.getElementById(idAba(base, proximo.id))?.focus();
  };
  const secoes = agruparItens(itens);
  return (
    <div className={className === undefined ? "subnav" : `subnav ${className}`} data-subnav={base}>
      <div className="subnav-lateral">
        <div role="tablist" aria-orientation={estreita ? "horizontal" : "vertical"} aria-label={rotulo} className="subnav-lista">
          {secoes.map((s, k) => (
            <div key={`${s.titulo ?? ""}-${k}`} className="subnav-secao" role="presentation">
              {s.titulo !== null && <div className="subnav-titulo" role="presentation">{s.titulo}</div>}
              {s.itens.map(({ item, indice }) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={idAba(base, item.id)}
                  className="subnav-item"
                  aria-selected={item.id === ativo}
                  aria-controls={idPainel(base)}
                  tabIndex={item.id === ativo ? 0 : -1}
                  title={item.dica ?? item.rotulo}
                  onClick={() => onMudar(item.id)}
                  onKeyDown={(e) => teclar(e, indice)}
                >
                  <span className="subnav-icone" aria-hidden="true" {...(item.icone === undefined ? { "data-inicial": inicialDoRotulo(item.rotulo) } : {})}>{item.icone !== undefined ? <Icone nome={item.icone} /> : null}</span>
                  <span className="subnav-rotulo">{item.rotulo}</span>
                  {item.selo !== undefined && item.selo !== 0 && <span className="subnav-selo" data-subnav-selo>{item.selo}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="subnav-coluna">
        {barra}
        <div className={classePainel === undefined ? "subnav-painel" : `subnav-painel ${classePainel}`} role="tabpanel" id={idPainel(base)} aria-labelledby={idAba(base, ativo)}>{children}</div>
      </div>
    </div>
  );
}
