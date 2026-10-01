import { Suspense, useRef, useState, type ComponentType, type ReactElement } from "react";
import type { TemaEfetivo } from "../../../compartilhado/ipc";
import type { ApiTerminal } from "../../componentes/Terminal/Terminal";
import type { SessaoUI } from "../../estado/terminais";
import { Icone } from "../../componentes/Icone";
import { Sinal } from "./Abas";
import { Divisor } from "./Divisor";
import { folhas, type NoPainel, type Orientacao } from "./layout";
import { formatarCusto, particionarMissao, SEM_MISSAO, type MapaMissao } from "./missao";

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
  /** copia texto para a área de transferência (injetável em teste). */
  copiarTexto?(texto: string): void;
  podeDividir: boolean;
  aoFocar(id: string): void;
  aoFechar(id: string): void;
  aoExpandir(): void;
  aoInterromper(id: string): void;
  /** id da aba ativa: nomeia o tabpanel (aria-labelledby). */
  abaId?: string;
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
  const [razao, setRazao] = useState(0.5);
  const lado = no.orientacao === "vertical";
  const gabarito = `${razao}fr var(--divisor-painel) ${1 - razao}fr`;
  return (
    <div ref={caixa} className="terminais-divisao" data-orientacao={no.orientacao} style={lado ? { gridTemplateColumns: gabarito } : { gridTemplateRows: gabarito }}>
      <Nodo {...props} no={no.primeiro} />
      <Divisor orientacao={no.orientacao} razao={razao} caixa={caixa} aoMudar={setRazao} />
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
      onFocusCapture={() => { if (!emFoco) props.aoFocar(id); }}
      onPointerDownCapture={() => { if (!emFoco) props.aoFocar(id); }}
    >
      <header className="terminais-painel-cabecalho">
        <Sinal atividade={atividade} />
        <span className="terminais-painel-rotulo" title={rotulo}>{rotulo}</span>
        {s?.estado === "iniciando" ? <span className="terminais-painel-estado">iniciando…</span> : null}
        {info !== undefined ? <span className="terminais-painel-custo">{formatarCusto(info)}</span> : null}
        {info?.reiniciadoSemConteudo === true ? (
          <span className="terminais-painel-reinicio" role="note" title="O piloto foi reiniciado e não havia conteúdo persistido da conversa anterior.">
            <Icone nome="aviso" /> reiniciado sem conteúdo salvo
          </span>
        ) : null}
        <span className="terminais-painel-acoes">
          {info !== undefined ? (
            <button type="button" aria-label={`Copiar prompt de ${rotulo}`} title={info.prompt ? "Copiar prompt" : "Prompt indisponível"} disabled={!info.prompt} onClick={() => copiar(props, info.prompt ?? "")}><Icone nome="copiar" /></button>
          ) : null}
          {s?.estado === "executando" ? <button type="button" aria-label={`Interromper ${rotulo}`} title="Interromper (pausa a CLI, não encerra)" onClick={() => props.aoInterromper(id)}><Icone nome="parar" /></button> : null}
          <button type="button" aria-label={props.expandidoAgora ? `Restaurar ${rotulo}` : `Expandir ${rotulo}`} aria-pressed={props.expandidoAgora === true} title="Expandir / restaurar (⌘⇧Enter)" onClick={props.aoExpandir}><Icone nome="expandir" /></button>
          <button type="button" aria-label={`Fechar ${rotulo}`} title="Fechar painel" onClick={() => props.aoFechar(id)}><Icone nome="fechar" /></button>
        </span>
      </header>
      <div className="terminais-painel-corpo">
        {s === undefined ? (
          <p className="terminais-painel-aviso" role="alert">Esta sessão não existe mais. Feche o painel.</p>
        ) : (
          <Suspense fallback={<div className="terminais-painel-carregando" aria-busy="true">Carregando terminal…</div>}>
            <Terminal sessaoId={id} rotulo={rotulo} ativo={emFoco} tema={props.tema} webgl={props.webgl.has(id)} api={props.api} />
          </Suspense>
        )}
        {fim ? (
          <div className="terminais-painel-fim" role="status">
            <strong>{s?.estado === "erro" ? "A sessão terminou com erro" : "Sessão encerrada"}{s?.codigo_saida != null ? ` (código ${s.codigo_saida})` : ""}</strong>
            {s?.mensagem ? <span>{s.mensagem}</span> : null}
            <button type="button" onClick={() => props.aoFechar(id)}>Fechar painel</button>
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
