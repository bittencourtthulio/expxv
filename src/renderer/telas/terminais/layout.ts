import type { LayoutTerminais, NoLayout } from "../../../compartilhado/terminais";

/** Árvore de divisões de uma aba: cada folha é um terminal (uma sessão), cada nó divide o espaço em dois. */
export type NoPainel = NoLayout;
export type Orientacao = "horizontal" | "vertical";

export const PROFUNDIDADE_MAXIMA = 16;
export const NOS_MAXIMOS = 64;

/** Poda folhas que não valem; divisão que perde um filho colapsa no outro. */
export function podar(no: NoPainel, vale: (id: string) => boolean): NoPainel | null {
  if (no.tipo === "terminal") return vale(no.sessao_id) ? no : null;
  const primeiro = podar(no.primeiro, vale);
  const segundo = podar(no.segundo, vale);
  if (primeiro === null) return segundo;
  if (segundo === null) return primeiro;
  return primeiro === no.primeiro && segundo === no.segundo ? no : { ...no, primeiro, segundo };
}

/** Folhas da esquerda para a direita / de cima para baixo. */
export function folhas(no: NoPainel): string[] {
  return no.tipo === "terminal" ? [no.sessao_id] : [...folhas(no.primeiro), ...folhas(no.segundo)];
}

export function contarNos(no: NoPainel): number {
  return no.tipo === "terminal" ? 1 : 1 + contarNos(no.primeiro) + contarNos(no.segundo);
}

/** Número de divisões no caminho mais longo (folha sozinha = 0). */
export function profundidade(no: NoPainel): number {
  return no.tipo === "terminal" ? 0 : 1 + Math.max(profundidade(no.primeiro), profundidade(no.segundo));
}

function profundidadeDa(no: NoPainel, id: string, atual = 0): number {
  if (no.tipo === "terminal") return no.sessao_id === id ? atual : -1;
  const a = profundidadeDa(no.primeiro, id, atual + 1);
  return a >= 0 ? a : profundidadeDa(no.segundo, id, atual + 1);
}

/** Dividir a folha `id` cabe nos limites (profundidade ≤ 16 e ≤ 64 nós)? */
export function podeDividir(arvore: NoPainel, id: string): boolean {
  const d = profundidadeDa(arvore, id);
  return d >= 0 && d + 1 <= PROFUNDIDADE_MAXIMA && contarNos(arvore) + 2 <= NOS_MAXIMOS;
}

/** A folha `alvo` vira uma divisão com ela à frente e a sessão `nova` atrás. */
export function dividir(arvore: NoPainel, alvo: string, orientacao: Orientacao, nova: string): NoPainel {
  if (!podeDividir(arvore, alvo)) return arvore;
  const trocar = (no: NoPainel): NoPainel => {
    if (no.tipo === "terminal") return no.sessao_id === alvo ? { tipo: "divisao", orientacao, primeiro: no, segundo: { tipo: "terminal", sessao_id: nova } } : no;
    return { ...no, primeiro: trocar(no.primeiro), segundo: trocar(no.segundo) };
  };
  return trocar(arvore);
}

/** Tira a folha; `null` quando era a última da árvore. */
export function remover(arvore: NoPainel, id: string): NoPainel | null {
  return podar(arvore, (x) => x !== id);
}

export interface AbaLeve { arvore: NoPainel }

/** Estado atual → layout gravável: só sessões que existem; aba vazia sai; fixada só vale se ainda é raiz de aba. */
export function montarLayout(abas: readonly AbaLeve[], ativa: string | null, fixadas: readonly string[], existe: (id: string) => boolean, extras: { expandido?: string | null; focoUnico?: boolean } = {}): LayoutTerminais {
  const saida: LayoutTerminais["abas"] = [];
  for (const aba of abas) {
    const arvore = podar(aba.arvore, existe);
    if (arvore !== null) saida.push({ arvore });
  }
  const raizes = new Set(saida.map((a) => folhas(a.arvore)[0]));
  const todas = new Set(saida.flatMap((a) => folhas(a.arvore)));
  const layout: LayoutTerminais = {
    versao: 2,
    ativa: ativa !== null && todas.has(ativa) ? ativa : null,
    abas: saida,
    fixadas: fixadas.filter((id, i) => raizes.has(id) && fixadas.indexOf(id) === i),
  };
  // D-570: modo foco lembrado por workspace
  if (extras.expandido != null && todas.has(extras.expandido)) layout.expandido = extras.expandido;
  if (extras.focoUnico === true) layout.foco_unico = true;
  return layout;
}

/** Layout guardado + sessões que o daemon devolveu → grupos a montar. Tolera o que mudou desde que foi gravado. */
export function restaurarLayout(layout: Pick<LayoutTerminais, "ativa" | "abas"> & { fixadas?: string[] } | null, sessoes: readonly string[]): { grupos: NoPainel[]; ativa: string | null; fixadas: string[] } {
  // (o modo foco — `expandido`/`foco_unico` — é lido por quem chama, em `restaurar`)
  const disponiveis = new Set(sessoes);
  const usadas = new Set<string>();
  const grupos: NoPainel[] = [];
  for (const { arvore } of layout?.abas ?? []) {
    const podada = podar(arvore, (id) => disponiveis.has(id) && !usadas.has(id));
    if (podada === null) continue;
    // sessão repetida na própria árvore só vale na primeira folha
    const vistas = new Set<string>();
    const unica = podar(podada, (id) => (vistas.has(id) ? false : (vistas.add(id), true)));
    if (unica === null) continue;
    folhas(unica).forEach((id) => usadas.add(id));
    grupos.push(unica);
  }
  for (const id of sessoes) if (!usadas.has(id)) { usadas.add(id); grupos.push({ tipo: "terminal", sessao_id: id }); }
  const ativa = layout?.ativa ?? null;
  const raizes = new Set(grupos.map((g) => folhas(g)[0]));
  const fixadas = (layout?.fixadas ?? []).filter((id, i, todas) => raizes.has(id) && todas.indexOf(id) === i);
  return { grupos, ativa: ativa !== null && usadas.has(ativa) ? ativa : null, fixadas };
}
