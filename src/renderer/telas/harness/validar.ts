// Validações puras da tela Harness (política, equivalência, cofre, limiar, decisor). Mensagens em PT-BR dizem o motivo e o próximo passo.
import type { Executor, Faixa, ModeloEquivalente, PoliticaEntrada, TabelaEquivalencia } from "../../../compartilhado/harness";
import { FAIXAS } from "../../../compartilhado/harness";

export const LIMIAR_MIN = 50;
export const LIMIAR_MAX = 99;
const ID_MODELO = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
const ESFORCO = /^[A-Za-z0-9_-]{1,32}$/;
const NOME_COFRE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function validarLimiar(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const n = Number(texto);
  if (texto.trim() === "" || !Number.isInteger(n)) return { ok: false, erro: `Informe um número inteiro entre ${LIMIAR_MIN} e ${LIMIAR_MAX}.` };
  if (n < LIMIAR_MIN || n > LIMIAR_MAX) return { ok: false, erro: `O limiar de troca fica entre ${LIMIAR_MIN} e ${LIMIAR_MAX} (padrão 85).` };
  return { ok: true, valor: n };
}

export interface ContextoPolitica {
  /** provedores com CLI instalada e ao menos uma conta habilitada; `null` = ainda não detectados (não bloqueia). */
  provedoresAtivos: ReadonlySet<string> | null;
}

/** Motivo (texto) pelo qual o executor não pode ser salvo; `null` = ok. */
export function problemaExecutor(e: Executor, ctx: ContextoPolitica, rotulo = "Executor"): string | null {
  if (e.provider.trim() === "") return `${rotulo}: escolha um provedor.`;
  if (ctx.provedoresAtivos !== null && !ctx.provedoresAtivos.has(e.provider)) return `${rotulo}: o provedor "${e.provider}" está desativado (CLI ausente ou sem conta habilitada). Habilite-o em Provedores ou escolha outro.`;
  if (e.model !== null && !ID_MODELO.test(e.model)) return `${rotulo}: o id do modelo "${e.model}" é inválido (use letras, números e . _ : / @ + -).`;
  if (e.effort !== null && !ESFORCO.test(e.effort)) return `${rotulo}: o esforço "${e.effort}" é inválido.`;
  if (e.faixa !== null && !FAIXAS.includes(e.faixa)) return `${rotulo}: faixa desconhecida.`;
  return null;
}

/** Todos os problemas que bloqueiam salvar a política (executor, fallback nunca vazio e cada fallback). */
export function problemasPolitica(p: PoliticaEntrada, ctx: ContextoPolitica): string[] {
  const out: string[] = [];
  const e = problemaExecutor(p.executor, ctx, "Executor");
  if (e !== null) out.push(e);
  if (p.fallback.length === 0) out.push("O fallback não pode ficar vazio: ele garante uma rota quando o executor não está disponível.");
  p.fallback.forEach((f, i) => { const m = problemaExecutor(f, ctx, `Fallback ${i + 1}`); if (m !== null) out.push(m); });
  return out;
}

/** `modelo` ou `modelo@esforco`, separados por vírgula; vazio = "sem equivalente". */
export function lerCelulaEquivalencia(texto: string): { ok: true; valor: ModeloEquivalente[] } | { ok: false; erro: string } {
  const itens = texto.split(",").map((t) => t.trim()).filter((t) => t !== "");
  const out: ModeloEquivalente[] = [];
  for (const it of itens) {
    const [modelo, esforco, ...resto] = it.split("@");
    if (resto.length > 0 || modelo === undefined || !ID_MODELO.test(modelo)) return { ok: false, erro: `Modelo inválido: "${it}". Use "modelo" ou "modelo@esforço".` };
    if (esforco !== undefined && !ESFORCO.test(esforco)) return { ok: false, erro: `Esforço inválido em "${it}".` };
    out.push({ modelo, esforco: esforco ?? null });
  }
  return { ok: true, valor: out };
}
export const textoCelulaEquivalencia = (lista: readonly ModeloEquivalente[] | undefined): string => (lista ?? []).map((m) => `${m.modelo ?? ""}${m.esforco !== null ? `@${m.esforco}` : ""}`).join(", ");

const igual = (a: readonly ModeloEquivalente[] | undefined, b: readonly ModeloEquivalente[] | undefined): boolean => textoCelulaEquivalencia(a) === textoCelulaEquivalencia(b);

/** Aplica a edição de UMA célula nas diferenças (só o que difere do padrão é gravado). */
export function aplicarDiferenca(dif: TabelaEquivalencia, padrao: TabelaEquivalencia, provedor: string, faixa: Faixa, valor: ModeloEquivalente[]): TabelaEquivalencia {
  const novo = JSON.parse(JSON.stringify(dif)) as TabelaEquivalencia;
  if (igual(valor, padrao[provedor]?.[faixa])) {
    const p = novo[provedor];
    if (p !== undefined) { delete p[faixa]; if (Object.keys(p).length === 0) delete novo[provedor]; }
    return novo;
  }
  novo[provedor] = { ...(novo[provedor] ?? {}), [faixa]: valor };
  return novo;
}
export const celulaAlterada = (dif: TabelaEquivalencia, provedor: string, faixa: Faixa): boolean => dif[provedor]?.[faixa] !== undefined;

export function validarNomeCofre(nome: string): string | null {
  return NOME_COFRE.test(nome) ? null : "Use MAIÚSCULAS, números e _ (começando por letra), até 64 caracteres. Exemplo: MINHA_CHAVE.";
}

export function validarHttps(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return "O endereço precisa usar https.";
    if (u.username !== "" || u.password !== "") return "O endereço não pode conter usuário ou senha.";
    return null;
  } catch { return "Endereço inválido. Exemplo: https://api.exemplo.com/v1."; }
}
export const hostDe = (url: string | null | undefined): string => { try { return url ? new URL(url).host : ""; } catch { return ""; } };
