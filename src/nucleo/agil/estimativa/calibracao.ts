// T-18.15: calibração SOMENTE LEITURA. `HISTORICO.md` (sprintx; horas `real`) e `duracao observada` (ms do rastro) são grandezas diferentes e NUNCA se somam.
import type { FatoTask } from "../../../compartilhado/agil";
import type { ErroEstimativaRegistro } from "../repos";
import { mediana } from "../util";

export interface EntradaHistorico { trabalho_id: string | null; task_id: string | null; tipo_task: string | null; real_h: number | null; estimado_media_h: number | null; desvio: number | null }
export interface HistoricoSprintx { entradas: EntradaHistorico[]; desvio_por_tipo: Record<string, { desvio: number; n: number }> }

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

/** `dados` = frontmatter do HISTORICO.md (kind estimativa_historico). Corrompido/ausente => vazio, nunca lança. */
export function lerHistoricoSprintx(dados: Record<string, unknown> | null | undefined): HistoricoSprintx {
  const vazio: HistoricoSprintx = { entradas: [], desvio_por_tipo: {} };
  try {
    const bruto = dados?.["entradas"];
    if (!Array.isArray(bruto)) return vazio;
    const entradas: EntradaHistorico[] = [];
    for (const x of bruto) {
      if (typeof x !== "object" || x === null) continue;
      const o = x as Record<string, unknown>;
      entradas.push({ trabalho_id: str(o["trabalho_id"]), task_id: str(o["task_id"]), tipo_task: str(o["tipo_task"]), real_h: num(o["real"]), estimado_media_h: num(o["estimado_media"]), desvio: num(o["desvio"]) });
    }
    const por = new Map<string, number[]>();
    for (const e of entradas) if (e.tipo_task && e.desvio !== null) (por.get(e.tipo_task) ?? por.set(e.tipo_task, []).get(e.tipo_task))?.push(e.desvio);
    const desvio_por_tipo: HistoricoSprintx["desvio_por_tipo"] = {};
    for (const [t, ds] of por) if (ds.length >= 3) desvio_por_tipo[t] = { desvio: ds.reduce((a, b) => a + b, 0) / ds.length, n: ds.length };
    return { entradas, desvio_por_tipo };
  } catch {
    return vazio;
  }
}

export interface RefMsPorPonto { ms_por_ponto: number | null; base: "categoria" | "workspace" | "sem_base"; n: number; texto: string }

/** mediana de `duracao_obs_ms / pontos` das tasks concluídas: da MESMA categoria (>= amostra mínima), senão do workspace, senão `null` ("sem base"). */
export function refMsPorPonto(amostras: readonly { categoria: string | null; pontos: number | null; duracao_obs_ms: number | null }[], categoria: string | null, minimo = 5): RefMsPorPonto {
  const validas = amostras.filter((a): a is { categoria: string | null; pontos: number; duracao_obs_ms: number } => a.pontos !== null && a.pontos > 0 && a.duracao_obs_ms !== null && a.duracao_obs_ms > 0);
  const cat = validas.filter((a) => a.categoria === categoria && categoria !== null).map((a) => a.duracao_obs_ms / a.pontos);
  if (cat.length >= minimo) return { ms_por_ponto: mediana(cat), base: "categoria", n: cat.length, texto: `mediana de ${cat.length} tasks da categoria` };
  const todas = validas.map((a) => a.duracao_obs_ms / a.pontos);
  if (todas.length >= minimo) return { ms_por_ponto: mediana(todas), base: "workspace", n: todas.length, texto: `mediana de ${todas.length} tasks do workspace` };
  return { ms_por_ponto: null, base: "sem_base", n: todas.length, texto: "sem base" };
}

/** horas observadas por ponto, só de tasks com `real` em horas e pontos (nunca mistura com duração de parede). */
export function horasPorPontoCalibrado(erros: readonly ErroEstimativaRegistro[], minimo = 5): number | null {
  const xs = erros.filter((e) => e.real_h !== null && e.pontos_previstos > 0).map((e) => (e.real_h as number) / e.pontos_previstos);
  return xs.length >= minimo ? mediana(xs) : null;
}

export const amostrasDeFatos = (fatos: readonly FatoTask[], pontosPor: (f: FatoTask) => { pontos: number | null; categoria: string | null }): { categoria: string | null; pontos: number | null; duracao_obs_ms: number | null }[] =>
  fatos.filter((f) => f.status_visto === "concluida").map((f) => ({ ...pontosPor(f), duracao_obs_ms: f.duracao_obs_ms }));
