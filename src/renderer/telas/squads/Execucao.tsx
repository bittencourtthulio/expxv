// Painel de execuções da squad (T-14.23): lista das execuções do workspace, estado da Missão (intake/plano/executando/revisando),
// terminais paralelos (chips com estado em texto) e Aprovar (libera o portão `build` pelo canal da Missão; nunca por tool).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { EstadoExecucaoSquad, SquadExecucao } from "../../../compartilhado/squads";
import { Badge, type TomBadge } from "../../componentes/Badge";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { useMissoes, type StoreMissoes } from "../../estado/missoes";
import { ArquivosDaExecucao } from "./Arquivos";

const ROTULO: Record<EstadoExecucaoSquad, string> = { intake: "recebida", plano: "plano", executando: "executando", revisando: "revisando", concluida: "concluída", falhou: "falhou", abortada: "abortada" };
const TOM: Record<EstadoExecucaoSquad, TomBadge> = { intake: "neutro", plano: "aviso", executando: "destaque", revisando: "destaque", concluida: "sucesso", falhou: "alerta", abortada: "aviso" };
const ESTADO_PANE: Record<string, string> = { iniciando: "iniciando", pronto: "pronto", trabalhando: "trabalhando", aguardando: "aguardando você", bloqueado: "bloqueado", encerrado: "encerrado" };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PropsExecucao {
  api: ApiAde["squads"] | undefined;
  missoes: StoreMissoes;
  workspaceId: string | null;
  /** incrementa a cada envio: força recarregar a lista. */
  recarregar: number;
  /** destaca/filtra as execuções desta squad (`null` = todas). */
  squadSlug: string | null;
  aoIrParaTerminais: () => void;
}

export function PainelExecucoes({ api, missoes, workspaceId, recarregar, squadSlug, aoIrParaTerminais }: PropsExecucao) {
  const est = useMissoes(missoes);
  const [itens, setItens] = useState<SquadExecucao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aprovar, setAprovar] = useState<SquadExecucao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const geracao = useRef(0);

  const carregar = useCallback(async (): Promise<void> => {
    if (api === undefined || workspaceId === null) { setItens([]); return; }
    const minha = ++geracao.current;
    try {
      const p = await api.listarExecucoes({ workspace_id: workspaceId, limite: 20 });
      if (minha === geracao.current) { setItens(p.itens); setErro(null); }
    } catch (e) { if (minha === geracao.current) setErro(`Não foi possível listar as execuções: ${msg(e)}`); }
  }, [api, workspaceId]);

  // recarrega ao enviar e quando as Missões mudam (o store já coalesce os eventos)
  useEffect(() => { void carregar(); }, [carregar, recarregar, est.itens]);

  const visiveis = (itens ?? []).filter((x) => squadSlug === null || x.squad_slug === squadSlug);
  const sel = visiveis.find((x) => x.id === aberta) ?? null;
  useEffect(() => {
    if (sel?.mission_id != null) void missoes.observarDetalhe(sel.mission_id);
    return () => { if (sel?.mission_id != null) missoes.pararDetalhe(sel.mission_id); };
  }, [sel?.mission_id, missoes]);

  if (workspaceId === null || itens === null || (visiveis.length === 0 && erro === null)) return null;

  const detalhe = sel?.mission_id != null ? est.detalhes[sel.mission_id] : undefined;
  const portoes = sel?.mission_id != null ? est.portoes[sel.mission_id] : undefined;
  const planoPendente = sel !== null && sel.plano_antes && sel.estado === "plano" && portoes?.pendentes.includes("build") === true;
  const vivos = detalhe?.panes.filter((p) => p.estado !== "encerrado") ?? [];

  const confirmarAprovar = async (): Promise<void> => {
    if (aprovar?.mission_id == null) return;
    setOcupado(true);
    try { await missoes.liberarPortao(aprovar.mission_id, "build"); setAprovar(null); }
    catch (e) { setErro(`Não foi possível aprovar o plano: ${msg(e)}`); setAprovar(null); }
    finally { setOcupado(false); }
  };

  return (
    <section className="sq-exec" aria-label="Execuções">
      <h3>Execuções</h3>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <ul className="sq-exec-lista">
        {visiveis.map((x) => (
          <li key={x.id}>
            <button type="button" className="sq-exec-linha" aria-expanded={aberta === x.id} onClick={() => setAberta(aberta === x.id ? null : x.id)}>
              <Badge tom={TOM[x.estado]}>{ROTULO[x.estado]}</Badge>
              <span className="sq-exec-obj" title={x.objetivo}>{x.objetivo}</span>
              <code>{x.squad_slug}</code>
              <time dateTime={x.criado_em}>{new Date(x.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>
            </button>
            {aberta === x.id ? (
              <div className="sq-exec-det">
                <p className="sq-vazio">{x.mission_id === null ? "A Missão ainda não nasceu." : `Plano antes: ${x.plano_antes ? "sim" : "não"}${x.nivel_rigidez !== null ? ` · rigidez ${x.nivel_rigidez}` : ""}`}</p>
                {planoPendente ? (
                  <div className="aviso-caixa" role="status">
                    O plano aguarda a sua aprovação: o orquestrador não libera a construção antes disso.{" "}
                    <button type="button" className="botao botao-primario" onClick={() => setAprovar(x)}>Aprovar</button>
                  </div>
                ) : null}
                {x.mission_id !== null ? <ArquivosDaExecucao api={api} execucaoId={x.id} chave={`${x.estado}|${portoes?.pendentes.join(",") ?? ""}|${detalhe?.handoffs.length ?? 0}`} /> : null}
                <p className="sq-exec-term" aria-label="Terminais da execução">
                  <strong>{vivos.length} terminal(is) ativo(s)</strong>
                  {vivos.map((p) => <span key={p.id} className="sq-chip-pane" data-estado={p.estado}>#{p.display_id} {p.papel} · {ESTADO_PANE[p.estado] ?? p.estado}</span>)}
                  {vivos.length > 0 ? <button type="button" className="botao" onClick={aoIrParaTerminais}>Ir para os terminais</button> : null}
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {aprovar !== null ? (
        <DialogoConfirmacao titulo="Aprovar o plano?" texto={<p>Isto libera o portão de construção desta Missão: o orquestrador poderá invocar os executores.</p>} rotuloConfirmar="Aprovar plano" ocupado={ocupado} aoCancelar={() => setAprovar(null)} aoConfirmar={() => void confirmarAprovar()} />
      ) : null}
    </section>
  );
}
