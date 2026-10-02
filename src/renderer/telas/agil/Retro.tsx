import { useCallback, useEffect, useState } from "react";
import type { RetroAgil } from "../../../compartilhado/agil";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { avisar } from "../../estado/avisos";
import { aoPedirAgil } from "../../estado/agil-acoes";
import { Campo, Carregando, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { formatarPercentual, textoDoErro } from "./logica";

const ROTULO_COLUNA: Record<string, string> = { comecar: "Começar", parar: "Parar", continuar: "Continuar", gostei: "Gostei", aprendi: "Aprendi", faltou: "Faltou", desejei: "Desejei" };

/** Retrospectiva assistida por dados: colunas com itens e votos, painel "dados da sprint" (insights determinísticos) e ações com dono e prazo. */
export function Retro({ ctx }: { ctx: CtxAgil }) {
  const candidata = ctx.filtros.sprint_id ?? ctx.sprints.find((s) => s.estado === "fechada")?.id ?? ctx.sprints.find((s) => s.estado === "ativa")?.id ?? ctx.sprints[0]?.id ?? null;
  const [sid, setSid] = useState<string | null>(candidata);
  const [retro, setRetro] = useState<RetroAgil | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [acao, setAcao] = useState({ texto: "", dono: "", prazo: "" });
  useEffect(() => { if (sid === null && candidata !== null) setSid(candidata); }, [candidata, sid]);
  const carregar = useCallback(() => {
    if (sid === null) return;
    void ctx.api.retroLer(ctx.ws, sid).then((r) => { setRetro(r); setErro(null); }, (e: unknown) => setErro(e));
  }, [ctx.api, ctx.ws, sid]);
  useEffect(() => { setRetro(null); carregar(); }, [carregar]);
  useEffect(() => aoPedirAgil(() => undefined), []);
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };

  if (sid === null) return <EstadoVazio icone="agil" titulo="Sem sprint para a retrospectiva" texto="Crie e feche uma sprint na aba Sprint. A retro usa os dados reais dela: retrabalho, QA reprovado, atrasos e erros de estimativa." />;
  const cerimonia = retro?.cerimonia.id ?? null;
  const ins = retro?.cerimonia.insights ?? null;
  const rotuloMembro = (id: string | null): string => (id === null ? "sem dono" : ctx.membros.find((m) => m.id === id)?.rotulo ?? id);

  return (
    <div className="ag-retro">
      <div className="ag-sub-barra">
        <Campo rotulo="Sprint"><select value={sid} onChange={(e) => setSid(e.target.value)}>{ctx.sprints.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.estado})</option>)}</select></Campo>
        {retro !== null && <span className="ag-meta">formato: {retro.cerimonia.formato ?? "—"} · {retro.cerimonia.data}</span>}
      </div>
      {erro !== null && <FaixaErro erro={erro} aoTentar={carregar} />}
      {retro === null ? (erro === null ? <Carregando /> : null) : (
        <div className="ag-retro-corpo">
          <div className="ag-retro-colunas">
            {retro.colunas.map((c) => (
              <section key={c} className="ag-secao" aria-label={ROTULO_COLUNA[c] ?? c}>
                <h4>{ROTULO_COLUNA[c] ?? c}</h4>
                <ul className="ag-retro-itens">
                  {retro.itens.filter((i) => i.coluna === c).map((i) => (
                    <li key={i.id}><span>{i.texto}</span> <button type="button" className="ag-btn" aria-label={`Votar em: ${i.texto}`} onClick={() => cerimonia !== null && void ctx.api.retroItemGravar(ctx.ws, cerimonia, { item_id: i.id, voto: 1 }).then(setRetro, falha)}>▲ {i.votos}</button></li>
                  ))}
                </ul>
                <input type="text" className="ag-inline" aria-label={`Novo item em ${ROTULO_COLUNA[c] ?? c}`} placeholder="Escreva e tecle Enter" value={textos[c] ?? ""} onChange={(e) => setTextos({ ...textos, [c]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && (textos[c] ?? "").trim() !== "" && cerimonia !== null) { void ctx.api.retroItemGravar(ctx.ws, cerimonia, { coluna: c, texto: (textos[c] ?? "").trim() }).then((r) => { setRetro(r); setTextos({ ...textos, [c]: "" }); }, falha); } }} />
              </section>
            ))}
          </div>
          <aside className="ag-secao ag-dados-sprint" aria-label="Dados da sprint">
            <h4>Dados da sprint</h4>
            {ins === null ? <p className="ag-meta">Sem dados calculados para esta sprint.</p> : (
              <dl>
                <dt>Mais retrabalho</dt><dd>{ins.top_retrabalho.length === 0 ? "nenhum" : ins.top_retrabalho.map((x) => `${x.titulo} (${x.eventos})`).join("; ")}</dd>
                <dt>QA reprovado</dt><dd>{ins.qa_reprovado.length === 0 ? "nenhum" : ins.qa_reprovado.map((x) => `${x.titulo} (${x.reprovacoes}×)`).join("; ")}</dd>
                <dt>Atrasos</dt><dd>{ins.atrasos.length === 0 ? "nenhum" : ins.atrasos.map((x) => `${x.titulo} (${x.horas} h)`).join("; ")}</dd>
                <dt>Maiores erros de estimativa</dt><dd>{ins.maiores_erros.length === 0 ? "sem amostras" : ins.maiores_erros.map((x) => `${x.titulo} (×${x.razao})`).join("; ")}</dd>
                <dt>WIP</dt><dd>médio {ins.wip.medio ?? "—"}{ins.wip.limite !== null ? ` · limite ${ins.wip.limite}` : ""}{ins.wip.acima === true ? " · acima do limite" : ""}</dd>
                <dt>De primeira</dt><dd>{formatarPercentual(ins.ftr.sprint)}{ins.ftr.media_movel !== null ? ` · média móvel ${formatarPercentual(ins.ftr.media_movel)}` : ""}{ins.ftr.abaixo === true ? " · abaixo da média" : ""}</dd>
                <dt>Bloqueios longos</dt><dd>{ins.bloqueios_longos.length === 0 ? "nenhum" : ins.bloqueios_longos.map((x) => `${x.ref} (${x.dias} d)`).join("; ")}</dd>
                <dt>Ações anteriores não cumpridas</dt><dd>{ins.acoes_nao_cumpridas.length === 0 ? "nenhuma" : ins.acoes_nao_cumpridas.map((x) => `${x.texto}${x.vencida ? " (vencida)" : ""}`).join("; ")}</dd>
              </dl>
            )}
          </aside>
          <section className="ag-secao ag-acoes-retro" aria-label="Ações da retrospectiva">
            <h4>Ações</h4>
            <ul className="ag-fatores">
              {retro.acoes.map((a) => (
                <li key={a.id} data-estado={a.estado}>
                  <span>{a.texto}</span> <span className="ag-meta">· {rotuloMembro(a.dono_membro_id)}{a.prazo !== null ? ` · prazo ${a.prazo}` : ""}{a.vencida ? " · vencida" : ""} · {a.estado}</span>
                  {cerimonia !== null && a.estado === "aberta" && <> <button type="button" className="ag-btn" onClick={() => void ctx.api.retroAcaoGravar(ctx.ws, cerimonia, { acao_id: a.id, estado: "feita" }).then(setRetro, falha)}>Concluir</button></>}
                  {a.item_id === null && <> <button type="button" className="ag-btn" onClick={() => void ctx.api.retroAcaoParaItem(ctx.ws, a.id).then(() => { avisar("Ação virou item do backlog.", "sucesso"); carregar(); ctx.recarregar(); }, falha)}>Virar item</button></>}
                </li>
              ))}
              {retro.acoes.length === 0 && <li className="ag-meta">Nenhuma ação ainda.</li>}
            </ul>
            <div className="ag-acoes-linha" role="group" aria-label="Nova ação">
              <Campo rotulo="Ação"><input type="text" value={acao.texto} onChange={(e) => setAcao({ ...acao, texto: e.target.value })} /></Campo>
              <Campo rotulo="Dono"><select value={acao.dono} onChange={(e) => setAcao({ ...acao, dono: e.target.value })}><option value="">sem dono</option>{ctx.membros.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}</select></Campo>
              <Campo rotulo="Prazo"><input type="date" value={acao.prazo} onChange={(e) => setAcao({ ...acao, prazo: e.target.value })} /></Campo>
              <button type="button" className="ag-btn" disabled={acao.texto.trim() === "" || cerimonia === null} onClick={() => cerimonia !== null && void ctx.api.retroAcaoGravar(ctx.ws, cerimonia, { texto: acao.texto.trim(), dono_membro_id: acao.dono === "" ? null : acao.dono, prazo: acao.prazo === "" ? null : acao.prazo }).then((r) => { setRetro(r); setAcao({ texto: "", dono: "", prazo: "" }); }, falha)}>Adicionar ação</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
