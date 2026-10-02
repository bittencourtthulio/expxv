import "./board.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUNAS_BOARD, type BoardModelo, type CardBoard } from "../../../compartilhado/custo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { storeBoard, useBoard, type StoreBoard } from "../../estado/board";
import { filtrosVazios, FILTROS_VAZIOS, type FiltrosUi } from "../../estado/board-filtros";
import { explicarCusto, formatarCusto, LEGENDA_CUSTO } from "../../estado/custo-formato";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { ALTURA_CARD } from "./CardLinha";
import type { LinhaColuna } from "./agrupar";
import { Colunas, ListaColuna } from "./Colunas";
import { CustoMissaoPainel } from "./CustoMissao";
import { DelegarCard as Delegar } from "./Delegar";
import { Detalhe } from "./Detalhe";
import { MenuLazy } from "./MenuLazy";
import { Filtros } from "./Filtros";
import { focarLinha } from "./foco";
import { Insights } from "./Insights";
import { Progresso } from "./Progresso";

const ANUNCIO_MIN_MS = 10_000;
const todosOsCards = (m: BoardModelo): CardBoard[] => [...COLUNAS_BOARD.flatMap((c) => m.colunas[c]), ...m.descartados];

export interface PropsBoard { store?: StoreBoard; workspaces?: StoreWorkspaces; atrasoBusca?: number; agora?: () => number }

