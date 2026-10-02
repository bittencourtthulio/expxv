import type { ConfigAgil } from "../../../compartilhado/agil";
import { configPadrao } from "./padroes";

type Obj = Record<string, unknown>;
const ehObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Mescla `parcial` sobre o padrão: objetos mesclam chave a chave (nunca perde chave do usuário); listas e escalares substituem. Idempotente. */
export function mesclarConfig(parcial: unknown, base: ConfigAgil = configPadrao()): ConfigAgil {
  const fundir = (a: unknown, b: unknown): unknown => {
    if (ehObj(a) && ehObj(b)) {
      const out: Obj = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = k in a ? fundir(a[k], v) : v;
      return out;
    }
    return b === undefined ? a : b;
  };
  return fundir(base, ehObj(parcial) ? parcial : {}) as ConfigAgil;
}

const ENUM_MODO = new Set(["ia_sugere", "so_heuristica", "manual"]);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Valida uma config COMPLETA; devolve TODOS os erros (a UI mostra a lista), nunca lança. */
export function validarConfig(c: ConfigAgil): { ok: boolean; erros: string[] } {
  const e: string[] = [];
  if (!c.escalas.some((x) => x.id === c.escala_id)) e.push(`escala_id "${c.escala_id}" não existe em escalas`);
  const ids = new Set<string>();
  for (const esc of c.escalas) {
    if (!esc.id) e.push("escala sem id");
    if (ids.has(esc.id)) e.push(`escala duplicada: ${esc.id}`);
    ids.add(esc.id);
    if (esc.valores.length < 2) e.push(`escala ${esc.id}: precisa de ao menos 2 valores`);
    const vs = esc.valores.map((v) => v.valor);
    if (vs.some((v) => !num(v) || v <= 0)) e.push(`escala ${esc.id}: valores devem ser números positivos`);
    if (vs.some((v, i) => i > 0 && v <= (vs[i - 1] as number))) e.push(`escala ${esc.id}: valores devem ser estritamente crescentes`);
    if (new Set(esc.valores.map((v) => v.rotulo)).size !== esc.valores.length) e.push(`escala ${esc.id}: rótulos repetidos`);
  }
  if (c.categorias.length === 0) e.push("categorias não pode ser vazia");
  const f = c.risco_faixas;
  if (!(num(f.medio) && num(f.alto) && num(f.critico) && f.medio < f.alto && f.alto < f.critico)) e.push("risco_faixas deve ter medio < alto < critico");
  for (const [k, p] of Object.entries(c.risco_pesos)) if (!num(p) || p < 0) e.push(`risco_pesos.${k} deve ser número >= 0`);
  for (const [k, p] of Object.entries(c.pontos_base_tipo)) if (!num(p) || p <= 0) e.push(`pontos_base_tipo.${k} deve ser número > 0`);
  if (!ENUM_MODO.has(c.estimativa_modo)) e.push(`estimativa_modo inválido: ${String(c.estimativa_modo)}`);
  if (!Number.isInteger(c.janela_retrabalho_dias) || c.janela_retrabalho_dias < 1 || c.janela_retrabalho_dias > 90) e.push("janela_retrabalho_dias deve ser inteiro entre 1 e 90");
  if (!Number.isInteger(c.estimativa_lote) || c.estimativa_lote < 1 || c.estimativa_lote > 20) e.push("estimativa_lote deve ser inteiro entre 1 e 20");
  if (!Number.isInteger(c.estimativa_max_chamadas_dia) || c.estimativa_max_chamadas_dia < 0) e.push("estimativa_max_chamadas_dia deve ser inteiro >= 0");
  if (!(num(c.confianca_aceite_lote) && c.confianca_aceite_lote >= 0 && c.confianca_aceite_lote <= 1)) e.push("confianca_aceite_lote deve estar em 0..1");
  if (!(num(c.buffer_planejamento) && c.buffer_planejamento >= 0 && c.buffer_planejamento < 1)) e.push("buffer_planejamento deve estar em 0..<1");
  if (c.dias_uteis.length === 0 || c.dias_uteis.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) e.push("dias_uteis deve ter dias de 0 a 6");
  if (c.feriados.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) e.push("feriados devem ser AAAA-MM-DD");
  if (!Number.isInteger(c.amostra_minima) || c.amostra_minima < 2) e.push("amostra_minima deve ser inteiro >= 2");
  for (const [k, l] of Object.entries(c.wip)) if (!Number.isInteger(l) || l < 1) e.push(`wip.${k} deve ser inteiro >= 1`);
  return { ok: e.length === 0, erros: e };
}

/** Mescla e valida; config inválida é recusada com a lista de erros. */
export function lerConfig(parcial: unknown): { ok: true; config: ConfigAgil } | { ok: false; erros: string[] } {
  const c = mesclarConfig(parcial);
  const r = validarConfig(c);
  return r.ok ? { ok: true, config: c } : { ok: false, erros: r.erros };
}
