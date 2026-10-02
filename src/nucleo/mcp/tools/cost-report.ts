// Tool `cost_report` (Fase 10, T-10.20): custo da Missão do token agrupado por task, modelo, conta, Pane ou dia. SOMENTE LEITURA, sem nenhum campo de escrita: custo e tokens
// vêm só do que a CLI gravou e do proxy (D-104); o que o agente "informar" nunca entra na conta. `usd: null` = desconhecido, `incomplete` = "≥"; resposta ≤ 4 KB.
import { argumentoInvalido } from "../erros";
import { caberEm4Kb } from "./harness";
import { comoObjeto, textoOpcional, type ImplTool } from "./comum";
import { daPorta, exigirCusto, identidadeCusto, soPilotoDeMissao } from "./task";

const GRUPOS = ["task", "model", "account", "pane", "day"] as const;
const AGRUPAR_INTERNO: Readonly<Record<(typeof GRUPOS)[number], "task" | "modelo" | "conta" | "pane" | "dia">> = { task: "task", model: "modelo", account: "conta", pane: "pane", day: "dia" };
const DATA = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const arredondar = (v: number | null): number | null => (v === null ? null : Math.round(v * 1e6) / 1e6);

function data(a: Record<string, unknown>, campo: string): string | null {
  const v = textoOpcional(a, campo, 40);
  if (v === null) return null;
  if (!DATA.test(v) || Number.isNaN(Date.parse(v))) throw argumentoInvalido(`O campo "${campo}" deve ser uma data ISO (AAAA-MM-DD).`);
  return v;
}

export const costReport: ImplTool = async (args, { claims, deps }) => {
  soPilotoDeMissao(claims);
  const a = comoObjeto(args);
  const grupo = textoOpcional(a, "group_by", 20);
  if (grupo === null || !(GRUPOS as readonly string[]).includes(grupo)) throw argumentoInvalido(`O campo "group_by" é obrigatório e deve ser um de: ${GRUPOS.join(", ")}.`);
  const from = data(a, "from");
  const to = data(a, "to");
  if (from !== null && to !== null && Date.parse(from) > Date.parse(to)) throw argumentoInvalido('"from" não pode ser depois de "to".');
  // `cost`, `tokens`, `usd` e afins na ENTRADA são ignorados de propósito: não há caminho de escrita
  const r = await daPorta(() => exigirCusto(deps).relatorio(identidadeCusto(claims), { agrupar: AGRUPAR_INTERNO[grupo as (typeof GRUPOS)[number]], desde: from, ate: to }));
  const linha = (l: { usd: number | null; incompleto: boolean; aproximado: boolean; tokens_entrada: number; tokens_saida: number }) => ({ usd: arredondar(l.usd), incomplete: l.incompleto, approximate: l.aproximado, tokens_in: l.tokens_entrada, tokens_out: l.tokens_saida });
  const rows = r.linhas.map((l) => ({ key: [...l.chave].slice(0, 80).join(""), ...linha(l) }));
  return caberEm4Kb(rows, (parte, extra) => ({ rows: parte, total: linha(r.total), ...(extra.truncated === true ? { truncated: true, rows_total: extra.total } : {}) }));
};
