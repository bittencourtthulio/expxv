import type { Trabalho } from "../../../nucleo/metodo/tipos";
import { VirtualLista } from "../../componentes/VirtualLista";
import { rotuloEstagio } from "../metodo/util";
import { BarraProgresso, ChipEstado, EtiquetaRaio, MiniRastro } from "./Cartao";
import { formatarRelativo, tipoPortfolio } from "./portfolio";

export const ALTURA_LINHA = 52;
const dataCurta = (iso: string | null): string => {
  if (iso === null) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

interface Props { trabalhos: readonly Trabalho[]; aberto: string | null; aoAbrir: (id: string) => void; agora: number }

/** Linha do tempo compacta: uma linha por trabalho, com estágio, progresso e a data da última atividade. */
export function Linha({ trabalhos, aberto, aoAbrir, agora }: Props) {
  return (
    <div className="trab-linha-tabela">
      <div className="trab-linha trab-linha-cab" aria-hidden="true">
        <span>Trabalho</span><span>Estágio</span><span>Progresso</span><span>Raio</span><span>Atividade</span>
      </div>
      <div className="trab-linha-corpo">
        <VirtualLista
          itens={trabalhos} alturaItem={ALTURA_LINHA} alturaPadrao={600} rotulo="Trabalhos em linha do tempo" chave={(t) => t.id}
          renderItem={(t) => (
            <button type="button" className="trab-linha" data-tipo={tipoPortfolio(t).id} aria-current={t.id === aberto ? "true" : undefined} onClick={() => aoAbrir(t.id)}>
              <span className="trab-linha-titulo"><span className="met-chip">{tipoPortfolio(t).rotulo}</span><b>{t.titulo}</b></span>
              <span className="trab-linha-estagio"><ChipEstado t={t} /><small>{rotuloEstagio(t.estagio)}</small></span>
              <span className="trab-linha-prog"><MiniRastro t={t} /><BarraProgresso t={t} /></span>
              <span className="trab-linha-raio"><EtiquetaRaio t={t} /></span>
              <time dateTime={t.ultima_atividade ?? undefined} title={t.ultima_atividade ?? undefined}><b>{dataCurta(t.ultima_atividade)}</b><small>{formatarRelativo(t.ultima_atividade, agora)}</small></time>
            </button>
          )}
        />
      </div>
    </div>
  );
}
