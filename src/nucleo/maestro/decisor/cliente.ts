// T-16.08 · Decisor de intenção (JEV direto ou OpenRouter) sobre uma PORTA `ask` (o `DeciderClient`/`Decisor.ask` da Fase 9 satisfaz).
// DESLIGADO por padrão: sem `habilitado` E sem `consentimento_em` o cliente nem é instanciado (`criarAsk` só roda depois do portão)
// e nada sai da máquina. Só o RESUMO redigido (≤ 500) é enviado. Resposta validada; erro/timeout/inválido ⇒ `null` (a regra segue).
// Nunca lança, nunca escolhe conta nem troca (D-53). A chave vive no cofre e é lida pela implementação da porta, nunca aqui.
import type { Intencao } from "../../../compartilhado/maestro";
import { resumirParaDecisor, hashResumo } from "../../harness/decisor/resumo";
import { OPCOES_DO_DECISOR, PROMPT_DECISOR_INTENCAO } from "./prompt";

export interface ConfigDecisorMaestro {
  habilitado: boolean;
  fonte: "jev_direto" | "openrouter" | null;
  /** ISO do consentimento; `null` = nunca consentiu. */
  consentimento_em: string | null;
  usar_no_hook: boolean;
  confianca_minima: number;
  timeout_ms: number;
  modelo: string | null;
  endpoint_host: string | null;
}
export const CONFIG_DECISOR_PADRAO: ConfigDecisorMaestro = { habilitado: false, fonte: null, consentimento_em: null, usar_no_hook: false, confianca_minima: 0.6, timeout_ms: 2000, modelo: null, endpoint_host: null };

export interface PedidoAsk {
  kind: "choice";
  purpose: "intent";
  /** já redigido: é tudo o que sai da máquina. */
  question: string;
  options: Array<{ id: string; description: string }>;
  /** instrução fixa (prompt versionado). */
  instruction: string;
}
export interface RespostaAsk {
  probs: Record<string, number>;
  choice: string;
  confidence: number;
  latency_ms: number | null;
  cost_usd: number | null;
  raw_model?: string | null;
}
export interface PortaAsk {
  ask(p: PedidoAsk): Promise<RespostaAsk>;
}

export type MotivoSemDecisao = "desabilitado" | "sem_consentimento" | "uso_no_hook_desligado" | "sem_fonte" | "erro" | "timeout" | "resposta_invalida";
export interface DecisaoDoDecisor {
  intencao: Intencao;
  confianca: number;
  latencia_ms: number | null;
  custo_usd: number | null;
  modelo: string | null;
  endpoint_host: string | null;
  tipo: "jev" | "openrouter";
  /** o que saiu da máquina (já redigido) e o hash dele. */
  resumo_enviado: string;
  resumo_hash: string;
}
export type ResultadoConsulta = { ok: true; decisao: DecisaoDoDecisor } | { ok: false; motivo: MotivoSemDecisao; tentado: boolean };

export interface DepsDecisorDeIntencao {
  config(): ConfigDecisorMaestro;
  /** fábrica LAZY do cliente: só é chamada depois do portão (desligado ⇒ zero instâncias). */
  criarAsk(config: ConfigDecisorMaestro): PortaAsk;
  scrub?: (t: string) => string;
}

const IDS = new Set<string>(OPCOES_DO_DECISOR.map((o) => o.id));
const SOMA_MIN = 0.99;
const SOMA_MAX = 1.01;

/** Valida a resposta: ids ⊂ opções, probabilidades em [0,1] somando ~1, escolha ∈ opções, confiança em [0,1]. */
export function validarResposta(r: unknown): RespostaAsk | null {
  if (typeof r !== "object" || r === null) return null;
  const o = r as Partial<RespostaAsk>;
  if (typeof o.choice !== "string" || !IDS.has(o.choice)) return null;
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) return null;
  if (typeof o.probs !== "object" || o.probs === null) return null;
  let soma = 0;
  for (const [id, p] of Object.entries(o.probs)) {
    if (!IDS.has(id) || typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return null;
    soma += p;
  }
  if (soma < SOMA_MIN || soma > SOMA_MAX) return null;
  return { probs: o.probs, choice: o.choice, confidence: o.confidence, latency_ms: typeof o.latency_ms === "number" ? o.latency_ms : null, cost_usd: typeof o.cost_usd === "number" ? o.cost_usd : null, raw_model: typeof o.raw_model === "string" ? o.raw_model : null };
}

const esperar = (ms: number): Promise<"timeout"> => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms).unref?.());

export interface DecisorDeIntencao {
  /** `via: "hook"` só consulta com `usar_no_hook`. Nunca lança. */
  consultar(texto: string, via: string): Promise<ResultadoConsulta>;
  /** Estado para a UI (sem segredo). */
  habilitadoEfetivo(): boolean;
}

export function criarDecisorDeIntencao(deps: DepsDecisorDeIntencao): DecisorDeIntencao {
  let ask: PortaAsk | null = null;
  const portao = (via: string): MotivoSemDecisao | null => {
    const c = deps.config();
    if (!c.habilitado) return "desabilitado";
    if (c.consentimento_em === null) return "sem_consentimento";
    if (c.fonte === null) return "sem_fonte";
    if (via === "hook" && !c.usar_no_hook) return "uso_no_hook_desligado";
    return null;
  };
  return {
    habilitadoEfetivo: () => portao("api") === null,
    async consultar(texto, via) {
      const bloqueio = portao(via);
      if (bloqueio !== null) return { ok: false, motivo: bloqueio, tentado: false };
      const c = deps.config();
      const resumo = resumirParaDecisor(typeof texto === "string" ? texto : "", deps.scrub === undefined ? {} : { scrub: deps.scrub });
      if (resumo === "") return { ok: false, motivo: "resposta_invalida", tentado: false };
      try {
        ask ??= deps.criarAsk(c);
        const pedido: PedidoAsk = { kind: "choice", purpose: "intent", question: resumo, options: OPCOES_DO_DECISOR.map((o) => ({ ...o })), instruction: PROMPT_DECISOR_INTENCAO };
        const inicio = Date.now();
        const corrida = await Promise.race([ask.ask(pedido), esperar(Math.min(Math.max(c.timeout_ms, 200), 10_000))]);
        if (corrida === "timeout") return { ok: false, motivo: "timeout", tentado: true };
        const v = validarResposta(corrida);
        if (v === null) return { ok: false, motivo: "resposta_invalida", tentado: true };
        return {
          ok: true,
          decisao: {
            intencao: v.choice as Intencao,
            confianca: v.confidence,
            latencia_ms: v.latency_ms ?? Date.now() - inicio,
            custo_usd: v.cost_usd,
            modelo: c.modelo,
            endpoint_host: c.endpoint_host,
            tipo: c.fonte === "openrouter" ? "openrouter" : "jev",
            resumo_enviado: resumo,
            resumo_hash: hashResumo(resumo),
          },
        };
      } catch {
        return { ok: false, motivo: "erro", tentado: true };
      }
    },
  };
}
