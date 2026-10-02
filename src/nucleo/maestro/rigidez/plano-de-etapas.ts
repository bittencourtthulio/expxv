// T-16.15 · `planoDeEtapas(pipeline, nivel, ctx)`: PURO e determinístico (≤ 1 ms). Aplica célula ○/◐/◆/⛓/H/R, condições por EVIDÊNCIA do disco,
// agrupamento (só planejadores/implementadores do mesmo perfil), reforços e etapas obrigatórias (piso nunca é omitido; I10).
// O ADE não "pula por dentro" de skill (D-226): o que o nível dispensa simplesmente não é DESPACHADO.
import type { EtapaDoPlano, EtapaId, NivelRigidez, PipelineId } from "../../../compartilhado/maestro";
import type { PermissaoMembro } from "../../../compartilhado/squads";
import { etapaDef, PIPELINES, PIPELINES_SUBSTITUIVEIS_NO_NIVEL_1, type CondicaoEtapa, type EtapaDef } from "../etapas/catalogo";
import { celaDe, MATRIZ_RIGIDEZ } from "./matriz";

export type FaixaRaio = "baixo" | "medio" | "alto";
export interface EvidenciaDoDisco {
  /** `docs/legado/PERFIL.md` existe (modo legado). */
  legado: boolean;
  /** há perfil do legado (para decidir `legadox.perfil` no sprintx_legadox). */
  perfil_legado?: boolean;
  convencoes: boolean;
  design_system: boolean;
  /** a mudança toca UI (desconhecido ⇒ assume que sim quando há design system). */
  toca_ui?: boolean;
  /** `docs/produto/PRODUTO.md` existe. */
  produto: boolean;
  raio: FaixaRaio | null;
}
export const EVIDENCIA_VAZIA: EvidenciaDoDisco = { legado: false, perfil_legado: false, convencoes: false, design_system: false, produto: true, raio: null };

export interface ContextoPlano {
  evidencia: EvidenciaDoDisco;
  /** resumo `cli·modelo·esforço` por etapa (para agrupar só com o mesmo perfil e para exibir). */
  resumoPerfil?: (etapa: EtapaId) => string | null;
  /** CLI usada para montar o esqueleto do comando exibido (padrão `claude`). */
  cli?: (etapa: EtapaId) => string | null;
  /** `modo_execucao` por etapa vindo da configuração. */
  modoExecucao?: (etapa: EtapaId) => "novo_terminal" | "reusar_terminal" | "confirmar" | "desligada" | null;
  /** etapas que o usuário desligou ao confirmar (só vale para etapas não obrigatórias). */
  desligadas?: ReadonlySet<EtapaId>;
  /** perfil de permissão do workspace (padrão `seguro`): decide se `mergex.pr` exige clique. */
  permissao?: PermissaoMembro;
}

const AGRUPAVEIS = new Set(["investigador", "planejador", "implementador"]);

function condicaoAtendida(def: EtapaDef, condicao: CondicaoEtapa | null, pipeline: PipelineId, ev: EvidenciaDoDisco, satisfeita: boolean): boolean {
  if (condicao === null || satisfeita) return true;
  const legado = ev.legado || pipeline === "sprintx_legadox";
  switch (condicao) {
    case "legado": return legado;
    case "legado_raio_medio": return pipeline === "sprintx_legadox" || (ev.legado && (ev.raio === null || ev.raio === "medio" || ev.raio === "alto"));
    case "convencoes": return ev.convencoes;
    case "design_system": return ev.design_system && ev.toca_ui !== false;
    case "sem_produto": return !ev.produto;
    case "sem_perfil_legado": return ev.perfil_legado !== true;
    default: return def.condicao === null;
  }
}

const argumentoModelo = (def: EtapaDef): string => (def.argumento === "id" ? "<id>" : def.argumento === "alvo" ? "<alvo>" : "<pedido>");
function esqueletoDoComando(def: EtapaDef, cli: string | null): string | null {
  if (def.comando === null || def.humano) return null;
  const prefixo = cli === "opencode" ? "/" : "/expx:";
  return `${prefixo}${def.comando} ${argumentoModelo(def)}`;
}

/** O pipeline efetivo para o nível: 1 (Relâmpago) troca runx/sprintx/sprintx_legadox por `rapido`. */
export const pipelineEfetivo = (pipeline: PipelineId, nivel: NivelRigidez): PipelineId => (nivel === 1 && PIPELINES_SUBSTITUIVEIS_NO_NIVEL_1.includes(pipeline) ? "rapido" : pipeline);

