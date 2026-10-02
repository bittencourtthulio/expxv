// Aba Intenção (T-16.34/36): "o que você quer fazer?" → plano proposto (nunca executa sozinho) → Executar / Cancelar / Tratar neste painel.
import { useState } from "react";
import { ade } from "../../ade";
import { useCarga } from "../../estado/carga";
import { TEXTO_PEDIDO_MAX, type CatalogoPipelines, type EtapaDoPlano, type Intencao as IntencaoId, type NivelRigidez, type PlanoMaestro, type ReciboMaestro } from "../../../compartilhado/maestro";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { useMaestro, type StoreMaestro } from "../../estado/maestro";
import { ExigenciaDialogo } from "./ExigenciaDialogo";
import { EscalaDeRigidez } from "./Escala";
import { NOMES_FONTE, NOMES_INTENCAO, contarTerminais, efeitoDoPlano, faixaDeConfianca, frasesDoEfeito, perfilLegivel, planoTemCandidatas, porcento, problemaDoTexto, rigoresDaEtapa, terminaisDaEtapa } from "./logica";

export function Intencao({ store, workspaceId, aoExecutado }: { store: StoreMaestro; workspaceId: string | null; aoExecutado: () => void }) {
  const s = useMaestro(store);
  const catalogo = useCarga<CatalogoPipelines>(ade()?.pipelines?.catalogo === undefined ? undefined : () => (ade()?.pipelines.catalogo() as Promise<CatalogoPipelines>), "catalogo");
  const nomes = new Map((catalogo.dados?.etapas ?? []).map((e) => [e.id as string, e.nome]));
  const [texto, setTexto] = useState("");
  const problema = texto === "" ? null : problemaDoTexto(texto);
  const enviar = (): void => { if (problemaDoTexto(texto) === null && !s.pedindo) void store.pedir(texto); };
  return (
    <div className="pl-intencao">
      <form className="pl-pedido" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <label htmlFor="pl-texto" className="pl-pedido-titulo">O que você quer fazer?</label>
        <textarea
          id="pl-texto"
          rows={3}
          value={texto}
          disabled={workspaceId === null}
          placeholder="Ex.: corrige o erro ao salvar o pedido no cadastro de clientes"
          aria-describedby="pl-texto-ajuda"
          aria-invalid={problema !== null || undefined}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); enviar(); } }}
        />
        <div className="pl-linha">
          <span id="pl-texto-ajuda" className="pl-discreto">{texto.length}/{TEXTO_PEDIDO_MAX} caracteres. O plano aparece antes de qualquer terminal abrir. ⌘/Ctrl+Enter propõe.</span>
          <button type="submit" className="botao botao-primario" disabled={workspaceId === null || s.pedindo || texto.trim() === "" || problema !== null}>{s.pedindo ? "Montando o plano…" : "Propor plano"}</button>
        </div>
        {problema !== null ? <p className="pl-erro" role="alert">{problema}</p> : null}
        {workspaceId === null ? <p className="pl-aviso" role="status">Abra um projeto para pedir ao Maestro.</p> : null}
        {s.erroPedido !== null ? <p className="pl-erro" role="alert">{s.erroPedido}</p> : null}
      </form>
      {s.pedindo ? <div className="pl-carregando" aria-busy="true" role="status">Classificando o pedido…</div> : null}
      {s.plano === null && !s.pedindo ? (
        <EstadoVazio icone="pipelines" titulo="Nenhum plano proposto" texto="Descreva o que você quer fazer. O Maestro identifica a intenção, escolhe o pipeline do método e mostra as etapas, o perfil de cada uma e quantos terminais vai abrir." />
      ) : null}
      {s.plano !== null ? (
        <PlanoProposto
          plano={s.plano.plano}
          recibo={s.plano.recibo}
          etapas={s.etapasPrevia ?? s.plano.plano.etapas}
          nomes={nomes}
          nivel={s.ajustes.nivel ?? s.plano.plano.nivel}
          desligadas={s.ajustes.etapasDesligadas}
          intencaoEscolhida={s.ajustes.intencao}
          ocupado={s.confirmando}
          onNivel={(n) => void store.mudarNivelDoPlano(n)}
          onIntencao={(i) => store.ajustar({ intencao: i })}
          onAlternar={(id) => store.alternarEtapa(id)}
          onExecutar={() => void store.confirmar().then((ok) => { if (ok) aoExecutado(); })}
          onCancelar={() => void store.descartarPlano()}
          onTratarAqui={() => void store.descartarPlano()}
        />
      ) : null}
      {s.exigencia !== null ? (
        <ExigenciaDialogo
          exigencia={s.exigencia}
          ocupado={s.confirmando}
          aoCancelar={() => store.limparExigencia()}
          aoConfirmar={(v) => { store.ajustar(s.exigencia?.tipo === "confirmacao" ? { confirmacaoDigitada: v } : { justificativa: v }); void store.confirmar().then((ok) => { if (ok) aoExecutado(); }); }}
        />
      ) : null}
    </div>
  );
}

