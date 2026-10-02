import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ComponentType, type ReactElement } from "react";
import type { TemaEfetivo } from "../../../compartilhado/ipc";
import type { FerramentaDetectada, LayoutTerminais } from "../../../compartilhado/terminais";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import type { ApiTerminal } from "../../componentes/Terminal/Terminal";
import { agendarCargaOciosa } from "../../componentes/Terminal/carga";
import { TerminalSobDemanda } from "../../componentes/Terminal/TerminalSobDemanda";
import { escolherWebgl } from "../../componentes/Terminal/webgl";
import { aoPedirAcao, aoPedirFocoSessao } from "../../estado/navegacao";
import { storeExecutar, useSessoesExecucao } from "../../estado/executar";
import { storeTema, useTema } from "../../estado/tema";
import { storeTerminais, type EstadoTerminais, type SessaoUI, type StoreTerminais } from "../../estado/terminais";
import { ponte } from "../../ponte";
import { Abas, rotuloDaSessao } from "./Abas";
import { Barra } from "./Barra";
import { BotaoVoz } from "./BotaoVoz";
import { definirPaneEmFoco } from "../../estado/foco-pane";
import { Grade, type PropsTerminalGrade } from "./Grade";
import { PainelProgresso } from "./PainelProgresso";
import { storeProgresso } from "../../estado/progresso";
import { interpretarAtalho, LISTA_ATALHOS, EH_MAC, type AcaoAtalho } from "./atalhos";
import { GRADE_VAZIA, abaAtiva, abaDaSessao, layoutDoEstado, painelsVisiveis, podeGravarLayout, reduzir } from "./estado";
import { folhas, podeDividir as cabeDividir, type Orientacao } from "./layout";
import { primeiraAguardando } from "./semaforo";
import { rotuloMissao, SEM_MISSAO, type MapaMissao } from "./missao";
import { usePerfisDeAgentes } from "./perfis-agentes";
import { useMapaMissao } from "./usarMissao";
import { pedirMaestro } from "../../estado/maestro-acoes";
import { storeWorkspaces, useWorkspaces } from "../../estado/workspaces";
import { storeVisaoTerminais, useVisaoSemProjeto, type StoreVisaoTerminais } from "../../estado/terminais-visao";
import { chaveDaSessao, criarMemoriaDeWorkspaces, criarSeletorDaVisao, idsConhecidos, type ChaveWs } from "./por-workspace";
import { maximoLegivel } from "./grade-auto";
import { rotulosDaOrquestracao, type NoOrquestracao } from "./layout-orquestrador";
import { useOrquestrarPainel, type ApiPainelLivre } from "./orquestrar";
import { FaixaExecutando } from "../../componentes/FaixaExecutando";
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
  /** API do painel livre que orquestra (padrão: `window.ade.painelLivre`); o teste injeta um falso. */
  painelLivre?: ApiPainelLivre | undefined;
  /** projeto aberto (padrão: o workspace atual); `null` = nenhum. */
  workspaceId?: string | null | undefined;
  /** copia texto (padrão: área de transferência). */
  copiarTexto?: ((texto: string) => void) | undefined;
  /** D-571: qual grupo a tela mostra (padrão: o store global; só o teste injeta). */
  visao?: StoreVisaoTerminais | undefined;
  /** D-520: prazo do fechamento automático do painel de worker que morreu com erro (padrão 60 s; só o teste muda). */
  prazoFalhaMs?: number | undefined;
}

// O chunk do xterm nunca entra no JS inicial: só pelo import dinâmico de carga.ts (P-08).
const TerminalReal: ComponentType<PropsTerminalGrade> = TerminalSobDemanda;

