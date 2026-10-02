import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AlvoDisponivel, ApiBench, DetalheResultado, ErroRodar, GradeRun, PrecoBench, ResumoRun, TarefaBench } from "../../../compartilhado/bench";
import { MAX_PARALELO } from "../../../compartilhado/bench";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { avisar } from "../../estado/avisos";
import { aoPedirBench } from "../../estado/bench-acoes";
import { Comparar, type PortaHarness } from "./Comparar";
import { DialogoAlvos, DialogoPrecos, type ContaMin } from "./Configuracao";
import { DialogoConsentimento, type Finalidade, type PedidoEstimativa } from "./Consentimento";
import { Detalhe } from "./Detalhe";
import { Grade } from "./Grade";
import { construirGrade, contadorTexto } from "./logica";
import "./bench.css";

export interface PropsTelaBench { api?: ApiBench; harness?: PortaHarness; contas?: readonly ContaMin[]; copiar?: (t: string) => Promise<void> }

const TEXTO_ERRO_RODAR: Readonly<Record<ErroRodar, string>> = {
  consentimento_invalido: "O consentimento expirou ou já foi usado. Abra o diálogo de novo.",
  sandbox_indisponivel: "Sandbox indisponível: o Bench se recusa a rodar sem isolamento.",
  alvo_indisponivel: "Há alvo indisponível. Veja o motivo em “Alvos”.",
  tarefa_inativa: "Há tarefa que não está ativa.",
  limite_execucoes: "Limite de execuções por Run atingido.",
};
const copiarPadrao = async (t: string): Promise<void> => { await navigator.clipboard.writeText(t); };