interface PropsPlano {
  plano: PlanoMaestro;
  recibo: ReciboMaestro;
  etapas: readonly EtapaDoPlano[];
  nomes?: ReadonlyMap<string, string>;
  nivel: NivelRigidez;
  desligadas: readonly string[];
  intencaoEscolhida: IntencaoId | null;
  ocupado: boolean;
  onNivel: (n: NivelRigidez) => void;
  onIntencao: (i: IntencaoId) => void;
  onAlternar: (etapaId: string) => void;
  onExecutar: () => void;
  onCancelar: () => void;
  onTratarAqui: () => void;
}

export function PlanoProposto(p: PropsPlano) {
  const { plano } = p;
  const faixa = faixaDeConfianca(plano.confianca);
  const terminais = contarTerminais({ etapas: p.etapas });
  const naoExecuta = plano.intencao === "desconhecida";
  const efeito = frasesDoEfeito(efeitoDoPlano(p.etapas.map((e) => (p.desligadas.includes(e.etapa_id) && e.estado_inicial === "pendente" ? { ...e, estado_inicial: "pulada_usuario" as const } : e))));
  return (
    <section className="pl-plano" aria-label="Plano proposto">
      <header className="pl-plano-cab">
        <div className="pl-plano-titulo">
          <h2>{NOMES_INTENCAO[plano.intencao] ?? plano.intencao}</h2>
          <p className="pl-discreto">Segue o pipeline {plano.pipeline_id}, escolhido por {NOMES_FONTE[plano.fonte]}.</p>
        </div>
        <span className="pl-selo" data-tom={faixa === "alta" ? "ok" : faixa === "media" ? "aviso" : "erro"}>confiança {faixa} · {porcento(plano.confianca)}</span>
        <span className="pl-selo" aria-label={`${terminais} terminais serão abertos`}>{terminais} {terminais === 1 ? "terminal" : "terminais"}</span>
      </header>

      <div className="pl-plano-lado">
      <div className="pl-escala-bloco">
        <h3 id="pl-escala-titulo">Rigidez só para este pedido</h3>
        <EscalaDeRigidez nivel={p.nivel} onNivel={p.onNivel} rotulo="Rigidez deste pedido" />
        <p className="pl-escala-resumo" aria-live="polite">{efeito}.</p>
      </div>

      {plano.trava !== null ? <p className="pl-aviso" role="note">Trava: {plano.trava.motivo} (nível mínimo {plano.trava.minimo}).</p> : null}
      {plano.avisos.length > 0 ? <ul className="pl-avisos" aria-label="Avisos do plano">{plano.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul> : null}

      {planoTemCandidatas(plano) ? (
        <fieldset className="pl-candidatas">
          <legend>A confiança é {faixa === "media" ? "média" : "baixa"}: qual destes você quis dizer?</legend>
          {(plano.candidatas ?? []).map((c) => (
            <label key={c.intencao}>
              <input type="radio" name="pl-candidata" checked={(p.intencaoEscolhida ?? plano.intencao) === c.intencao} onChange={() => p.onIntencao(c.intencao)} /> {NOMES_INTENCAO[c.intencao] ?? c.intencao} ({porcento(c.confianca)})
            </label>
          ))}
          <span className="pl-discreto">O plano é recalculado ao executar.</span>
        </fieldset>
      ) : null}
      </div>

      {naoExecuta ? (
        <p className="pl-aviso" role="status">Não deu para identificar a intenção com segurança. Reescreva o pedido com mais detalhe (o que está errado, ou o que deve existir).</p>
      ) : (
        <div className="pl-sequencia">
          <h3>Etapas, na ordem em que rodam</h3>
          <ol className="pl-trilha" aria-label="Etapas do plano">
            {p.etapas.map((e) => {
              const rigores = rigoresDaEtapa(e);
              const humana = e.estado_inicial === "humano";
              const pulada = e.estado_inicial === "pulada_nivel" || p.desligadas.includes(e.etapa_id);
              const perfil = humana ? null : perfilLegivel(e.resumo_perfil);
              const nome = p.nomes?.get(e.etapa_id) ?? e.etapa_id;
              return (
                <li key={e.etapa_id} className="pl-passo" data-pulada={pulada || undefined} data-humana={humana || undefined}>
                  <span className="pl-no" aria-hidden="true">{humana ? "!" : e.ordem}</span>
                  <div className="pl-passo-corpo">
                    <div className="pl-passo-topo">
                      <h4 className="pl-passo-nome">{nome}</h4>
                      <code className="pl-id">{e.etapa_id}</code>
                      <ul className="pl-rigores" aria-label="Rigor da etapa">
                        {rigores.map((r) => <li key={r.tipo} className="pl-rigor" data-tipo={r.tipo}>{r.texto}</li>)}
                      </ul>
                    </div>
                    {e.motivo !== null ? <p className="pl-passo-motivo">{e.motivo}</p> : null}
                    {humana ? <p className="pl-passo-motivo">Sem CLI nem modelo: o Maestro avisa e espera você agir.</p> : perfil !== null ? (
                      <dl className="pl-perfil" aria-label={`Perfil de ${nome}`}>
                        <div><dt>CLI</dt><dd>{perfil.cli}</dd></div>
                        <div><dt>Modelo</dt><dd>{perfil.modelo}</dd></div>
                        <div><dt>Esforço</dt><dd>{perfil.esforco}</dd></div>
                        <div><dt>Terminais</dt><dd>{terminaisDaEtapa(e)}</dd></div>
                      </dl>
                    ) : <p className="pl-passo-motivo">Sem perfil definido.</p>}
                  </div>
                  <div className="pl-passo-acao">
                    {humana || e.piso || e.estado_inicial === "pulada_nivel" ? <span className="pl-discreto" title={e.piso ? "etapa de piso: nunca é pulada" : undefined}>{e.piso ? "não pode pular" : ""}</span> : (
                      <label className="pl-pular"><input type="checkbox" aria-label={`Pular ${e.etapa_id}`} checked={p.desligadas.includes(e.etapa_id)} onChange={() => p.onAlternar(e.etapa_id)} /> Pular</label>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="pl-recibo" aria-label="Recibo da decisão"><strong>Recibo:</strong> {p.recibo.texto}</p>
      <div className="pl-acoes pl-acoes-plano">
        <button type="button" className="botao botao-primario" disabled={naoExecuta || p.ocupado} onClick={p.onExecutar}>{p.ocupado ? "Executando…" : "Executar"}</button>
        <button type="button" className="botao" disabled={p.ocupado} onClick={p.onCancelar}>Cancelar</button>
        <button type="button" className="botao" disabled={p.ocupado} onClick={p.onTratarAqui} title="Descarta o plano; o painel de origem segue normal">Tratar neste painel</button>
        <span className="pl-discreto">Expira às {new Date(plano.expira_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </section>
  );
}
