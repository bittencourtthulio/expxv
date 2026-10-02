// T-16.04 · Conclusão e próxima etapa pelo DISCO (puro). O disco vence (D-19): nunca o texto do terminal.
// `SondaDeDisco` só faz `stat` (existe/mtime) em caminhos fixos; este módulo nunca lê conteúdo de arquivo.
import type { EstadoEtapa, EtapaId } from "../../../compartilhado/maestro";
import type { Trabalho } from "../../metodo/tipos";

export type TrabalhoParaMaestro = Pick<Trabalho, "id" | "tipo" | "estagio" | "status" | "pasta" | "veredito_auditoria" | "veredito_qa" | "entrega" | "prodx" | "raio" | "decisoes_pendentes" | "sprints">;

export interface SondaDeDisco {
  existe(rel: string): boolean;
  /** `null` = ausente ou desconhecido. */
  mtime(rel: string): number | null;
}
export const SONDA_VAZIA: SondaDeDisco = { existe: () => false, mtime: () => null };

export interface RelatorioRapido {
  teste_criado: boolean;
  suite: "verde" | "vermelha" | null;
}
export interface ContextoConclusao {
  sondas?: SondaDeDisco;
  /** início da tentativa (ms): artefato mais velho que isto é de uma rodada anterior. */
  desde_ms?: number | null;
  rodada?: number;
  /** o Pane da etapa está `pronto` (usado só onde a skill não deixa artefato). */
  pane_pronto?: boolean;
  rapido_relatorio?: RelatorioRapido | null;
  /** do rastro (complemento): última task concluída (ms). */
  ultima_task_concluida_ms?: number | null;
}
export interface ResultadoConclusao {
  concluida: boolean;
  /** concluída COM veredito negativo (QA reprovado, auditoria `nao`): dispara o laço. */
  reprovada: boolean;
  motivo: string;
  detectada_por: "disco" | "rastro" | null;
}

const ORDEM: Readonly<Record<string, readonly string[]>> = {
  ocorrencia: ["e1", "e2", "e3", "e4", "e5"],
  feature: ["f1", "f2", "f3", "f35", "f4", "f5", "f6"],
  pedido: ["p0", "p1", "p2", "p3", "p4", "p5"],
  projeto: ["b1", "b2", "b3", "b4", "b5", "b6"],
};
/** posição do estágio na ordem do tipo (-1 se desconhecido). */
export function indiceDoEstagio(tipo: string, estagio: string): number {
  return (ORDEM[tipo] ?? []).indexOf(estagio.toLowerCase());
}
const alem = (t: TrabalhoParaMaestro, minimo: string): boolean => {
  const i = indiceDoEstagio(t.tipo, t.estagio);
  const m = indiceDoEstagio(t.tipo, minimo);
  return i >= 0 && m >= 0 && i >= m;
};

const IDENTIFICADOR_OC = /^(OC-[A-Za-z0-9]+-\d+)(?:-|$)/;
/** Referência do trabalho nas pastas de entrega (OC-ID para ocorrência). */
export const refDoTrabalho = (t: Pick<Trabalho, "id" | "tipo">): string => (t.tipo === "ocorrencia" ? (IDENTIFICADOR_OC.exec(t.id)?.[1] ?? t.id) : t.id);

const ok = (motivo: string, por: "disco" | "rastro" = "disco"): ResultadoConclusao => ({ concluida: true, reprovada: false, motivo, detectada_por: por });
const nao = (motivo: string): ResultadoConclusao => ({ concluida: false, reprovada: false, motivo, detectada_por: null });
const reprovou = (motivo: string): ResultadoConclusao => ({ concluida: true, reprovada: true, motivo, detectada_por: "disco" });

function recente(sondas: SondaDeDisco, rel: string, desde: number | null | undefined): boolean {
  if (desde === null || desde === undefined) return sondas.existe(rel);
  const m = sondas.mtime(rel);
  return m !== null && m >= desde;
}

/**
 * Tabela da coluna "Conclusão pelo disco" (Fase 16 §c). `trabalho` pode ser `null` (ainda não existe).
 * Nunca lança; trabalho de outro tipo que o esperado ⇒ não concluída.
 */
