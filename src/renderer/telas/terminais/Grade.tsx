import { Suspense, useEffect, useRef, useState, type ComponentType, type ReactElement } from "react";
import { PRAZO_FALHA_PAINEL_MS, resultadoDoWorker, textoDoFimDoWorker } from "./ciclo-worker";
import type { TemaEfetivo } from "../../../compartilhado/ipc";
import type { ApiTerminal } from "../../componentes/Terminal/Terminal";
import type { SessaoUI } from "../../estado/terminais";
import { Icone } from "../../componentes/Icone";
import { Sinal } from "./Abas";
import { DecoracaoVcs } from "../../componentes/DecoracaoVcs";
import { Divisor } from "./Divisor";
import { FaixaHarness, MoverPane } from "./HarnessPane";
import { folhas, type NoPainel, type Orientacao } from "./layout";
import { formatarCusto, particionarMissao, SEM_MISSAO, type MapaMissao } from "./missao";
import type { PerfilNominal } from "./perfis-agentes";
import { RotuloPane } from "./RotuloPane";
import { ControlesRestaurar, IndicadorBrief } from "../memoria/ControlesRestaurar";
import { AvisoWorkerAguardando, IndicadorAprovacaoWorker } from "./aprovacao-workers";
import { ChipSubagentes, FaixaSubagentes, InterruptorOrquestrar, type ControleOrquestrar } from "./orquestrar";

/** O que a grade passa ao componente do terminal (o real, carregado em ocioso, ou um falso nos testes). */
export interface PropsTerminalGrade {
  sessaoId: string;
  rotulo: string;
  ativo: boolean;
  tema: TemaEfetivo;
  webgl: boolean;
  api: ApiTerminal;
  layoutToken?: number;
}

export interface PropsGrade {
  arvore: NoPainel;
  /** painel ocupando a aba inteira; os demais ficam desmontados. */
  expandido: string | null;
  ativa: string | null;
  sessoes: Readonly<Record<string, SessaoUI>>;
  falhas: Readonly<Record<string, string>>;
  webgl: ReadonlySet<string>;
  tema: TemaEfetivo;
  api: ApiTerminal;
  Terminal: ComponentType<PropsTerminalGrade>;
  rotuloDe(id: string): string;
  /** panes de Missão por sessão (vazio = aba comum). */
  missao?: MapaMissao;
  /** perfil nominal dos agentes (rótulo do Pane com modelo · esforço no hover). */
  perfis?: ReadonlyMap<string, PerfilNominal>;
  /** rótulo e cor de cada painel do layout "orquestrador + workers" (sessão → `orq. A` / `↳ orq. A`); vazio/ausente = sem chip. */
  orquestracao?: Readonly<Record<string, { rotulo: string; cor: number }>>;
  /** "Orquestrar neste painel": interruptor, chip e faixa de subagentes internos (ausente = nada disso aparece). */
  orquestrar?: ControleOrquestrar;
  /** copia texto para a área de transferência (injetável em teste). */
  copiarTexto?(texto: string): void;
  podeDividir: boolean;
  aoFocar(id: string): void;
  aoFechar(id: string): void;
  aoExpandir(): void;
  aoInterromper(id: string): void;
  /** D-570: divisor solto (a primeira folha de cada lado identifica a divisão); a tela guarda a proporção por workspace. */
  aoProporcao?(a: string, b: string, razao: number): void;
  /** id da aba ativa: nomeia o tabpanel (aria-labelledby). */
  abaId?: string;
  /** D-520: quanto o painel de um worker que MORREU com erro fica na grade antes de fechar sozinho, se o dono não interagir (padrão 60 s; o teste injeta um prazo curto). */
  prazoFalhaMs?: number;
}