/** Aba Board (Missões): seis colunas virtualizadas, sem arrastar; o método é dono do estado (D-04) e o ADE só lê, mostra o custo e delega. */
export function TelaBoard({ store = storeBoard, workspaces = storeWorkspaces, atrasoBusca, agora = Date.now }: PropsBoard) {
  const { atual } = useWorkspaces(workspaces);
  const est = useBoard(store);
  const [recolhidas, setRecolhidas] = useState<ReadonlySet<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [delegando, setDelegando] = useState<CardBoard | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const ultimoAnuncio = useRef(0);
  const ultimoCusto = useRef<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => { store.iniciar(); return () => store.encerrar(); }, [store]);
  useEffect(() => { void store.definirWorkspace(atual?.id ?? null); setAberto(null); setRecolhidas(new Set()); }, [atual?.id, store]);

  const modelo = est.modelo;
  const cards = useMemo(() => (modelo === null ? [] : todosOsCards(modelo)), [modelo]);
  const cardAberto = aberto === null ? null : cards.find((c) => c.chave === aberto) ?? null;
  useEffect(() => { if (aberto !== null && modelo !== null && cardAberto === null) setAberto(null); }, [aberto, modelo, cardAberto]);

  // aria-live educado: "custo atualizado" no máximo 1 vez a cada 10 s
  const custoTexto = modelo === null ? null : formatarCusto(modelo.custo);
  useEffect(() => {
    if (custoTexto === null) return;
    if (ultimoCusto.current !== null && ultimoCusto.current !== custoTexto && agora() - ultimoAnuncio.current >= ANUNCIO_MIN_MS) {
      ultimoAnuncio.current = agora();
      setAnuncio(`Custo atualizado: ${custoTexto}`);
    }
    ultimoCusto.current = custoTexto;
  }, [custoTexto, agora]);

  const abrir = useCallback((c: CardBoard) => setAberto(c.chave), []);
  const faixa = useCallback((k: string) => setRecolhidas((s) => { const n = new Set(s); const chave = k.replace(/^faixa\|/, ""); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; }), []);
  const fechar = useCallback(() => {
    const chave = aberto;
    setAberto(null);
    // devolve o foco ao card que abriu o detalhe
    setTimeout(() => raiz.current?.querySelector<HTMLElement>(`[data-chave="${CSS.escape(chave ?? "")}"]`)?.focus(), 0);
  }, [aberto]);
  const irPara = useCallback((taskId: string) => {
    const alvo = cards.find((c) => c.task_id === taskId && c.trabalho_id === cardAberto?.trabalho_id);
    if (alvo === undefined || modelo === null) return;
    setAberto(alvo.chave);
    if ((est.filtros.agrupar ?? "nenhum") === "nenhum" && raiz.current !== null) {
      const col = COLUNAS_BOARD.indexOf(alvo.coluna);
      const i = modelo.colunas[alvo.coluna].findIndex((c) => c.chave === alvo.chave);
      if (i >= 0) focarLinha(raiz.current, col, i, ALTURA_CARD);
    }
  }, [cards, cardAberto, modelo, est.filtros.agrupar]);
  const mudarFiltros = useCallback((f: FiltrosUi) => void store.definirFiltros(f), [store]);

  const missaoDoCusto = est.filtros.mission_id ?? (modelo !== null && modelo.trabalhos.length === 1 ? modelo.trabalhos[0]!.mission_id : null);
  const total = modelo === null ? 0 : COLUNAS_BOARD.reduce((s, c) => s + modelo.colunas[c].length, 0);

  let corpo: React.ReactNode;
  if (atual === null) corpo = <EstadoVazio icone="missoes" titulo="Abra um workspace primeiro" texto="O board mostra as tasks do método do workspace aberto. Abra uma pasta em Workspaces e volte aqui." />;
  else if (!est.disponivel) corpo = <EstadoVazio icone="missoes" titulo="Board indisponível" texto="Esta janela não está ligada ao app (ou o main não expõe os canais do board). Abra o app para ver o quadro." />;
  else if (est.erro !== null && modelo === null) corpo = <div className="bd-estado"><p role="alert" className="erro-caixa">{est.erro}</p><button type="button" className="botao" onClick={() => void store.recarregar()}>Tentar de novo</button></div>;
  else if (modelo === null) corpo = <div className="bd-estado" aria-busy="true" role="status">Montando o board…</div>;
  else if (total === 0 && modelo.descartados.length === 0) {
    corpo = filtrosVazios(est.filtros)
      ? <EstadoVazio icone="missoes" titulo="Nenhum plano do método neste workspace" texto="O board mostra as tasks T-NN.MM do plano do método. Abra /expx:sprintx num terminal deste workspace para criar um plano e volte aqui." />
      : <EstadoVazio icone="missoes" titulo="Nenhum card com esses filtros" texto="Os filtros escondem todos os cards. Limpe os filtros para ver o quadro inteiro."><button type="button" className="botao" onClick={() => mudarFiltros({ ...FILTROS_VAZIOS })}>Limpar filtros</button></EstadoVazio>;
  } else {
    const linhasDescartados: LinhaColuna[] = modelo.descartados.map((card) => ({ tipo: "card", chave: card.chave, card }));
    corpo = (
      <div className="bd-corpo">
        <Colunas modelo={modelo} agrupar={est.filtros.agrupar ?? "nenhum"} recolhidas={recolhidas} selecionada={aberto} aoAbrir={abrir} aoFaixa={faixa} />
        {est.filtros.mostrar_descartados === true ? (
          <section className="bd-descartados" role="region" aria-label={`Descartados, ${modelo.descartados.length} cards (custo preservado)`}>
            <h3 className="bd-coluna-cab" data-glifo="✕" data-n={modelo.descartados.length}>Descartados</h3>
            <div className="bd-descartados-corpo">
              <ListaColuna linhas={linhasDescartados} rotulo="Cards descartados" selecionada={aberto} aoAbrir={abrir} aoFaixa={faixa} />
            </div>
          </section>
        ) : null}
        {cardAberto !== null ? <Detalhe card={cardAberto} aoFechar={fechar} aoIrPara={irPara} aoDelegar={setDelegando} /> : null}
      </div>
    );
  }

  return (
    <section ref={raiz} className="board" aria-label="Board de cards">
      <div className="bd-controles" role="toolbar" aria-label="Controles do board">
        <Filtros filtros={est.filtros} modelo={modelo} aoMudar={mudarFiltros} {...(atrasoBusca === undefined ? {} : { atrasoBusca })} />
        {modelo !== null ? (
          <div className="bd-resumo">
            <Progresso progresso={modelo.progresso} />
            <MenuLazy className="bd-menu bd-menu-dir" tituloAttr={explicarCusto(modelo.custo)} ariaLabel={`Custo total: ${formatarCusto(modelo.custo)}. ${LEGENDA_CUSTO}`} titulo={<><span className="bd-custo" data-desconhecido={modelo.custo.usd === null || undefined}>{formatarCusto(modelo.custo)}</span> ▾</>}>
              <div className="bd-menu-painel bd-menu-largo" role="group" aria-label="Custo">
                {missaoDoCusto !== null ? <CustoMissaoPainel missionId={missaoDoCusto} /> : (
                  <ul className="bd-lista" aria-label="Custo por trabalho">
                    {modelo.trabalhos.length === 0 ? <li className="bd-nota">Sem trabalhos.</li> : modelo.trabalhos.map((t) => <li key={t.trabalho_id}><span>{t.titulo}</span><span className="bd-custo" data-desconhecido={t.custo.usd === null || undefined}>{formatarCusto(t.custo)}</span></li>)}
                    <li className="bd-nota">{LEGENDA_CUSTO}. Escolha uma Missão no filtro para ver a repartição, a previsão e o teto.</li>
                  </ul>
                )}
              </div>
            </MenuLazy>
          </div>
        ) : null}
      </div>
      {modelo !== null && atual !== null ? <Insights modelo={modelo} workspaceId={atual.id} /> : null}
      {est.erro !== null && modelo !== null ? <p role="alert" className="erro-caixa">{est.erro}</p> : null}
      {corpo}
      <p className="bd-oculto" role="status" aria-live="polite">{anuncio}</p>
      {delegando !== null ? <Delegar card={delegando} aoFechar={() => setDelegando(null)} aoDelegado={() => void store.recarregar()} /> : null}
    </section>
  );
}

export default function Tela() {
  return <TelaBoard />;
}
