// Histórico, previsão, eficiência e alertas de consumo no main (Fase 9, T-09.09): liga a lógica pura (`nucleo/limites/historico`) às tabelas `limite_amostra`/`limite_semana`
// (migration 0005) e aos 4 canais `limites:historico|previsao|eficiencia|alertas`. NADA roda sozinho: a gravação é um efeito de cada `atualizado` do serviço de limites (que só lê com
// foco/60 s), em lote numa transação, no máximo 1 gravação por série a cada 60 s. Sem rede, sem timer próprio.
import type { AccountUsage, AlertaLimite, EficienciaSemana, JanelaKind, PrevisaoZerar, RespostaLimites } from "../compartilhado/limites";
import type { RepoLimiteAmostra } from "../nucleo/banco/repos/limite-amostra";
import { RETENCAO_AMOSTRAS_DIAS } from "../nucleo/banco/repos/limite-amostra";
import { alertasDeLimite, amostrasDoUso, deveGravarAmostra, estouroPrecoce, META_SEMANAL_PADRAO_PCT, preverZerar, semanaInicioIso } from "../nucleo/limites/historico";
import type { HistoricoLimitesIpc } from "./ipc/limites";

const H = 3_600_000;
const DIA = 24 * H;
/** Quanto histórico a previsão lê por janela (cobre o ciclo inteiro + folga). */
const LEITURA_MS: Record<JanelaKind, number> = { five_hour: 6 * H, weekly: 8 * DIA, monthly: 32 * DIA, credit: 8 * DIA };
export const CONFIG_META_SEMANAL = "limites.meta_semanal_pct";

export interface DependenciasHistoricoLimites {
  repo: Pick<RepoLimiteAmostra, "gravarLote" | "ultima" | "consultar" | "podar" | "registrarSemana" | "listarSemanas">;
  /** só lê o cache do serviço de limites (nunca espera I/O). */
  snapshot(): RespostaLimites;
  /** rótulo das contas (para o texto dos alertas). */
  rotulos(): Readonly<Record<string, string>>;
  /** meta semanal configurada (0..100); ausente = 90 %. */
  metaSemanalPct?(): number | null;
  agora?: () => number;
  aviso?(mensagem: string): void;
}

export interface HistoricoLimitesMain extends HistoricoLimitesIpc {
  /** chamado a cada `atualizado` do serviço de limites: grava as amostras que mudaram e atualiza a eficiência semanal. Nunca lança. */
  registrar(): number;
}

export function criarHistoricoLimites(d: DependenciasHistoricoLimites): HistoricoLimitesMain {
  const agora = d.agora ?? (() => Date.now());
  const ultimaGravacao = new Map<string, number>();
  let ultimaPoda = 0;
  const desdeVisto = new Map<string, string>();

  const usoDaConta = (contaId: string): AccountUsage | null => d.snapshot().contas.find((c) => c.account_id === contaId) ?? null;
  const chave = (a: { conta_id: string; janela: string; balde: string }): string => `${a.conta_id}|${a.janela}|${a.balde}`;

  function registrar(): number {
    try {
      const t = agora();
      const resp = d.snapshot();
      const novas = resp.contas.flatMap((u) => amostrasDoUso(u, t)).filter((a) => {
        const k = chave(a);
        const ult = ultimaGravacao.get(k);
        if (ult !== undefined && t - ult < 60_000) return false; // no máximo 1 gravação por série a cada 60 s, sem nem ir ao banco
        const anterior = d.repo.ultima(a.conta_id, a.janela, a.balde);
        return deveGravarAmostra(anterior, a.usado_pct, t);
      });
      if (novas.length === 0) return 0;
      const n = d.repo.gravarLote(novas);
      for (const a of novas) ultimaGravacao.set(chave(a), t);
      const semana = semanaInicioIso(t);
      for (const a of novas) {
        if (a.janela !== "five_hour" && a.janela !== "weekly") continue;
        d.repo.registrarSemana({ semana_inicio: semana, conta_id: a.conta_id, janela: a.janela, pico_pct: a.usado_pct, estourou: a.usado_pct >= 100, estouro_precoce: estouroPrecoce(a.janela, a.usado_pct, a.reinicia_em, t), amostras: 1 });
      }
      if (t - ultimaPoda > DIA) {
        ultimaPoda = t;
        d.repo.podar(new Date(t - RETENCAO_AMOSTRAS_DIAS * DIA).toISOString());
      }
      return n;
    } catch (e) {
      d.aviso?.(`histórico de limites: ${e instanceof Error ? e.name : "erro"}`);
      return 0;
    }
  }

  function previsoesDe(uso: AccountUsage | null): PrevisaoZerar[] {
    if (uso === null) return [];
    const t = agora();
    const kinds = [...new Set(uso.windows.filter((j) => j.used_pct !== null).map((j) => j.kind))];
    return kinds.map((k) => {
      const desde = new Date(t - LEITURA_MS[k]).toISOString();
      const amostras = d.repo.consultar({ conta_id: uso.account_id, janela: k, desde, ate: new Date(t).toISOString(), max_pontos: 300 });
      return preverZerar(amostras, k, t);
    });
  }

  return {
    registrar,
    historico(p) {
      return d.repo.consultar({ conta_id: p.conta_id, janela: p.janela, ...(p.balde === undefined ? {} : { balde: p.balde }), desde: p.desde, ate: p.ate, max_pontos: p.max_pontos });
    },
    previsao(contaId) {
      return previsoesDe(usoDaConta(contaId));
    },
    eficiencia(semanas, contaId) {
      const meta = d.metaSemanalPct?.() ?? META_SEMANAL_PADRAO_PCT;
      const porChave = new Map<string, { semana_inicio: string; conta_id: string; semanal: number | null; cinco: number | null; estourou: boolean; precoce: boolean }>();
      for (const l of d.repo.listarSemanas(semanas, contaId)) {
        const k = `${l.semana_inicio}|${l.conta_id}`;
        const atual = porChave.get(k) ?? { semana_inicio: l.semana_inicio, conta_id: l.conta_id, semanal: null, cinco: null, estourou: false, precoce: false };
        if (l.janela === "weekly") atual.semanal = l.pico_pct;
        else atual.cinco = l.pico_pct;
        atual.estourou ||= l.estourou;
        atual.precoce ||= l.estouro_precoce;
        porChave.set(k, atual);
      }
      return [...porChave.values()].map((x): EficienciaSemana => {
        const pico = x.semanal ?? x.cinco ?? 0;
        return { semana_inicio: x.semana_inicio, conta_id: x.conta_id, pico_pct: pico, estourou: x.estourou, estouro_precoce: x.precoce, meta_atingida: pico >= meta && !x.precoce };
      });
    },
    alertas(): AlertaLimite[] {
      const t = agora();
      const contas = d.snapshot().contas.map((u) => ({ conta_id: u.account_id, uso: u, previsoes: previsoesDe(u) }));
      const vistos = new Set<string>();
      const lista = alertasDeLimite(contas, d.rotulos(), t, (k) => {
        vistos.add(k);
        const antes = desdeVisto.get(k);
        if (antes !== undefined) return antes;
        const novo = new Date(t).toISOString();
        desdeVisto.set(k, novo);
        return novo;
      });
      for (const k of [...desdeVisto.keys()]) if (!vistos.has(k)) desdeVisto.delete(k); // condição terminou: o próximo alerta nasce com `desde` novo
      return lista;
    },
  };
}