export function etapaConcluida(etapa: EtapaId, trabalho: TrabalhoParaMaestro | null, ctx: ContextoConclusao = {}): ResultadoConclusao {
  const sondas = ctx.sondas ?? SONDA_VAZIA;
  const desde = ctx.desde_ms ?? null;
  const rodada = ctx.rodada ?? 1;
  const t = trabalho;
  const oc = t !== null && t.tipo === "ocorrencia" ? t : null;
  const ft = t !== null && t.tipo === "feature" ? t : null;
  const pd = t !== null && t.tipo === "pedido" ? t : null;
  const pj = t !== null && t.tipo === "projeto" ? t : null;

  switch (etapa) {
    case "runx.e1": return oc !== null && alem(oc, "e2") ? ok("estágio ≥ e2 (01-CAUSA-RAIZ.md)") : nao("causa raiz ainda não gravada");
    case "runx.e2": return oc !== null && alem(oc, "e3") ? ok("estágio ≥ e3 (sprint-01 + ORQUESTRADOR.md)") : nao("plano ainda não gravado");
    case "runx.e3": {
      if (oc === null || !alem(oc, "e4")) return nao("tasks do fix ainda não concluídas");
      if (rodada > 1 && !(ctx.ultima_task_concluida_ms != null && desde !== null && ctx.ultima_task_concluida_ms >= desde)) return nao("aguardando novas tasks desta rodada");
      return ok("estágio ≥ e4 (tasks concluídas)");
    }
    case "runx.e4": {
      if (oc === null) return nao("sem ocorrência");
      if (rodada > 1 && !recente(sondas, `${oc.pasta}/QA.md`, desde)) return nao("aguardando novo QA desta rodada");
      if (oc.veredito_qa === "aprovado") return ok("veredito do QA: aprovado");
      if (oc.veredito_qa === "reprovado") return reprovou("veredito do QA: reprovado");
      return nao("QA sem veredito");
    }
    case "runx.e5": return oc !== null && oc.status === "concluido" ? ok("ocorrência concluída (relatórios + INDICE.md)") : nao("fechamento pendente");

    case "sprintx.f1": return ft !== null && alem(ft, "f2") ? ok("estágio ≥ f2 (base/00-INDICE.md)") : nao("base ainda não gravada");
    case "sprintx.f2": return ft !== null && alem(ft, "f3") && ft.decisoes_pendentes === 0 ? ok("estágio ≥ f3 sem decisões pendentes") : nao("descoberta com decisões pendentes");
    case "sprintx.f3": return ft !== null && alem(ft, "f4") ? ok("estágio ≥ f4 (sprint-01/)") : nao("sprints ainda não gravadas");
    case "sprintx.f35": return ft !== null && sondas.existe(`${ft.pasta}/00-ESTIMATIVA.md`) ? ok("00-ESTIMATIVA.md existe") : nao("estimativa ainda não gravada");
    case "sprintx.f4": return ft !== null && alem(ft, "f5") ? ok("estágio ≥ f5 (ORQUESTRADOR.md)") : nao("orquestrador ainda não gravado");
    case "sprintx.f5": {
      if (ft === null) return nao("sem feature");
      if (rodada > 1 && !recente(sondas, `${ft.pasta}/00-AUDITORIA.md`, desde)) return nao("aguardando nova auditoria desta rodada");
      if (ft.veredito_auditoria === "sim") return ok("veredito da auditoria: SIM");
      if (ft.veredito_auditoria === "nao") return reprovou("veredito da auditoria: NÃO");
      return nao("auditoria sem veredito");
    }
    case "sprintx.f6": return ft !== null && ft.status === "concluido" ? ok("feature concluída (FECHAMENTO.md)") : nao("execução em andamento");

    case "prodx.p1": return sondas.existe("docs/produto/PRODUTO.md") ? ok("PRODUTO.md existe") : nao("PRODUTO.md ainda não gravado");
    case "prodx.p0": return recente(sondas, "docs/produto/pedidos/INDICE.md", desde) || pd !== null ? ok("triagem registrada (INDICE.md / pedido)") : nao("triagem sem registro");
    case "prodx.p25": return pd !== null && pd.prodx?.veredito != null ? ok("VEREDITO.md com veredito") : nao("avaliação sem veredito");
    case "prodx.assinatura": return pd !== null && pd.prodx?.assinado === true ? ok("veredito assinado pela pessoa") : nao("aguardando a assinatura humana");
    case "prodx.briefing": return pd !== null && pd.prodx?.briefing === true ? ok("BRIEFING.md gravado") : nao("briefing pendente");

    case "buildx.condutor": return pj !== null && pj.status === "concluido" ? ok("projeto concluído (VALIDACAO.md)") : nao("projeto em andamento");

    case "mergex.check": return t !== null && (t.entrega?.portao === "pronto" || t.entrega?.portao === "bloqueado") ? ok(`portão: ${t.entrega?.portao}`) : nao("portão sem resultado");
    case "mergex.atencao": return t !== null && sondas.existe(`docs/entregas/${refDoTrabalho(t)}/ATENCAO.md`) ? ok("ATENCAO.md existe") : nao("atenção ainda não gravada");
    case "mergex.qa": return t !== null && sondas.existe(`docs/entregas/${refDoTrabalho(t)}/QA-PACOTE.md`) ? ok("QA-PACOTE.md existe") : nao("pacote do QA ainda não gravado");
    case "mergex.pr": {
      if (t === null) return nao("sem trabalho");
      const pr = t.entrega?.pr_estado;
      if (pr === "rascunho" || pr === "aberto" || pr === "merged") return ok(`PR ${pr}`);
      if (sondas.existe(`docs/entregas/${refDoTrabalho(t)}/PR.md`) && t.entrega?.estado != null) return ok("PR.md + estado da entrega");
      return nao("PR ainda não aberto");
    }
    case "mergex.revisar": return t !== null && t.entrega?.pr_estado === "merged" ? ok("PR mergeado pela pessoa") : nao("ação humana: nunca concluída pelo Maestro");

    case "legadox.perfil": return sondas.existe("docs/legado/PERFIL.md") ? ok("PERFIL.md existe") : nao("perfil ainda não gravado");
    case "legadox.raio": return t !== null && t.raio?.faixa != null ? ok(`raio ${t.raio.faixa}`) : nao("raio ainda não calculado");
    case "legadox.caracterizar": return t !== null && sondas.existe(`docs/legado/caracterizacao/${refDoTrabalho(t)}.md`) ? ok("caracterização gravada") : nao("caracterização pendente");
    case "legadox.divida": return sondas.existe("docs/legado/DIVIDA.md") ? ok("DIVIDA.md existe") : nao("dívida ainda não gravada");
    case "legadox.manual": return sondas.existe("docs/legado/MANUAL.md") ? ok("MANUAL.md existe") : nao("manual ainda não gravado");

    case "stackx.detectar": return recente(sondas, "docs/stack/CONVENCOES.md", desde) ? ok("CONVENCOES.md gravado") : nao("convenções ainda não gravadas");
    case "stackx.check": case "stackx.atualizar": case "onboarding.executar":
      return ctx.pane_pronto === true ? ok("Pane concluiu (sem artefato próprio)", "rastro") : nao("aguardando o Pane concluir");
    case "designx.cartography": return recente(sondas, "docs/design-system/DESIGN-SYSTEM.md", desde) ? ok("DESIGN-SYSTEM.md gravado") : nao("cartografia pendente");
    case "designx.audit": return recente(sondas, "docs/design-system/AUDIT.md", desde) ? ok("AUDIT.md gravado") : nao("auditoria pendente");

    case "rapido.executar": return (ctx.rapido_relatorio ?? null) !== null && ctx.pane_pronto === true ? ok("rapido-relatorio.md válido") : nao("relatório rápido ausente");
    case "memox.consultar": case "consulta.rag": return nao("etapa de consulta: concluída pelo próprio Maestro");
    default: return nao("etapa sem regra de conclusão");
  }
}

