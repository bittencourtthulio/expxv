// T-18.16: estimador por IA (camada 3 do D-185). FORA do caminho crítico: a UI sempre mostra a heurística na hora; isto roda em job.
// Consentimento explícito (texto das tasks vai ao provedor da CLI do usuário), teto diário, lote <= 20, sem ferramentas, 1 retentativa, depois fica a heurística.
import type { ConfigAgil, EscalaAgil } from "../../../compartilhado/agil";
import type { PortasAgil } from "../portas";
import type { BancoAgil } from "../repos";
import { diaDe, isoDe, type Relogio } from "../util";
import { escalaDe } from "./escala";
import { validarSaida, type SaidaIa } from "./esquema";
import type { EntradaEstimativa } from "./heuristica";
import { montarPrompt } from "./prompt";

export const TIMEOUT_LOTE_MS = 90_000;

export interface DepsIa { banco: BancoAgil; portas: Pick<PortasAgil, "headless" | "perfil" | "consentimento">; relogio: Relogio; config: ConfigAgil; timeoutMs?: number }
export type MotivoSemIa = "modo" | "sem_consentimento" | "sem_perfil" | "teto_diario" | "falha_cli" | "saida_invalida";
export interface ResultadoIa {
  sugestoes: Map<string, SaidaIa & { confianca_final: number }>;
  /** refs que ficaram só com a heurística, com o motivo. */
  fallback: Map<string, MotivoSemIa>;
  chamadas: number;
  tokens: number | null;
}

export interface EvidenciaQualidade { tem_criterio: boolean; similares: number; n_calibracao: number }
/** confiança final = confiança do LLM × qualidade da evidência (critério, similares, amostras da calibração). */
export const qualidadeEvidencia = (e: EvidenciaQualidade): number => Math.min(1, 0.4 + (e.tem_criterio ? 0.25 : 0) + 0.2 * Math.min(1, e.similares / 3) + 0.15 * Math.min(1, e.n_calibracao / 5));

const comTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); })]); } finally { if (t) clearTimeout(t); }
};

export function chamadasHoje(banco: BancoAgil, ws: string, relogio: Relogio): number { return banco.chamadasIa.get(`${ws}|${diaDe(isoDe(relogio()))}`) ?? 0; }

export async function estimarComIa(deps: DepsIa, ws: string, lote: readonly EntradaEstimativa[], evidencia: (ref: string) => EvidenciaQualidade): Promise<ResultadoIa> {
  const { banco, config, relogio } = deps;
  const r: ResultadoIa = { sugestoes: new Map(), fallback: new Map(), chamadas: 0, tokens: null };
  const falhar = (refs: readonly string[], m: MotivoSemIa): void => refs.forEach((x) => { if (!r.sugestoes.has(x)) r.fallback.set(x, m); });
  const todas = lote.map((e) => e.ref);
  if (config.estimativa_modo !== "ia_sugere") { falhar(todas, "modo"); return r; }
  if (!(await deps.portas.consentimento.estimativaPorIa(ws))) { falhar(todas, "sem_consentimento"); return r; }
  const perfil = await deps.portas.perfil.resolver(ws, "agil", "estimativa");
  if (!perfil) { falhar(todas, "sem_perfil"); return r; }
  const escala: EscalaAgil = escalaDe(config);
  const tamanho = Math.max(1, Math.min(20, config.estimativa_lote));
  const chaveDia = `${ws}|${diaDe(isoDe(relogio()))}`;
  const timeout = deps.timeoutMs ?? TIMEOUT_LOTE_MS;

  for (let i = 0; i < lote.length; i += tamanho) {
    const parte = lote.slice(i, i + tamanho);
    const refs = parte.map((e) => e.ref);
    let prompt = montarPrompt(parte, escala, config.categorias);
    let ok = false;
    let motivo: MotivoSemIa = "saida_invalida";
    for (let tentativa = 0; tentativa < 2 && !ok; tentativa++) {
      if ((banco.chamadasIa.get(chaveDia) ?? 0) >= config.estimativa_max_chamadas_dia) { motivo = "teto_diario"; break; }
      banco.chamadasIa.set(chaveDia, (banco.chamadasIa.get(chaveDia) ?? 0) + 1);
      r.chamadas++;
      let texto: string;
      try {
        const saida = await comTimeout(deps.portas.headless.executar({ perfil, entrada: prompt, tools: [], timeoutMs: timeout }), timeout);
        texto = saida.texto;
        if (saida.tokens !== null) r.tokens = (r.tokens ?? 0) + saida.tokens;
      } catch { motivo = "falha_cli"; break; }
      const v = validarSaida(texto, refs, escala, config.categorias);
      if (v.ok) {
        for (const s of v.itens) r.sugestoes.set(s.ref, { ...s, confianca_final: Math.round(s.confianca * qualidadeEvidencia(evidencia(s.ref)) * 100) / 100 });
        ok = true;
      } else if (tentativa === 0) {
        prompt = `${prompt}\nSua resposta anterior foi recusada: ${v.erro}. Responda apenas com o array JSON válido.`;
      }
    }
    falhar(refs, motivo);
  }
  return r;
}

/** inicia o job e devolve NA HORA (a UI nunca espera o LLM); `concluido` resolve quando termina. */
export function iniciarJobEstimativa<T>(trabalho: () => Promise<T>): { job_id: string; concluido: Promise<T> } {
  const job_id = `job_${Math.random().toString(36).slice(2, 10)}`;
  return { job_id, concluido: Promise.resolve().then(trabalho) };
}
