// T-18.35: práticas XP medidas dos FATOS. Sem rastro/VCS => `indeterminado` (nunca 0 %). Nenhum campo vem de autorrelato de agente.
import type { ConfigAgil, FatoTask } from "../../../compartilhado/agil";
import type { ItemMetrica } from "../metricas/dados";
import { arredondar, mediana } from "../util";

export interface MetricaXp { codigo: string; valor: number | null; estado: "ok" | "atencao" | "falha" | "indeterminado"; amostra: number; detalhe: string }
export interface EntradaXp {
  fatos: readonly FatoTask[];
  itens: readonly ItemMetrica[];
  /** item_ids com par definido (campo `par_membro_id`). */
  com_par: ReadonlySet<string>;
  /** checks verdes do PR por `trabalho/task` (PortaForge); ausente = desconhecido. */
  ci_verde: ReadonlyMap<string, boolean | null>;
  /** revisão independente por ref (QA por agente diferente E reviews de PR); null = desconhecido. */
  revisao_independente: ReadonlyMap<string, boolean | null>;
  config: Pick<ConfigAgil, "commit_grande_linhas">;
}

const faixa = (v: number): MetricaXp["estado"] => (v >= 0.7 ? "ok" : v >= 0.4 ? "atencao" : "falha");
function proporcao(codigo: string, amostra: readonly (boolean | null)[], rotulo: string): MetricaXp {
  const conhecidas = amostra.filter((x): x is boolean => x !== null);
  if (conhecidas.length === 0) return { codigo, valor: null, estado: "indeterminado", amostra: 0, detalhe: `sem fonte (${rotulo})` };
  const v = arredondar(conhecidas.filter(Boolean).length / conhecidas.length);
  return { codigo, valor: v, estado: faixa(v), amostra: conhecidas.length, detalhe: `${conhecidas.filter(Boolean).length} de ${conhecidas.length} tasks` };
}

export function metricasXp(e: EntradaXp): MetricaXp[] {
  const concl = e.fatos.filter((f) => f.status_visto === "concluida");
  const out: MetricaXp[] = [];
  out.push(proporcao("tdd_primeiro", concl.map((f) => f.tdd_primeiro), "arquivo_alterado no rastro"));
  out.push(proporcao("vermelho_antes_do_verde", concl.map((f) => f.vermelho_antes), "suite_executada no rastro"));
  const linhas = concl.flatMap((f) => f.commits.map((c) => c.linhas)).filter((x): x is number => x !== null);
  const med = mediana(linhas);
  out.push(med === null ? { codigo: "commits_pequenos", valor: null, estado: "indeterminado", amostra: 0, detalhe: "sem numstat dos commits" } : { codigo: "commits_pequenos", valor: med, estado: med > e.config.commit_grande_linhas ? "atencao" : "ok", amostra: linhas.length, detalhe: `mediana de ${med} linhas por commit` });
  const comCommit = concl.filter((f) => f.commits.length > 0).length;
  out.push(concl.length === 0 || comCommit === 0 ? { codigo: "commit_por_task", valor: null, estado: "indeterminado", amostra: 0, detalhe: "sem fonte de commits (ENTREGA.md/rastro)" } : proporcao("commit_por_task", concl.map((f) => f.commits.length > 0), "commits"));
  out.push(proporcao("ci_verde", concl.map((f) => e.ci_verde.get(`${f.trabalho_id}/${f.task_ref}`) ?? null), "checks do PR"));
  out.push(proporcao("revisao_independente", concl.map((f) => e.revisao_independente.get(`${f.trabalho_id}/${f.task_ref}`) ?? null), "QA e reviews de PR"));
  const comPontos = e.itens.filter((i) => i.pontos !== null && !i.descartado);
  const total = comPontos.reduce((a, i) => a + (i.pontos as number), 0);
  const refat = comPontos.filter((i) => i.categoria === "refator" || i.categoria === "divida").reduce((a, i) => a + (i.pontos as number), 0);
  out.push(total === 0 ? { codigo: "refatoracao", valor: null, estado: "indeterminado", amostra: 0, detalhe: "sem pontos estimados" } : { codigo: "refatoracao", valor: arredondar(refat / total), estado: "ok", amostra: comPontos.length, detalhe: `${refat} de ${total} pontos em refatoração` });
  const alvo = e.itens.filter((i) => !i.descartado && !i.orfao);
  out.push(alvo.length === 0 ? { codigo: "par", valor: null, estado: "indeterminado", amostra: 0, detalhe: "sem itens" } : proporcao("par", alvo.map((i) => e.com_par.has(i.item_id)), "par_membro_id"));
  return out;
}
