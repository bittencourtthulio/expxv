// CSV (T-19.17): RFC 4180 (aspas, vírgula, quebra de linha, acentos), BOM opcional e CRLF, proteção contra INJEÇÃO DE FÓRMULA (`seguranca.celulaCsv`) e desconhecido = vazio (nunca `0`).
import type { FatosSprint } from "../../../compartilhado/relatorios";
import { csvDe } from "../seguranca";

export const COLUNAS_TASKS = ["sprint", "versao_lancamento", "trabalho_id", "task_ref", "item_id", "titulo", "categoria", "risco", "criticidade", "pontos", "estado_fluxo", "resultado", "duracao_observada_h", "situacao_retrabalho", "commits_qtd", "pr_url", "visivel_cliente", "changelog_tipo", "resumo_cliente"] as const;
export const COLUNAS_METRICAS = ["sprint", "metrica", "valor", "unidade", "n", "observacao"] as const;
const PRIORIDADE: Record<string, string> = { critica: "Highest", alta: "High", media: "Medium", baixa: "Low" };

export function tasksCsv(f: FatosSprint, bom: boolean): string {
  return csvDe(COLUNAS_TASKS, f.itens.map((i) => ({
    sprint: f.sprint.nome, versao_lancamento: f.sprint.versao_lancamento, trabalho_id: i.trabalho_id, task_ref: i.task_ref, item_id: i.item_id, titulo: i.titulo, categoria: i.categoria, risco: i.risco,
    criticidade: i.criticidade, pontos: i.pontos, estado_fluxo: i.estado_fluxo, resultado: i.resultado, duracao_observada_h: i.duracao_h, situacao_retrabalho: i.retrabalho, commits_qtd: i.commits_qtd,
    pr_url: i.pr_url, visivel_cliente: i.visivel_cliente, changelog_tipo: i.changelog_tipo, resumo_cliente: i.resumo_cliente,
  })), { bom });
}
export function tasksJiraCsv(f: FatosSprint, bom: boolean): string {
  return csvDe(["Summary", "Issue Type", "Status", "Priority", "Story point estimate", "Labels", "Description", "Epic Name"], f.itens.map((i) => ({
    Summary: i.titulo, "Issue Type": i.categoria === "feature" ? "Story" : i.categoria === "bug" ? "Bug" : "Task", Status: i.estado_fluxo,
    Priority: i.criticidade ? PRIORIDADE[i.criticidade] ?? "Medium" : "", "Story point estimate": i.pontos, Labels: i.categoria ?? "", Description: i.resumo_cliente ?? "", "Epic Name": "",
  })), { bom });
}
export function tasksGithubCsv(f: FatosSprint, bom: boolean): string {
  return csvDe(["Title", "Body", "Labels", "State", "Assignees"], f.itens.map((i) => ({
    Title: i.titulo, Body: i.resumo_cliente ?? "", Labels: [i.categoria, i.risco ? `risco-${i.risco}` : null].filter(Boolean).join(";"), State: i.resultado === "concluido" ? "closed" : "open", Assignees: "",
  })), { bom });
}
export function metricasCsv(f: FatosSprint, bom: boolean): string {
  const m = f.metricas;
  const l = (metrica: string, valor: number | boolean | null, unidade: string, n: number | null = null): Record<string, unknown> => ({ sprint: f.sprint.nome, metrica, valor: typeof valor === "boolean" ? (valor ? 1 : 0) : valor, unidade, n, observacao: valor === null ? "desconhecido" : "" });
  const linhas = [
    l("pontos_planejados", m.pontos_planejados, "pontos"), l("pontos_entregues", m.pontos_entregues, "pontos"), l("itens_entregues", m.itens_entregues, "itens", m.itens_total),
    l("first_time_right", m.first_time_right, "fracao"), l("indice_retrabalho", m.ir, "fracao"), l("indice_retrabalho_max", m.ir_max, "fracao"), l("velocidade_media_movel", m.velocidade_media_movel, "pontos"),
    l("ciclo_p50", m.cycle_p50_h, "h"), l("ciclo_p85", m.cycle_p85_h, "h"), l("lead_p85", m.lead_p85_h, "h"), l("defeitos_escapados", m.defeitos_escapados, "itens"), l("bloqueio", m.bloqueio_h, "h"),
    l("meta_atingida", m.meta_atingida, "booleano"), l("custo_tokens", f.custo.tokens, "tokens"), l("custo_usd", f.custo.usd, "usd"),
  ];
  linhas[linhas.length - 1] = { ...(linhas[linhas.length - 1] as Record<string, unknown>), observacao: f.custo.usd === null ? "desconhecido" : f.custo.estado === "minimo" ? "minimo" : "" };
  return csvDe(COLUNAS_METRICAS, linhas, { bom });
}
