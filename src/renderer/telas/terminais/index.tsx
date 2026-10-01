import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentType, type ReactElement } from "react";
import type { TemaEfetivo } from "../../../compartilhado/ipc";
import type { FerramentaDetectada, LayoutTerminais } from "../../../compartilhado/terminais";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import type { ApiTerminal } from "../../componentes/Terminal/Terminal";
import { agendarCargaOciosa } from "../../componentes/Terminal/carga";
import { TerminalSobDemanda } from "../../componentes/Terminal/TerminalSobDemanda";
import { escolherWebgl } from "../../componentes/Terminal/webgl";
import { aoPedirAcao } from "../../estado/navegacao";
import { storeTema, useTema } from "../../estado/tema";
import { storeTerminais, useTerminais, type SessaoUI, type StoreTerminais } from "../../estado/terminais";
import { ponte } from "../../ponte";
import { Abas, rotuloDaSessao } from "./Abas";
import { Barra } from "./Barra";
import { Grade, type PropsTerminalGrade } from "./Grade";
import { interpretarAtalho, LISTA_ATALHOS, EH_MAC, type AcaoAtalho } from "./atalhos";
import { GRADE_VAZIA, abaAtiva, abaDaSessao, layoutDoEstado, painelsVisiveis, podeGravarLayout, reduzir } from "./estado";
import { folhas, podeDividir as cabeDividir, type Orientacao } from "./layout";
import { primeiraAguardando } from "./semaforo";
import { rotuloMissao, SEM_MISSAO, type MapaMissao } from "./missao";
import { useMapaMissao } from "./usarMissao";
import "./terminais.css";

/** O que a tela usa do main: a API do terminal mais a persistência do layout (estrutural; o teste injeta um falso). */
export type ApiTela = ApiTerminal & {
  lerLayout(workspaceId: string | null): Promise<LayoutTerminais | null>;
  gravarLayout(workspaceId: string | null, layout: LayoutTerminais): Promise<boolean>;
};

export interface PropsTela {
  store?: StoreTerminais;
  api?: ApiTela | undefined;
  /** componente do terminal (o xterm real carrega em ocioso; o teste usa um <pre>). */
  Terminal?: ComponentType<PropsTerminalGrade>;
  tema?: TemaEfetivo;
  /** ms entre a última mudança e a gravação do layout. */
  atrasoGravacao?: number;
  /** panes de Missão por sessão; sem isto vem do store de missões (squad/agêntico). */
  infoMissao?: MapaMissao | undefined;
  /** copia texto (padrão: área de transferência). */
  copiarTexto?: ((texto: string) => void) | undefined;
}

// O chunk do xterm nunca entra no JS inicial: só pelo import dinâmico de carga.ts (P-08).
const TerminalReal: ComponentType<PropsTerminalGrade> = TerminalSobDemanda;

