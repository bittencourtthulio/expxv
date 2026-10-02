// Confirmação pendente (T-13.03): uso único, TTL curto, atrelada a `args_hash` e resolvida SÓ por gesto no app (`ui`/`desktop`). Memória apenas (nunca disco).
// O que executa é exatamente o que foi mostrado: o payload é congelado na criação e a execução recalcula o hash. Segunda resolução, expirada, de outra origem
// (voz, remoto, conteúdo externo) ou com id inventado = recusa. O armazém é atômico (resolver remove a entrada antes de devolver).
import { randomBytes } from "node:crypto";
import type { AcaoJarvis, AtorJarvis, CodigoRecusaJarvis, ConfirmacaoVisao } from "../../compartilhado/jarvis";
import { hashArgs } from "../alertas/texto";

export interface RelogioJarvis {
  agora(): number;
}
export type ResolvidoPor = "ui" | "desktop";
const RESOLVEDORES: readonly string[] = ["ui", "desktop"];

export interface ConfirmacaoPendente {
  id: string;
  ator: AtorJarvis;
  dispositivo_id: string | null;
  dispositivo_nome: string | null;
  acao: AcaoJarvis;
  resumo: string;
  args_hash: string;
  criada_em: number;
  expira_em: number;
  /** congelado; a execução usa ESTE objeto, nunca o que chegar depois. */
  payload: Readonly<Record<string, unknown>>;
}
export type ResultadoResolver =
  | { ok: true; aprovado: boolean; confirmacao: ConfirmacaoPendente }
  | { ok: false; codigo: Extract<CodigoRecusaJarvis, "confirmacao_expirada" | "confirmacao_invalida">; confirmacao?: ConfirmacaoPendente };

export interface ArmazemConfirmacoes {
  criar(c: { ator: AtorJarvis; dispositivo_id?: string | null; dispositivo_nome?: string | null; acao: AcaoJarvis; resumo: string; payload: Record<string, unknown>; ttl_ms?: number }): ConfirmacaoPendente;
  resolver(id: string, o: { aprovado: boolean; por: string }): ResultadoResolver;
  obter(id: string): ConfirmacaoPendente | null;
  listar(): ConfirmacaoPendente[];
  /** remove as vencidas e devolve-as (o chamador cancela o que estiver preso, ex.: plano proposto). */
  expirar(): ConfirmacaoPendente[];
  anularTodas(filtro?: (c: ConfirmacaoPendente) => boolean): ConfirmacaoPendente[];
  visao(c: ConfirmacaoPendente): ConfirmacaoVisao;
}

export interface OpcoesArmazem {
  relogio: RelogioJarvis;
  ttl_ms?: number;
  max?: number;
  novoId?: () => string;
}

function congelar<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    for (const x of Object.values(v)) congelar(x);
    Object.freeze(v);
  }
  return v;
}

export function criarArmazemConfirmacoes(op: OpcoesArmazem): ArmazemConfirmacoes {
  const ttl = op.ttl_ms ?? 30_000;
  const max = op.max ?? 10;
  const novoId = op.novoId ?? ((): string => `cnf_${randomBytes(12).toString("base64url")}`);
  const mapa = new Map<string, ConfirmacaoPendente>();

  const venceu = (c: ConfirmacaoPendente): boolean => op.relogio.agora() >= c.expira_em;
  function expirar(): ConfirmacaoPendente[] {
    const fora: ConfirmacaoPendente[] = [];
    for (const [id, c] of mapa) {
      if (venceu(c)) {
        mapa.delete(id);
        fora.push(c);
      }
    }
    return fora;
  }

  return {
    criar(c) {
      expirar();
      // limite de pendentes: a mais antiga cai (nunca acumula sem fim)
      while (mapa.size >= max) {
        const velho = mapa.keys().next().value;
        if (velho === undefined) break;
        mapa.delete(velho);
      }
      const agora = op.relogio.agora();
      const payload = congelar(structuredClone(c.payload));
      const p: ConfirmacaoPendente = {
        id: novoId(),
        ator: c.ator,
        dispositivo_id: c.dispositivo_id ?? null,
        dispositivo_nome: c.dispositivo_nome ?? null,
        acao: c.acao,
        resumo: c.resumo,
        args_hash: hashArgs({ acao: c.acao, resumo: c.resumo, payload }),
        criada_em: agora,
        expira_em: agora + (c.ttl_ms ?? ttl),
        payload,
      };
      mapa.set(p.id, p);
      return p;
    },
    resolver(id, o) {
      const c = mapa.get(id);
      if (c === undefined) return { ok: false, codigo: "confirmacao_invalida" };
      if (!RESOLVEDORES.includes(o.por)) return { ok: false, codigo: "confirmacao_invalida" };
      mapa.delete(id); // uso único: queima ANTES de qualquer outra coisa
      if (venceu(c)) return { ok: false, codigo: "confirmacao_expirada", confirmacao: c };
      // integridade: o payload congelado precisa continuar casando com o hash fixado na criação
      if (hashArgs({ acao: c.acao, resumo: c.resumo, payload: c.payload }) !== c.args_hash) return { ok: false, codigo: "confirmacao_invalida", confirmacao: c };
      return { ok: true, aprovado: o.aprovado === true, confirmacao: c };
    },
    obter: (id) => mapa.get(id) ?? null,
    listar() {
      expirar();
      return [...mapa.values()];
    },
    expirar,
    anularTodas(filtro) {
      const fora: ConfirmacaoPendente[] = [];
      for (const [id, c] of mapa) {
        if (filtro === undefined || filtro(c)) {
          mapa.delete(id);
          fora.push(c);
        }
      }
      return fora;
    },
    visao: (c) => ({ id: c.id, acao: c.acao, resumo: c.resumo, expira_em: new Date(c.expira_em).toISOString(), ator: c.ator, dispositivo: c.dispositivo_nome, dispositivo_id: c.dispositivo_id, resolvivel_por: "desktop" }),
  };
}
