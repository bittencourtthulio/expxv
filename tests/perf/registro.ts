import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Registro dos orçamentos medidos (03-ORCAMENTOS-DESEMPENHO.md). Cada medição grava valor, limite
// e veredito em docs/ade/perf/ultimo.json (mescla com o que já existe: cada fase acrescenta os seus).
// O fator EXPXV_PERF_FATOR (padrão 1) multiplica os limites em máquina lenta — nunca remove um orçamento.

export const ARQUIVO_PERF = resolve(__dirname, "../../docs/ade/perf/ultimo.json");

export interface Medicao {
  id: string;
  descricao: string;
  valor: number;
  limite: number;
  unidade: string;
  /** "max": passa se valor <= limite (padrão). "min": passa se valor >= limite. */
  sentido: "max" | "min";
  ok: boolean;
  medido_em: string;
  /** pior amostra individual (quando a medição é uma mediana/percentil de várias). */
  pior?: number;
}

export function fatorPerf(): number {
  const bruto = Number(Object.entries(process.env).find(([k]) => k.endsWith("_PERF_FATOR"))?.[1] ?? "1");
  return Number.isFinite(bruto) && bruto > 0 ? bruto : 1;
}

const medicoes: Medicao[] = [];

/** `semFator`: medição determinística (ex.: tamanho de bundle) — o fator de tolerância de máquina lenta não se aplica. */
export function registrar(m: { id: string; descricao: string; valor: number; limite: number; unidade: string; sentido?: "max" | "min"; semFator?: boolean; pior?: number }): Medicao {
  const fator = m.semFator === true ? 1 : fatorPerf();
  const sentido = m.sentido ?? "max";
  const limite = sentido === "max" ? m.limite * fator : m.limite / fator;
  const ok = sentido === "max" ? m.valor <= limite : m.valor >= limite;
  const registro: Medicao = {
    id: m.id,
    descricao: m.descricao,
    valor: Math.round(m.valor * 100) / 100,
    limite: Math.round(limite * 100) / 100,
    unidade: m.unidade,
    sentido,
    ok,
    medido_em: new Date().toISOString(),
    ...(m.pior === undefined ? {} : { pior: Math.round(m.pior * 100) / 100 }),
  };
  medicoes.push(registro);
  return registro;
}

export function gravarMedicoes(): void {
  let existentes: Medicao[] = [];
  if (existsSync(ARQUIVO_PERF)) {
    try {
      const bruto = JSON.parse(readFileSync(ARQUIVO_PERF, "utf8")) as { medicoes?: Medicao[] };
      existentes = Array.isArray(bruto.medicoes) ? bruto.medicoes : [];
    } catch {
      existentes = [];
    }
  }
  const porId = new Map(existentes.map((m) => [m.id, m]));
  for (const m of medicoes) porId.set(m.id, m);
  const todas = [...porId.values()].sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(ARQUIVO_PERF), { recursive: true });
  writeFileSync(
    ARQUIVO_PERF,
    JSON.stringify({ atualizado_em: new Date().toISOString(), fator: fatorPerf(), tudo_ok: todas.every((m) => m.ok), medicoes: todas }, null, 2),
  );
}

export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const i = Math.min(ordenado.length - 1, Math.max(0, Math.ceil((p / 100) * ordenado.length) - 1));
  return ordenado[i] ?? 0;
}
