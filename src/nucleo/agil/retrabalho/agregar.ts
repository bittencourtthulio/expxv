// T-18.22: agregação do índice de retrabalho (D-184). ir = retrabalho / avaliáveis; ir_max = ir + tasks `primeira` com evento pendente forte.
// Denominador EXCLUI em_observacao e indeterminado (que aparecem em contador próprio). Atribuição ao AUTOR ORIGINAL (membro/agente do fato).
import type { ResumoRetrabalho, SituacaoRetrabalho } from "../../../compartilhado/agil";
import { arredondar } from "../util";

export interface LinhaRetrabalho {
  chave: string;
  situacao: SituacaoRetrabalho | null;
  eventos_pendentes: number;
  pontos: number | null;
  categoria: string | null;
  sprint_id: string | null;
  membro_id: string | null;
  agente: string | null;
  squad_id: string | null;
  retrabalho_ms: number | null;
}

export function resumirRetrabalho(linhas: readonly LinhaRetrabalho[], escopoEventos = 0): ResumoRetrabalho {
  let primeira = 0; let retrabalho = 0; let obs = 0; let indet = 0; let pend = 0;
  let pontosRe = 0; let temPontosRe = false; let ms = 0; let temMs = false;
  for (const l of linhas) {
    if (l.situacao === "primeira") { primeira++; if (l.eventos_pendentes > 0) pend++; }
    else if (l.situacao === "retrabalho") {
      retrabalho++;
      if (l.pontos !== null) { pontosRe += l.pontos; temPontosRe = true; }
      if (l.retrabalho_ms !== null) { ms += l.retrabalho_ms; temMs = true; }
    } else if (l.situacao === "em_observacao") obs++;
    else if (l.situacao === "indeterminado") indet++;
  }
  const aval = primeira + retrabalho;
  return {
    ir: aval ? arredondar(retrabalho / aval) : null,
    ir_max: aval ? arredondar((retrabalho + pend) / aval) : null,
    first_time_right: aval ? arredondar(1 - retrabalho / aval) : null,
    avaliaveis: aval, em_observacao: obs, indeterminado: indet, escopo_eventos: escopoEventos,
    pontos_retrabalhados: temPontosRe ? pontosRe : retrabalho > 0 ? null : 0,
    horas_obs_retrabalho_min: temMs ? arredondar(ms / 3_600_000, 3) : null,
  };
}

export type DimensaoRetrabalho = "sprint_id" | "categoria" | "membro_id" | "agente" | "squad_id";
export function agruparRetrabalho(linhas: readonly LinhaRetrabalho[], dim: DimensaoRetrabalho): { chave: string; resumo: ResumoRetrabalho }[] {
  const g = new Map<string, LinhaRetrabalho[]>();
  for (const l of linhas) {
    const k = l[dim] ?? "sem_dono";
    (g.get(k) ?? g.set(k, []).get(k))?.push(l);
  }
  return [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([chave, ls]) => ({ chave, resumo: resumirRetrabalho(ls) }));
}
