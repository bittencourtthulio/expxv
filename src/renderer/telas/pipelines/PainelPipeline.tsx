// Acompanhamento do pipeline (T-16.36): lista dos ativos, detalhe com etapas, piso I1..I10, recibo e portões humanos.
// Etapas humanas (assinatura, raio ALTO, merge) NUNCA têm botão que assine/aprove: só o caminho do arquivo e o aviso.
import { useEffect, useState } from "react";
import type { CatalogoPipelines, DetalhePipeline, PipelineResumo } from "../../../compartilhado/maestro";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ItemLista } from "../../componentes/ItemLista";
import { ade } from "../../ade";
import { useCarga } from "../../estado/carga";
import { useMaestro, type StoreMaestro } from "../../estado/maestro";
import { GLIFO_ETAPA, NOMES_INTENCAO, ROTULO_ACAO, ROTULO_ESTADO_ETAPA, ROTULO_ESTADO_PIPELINE, ROTULO_PISO, SIMBOLO_PISO, acoesPermitidas, duracaoDaEtapa, etapaAtiva, perfilLegivel, pipelineTerminou, progressoDoPipeline, rigoresDaEtapa, textoHumano, tomDaEtapa, tomDoEstado, type Tom } from "./logica";
import type { TomSelo } from "../../componentes/ItemLista";

/** `Tom` interno → tom de selo do `ItemLista`. */
const TOM_SELO: Record<Tom, TomSelo> = { ok: "sucesso", aviso: "aviso", erro: "alerta", neutro: "neutro" };

export function PainelPipeline({ store, workspaceId, aoIrParaIntencao }: { store: StoreMaestro; workspaceId: string | null; aoIrParaIntencao: () => void }) {
  const s = useMaestro(store);
  const catalogo = useCarga<CatalogoPipelines>(ade()?.pipelines?.catalogo === undefined ? undefined : () => (ade()?.pipelines.catalogo() as Promise<CatalogoPipelines>), "catalogo");
  const nomes = new Map((catalogo.dados?.etapas ?? []).map((e) => [e.id as string, e.nome]));

  if (!s.disponivel) return <EstadoVazio icone="pipelines" titulo="O Maestro só funciona no aplicativo" texto="Esta tela precisa do processo principal do aplicativo. Abra o aplicativo instalado em vez do navegador." />;
  if (workspaceId === null) return <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="Abra um projeto para acompanhar os pipelines do método." />;
  if (s.erro !== null && s.ativos === null) return <div className="pl-erro" role="alert">{s.erro} <button type="button" className="botao" onClick={() => void store.recarregar()}>Tentar de novo</button></div>;
  if (s.ativos === null || s.carregando) return <div className="pl-carregando" aria-busy="true" role="status">Carregando pipelines…</div>;
  if (s.ativos.length === 0) {
    return (
      <EstadoVazio icone="pipelines" titulo="Nenhum pipeline em andamento" texto="Quando você pedir algo ao Maestro e executar o plano, o andamento de cada etapa aparece aqui, com o terminal de cada uma.">
        <button type="button" className="botao botao-primario" onClick={aoIrParaIntencao}>Pedir ao Maestro</button>
      </EstadoVazio>
    );
  }
  return (
    <div className="pl-duas">
      {s.erro !== null ? <p className="pl-erro" role="alert">{s.erro}</p> : null}
      <ul className="pl-lista" aria-label="Pipelines ativos">
        {s.ativos.map((p) => <ItemPipeline key={p.id} p={p} ativo={p.id === s.selecionadoId} aoEscolher={() => void store.selecionar(p.id)} />)}
      </ul>
      <div className="pl-detalhe" aria-live="polite">
        {s.selecionadoId === null ? <p className="pl-discreto">Escolha um pipeline para ver as etapas.</p> : s.detalheCarregando ? <div className="pl-carregando" aria-busy="true" role="status">Abrindo pipeline…</div> : s.detalheErro !== null ? <p className="pl-erro" role="alert">{s.detalheErro}</p> : s.detalhe !== null ? <Detalhe d={s.detalhe} nomes={nomes} store={store} ocupado={s.ocupadoAcao} aviso={s.aviso} /> : null}
      </div>
    </div>
  );
}

