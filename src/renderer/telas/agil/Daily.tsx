import { useEffect, useState } from "react";
import type { DailyAgil } from "../../../compartilhado/agil";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { avisar } from "../../estado/avisos";
import { Carregando, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { textoDoErro } from "./logica";

const BLOCOS = [["ontem", "Ontem"], ["hoje", "Hoje"], ["bloqueios", "Bloqueios"], ["atrasos", "Atrasos e riscos"]] as const;

async function copiar(texto: string): Promise<void> {
  try { await navigator.clipboard.writeText(texto); avisar("Daily copiada.", "sucesso"); } catch { avisar("Não foi possível copiar: o sistema negou o acesso à área de transferência.", "erro"); }
}

/** Daily gerada dos FATOS (rastro do método): quatro blocos por pessoa/agente, copiáveis. Nunca inventa: sem atividade diz isso. */
export function Daily({ ctx }: { ctx: CtxAgil }) {
  const [daily, setDaily] = useState<DailyAgil | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(false);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const gerar = (): void => {
    setCarregando(true);
    void ctx.api.dailyGerar(ctx.ws, ctx.filtros.sprint_id).then((d) => { setDaily(d); setErro(null); setNotas({}); }, (e: unknown) => setErro(e)).finally(() => setCarregando(false));
  };
  useEffect(gerar, [ctx.api, ctx.ws, ctx.filtros.sprint_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = (): void => {
    if (daily?.cerimonia_id == null) return;
    const observacoes = Object.entries(notas).filter(([, v]) => v.trim() !== "").map(([ref, observacao]) => ({ ref, observacao: observacao.trim() }));
    void ctx.api.dailySalvar(ctx.ws, daily.cerimonia_id, observacoes).then(() => avisar("Observações salvas.", "sucesso"), (e) => avisar(textoDoErro(e), "erro"));
  };
  return (
    <div className="ag-daily">
      <div className="ag-sub-barra">
        <button type="button" className="ag-btn" onClick={gerar} disabled={carregando}>Gerar daily</button>
        <button type="button" className="ag-btn" disabled={daily === null} onClick={() => daily !== null && void copiar(daily.texto_curto)}>Copiar texto</button>
        <button type="button" className="ag-btn" disabled={daily === null} onClick={() => daily !== null && void copiar(daily.markdown)}>Copiar Markdown</button>
        <button type="button" className="ag-btn" disabled={daily?.cerimonia_id == null || Object.keys(notas).length === 0} onClick={salvar}>Salvar observações</button>
        {daily !== null && <span className="ag-meta">desde {daily.desde} · gerada {daily.gerada_em.slice(0, 16).replace("T", " ")}</span>}
      </div>
      {erro !== null && <FaixaErro erro={erro} aoTentar={gerar} />}
      {daily === null ? (erro === null ? <Carregando /> : null) : daily.sem_atividade ? (
        <EstadoVazio icone="agil" titulo="Sem atividade registrada" texto="Não há movimento no rastro do método desde o último dia útil. Quando os agentes e a equipe trabalharem com a sprintx, a daily aparece aqui." />
      ) : (
        <div className="ag-daily-membros">
          {daily.membros.map((m) => (
            <section key={m.membro_id ?? "_sem_dono"} className="ag-secao" aria-label={m.rotulo}>
              <h4>{m.rotulo}</h4>
              <div className="ag-daily-blocos">
                {BLOCOS.map(([chave, titulo]) => {
                  const linhas = chave === "atrasos" ? [...m.atrasos, ...m.riscos] : m[chave];
                  return (
                    <div key={chave} className="ag-daily-bloco">
                      <h5>{titulo}</h5>
                      {linhas.length === 0 ? <p className="ag-meta">Nada.</p> : <ul>{linhas.map((l) => (
                        <li key={`${chave}-${l.ref}-${l.texto}`}>{l.texto}
                          <input type="text" className="ag-inline" aria-label={`Observação sobre ${l.ref}`} placeholder="observação" value={notas[l.ref] ?? l.observacao ?? ""} onChange={(e) => setNotas({ ...notas, [l.ref]: e.target.value })} />
                        </li>))}</ul>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