export default function Tela(props: PropsTela): ReactElement {
  const store = props.store ?? storeTerminais;
  const api: ApiTela | undefined = props.api ?? (ponte()?.terminais as ApiTela | undefined);
  const Terminal = props.Terminal ?? TerminalReal;
  const temaApp = useTema().efetivo;
  const tema = props.tema ?? temaApp;
  // D-570: a tela mostra SÓ as sessões do workspace atual (ou do grupo "Sem projeto"); os outros workspaces seguem vivos no daemon.
  useEffect(() => { void storeProgresso.iniciar(); }, []); // painel de progresso (D-660…): idempotente; sem API (navegador/teste) fica indisponível e não renderiza
  const wsEstado = useWorkspaces();
  const workspaceAtual = wsEstado.atual?.id ?? null;
  const workspaceBase = props.workspaceId === undefined ? workspaceAtual : props.workspaceId;
  const visaoStore = props.visao ?? storeVisaoTerminais;
  const semProjeto = useVisaoSemProjeto(visaoStore);
  const chave: ChaveWs = semProjeto && workspaceBase !== null ? null : workspaceBase;
  const conhecidos = useMemo(() => (props.workspaceId === undefined && wsEstado.carregado ? idsConhecidos(wsEstado.atual, wsEstado.recentes) : null), [props.workspaceId, wsEstado.carregado, wsEstado.atual, wsEstado.recentes]);
  const seletor = useRef<ReturnType<typeof criarSeletorDaVisao<SessaoUI, EstadoTerminais>>>(undefined as never);
  seletor.current ??= criarSeletorDaVisao<SessaoUI, EstadoTerminais>();
  const estado = useSyncExternalStore(store.assinar, () => (seletor.current)(store.obter(), chave, conhecidos));
  const chaveRef = useRef<ChaveWs>(chave);
  chaveRef.current = chave;
  const conhecidosRef = useRef(conhecidos);
  conhecidosRef.current = conhecidos;
  const memoria = useRef(criarMemoriaDeWorkspaces());
  const mapaDaStore = useMapaMissao(undefined, props.infoMissao === undefined);
  const missao = props.infoMissao ?? mapaDaStore ?? SEM_MISSAO;
  const [grade, dispatch] = useReducer(reduzir, GRADE_VAZIA);
  const [restaurado, setRestaurado] = useState(false);
  const [focoUnico, setFocoUnico] = useState(false);
  // D-570: o conjunto exibido (grade + modo foco) pertence a `chaveGrade`. Na troca de workspace o estado do que sai é guardado e o do que entra assume NA MESMA renderização
  // (nada do outro workspace aparece nem por um quadro). Primeira visita: abas por sessão na hora; o layout em disco chega logo depois.
  const [chaveGrade, setChaveGrade] = useState<ChaveWs>(chave);
  const aSalvar = useRef<{ chave: ChaveWs; grade: typeof grade; focoUnico: boolean } | null>(null);
  if (chaveGrade !== chave) {
    setChaveGrade(chave);
    if (restaurado) {
      memoria.current.guardar(chaveGrade, { grade, focoUnico });
      aSalvar.current = { chave: chaveGrade, grade, focoUnico };
      const guardada = memoria.current.obter(chave);
      const daChave = estado.sessoes.map((x) => x.sessao_id);
      if (guardada !== undefined) {
        const naGrade = new Set(guardada.grade.abas.flatMap((a) => folhas(a.arvore)));
        const faltantes = estado.sessoes.filter((x) => x.externa !== true && !naGrade.has(x.sessao_id)).map((x) => x.sessao_id);
        dispatch({ tipo: "substituir", estado: guardada.grade, faltantes });
        setFocoUnico(guardada.focoUnico);
      } else {
        dispatch({ tipo: "substituir", estado: GRADE_VAZIA });
        dispatch({ tipo: "restaurar", layout: null, sessoes: daChave });
        setFocoUnico(false);
      }
    }
  }
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  const missaoRef = useRef<MapaMissao>(SEM_MISSAO);
  missaoRef.current = missao;
  const [ajuda, setAjuda] = useState(false);
  const [revelada, setRevelada] = useState(false);
  const [orquestrarNovo, setOrquestrarNovo] = useState(false);
  const corpoRef = useRef<HTMLDivElement>(null);
  // sair do grupo "Sem projeto" assim que o workspace atual muda (card, seletor, ⌘K, abrir projeto)
  // (só na MUDANÇA: ao montar, o pedido "Sem projeto (N)" feito de outra tela já está valendo)
  const atualAnterior = useRef(workspaceBase);
  useEffect(() => {
    if (atualAnterior.current === workspaceBase) return;
    atualAnterior.current = workspaceBase;
    visaoStore.sairDeSemProjeto();
  }, [workspaceBase, visaoStore]);
  // "Sem projeto" esvaziou (todos fechados): volta ao workspace atual
  useEffect(() => { if (semProjeto && restaurado && estado.sessoes.length === 0) visaoStore.sairDeSemProjeto(); }, [semProjeto, restaurado, estado.sessoes.length, visaoStore]);
  // Pane em foco publicado para os destinos de anexo (captura, voz): a tela é a dona do foco
  useEffect(() => { definirPaneEmFoco(grade.ativa); }, [grade.ativa]);
  useEffect(() => () => definirPaneEmFoco(null), []);
  const raiz = useRef<HTMLDivElement>(null);
  const ultimaFerramenta = useRef<string | null>(null);

  const sessoes = useMemo(() => Object.fromEntries(estado.sessoes.map((s) => [s.sessao_id, s])) as Record<string, SessaoUI>, [estado.sessoes]);
  // sessões do painel "Execução" (▶ do cabeçalho): rótulo próprio, troca no mesmo lugar e foco (preferência)
  const exec = useSessoesExecucao();
  const nome = useCallback((s: SessaoUI) => (exec.ids.has(s.sessao_id) ? "Execução" : store.nomeDaFerramenta(s.ferramenta_id)), [store, estado.ferramentas, exec.ids]);
  // perfil nominal dos agentes de squad (rótulo do Pane): uma carga em ocioso, só se houver Pane com agente
  const perfis = usePerfisDeAgentes(Object.values(missao).map((i) => i.agenteId));
  const orq = useOrquestrarPainel({ store, dispatch, sessoes, workspaceId: chave, api: props.painelLivre });
  const rotuloDe = useCallback((id: string) => {
    const i = missao[id];
    return i !== undefined ? rotuloMissao(i, store.nomeDaFerramenta(sessoes[id]?.ferramenta_id ?? "terminal"), i.agenteId != null ? perfis.get(i.agenteId)?.rotulo : undefined) : rotuloDaSessao(sessoes[id], nome);
  }, [sessoes, nome, missao, store, estado.ferramentas, perfis]);

  // chunk do terminal em ocioso, depois da primeira pintura (a tela em si já é lazy)
  useEffect(() => props.Terminal === undefined ? agendarCargaOciosa() : undefined, [props.Terminal]);

  // layout em disco de um workspace (D-570); sem layout próprio, o antigo (único, de antes do isolamento) serve de base e é podado às sessões do workspace
  const lerLayoutDe = useCallback(async (c: ChaveWs): Promise<LayoutTerminais | null> => {
    try { return (await api?.lerLayout(c)) ?? (c === null ? null : ((await api?.lerLayout(null)) ?? null)); } catch { return null; }
  }, [api]);
  const idsDaChave = useCallback((c: ChaveWs): string[] => store.obter().sessoes.filter((x) => chaveDaSessao(x, conhecidosRef.current) === c).map((x) => x.sessao_id), [store]);
  const lidas = useRef(new Set<string>());

  // início: UMA assinatura global (no store), recuperar sessões, ler o layout e só então montar a grade
  useEffect(() => {
    let vivo = true;
    void (async () => {
      await store.iniciar();
      void store.carregarFerramentas();
      const c = chaveRef.current;
      let layout = await lerLayoutDe(c);
      if (!vivo) return;
      // o workspace pode ter mudado durante a espera (a lista de workspaces chega depois da tela): vale o de agora
      const agora = chaveRef.current;
      if (agora !== c) { layout = await lerLayoutDe(agora); if (!vivo) return; }
      lidas.current.add(JSON.stringify(agora));
      setChaveGrade(agora);
      dispatch({ tipo: "restaurar", layout, sessoes: idsDaChave(agora) });
      setFocoUnico(layout?.foco_unico === true);
      setRestaurado(true);
    })();
    return () => { vivo = false; };
  }, [store, api, lerLayoutDe, idsDaChave]);

  // primeira visita a um workspace: o layout dele (divisões, proporções, aba e foco) chega do disco logo depois das abas por sessão, se a pessoa ainda não mexeu
  useEffect(() => {
    if (!restaurado || chaveGrade !== chave) return;
    const k = JSON.stringify(chave);
    if (lidas.current.has(k)) return;
    lidas.current.add(k);
    const inicial = gradeRef.current;
    let vivo = true;
    void lerLayoutDe(chave).then((layout) => {
      if (!vivo || layout === null || chaveRef.current !== chave) return;
      const atual = gradeRef.current;
      if (atual.abas !== inicial.abas || atual.ativa !== inicial.ativa) return;
      dispatch({ tipo: "restaurar", layout, sessoes: idsDaChave(chave) });
      setFocoUnico(layout.foco_unico === true);
    });
    return () => { vivo = false; };
  }, [chave, chaveGrade, restaurado, lerLayoutDe, idsDaChave]);

  // o que saiu não perde a gravação pendente (o temporizador abaixo é do conjunto que está na tela)
  useEffect(() => {
    const pendente = aSalvar.current;
    aSalvar.current = null;
    if (pendente === null || api === undefined || !podeGravarLayout(store.obter().recuperado, store.obter().pendentes)) return;
    const conhecidas = new Set(store.obter().sessoes.map((x) => x.sessao_id));
    void api.gravarLayout(pendente.chave, layoutDoEstado(pendente.grade, (id) => conhecidas.has(id), pendente.focoUnico)).catch(() => undefined);
  }, [chaveGrade, api, store]);

  // workspace removido da lista: o estado dele na memória da tela é esquecido (as sessões, se ainda vivas, caem em "Sem projeto")
  useEffect(() => { if (conhecidos !== null) memoria.current.manterApenas(conhecidos); }, [conhecidos]);

  // sessão que o store já não conhece sai da árvore
  useEffect(() => {
    if (!restaurado) return;
    const conhecidas = new Set(estado.sessoes.map((s) => s.sessao_id));
    const sumiram = gradeRef.current.abas.flatMap((a) => folhas(a.arvore)).filter((id) => !conhecidas.has(id));
    if (sumiram.length > 0) dispatch({ tipo: "sumiram", sessoes: sumiram });
  }, [estado.sessoes, restaurado]);

  // papéis do layout "orquestrador + workers" (D-515): vêm da Missão avulsa; a medida do corpo entra na regra dos mínimos legíveis. Declarado ANTES da adoção: os papéis chegam ao reducer
  // no mesmo ciclo em que o worker novo é adotado.
  const nosOrq = useMemo<NoOrquestracao[]>(() => {
    const infos = Object.values(missao).filter((i) => i.avulsa === true);
    return infos.map((i): NoOrquestracao => {
      if (i.ehPiloto) return { id: i.sessaoId, papel: "orquestrador", ordem: i.displayId };
      const pai = infos.find((p) => p.missaoId === i.missaoId && p.ehPiloto)?.sessaoId;
      return { id: i.sessaoId, papel: "worker", ordem: i.displayId, ...(pai === undefined ? {} : { pai }) };
    });
  }, [missao]);
  const rotulosOrq = useMemo(() => rotulosDaOrquestracao(nosOrq), [nosOrq]);
  useEffect(() => {
    if (!restaurado) return;
    const m = corpoRef.current?.getBoundingClientRect();
    const area = m === undefined || !(m.width > 0) || !(m.height > 0) ? null : { largura: Math.round(m.width), altura: Math.round(m.height) };
    dispatch({ tipo: "orquestracao", nos: nosOrq, area });
  }, [nosOrq, restaurado, estado.sessoes]);

  // sessões abertas pelo main (workers do painel que orquestra): entram na grade ao lado do painel que pediu, sem roubar o foco.
  // O Pane chega ao mapa da Missão um instante depois da sessão: espera curta antes de tratar como avulsa de fora.
  const [revisao, setRevisao] = useState(0);
  const vistas = useRef(new Map<string, number>());
  useEffect(() => {
    if (!restaurado) return;
    const naGrade = new Set(gradeRef.current.abas.flatMap((a) => folhas(a.arvore)));
    const novas = estado.sessoes.filter((s) => s.externa === true && !naGrade.has(s.sessao_id));
    if (novas.length === 0) return;
    const medida = corpoRef.current?.getBoundingClientRect();
    const maximo = medida === undefined ? 9 : maximoLegivel(medida.width, medida.height);
    let esperando = false;
    for (const s of novas) {
      const info = missao[s.sessao_id];
      const desde = vistas.current.get(s.sessao_id) ?? Date.now();
      vistas.current.set(s.sessao_id, desde);
      // painel "Execução": reaproveitado a cada execução (entra no lugar da anterior) e sem a espera do mapa de Missões
      const anteriorExec = exec.anterior.get(s.sessao_id);
      if (anteriorExec !== undefined && naGrade.has(anteriorExec)) { dispatch({ tipo: "trocar", de: anteriorExec, para: s.sessao_id }); storeExecutar.liberarAnterior(anteriorExec); continue; }
      if (info === undefined && !exec.ids.has(s.sessao_id) && Date.now() - desde < 1_500) { esperando = true; continue; }
      if (info?.avulsa === true && !info.ehPiloto) {
        const piloto = Object.values(missao).find((i) => i.missaoId === info.missaoId && i.ehPiloto)?.sessaoId ?? null;
        const grupo = Object.values(missao).filter((i) => i.missaoId === info.missaoId && !i.ehPiloto).map((i) => i.sessaoId);
        dispatch({ tipo: "adotar", sessao_id: s.sessao_id, junto_de: piloto, grupo, maximo });
      } else dispatch({ tipo: "adotar", sessao_id: s.sessao_id, junto_de: null, grupo: [], maximo });
    }
    if (!esperando) return;
    const t = setTimeout(() => setRevisao((n) => n + 1), 1_550);
    return () => clearTimeout(t);
  }, [estado.sessoes, missao, restaurado, revisao, exec]);

  // ▶ do cabeçalho com "focar" ligado: leva a aba da execução ao foco assim que ela estiver na grade (uma vez por execução)
  useEffect(() => {
    const alvo = exec.foco;
    if (alvo === null || !restaurado) return;
    const aba = abaDaSessao(gradeRef.current, alvo);
    if (aba === undefined) return;
    dispatch({ tipo: "selecionar-aba", id: aba.id });
    dispatch({ tipo: "focar", sessao_id: alvo });
    storeExecutar.consumirFoco(alvo);
  }, [exec.foco, grade, restaurado]);

  // persistência: só depois da recuperação e nunca com abertura em curso (sessão provisória)
  useEffect(() => {
    if (api === undefined || !restaurado || chaveGrade !== chave || !podeGravarLayout(estado.recuperado, estado.pendentes)) return;
    const conhecidas = new Set(estado.sessoes.map((s) => s.sessao_id));
    const t = setTimeout(() => { void api.gravarLayout(chave, layoutDoEstado(grade, (id) => conhecidas.has(id), focoUnico)).catch(() => undefined); }, props.atrasoGravacao ?? 400);
    return () => clearTimeout(t);
  }, [api, grade, restaurado, estado.recuperado, estado.pendentes, estado.sessoes, props.atrasoGravacao, chave, focoUnico]);

  const instaladas = useMemo(() => (estado.ferramentas ?? []).filter((f) => f.instalado), [estado.ferramentas]);

  // D-571: no grupo "Sem projeto" (com um workspace aberto) não se abre terminal novo: ele nasceria no workspace atual e se misturaria; a barra explica
  const bloqueioNovo = semProjeto && workspaceBase !== null;
  const abrirSessao = useCallback(async (f: FerramentaDetectada, como: "aba" | { alvo: string; orientacao: Orientacao }) => {
    if (bloqueioNovo) return;
    if (como !== "aba") {
      const aba = abaDaSessao(gradeRef.current, como.alvo);
      if (aba === undefined || !cabeDividir(aba.arvore, como.alvo)) return;
    }
    const chaveAoPedir = chaveRef.current;
    // D-570: "novo terminal" abre SEMPRE no workspace da tela (a sessão grava o workspace de origem)
    const id = orquestrarNovo && f.id !== "terminal" && orq.disponivel ? await orq.abrirNovo(f) : await store.abrir(f, { workspaceId: chaveAoPedir });
    if (id === null) return;
    ultimaFerramenta.current = f.id;
    // a pessoa trocou de workspace durante a abertura: a sessão é do workspace de origem e entra na grade dele quando ele voltar
    if (chaveRef.current !== chaveAoPedir) return;
    dispatch(como === "aba" ? { tipo: "nova-aba", sessao_id: id } : { tipo: "dividir", alvo: como.alvo, orientacao: como.orientacao, nova: id });
  }, [store, orquestrarNovo, orq.abrirNovo, orq.disponivel, bloqueioNovo]);

  const ferramentaPadrao = useCallback((): FerramentaDetectada | undefined => {
    const daAtiva = gradeRef.current.ativa !== null ? store.obter().sessoes.find((s) => s.sessao_id === gradeRef.current.ativa)?.ferramenta_id : undefined;
    const preferida = daAtiva ?? ultimaFerramenta.current;
    return instaladas.find((f) => f.id === preferida) ?? instaladas[0];
  }, [store, instaladas]);

  const fecharDireto = useCallback((id: string) => { store.fechar(id); dispatch({ tipo: "fechar", sessao_id: id }); }, [store]);
  // fechar o ORQUESTRADOR encerra os agentes dele (o main os fecha junto): pergunta antes (D-516); fechar um worker ou um painel comum é direto
  const [fecharOrq, setFecharOrq] = useState<{ id: string; n: number } | null>(null);
  const fecharSessao = useCallback((id: string) => {
    const info = missaoRef.current[id];
    if (info?.avulsa === true && info.ehPiloto) {
      const n = Object.values(missaoRef.current).filter((i) => i.avulsa === true && !i.ehPiloto && i.missaoId === info.missaoId && sessoes[i.sessaoId] !== undefined && sessoes[i.sessaoId]?.estado !== "encerrada" && sessoes[i.sessaoId]?.estado !== "erro").length;
      if (n > 0) { setFecharOrq({ id, n }); return; }
    }
    fecharDireto(id);
  }, [fecharDireto, sessoes]);
  const fecharAba = useCallback((abaId: string) => {
    const aba = gradeRef.current.abas.find((a) => a.id === abaId);
    if (aba !== undefined) folhas(aba.arvore).forEach(fecharDireto);
  }, [fecharDireto]);
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
      case "maestro": {
        // contexto do painel em foco: Missão e Pane quando há (painel livre: só o workspace); nada é escrito no PTY
        const info = ativa === null ? undefined : missaoRef.current[ativa];
        pedirMaestro(info === undefined ? null : { pane_id: info.paneId ?? null, mission_id: info.missaoId, trabalho_id: null, arquivos: [], trecho: null }, info === undefined ? null : `painel #${info.displayId}`);
        break;
      }
      case "paleta": break; // a paleta de comandos é de outra tela; o atalho fica reservado
    }
  }, [ferramentaPadrao, abrirSessao, dividirPainel, fecharSessao, focarTerminal, alternarFoco]);

  // painel de workspaces: "focar o painel desta sessão" (troca de aba, marca o painel ativo e leva o foco ao terminal); some sozinho se a sessão não aparecer
  const [focoPedido, setFocoPedido] = useState<string | null>(null);
  useEffect(() => aoPedirFocoSessao(setFocoPedido), []);
  useEffect(() => {
    if (focoPedido === null) return;
    const t = setTimeout(() => setFocoPedido(null), 4_000);
    return () => clearTimeout(t);
  }, [focoPedido]);
  useEffect(() => {
    if (focoPedido === null || !restaurado) return;
    // D-570: a sessão pedida é de OUTRO workspace: troca de workspace (a tela troca de conjunto) e só então foca o painel
    const alvoSessao = store.obter().sessoes.find((x) => x.sessao_id === focoPedido);
    if (alvoSessao !== undefined) {
      const dono = chaveDaSessao(alvoSessao, conhecidosRef.current);
      if (dono !== chave) {
        if (dono === null) visaoStore.entrarEmSemProjeto();
        else { visaoStore.sairDeSemProjeto(); if (dono !== workspaceAtual) void storeWorkspaces.definirAtual(dono); }
        return;
      }
    }
    const aba = abaDaSessao(grade, focoPedido);
    if (aba === undefined) return; // a sessão do main ainda não entrou na grade: tenta de novo quando a grade mudar
    if (grade.ativa !== focoPedido || abaAtiva(grade)?.id !== aba.id) {
      dispatch({ tipo: "selecionar-aba", id: aba.id });
      dispatch({ tipo: "focar", sessao_id: focoPedido });
      return;
    }
    setFocoPedido(null);
    requestAnimationFrame(() => focarTerminal());
  }, [focoPedido, restaurado, grade, focarTerminal, chave, workspaceAtual, store, visaoStore]);

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
        perfis={perfis}
        {...(orq.disponivel ? { orquestrar: orq.controle } : {})}
        orquestracao={rotulosOrq}
        {...(props.copiarTexto !== undefined ? { copiarTexto: props.copiarTexto } : {})}
        {...(props.prazoFalhaMs !== undefined ? { prazoFalhaMs: props.prazoFalhaMs } : {})}
        podeDividir={grade.ativa === null || cabeDividir(aba.arvore, grade.ativa)}
        aoFocar={(id) => dispatch({ tipo: "focar", sessao_id: id })}
        aoFechar={fecharSessao}
        aoExpandir={alternarFoco}
        aoInterromper={(id) => store.interromper(id)}
        aoProporcao={(a, b, razao) => dispatch({ tipo: "proporcao", a, b, razao })}
      />
    );
  }

  return (
    <div className="terminais-tela" data-modo="cheia" ref={raiz} data-foco={oculta || undefined}>
      {oculta ? <div className="terminais-borda" aria-hidden="true" onPointerEnter={() => setRevelada(true)}
        onPointerLeave={(e) => { const barra = raiz.current?.querySelector(".terminais-barra"); if (!(e.relatedTarget instanceof Node) || barra == null || !barra.contains(e.relatedTarget)) setRevelada(false); }} /> : null}
      <FaixaExecutando workspaceId={workspaceAtual} />
      <Barra
        ferramentas={estado.ferramentas}
        abrindo={estado.pendentes > 0 || bloqueioNovo}
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
        acoesExtras={<BotaoVoz sessaoId={grade.ativa} />}
        {...(orq.disponivel ? { orquestrarNovo, aoAlternarOrquestrarNovo: () => setOrquestrarNovo((v) => !v) } : {})}
      >
        {grade.abas.length > 0 ? (
          <Abas
            abas={grade.abas}
            ativaId={aba?.id ?? null}
            fixadas={grade.fixadas}
            sessoes={sessoes}
            nomeDaFerramenta={nome}
            missao={missao}
            perfis={perfis}
            aoSelecionar={(id) => dispatch({ tipo: "selecionar-aba", id })}
            aoFechar={fecharAba}
            aoFixar={(id) => dispatch({ tipo: "fixar", id })}
          />
        ) : null}
      </Barra>
      {bloqueioNovo ? (
        <div className="terminais-sem-projeto" role="status" data-testid="grupo-sem-projeto">
          <strong>Sem projeto</strong>
          <span>Terminais que não pertencem a nenhum workspace. Terminais novos abrem no workspace atual.</span>
          <button type="button" onClick={() => visaoStore.sairDeSemProjeto()}>Voltar a {wsEstado.atual?.nome ?? "o workspace"}</button>
        </div>
      ) : null}
      {estado.erro !== null ? (
        <div className="terminais-erro" role="alert">
          <span>{estado.erro}</span>
          <button type="button" onClick={() => store.limparErro()}>Dispensar</button>
        </div>
      ) : null}
      {estado.erroFerramentas !== null ? <div className="terminais-erro" role="alert">Não foi possível detectar as CLIs: {estado.erroFerramentas}</div> : null}
      <div className="terminais-miolo">
        <div className="terminais-corpo" ref={corpoRef}>{corpo}</div>
        <PainelProgresso compacto={oculta} />
      </div>
      {orq.dialogo}
      {fecharOrq !== null ? (
        <DialogoConfirmacao
          titulo="Fechar o orquestrador"
          texto={<p>Encerrar também {fecharOrq.n === 1 ? "o agente" : `os ${fecharOrq.n} agentes`} que este painel abriu? Eles são fechados junto com o orquestrador e o trabalho em andamento deles é interrompido.</p>}
          rotuloConfirmar={fecharOrq.n === 1 ? "Encerrar também o agente" : `Encerrar também os ${fecharOrq.n} agentes`}
          perigoso
          aoConfirmar={() => { const id = fecharOrq.id; setFecharOrq(null); fecharDireto(id); }}
          aoCancelar={() => setFecharOrq(null)}
        />
      ) : null}
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
