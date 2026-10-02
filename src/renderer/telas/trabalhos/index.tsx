import { useEffect, useId, useMemo, useState } from "react";
import type { TipoTrabalho } from "../../../nucleo/metodo/tipos";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Pagina } from "../../componentes/Pagina";
import { storeExecucaoMetodo, type StoreExecucaoMetodo } from "../../estado/execucao-metodo";
import { storeMetodo, useMetodo, type StoreMetodo } from "../../estado/metodo";
import { GuardaMetodo } from "../metodo/Guarda";
import "../metodo/metodo.css";
import { Colunas } from "./Colunas";
import { Detalhe } from "./Detalhe";
import { Linha } from "./Linha";
import {
  ROTULO_ESTADO_PORTFOLIO, TIPOS_PORTFOLIO, filtrarTrabalhos, porAtividade, resumoPortfolio, type EstadoPortfolio, type FiltroPortfolio,
} from "./portfolio";
import { VISOES, gravarVisao, lerVisao, type Visao } from "./visao";
import "./trabalhos.css";

const FAIXA: readonly EstadoPortfolio[] = ["andamento", "aguardando", "entregue", "bloqueado"];
const SEM_FILTRO: FiltroPortfolio = { estado: "todos", tipo: "todos", busca: "" };

export default function Tela({ store = storeMetodo, execucao = storeExecucaoMetodo }: { store?: StoreMetodo; execucao?: StoreExecucaoMetodo }) {
  const { workspaceId, indice, carregado, erro } = useMetodo(store);
  const [visao, setVisao] = useState<Visao>(lerVisao);
  const [filtro, setFiltro] = useState<FiltroPortfolio>(SEM_FILTRO);
  const [aberto, setAberto] = useState<string | null>(null);
  const idBusca = useId();
  useEffect(() => store.iniciar(), [store]);

  const trabalhos = indice?.trabalhos;
  const resumo = useMemo(() => resumoPortfolio(trabalhos ?? []), [trabalhos]);
  const visiveis = useMemo(() => (trabalhos === undefined ? [] : filtrarTrabalhos(trabalhos, filtro).sort(porAtividade)), [trabalhos, filtro]);
  // relógio do "há 3 h": lido uma vez por renderização do índice (sem timer: a lista não precisa piscar)
  const agora = useMemo(() => Date.now(), [trabalhos]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtitulo = "Portfólio dos trabalhos do método Expx neste projeto.";
  const guarda = GuardaMetodo({ workspaceId, carregado, erro, aoQue: "os trabalhos" });
  if (guarda !== null || !workspaceId) return <Pagina modo="painel" largura="total" titulo="Trabalhos" subtitulo={subtitulo}>{guarda}</Pagina>;

  const escolherVisao = (v: Visao): void => { setVisao(v); gravarVisao(v); };
  const novoPedido = (): void => execucao.abrirComGesto(filtro.tipo === "todos" ? "nova_feature" : (TIPOS_PORTFOLIO.find((t) => t.id === filtro.tipo)?.gesto ?? "nova_feature"));
  const filtrando = filtro.estado !== "todos" || filtro.tipo !== "todos" || filtro.busca.trim() !== "";
  const detalhe = trabalhos?.find((t) => t.id === aberto) ?? null;

  if (!indice || indice.trabalhos.length === 0) {
    return (
      <Pagina modo="painel" largura="total" titulo="Trabalhos" subtitulo={subtitulo}>
        <EstadoVazio icone="trabalhos" titulo="Nenhum trabalho ainda" texto="Faça um pedido no Método: cada feature, bug ou projeto que o agente começar aparece aqui, com o plano e o progresso.">
          <button type="button" className="met-botao met-botao-primario" onClick={novoPedido}>Fazer um pedido no Método</button>
        </EstadoVazio>
      </Pagina>
    );
  }

  return (
    <Pagina modo="painel" largura="total" titulo="Trabalhos" subtitulo={subtitulo}>
      <div className="trab" data-visao={visao}>
        <section className="trab-resumo" aria-label="Resumo dos trabalhos">
          <p className="trab-total"><b>{resumo.total}</b><span>{resumo.total === 1 ? "trabalho" : "trabalhos"}</span></p>
          {FAIXA.map((e) => (
            <button
              key={e} type="button" className="trab-medida" data-estado={e} aria-pressed={filtro.estado === e}
              aria-label={`${ROTULO_ESTADO_PORTFOLIO[e]}: ${resumo[e]}`}
              onClick={() => setFiltro((f) => ({ ...f, estado: f.estado === e ? "todos" : e }))}
            >
              <b>{resumo[e]}</b><span>{ROTULO_ESTADO_PORTFOLIO[e]}</span>
            </button>
          ))}
          {resumo.nao_iniciado > 0 ? (
            <button type="button" className="trab-medida" data-estado="nao_iniciado" aria-pressed={filtro.estado === "nao_iniciado"} aria-label={`${ROTULO_ESTADO_PORTFOLIO.nao_iniciado}: ${resumo.nao_iniciado}`} onClick={() => setFiltro((f) => ({ ...f, estado: f.estado === "nao_iniciado" ? "todos" : "nao_iniciado" }))}>
              <b>{resumo.nao_iniciado}</b><span>{ROTULO_ESTADO_PORTFOLIO.nao_iniciado}</span>
            </button>
          ) : null}
          <button type="button" className="met-botao met-botao-primario trab-novo" onClick={novoPedido}>Novo pedido</button>
        </section>

        <div className="trab-barra-filtros" role="search" aria-label="Filtros dos trabalhos">
          <input id={idBusca} type="search" className="trab-busca" aria-label="Buscar trabalho" placeholder="Buscar por título ou id" value={filtro.busca} onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))} />
          <label className="trab-filtro">Estado
            <select value={filtro.estado} onChange={(e) => setFiltro((f) => ({ ...f, estado: e.target.value as FiltroPortfolio["estado"] }))}>
              <option value="todos">Todos</option>
              {(Object.keys(ROTULO_ESTADO_PORTFOLIO) as EstadoPortfolio[]).map((e) => <option key={e} value={e}>{ROTULO_ESTADO_PORTFOLIO[e]}</option>)}
            </select>
          </label>
          <label className="trab-filtro">Tipo
            <select value={filtro.tipo} onChange={(e) => setFiltro((f) => ({ ...f, tipo: e.target.value as TipoTrabalho | "todos" }))}>
              <option value="todos">Todos</option>
              {TIPOS_PORTFOLIO.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </select>
          </label>
          <span className="met-suave trab-contador" role="status">{filtrando ? `${visiveis.length} de ${resumo.total}` : `${resumo.total}`} {resumo.total === 1 ? "trabalho" : "trabalhos"}</span>
          <div className="trab-visoes" role="group" aria-label="Visualização">
            {VISOES.map((v) => <button key={v.id} type="button" aria-pressed={visao === v.id} onClick={() => escolherVisao(v.id)}>{v.rotulo}</button>)}
          </div>
        </div>

        <div className="trab-area">
          {visiveis.length === 0 ? (
            <EstadoVazio icone="busca" titulo="Nenhum trabalho com esses filtros" texto="Troque o estado, o tipo ou a busca para ver os demais.">
              <button type="button" className="met-botao" onClick={() => setFiltro(SEM_FILTRO)}>Limpar filtros</button>
            </EstadoVazio>
          ) : visao === "colunas" ? (
            <Colunas trabalhos={visiveis} aberto={aberto} aoAbrir={setAberto} agora={agora} />
          ) : (
            <Linha trabalhos={visiveis} aberto={aberto} aoAbrir={setAberto} agora={agora} />
          )}
          {detalhe !== null ? <Detalhe workspaceId={workspaceId} trabalho={detalhe} aoVoltar={() => setAberto(null)} /> : null}
        </div>
      </div>
    </Pagina>
  );
}
