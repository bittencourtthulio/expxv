// Resumos (T-20.13): diário e de sprint. PURO: recebe números já agregados (metricas/agil) e devolve a entrada de alerta.
// Dia sem atividade NÃO envia resumo vazio: vira "Nada hoje" só no Centro (`somente_app`). `sem fonte` aparece como tal.
import type { EntradaAlerta } from "../../compartilhado/alertas";
import { duracao } from "./templates";
import { truncarVisivel } from "./texto";

export interface LinhaTarefa {
  task_id: string;
  titulo: string;
  /** só para atrasadas: quanto passou do estimado (ms). */
  atraso_ms?: number | null;
}
export interface DadosDia {
  /** `AAAA-MM-DD` local. */
  dia: string;
  workspace_id?: string | null;
  concluidas: Array<{ pontos: number | null; tempo_trabalho_ms: number | null; tokens: number | null }>;
  em_andamento: number;
  atrasadas: LinhaTarefa[];
  bloqueadas: number;
  prs_abertos: number | null;
}

export const formatarData = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m === null ? iso : `${m[3]}/${m[2]}/${m[1]}`;
};

const soma = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0);
};

export function linhaAtrasada(l: LinhaTarefa): string {
  const atraso = typeof l.atraso_ms === "number" ? ` — +${duracao(l.atraso_ms)}` : "";
  return `${l.task_id} ${truncarVisivel(l.titulo, 40)}${atraso}`;
}

export interface ResumoMontado {
  /** `false` => só Centro (`somente_app`). */
  externo: boolean;
  alerta: EntradaAlerta;
}

export function montarResumoDiario(d: DadosDia): ResumoMontado {
  const ativo = d.concluidas.length + d.em_andamento + d.atrasadas.length + d.bloqueadas;
  const base: Pick<EntradaAlerta, "tipo" | "workspace_id" | "entidade_tipo" | "entidade_id" | "estado"> = { tipo: "resumo_diario", workspace_id: d.workspace_id ?? null, entidade_tipo: "dia", entidade_id: d.dia, estado: "resumo" };
  if (ativo === 0) {
    return { externo: false, alerta: { ...base, titulo: `Nada hoje (${formatarData(d.dia)})`, dados: { data: formatarData(d.dia), somente_app: true } } };
  }
  const tempo = soma(d.concluidas.map((c) => c.tempo_trabalho_ms));
  const tokens = soma(d.concluidas.map((c) => c.tokens));
  const pontos = soma(d.concluidas.map((c) => c.pontos)) ?? 0;
  const lista = d.atrasadas.slice(0, 5).map(linhaAtrasada).join("\n");
  const extra = d.atrasadas.length > 5 ? `\n… e mais ${d.atrasadas.length - 5}` : "";
  return {
    externo: true,
    alerta: {
      ...base,
      titulo: `Resumo do dia ${formatarData(d.dia)}`,
      dados: {
        data: formatarData(d.dia),
        concluidas_n: d.concluidas.length,
        pontos_concluidos: pontos,
        tempo_trabalho_ms: tempo,
        tokens,
        em_andamento_n: d.em_andamento,
        atrasadas_n: d.atrasadas.length,
        bloqueadas_n: d.bloqueadas,
        prs_n: d.prs_abertos,
        lista_atrasadas: lista === "" ? null : `${lista}${extra}`,
      },
    },
  };
}

export interface DadosSprint {
  sprint_id: string;
  nome: string;
  workspace_id?: string | null;
  entregues_pts: number;
  comprometido_pts: number | null;
  velocidade: number | null;
  /** 0..100 */
  retrabalho_pct: number | null;
  atrasadas: number;
  tempo_trabalho_ms: number | null;
  tokens: number | null;
}

export function montarResumoSprint(s: DadosSprint): ResumoMontado {
  return {
    externo: true,
    alerta: {
      tipo: "resumo_sprint",
      workspace_id: s.workspace_id ?? null,
      entidade_tipo: "sprint",
      entidade_id: s.sprint_id,
      estado: "resumo",
      titulo: `Resumo da sprint ${truncarVisivel(s.nome, 60)}`,
      dados: {
        sprint_nome: s.nome,
        entregues_pts: s.entregues_pts,
        comprometido_pts: s.comprometido_pts,
        velocidade: s.velocidade,
        retrabalho: s.retrabalho_pct === null ? null : `${Math.round(s.retrabalho_pct)}%`,
        atrasadas_n: s.atrasadas,
        tempo_trabalho_ms: s.tempo_trabalho_ms,
        tokens: s.tokens,
      },
    },
  };
}
