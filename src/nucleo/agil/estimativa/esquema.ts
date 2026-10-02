// T-18.16: validação ESTRITA da saída da IA. ref ∈ lote; pontos ∈ escala; enums fechados; fatores ≤ 6; textos truncados; campos extras descartados.
import type { CriticidadeAgil, EscalaAgil, FatorEstimativa, RiscoAgil } from "../../../compartilhado/agil";
import { truncar } from "../util";
import { valorNaEscala, rotuloDoValor } from "./escala";

export interface SaidaIa {
  ref: string; pontos: number; rotulo: string; categoria: string; risco: RiscoAgil; criticidade: CriticidadeAgil; confianca: number;
  fatores: FatorEstimativa[]; justificativa: string; similar_ref: string | null; duvidas: string[];
}
export type ResultadoEsquema = { ok: true; itens: SaidaIa[]; descartados: { ref: string | null; motivo: string }[] } | { ok: false; erro: string };

const RISCOS = new Set(["baixo", "medio", "alto", "critico"]);
const CRITS = new Set(["baixa", "media", "alta", "critica"]);
const txt = (x: unknown, max: number): string => (typeof x === "string" ? truncar(x.replace(/[\u0000-\u001f]/g, " ").trim(), max) : "");

function extrairJson(texto: string): unknown {
  const t = texto.trim();
  const cerca = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const candidato = cerca?.[1]?.trim() ?? t;
  try { return JSON.parse(candidato); } catch { /* tenta o primeiro array */ }
  const ini = candidato.indexOf("[");
  const fim = candidato.lastIndexOf("]");
  if (ini >= 0 && fim > ini) return JSON.parse(candidato.slice(ini, fim + 1));
  throw new Error("JSON não encontrado");
}

export function validarSaida(texto: string, lote: readonly string[], escala: EscalaAgil, categorias: readonly string[]): ResultadoEsquema {
  let bruto: unknown;
  try { bruto = extrairJson(texto); } catch (e) { return { ok: false, erro: `JSON inválido: ${(e as Error).message}` }; }
  if (!Array.isArray(bruto)) return { ok: false, erro: "esperado um array JSON" };
  const refs = new Set(lote);
  const itens: SaidaIa[] = [];
  const descartados: { ref: string | null; motivo: string }[] = [];
  const vistos = new Set<string>();
  for (const x of bruto) {
    if (typeof x !== "object" || x === null) { descartados.push({ ref: null, motivo: "item não é objeto" }); continue; }
    const o = x as Record<string, unknown>;
    const ref = typeof o["ref"] === "string" ? o["ref"] : null;
    const rej = (motivo: string): void => { descartados.push({ ref, motivo }); };
    if (ref === null || !refs.has(ref)) { rej("ref fora do lote"); continue; }
    if (vistos.has(ref)) { rej("ref repetida"); continue; }
    const pontos = o["pontos"];
    if (typeof pontos !== "number" || !valorNaEscala(pontos, escala)) { rej("pontos fora da escala"); continue; }
    if (typeof o["categoria"] !== "string" || !categorias.includes(o["categoria"])) { rej("categoria fora do conjunto"); continue; }
    if (typeof o["risco"] !== "string" || !RISCOS.has(o["risco"])) { rej("risco inválido"); continue; }
    if (typeof o["criticidade"] !== "string" || !CRITS.has(o["criticidade"])) { rej("criticidade inválida"); continue; }
    const conf = typeof o["confianca"] === "number" && Number.isFinite(o["confianca"]) ? Math.min(1, Math.max(0, o["confianca"])) : 0.5;
    const fatores: FatorEstimativa[] = [];
    for (const f of Array.isArray(o["fatores"]) ? o["fatores"] : []) {
      if (fatores.length >= 6) break;
      if (typeof f !== "object" || f === null) continue;
      const g = f as Record<string, unknown>;
      const fator = txt(g["fator"], 60);
      if (!fator || (g["direcao"] !== "sobe" && g["direcao"] !== "desce")) continue;
      fatores.push({ fator, direcao: g["direcao"], evidencia: txt(g["evidencia"], 160) });
    }
    const similar = typeof o["similar_ref"] === "string" ? txt(o["similar_ref"], 60) : null;
    vistos.add(ref);
    itens.push({
      ref, pontos, rotulo: rotuloDoValor(pontos, escala) ?? String(pontos), categoria: o["categoria"], risco: o["risco"] as RiscoAgil, criticidade: o["criticidade"] as CriticidadeAgil,
      confianca: conf, fatores, justificativa: txt(o["justificativa"], 400), similar_ref: similar || null,
      duvidas: (Array.isArray(o["duvidas"]) ? o["duvidas"] : []).filter((d): d is string => typeof d === "string").slice(0, 5).map((d) => txt(d, 200)),
    });
  }
  return { ok: true, itens, descartados };
}
