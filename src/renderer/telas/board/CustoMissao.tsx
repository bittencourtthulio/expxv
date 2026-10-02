import { useEffect, useId, useState } from "react";
import type { CustoMissao, CustoResumo, PrevisaoMissao } from "../../../compartilhado/custo";
import { ade } from "../../ade";
import { useResumoCusto } from "../../estado/custo";
import { CUSTO_DESCONHECIDO, LEGENDA_CUSTO, explicarCusto, formatarCusto, formatarValorUsd, formatarBrl } from "../../estado/custo-formato";

const ehMissao = (r: CustoResumo | CustoMissao | null): r is CustoMissao => r !== null && "orquestracao" in r;

/** Custo da Missão: total com "≥/≈", repartição (cards · orquestração · sem card · ambíguo), previsão e teto (só alerta; nada é interrompido). */
export function CustoMissaoPainel({ missionId, cambioBrl = null }: { missionId: string; cambioBrl?: number | null }) {
  const { resumo, erro } = useResumoCusto("missao", missionId);
  const [previsao, setPrevisao] = useState<PrevisaoMissao | null>(null);
  const [teto, setTeto] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const idTeto = useId();
  useEffect(() => {
    let vivo = true;
    setPrevisao(null);
    const api = ade()?.custo;
    if (api?.previsaoMissao === undefined) return undefined;
    void api.previsaoMissao(missionId).then((p) => { if (vivo) setPrevisao(p); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [missionId, resumo?.atualizado_em]);

  const gravarTeto = async (valor: number | null): Promise<void> => {
    try {
      await ade()?.custo?.tetoGravar(missionId, valor);
      setMsg(valor === null ? "Teto removido." : "Teto gravado: o ADE só avisa, nunca interrompe a Missão.");
    } catch { setMsg("Não foi possível gravar o teto."); }
  };
  const aoGravar = (): void => {
    const n = Number(teto.replace(",", "."));
    if (teto.trim() === "" || !Number.isFinite(n) || n <= 0) { setMsg("Informe um valor em US$ maior que zero."); return; }
    void gravarTeto(n);
  };

  if (resumo === null) return <p className="bd-nota" aria-busy={erro === null}>{erro ?? "Lendo o custo…"}</p>;
  const partes: Array<[string, CustoResumo]> | null = ehMissao(resumo)
    ? [["Cards", resumo.cards], ["Orquestração (piloto)", resumo.orquestracao], ["Sem card", resumo.sem_card], ["Ambíguo", resumo.ambiguo]]
    : null;
  const brl = formatarBrl(resumo.usd, cambioBrl);
  return (
    <div className="bd-custo-missao">
      <p className="bd-custo-total" title={explicarCusto(resumo)}><strong>{formatarCusto(resumo)}</strong>{brl !== null ? ` (${brl})` : ""} <small>{LEGENDA_CUSTO}</small></p>
      {resumo.fontes_ausentes.length > 0 ? <p className="bd-nota" role="note">Sem fonte de uso: {resumo.fontes_ausentes.join(", ")}. O custo desses Panes não está na soma (nunca conta como zero).</p> : null}
      {partes !== null ? (
        <ul className="bd-lista" aria-label="Repartição do custo">
          {partes.map(([r, c]) => <li key={r}><span>{r}</span><span className="bd-custo" data-desconhecido={c.usd === null || undefined}>{c.registros === 0 ? "sem uso" : formatarCusto(c)}</span></li>)}
        </ul>
      ) : null}
      <p className="bd-nota" aria-live="polite">
        {previsao === null ? "Previsão indisponível." : previsao.base === "sem_base"
          ? `Previsão: ${CUSTO_DESCONHECIDO} (sem histórico nem ritmo suficientes).`
          : `Previsão do total: ${formatarValorUsd(previsao.total_projetado_usd, true)} (${previsao.base === "historico" ? `${previsao.cards_restantes} cards restantes × mediana de ${previsao.amostras} cards` : "ritmo diário observado"}${previsao.incompleto ? "; com uso sem preço" : ""}).`}
      </p>
      <div className="bd-linha-form">
        <label htmlFor={idTeto}>Teto da Missão (US$)</label>
        <input id={idTeto} inputMode="decimal" value={teto} onChange={(e) => { setTeto(e.target.value); setMsg(null); }} placeholder="ex.: 25" />
        <button type="button" className="botao-mini" onClick={aoGravar}>Definir teto</button>
        <button type="button" className="botao-mini" onClick={() => { setTeto(""); void gravarTeto(null); }}>Remover</button>
      </div>
      {msg !== null ? <p className="bd-nota" role="status">{msg}</p> : null}
    </div>
  );
}
