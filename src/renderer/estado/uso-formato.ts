// Lógica pura da aba "Detalhe por uso" (T-10.23): janelas, participação e texto copiável (sem conteúdo de conversa, só rótulos e números).
import type { AgruparCusto, CustoResumo, LinhaRelatorio } from "../../compartilhado/custo";
import { formatarCusto, formatarTokens, totalTokens } from "./custo-formato";

export type JanelaUso = "24h" | "7d" | "30d";
export const HORAS_JANELA: Record<JanelaUso, number> = { "24h": 24, "7d": 168, "30d": 720 };
export const ROTULO_AGRUPAR: Record<AgruparCusto, string> = { modelo: "Modelo", workspace: "Workspace", missao: "Missão", pane: "Pane", conta: "Conta", dia: "Dia", card: "Card", trabalho: "Trabalho" };
export const AGRUPAMENTOS_USO: readonly AgruparCusto[] = ["modelo", "workspace", "missao", "pane", "conta", "dia", "card"];

export function intervalo(janela: JanelaUso, agora: Date): { desde: string; ate: string } {
  return { desde: new Date(agora.getTime() - HORAS_JANELA[janela] * 3_600_000).toISOString(), ate: agora.toISOString() };
}

/** Participação de cada linha no total (0..1) usando só USD conhecido; sem total ou sem preço ⇒ `null` (nunca 0 por omissão). */
export function participacao(linha: CustoResumo, total: CustoResumo): number | null {
  if (linha.usd === null || total.usd === null || total.usd <= 0) return null;
  return Math.min(1, linha.usd / total.usd);
}
/** Σ das linhas confere com o total do período (tolerância de centavos de arredondamento). */
export function somaConfere(linhas: readonly LinhaRelatorio[], total: CustoResumo): boolean {
  const conhecidas = linhas.filter((l) => l.custo.usd !== null);
  if (conhecidas.length === 0) return total.usd === null;
  const s = conhecidas.reduce((a, l) => a + (l.custo.usd ?? 0), 0);
  return Math.abs(s - (total.usd ?? 0)) < 0.005;
}
export const rotuloLinha = (l: LinhaRelatorio, agrupar: AgruparCusto): string => (l.rotulo !== "" ? l.rotulo : agrupar === "modelo" ? "modelo desconhecido" : l.chave === "" ? "sem identificação" : l.chave);

export function textoRelatorio(agrupar: AgruparCusto, janela: JanelaUso, linhas: readonly LinhaRelatorio[], total: CustoResumo, semFonte: readonly string[] = []): string {
  const cab = `Uso por ${ROTULO_AGRUPAR[agrupar].toLowerCase()} (${janela}) — custo equivalente em API`;
  const corpo = linhas.map((l) => `${rotuloLinha(l, agrupar)}\t${formatarTokens(l.custo.tokens.entrada)} in\t${formatarTokens(l.custo.tokens.saida)} out\t${formatarTokens(l.custo.tokens.cache_leitura + l.custo.tokens.cache_escrita)} cache\t${formatarCusto(l.custo)}`);
  const sf = semFonte.map((s) => `sem fonte de uso\t${s}\t—`);
  return [cab, ...corpo, ...sf, `Total\t${formatarTokens(totalTokens(total.tokens))} tokens\t${formatarCusto(total)}`].join("\n");
}
