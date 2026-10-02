import { useCallback, useMemo, useState } from "react";
import type { MetodoAgil } from "../../../compartilhado/agil";
import { Icone } from "../../componentes/Icone";
import { avisar } from "../../estado/avisos";
import type { CtxAgil } from "./contexto";
import { CartaoGrafico, useMedida } from "./graficos/CartaoGrafico";
import { graficosDoMetodo, montarGraficos, type DestinoAcao } from "./graficos/definicoes";
import { BlocoAtencao, FaixaIndicadores } from "./Indicadores";
import { textoDoErro } from "./logica";
import { calcularAtencao, calcularKpis, colunasParaLargura, planejarBento, type BlocoPlano } from "./painel-logica";

/** Esqueleto do painel: as mesmas formas da tela pronta, sem animação (quem carrega vê onde as coisas vão aparecer). */
export function EsqueletoPainel() {
  return (
    <div className="ag-painel ag-esqueleto" role="status" aria-busy="true">
      <span className="so-leitor">Carregando o painel…</span>
      <div className="ag-esq-faixa">{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div>
      <div className="ag-esq-bento"><span data-heroi /><span /><span /><span /><span /><span /></div>
    </div>
  );
}

/** Painel: faixa de indicadores-chave e malha bento de 12 colunas (herói + lateral + blocos), tudo a partir de `PainelAgil`. */
export function PainelGraficos({ ctx, metodo, carregando }: { ctx: CtxAgil; metodo: MetodoAgil | "todos"; carregando: boolean }) {
  const { painel } = ctx;
  const [aberto, setAberto] = useState<string | null>(null);
  const [ref, medida] = useMedida<HTMLDivElement>();
  const colunas = colunasParaLargura(medida?.w ?? 0);
  const todos = useMemo(() => (painel === null ? [] : montarGraficos(painel)), [painel]);
  const visiveis = useMemo(() => graficosDoMetodo(todos, metodo), [todos, metodo]);
  const kpis = useMemo(() => (painel === null ? [] : calcularKpis(painel)), [painel]);
  const atencao = useMemo(() => (painel === null ? [] : calcularAtencao(painel)), [painel]);
  const plano = useMemo(() => planejarBento([...visiveis.map((g) => ({ id: g.id, vazio: g.vazio !== null })), { id: "atencao", vazio: false }], colunas), [visiveis, colunas]);
  const acionar = useCallback((d: DestinoAcao): void => {
    if (d === "sincronizar") void ctx.api.sincronizar(ctx.ws, true).then(() => ctx.recarregar(), (e) => avisar(textoDoErro(e), "erro"));
    else ctx.irPara(d);
  }, [ctx]);
  if (painel === null) return <EsqueletoPainel />;
  if (painel.base.tasks === 0 && painel.base.itens === 0 && painel.base.sprints === 0) {
    return (
      <div className="ag-painel ag-painel-vazio">
        <div className="ag-esq-faixa" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div>
        <div className="ag-vazio-painel" role="status">
          <Icone nome="agil" className="ag-vazio-icone" />
          <h2>Ainda não há dados de gestão ágil</h2>
          <p>Sem rastro do método: rode a sprintx neste projeto e clique em sincronizar, ou crie itens direto no Backlog. Burndown, velocidade e previsão aparecem assim que houver a primeira sprint.</p>
          <div className="ag-acoes-linha">
            <button type="button" className="ag-btn" data-primario onClick={() => void ctx.api.sincronizar(ctx.ws, true).then(ctx.recarregar)}>Sincronizar agora</button>
            <button type="button" className="ag-btn" onClick={() => ctx.irPara("backlog")}>Ir para o Backlog</button>
          </div>
        </div>
      </div>
    );
  }
  const b = painel.base;
  const porId = new Map(visiveis.map((g) => [g.id, g]));
  const faixa = plano.filter((bl) => bl.papel === "heroi" || bl.papel === "lateral");
  const resto = plano.filter((bl) => bl.papel !== "heroi" && bl.papel !== "lateral");
  const renderizar = (bl: BlocoPlano): React.ReactNode => {
    if (bl.id === "atencao") return <BlocoAtencao key="atencao" grupos={atencao} aoIrBacklog={() => ctx.irPara("backlog")} estilo={{ "--sp": bl.span, "--ln": bl.linhas } as React.CSSProperties} />;
    const g = porId.get(bl.id);
    return g === undefined ? null : <CartaoGrafico key={g.id} g={g} plano={bl} expandido={aberto === g.id} aoExpandir={() => setAberto(aberto === g.id ? null : g.id)} aoAcionar={acionar} />;
  };
  return (
    <div className="ag-painel" aria-busy={carregando} data-carregando={carregando || undefined}>
      <p className="ag-resumo" role="status">
        {b.tasks} tasks · {b.itens} itens · {b.sprints} sprints · {b.sem_estimativa} sem estimativa · {b.sem_rastro} sem rastro
        {metodo !== "todos" && ` · mostrando ${visiveis.length} de ${todos.length} gráficos (${metodo.toUpperCase()})`}
      </p>
      <FaixaIndicadores kpis={kpis} />
      <div ref={ref} className="ag-malha" data-colunas={colunas}>
        {faixa.length > 0 && (
          <div className="ag-faixa-heroi">
            {faixa.filter((bl) => bl.papel === "heroi").map(renderizar)}
            <div className="ag-lateral-col">{faixa.filter((bl) => bl.papel === "lateral").map(renderizar)}</div>
          </div>
        )}
        <div className="ag-bento">{resto.map(renderizar)}</div>
      </div>
    </div>
  );
}
