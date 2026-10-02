// T-16.10 · Padrões de fábrica por etapa [DEC] (todos editáveis; `atualizado_por: "fabrica"`) e perfis prontos em lote.
// Só modelos confirmados entram por nome; o resto vai por FAIXA (modelo `null`: a faixa escolhe). CLI padrão `claude` (executa o método por inteiro);
// avaliadores nascem em `auto`: o harness escolhe provedor ≠ do implementador quando houver (D-21) e V1 passa por construção.
import type { EtapaConfig, EtapaId, ModoExecucao } from "../../../compartilhado/maestro";
import type { Faixa } from "../../../compartilhado/harness";
import { aplicarPerfilPronto, ID_ECONOMICO, ID_EQUILIBRADO, ID_MAXIMA_QUALIDADE, perfisProntosDeFabrica, type PerfilPronto } from "../../harness/perfil";
import { ETAPAS, etapaDef, type EtapaDef } from "../etapas/catalogo";

type Linha = [faixa: Faixa, esforco: string | null];
const ALTO_ALTO: Linha = ["alto", "alto"];
const FABRICA: Readonly<Record<EtapaId, Linha>> = {
  "memox.consultar": ["rapido", null],
  "prodx.p1": ["alto", "medio"],
  "prodx.p0": ["rapido", "baixo"],
  "prodx.p25": ALTO_ALTO,
  "prodx.assinatura": ["alto", null],
  "prodx.briefing": ["medio", "baixo"],
  "legadox.perfil": ALTO_ALTO,
  "legadox.raio": ALTO_ALTO,
  "legadox.caracterizar": ["medio", "medio"],
  "legadox.divida": ["medio", "baixo"],
  "legadox.manual": ["medio", "baixo"],
  "runx.e1": ["topo", "alto"],
  "runx.e2": ALTO_ALTO,
  "runx.e3": ["medio", "medio"],
  "runx.e4": ["alto", "alto"],
  "runx.e5": ["medio", "baixo"],
  "sprintx.f1": ALTO_ALTO,
  "sprintx.f2": ["topo", "medio"],
  "sprintx.f3": ["topo", "alto"],
  "sprintx.f35": ["rapido", "baixo"],
  "sprintx.f4": ["medio", "medio"],
  "sprintx.f5": ["topo", "alto"],
  "sprintx.f6": ["medio", "medio"],
  "stackx.detectar": ALTO_ALTO,
  "stackx.check": ALTO_ALTO,
  "stackx.atualizar": ["medio", "baixo"],
  "designx.cartography": ALTO_ALTO,
  "designx.audit": ALTO_ALTO,
  "mergex.check": ["rapido", "baixo"],
  "mergex.atencao": ALTO_ALTO,
  "mergex.qa": ["rapido", "baixo"],
  "mergex.pr": ["rapido", "baixo"],
  "mergex.revisar": ["alto", null],
  "buildx.condutor": ["topo", "alto"],
  "onboarding.executar": ["medio", "medio"],
  "rapido.executar": ["medio", "medio"],
  "consulta.rag": ["rapido", "baixo"],
};

export const CLI_PADRAO_DO_METODO = "claude";

/** Config de fábrica de uma etapa (cópia nova). Etapas humanas não têm perfil útil (a UI as trava). */
export function configDeFabrica(etapa: EtapaId): EtapaConfig {
  const def = etapaDef(etapa) as EtapaDef;
  const [faixa, esforco] = FABRICA[etapa];
  const skills = def.comando === null ? [] : [def.comando];
  return {
    etapa_id: etapa,
    perfil: { cli: def.tipo === "avaliador" ? "auto" : CLI_PADRAO_DO_METODO, modelo: null, esforco, faixa, origem_modelo: "cli", agente_id: null },
    skills,
    modo_execucao: "novo_terminal" as ModoExecucao,
    atualizado_por: "fabrica",
  };
}
export const configsDeFabrica = (): EtapaConfig[] => ETAPAS.filter((e) => !e.humano).map((e) => configDeFabrica(e.id));

// ---------------------------------------------------------------- perfis prontos em lote (Econômico / Equilibrado / Máxima qualidade)
export { ID_ECONOMICO, ID_EQUILIBRADO, ID_MAXIMA_QUALIDADE };
export const perfisProntosDoMaestro = (): PerfilPronto[] => perfisProntosDeFabrica();

/**
 * Aplica um perfil pronto a TODAS as etapas (um clique): `faixa` pelo tipo da etapa (task_type), `modelo: null` (a faixa escolhe) e esforço pela faixa.
 * `cli` fica como está (padrão) ou vira `auto`. Etapas humanas e `desligada` não mudam. Não muta a entrada.
 */
export function aplicarPerfilProntoAsEtapas(pronto: PerfilPronto, configs: readonly EtapaConfig[], opcoes: { cli?: "manter" | "auto"; esforco?: boolean } = {}): EtapaConfig[] {
  const itens = configs.map((c) => ({ c, task_type: etapaDef(c.etapa_id)?.task_type ?? "geral", perfil: { cli: c.perfil.cli, modelo: c.perfil.modelo, esforco: c.perfil.esforco, faixa: c.perfil.faixa } }));
  const editaveis = itens.filter((i) => etapaDef(i.c.etapa_id)?.humano !== true && i.c.modo_execucao !== "desligada");
  const aplicados = aplicarPerfilPronto(pronto, editaveis, opcoes);
  const porEtapa = new Map(aplicados.map((a) => [a.c.etapa_id, a] as const));
  return configs.map((c) => {
    const a = porEtapa.get(c.etapa_id);
    if (a === undefined) return { ...c };
    return { ...c, perfil: { ...c.perfil, cli: a.perfil.cli, modelo: a.perfil.modelo, esforco: a.perfil.esforco, faixa: a.perfil.faixa }, atualizado_por: "usuario" as const };
  });
}