export function Grade(props: PropsGrade): ReactElement {
  const { arvore, expandido } = props;
  const modoExpandido = expandido !== null && folhas(arvore).includes(expandido);
  const missao = modoExpandido ? null : particionarMissao(arvore, props.missao ?? SEM_MISSAO);
  const unico = arvore.tipo === "terminal";
  return (
    <div className="terminais-grade" id="terminais-grade" role="tabpanel" {...(props.abaId !== undefined ? { "aria-labelledby": `aba-${props.abaId}` } : {})}>
      {modoExpandido ? <Painel {...props} id={expandido} expandidoAgora unico />
        : missao !== null ? (
          // piloto fixo à esquerda; workers na grade binária à direita. O espaço dos workers é reservado mesmo vazio (sem salto de layout).
          <div className="terminais-missao">
            <Painel {...props} id={missao.piloto} />
            <div className="terminais-missao-divisor" aria-hidden="true" />
            <div className="terminais-missao-workers" data-vazio={missao.workers === null || undefined}>
              {missao.workers !== null ? <Nodo {...props} no={missao.workers} /> : <p className="terminais-missao-vazio">Os workers aparecem aqui quando o piloto delegar.</p>}
            </div>
          </div>
        )
        : <Nodo {...props} no={arvore} unico={unico} />}
    </div>
  );
}

function Nodo(props: PropsGrade & { no: NoPainel; unico?: boolean }): ReactElement {
  const { no } = props;
  if (no.tipo === "terminal") return <Painel {...props} id={no.sessao_id} unico={props.unico === true} />;
  return <Divisao {...props} no={no} />;
}

function Divisao(props: PropsGrade & { no: Extract<NoPainel, { tipo: "divisao" }> }): ReactElement {
  const { no } = props;
  const caixa = useRef<HTMLDivElement>(null);
  // proporção do layout "orquestrador + workers" (D-515); sem ela vale 50%. O arrastar do divisor continua mudando só o estado local.
  const inicial = no.proporcao ?? 0.5;
  const [razao, setRazao] = useState(inicial);
  useEffect(() => { setRazao(inicial); }, [inicial]);
  const lado = no.orientacao === "vertical";
  const gabarito = `${razao}fr var(--divisor-painel) ${1 - razao}fr`;
  return (
    <div ref={caixa} className="terminais-divisao" data-orientacao={no.orientacao} style={lado ? { gridTemplateColumns: gabarito } : { gridTemplateRows: gabarito }}>
      <Nodo {...props} no={no.primeiro} />
      <Divisor orientacao={no.orientacao} razao={razao} caixa={caixa} aoMudar={setRazao}
        {...(props.aoProporcao !== undefined ? { aoSoltar: (r: number) => props.aoProporcao?.(folhas(no.primeiro)[0] as string, folhas(no.segundo)[0] as string, r) } : {})} />
      <Nodo {...props} no={no.segundo} />
    </div>
  );
}

