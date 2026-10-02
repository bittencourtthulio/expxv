import { useMemo, useState, type KeyboardEvent } from "react";
import type { Politica as PoliticaT, PoliticaEntrada, TaskType } from "../../../compartilhado/harness";
import { FAIXAS } from "../../../compartilhado/harness";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { VirtualLista } from "../../componentes/VirtualLista";
import { useCarga } from "../../estado/carga";
import type { PropsAba } from "./tipos";
import { problemaExecutor, problemasPolitica } from "./validar";

export const ALTURA_LINHA_POLITICA = 44;
const ROTULOS_CATEGORIA: Readonly<Record<string, string>> = { codigo: "Código", revisao: "Revisão", planejamento: "Planejamento", documentacao: "Documentação", analise: "Análise", teste: "Testes", testes: "Testes", outros: "Outros" };
/** Categoria é um id de domínio sem acento; a tela mostra o nome por extenso, em caixa de frase. */
export const rotuloCategoria = (c: string): string => ROTULOS_CATEGORIA[c] ?? (c === "" ? c : c.charAt(0).toUpperCase() + c.slice(1));
type Item = { t: "cab"; categoria: string } | { t: "pol"; p: PoliticaT; tipo: TaskType | undefined };

const paraEntrada = (p: PoliticaT): PoliticaEntrada => {
  const { id: _i, atualizado_por: _a, atualizado_em: _e, ...resto } = p;
  return resto;
};
const vazioParaNulo = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Tabela virtualizada agrupada por categoria; Enter edita, Esc cancela, Enter no campo salva. Executor desativado bloqueia salvar. */
export function Politica({ api, workspaceId, busca, versao, ctx }: PropsAba) {
  const pol = useCarga<PoliticaT[]>(api?.listarPoliticas === undefined ? undefined : () => api.listarPoliticas!(workspaceId), `pol|${workspaceId}|${versao}`);
  const tipos = useCarga<TaskType[]>(api?.listarTaskTypes === undefined ? undefined : () => api.listarTaskTypes!(), `tipos|${versao}`);
  const [edit, setEdit] = useState<{ id: string; rascunho: PoliticaEntrada } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foco, setFoco] = useState<{ indice: number; n: number } | undefined>(undefined);

  const itens = useMemo<Item[]>(() => {
    const mapa = new Map((tipos.dados ?? []).map((t) => [t.slug, t]));
    const b = busca.trim().toLowerCase();
    const filtradas = (pol.dados ?? []).filter((p) => b === "" || `${p.task_type} ${mapa.get(p.task_type)?.rotulo ?? ""} ${p.executor.provider} ${p.executor.model ?? ""}`.toLowerCase().includes(b));
    const porCat = new Map<string, PoliticaT[]>();
    for (const p of filtradas) { const c = mapa.get(p.task_type)?.categoria ?? "outros"; porCat.set(c, [...(porCat.get(c) ?? []), p]); }
    const out: Item[] = [];
    for (const c of [...porCat.keys()].sort()) {
      out.push({ t: "cab", categoria: c });
      for (const p of porCat.get(c)!) out.push({ t: "pol", p, tipo: mapa.get(p.task_type) });
    }
    return out;
  }, [pol.dados, tipos.dados, busca]);

  const problemasEdicao = edit === null ? [] : problemasPolitica(edit.rascunho, ctx);
  const salvar = async () => {
    if (edit === null || problemasEdicao.length > 0) return;
    try { await api?.gravarPolitica?.(edit.rascunho); setEdit(null); setErro(null); pol.recarregar(); }
    catch (e) { setErro(`Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const teclar = (e: KeyboardEvent, p: PoliticaT) => {
    if (e.key === "Escape" && edit !== null) { e.stopPropagation(); setEdit(null); setErro(null); }
    else if (e.key === "Enter" && edit === null && e.target === e.currentTarget) { e.preventDefault(); setEdit({ id: p.id, rascunho: paraEntrada(p) }); }
    else if (e.key === "Enter" && edit !== null && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void salvar(); }
  };
  const ajustar = (campo: "provider" | "model" | "effort" | "faixa", valor: string) => setEdit((a) => {
    if (a === null) return a;
    const ex = { ...a.rascunho.executor };
    if (campo === "provider") ex.provider = valor; else if (campo === "model") ex.model = vazioParaNulo(valor); else if (campo === "effort") ex.effort = vazioParaNulo(valor); else ex.faixa = valor === "" ? null : (valor as typeof FAIXAS[number]);
    return { ...a, rascunho: { ...a.rascunho, executor: ex } };
  });

  if (pol.estado === "indisponivel") return <EstadoVazio icone="harness" titulo="Política indisponível" texto="Este build ainda não expõe a política de roteamento." />;
  if (pol.estado === "erro") return <p role="alert" className="h-erro">Não foi possível ler a política: {pol.mensagem}</p>;
  if (pol.dados === null) return <div aria-busy="true" className="h-nota">Carregando política…</div>;
  if (pol.dados.length === 0) return <EstadoVazio icone="harness" titulo="Nenhuma política neste escopo" texto={workspaceId === null ? "Use Restaurar semente (ícone ↶ na barra) para carregar a política padrão." : "Este workspace herda a política global. Edite uma linha no escopo global ou restaure a semente aqui."} />;
  const provedores = [...new Set([...(ctx.provedoresAtivos ?? []), ...pol.dados.map((p) => p.executor.provider)])].sort();

  return (
    <div className="harness-corpo-alto">
      {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
      {edit !== null && problemasEdicao.length > 0 ? <div role="alert" className="h-erro"><strong>Não é possível salvar.</strong> {problemasEdicao.map((m) => <div key={m}>{m}</div>)}</div> : null}
      <div className="h-linha h-cab" style={{ height: "var(--linha-altura)" }} aria-hidden="true"><span>Tipo</span><span>Provedor</span><span>Faixa / modelo</span><span>Esforço</span><span>Conta fixa</span><span>Fallback</span><span /></div>
      <VirtualLista
        itens={itens}
        alturaItem={ALTURA_LINHA_POLITICA}
        rotulo="Política de roteamento"
        className="h-lista"
        rolarPara={foco}
        chave={(i) => (i.t === "cab" ? `c:${i.categoria}` : i.p.id)}
        renderItem={(i, idx) => {
          if (i.t === "cab") return <div className="h-grupo" role="presentation">{rotuloCategoria(i.categoria)}</div>;
          const p = i.p;
          const editando = edit?.id === p.id;
          const r = editando ? edit.rascunho : null;
          const problema = problemaExecutor(p.executor, ctx);
          const nomeTipo = i.tipo?.rotulo ?? p.task_type;
          return (
            <div className="h-linha" tabIndex={0} aria-label={`${nomeTipo}${problema !== null ? ", com problema" : ""}`} data-problema={problema !== null || undefined} data-editando={editando || undefined} title={problema ?? undefined}
              onKeyDown={(e) => teclar(e, p)} onFocus={() => setFoco(undefined)}>
              <span>{problema !== null ? "! " : ""}{nomeTipo}{!p.habilitada ? " (desligada)" : ""}</span>
              {r !== null ? (
                <>
                  <select aria-label={`Provedor de ${nomeTipo}`} value={r.executor.provider} onChange={(e) => ajustar("provider", e.target.value)}>{provedores.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                  <span style={{ display: "flex", gap: 4 }}>
                    <select aria-label={`Faixa de ${nomeTipo}`} value={r.executor.faixa ?? ""} onChange={(e) => ajustar("faixa", e.target.value)}><option value="">—</option>{FAIXAS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                    <input aria-label={`Modelo de ${nomeTipo}`} placeholder="modelo" value={r.executor.model ?? ""} onChange={(e) => ajustar("model", e.target.value)} />
                  </span>
                  <input aria-label={`Esforço de ${nomeTipo}`} value={r.executor.effort ?? ""} onChange={(e) => ajustar("effort", e.target.value)} />
                </>
              ) : (
                <>
                  <span>{p.executor.provider}</span>
                  <span>{p.executor.faixa ?? "—"} · {p.executor.model ?? "padrão da CLI"}</span>
                  <span>{p.executor.effort ?? "—"}</span>
                </>
              )}
              <span>{p.conta_fixa_id ?? "automática"}</span>
              {r !== null ? (
                <select aria-label={`Fallback de ${nomeTipo}`} value={r.fallback[0]?.provider ?? ""} onChange={(e) => setEdit((a) => (a === null ? a : { ...a, rascunho: { ...a.rascunho, fallback: [{ ...(a.rascunho.fallback[0] ?? { cli: null, model: null, effort: null, faixa: null }), provider: e.target.value }, ...a.rascunho.fallback.slice(1)] } }))}>
                  {r.fallback.length === 0 ? <option value="">escolha</option> : null}
                  {provedores.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              ) : <span title={p.fallback.map((f) => `${f.provider} ${f.model ?? ""}`).join(" → ")}>{p.fallback.map((f) => f.provider).join(" → ") || "—"}</span>}
              <span>
                {editando ? (
                  <>
                    <button type="button" className="botao-mini" disabled={problemasEdicao.length > 0} aria-label={`Salvar ${nomeTipo}`} onClick={() => void salvar()}>Salvar</button>{" "}
                    <button type="button" className="botao-mini" aria-label="Cancelar edição" onClick={() => { setEdit(null); setErro(null); }}>Cancelar</button>
                  </>
                ) : <button type="button" className="botao-mini" aria-label={`Editar ${nomeTipo}`} onClick={() => { setEdit({ id: p.id, rascunho: paraEntrada(p) }); setFoco({ indice: idx, n: Date.now() }); }}>Editar</button>}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
}
