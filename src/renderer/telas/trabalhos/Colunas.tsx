import { useMemo } from "react";
import type { Trabalho } from "../../../nucleo/metodo/tipos";
import { VirtualLista } from "../../componentes/VirtualLista";
import { Cartao } from "./Cartao";
import { AJUDA_ESTAGIO_PORTFOLIO, COLUNAS_PORTFOLIO, ROTULO_ESTAGIO_PORTFOLIO, estagioPortfolio, type EstagioPortfolio } from "./portfolio";

export const ALTURA_CARTAO = 148;

interface Props { trabalhos: readonly Trabalho[]; aberto: string | null; aoAbrir: (id: string) => void; agora: number }

/** Visão em colunas por estágio: só leitura (o estágio vem do disco; nada se arrasta). Cada coluna é uma lista virtualizada. */
export function Colunas({ trabalhos, aberto, aoAbrir, agora }: Props) {
  const porColuna = useMemo(() => {
    const m: Record<EstagioPortfolio, Trabalho[]> = { ideia: [], planejado: [], execucao: [], validando: [], entregue: [] };
    for (const t of trabalhos) m[estagioPortfolio(t)].push(t);
    return m;
  }, [trabalhos]);
  return (
    <div className="trab-colunas">
      {COLUNAS_PORTFOLIO.map((c) => (
        <section key={c} className="trab-coluna" data-estagio={c} aria-label={`Coluna ${ROTULO_ESTAGIO_PORTFOLIO[c]}`}>
          <header title={AJUDA_ESTAGIO_PORTFOLIO[c]}>
            <h3>{ROTULO_ESTAGIO_PORTFOLIO[c]}</h3>
            <span className="trab-contagem">{porColuna[c].length}</span>
          </header>
          <div className="trab-coluna-corpo">
            {porColuna[c].length === 0 ? <p className="met-suave trab-coluna-vazia">{AJUDA_ESTAGIO_PORTFOLIO[c]}. Nada aqui agora.</p> : (
              <VirtualLista
                itens={porColuna[c]} alturaItem={ALTURA_CARTAO} alturaPadrao={600} rotulo={`Trabalhos em ${ROTULO_ESTAGIO_PORTFOLIO[c]}`} chave={(t) => t.id}
                renderItem={(t) => <Cartao t={t} aberto={t.id === aberto} aoAbrir={aoAbrir} agora={agora} />}
              />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
