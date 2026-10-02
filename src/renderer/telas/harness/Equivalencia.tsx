import { useEffect, useState } from "react";
import type { EstadoEquivalencia, Faixa } from "../../../compartilhado/harness";
import { FAIXAS } from "../../../compartilhado/harness";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { useCarga } from "../../estado/carga";
import type { PropsAba } from "./tipos";
import { aplicarDiferenca, celulaAlterada, lerCelulaEquivalencia, textoCelulaEquivalencia } from "./validar";

export const AVISO_EQUIVALENCIA = "Confira se os modelos de cada faixa são mesmo equivalentes em qualidade e custo: a troca de provedor usa esta tabela (P-31).";
const SEM_EQUIVALENTE = "sem equivalente";

function Celula({ provedor, faixa, estado, aoGravar }: { provedor: string; faixa: Faixa; estado: EstadoEquivalencia; aoGravar: (provedor: string, faixa: Faixa, texto: string) => Promise<string | null> }) {
  const efetivo = textoCelulaEquivalencia(estado.efetiva.provedores[provedor]?.[faixa]);
  const [texto, setTexto] = useState(efetivo);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setTexto(efetivo); setErro(null); }, [efetivo]);
  const alterada = celulaAlterada(estado.diferencas, provedor, faixa);
  const commit = async () => { if (texto === efetivo) return; setErro(await aoGravar(provedor, faixa, texto)); };
  return (
    <div className="h-celula" role="gridcell">
      <input aria-label={`${provedor}, faixa ${faixa}`} aria-invalid={erro !== null} placeholder={SEM_EQUIVALENTE} value={texto}
        onChange={(e) => { setTexto(e.target.value); setErro(null); }} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); else if (e.key === "Escape") { setTexto(efetivo); setErro(null); } }} />
      <span className="h-selo" data-tom={alterada ? "destaque" : undefined}>{alterada ? "alterado" : "padrão"}</span>
      {erro !== null ? <span role="alert" className="h-erro">{erro}</span> : null}
    </div>
  );
}

/** Grade provedor × faixa com os modelos efetivos; grava só a diferença contra o padrão. */
export function Equivalencia({ api, versao }: PropsAba) {
  const c = useCarga<EstadoEquivalencia>(api?.lerEquivalencia === undefined ? undefined : () => api.lerEquivalencia!(), `eq|${versao}`);
  const [erro, setErro] = useState<string | null>(null);
  if (c.estado === "indisponivel") return <EstadoVazio icone="harness" titulo="Equivalência indisponível" texto="Este build ainda não expõe a tabela de equivalência." />;
  if (c.estado === "erro") return <p role="alert" className="h-erro">Não foi possível ler a equivalência: {c.mensagem}</p>;
  if (c.dados === null) return <div aria-busy="true" className="h-nota">Carregando equivalência…</div>;
  const estado = c.dados;
  const faixas = estado.efetiva.faixas.length > 0 ? estado.efetiva.faixas : FAIXAS;
  const provedores = Object.keys(estado.efetiva.provedores).sort();
  const gravar = async (provedor: string, faixa: Faixa, texto: string): Promise<string | null> => {
    const lida = lerCelulaEquivalencia(texto);
    if (!lida.ok) return lida.erro;
    try { await api?.gravarEquivalencia?.(aplicarDiferenca(estado.diferencas, estado.padrao.provedores, provedor, faixa, lida.valor)); setErro(null); c.recarregar(); return null; }
    catch (e) { return `Não foi possível gravar: ${e instanceof Error ? e.message : String(e)}`; }
  };
  const restaurar = async () => { try { await api?.restaurarEquivalencia?.(); c.recarregar(); } catch (e) { setErro(`Não foi possível restaurar: ${e instanceof Error ? e.message : String(e)}`); } };
  return (
    <div className="h-secao">
      <p className="h-aviso" role="note">{AVISO_EQUIVALENCIA}</p>
      <p className="h-nota">Cada célula aceita <code>modelo</code> ou <code>modelo@esforço</code>, separados por vírgula. Vazio = {SEM_EQUIVALENTE}. Enter grava, Esc cancela.</p>
      {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      <div className="h-grade h-grade-eq" role="grid" aria-label="Equivalência de modelos" style={{ "--n-faixas": faixas.length } as React.CSSProperties}>
        <div role="row" style={{ display: "contents" }}>
          <span role="columnheader" className="h-nota">Provedor</span>
          {faixas.map((f) => <span key={f} role="columnheader" className="h-nota">{f}</span>)}
        </div>
        {provedores.map((p) => (
          <div key={p} role="row" style={{ display: "contents" }}>
            <strong role="rowheader">{p}</strong>
            {faixas.map((f) => <Celula key={f} provedor={p} faixa={f} estado={estado} aoGravar={gravar} />)}
          </div>
        ))}
      </div>
      <div className="h-linha-simples"><button type="button" className="botao-mini" onClick={() => void restaurar()}>Restaurar padrão</button></div>
    </div>
  );
}