function ItemPipeline({ p, ativo, aoEscolher }: { p: PipelineResumo; ativo: boolean; aoEscolher: () => void }) {
  const estado = p.estado as keyof typeof ROTULO_ESTADO_PIPELINE;
  const prog = progressoDoPipeline(p.etapas.map((e) => ({ estado: e.estado as never })));
  return (
    <li>
      <ItemLista
        titulo={p.pipeline_id}
        descricao={`${p.etapa_atual ?? "sem etapa em andamento"} · nível ${p.nivel_atual}`}
        selos={[{ texto: ROTULO_ESTADO_PIPELINE[estado] ?? p.estado, tom: TOM_SELO[tomDoEstado(estado)] }]}
        selecionado={ativo}
        rotuloCorpo={`Pipeline ${p.pipeline_id}`}
        aoAbrir={aoEscolher}
      >
        {prog.total > 0 ? <span className="pl-item-prog"><span className="pl-barra-prog" aria-hidden="true"><span style={{ width: `${Math.round((prog.feitas / prog.total) * 100)}%` }} /></span><span className="pl-discreto">{prog.feitas} de {prog.total}</span></span> : null}
      </ItemLista>
    </li>
  );
}

function Detalhe({ d, nomes, store, ocupado, aviso }: { d: DetalhePipeline; nomes: Map<string, string>; store: StoreMaestro; ocupado: boolean; aviso: string | null }) {
  const [cancelando, setCancelando] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  useEffect(() => { setAnuncio(`${d.pipeline_id}: ${ROTULO_ESTADO_PIPELINE[d.estado]}`); }, [d.pipeline_id, d.estado]);
  const terminou = pipelineTerminou(d.estado);
  const prog = progressoDoPipeline(d.execs);
  const humana = d.execs.find((e) => e.estado === "aguardando_humano" || (e.tipo === "humano" && e.estado === "pendente" && d.estado === "aguardando_humano"));
  return (
    <article aria-label={`Pipeline ${d.pipeline_id}`}>
      <header className="pl-plano-cab">
        <div className="pl-plano-titulo">
          <h2>{d.pipeline_id} · {NOMES_INTENCAO[d.intencao] ?? d.intencao}</h2>
          <p className="pl-discreto">{d.texto_resumo}</p>
        </div>
        <span className="pl-selo" data-tom={tomDoEstado(d.estado)}>{ROTULO_ESTADO_PIPELINE[d.estado]}</span>
        <span className="pl-selo">nível {d.nivel_atual}{d.nivel_atual !== d.nivel_base ? ` (era ${d.nivel_base})` : ""}</span>
        {d.override_trava ? <span className="pl-selo" data-tom="aviso">trava sobrescrita com justificativa</span> : null}
        <span className="pl-discreto pl-progresso-txt">{prog.feitas} de {prog.total} etapas concluídas</span>
      </header>
      <span className="pl-sr" role="status" aria-live="polite">{anuncio}</span>
      {d.motivo_fim !== null ? <p className="pl-aviso" role="note">{d.motivo_fim}</p> : null}
      {humana !== undefined || d.estado === "aguardando_humano" ? (
        <div className="pl-portao" role="note" aria-label="Ação humana necessária">
          <strong>Sua vez.</strong> {textoHumano((humana?.etapa_id ?? "") as string)}
          {d.arquivo_humano !== null ? <> Arquivo: <code>{d.arquivo_humano}</code> <button type="button" className="botao" disabled={ocupado} onClick={() => void store.acao(d.id, "abrir_arquivo", humana?.etapa_id ?? null)}>Abrir arquivo</button></> : null}
        </div>
      ) : null}
      <ol className="pl-trilha" aria-label="Etapas do pipeline">
        {d.execs.map((e) => {
          const acoes = acoesPermitidas(d.estado, e.estado).filter((a) => a !== "pausar" && a !== "retomar" && a !== "abrir_arquivo");
          const nome = nomes.get(e.etapa_id) ?? e.etapa_id;
          const prevista = d.plano.etapas.find((x) => x.etapa_id === e.etapa_id);
          const perfil = e.tipo === "humano" ? null : perfilLegivel(prevista?.resumo_perfil);
          const rigores = rigoresDaEtapa({ estado_inicial: e.tipo === "humano" ? "humano" : "pendente", reduz: e.reduz, reforco: e.reforco, piso: e.piso, agrupa_com_anterior: e.agrupa_com_anterior, avaliacoes: e.avaliacoes });
          const duracao = duracaoDaEtapa(e.inicio_em, e.fim_em);
          const tom = tomDaEtapa(e.estado);
          return (
            <li key={`${e.etapa_id}-${e.tentativa}-${e.rodada}`} className="pl-passo" data-estado={e.estado} data-tom={tom} data-ativa={etapaAtiva(e.estado) || undefined} data-humana={e.tipo === "humano" || undefined}>
              <span className="pl-no" aria-hidden="true">{GLIFO_ETAPA[e.estado]}</span>
              <div className="pl-passo-corpo">
                <div className="pl-passo-topo">
                  <h4 className="pl-passo-nome">{nome}{e.tipo === "humano" ? <span aria-label="etapa humana"> 🔒</span> : null}</h4>
                  <span className="pl-selo" data-tom={tom}>{ROTULO_ESTADO_ETAPA[e.estado]}</span>
                  {e.tentativa > 1 || e.rodada > 1 ? <span className="pl-discreto">rodada {e.rodada}, tentativa {e.tentativa}</span> : null}
                  <ul className="pl-rigores" aria-label="Rigor da etapa">{rigores.map((r) => <li key={r.tipo} className="pl-rigor" data-tipo={r.tipo}>{r.texto}</li>)}</ul>
                </div>
                {e.detalhe !== null ? <p className="pl-passo-motivo">{e.detalhe}</p> : null}
                <dl className="pl-perfil" aria-label={`Detalhes de ${nome}`}>
                  {perfil !== null ? <><div><dt>CLI</dt><dd>{perfil.cli}</dd></div><div><dt>Modelo</dt><dd>{perfil.modelo}</dd></div><div><dt>Esforço</dt><dd>{perfil.esforco}</dd></div></> : null}
                  <div><dt>Terminal</dt><dd>{e.tipo === "humano" ? "só você" : e.pane_id !== null ? `painel ${e.pane_id.slice(-6)}${e.reutilizou_pane ? " (reusado)" : ""}` : "ainda não aberto"}</dd></div>
                  {e.nivel !== d.nivel_atual ? <div><dt>Nível</dt><dd>{e.nivel}</dd></div> : null}
                  {duracao !== null ? <div><dt>Duração</dt><dd>{duracao}</dd></div> : null}
                </dl>
              </div>
              <div className="pl-passo-acao">
                {acoes.map((a) => <button key={a} type="button" className="botao" disabled={ocupado} onClick={() => void store.acao(d.id, a, e.etapa_id)}>{ROTULO_ACAO[a]}</button>)}
              </div>
            </li>
          );
        })}
      </ol>
      <section aria-label="Piso de qualidade">
        <h3>Piso de qualidade</h3>
        {d.piso.length === 0 ? <p className="pl-discreto">Ainda sem verificações.</p> : (
          <ul className="pl-piso">
            {d.piso.map((i) => <li key={i.id} data-estado={i.estado}><span aria-hidden="true">{SIMBOLO_PISO[i.estado]}</span> <strong>{i.id}</strong> {i.titulo} — <em>{ROTULO_PISO[i.estado]}</em>{i.detalhe !== "" ? <span className="pl-discreto"> ({i.detalhe})</span> : null}</li>)}
          </ul>
        )}
      </section>
      {d.recibo !== null ? <details className="pl-recibo"><summary>Recibo da decisão</summary><p>{d.recibo.texto}</p></details> : null}
      {aviso !== null ? <p className="pl-erro" role="alert">{aviso} <button type="button" className="botao pl-mini" onClick={() => store.limparAviso()}>Fechar</button></p> : null}
      {!terminou ? (
        <div className="pl-acoes">
          {acoesPermitidas(d.estado, null).filter((a) => a === "pausar" || a === "retomar").map((a) => <button key={a} type="button" className="botao" disabled={ocupado} onClick={() => void store.acao(d.id, a, null)}>{ROTULO_ACAO[a]}</button>)}
          <button type="button" className="botao botao-perigo" disabled={ocupado} onClick={() => setCancelando(true)}>Cancelar pipeline</button>
        </div>
      ) : null}
      {cancelando ? <DialogoConfirmacao titulo="Cancelar o pipeline?" texto="Os terminais abertos continuam abertos; o Maestro só para de abrir as próximas etapas." rotuloConfirmar="Cancelar pipeline" perigoso aoCancelar={() => setCancelando(false)} aoConfirmar={() => { setCancelando(false); void store.cancelarPipeline(d.id); }} /> : null}
    </article>
  );
}
