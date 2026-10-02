import type { AccountUsage, AlertaLimite, AmostraLimite, EficienciaSemana, PrevisaoZerar } from "../../../compartilhado/limites";
import { MAX_SEMANAS_EFICIENCIA } from "../../../compartilhado/limites";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { useCarga } from "../../estado/carga";
import { nomeJanela, textoPrevisao, formatarPct } from "../../estado/limites-formato";
import { pedirTela } from "../../estado/navegacao";
import { Barras } from "./graficos/Barras";
import { Linha } from "./graficos/Linha";
import type { ApiLimitesLike } from "./tipos";

/** Meta semanal padrão (P-102); a tela só a exibe. A leitura de `config` fica para quando o main expuser a chave (ver pedidos). */
export const META_PADRAO_PCT = 90;
export const SEMANAS_PADRAO = 8;

export const textoAlerta = (a: AlertaLimite): string => a.texto || ({ consumo_alto: "Consumo alto", vai_estourar: "Vai estourar antes de resetar", cota_sobrando: "Cota sobrando", sem_dado: "Sem dado" })[a.tipo];

function Previsoes({ conta, rotulo, api }: { conta: AccountUsage; rotulo: string; api: ApiLimitesLike | undefined }) {
  const { estado, dados } = useCarga<PrevisaoZerar[]>(api?.previsao === undefined ? undefined : () => api.previsao!(conta.account_id), `${conta.account_id}|${conta.fetched_at}`);
  const linhas = dados ?? [];
  const hist = useCarga<AmostraLimite[]>(api?.historico === undefined ? undefined : () => {
    const ate = new Date();
    return api.historico!({ conta_id: conta.account_id, janela: "five_hour", desde: new Date(ate.getTime() - 24 * 3_600_000).toISOString(), ate: ate.toISOString(), max_pontos: 300 });
  }, `h|${conta.account_id}|${conta.fetched_at}`);
  const pontos = (hist.dados ?? []).map((a) => ({ x: Date.parse(a.ts), y: a.usado_pct }));
  const p5 = linhas.find((p) => p.janela === "five_hour");
  const ultimo = pontos[pontos.length - 1];
  const projecao = ultimo !== undefined && p5 !== undefined && p5.confianca !== "insuficiente" && p5.ritmo_pct_por_hora !== null
    ? [ultimo, { x: p5.zera_em !== null ? Date.parse(p5.zera_em) : ultimo.x + 3_600_000 * 2, y: p5.zera_em !== null ? 100 : Math.min(100, ultimo.y + p5.ritmo_pct_por_hora * 2) }]
    : [];
  return (
    <li className="consumo-secao" aria-label={`Previsão de ${rotulo}`}>
      <strong>{rotulo}</strong>
      {estado === "indisponivel" ? <p className="consumo-nota">Previsão indisponível neste build.</p>
        : estado === "carregando" && dados === null ? <p className="consumo-nota" aria-busy="true">Calculando…</p>
        : estado === "erro" ? <p role="alert" className="erro-caixa">Não foi possível calcular a previsão.</p>
        : linhas.length === 0 ? <p className="consumo-nota">Sem janelas para prever.</p>
        : linhas.map((p) => (
          <div key={p.janela} className="consumo-alerta"><span>{nomeJanela(p.janela)}: {formatarPct(p.atual_pct)} · {textoPrevisao(p)}</span><span className="consumo-nota">confiança {p.confianca}</span></div>
        ))}
      {pontos.length > 0 ? <Linha rotulo={`Uso de 5 horas de ${rotulo}, últimas 24 h`} series={[{ id: "hist", rotulo: "medido", traco: "", pontos }, ...(projecao.length === 2 ? [{ id: "prev", rotulo: "projeção", traco: "4 3", pontos: projecao, previsao: true }] : [])]} /> : null}
    </li>
  );
}

export function PrevisaoEficiencia({ contas, rotulos, api, alertas, alertasEstado }: {
  contas: readonly AccountUsage[]; rotulos: Readonly<Record<string, string>>; api: ApiLimitesLike | undefined; alertas: readonly AlertaLimite[]; alertasEstado: "ok" | "indisponivel" | "carregando" | "erro";
}) {
  const ef = useCarga<EficienciaSemana[]>(api?.eficiencia === undefined ? undefined : () => api.eficiencia!(Math.min(SEMANAS_PADRAO, MAX_SEMANAS_EFICIENCIA)), "ef");
  const semanas = [...new Set((ef.dados ?? []).map((e) => e.semana_inicio))].sort();
  const barras = semanas.map((s) => {
    const dessa = (ef.dados ?? []).filter((e) => e.semana_inicio === s);
    const pico = Math.max(...dessa.map((e) => e.pico_pct));
    const cedo = dessa.some((e) => e.estouro_precoce);
    return { id: s, rotulo: new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor: pico, destaque: cedo || dessa.some((e) => e.estourou), ...(cedo ? { selo: "cedo" } : {}) };
  });
  return (
    <div className="consumo-secao">
      <h2>Alertas</h2>
      {alertasEstado === "indisponivel" ? <p className="consumo-nota">Alertas indisponíveis neste build.</p>
        : alertas.length === 0 ? <p className="consumo-nota">Nenhum alerta no momento.</p>
        : <ul className="consumo-lista" aria-label="Alertas de consumo">{alertas.map((a) => (
          <li key={`${a.tipo}:${a.conta_id}`} className="consumo-alerta">
            <span className="consumo-selo" data-tom={a.tipo === "vai_estourar" ? "alerta" : a.tipo === "consumo_alto" ? "aviso" : undefined}>{a.tipo.replace("_", " ")}</span>
            <span>{rotulos[a.conta_id] ?? a.conta_id}: {textoAlerta(a)}</span>
            <button type="button" className="botao-mini" onClick={() => pedirTela(a.tipo === "sem_dado" ? "provedores" : "harness")}>{a.tipo === "sem_dado" ? "Ver provedores" : "Abrir Harness"}</button>
          </li>))}</ul>}
      <h2>Previsão por conta</h2>
      {contas.length === 0 ? <EstadoVazio icone="consumo" titulo="Nenhuma conta" texto="Sem contas, não há o que prever." /> : <ul className="consumo-lista" aria-label="Previsão por conta">{contas.map((c) => <Previsoes key={c.account_id} conta={c} rotulo={rotulos[c.account_id] ?? c.account_id} api={api} />)}</ul>}
      <h2>Eficiência semanal</h2>
      <p className="consumo-nota">Pico semanal por semana; a linha tracejada é a meta de {META_PADRAO_PCT}%. "cedo" = estourou antes do fim da semana.</p>
      {ef.estado === "indisponivel" ? <p className="consumo-nota">Eficiência indisponível neste build.</p>
        : ef.estado === "erro" ? <p role="alert" className="erro-caixa">Não foi possível ler a eficiência.</p>
        : barras.length === 0 ? <p className="consumo-nota">{ef.estado === "carregando" ? "Carregando…" : "Dados insuficientes: a eficiência aparece depois de algumas semanas de uso medido."}</p>
        : <Barras barras={barras} meta={META_PADRAO_PCT} rotulo="Pico semanal de uso" />}
    </div>
  );
}
