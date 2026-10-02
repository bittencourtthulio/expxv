import type { AcaoTroca, Troca } from "../../../compartilhado/harness";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { VirtualLista } from "../../componentes/VirtualLista";
import { useCarga } from "../../estado/carga";
import { formatarHora, formatarPct } from "../../estado/limites-formato";
import type { ApiHarnessLike } from "./tipos";

const MOTIVO: Record<Troca["motivo"], string> = { consumo_alto: "consumo alto", limite_atingido: "limite atingido", manual: "manual" };
const TIPO: Record<Troca["tipo_troca"], string> = { outra_conta: "outra conta", outro_provedor: "outro provedor", faixa_inferior: "faixa inferior" };
const STATUS: Record<Troca["status"], string> = { sugerida: "sugerida", feita: "feita", ignorada: "ignorada", adiada: "adiada", falhou: "falhou" };
export const ALTURA_TROCA = 36;

const lado = (x: Troca["de"]): string => `${x.provedor}${x.conta_id !== null ? `·${x.conta_id.slice(0, 6)}` : ""}${x.modelo !== null ? ` ${x.modelo}` : ""}`;

export function Trocas({ api, aoDecidir }: { api: ApiHarnessLike | undefined; aoDecidir?: (id: string, acao: AcaoTroca) => Promise<boolean> | void }) {
  const c = useCarga<Troca[]>(api?.listarTrocas === undefined ? undefined : async () => (await api.listarTrocas!({ limite: 500 })).itens, "trocas");
  const decidir = async (t: Troca, acao: AcaoTroca) => {
    if (aoDecidir !== undefined) await aoDecidir(t.id, acao); else await api?.decidirTroca?.(t.id, acao);
    c.recarregar();
  };
  if (c.estado === "indisponivel") return <EstadoVazio icone="consumo" titulo="Log de trocas indisponível" texto="Este build ainda não expõe o log de trocas." />;
  if (c.estado === "erro") return <p role="alert" className="erro-caixa">Não foi possível ler as trocas: {c.mensagem}</p>;
  if (c.dados === null) return <div aria-busy="true" className="consumo-nota">Carregando trocas…</div>;
  if (c.dados.length === 0) return <EstadoVazio icone="consumo" titulo="Nenhuma troca ainda" texto="Quando uma conta passar do limiar, a sugestão ou a troca automática aparece aqui, com o recibo do motivo." />;
  return (
    <div className="consumo-lista-alta">
      <VirtualLista
        itens={c.dados}
        alturaItem={ALTURA_TROCA}
        rotulo="Log de trocas"
        className="consumo-lista-alta"
        chave={(t) => t.id}
        renderItem={(t) => (
          <div className="consumo-troca" data-status={t.status} title={t.recibo}>
            <span>{formatarHora(t.criado_em)}</span>
            <span>{lado(t.de)} → {lado(t.para)}</span>
            <span>{TIPO[t.tipo_troca]}</span>
            <span>{MOTIVO[t.motivo]}</span>
            <span>{formatarPct(t.consumo_origem_pct)} → {formatarPct(t.consumo_destino_pct)}</span>
            <span>{STATUS[t.status]}{t.adiada_por !== null ? ` (${t.adiada_por})` : ""}</span>
            <span>{t.recibo}</span>
            <span>
              {t.status === "sugerida" ? (
                <>
                  <button type="button" className="botao-mini" aria-label={`Aceitar troca ${t.id}`} onClick={() => void decidir(t, "aceitar")}>Aceitar</button>{" "}
                  <button type="button" className="botao-mini" aria-label={`Ignorar troca ${t.id}`} onClick={() => void decidir(t, "ignorar")}>Ignorar</button>{" "}
                  <button type="button" className="botao-mini" aria-label={`Adiar troca ${t.id} por 30 minutos`} onClick={() => void decidir(t, "adiar_30min")}>Adiar</button>
                </>
              ) : null}
            </span>
          </div>
        )}
      />
    </div>
  );
}
