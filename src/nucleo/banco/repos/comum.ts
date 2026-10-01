import { gerarId, type TipoId } from "../ids";
import type { Banco, Parametros, Valor } from "../banco";
import { ValorInvalidoErro, type OpcoesPagina, type Pagina } from "../../dominio";

/** Id ULID com o prefixo de tipo do contrato (o prefixo de `ids.ts` é trocado quando difere). */
export function novoId(tipo: TipoId, prefixo: string): string {
  return gerarId(tipo).replace(/^[a-z]+_/, `${prefixo}_`);
}

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 500;

export function limiteDe(op: OpcoesPagina | undefined): number {
  const l = op?.limite ?? LIMITE_PADRAO;
  if (!Number.isInteger(l) || l < 1) throw new ValorInvalidoErro("limite", l);
  return Math.min(l, LIMITE_MAXIMO);
}

/** Recebe `limite + 1` linhas e devolve a página com o cursor (id do último item visível). */
export function fecharPagina<T extends { id: string }>(linhas: T[], limite: number): Pagina<T> {
  const temMais = linhas.length > limite;
  const itens = temMais ? linhas.slice(0, limite) : linhas;
  return { itens, proximo: temMais ? (itens[itens.length - 1] as T).id : null };
}

export function exigirEnum<T extends string>(campo: string, valor: unknown, validos: readonly T[]): T {
  if (typeof valor !== "string" || !validos.includes(valor as T)) throw new ValorInvalidoErro(campo, valor);
  return valor as T;
}

export function textoObrigatorio(campo: string, valor: unknown): string {
  if (typeof valor !== "string" || valor.trim() === "") throw new ValorInvalidoErro(campo, valor);
  return valor;
}

export function bool(v: unknown): boolean {
  return Number(v) === 1;
}
export function int(b: boolean): number {
  return b ? 1 : 0;
}

/** True se o erro do SQLite é violação de UNIQUE cuja mensagem cita `trecho` (ex.: "pane.mission_id"). */
export function ehUnicoViolado(erro: unknown, trecho: string): boolean {
  const msg = erro instanceof Error ? erro.message : String(erro);
  return /UNIQUE constraint failed/i.test(msg) && msg.includes(trecho);
}

/** UPDATE dinâmico restrito a colunas permitidas. Devolve false se o patch não tinha campo algum. */
export function atualizarCampos(
  banco: Banco,
  tabela: string,
  id: string,
  patch: Record<string, Valor | undefined>,
  permitidos: readonly string[],
  agoraIso: string,
): boolean {
  const sets: string[] = [];
  const params: Valor[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!permitidos.includes(k)) throw new ValorInvalidoErro("campo", k);
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (sets.length === 0) return false;
  sets.push("atualizado_em = ?");
  params.push(agoraIso, id);
  banco.executar(`UPDATE ${tabela} SET ${sets.join(", ")} WHERE id = ?`, params as Parametros);
  return true;
}