export function planoDeEtapas(pipelineBase: PipelineId, nivel: NivelRigidez, ctx: ContextoPlano): EtapaDoPlano[] {
  const pipeline = pipelineEfetivo(pipelineBase, nivel);
  const def = PIPELINES[pipeline];
  const ev = ctx.evidencia;
  const saida: EtapaDoPlano[] = [];
  let ultimoAtivo: EtapaDoPlano | null = null;

  for (const passo of def.passos) {
    const etapa = etapaDef(passo.etapa) as EtapaDef;
    const condicao = etapa.condicao ?? (passo.etapa === "legadox.perfil" && pipelineBase === "sprintx_legadox" ? "sem_perfil_legado" : null);
    if (!condicaoAtendida(etapa, condicao, pipelineBase, ev, passo.condicao_satisfeita === true)) continue;

    let cela = celaDe(pipeline, passo.etapa, nivel);
    const piso = etapa.piso || passo.piso === true;
    if (piso && (cela.modo === "omitida" || cela.modo === "substituida")) cela = { modo: "roda" }; // I10: piso nunca é omitido
    const padrao = MATRIZ_RIGIDEZ[passo.etapa][3];
    const base = {
      etapa_id: passo.etapa, ordem: saida.length + 1, tipo: etapa.tipo, perfil: null as null, resumo_perfil: ctx.resumoPerfil?.(passo.etapa) ?? null,
      piso, reduz: false, reforco: null as string | null, agrupa_com_anterior: false,
    };

    if (cela.modo === "omitida" || cela.modo === "substituida") {
      // só lista o que o NÍVEL tirou do método padrão; extras que só existem acima do padrão simplesmente não aparecem
      if (padrao.modo !== "omitida" && padrao.modo !== "substituida") {
        saida.push({ ...base, estado_inicial: "pulada_nivel", comando: null, motivo: cela.modo === "substituida" ? "substituída pelo pipeline rápido" : "dispensada pelo nível de rigidez" });
      }
      continue;
    }
    if (etapa.humano || cela.modo === "humano") {
      saida.push({ ...base, estado_inicial: "humano", comando: null, motivo: passo.etapa === "mergex.revisar" ? "o merge é seu: o Maestro nunca dispara a revisão" : "ação humana: o Maestro só avisa e leva ao arquivo" });
      ultimoAtivo = null;
      continue;
    }
    const modo = ctx.modoExecucao?.(passo.etapa) ?? null;
    if (!piso && (modo === "desligada" || ctx.desligadas?.has(passo.etapa) === true)) {
      saida.push({ ...base, estado_inicial: ctx.desligadas?.has(passo.etapa) === true ? "pulada_usuario" : "pulada_nivel", comando: null, motivo: ctx.desligadas?.has(passo.etapa) === true ? "desligada por você" : "desligada na configuração da etapa" });
      continue;
    }
    // push/PR confirma em `seguro` e `equilibrado`; o briefing do prodx e a continuação são SEMPRE por clique
    const confirmar = modo === "confirmar" || (cela.confirma === true && (ctx.permissao ?? "seguro") !== "automatico") || passo.etapa === "prodx.briefing";
    const resumo = base.resumo_perfil;
    const podeAgrupar =
      cela.agrupa === true && ultimoAtivo !== null && AGRUPAVEIS.has(ultimoAtivo.tipo) && AGRUPAVEIS.has(etapa.tipo) && (ultimoAtivo.resumo_perfil ?? null) === (resumo ?? null) && !confirmar;
    const item: EtapaDoPlano = {
      ...base,
      estado_inicial: confirmar ? "confirmar" : "pendente",
      comando: esqueletoDoComando(etapa, ctx.cli?.(passo.etapa) ?? "claude"),
      reduz: cela.modo === "reduzida",
      reforco: cela.modo === "reforco" ? (cela.nota ?? null) : null,
      agrupa_com_anterior: podeAgrupar,
      motivo: cela.modo === "reduzida" ? (cela.nota ?? null) : null,
      ...(cela.avaliacoes === undefined ? {} : { avaliacoes: cela.avaliacoes }),
    };
    saida.push(item);
    ultimoAtivo = etapa.tipo === "consulta" ? ultimoAtivo : item;
  }
  return saida;
}

/** Etapas de piso aplicáveis ao pipeline/evidência (para a propriedade P1 e a validação do plano). */
export function etapasDePisoAplicaveis(pipelineBase: PipelineId, nivel: NivelRigidez, ev: EvidenciaDoDisco): EtapaId[] {
  const pipeline = pipelineEfetivo(pipelineBase, nivel);
  const saida: EtapaId[] = [];
  for (const passo of PIPELINES[pipeline].passos) {
    const etapa = etapaDef(passo.etapa) as EtapaDef;
    if (!(etapa.piso || passo.piso === true)) continue;
    const condicao = etapa.condicao;
    if (condicaoAtendida(etapa, condicao, pipelineBase, ev, passo.condicao_satisfeita === true)) saida.push(passo.etapa);
  }
  return saida;
}
