import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ComandoSugerido } from "../../../compartilhado/dominio";
import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { defDoContexto, linhasDoContexto, sequenciaDoQueFalta, type ContextoId } from "../../../nucleo/metodo/contexto";
import { comandoDeContexto } from "../../../nucleo/metodo/comandos";
import { moduloDoGesto } from "../../../nucleo/suite/modulos";
import { ade } from "../../ade";
import { Dialogo } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { entregue, storeExecucaoMetodo, useExecucaoMetodo, type StoreExecucaoMetodo } from "../../estado/execucao-metodo";
import { storeGeracao, useGeracao, type StoreGeracao } from "../../estado/contexto-geracao";
import { pedirHarness } from "../../estado/harness-acoes";
import { pedirTela } from "../../estado/navegacao";
import { useRigidez } from "../../estado/rigidez";
import { storeSuite, useModulosDesligados, useSuite, type StoreSuite } from "../../estado/suite";
import { jaConfirmouGeracao, lembrarConfirmacaoDeGeracao } from "./ContextoProjeto";
import { avisoDaRecusa, defDoGestoPedido, EXEMPLOS_PEDIDO, LIMITE_PEDIDO, modeloDoComando, type AvisoPedido } from "./pedido-gestos";
import { Conversa } from "./Conversa";
import { FaixaGestos, GestosLista } from "./Gestos";
import { useEstreito } from "./useEstreito";
import "./pedido.css";

const MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
export const TECLA_IR = MAC ? "⌘↵" : "Ctrl+Enter";
export const TECLA_FICAR = MAC ? "⇧⌘↵" : "Ctrl+Shift+Enter";

