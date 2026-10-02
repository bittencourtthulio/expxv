import { useCallback, useEffect, useMemo, useState } from "react";
import type { CapacidadeSprintAgil, DestinoPendentesAgil, IndicadorSaude, ItemReviewAgil, ResultadoFecharSprintAgil, SprintComResumoAgil, SugestaoPlanejamentoAgil } from "../../../compartilhado/agil";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { avisar } from "../../estado/avisos";
import { Campo, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { formatarPontos, textoDoErro } from "./logica";

const hoje = (): string => new Date().toISOString().slice(0, 10);
const TEXTO_AVISO = (a: SugestaoPlanejamentoAgil["avisos"][number]): string => {
  switch (a.tipo) {
    case "excede_capacidade": return `Compromisso de ${a.pontos} pontos excede a capacidade (${a.capacidade}).`;
    case "sem_estimativa": return `${a.itens.length} item(ns) sem estimativa ficaram de fora do cálculo.`;
    case "risco_critico_demais": return `${a.n} itens de risco crítico (limite ${a.limite}).`;
    case "dependencia_fora": return `Um item depende de outro que não está na sprint.`;
    case "capacidade_sem_base": return "Sem base para calcular a capacidade: informe horas por dia dos membros ou feche uma sprint.";
  }
};

/** Sprint: criação, capacidade por membro, sugestão de compromisso, saúde, fechamento (diálogo da UI) e Review por item. */
export function Sprint({ ctx }: { ctx: CtxAgil }) {
  const [escolhida, setEscolhida] = useState<string | null>(ctx.filtros.sprint_id);
  const sprint: SprintComResumoAgil | null = ctx.sprints.find((s) => s.id === (escolhida ?? "")) ?? ctx.sprints.find((s) => s.estado === "ativa") ?? ctx.sprints.find((s) => s.estado === "planejada") ?? ctx.sprints[0] ?? null;
  const [novo, setNovo] = useState({ nome: "", inicio: hoje(), fim: "" });
  const [erro, setErro] = useState<unknown>(null);
  const [cap, setCap] = useState<CapacidadeSprintAgil | null>(null);
  const [sugestao, setSugestao] = useState<SugestaoPlanejamentoAgil | null>(null);
  const [saude, setSaude] = useState<IndicadorSaude[]>([]);
  const [fechando, setFechando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoFecharSprintAgil | null>(null);
  const [revisao, setRevisao] = useState<ItemReviewAgil[] | null>(null);
  const [nomesItens, setNomesItens] = useState<Record<string, string>>({});
  const sid = sprint?.id ?? null;

  const falha = (e: unknown): void => { setErro(e); avisar(textoDoErro(e), "erro"); };
  const mudou = useCallback((): void => { setErro(null); ctx.recarregar(); }, [ctx]);

  useEffect(() => {
    setSugestao(null); setCap(null); setSaude([]); setRevisao(null);
    if (sid === null) return;
    let vivo = true;
    void ctx.api.capacidadeLer(ctx.ws, sid).then((c) => vivo && setCap(c), () => undefined);
    void ctx.api.painel(ctx.ws, { sprint_id: sid }).then((p) => vivo && setSaude(p.saude), () => undefined);
    if (sprint?.estado !== "planejada") void ctx.api.reviewLer(ctx.ws, sid).then((r) => vivo && setRevisao(r), () => undefined);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.api, ctx.ws, sid, sprint?.estado, ctx.painel?.gerado_em]);

  useEffect(() => {
    // títulos dos itens da sprint (a sprint só carrega ids)
    if (sprint === null || sprint.itens.length === 0) { setNomesItens({}); return; }
    let vivo = true;
    void ctx.api.backlogListar({ workspace_id: ctx.ws, filtros: { sprint_id: sprint.id }, limite: 200 }).then((p) => vivo && setNomesItens(Object.fromEntries(p.itens.map((i) => [i.id, `${i.titulo}${i.pontos !== null ? ` · ${formatarPontos(i.pontos)} pts` : ""}`]))), () => undefined);
    return () => { vivo = false; };
  }, [ctx.api, ctx.ws, sprint?.id, sprint?.itens.length]);

  const criar = (): void => {
    if (novo.nome.trim() === "" || novo.fim === "" || novo.inicio === "") return;
    void ctx.api.sprintCriar(ctx.ws, { nome: novo.nome.trim(), inicio: novo.inicio, fim: novo.fim }).then((s) => { setEscolhida(s.id); setNovo({ nome: "", inicio: hoje(), fim: "" }); mudou(); }, falha);
  };
  const sugerir = (): void => { void ctx.api.planejamentoSugerir(ctx.ws, sid).then(setSugestao, falha); };
  const aplicar = async (): Promise<void> => {
    if (sugestao === null || sid === null) return;
    try {
      for (const id of sugestao.itens) await ctx.api.sprintItemMover(ctx.ws, sid, id, "adicionar", "sugestão do planejamento");
      setSugestao(null); avisar(`${sugestao.itens.length} itens adicionados ao compromisso.`, "sucesso"); mudou();
    } catch (e) { falha(e); }
  };
  const ativos = sprint?.itens.filter((i) => i.removido_em === null) ?? [];
  const ausencia = (membroId: string, valor: string): void => {
    const n = Number(valor.replace(",", "."));
    if (sid === null || !Number.isFinite(n) || n < 0) return;
    void ctx.api.capacidadeGravar(ctx.ws, sid, membroId, n).then(setCap, falha);
  };
  const marcarDemo = (itemId: string, resultadoDemo: "aceito" | "ajustar" | "rejeitado", devolver: boolean): void => {
    if (sid === null) return;
    void ctx.api.reviewGravar(ctx.ws, sid, itemId, resultadoDemo, null, devolver).then(() => { void ctx.api.reviewLer(ctx.ws, sid).then(setRevisao, () => undefined); if (devolver) mudou(); }, falha);
  };
  const totalCap = useMemo(() => cap?.total ?? null, [cap]);

  return (
    <div className="ag-sprint">
      {erro !== null && <FaixaErro erro={erro} />}
      <section className="ag-secao" aria-label="Sprints">
        <div className="ag-acoes-linha">
          <Campo rotulo="Sprint">
            <select value={sprint?.id ?? ""} onChange={(e) => setEscolhida(e.target.value)} disabled={ctx.sprints.length === 0}>
              {ctx.sprints.length === 0 && <option value="">Nenhuma sprint</option>}
              {ctx.sprints.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.estado}, {s.inicio} a {s.fim})</option>)}
            </select>
          </Campo>
          {sprint?.estado === "planejada" && <button type="button" className="ag-btn" onClick={() => void ctx.api.sprintIniciar(ctx.ws, sprint.id).then(mudou, falha)}>Iniciar sprint</button>}
          {(sprint?.estado === "planejada" || sprint?.estado === "ativa") && <button type="button" className="ag-btn" onClick={() => void ctx.api.sprintCancelar(ctx.ws, sprint.id).then(mudou, falha)}>Cancelar</button>}
          {sprint?.estado === "ativa" && <button type="button" className="ag-btn" data-primario onClick={() => setFechando(true)}>Fechar sprint…</button>}
        </div>
        <div className="ag-acoes-linha" role="group" aria-label="Nova sprint">
          <Campo rotulo="Nome"><input type="text" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></Campo>
          <Campo rotulo="Início"><input type="date" value={novo.inicio} onChange={(e) => setNovo({ ...novo, inicio: e.target.value })} /></Campo>
          <Campo rotulo="Fim"><input type="date" value={novo.fim} onChange={(e) => setNovo({ ...novo, fim: e.target.value })} /></Campo>
          <button type="button" className="ag-btn" disabled={novo.nome.trim() === "" || novo.fim === ""} onClick={criar}>Criar sprint</button>
        </div>
      </section>

      {sprint === null ? (
        <EstadoVazio icone="agil" titulo="Nenhuma sprint ainda" texto="Crie a primeira sprint acima. Depois sugira o compromisso a partir do backlog e da capacidade do time." />
      ) : (
        <>
          <section className="ag-secao" aria-label="Capacidade">
            <h4>Capacidade{totalCap !== null ? `: ${formatarPontos(totalCap)} pontos` : ""}</h4>
            {cap === null || cap.linhas.length === 0 ? <p className="ag-meta">Cadastre membros (humanos e agentes) em Config para calcular a capacidade. Sem base, a capacidade fica desconhecida (nunca zero).</p> : (
              <table className="ag-tab-simples"><thead><tr><th scope="col">Membro</th><th scope="col">Dias úteis</th><th scope="col">Ausências (dias)</th><th scope="col">Pontos</th><th scope="col">Base</th></tr></thead>
                <tbody>{cap.linhas.map((l) => (
                  <tr key={l.membro_id}><th scope="row">{l.rotulo}{l.tipo === "agente" ? " (agente)" : ""}</th><td>{l.dias_uteis}</td>
                    <td><input type="number" min={0} step={0.5} aria-label={`Ausências de ${l.rotulo}`} defaultValue={l.ausencias_dias} onBlur={(e) => ausencia(l.membro_id, e.target.value)} /></td>
                    <td>{formatarPontos(l.pontos)}</td><td>{l.base === "sem_base" ? "sem base" : l.base}{l.aviso !== null ? ` — ${l.aviso}` : ""}</td></tr>
                ))}</tbody></table>
            )}
          </section>

          <section className="ag-secao" aria-label="Compromisso">
            <h4>Compromisso: {formatarPontos(sprint.compromisso_pontos)} pontos · {ativos.length} itens</h4>
            <ul className="ag-fatores" aria-label="Itens da sprint">
              {ativos.map((i) => (
                <li key={i.item_id}>{nomesItens[i.item_id] ?? i.item_id}
                  {sprint.estado !== "fechada" && sprint.estado !== "cancelada" && <> <button type="button" className="ag-btn" onClick={() => void ctx.api.sprintItemMover(ctx.ws, sprint.id, i.item_id, "remover", sprint.estado === "ativa" ? "removido durante a sprint" : null).then(mudou, falha)}>Remover</button></>}
                </li>
              ))}
              {ativos.length === 0 && <li className="ag-meta">Nenhum item. Use a sugestão abaixo ou adicione pelo backlog.</li>}
            </ul>
            {sprint.estado === "planejada" && (
              <>
                <button type="button" className="ag-btn" onClick={sugerir}>Sugerir compromisso</button>
                {sugestao !== null && (
                  <div className="ag-sugestao" role="region" aria-label="Sugestão de compromisso">
                    <p>{sugestao.itens.length} itens · {formatarPontos(sugestao.pontos)} pontos{sugestao.capacidade !== null ? ` de ${formatarPontos(sugestao.capacidade)} de capacidade` : ""}{sugestao.limite !== null ? ` (limite com folga ${formatarPontos(sugestao.limite)})` : ""}</p>
                    <ul className="ag-fatores">{sugestao.itens_detalhe.map((i) => <li key={i.item_id}>{i.titulo} · {formatarPontos(i.pontos)} pts</li>)}</ul>
                    {sugestao.avisos.length > 0 && <ul className="ag-avisos" aria-label="Avisos do planejamento">{sugestao.avisos.map((a, i) => <li key={i}>{TEXTO_AVISO(a)}</li>)}</ul>}
                    <div className="ag-acoes-linha"><button type="button" className="ag-btn" data-primario disabled={sugestao.itens.length === 0} onClick={() => void aplicar()}>Aplicar ao compromisso</button><button type="button" className="ag-btn" onClick={() => setSugestao(null)}>Descartar sugestão</button></div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="ag-secao" aria-label="Saúde da sprint">
            <h4>Saúde</h4>
            {saude.length === 0 ? <p className="ag-meta">Sem indicadores: a saúde aparece quando a sprint está ativa.</p> : (
              <ul className="ag-saude">{saude.map((s) => <li key={s.id} data-cor={s.cor}><strong>{s.cor === "verde" ? "OK" : s.cor === "amarelo" ? "Atenção" : "Alerta"}</strong> {s.frase}<span className="ag-meta"> — {s.fato}</span></li>)}</ul>
            )}
          </section>

          {revisao !== null && (
            <section className="ag-secao" aria-label="Review">
              <h4>Review da sprint</h4>
              {revisao.length === 0 ? <p className="ag-meta">Nenhum item concluído para demonstrar ainda.</p> : (
                <ul className="ag-review">
                  {revisao.map((r) => (
                    <li key={r.item_id}>
                      <strong>{r.titulo}</strong> <span className="ag-meta">{formatarPontos(r.pontos)} pts · {r.commits} commits{r.demo !== null ? ` · resultado: ${r.demo.resultado}` : ""}</span>
                      <ul className="ag-dod">{r.dod.map((c) => <li key={c.criterio} data-estado={c.estado}>{c.estado === "ok" ? "OK" : c.estado === "falha" ? "Falha" : c.estado === "na" ? "N/A" : "?"} {c.criterio}</li>)}</ul>
                      <div className="ag-acoes-linha">
                        <button type="button" className="ag-btn" onClick={() => marcarDemo(r.item_id, "aceito", false)}>Aceitar</button>
                        <button type="button" className="ag-btn" onClick={() => marcarDemo(r.item_id, "ajustar", true)}>Ajustar e devolver ao backlog</button>
                        <button type="button" className="ag-btn" onClick={() => marcarDemo(r.item_id, "rejeitado", true)}>Rejeitar e devolver</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {fechando && sprint !== null && (
        <FecharSprint sprint={sprint} aoFechar={() => setFechando(false)} aoConfirmar={async (destino, versao) => {
          try { const r = await ctx.api.sprintFechar(ctx.ws, sprint.id, destino, versao); setResultado(r); setFechando(false); mudou(); } catch (e) { falha(e); setFechando(false); }
        }} />
      )}
      {resultado !== null && (
        <Dialogo titulo={resultado.ja_fechada ? "A sprint já estava fechada" : "Sprint fechada"} aoFechar={() => setResultado(null)}>
          <ul className="ag-fatores">
            <li>Compromisso inicial: {formatarPontos(resultado.resumo.compromisso_inicial)} pontos</li><li>Concluído: {formatarPontos(resultado.resumo.concluido_pontos)} pontos ({resultado.resumo.concluidos} itens)</li>
            <li>Carregados: {resultado.resumo.carregados} · Devolvidos: {resultado.resumo.devolvidos} · Descartados: {resultado.resumo.descartados}</li>
          </ul>
          <div className="dialogo-acoes"><button type="button" className="ag-btn" data-primario onClick={() => setResultado(null)}>Entendi</button></div>
        </Dialogo>
      )}
    </div>
  );
}

function FecharSprint({ sprint, aoFechar, aoConfirmar }: { sprint: SprintComResumoAgil; aoFechar: () => void; aoConfirmar: (d: DestinoPendentesAgil, versao: string | null) => Promise<void> }) {
  const [destino, setDestino] = useState<DestinoPendentesAgil>("backlog");
  const [versao, setVersao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Dialogo titulo={`Fechar ${sprint.nome}`} aoFechar={aoFechar}>
      <p>O que fazer com os itens que não ficaram prontos?</p>
      <Campo rotulo="Destino dos pendentes">
        <select value={destino} onChange={(e) => setDestino(e.target.value as DestinoPendentesAgil)} data-foco-inicial>
          <option value="backlog">Devolver ao backlog</option><option value="proxima">Levar para a próxima sprint</option><option value="descartar">Descartar</option>
        </select>
      </Campo>
      <Campo rotulo="Versão de lançamento (opcional)"><input type="text" value={versao} onChange={(e) => setVersao(e.target.value)} /></Campo>
      <p className="ag-meta">O fechamento é definitivo: o compromisso inicial e as métricas da sprint ficam congelados.</p>
      <div className="dialogo-acoes">
        <button type="button" className="ag-btn" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="ag-btn" data-primario disabled={ocupado} onClick={() => { setOcupado(true); void aoConfirmar(destino, versao.trim() === "" ? null : versao.trim()); }}>Fechar sprint</button>
      </div>
    </Dialogo>
  );
}
