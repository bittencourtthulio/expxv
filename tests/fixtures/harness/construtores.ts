// Construtores de dados para os testes do harness (Fase 9, onda 2-B). Só dados: nada de I/O além de ler o JSON versionado.
import { join } from "node:path";
import type { AccountUsage, JanelaKind } from "../../../src/compartilhado/limites";
import type { CandidataConta, EntradaEquivalencia, Faixa, OpcoesModelo, OpcoesPick } from "../../../src/compartilhado/harness";
import { lerEquivalenciaDeArquivo } from "../../../src/nucleo/harness/equivalencia-arquivo";
import type { OpcoesModeloExtras } from "../../../src/nucleo/harness/escolher-modelo";

export const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
export const H = 3_600_000;
/** ISO de "agora + horas" (negativo = passado). */
export const emH = (horas: number): string => new Date(AGORA + horas * H).toISOString();

export const ARQUIVO_EQUIVALENCIA = join(__dirname, "..", "..", "..", "resources", "harness", "equivalencia.json");
export const PADRAO: EntradaEquivalencia = lerEquivalenciaDeArquivo(ARQUIVO_EQUIVALENCIA).padrao;

/** [kind, used_pct|null, resets em horas | null] */
export type J = [JanelaKind, number | null, number | null];
export interface ExtraUso {
  fonte?: AccountUsage["fonte"];
  confianca?: AccountUsage["confianca"];
  status?: AccountUsage["status"];
  baldes?: Record<string, [number | null, number | null]>;
}
export function uso(id: string, provider: string, janelas: J[], x: ExtraUso = {}): AccountUsage {
  return {
    account_id: id,
    provider,
    fetched_at: emH(-0.01),
    fonte: x.fonte ?? "claude_statusline",
    confianca: x.confianca ?? "medido",
    status: x.status ?? "ok",
    windows: janelas.map(([kind, used, h]) => ({ kind, used_pct: used, resets_at: h === null ? null : emH(h) })),
    model_buckets: Object.fromEntries(Object.entries(x.baldes ?? {}).map(([m, [u, h]]) => [m, { used_pct: u, resets_at: h === null ? null : emH(h), kind: "weekly" as JanelaKind }])),
    bottleneck: null,
    slack_pct: null,
    idade_s: 0,
    vencidas: [],
  };
}

export interface ExtraConta extends ExtraUso {
  w?: J[];
  /** sem snapshot algum. */
  semUso?: boolean;
  hab?: boolean;
  auth?: CandidataConta["auth"];
  resMod?: string[];
  resPapeis?: CandidataConta["reservada_papeis"];
  fixadaEm?: string[];
  cooldownH?: number | string | null;
}
/** Conta candidata; por padrão com uma janela `five_hour` a 10% reiniciando em 4 h. */
export function conta(id: string, provedor: string, x: ExtraConta = {}): CandidataConta {
  const janelas = x.w ?? [["five_hour", 10, 4]];
  return {
    conta_id: id,
    provedor,
    habilitada: x.hab ?? true,
    auth: x.auth ?? "ok",
    reservada_modelos: x.resMod ?? [],
    reservada_papeis: x.resPapeis ?? [],
    fixada_em: x.fixadaEm ?? [],
    cooldown_ate: typeof x.cooldownH === "string" ? x.cooldownH : typeof x.cooldownH === "number" ? emH(x.cooldownH) : null,
    uso: x.semUso === true ? null : uso(id, provedor, janelas, x),
  };
}

export function opcoesConta(sobre: Partial<OpcoesPick> = {}): OpcoesPick {
  return {
    modelo: null,
    papel: "executor",
    workspace_id: "ws1",
    agora: AGORA,
    limiar_esgotamento_pct: 100,
    limiar_troca_pct: 85,
    estrategia: "expires_first",
    janela: "auto",
    conta_fixa_id: null,
    evitar_reservadas: true,
    excluir: [],
    ...sobre,
  };
}

export type OpcoesModeloTeste = OpcoesModelo & OpcoesModeloExtras;
export function opcoesModelo(sobre: Partial<OpcoesModeloTeste> = {}): OpcoesModeloTeste {
  return {
    papel: "executor",
    workspace_id: "ws1",
    agora: AGORA,
    limiar_esgotamento_pct: 100,
    limiar_troca_pct: 85,
    estrategia: "expires_first",
    janela: "auto",
    evitar_reservadas: true,
    atual: { provedor: "claude", conta_id: "c1", modelo: "opus", faixa: "topo" as Faixa },
    provedores_viaveis: ["claude", "codex", "gemini", "openrouter"],
    clis_openrouter: [],
    task_type: null,
    trocando: true,
    permitir_outro_provedor: true,
    faixa_minima: "mesma",
    margem_troca_pontos: 10,
    excluir_contas: [],
    conta_fixa_id: null,
    ...sobre,
  };
}

/** PRNG determinístico (mulberry32). */
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function embaralhar<T>(xs: readonly T[], r: () => number): T[] {
  const s = [...xs];
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [s[i], s[j]] = [s[j] as T, s[i] as T];
  }
  return s;
}