interface Props {
  workspaceId: string;
  indice: IndiceProjeto | null;
  execucao?: StoreExecucaoMetodo;
  suite?: StoreSuite;
  geracao?: StoreGeracao;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Conversa de pedido: histórico como mensagens no centro, composer fixo embaixo (campo, comando exato e botão primário) e os gestos numa coluna à direita (faixa no estreito). */
export function Pedido({ workspaceId, indice, execucao = storeExecucaoMetodo, suite = storeSuite, geracao = storeGeracao }: Props) {
  const exec = useExecucaoMetodo(execucao);
  const ui = useSuite(suite);
  const desligados = useModulosDesligados(workspaceId, suite);
  const rig = useRigidez().estado;
  const estreito = useEstreito();
  const conversa = useMemo(() => exec.historico.filter((m) => m.workspaceId === workspaceId), [exec.historico, workspaceId]);
  const inicial = useMemo(() => execucao.rascunho(workspaceId), [execucao, workspaceId]);
  const [texto, setTexto] = useState(inicial.texto);
  const [gesto, setGesto] = useState<string>(inicial.gesto);
  const [menuAberto, setMenuAberto] = useState(false);
  const [sugestao, setSugestao] = useState<ComandoSugerido | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const idCampo = useId();
  const idDica = useId();
  const def = defDoGestoPedido(gesto);
  const modulo = moduloDoGesto(def.gesto, null);
  const moduloOff = modulo !== null && desligados.has(modulo);
  const estadoSuite = ui.estados[workspaceId];
  const suiteAusente = ui.disponivel && estadoSuite !== undefined && (estadoSuite.estado === "ausente");
  const vazio = def.comPedido && texto.trim() === "";

  useEffect(() => { void execucao.carregarPreferencia(); }, [execucao]);
  // "Novo pedido" na tela Trabalhos: o composer adota o gesto pedido (cada pedido tem um `n` novo)
  const pedidoGesto = exec.gestoSolicitado;
  useEffect(() => {
    if (pedidoGesto === null) return;
    setGesto(pedidoGesto.gesto);
    execucao.consumirGestoSolicitado();
    campo.current?.focus();
  }, [pedidoGesto, execucao]);
  useEffect(() => { suite.ligar(); void suite.garantirEstado(workspaceId); void suite.garantirModulos(workspaceId); }, [suite, workspaceId]);
  // o rascunho é salvo por workspace (e o gesto escolhido junto)
  useEffect(() => {
    const t = setTimeout(() => execucao.salvarRascunho(workspaceId, { texto, gesto }), 250);
    return () => clearTimeout(t);
  }, [execucao, workspaceId, texto, gesto]);
  // o comando exato e os bloqueios vêm do main (CLI padrão, módulos, rigidez): consulta leve, só com texto
  useEffect(() => {
    setSugestao(null);
    if (vazio || moduloOff) return;
    const api = ade();
    if (api === undefined) return;
    let vivo = true;
    const t = setTimeout(() => {
      api.metodo.comandoSugerido(workspaceId, null, def.gesto, def.comPedido ? texto.trim() : null).then((s) => { if (vivo) setSugestao(s); }, () => { /* sem sugestão: o modelo local segue valendo */ });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [workspaceId, def.gesto, def.comPedido, texto, vazio, moduloOff]);
  useEffect(() => { setRecusa(null); }, [gesto, texto]);

  const aviso: AvisoPedido | null = useMemo(() => {
    if (suiteAusente) return { tipo: "suite", texto: "A suíte ExpxDev ainda não está instalada neste projeto: sem ela os comandos do método não existem." };
    if (moduloOff && modulo !== null) return { tipo: "modulo", modulo, texto: `O módulo ${modulo} está desligado neste projeto.` };
    return avisoDaRecusa(recusa ?? sugestao?.motivo_bloqueio ?? null, modulo);
  }, [suiteAusente, moduloOff, modulo, recusa, sugestao]);
  const bloqueado = aviso !== null && aviso.tipo !== "outro";

  const comando = sugestao !== null && sugestao.comando !== "" ? sugestao.comando : modeloDoComando(def, texto);
  const cliNome = comando.startsWith("/expx:") ? "Claude Code" : "OpenCode";

  const disparar = useCallback(async (ir: boolean | undefined) => {
    const api = ade();
    if (api === undefined || ocupado) return;
    if (vazio) { setErroCampo("Descreva o pedido antes de continuar."); campo.current?.focus(); return; }
    if (bloqueado) return;
    setErroCampo(null);
    setOcupado(true);
    try {
      const r = await api.metodo.disparar({ workspace_id: workspaceId, trabalho_id: null, gesto: def.gesto, argumento: def.comPedido ? texto.trim() : null, pane_id: null });
      if (!entregue(r)) { setRecusa(r.motivo ?? "O comando não foi entregue ao terminal."); return; }
      setRecusa(null);
      execucao.registrar(r, { workspaceId, rotulo: def.rotulo, gesto: def.gesto, pedido: def.comPedido ? texto : null }, ir);
    } catch (e) {
      setRecusa(msg(e));
    } finally { setOcupado(false); }
  }, [ocupado, vazio, bloqueado, workspaceId, def, texto, execucao]);

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void disparar(!e.shiftKey);
  };
  const escolherExemplo = (i: number): void => {
    const ex = EXEMPLOS_PEDIDO[i];
    if (ex === undefined) return;
    setTexto(ex.texto); setGesto(ex.gesto); setErroCampo(null);
    campo.current?.focus();
  };
  const copiar = (): void => {
    void navigator.clipboard?.writeText(comando);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1_800);
  };
  const restantes = LIMITE_PEDIDO - texto.length;
  const totalTrabalhos = indice?.trabalhos.length ?? null;
  const escolherGesto = (g: string): void => { setGesto(g); setErroCampo(null); };

  const comoRoda = (
    <div className="ped-acoes">
          <label className="ped-pref">
            <input type="checkbox" checked={exec.irAoTerminal} onChange={(e) => void execucao.definirIrAoTerminal(e.target.checked)} />
            Ir para o terminal ao disparar
          </label>
          <p className="met-suave ped-quem">
            {rig ? `Rigidez ${rig.efetivo} · ` : ""}Executa no {cliNome}, a CLI padrão do projeto.{" "}
            <button type="button" className="ped-link" onClick={() => pedirHarness("politica")}>Trocar no Harness</button>
          </p>
        </div>
  );

  return (
    <section className="ped" aria-label="Novo pedido">
      <div className="ped-chat">
        <header className="ped-chat-topo">
          <h2>Conversa de pedido</h2>
          {totalTrabalhos !== null ? <button type="button" className="ped-link ped-ver-trabalhos" onClick={() => pedirTela("trabalhos")}>Ver trabalhos ({totalTrabalhos})</button> : null}
        </header>
        <PrimeiroUso workspaceId={workspaceId} indice={indice} temTexto={texto.trim() !== ""} suite={suite} geracao={geracao} aoEscrever={() => campo.current?.focus()} />
        <Conversa mensagens={conversa} store={execucao} aoEscolherExemplo={escolherExemplo} />

        <div className="ped-composer">
          {estreito ? <FaixaGestos gesto={gesto} aoEscolher={escolherGesto} desligados={desligados} /> : null}
          <div className="ped-comando" aria-label="Comando que vai rodar">
            <span className="met-suave">Vai digitar no terminal</span>
            <code className="ped-comando-texto" data-testid="comando-previsto">{comando}</code>
            <button type="button" className="met-botao" onClick={copiar} aria-label="Copiar o comando">{copiado ? "Copiado" : "Copiar"}</button>
          </div>
          {aviso !== null ? <AvisoAcionavel aviso={aviso} suite={suite} /> : null}
          <label className="ped-pergunta" htmlFor={idCampo}>{def.comPedido ? "O que você quer construir ou corrigir?" : `${def.rotulo}: não precisa de pedido`}</label>
          <div className="ped-caixa" data-erro={erroCampo !== null || undefined}>
            <textarea
              id={idCampo} ref={campo} className="ped-campo" rows={3} value={texto} maxLength={LIMITE_PEDIDO} disabled={!def.comPedido}
              placeholder="Descreva em poucas frases o resultado que você espera, para quem e onde. Quanto mais concreto, menos o agente pergunta."
              aria-describedby={idDica} aria-invalid={erroCampo !== null || undefined}
              onChange={(e) => { setTexto(e.target.value); setErroCampo(null); }} onKeyDown={aoTeclar}
            />
            <div className="ped-caixa-rodape">
              <p id={idDica} className="met-suave ped-dica">
                {TECLA_IR} envia e vai ao terminal · {TECLA_FICAR} envia e fica aqui
                {def.comPedido && restantes < 300 ? ` · ${restantes} caracteres restantes` : ""}
              </p>
              {texto !== "" ? <button type="button" className="met-botao ped-limpar" onClick={() => { setTexto(""); campo.current?.focus(); }}>Limpar</button> : null}
              <div className="ped-dividido">
                <button
                  type="button" className="met-botao met-botao-primario ped-primario" disabled={ocupado || bloqueado}
                  onClick={() => void disparar(undefined)}
                >
                  {ocupado ? "Enviando…" : def.acao}
                </button>
                <button
                  type="button" className="met-botao met-botao-primario ped-seta" aria-label="Mais formas de disparar" aria-haspopup="menu" aria-expanded={menuAberto}
                  disabled={ocupado || bloqueado} onClick={() => setMenuAberto((v) => !v)}
                ><Icone nome="chevron" /></button>
                {menuAberto ? (
                  <div className="ped-menu" role="menu" onKeyDown={(e) => { if (e.key === "Escape") setMenuAberto(false); }}>
                    <button type="button" role="menuitem" className="met-botao" onClick={() => { setMenuAberto(false); void disparar(true); }}>Disparar e ir para o terminal <kbd>{TECLA_IR}</kbd></button>
                    <button type="button" role="menuitem" className="met-botao" onClick={() => { setMenuAberto(false); void disparar(false); }}>Disparar e ficar aqui <kbd>{TECLA_FICAR}</kbd></button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {erroCampo ? <p className="met-erro" role="alert">{erroCampo}</p> : null}
          {estreito ? comoRoda : null}
          <p className="ped-anuncio" role="status" aria-live="polite" aria-atomic="true">{exec.anuncio}</p>
        </div>
      </div>

      {!estreito ? (
        <aside className="ped-gestos" aria-label="Gestos do método">
          <h2 className="ped-gestos-titulo">O que você quer fazer?</h2>
          <GestosLista gesto={gesto} aoEscolher={escolherGesto} desligados={desligados} />
          {comoRoda}
        </aside>
      ) : null}
    </section>
  );
}

/** Aviso honesto e acionável: sempre diz o que fazer em seguida. */
export function AvisoAcionavel({ aviso, suite }: { aviso: AvisoPedido; suite: StoreSuite }) {
  return (
    <div className="ped-aviso" role="alert" data-tipo={aviso.tipo}>
      <p>{aviso.texto}</p>
      {aviso.tipo === "modulo" ? <button type="button" className="met-botao" onClick={() => void suite.alternarModulo(aviso.modulo, true)}>Ligar módulo {aviso.modulo}</button> : null}
      {aviso.tipo === "suite" ? <button type="button" className="met-botao met-botao-primario" aria-haspopup="dialog" onClick={() => suite.abrirModal()}>Instalar a suíte</button> : null}
      {aviso.tipo === "cli" ? <button type="button" className="met-botao" onClick={() => pedirTela("provedores")}>Abrir Provedores</button> : null}
      {aviso.tipo === "outro" && /aguard/i.test(aviso.texto) ? <button type="button" className="met-botao" onClick={() => pedirTela("terminais")}>Ver o terminal</button> : null}
    </div>
  );
}

/** Checklist curto de primeiro uso: some quando já existe trabalho (sem poluir). */
function PrimeiroUso({ workspaceId, indice, temTexto, suite, geracao, aoEscrever }: { workspaceId: string; indice: IndiceProjeto | null; temTexto: boolean; suite: StoreSuite; geracao: StoreGeracao; aoEscrever: () => void }) {
  const ui = useSuite(suite);
  const g = useGeracao(geracao);
  const [confirmar, setConfirmar] = useState<readonly ContextoId[] | null>(null);
  const e = ui.estados[workspaceId];
  const mods = ui.modulos[workspaceId] ?? null;
  const instalada = e !== undefined && e.estado !== "ausente" && e.estado !== "indisponivel";
  const linhas = useMemo(() => linhasDoContexto({
    camadas: indice?.camadas ?? { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: false, lock: false, memoria: false },
    mtime: indice?.camadas_mtime,
    modulos: mods === null ? null : Object.fromEntries(mods.modulos.map((m) => [m.id, m.ligado])),
    suiteInstalada: e === undefined ? null : instalada,
    skillsFaltando: e?.skills_faltando ?? [],
  }), [indice, mods, e, instalada]);
  const falta = useMemo(() => sequenciaDoQueFalta(linhas), [linhas]);
  if (indice !== null && indice.trabalhos.length > 0) return null;
  if (e === undefined) return null;
  const rodando = g.fase === "rodando" && g.workspaceId === workspaceId;
  const iniciar = (ids: readonly ContextoId[]): void => { void geracao.iniciar(workspaceId, ids); };
  const pedir = (): void => {
    if (falta.length === 0 || rodando) return;
    if (jaConfirmouGeracao()) iniciar(falta); else setConfirmar(falta);
  };
  return (
    <section className="ped-primeiro" aria-label="Primeiros passos">
      <h2>Primeiros passos</h2>
      <ul>
        <li data-feito={instalada || undefined}>
          <i aria-hidden="true">{instalada ? "✓" : "○"}</i>
          <span>{instalada ? "Suíte instalada" : "Instalar a suíte ExpxDev"}</span>
          {!instalada ? <button type="button" className="met-botao met-botao-primario" aria-haspopup="dialog" onClick={() => suite.abrirModal()}>Instalar</button> : null}
        </li>
        <li data-feito={(instalada && falta.length === 0) || undefined}>
          <i aria-hidden="true">{instalada && falta.length === 0 ? "✓" : "○"}</i>
          <span>{instalada && falta.length === 0 ? "Contexto do projeto gerado" : rodando ? "Gerando o contexto do projeto…" : `Gerar o contexto do projeto`}</span>
          {falta.length > 0 && instalada ? <button type="button" className="met-botao" disabled={rodando} onClick={pedir}>Gerar agora</button> : null}
        </li>
        <li data-feito={temTexto || undefined}>
          <i aria-hidden="true">{temTexto ? "✓" : "○"}</i>
          <span>Escrever o primeiro pedido</span>
          {!temTexto ? <button type="button" className="met-botao" onClick={aoEscrever}>Escrever</button> : null}
        </li>
      </ul>
      {confirmar !== null ? (
        <Dialogo titulo={confirmar.length > 1 ? "Gerar o que falta?" : "Gerar agora?"} aoFechar={() => setConfirmar(null)} largura={480}>
          <p><b>Isto abre um agente e consome tokens da sua CLI.</b></p>
          <p>Os comandos rodam um de cada vez, cada um num Pane novo:</p>
          <ul>{confirmar.map((id) => <li key={id}><code>{comandoDeContexto(defDoContexto(id).gesto, "claude").comando}</code></li>)}</ul>
          <p className="met-suave">O agente pode fazer perguntas no Pane: responda lá. Permissões, rigidez e aprovações humanas continuam valendo.</p>
          <div className="ped-confirmar">
            <button type="button" className="botao" data-foco-inicial onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" onClick={() => { const ids = confirmar; setConfirmar(null); lembrarConfirmacaoDeGeracao(); iniciar(ids); }}>Abrir agente e gerar</button>
          </div>
        </Dialogo>
      ) : null}
    </section>
  );
}