// ---------------------------------------------------------------- fila de execuções
export interface ExecMinima {
  etapa_id: EtapaId;
  estado: EstadoEtapa;
  rodada: number;
}
const EM_VOO: readonly EstadoEtapa[] = ["despachando", "executando", "aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "sem_progresso"];
const FINAIS: readonly EstadoEtapa[] = ["concluida", "pulada_nivel", "pulada_usuario", "falhou"];

export type Proxima =
  | { tipo: "etapa"; indice: number }
  | { tipo: "laco"; indice_reprovada: number; de: EtapaId; para: EtapaId }
  | { tipo: "em_voo"; indice: number }
  | { tipo: "fim" };

/**
 * Próxima exec elegível sobre a LISTA ORDENADA de execuções (o plano vigente + tentativas de laço inseridas logo depois da reprovada).
 * `lacos`: etapa avaliadora → etapa a que se volta. Reprovada sem nova tentativa seguinte ⇒ `laco`.
 */
export function proximaEtapa(execs: readonly ExecMinima[], lacos: Readonly<Partial<Record<EtapaId, EtapaId>>> = {}): Proxima {
  for (let i = 0; i < execs.length; i++) {
    const e = execs[i] as ExecMinima;
    if (FINAIS.includes(e.estado)) continue;
    if (e.estado === "reprovada") {
      const destino = lacos[e.etapa_id];
      const jaReaberta = execs.slice(i + 1).some((x) => x.etapa_id === e.etapa_id && x.rodada > e.rodada);
      if (destino !== undefined && !jaReaberta) return { tipo: "laco", indice_reprovada: i, de: e.etapa_id, para: destino };
      continue;
    }
    if (EM_VOO.includes(e.estado)) return { tipo: "em_voo", indice: i };
    return { tipo: "etapa", indice: i };
  }
  return { tipo: "fim" };
}

export interface Divergencia {
  indice: number;
  etapa_id: EtapaId;
  motivo: string;
}
/**
 * O disco já mostra concluída uma etapa POSTERIOR a uma ainda aberta (a skill avançou sozinha no mesmo terminal).
 * Devolve as execs que o disco já concluiu depois da primeira aberta ("avançou na mesma sessão").
 */
export function divergencias(execs: ReadonlyArray<ExecMinima & { tentativa?: number }>, trabalho: TrabalhoParaMaestro | null, ctxDe: (indice: number) => ContextoConclusao = () => ({})): Divergencia[] {
  const primeira = execs.findIndex((e) => !FINAIS.includes(e.estado) && e.estado !== "reprovada");
  if (primeira < 0) return [];
  const saida: Divergencia[] = [];
  for (let i = primeira + 1; i < execs.length; i++) {
    const e = execs[i] as ExecMinima;
    if (FINAIS.includes(e.estado) || e.estado === "reprovada") continue;
    const r = etapaConcluida(e.etapa_id, trabalho, ctxDe(i));
    if (r.concluida && !r.reprovada) saida.push({ indice: i, etapa_id: e.etapa_id, motivo: r.motivo });
  }
  return saida;
}
