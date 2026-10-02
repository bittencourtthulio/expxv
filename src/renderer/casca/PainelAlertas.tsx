import { useEffect, useRef } from "react";
import type { AlertaVisao } from "../../compartilhado/alertas";
import { pedirAlertas } from "../estado/alertas-acoes";
import { SEVERIDADE_VISUAL, tempoRelativo } from "../estado/alertas-formato";
import { storeAlertas, useAlertas, type StoreAlertas } from "../estado/alertas";

export const MAX_NO_PAINEL = 8;

/** Painel suspenso (360 px): últimos 8, "Marcar tudo como lido" e "Abrir Centro". Esc fecha; quem abriu recebe o foco de volta. */
export function PainelAlertas({ aoFechar, store = storeAlertas, agora = Date.now }: { aoFechar: () => void; store?: StoreAlertas; agora?: () => number }) {
  const { recentes, contagem, disponivel } = useAlertas(store);
  const raiz = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    void store.carregarRecentes(MAX_NO_PAINEL);
    raiz.current?.querySelector<HTMLElement>("button")?.focus();
    const aoClicarFora = (e: MouseEvent): void => {
      const alvo = e.target as Element | null;
      if (alvo !== null && !raiz.current?.contains(alvo) && alvo.closest?.(".alertas-indicador") === null) fechar.current();
    };
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [store]);
  const itens: readonly AlertaVisao[] = recentes.slice(0, MAX_NO_PAINEL);
  return (
    <div ref={raiz} className="alertas-painel" role="dialog" aria-label="Alertas recentes" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fechar.current(); } }}>
      <div className="alertas-painel-cab">
        <strong>Alertas</strong>
        <button type="button" className="alertas-link" disabled={contagem.nao_lidos === 0} onClick={() => void store.marcarTodosLidos()}>Marcar tudo como lido</button>
      </div>
      {!disponivel ? <p className="alertas-painel-vazio" role="status">Alertas indisponíveis nesta janela.</p>
        : itens.length === 0 ? <p className="alertas-painel-vazio" role="status">Nada por aqui. Quando algo importante acontecer, aparece nesta lista.</p>
        : (
          <ul className="alertas-painel-lista" aria-label="Últimos alertas">
            {itens.map((a) => {
              const v = SEVERIDADE_VISUAL[a.severidade];
              return (
                <li key={a.id} data-lido={a.lido_em !== null || undefined}>
                  <span className="alertas-sev" data-tom={v.tom}><span aria-hidden="true">{v.glifo}</span> {v.texto}</span>
                  <span className="alertas-painel-titulo">{a.titulo}</span>
                  <span className="alertas-painel-tempo">{tempoRelativo(a.criado_em, agora())}{a.lido_em === null ? " · não lido" : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      <div className="alertas-painel-rodape">
        <button type="button" className="botao botao-primario alertas-painel-abrir" onClick={() => { pedirAlertas("alertas"); fechar.current(); }}>Abrir Centro</button>
      </div>
    </div>
  );
}