export default function Tela(props: PropsTela): ReactElement {
  const store = props.store ?? storeTerminais;
  const api: ApiTela | undefined = props.api ?? (ponte()?.terminais as ApiTela | undefined);
  const Terminal = props.Terminal ?? TerminalReal;
  const temaApp = useTema().efetivo;
  const tema = props.tema ?? temaApp;
  const estado = useTerminais(store);
  const mapaDaStore = useMapaMissao(undefined, props.infoMissao === undefined);
  const missao = props.infoMissao ?? mapaDaStore ?? SEM_MISSAO;
  const [grade, dispatch] = useReducer(reduzir, GRADE_VAZIA);
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const [restaurado, setRestaurado] = useState(false);
  const [ajuda, setAjuda] = useState(false);
  const [focoUnico, setFocoUnico] = useState(false);
  const [revelada, setRevelada] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const ultimaFerramenta = useRef<string | null>(null);

  const sessoes = useMemo(() => Object.fromEntries(estado.sessoes.map((s) => [s.sessao_id, s])) as Record<string, SessaoUI>, [estado.sessoes]);
  const nome = useCallback((s: SessaoUI) => store.nomeDaFerramenta(s.ferramenta_id), [store, estado.ferramentas]);
  const rotuloDe = useCallback((id: string) => {
    const i = missao[id];
    return i !== undefined ? rotuloMissao(i, store.nomeDaFerramenta(sessoes[id]?.ferramenta_id ?? "terminal")) : rotuloDaSessao(sessoes[id], nome);
  }, [sessoes, nome, missao, store, estado.ferramentas]);

  // chunk do terminal em ocioso, depois da primeira pintura (a tela em si já é lazy)
  useEffect(() => props.Terminal === undefined ? agendarCargaOciosa() : undefined, [props.Terminal]);

  // início: UMA assinatura global (no store), recuperar sessões, ler o layout e só então montar a grade
  useEffect(() => {
    let vivo = true;
    void (async () => {
      await store.iniciar();
      void store.carregarFerramentas();
      let layout: LayoutTerminais | null = null;
      try { layout = (await api?.lerLayout(null)) ?? null; } catch { layout = null; }
      if (!vivo) return;
      dispatch({ tipo: "restaurar", layout, sessoes: store.obter().sessoes.map((s) => s.sessao_id) });
      setRestaurado(true);
    })();
    return () => { vivo = false; };
  }, [store, api]);

  // sessão que o store já não conhece sai da árvore
  useEffect(() => {
    if (!restaurado) return;
    const conhecidas = new Set(estado.sessoes.map((s) => s.sessao_id));
    const sumiram = gradeRef.current.abas.flatMap((a) => folhas(a.arvore)).filter((id) => !conhecidas.has(id));
    if (sumiram.length > 0) dispatch({ tipo: "sumiram", sessoes: sumiram });
  }, [estado.sessoes, restaurado]);

  // persistência: só depois da recuperação e nunca com abertura em curso (sessão provisória)
  useEffect(() => {
    if (api === undefined || !restaurado || !podeGravarLayout(estado.recuperado, estado.pendentes)) return;
    const conhecidas = new Set(estado.sessoes.map((s) => s.sessao_id));
    const t = setTimeout(() => { void api.gravarLayout(null, layoutDoEstado(grade, (id) => conhecidas.has(id))).catch(() => undefined); }, props.atrasoGravacao ?? 400);
    return () => clearTimeout(t);
  }, [api, grade, restaurado, estado.recuperado, estado.pendentes, estado.sessoes, props.atrasoGravacao]);

  const instaladas = useMemo(() => (estado.ferramentas ?? []).filter((f) => f.instalado), [estado.ferramentas]);

  const abrirSessao = useCallback(async (f: FerramentaDetectada, como: "aba" | { alvo: string; orientacao: Orientacao }) => {
    if (como !== "aba") {
      const aba = abaDaSessao(gradeRef.current, como.alvo);
      if (aba === undefined || !cabeDividir(aba.arvore, como.alvo)) return;
    }
    const id = await store.abrir(f);
    if (id === null) return;
    ultimaFerramenta.current = f.id;
    dispatch(como === "aba" ? { tipo: "nova-aba", sessao_id: id } : { tipo: "dividir", alvo: como.alvo, orientacao: como.orientacao, nova: id });
  }, [store]);

  const ferramentaPadrao = useCallback((): FerramentaDetectada | undefined => {
    const daAtiva = gradeRef.current.ativa !== null ? store.obter().sessoes.find((s) => s.sessao_id === gradeRef.current.ativa)?.ferramenta_id : undefined;
    const preferida = daAtiva ?? ultimaFerramenta.current;
    return instaladas.find((f) => f.id === preferida) ?? instaladas[0];
  }, [store, instaladas]);

  const fecharSessao = useCallback((id: string) => { store.fechar(id); dispatch({ tipo: "fechar", sessao_id: id }); }, [store]);
  const fecharAba = useCallback((abaId: string) => {
    const aba = gradeRef.current.abas.find((a) => a.id === abaId);
    if (aba !== undefined) folhas(aba.arvore).forEach(fecharSessao);
  }, [fecharSessao]);
  const dividirPainel = useCallback((alvo: string, orientacao: Orientacao) => {
    const daCli = store.obter().sessoes.find((s) => s.sessao_id === alvo)?.ferramenta_id;
    const f = instaladas.find((x) => x.id === daCli) ?? ferramentaPadrao();
    if (f !== undefined) void abrirSessao(f, { alvo, orientacao });
  }, [store, instaladas, ferramentaPadrao, abrirSessao]);
  const focarTerminal = useCallback(() => {
    const id = gradeRef.current.ativa;
    if (id !== null) raiz.current?.querySelector<HTMLElement>(`[data-sessao="${CSS.escape(id)}"] textarea`)?.focus();
  }, []);
  const irParaAguardando = useCallback(() => {
    const itens = gradeRef.current.abas.flatMap((a) => folhas(a.arvore).flatMap((id) => { const s = sessoes[id]; return s === undefined ? [] : [{ sessao_id: id, aba_id: a.id, estado: s.estado, atividade: s.atividade }]; }));
    const alvo = primeiraAguardando(itens);
    if (alvo !== null) { dispatch({ tipo: "focar", sessao_id: alvo }); const aba = abaDaSessao(gradeRef.current, alvo); if (aba) dispatch({ tipo: "selecionar-aba", id: aba.id }); dispatch({ tipo: "focar", sessao_id: alvo }); }
  }, [sessoes]);

  // modo foco: expande o painel (2+) ou só esconde a linha (1 painel)
  const alternarFoco = useCallback(() => {
    const aba = abaAtiva(gradeRef.current);
    if (aba !== undefined && folhas(aba.arvore).length >= 2) dispatch({ tipo: "expandir" });
    else setFocoUnico((v) => !v);
    setRevelada(false);
  }, []);
  const buscarNoPainel = useCallback(() => {
    const id = gradeRef.current.ativa;
    if (id !== null) window.dispatchEvent(new CustomEvent("ade:buscar-terminal", { detail: id }));
  }, []);

  const executar = useCallback((a: AcaoAtalho) => {
    const ativa = gradeRef.current.ativa;
    switch (a.tipo) {
      case "nova-aba": { const f = ferramentaPadrao(); if (f) void abrirSessao(f, "aba"); break; }
      case "dividir": if (ativa !== null) dividirPainel(ativa, a.orientacao); break;
      case "fechar": if (ativa !== null) fecharSessao(ativa); break;
      case "aba": dispatch({ tipo: "aba-passo", passo: a.passo }); break;
      case "aba-numero": dispatch({ tipo: "aba-numero", numero: a.numero }); break;
      case "painel": dispatch({ tipo: "painel-passo", passo: a.passo }); break;
      case "expandir": alternarFoco(); break;
      case "focar": focarTerminal(); break;
      case "sair": (raiz.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? raiz.current?.querySelector<HTMLElement>(".terminais-barra button:not(:disabled)"))?.focus(); break;
      case "tema": void storeTema.alternar(); break;
      case "paleta": break; // a paleta de comandos é de outra tela; o atalho fica reservado
    }
  }, [ferramentaPadrao, abrirSessao, dividirPainel, fecharSessao, focarTerminal, alternarFoco]);

  // paleta/menu: "Novo terminal". O pedido espera a restauração e a detecção (a tela é lazy e a detecção leva segundos)
  const [pedidosNovo, setPedidosNovo] = useState(0);
  useEffect(() => aoPedirAcao("novo-terminal", () => setPedidosNovo((n) => n + 1)), []);
  useEffect(() => {
    if (pedidosNovo === 0 || !restaurado || estado.ferramentas === null) return;
    setPedidosNovo(0);
    const f = ferramentaPadrao();
    if (f !== undefined) void abrirSessao(f, "aba");
  }, [pedidosNovo, restaurado, estado.ferramentas, ferramentaPadrao, abrirSessao]);

  // atalhos: captura na janela (antes do xterm) e só com a tela visível; Ctrl+letra segue para o processo
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent): void => {
      if (raiz.current === null || raiz.current.closest("[hidden]") !== null) return;
      if (ajuda && e.key === "Escape") { e.preventDefault(); setAjuda(false); return; }
      const a = interpretarAtalho(e);
      if (a === null) return;
      e.preventDefault();
      e.stopPropagation();
      executar(a);
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [executar, ajuda]);

  const visiveis = painelsVisiveis(grade);
  const webgl = useMemo(() => escolherWebgl(visiveis, grade.ativa), [visiveis.join("|"), grade.ativa]); // eslint-disable-line react-hooks/exhaustive-deps
  const aba = abaAtiva(grade);
  const oculta = aba !== undefined && (grade.expandido !== null || (focoUnico && folhas(aba.arvore).length === 1));
  const painelUnico = aba !== undefined && folhas(aba.arvore).length === 1;
  useEffect(() => { if (focoUnico && !painelUnico) setFocoUnico(false); }, [focoUnico, painelUnico]);

  let corpo: ReactElement;
  if (!estado.disponivel) {
    corpo = <EstadoVazio icone="terminais" titulo="Terminais só funcionam no aplicativo" texto="Esta tela precisa do processo principal do aplicativo para abrir as CLIs. Abra o aplicativo instalado em vez do navegador." />;
  } else if (!restaurado || (aba === undefined && estado.ferramentas === null)) {
    // a detecção de CLIs (`--version` de cada uma) leva segundos: só o estado vazio depende dela; painéis já existentes aparecem sem esperar (P-13)
    corpo = <div className="tela-carregando" aria-busy="true" role="status"><span className="terminais-sr">Carregando terminais…</span></div>;
  } else if (aba === undefined) {
    corpo = instaladas.length === 0 ? (
      <EstadoVazio icone="terminais" titulo="Nenhuma CLI encontrada" texto="Instale uma CLI de IA (por exemplo Claude Code, Codex, Gemini CLI ou OpenCode) com o gerenciador de pacotes dela, garanta que o comando esteja no PATH e clique em detectar de novo. O terminal comum do sistema também aparece aqui quando disponível.">
        <button type="button" className="terminais-botao terminais-botao-primario" onClick={() => void store.carregarFerramentas(true)}>Detectar de novo</button>
      </EstadoVazio>
    ) : (
      <EstadoVazio icone="terminais" titulo="Nenhum terminal aberto" texto="Escolha uma CLI ou ferramenta para abrir a primeira sessão. Ela continua rodando mesmo se você fechar o aplicativo.">
        <div className="terminais-escolha" role="group" aria-label="Abrir sessão">
          {instaladas.map((f) => (
            <button key={f.id} type="button" className="terminais-botao" disabled={estado.pendentes > 0} onClick={() => void abrirSessao(f, "aba")}>
              {f.nome}
            </button>
          ))}
        </div>
      </EstadoVazio>
    );
  } else {
    corpo = (
      <Grade
        arvore={aba.arvore}
        abaId={aba.id}
        expandido={grade.expandido}
        ativa={grade.ativa}
        sessoes={sessoes}
        falhas={estado.falhas}
        webgl={webgl}
        tema={tema}
        api={api ?? SEM_API}
        Terminal={Terminal}
        rotuloDe={rotuloDe}
        missao={missao}
        {...(props.copiarTexto !== undefined ? { copiarTexto: props.copiarTexto } : {})}
        podeDividir={grade.ativa === null || cabeDividir(aba.arvore, grade.ativa)}
        aoFocar={(id) => dispatch({ tipo: "focar", sessao_id: id })}
        aoFechar={fecharSessao}
        aoExpandir={alternarFoco}
        aoInterromper={(id) => store.interromper(id)}
      />
    );
  }

  return (
    <div className="terminais-tela" ref={raiz} data-foco={oculta || undefined}>
      {oculta ? <div className="terminais-borda" aria-hidden="true" onPointerEnter={() => setRevelada(true)}
        onPointerLeave={(e) => { const barra = raiz.current?.querySelector(".terminais-barra"); if (!(e.relatedTarget instanceof Node) || barra == null || !barra.contains(e.relatedTarget)) setRevelada(false); }} /> : null}
      <Barra
        ferramentas={estado.ferramentas}
        abrindo={estado.pendentes > 0}
        aguardando={estado.aguardando}
        temPainel={aba !== undefined}
        podeDividir={aba !== undefined && grade.ativa !== null && cabeDividir(aba.arvore, grade.ativa)}
        oculta={oculta && !revelada}
        emFoco={oculta}
        aoAbrir={(f) => void abrirSessao(f, "aba")}
        aoDetectarDeNovo={() => void store.carregarFerramentas(true)}
        aoDividir={(o) => { if (grade.ativa !== null) dividirPainel(grade.ativa, o); }}
        aoBuscar={buscarNoPainel}
        aoIrParaAguardando={irParaAguardando}
        aoAlternarFoco={alternarFoco}
        aoAbrirAjuda={() => setAjuda(true)}
        aoSairDoMouse={() => setRevelada(false)}
      >
        {grade.abas.length > 0 ? (
          <Abas
            abas={grade.abas}
            ativaId={aba?.id ?? null}
            fixadas={grade.fixadas}
            sessoes={sessoes}
            nomeDaFerramenta={nome}
            missao={missao}
            aoSelecionar={(id) => dispatch({ tipo: "selecionar-aba", id })}
            aoFechar={fecharAba}
            aoFixar={(id) => dispatch({ tipo: "fixar", id })}
          />
        ) : null}
      </Barra>
      {estado.erro !== null ? (
        <div className="terminais-erro" role="alert">
          <span>{estado.erro}</span>
          <button type="button" onClick={() => store.limparErro()}>Dispensar</button>
        </div>
      ) : null}
      {estado.erroFerramentas !== null ? <div className="terminais-erro" role="alert">Não foi possível detectar as CLIs: {estado.erroFerramentas}</div> : null}
      <div className="terminais-corpo">{corpo}</div>
      {ajuda ? (
        <Dialogo titulo="Atalhos de teclado" aoFechar={() => setAjuda(false)} largura={420}>
          <table className="terminais-ajuda-tabela">
            <tbody>
              {LISTA_ATALHOS.map((l) => (<tr key={l.acao}><th scope="row">{l.acao}</th><td><kbd>{EH_MAC ? l.mac : l.outros}</kbd></td></tr>))}
            </tbody>
          </table>
          <div className="dialogo-acoes"><button type="button" className="terminais-botao terminais-botao-primario" data-foco-inicial onClick={() => setAjuda(false)}>Fechar</button></div>
        </Dialogo>
      ) : null}
    </div>
  );
}

const SEM_API: ApiTerminal = {
  escrever: () => undefined,
  redimensionar: () => undefined,
  confirmarConsumo: () => undefined,
};
