// T-18.12: Definição de Pronto (DoD) por item, automática a partir dos FATOS; os critérios manuais ficam `indeterminado` até o humano marcar.
// Sem dado => `indeterminado` (nunca `ok` por omissão). Item concluído sem QA aprovado mostra `falha` com motivo.
import type { ConfigAgil, FatoTask } from "../../../compartilhado/agil";
import type { BancoAgil, ResultadoDodRegistro } from "../repos";
import { isoDe, type Relogio } from "../util";

export interface ResultadoCriterio { criterio: string; estado: "ok" | "falha" | "na" | "indeterminado"; fonte: "auto" | "manual"; motivo: string }
export interface ContextoDod {
  fato: FatoTask | null;
  categoria: string | null;
  /** true/false/null (desconhecido). */
  qa_aprovado: boolean | null;
  regras_violadas_abertas: number | null;
}

export function avaliarDoD(ctx: ContextoDod, config: Pick<ConfigAgil, "dod">, manuais: ReadonlyMap<string, ResultadoDodRegistro> = new Map()): ResultadoCriterio[] {
  const f = ctx.fato;
  const concluida = f?.status_visto === "concluida";
  return config.dod.map((c): ResultadoCriterio => {
    const manual = manuais.get(c.codigo);
    if (manual?.fonte === "manual") return { criterio: c.codigo, estado: manual.estado, fonte: "manual", motivo: "marcado por humano" };
    const r = (estado: ResultadoCriterio["estado"], motivo: string): ResultadoCriterio => ({ criterio: c.codigo, estado, fonte: "auto", motivo });
    if (!c.auto) return r("indeterminado", "critério manual: aguardando humano");
    if (!f) return r("indeterminado", "sem fatos do método para este item");
    switch (c.codigo) {
      case "suite_verde":
        return f.suite_final === "verde" ? r("ok", "suíte verde") : f.suite_final === "nao_executada" ? (concluida ? r("falha", "task concluída sem suíte executada") : r("indeterminado", "suíte ainda não executada")) : r(concluida ? "falha" : "indeterminado", `suíte ${f.suite_final ?? "desconhecida"}`);
      case "testes_minimos": {
        const base = f.declarados.integracao && f.declarados.funcional;
        const bug = ctx.categoria === "bug";
        if (bug && !f.declarados.regressao) return r("falha", "bug sem teste de regressão");
        return base ? r("ok", bug ? "integração, funcional e regressão" : "integração e funcional") : r("falha", "faltam testes de integração e funcional");
      }
      case "qa_aprovado":
        return ctx.qa_aprovado === true ? r("ok", "QA aprovado") : ctx.qa_aprovado === false ? r(concluida ? "falha" : "indeterminado", concluida ? "task concluída sem QA aprovado" : "QA ainda não aprovado") : r("indeterminado", "sem veredito de QA");
      case "commit_por_task":
        return f.commits.length > 0 ? r("ok", `${f.commits.length} commit(s) da task`) : concluida ? r("falha", "task concluída sem commit referenciado") : r("indeterminado", "sem commit ainda");
      case "sem_regra_violada":
        return ctx.regras_violadas_abertas === null ? r("indeterminado", "sem fonte de regras violadas") : ctx.regras_violadas_abertas === 0 ? r("ok", "nenhuma regra violada aberta") : r("falha", `${ctx.regras_violadas_abertas} regra(s) violada(s)`);
      default:
        return r("indeterminado", "critério sem avaliador automático");
    }
  });
}

export function gravarDoD(d: { banco: BancoAgil; relogio: Relogio }, itemId: string, rs: readonly ResultadoCriterio[]): void {
  const em = isoDe(d.relogio());
  d.banco.transacao(() => {
    for (const r of rs) {
      const k = `${itemId}|${r.criterio}`;
      if (d.banco.dodResultados.get(k)?.fonte === "manual" && r.fonte === "auto") continue;
      d.banco.dodResultados.set(k, { item_id: itemId, criterio: r.criterio, estado: r.estado, fonte: r.fonte, em });
    }
  });
}
