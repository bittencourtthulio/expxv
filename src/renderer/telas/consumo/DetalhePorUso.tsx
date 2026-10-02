import { useEffect, useMemo, useState } from "react";
import type { AgruparCusto, CustoResumo, CustoSprint, FonteDeUsoEstado, LinhaRelatorio, PrevisaoPeriodo, RespostaRelatorioCusto } from "../../../compartilhado/custo";
import type { ApiAde } from "../../../compartilhado/ipc";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Virtualizada } from "../../componentes/Virtualizada";
import { useCarga } from "../../estado/carga";
import { CUSTO_DESCONHECIDO, LEGENDA_CUSTO, explicarCusto, formatarCusto, formatarTokens, formatarValorUsd } from "../../estado/custo-formato";
import { AGRUPAMENTOS_USO, intervalo, participacao, ROTULO_AGRUPAR, rotuloLinha, somaConfere, textoRelatorio, type JanelaUso } from "../../estado/uso-formato";
import { CustoMissaoPainel } from "../board/CustoMissao";
import { BarrasParticipacao } from "./graficos/BarrasParticipacao";
import { Sparkline } from "./graficos/Sparkline";

type ApiCusto = Partial<ApiAde["custo"]>;
export interface PropsDetalhe { workspaceId: string | null; api?: ApiCusto | undefined; sprints?: (() => Promise<Array<{ id: string; nome: string }>>) | undefined; agora?: () => Date }
const ALTURA_LINHA = 36;

const PROXIMO_PASSO_FONTE = "Esta CLI não grava uso que o ADE consiga ler. Use a CLI por OpenRouter (o proxy mede o uso) ou aguarde o adaptador desta CLI.";