/** Popover de checkboxes (sem páginas de configuração inline): Esc e clique fora fecham; foco volta ao botão. */
function Seletor({ rotulo, resumo, children }: { rotulo: string; resumo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent): void => { if (raiz.current !== null && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  return (
    <span className="bn-seletor" ref={raiz} onKeyDown={(e) => { if (e.key === "Escape" && aberto) { e.stopPropagation(); setAberto(false); botao.current?.focus(); } }}>
      <button ref={botao} type="button" className="bn-btn" aria-haspopup="true" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>{rotulo} ({resumo}) ▾</button>
      {aberto && <div className="bn-popover" role="group" aria-label={rotulo}>{children}</div>}
    </span>
  );
}

function BenchComApi({ api, harness, contas, copiar }: { api: ApiBench; harness: PortaHarness | undefined; contas: readonly ContaMin[]; copiar: (t: string) => Promise<void> }) {
  const [tarefas, setTarefas] = useState<TarefaBench[]>([]);
  const [alvos, setAlvos] = useState<AlvoDisponivel[]>([]);
  const [precos, setPrecos] = useState<PrecoBench[]>([]);
  const [runs, setRuns] = useState<ResumoRun[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selT, setSelT] = useState<Set<string> | null>(null);
  const [selA, setSelA] = useState<Set<string> | null>(null);
  const [paralelo, setParalelo] = useState(3);
  const [teto, setTeto] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [grade, setGrade] = useState<GradeRun | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [visao, setVisao] = useState<"grade" | "comparar">("grade");
  const [dialogo, setDialogo] = useState<null | { tipo: "consentimento"; finalidade: Finalidade; pedido: PedidoEstimativa; rerodar?: DetalheResultado } | { tipo: "alvos" } | { tipo: "precos" }>(null);
  const [versaoCmp, setVersaoCmp] = useState(0);
  const runRef = useRef<string | null>(null);
  runRef.current = runId;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ativas = useMemo(() => tarefas.filter((t) => t.estado === "ativa"), [tarefas]);
  const tarefasSel = useMemo(() => (selT ?? new Set(ativas.map((t) => t.slug))), [selT, ativas]);
  const alvosSel = useMemo(() => (selA ?? new Set(alvos.filter((a) => a.disponivel).map((a) => a.slug))), [selA, alvos]);
  const rotuloAlvo = useCallback((slug: string): string => alvos.find((a) => a.slug === slug)?.rotulo ?? slug, [alvos]);

  const recarregarBase = useCallback(async (): Promise<void> => {
    try {
      const [t, a, r, p] = await Promise.all([api.tarefasListar(null, null), api.alvosListar(), api.runsListar(null), api.precosLer()]);
      setTarefas(t); setAlvos(a); setRuns(r.itens); setPrecos(p); setErro(null);
      setRunId((atual) => atual ?? r.itens[0]?.id ?? null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar o Bench."); } finally { setCarregando(false); }
  }, [api]);
  const recarregarGrade = useCallback(async (): Promise<void> => {
    const id = runRef.current;
    if (id === null) { setGrade(null); return; }
    try { const g = await api.estadoRun(id); if (runRef.current === id) setGrade(g); } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui ler a Run."); }
  }, [api]);

  useEffect(() => { void recarregarBase(); }, [recarregarBase]);
  useEffect(() => { void recarregarGrade(); }, [runId, recarregarGrade]);
  useEffect(() => {
    const agendar = (): void => { if (timer.current !== null) return; timer.current = setTimeout(() => { timer.current = null; void recarregarGrade(); }, 250); };
    const sair = api.assinar((e) => {
      if (e.tipo === "run_terminou") { void recarregarBase(); void recarregarGrade(); setVersaoCmp((v) => v + 1); return; }
      if (e.run_id === runRef.current) agendar();
    });
    return () => { sair(); if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  }, [api, recarregarBase, recarregarGrade]);
  useEffect(() => aoPedirBench((p) => {
    if (p === "comparar" || p === "sugestao") setVisao("comparar");
    if (p === "alvos") setDialogo({ tipo: "alvos" });
    if (p === "precos") setDialogo({ tipo: "precos" });
  }), []);

  const tetoNum = teto.trim() === "" ? null : Number(teto.replace(",", "."));
  const tetoValido = tetoNum === null || (Number.isFinite(tetoNum) && tetoNum >= 0);
  const pedidoRodar = (): PedidoEstimativa => ({ tarefas: [...tarefasSel], alvos: [...alvosSel], max_paralelo: paralelo, teto_usd: tetoValido ? tetoNum : null, juiz_alvo: null });
  const executando = grade?.run.estado === "executando" || grade?.run.estado === "enfileirada";
  const podeRodar = tarefasSel.size > 0 && alvosSel.size > 0 && tetoValido && !executando;
  const podeJulgar = grade !== null && grade.resultados.length > 0 && !executando;

  const aoToken = async (finalidade: Finalidade, estId: string, token: string, juiz: string | null, rerodar: DetalheResultado | undefined): Promise<string | null> => {
    try {
      if (finalidade === "rodar") {
        const r = await api.rodar(estId, token);
        if ("erro" in r) return TEXTO_ERRO_RODAR[r.erro];
        setRunId(r.run_id); setVisao("grade"); setDetalheId(null);
        await recarregarBase();
        return null;
      }
      if (finalidade === "rerodar" && rerodar !== undefined && runId !== null) {
        const r = await api.rerodar(runId, rerodar.tarefa, rerodar.alvo, token);
        if ("erro" in r) return TEXTO_ERRO_RODAR[r.erro];
        setDetalheId(r.resultado_id);
        await recarregarGrade();
        return null;
      }
      if (finalidade === "julgar" && runId !== null && juiz !== null) {
        const r = await api.julgar(runId, null, juiz, token);
        if ("erro" in r) return r.erro === "juiz_igual_a_executor" ? "O juiz não pode ser um dos executores." : r.erro === "sem_resultados" ? "Não há resultados para julgar." : TEXTO_ERRO_RODAR.consentimento_invalido;
        avisar(`Julgamento concluído (${r.veredito_ids.length} veredito(s)).`, "sucesso");
        await recarregarGrade(); await recarregarBase(); setVersaoCmp((v) => v + 1);
        return null;
      }
      return "Pedido inválido.";
    } catch (e) { return e instanceof Error ? e.message : "Falha ao iniciar."; }
  };

  const exportar = async (formato: "md" | "json"): Promise<void> => {
    try {
      const r = await api.exportarRelatorio(runId === null ? null : [runId], formato);
      avisar(r.caminho === null ? "Exportação cancelada." : "Relatório salvo.", r.caminho === null ? "info" : "sucesso");
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha ao exportar.", "erro"); }
  };

  const linhas = useMemo(() => (grade === null ? [] : construirGrade(grade.resultados, grade.run.tarefas.map((t) => t.slug), grade.run.alvos)), [grade]);
  const semAlvoDisponivel = alvos.length === 0 || alvos.every((a) => !a.disponivel);

  return (
    <section className="bench" data-modo="leitura" data-largura="larga" aria-label="Bench">
      <div role="toolbar" aria-label="Controles do Bench" className="bn-barra">
        <Seletor rotulo="Tarefas" resumo={`${tarefasSel.size}/${ativas.length}`}>
          {tarefas.filter((t) => t.estado !== "aposentada").map((t) => (
            <label key={t.slug} className="bn-check"><input type="checkbox" checked={tarefasSel.has(t.slug)} disabled={t.estado !== "ativa"} onChange={(e) => setSelT((p) => { const n = new Set(p ?? tarefasSel); if (e.target.checked) n.add(t.slug); else n.delete(t.slug); return n; })} /> {t.titulo}{t.estado === "rascunho" ? " (rascunho)" : ""}</label>
          ))}
          {tarefas.length === 0 && <p className="bn-meta">Nenhuma tarefa.</p>}
        </Seletor>
        <Seletor rotulo="Alvos" resumo={`${alvosSel.size}/${alvos.length}`}>
          {alvos.map((a) => (
            <label key={a.slug} className="bn-check" title={a.motivo ?? undefined}><input type="checkbox" checked={alvosSel.has(a.slug)} disabled={!a.disponivel} onChange={(e) => setSelA((p) => { const n = new Set(p ?? alvosSel); if (e.target.checked) n.add(a.slug); else n.delete(a.slug); return n; })} /> {a.rotulo} <span className="bn-meta">{a.cli}{a.disponivel ? "" : ` · indisponível: ${a.motivo ?? ""}`}</span></label>
          ))}
          {alvos.length === 0 && <p className="bn-meta">Nenhum alvo. Configure abaixo.</p>}
          <div className="bn-popover-rodape">
            <button type="button" className="bn-btn" onClick={() => setDialogo({ tipo: "alvos" })}>Configurar alvos…</button>
            <button type="button" className="bn-btn" onClick={() => setDialogo({ tipo: "precos" })}>Preços…</button>
          </div>
        </Seletor>
        <label className="bn-campo bn-campo-linha">Paralelo
          <input type="number" min={1} max={MAX_PARALELO} value={paralelo} onChange={(e) => setParalelo(Math.max(1, Math.min(MAX_PARALELO, Math.trunc(Number(e.target.value)) || 1)))} style={{ width: 46 }} />
        </label>
        <label className="bn-campo bn-campo-linha">Teto US$
          <input inputMode="decimal" value={teto} onChange={(e) => setTeto(e.target.value)} placeholder="sem teto" aria-invalid={!tetoValido} style={{ width: 70 }} />
        </label>
        <button type="button" className="bn-btn" data-primario disabled={!podeRodar} onClick={() => setDialogo({ tipo: "consentimento", finalidade: "rodar", pedido: pedidoRodar() })}>Rodar…</button>
        <button type="button" className="bn-btn" disabled={!executando} onClick={() => { if (runId !== null) void api.cancelar(runId).then(() => recarregarGrade()); }}>Cancelar</button>
        <button type="button" className="bn-btn" disabled={!podeJulgar} onClick={() => grade !== null && setDialogo({ tipo: "consentimento", finalidade: "julgar", pedido: { tarefas: grade.run.tarefas.map((t) => t.slug), alvos: grade.run.alvos, max_paralelo: grade.run.max_paralelo, teto_usd: grade.run.teto_usd, juiz_alvo: null } })}>Julgar…</button>
        <button type="button" className="bn-btn" aria-pressed={visao === "comparar"} onClick={() => setVisao((v) => (v === "comparar" ? "grade" : "comparar"))}>Comparar</button>
        <Seletor rotulo="Exportar" resumo="…">
          <button type="button" className="bn-btn" disabled={runId === null} onClick={() => void exportar("md")}>Relatório .md</button>
          <button type="button" className="bn-btn" disabled={runId === null} onClick={() => void exportar("json")}>Relatório .json</button>
        </Seletor>
        <span className="bn-espaco" />
        {runs.length > 0 && (
          <label className="bn-campo bn-campo-linha">Run
            <select value={runId ?? ""} title={runs.find((r) => r.id === runId) === undefined ? "Run" : `${runs.find((r) => r.id === runId)?.nome} · ${runs.find((r) => r.id === runId)?.estado}`} onChange={(e) => { setRunId(e.target.value === "" ? null : e.target.value); setDetalheId(null); }}>
              {runs.map((r) => <option key={r.id} value={r.id}>{r.nome} · {r.estado}</option>)}
            </select>
          </label>
        )}
        <output className="bn-contador" aria-live="polite" aria-label="Progresso">{grade === null ? "0/0" : contadorTexto(grade.run.concluidos, grade.run.total, grade.run.custo_usd)}</output>
      </div>

      {erro !== null && <p role="alert" className="bn-faixa" data-tom="erro">{erro} <button type="button" className="bn-btn" onClick={() => { setCarregando(true); void recarregarBase(); }}>Tentar de novo</button></p>}
      {!carregando && precos.length === 0 && <p className="bn-faixa" data-tom="info">Sem preços cadastrados: o custo aparece como “custo desconhecido” quando a CLI não o informa. <button type="button" className="bn-btn" onClick={() => setDialogo({ tipo: "precos" })}>Informar preços</button></p>}

      <div className="bn-corpo" data-detalhe={detalheId !== null || undefined}>
        <div className="bn-principal">
          {carregando ? <p className="bn-vazio" role="status">Carregando o Bench…</p>
            : visao === "comparar" ? <Comparar api={api} alvos={[...alvosSel]} tarefas={null} harness={harness} copiar={copiar} pedido={versaoCmp} />
            : grade === null || linhas.length === 0 ? (
              semAlvoDisponivel ? (
                <EstadoVazio icone="provedores" titulo="Nenhum alvo disponível" texto="Crie uma conta dedicada em Provedores, entre nela uma vez pelo terminal e cadastre o alvo (CLI, modelo e esforço). O Bench roda código gerado por IA: nunca use a conta pessoal em uso.">
                  <button type="button" className="botao botao-primario" onClick={() => setDialogo({ tipo: "alvos" })}>Configurar alvos</button>
                </EstadoVazio>
              ) : (
                <EstadoVazio icone="consumo" titulo="Nenhuma Run ainda" texto="Escolha tarefas e alvos na barra e clique em Rodar. Antes de executar, você vê a estimativa de custo e confirma digitando a frase pedida. Nada roda sem esse consentimento.">
                  <button type="button" className="botao botao-primario" disabled={!podeRodar} onClick={() => setDialogo({ tipo: "consentimento", finalidade: "rodar", pedido: pedidoRodar() })}>Rodar…</button>
                </EstadoVazio>
              )
            ) : <Grade linhas={linhas} alvos={grade.run.alvos} rotuloAlvo={rotuloAlvo} selecionado={detalheId} aoAbrir={setDetalheId} />}
        </div>
        {detalheId !== null && visao === "grade" && (
          <Detalhe api={api} resultadoId={detalheId} aoFechar={() => setDetalheId(null)} aoMudou={() => { void recarregarGrade(); setVersaoCmp((v) => v + 1); }}
            aoRerodar={(d) => setDialogo({ tipo: "consentimento", finalidade: "rerodar", pedido: { tarefas: [d.tarefa], alvos: [d.alvo], max_paralelo: 1, teto_usd: null, juiz_alvo: null }, rerodar: d })} />
        )}
      </div>

      {dialogo?.tipo === "consentimento" && (
        <DialogoConsentimento api={api} finalidade={dialogo.finalidade} pedido={dialogo.pedido} {...(dialogo.finalidade === "julgar" ? { juizes: alvos } : {})} aoFechar={() => setDialogo(null)}
          aoToken={(e, token, juiz) => aoToken(dialogo.finalidade, e.estimativa_id, token, juiz, dialogo.rerodar)} />
      )}
      {dialogo?.tipo === "alvos" && <DialogoAlvos api={api} alvos={alvos} contas={contas} aoFechar={() => setDialogo(null)} aoSalvo={() => { setSelA(null); void recarregarBase(); }} />}
      {dialogo?.tipo === "precos" && <DialogoPrecos api={api} precos={precos} aoFechar={() => setDialogo(null)} aoSalvo={() => void recarregarBase()} />}
    </section>
  );
}

/**
 * Tela Bench (Fase 12, D-32): UMA linha de controles (Tarefas, Alvos, Paralelo, Teto, Rodar, Cancelar, Julgar, Comparar, Exportar, contador), grade tarefa × alvo ocupando o resto e detalhe
 * recolhível. Lazy: nada roda no boot. `Rodar` não tem atalho (de propósito) e sempre passa pelo diálogo de consentimento digitado.
 */
export function TelaBench({ api: apiProp, harness: harnessProp, contas: contasProp, copiar }: PropsTelaBench) {
  const api = apiProp ?? ade()?.bench;
  const harness = harnessProp ?? ade()?.harness;
  const [contasCarregadas, setContas] = useState<ContaMin[]>([]);
  useEffect(() => {
    if (contasProp !== undefined) return;
    void ade()?.provedores.listar().then((ps) => setContas(ps.flatMap((p) => p.contas.filter((c) => c.habilitada).map((c) => ({ id: c.id, rotulo: c.rotulo, provedor: c.provedor }))))).catch(() => undefined);
  }, [contasProp]);
  if (api === undefined) return <EstadoVazio icone="consumo" titulo="Bench indisponível" texto="O Bench só funciona dentro do aplicativo." />;
  return <BenchComApi api={api} harness={harness} contas={contasProp ?? contasCarregadas} copiar={copiar ?? copiarPadrao} />;
}
