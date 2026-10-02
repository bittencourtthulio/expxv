// Formatação e lógica pura da Fase 20 (alertas): sem React, sem `window.ade`. Estados sempre por forma E texto.
import type { AlertaVisao, CanalVisao, Severidade, TipoCanal } from "../../compartilhado/alertas";

export const formatarContagem = (n: number): string => (n > 99 ? "99+" : String(Math.max(0, Math.trunc(n))));

/** `aria-label` do botão do topo: "Alertas, 3 não lidos, 1 crítico". */
export function rotuloBadge(c: { nao_lidos: number; criticos: number }): string {
  if (c.nao_lidos <= 0) return "Alertas, nenhum não lido";
  const nl = `${c.nao_lidos} ${c.nao_lidos === 1 ? "não lido" : "não lidos"}`;
  if (c.criticos <= 0) return `Alertas, ${nl}`;
  return `Alertas, ${nl}, ${c.criticos} ${c.criticos === 1 ? "crítico" : "críticos"}`;
}

export const SEVERIDADE_VISUAL: Readonly<Record<Severidade, { glifo: string; texto: string; tom: "neutro" | "sucesso" | "aviso" | "alerta" }>> = {
  info: { glifo: "●", texto: "Info", tom: "neutro" },
  sucesso: { glifo: "✓", texto: "Sucesso", tom: "sucesso" },
  aviso: { glifo: "◆", texto: "Aviso", tom: "aviso" },
  critico: { glifo: "▲", texto: "Crítico", tom: "alerta" },
};

/** `1 h 12 min`, `45 min`, `30 s`; `null` = sem medição (nunca zero). */
export function formatarDuracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "sem medição";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function formatarTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "sem fonte";
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function tempoRelativo(iso: string, agora: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = Math.max(0, agora - t);
  if (d < 60_000) return "agora";
  if (d < 3_600_000) return `há ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `há ${Math.floor(d / 3_600_000)} h`;
  return `há ${Math.floor(d / 86_400_000)} d`;
}

export const silenciarAte = (horas: number, agora: number): string => new Date(agora + horas * 3_600_000).toISOString();

/** Resumo de uma linha dos números que toda tarefa carrega (tempo, tokens, pontos). */
export function resumoNumeros(a: AlertaVisao): string {
  const d = a.dados;
  const partes: string[] = [];
  if (d.tempo_trabalho_ms !== undefined) partes.push(`Tempo ${formatarDuracao(d.tempo_trabalho_ms)}`);
  if (d.tokens !== undefined) partes.push(`Tokens ${formatarTokens(d.tokens)}`);
  if (d.story_points !== undefined) partes.push(`Pontos ${d.story_points === null ? "sem estimativa" : d.story_points}`);
  return partes.join(" · ");
}

export type EstadoListaFiltro = "nao_lidos" | "todos" | "silenciados";
export interface FiltrosLista {
  estado: EstadoListaFiltro;
  tipo: string;
  severidade_min: Severidade | "";
  workspace_id: string;
  busca: string;
}
export const FILTROS_VAZIOS: FiltrosLista = { estado: "nao_lidos", tipo: "", severidade_min: "", workspace_id: "", busca: "" };

export function filtrosParaPedido(f: FiltrosLista, depois: string | null, limite = 100) {
  return {
    estado: f.estado,
    ...(f.tipo === "" ? {} : { tipos: [f.tipo as AlertaVisao["tipo"]] }),
    ...(f.severidade_min === "" ? {} : { severidade_min: f.severidade_min }),
    ...(f.workspace_id === "" ? {} : { workspace_id: f.workspace_id }),
    ...(f.busca.trim() === "" ? {} : { busca: f.busca.trim().slice(0, 80) }),
    depois_id: depois,
    limite,
  };
}

/** Indicador discreto do rodapé: só canais EXTERNOS ligados ou com problema. */
export interface IndicadorCanal {
  texto: string;
  tom: "ok" | "aviso" | "erro";
  forma: string;
}
const NOME_CANAL: Partial<Record<TipoCanal, string>> = { telegram: "Telegram", webhook: "Webhook" };

export function indicadoresDeCanais(canais: readonly CanalVisao[]): IndicadorCanal[] {
  const saida: IndicadorCanal[] = [];
  for (const c of canais) {
    const nome = NOME_CANAL[c.tipo];
    if (nome === undefined) continue;
    if (c.estado === "conflito") saida.push({ texto: `${nome} · conflito`, tom: "erro", forma: "▲" });
    else if (c.estado === "erro") saida.push({ texto: `${nome} · erro`, tom: "erro", forma: "▲" });
    else if (c.estado === "pausado" && (c.entrada_ligada || c.saida_ligada)) saida.push({ texto: `${nome} · pausado`, tom: "aviso", forma: "◆" });
    else if (c.estado === "ativo" && c.entrada_ligada) saida.push({ texto: `${nome} · entrada ativa`, tom: "aviso", forma: "◆" });
    else if (c.estado === "ativo" && c.saida_ligada) saida.push({ texto: `${nome} · saída ativa`, tom: "ok", forma: "●" });
  }
  return saida;
}

/** Contagem regressiva `m:ss` até `expira_em`; `null` se já expirou. */
export function restanteAte(expiraEm: string | null, agora: number): string | null {
  if (expiraEm === null) return null;
  const ms = Date.parse(expiraEm) - agora;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Mostra o código de pareamento como XXXXX-XXXXX. */
export const formatarCodigoPareamento = (c: string): string => {
  const limpo = c.replace(/-/g, "");
  return limpo.length === 10 ? `${limpo.slice(0, 5)}-${limpo.slice(5)}` : c;
};