/** Aba "Detalhe por uso": agrupa o uso observado (agregados materializados) por modelo, workspace, Missão, Pane, conta, dia ou card, com previsão, tetos e Sprint. */
export function DetalhePorUso({ workspaceId, api = ade()?.custo, sprints, agora = () => new Date() }: PropsDetalhe) {
  const [agrupar, setAgrupar] = useState<AgruparCusto>("modelo");
  const [janela, setJanela] = useState<JanelaUso>("7d");
  const [sel, setSel] = useState<string | null>(null);
  const [extras, setExtras] = useState<LinhaRelatorio[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState("");
  const [cursorErro, setCursorErro] = useState(false);

  const janelaIso = useMemo(() => intervalo(janela, agora()), [janela, agrupar, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtros = workspaceId === null || agrupar === "workspace" ? undefined : { workspace_id: workspaceId };
  const chave = `${agrupar}|${janela}|${workspaceId ?? ""}`;
  const rel = useCarga<RespostaRelatorioCusto>(api?.relatorio === undefined ? undefined : () => api.relatorio!({ agrupar, ...janelaIso, ...(filtros === undefined ? {} : { filtros }), limite: 200 }), chave);
  const fontes = useCarga<FonteDeUsoEstado[]>(api?.fontes === undefined ? undefined : () => api.fontes!(workspaceId ?? undefined), `f|${workspaceId ?? ""}`);
  const prev = useCarga<PrevisaoPeriodo>(api?.previsaoPeriodo === undefined || workspaceId === null ? undefined : () => { const a = agora(); return api.previsaoPeriodo!(workspaceId, new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)).toISOString(), new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1)).toISOString()); }, `p|${workspaceId ?? ""}`);
  const listaSprints = useCarga<Array<{ id: string; nome: string }>>(sprints, `s|${workspaceId ?? ""}`);
  const sp = useCarga<CustoSprint>(api?.sprint === undefined || workspaceId === null || sprintId === "" ? undefined : () => api.sprint!(workspaceId, sprintId), `sp|${sprintId}`);

  useEffect(() => { setExtras([]); setProximo(null); setSel(null); setCursorErro(false); }, [chave]);
  useEffect(() => { if (rel.estado === "ok") setProximo(rel.dados.proximo); }, [rel.estado, rel.dados]);

  const linhas: LinhaRelatorio[] = rel.dados === null ? [] : [...rel.dados.linhas, ...extras];
  const total: CustoResumo | null = rel.dados?.total ?? null;
  const semFonte = (fontes.dados ?? []).filter((f) => f.estado === "sem_fonte");
  const semFonteTexto = semFonte.map((f) => f.cli);
  const maisPaginas = async (): Promise<void> => {
    if (proximo === null || api?.relatorio === undefined) return;
    try {
      const r = await api.relatorio({ agrupar, ...janelaIso, ...(filtros === undefined ? {} : { filtros }), cursor: proximo, limite: 200 });
      setExtras((e) => [...e, ...r.linhas]);
      setProximo(r.proximo);
    } catch { setCursorErro(true); }
  };
  const copiar = async (): Promise<void> => {
    if (total === null) return;
    try { await navigator.clipboard.writeText(textoRelatorio(agrupar, janela, linhas, total, semFonteTexto)); setAviso("Relatório copiado (só rótulos e números)."); }
    catch { setAviso("Não foi possível copiar."); }
  };

  const serieDia = agrupar === "dia" ? linhas.filter((l) => l.custo.usd !== null) : [];
  const maxDia = Math.max(0.0001, ...serieDia.map((l) => l.custo.usd ?? 0));

  return (
    <div className="uso" aria-label="Detalhe por uso">
      <div className="uso-controles" role="toolbar" aria-label="Controles do detalhe por uso">
        <label>Agrupar por <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as AgruparCusto)}>{AGRUPAMENTOS_USO.map((a) => <option key={a} value={a}>{ROTULO_AGRUPAR[a]}</option>)}</select></label>
        <label>Janela <select value={janela} onChange={(e) => setJanela(e.target.value as JanelaUso)}><option value="24h">24 h</option><option value="7d">7 dias</option><option value="30d">30 dias</option></select></label>
        <button type="button" className="botao-mini" disabled={total === null} onClick={() => void copiar()}>Copiar relatório</button>
        <span className="consumo-nota">{LEGENDA_CUSTO}: numa assinatura ninguém é cobrado por token.</span>
      </div>
      {aviso !== null ? <p className="consumo-nota" role="status">{aviso}</p> : null}
      {api?.relatorio === undefined || rel.estado === "indisponivel" ? <EstadoVazio icone="consumo" titulo="Custo indisponível" texto="Esta janela não está ligada ao serviço de custo. Abra o app para ver o uso por modelo, Missão e Pane." />
        : rel.estado === "erro" ? <p role="alert" className="erro-caixa">Não foi possível ler o uso: {rel.mensagem}</p>
        : rel.estado === "carregando" && rel.dados === null ? <div aria-busy="true" role="status" className="consumo-nota">Lendo o uso…</div>
        : linhas.length === 0 && semFonte.length === 0 ? <EstadoVazio icone="consumo" titulo="Nenhum uso observado neste período" texto="O uso aparece quando uma CLI (Claude Code, Codex ou OpenRouter) grava consumo neste workspace. Rode um Pane e volte aqui; para outras CLIs veja Fontes e preços." />
        : (
          <>
            {agrupar === "dia" && serieDia.length > 0 ? <Sparkline pontos={serieDia.map((l, i) => ({ x: i, y: ((l.custo.usd ?? 0) / maxDia) * 100 }))} rotulo="Custo por dia" largura={240} altura={36} /> : null}
            <BarrasParticipacao rotulo={`Participação por ${ROTULO_AGRUPAR[agrupar].toLowerCase()}`} fatias={linhas.map((l) => ({ id: l.chave, rotulo: rotuloLinha(l, agrupar), valor: l.custo.usd, texto: total === null ? "" : participacao(l.custo, total) === null ? (l.custo.usd === null ? "sem preço" : "—") : `${Math.round((participacao(l.custo, total) ?? 0) * 100)}%` }))} />
            <div className="uso-linha uso-linha-cab" role="presentation"><span>{ROTULO_AGRUPAR[agrupar]}</span><span>in</span><span>out</span><span>cache</span><span>custo</span><span>%</span></div>
            <div className="uso-lista">
              <Virtualizada
                itens={linhas}
                alturaItem={ALTURA_LINHA}
                rotulo={`Uso por ${ROTULO_AGRUPAR[agrupar].toLowerCase()}`}
                chave={(l, i) => `${l.chave}|${i}`}
                renderizar={(l) => {
                  const p = total === null ? null : participacao(l.custo, total);
                  const clicavel = agrupar === "missao";
                  const conteudo = (
                    <>
                      <span className="uso-rotulo" title={rotuloLinha(l, agrupar)}>{rotuloLinha(l, agrupar)}</span>
                      <span>{formatarTokens(l.custo.tokens.entrada)}</span>
                      <span>{formatarTokens(l.custo.tokens.saida)}</span>
                      <span>{formatarTokens(l.custo.tokens.cache_leitura + l.custo.tokens.cache_escrita)}</span>
                      <span className="bd-custo" data-desconhecido={l.custo.usd === null || undefined} title={explicarCusto(l.custo)}>{formatarCusto(l.custo)}</span>
                      <span>{p === null ? "—" : `${Math.round(p * 100)}%`}</span>
                    </>
                  );
                  return clicavel
                    ? <button type="button" className="uso-linha uso-clicavel" aria-pressed={sel === l.chave} onClick={() => setSel(sel === l.chave ? null : l.chave)}>{conteudo}</button>
                    : <div className="uso-linha">{conteudo}</div>;
                }}
              />
            </div>
            {semFonte.map((f) => (
              <div key={`${f.cli}|${f.pane_id ?? ""}`} className="uso-linha uso-semfonte" role="note">
                <span className="uso-rotulo">sem fonte de uso: {f.cli}</span><span /><span /><span /><span className="bd-custo" data-desconhecido>{CUSTO_DESCONHECIDO}</span><span>—</span>
                <small className="uso-proximo">{PROXIMO_PASSO_FONTE}</small>
              </div>
            ))}
            {total !== null ? (
              <div className="uso-linha uso-total" role="note" aria-label="Total do período">
                <span className="uso-rotulo">Total</span>
                <span>{formatarTokens(total.tokens.entrada)}</span><span>{formatarTokens(total.tokens.saida)}</span><span>{formatarTokens(total.tokens.cache_leitura + total.tokens.cache_escrita)}</span>
                <span className="bd-custo" title={explicarCusto(total)}>{formatarCusto(total)}</span><span title={somaConfere(linhas, total) || proximo !== null ? undefined : "A soma das linhas difere do total"}>{somaConfere(linhas, total) || proximo !== null ? "" : "≠"}</span>
              </div>
            ) : null}
            {proximo !== null ? <button type="button" className="botao-mini" onClick={() => void maisPaginas()}>Carregar mais</button> : null}
            {cursorErro ? <p role="alert" className="erro-caixa">Não foi possível carregar mais linhas.</p> : null}
          </>
        )}
      {sel !== null ? <section className="uso-secao" aria-label="Custo da Missão"><h2>Missão selecionada</h2><CustoMissaoPainel missionId={sel} /></section> : null}
      {prev.estado === "ok" ? (
        <p className="consumo-nota" role="note">
          Mês corrente: gasto {formatarValorUsd(prev.dados.gasto_usd, true)}
          {prev.dados.base === "ritmo" ? `; média diária ${formatarValorUsd(prev.dados.media_diaria_usd, true)}; projeção até o fim do mês ${formatarValorUsd(prev.dados.projecao_fim_periodo_usd, true)} (ritmo observado).` : `; projeção: ${CUSTO_DESCONHECIDO} (sem base).`}
        </p>
      ) : null}
      {sprints !== undefined && listaSprints.estado === "ok" && listaSprints.dados.length > 0 ? (
        <section className="uso-secao" aria-label="Custo por Sprint">
          <label>Custo da Sprint <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}><option value="">escolha…</option>{listaSprints.dados.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          {sp.estado === "ok" ? <p className="consumo-nota">{formatarCusto(sp.dados.custo)} em {sp.dados.itens} itens{sp.dados.itens_sem_custo > 0 ? ` (${sp.dados.itens_sem_custo} sem custo conhecido)` : ""}. {LEGENDA_CUSTO}.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
