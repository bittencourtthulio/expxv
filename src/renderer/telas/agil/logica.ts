// Lógica pura da tela de Gestão ágil (sem React): erros do IPC, formatação, filtros por método, CSV, janela virtual, reordenação. Testada em logica.test.ts.
import type { FiltrosAgil, ItemResumo, MetodoAgil } from "../../../compartilhado/agil";
import type { ItemSubNav } from "../../componentes/subnavegacao-logica";

export type AbaAgil = "painel" | "backlog" | "sprint" | "daily" | "retro" | "qualidade" | "config";
export const ABAS_AGIL: ReadonlyArray<ItemSubNav<AbaAgil>> = [
  { id: "painel", rotulo: "Painel", icone: "consumo" }, { id: "backlog", rotulo: "Backlog", icone: "catalogo" }, { id: "sprint", rotulo: "Sprint", icone: "agil" },
  { id: "daily", rotulo: "Daily", icone: "chat" }, { id: "retro", rotulo: "Retro", icone: "desfazer" }, { id: "qualidade", rotulo: "Qualidade", icone: "alerta" },
  { id: "config", rotulo: "Config", icone: "config" },
];

// ---- erros do IPC: `[codigo/subcodigo] mensagem` (ver compartilhado/agil.ts)
export interface ErroAgilLido { code: string; subcode: string | null; message: string }
export function lerErroAgil(e: unknown): ErroAgilLido {
  const bruto = e instanceof Error ? e.message : typeof e === "string" ? e : "Erro desconhecido.";
  const limpo = bruto.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
  const m = /\[(invalid_argument|not_found|rule_violation|conflict)(?:\/([a-z_]+))?\]\s*(.*)$/s.exec(limpo);
  if (m) return { code: m[1] as string, subcode: m[2] ?? null, message: (m[3] ?? "").trim() || limpo };
  return { code: "unknown", subcode: null, message: limpo.slice(0, 300) };
}
export function textoDoErro(e: unknown): string {
  const r = lerErroAgil(e);
  if (r.subcode === "human_only") return "Ação reservada a uma pessoa: um agente não pode fazer isto.";
  return r.message;
}

// ---- formatação
export function formatarDuracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "< 1 min";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
}
export const formatarPercentual = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${Math.round(v * 1000) / 10} %`);
export const formatarPontos = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : String(Math.round(v * 100) / 100));
export const horas = (ms: number): number => Math.round((ms / 3_600_000) * 100) / 100;

// ---- filtros
export const FILTROS_VAZIOS: FiltrosAgil = { sprint_id: null, membro_id: null, agente: null, squad_id: null, de: null, ate: null };
export const METODOS: ReadonlyArray<{ id: MetodoAgil | "todos"; rotulo: string }> = [{ id: "todos", rotulo: "Todos os métodos" }, { id: "scrum", rotulo: "Scrum" }, { id: "xp", rotulo: "XP" }, { id: "lean", rotulo: "Lean" }];
export const filtrosParaApi = (f: FiltrosAgil): Partial<FiltrosAgil> => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== "")) as Partial<FiltrosAgil>;

// ---- CSV (RFC 4180 + proteção contra injeção de fórmula)
export function celulaCsv(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvDeTabela(colunas: readonly string[], linhas: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  return `${[colunas, ...linhas].map((l) => l.map(celulaCsv).join(",")).join("\r\n")}\r\n`;
}

// ---- virtualização (tabela de 5 000 itens com ≤ 200 nós)
export function janelaVirtual(total: number, alturaLinha: number, topo: number, viewport: number, margem = 6): { inicio: number; fim: number } {
  const inicio = Math.max(0, Math.floor(topo / alturaLinha) - margem);
  const fim = Math.min(total, Math.ceil((topo + viewport) / alturaLinha) + margem);
  return { inicio, fim: Math.max(inicio, fim) };
}

/** arrastar `de` para a posição `para` (índices da lista visível): devolve o id do vizinho que ficará DEPOIS do item (`null` = fim). */
export function antesDoDestino(ids: readonly string[], de: number, para: number): string | null {
  if (de === para || de < 0 || para < 0 || de >= ids.length || para >= ids.length) return null;
  const sem = ids.filter((_, i) => i !== de);
  return sem[para] ?? null;
}

export const motivoValido = (m: string): boolean => m.trim().length >= 5;

// ---- rótulos
export const ROTULO_RISCO: Readonly<Record<string, string>> = { baixo: "baixo", medio: "médio", alto: "alto", critico: "crítico" };
export const ROTULO_CRITICIDADE: Readonly<Record<string, string>> = { baixa: "baixa", media: "média", alta: "alta", critica: "crítica" };
export const ROTULO_FLUXO: Readonly<Record<string, string>> = { backlog: "backlog", pronto: "pronto", em_andamento: "em andamento", concluida: "concluída", validada: "validada", orfao: "órfã" };
export const ROTULO_SITUACAO: Readonly<Record<string, string>> = { primeira: "de primeira", retrabalho: "retrabalho", em_observacao: "em observação", indeterminado: "indeterminado" };
export const ROTULO_ORIGEM: Readonly<Record<string, string>> = { ade: "Criado aqui", metodo: "Do método", issue: "Issue", retro: "Retro", ocorrencia: "Ocorrência" };
export const textoOrigemEstimativa = (origem: "ia" | "humano" | null, confianca: number | null): string =>
  origem === null ? "sem estimativa" : origem === "humano" ? "decidido por pessoa" : `sugerido${confianca === null ? "" : ` (confiança ${Math.round(confianca * 100)} %)`}`;

export const ordenarPorOrdem = (itens: readonly ItemResumo[]): ItemResumo[] => [...itens].sort((a, b) => a.ordem - b.ordem);
export const rotuloSprint = (s: { nome: string; estado: string }): string => `${s.nome} (${s.estado})`;