function Painel(props: PropsGrade & { id: string; expandidoAgora?: boolean; unico?: boolean }): ReactElement {
  const { id, Terminal } = props;
  const s = props.sessoes[id];
  const rotulo = props.rotuloDe(id);
  const info = (props.missao ?? SEM_MISSAO)[id];
  const emFoco = props.ativa === id;
  const falha = props.falhas[id];
  const fim = s?.estado === "encerrada" || s?.estado === "erro";
  const atividade = s?.estado === "executando" ? s.atividade : undefined;
  // painel livre de CLI (nem shell nem worker/Pane de outra Missão) pode orquestrar; a Missão avulsa é o próprio interruptor ligado
  const orq = props.orquestrar;
  const orquestrando = info?.avulsa === true && info.ehPiloto;
  const livreDeCli = s !== undefined && s.ferramenta_id !== "terminal" && !fim && (info === undefined || orquestrando);
  // D-520: ciclo de vida do painel do worker. O fechamento pedido pelo app (orquestrador, dono, fim do trabalho) nunca chega aqui: a sessão sai da grade na hora.
  // Aqui só aparecem o worker que terminou sozinho (Concluído) e o que MORREU com erro sem ninguém pedir (Falhou), que fica visível até o dono fechar ou 60 s sem interação.
  const resultado = resultadoDoWorker(info, s?.estado);
  const falhou = resultado === "falhou";
  const [mantido, setMantido] = useState(false);
  const aoFecharRef = useRef(props.aoFechar);
  aoFecharRef.current = props.aoFechar;
  useEffect(() => {
    if (!falhou || mantido || emFoco) return;
    const t = setTimeout(() => aoFecharRef.current(id), props.prazoFalhaMs ?? PRAZO_FALHA_PAINEL_MS);
    return () => clearTimeout(t);
  }, [falhou, mantido, emFoco, id, props.prazoFalhaMs]);
  const manter = (): void => { if (falhou && !mantido) setMantido(true); };
  // orquestrador: alerta dos agentes que falharam e "Limpar encerrados" (fecha de uma vez os painéis que já terminaram)
  const irmaos = orquestrando && info !== undefined ? Object.values(props.missao ?? SEM_MISSAO).filter((i) => i.missaoId === info.missaoId && !i.ehPiloto) : [];
  const estadoDe = (i: { sessaoId: string }): string | undefined => props.sessoes[i.sessaoId]?.estado;
  const falhados = irmaos.filter((i) => resultadoDoWorker(i, estadoDe(i)) === "falhou");
  const encerrados = irmaos.filter((i) => estadoDe(i) === "encerrada" || estadoDe(i) === "erro");
  return (
    <section
      className="terminais-painel"
      data-sessao={id}
      data-foco={emFoco || undefined}
      data-atividade={atividade}
      data-estado={s?.estado}
      data-unico={props.unico === true || undefined}
      data-piloto={info?.ehPiloto === true || undefined}
      aria-label={`Painel ${rotulo}`}
      onFocusCapture={() => { manter(); if (!emFoco) props.aoFocar(id); }}
      onPointerDownCapture={() => { manter(); if (!emFoco) props.aoFocar(id); }}
      onPointerEnter={manter}
      onKeyDownCapture={manter}
      {...(resultado !== null ? { "data-resultado": resultado } : {})}
    >
      <header className="terminais-painel-cabecalho">
        <Sinal atividade={atividade} />
        <RotuloPane rotulo={rotulo} perfil={info?.agenteId != null ? props.perfis?.get(info.agenteId) : undefined} />
        {props.orquestracao?.[id] !== undefined ? <span className="terminais-painel-orq" data-cor={props.orquestracao[id].cor} data-papel={info?.ehPiloto === true ? "orquestrador" : "worker"} title={info?.ehPiloto === true ? "Orquestrador: os agentes que ele abre ficam agrupados com esta cor" : "Agente aberto por um orquestrador"}>{props.orquestracao[id].rotulo}</span> : null}
        {info?.workspaceId !== undefined ? <DecoracaoVcs alvo={{ workspace_id: info.workspaceId, mission_id: info.comArvore === true ? info.missaoId : null }} className="vc-deco-painel" /> : null}
        {s?.estado === "iniciando" ? <span className="terminais-painel-estado">iniciando…</span> : null}
        <ChipSubagentes s={s} />
        {falhados.length > 0 ? (
          <span className="terminais-painel-alerta" role="status" title="Agente(s) deste painel morreram com erro sem que o orquestrador pedisse: o painel de cada um continua visível com o código de saída. O orquestrador foi avisado.">
            <Icone nome="aviso" /> {falhados.length === 1 ? "1 agente falhou" : `${falhados.length} agentes falharam`}
          </span>
        ) : null}
        {info !== undefined ? <span className="terminais-painel-custo">{formatarCusto(info)}</span> : null}
        {info?.paneId !== undefined && !fim ? <IndicadorBrief paneId={info.paneId} respawnDe={info.respawnDe ?? null} /> : null}
        {info?.paneId !== undefined && !info.ehPiloto && !fim ? <IndicadorAprovacaoWorker paneId={info.paneId} /> : null}
        {info?.avulsa === true && !info.ehPiloto && !fim ? <AvisoWorkerAguardando aguardando={atividade === "aguardando"} emFoco={emFoco} aoIr={() => props.aoFocar(id)} /> : null}
        {info?.reiniciadoSemConteudo === true ? (
          <span className="terminais-painel-reinicio" role="note" title="O piloto foi reiniciado e não havia conteúdo persistido da conversa anterior.">
            <Icone nome="aviso" /> reiniciado sem conteúdo salvo
          </span>
        ) : null}
        <span className="terminais-painel-acoes">
          {encerrados.length > 0 ? (
            <button type="button" className="terminais-painel-limpar" aria-label="Limpar encerrados" title="Fecha os painéis dos agentes que já terminaram" onClick={() => encerrados.forEach((i) => props.aoFechar(i.sessaoId))}>
              limpar encerrados ({encerrados.length})
            </button>
          ) : null}
          {orq !== undefined && livreDeCli ? <InterruptorOrquestrar sessaoId={id} ligada={orquestrando} controle={orq} /> : null}
          {info !== undefined ? (
            <button type="button" aria-label={`Copiar prompt de ${rotulo}`} title={info.prompt ? "Copiar prompt" : "Prompt indisponível"} disabled={!info.prompt} onClick={() => copiar(props, info.prompt ?? "")}><Icone nome="copiar" /></button>
          ) : null}
          {info?.paneId !== undefined && !fim ? <MoverPane paneId={info.paneId} rotulo={rotulo} /> : null}
          {s?.estado === "executando" ? <button type="button" aria-label={`Interromper ${rotulo}`} title="Interromper (pausa a CLI, não encerra)" onClick={() => props.aoInterromper(id)}><Icone nome="parar" /></button> : null}
          <button type="button" aria-label={props.expandidoAgora ? `Restaurar ${rotulo}` : `Expandir ${rotulo}`} aria-pressed={props.expandidoAgora === true} title="Expandir / restaurar (⌘⇧Enter)" onClick={props.aoExpandir}><Icone nome="expandir" /></button>
          <button type="button" aria-label={`Fechar ${rotulo}`} title="Fechar painel" onClick={() => props.aoFechar(id)}><Icone nome="fechar" /></button>
        </span>
      </header>
      {orq !== undefined && livreDeCli && !orquestrando && info === undefined && s !== undefined ? <FaixaSubagentes sessaoId={id} s={s} controle={orq} /> : null}
      {orq !== undefined && livreDeCli && orq.erros[id] !== undefined ? <p className="terminais-painel-aviso" role="alert">{orq.erros[id]}</p> : null}
      {info?.paneId !== undefined ? <FaixaHarness paneId={info.paneId} /> : null}
      <div className="terminais-painel-corpo">
        {s === undefined ? (
          <p className="terminais-painel-aviso" role="alert">Esta sessão não existe mais. Feche o painel.</p>
        ) : (
          <Suspense fallback={<div className="terminais-painel-carregando" aria-busy="true">Carregando terminal…</div>}>
            <Terminal sessaoId={id} rotulo={rotulo} ativo={emFoco} tema={props.tema} webgl={props.webgl.has(id)} api={props.api} />
          </Suspense>
        )}
        {fim ? (
          <div className="terminais-painel-fim" role="status" {...(resultado !== null ? { "data-resultado": resultado } : {})}>
            <strong>{resultado !== null ? textoDoFimDoWorker(resultado, s?.codigo_saida ?? null) : `${s?.estado === "erro" ? "A sessão terminou com erro" : "Sessão encerrada"}${s?.codigo_saida != null ? ` (código ${s.codigo_saida})` : ""}`}</strong>
            {resultado === "falhou" ? <span className="terminais-painel-fim-dica">O orquestrador foi avisado. Este painel fecha sozinho em 1 min se você não interagir.</span> : s?.mensagem ? <span>{s.mensagem}</span> : null}
            {info?.paneId !== undefined ? <ControlesRestaurar paneId={info.paneId} rotulo={rotulo} /> : null}
            <button type="button" onClick={() => props.aoFechar(id)}>{resultado !== null ? "Fechar" : "Fechar painel"}</button>
          </div>
        ) : null}
        {falha !== undefined ? <p className="terminais-painel-aviso" role="alert">{falha}</p> : null}
      </div>
    </section>
  );
}

function copiar(props: PropsGrade, texto: string): void {
  if (texto === "") return;
  if (props.copiarTexto !== undefined) props.copiarTexto(texto);
  else void navigator.clipboard?.writeText(texto).catch(() => undefined);
}
