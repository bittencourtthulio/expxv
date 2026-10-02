// T-16.07 · `planejar(intencao, rigidez, config) → PlanoMaestro`: função PURA e determinística (≤ 1 ms). Junta intenção → pipeline, retomada pelo disco,
// nível de rigidez (planoDeEtapas), trava, hooks a aplicar e as regras de "executar direto". Nada de relógio, disco ou rede: tudo entra pela configuração.
import { INTENCOES_ACIONAVEIS, VIAS_REMOTAS, type EtapaDoPlano, type EtapaId, type FonteIntencao, type Intencao, type NivelRigidez, type PipelineId, type PlanoMaestro, type ResultadoClassificacao, type ViaMaestro } from "../../compartilhado/maestro";
import type { PermissaoMembro } from "../../compartilhado/squads";
import { PIPELINE_DA_INTENCAO, PIPELINES, etapaDef } from "./etapas/catalogo";
import { etapaConcluida, type SondaDeDisco, type TrabalhoParaMaestro } from "./etapas/conclusao";
import { FAIXA_ALTA } from "./intencao/combinar";
import { perfilDaEtapa, resumoDoPerfil, type FontesDePerfil } from "./perfis/resolver";
import { hooksDoNivel } from "./rigidez/hooks";
import { pipelineEfetivo, planoDeEtapas, type EvidenciaDoDisco } from "./rigidez/plano-de-etapas";
import type { OrigemNivel } from "./rigidez/escopos";

export const PROPOSTA_EXPIRA_MIN = 30;

export interface EntradaDePlano extends Pick<ResultadoClassificacao, "intencao" | "confianca" | "candidatas" | "retomar"> {
  fonte: FonteIntencao;
  so_humano?: boolean;
}
export interface ConfigDePlano {
  id: string;
  agora_ms: number;
  evidencia: EvidenciaDoDisco;
  fontes?: FontesDePerfil;
  permissao?: PermissaoMembro;
  nivel_origem?: OrigemNivel;
  trava?: { minimo: NivelRigidez; motivo: string } | null;
  /** o usuário já deu override registrado da trava (nível abaixo do mínimo é permitido). */
  override_trava?: boolean;
  /** trabalho existente citado no pedido (retomada): o plano começa na etapa que o disco indica. */
  trabalho?: { trabalho: TrabalhoParaMaestro; sondas?: SondaDeDisco } | null;
  /** já existe pipeline ativo para o mesmo alvo (Missão/trabalho). */
  pipeline_ativo_no_alvo?: boolean;
  desligadas?: ReadonlySet<EtapaId>;
  /** módulos da suíte desligados no projeto (D-480): pipeline que usa skill de módulo desligado vira indisponível. */
  modulos_desligados?: ReadonlySet<string>;
  /** `maestro.confirmar_plano = 0` + o workspace permite "executar direto" e o pedido pediu. */
  executar_direto_permitido?: boolean;
  via?: ViaMaestro;
  branch_protegida?: boolean;
  /** o usuário já confirmou baixar a rigidez em branch protegida/produção. */
  confirmou_rigidez_baixa?: boolean;
  expira_min?: number;
}

/** Só estas intenções seguem o TIPO do trabalho citado; entrega, convenções etc. mantêm o próprio pipeline. */
const INTENCOES_DE_TRABALHO: readonly Intencao[] = ["bug", "feature", "refatoracao", "pedido"];
const PIPELINE_DO_TIPO: Readonly<Record<TrabalhoParaMaestro["tipo"], PipelineId>> = { ocorrencia: "runx", feature: "sprintx", pedido: "prodx", projeto: "buildx" };

const etapaUnica = (etapa_id: EtapaId, ordem: number, estado_inicial: EtapaDoPlano["estado_inicial"], motivo: string | null): EtapaDoPlano => {
  const def = etapaDef(etapa_id);
  return { etapa_id, ordem, estado_inicial, tipo: def?.tipo ?? "humano", comando: null, perfil: null, resumo_perfil: null, reduz: false, piso: false, reforco: null, agrupa_com_anterior: false, motivo };
};

/** Remove as etapas que o DISCO já mostra concluídas (retomada): o plano começa onde o trabalho está. */
function aPartirDoDisco(etapas: EtapaDoPlano[], t: TrabalhoParaMaestro, sondas: SondaDeDisco | undefined): { etapas: EtapaDoPlano[]; jaConcluidas: EtapaId[] } {
  const jaConcluidas: EtapaId[] = [];
  let corte = 0;
  for (let i = 0; i < etapas.length; i++) {
    const e = etapas[i] as EtapaDoPlano;
    const def = etapaDef(e.etapa_id);
    if (def === null || def.tipo === "consulta" || e.estado_inicial === "humano") continue;
    const r = etapaConcluida(e.etapa_id, t, sondas === undefined ? {} : { sondas });
    if (r.concluida && !r.reprovada) {
      corte = i + 1;
      jaConcluidas.push(e.etapa_id);
    } else break;
  }
  const restantes = etapas.slice(corte).map((e, i) => ({ ...e, ordem: i + 1 }));
  return { etapas: restantes, jaConcluidas };
}

export function planejar(c: EntradaDePlano, nivel: NivelRigidez, cfg: ConfigDePlano): PlanoMaestro {
  const avisos: string[] = [];
  const expira_em = new Date(cfg.agora_ms + (cfg.expira_min ?? PROPOSTA_EXPIRA_MIN) * 60_000).toISOString();
  const base = {
    id: cfg.id, intencao: c.intencao, confianca: c.confianca, fonte: c.fonte, nivel, nivel_origem: cfg.nivel_origem ?? ("padrao" as OrigemNivel), avisos,
    trava: cfg.trava ?? null, hooks_a_aplicar: [] as PlanoMaestro["hooks_a_aplicar"], executar_direto: false, expira_em,
    alvo: { trabalho_id: null as string | null, retomada: false, estagio_atual: null as string | null },
  };

  // desconhecida: o Maestro PERGUNTA (candidatas); nunca propõe execução
  if (c.intencao === "desconhecida") {
    avisos.push("Não ficou claro o que fazer: escolha uma das candidatas ou reescreva o pedido.");
    return { ...base, pipeline_id: "controle", etapas: [], candidatas: c.candidatas.slice(0, 3) };
  }
  const pipelineBase = PIPELINE_DA_INTENCAO[c.intencao] ?? null;
  if (pipelineBase === null || pipelineBase === "controle") return { ...base, pipeline_id: "controle", etapas: [] };

  // B10: revisar/mergear o PR é só humano
  if (c.so_humano === true) {
    return { ...base, pipeline_id: "mergex", etapas: [etapaUnica("mergex.revisar", 1, "humano", "o merge é seu: o Maestro nunca dispara a revisão nem o merge")], candidatas: [] };
  }

  // retomada: o pipeline segue o tipo do trabalho citado
  let pipeline: PipelineId = pipelineBase;
  const legado = cfg.evidencia.legado;
  if (cfg.trabalho !== undefined && cfg.trabalho !== null && INTENCOES_DE_TRABALHO.includes(c.intencao)) {
    pipeline = c.intencao === "refatoracao" && cfg.trabalho.trabalho.tipo === "feature" ? "sprintx_legadox" : PIPELINE_DO_TIPO[cfg.trabalho.trabalho.tipo];
  }
  const efetivo = pipelineEfetivo(pipeline, nivel);

  const resumo = (e: EtapaId): string | null => (cfg.fontes === undefined ? null : resumoDoPerfil(perfilDaEtapa(e, cfg.fontes).config.perfil));
  const cliDe = (e: EtapaId): string | null => (cfg.fontes === undefined ? null : perfilDaEtapa(e, cfg.fontes).config.perfil.cli);
  const modo = (e: EtapaId): "novo_terminal" | "reusar_terminal" | "confirmar" | "desligada" | null => (cfg.fontes === undefined ? null : perfilDaEtapa(e, cfg.fontes).config.modo_execucao);
  let etapas = planoDeEtapas(pipeline, nivel, {
    evidencia: cfg.evidencia,
    resumoPerfil: resumo,
    cli: cliDe,
    modoExecucao: modo,
    ...(cfg.desligadas === undefined ? {} : { desligadas: cfg.desligadas }),
    ...(cfg.permissao === undefined ? {} : { permissao: cfg.permissao }),
  });

  const alvo = base.alvo;
  if (cfg.trabalho !== undefined && cfg.trabalho !== null) {
    alvo.trabalho_id = cfg.trabalho.trabalho.id;
    alvo.retomada = true;
    alvo.estagio_atual = cfg.trabalho.trabalho.estagio;
    const r = aPartirDoDisco(etapas, cfg.trabalho.trabalho, cfg.trabalho.sondas);
    etapas = r.etapas;
    if (r.jaConcluidas.length > 0) avisos.push(`Retomando ${alvo.trabalho_id}: o disco já mostra concluídas ${r.jaConcluidas.map((e) => e.split(".")[1]).join(", ")}.`);
    else avisos.push(`Retomando ${alvo.trabalho_id} na etapa que o disco indica.`);
  } else if (c.retomar !== null) {
    avisos.push(`O pedido cita ${c.retomar.id}, mas não achei esse trabalho no índice do método: o pipeline começa do início.`);
  }

  // módulos da suíte desligados (D-480): etapa de CONSULTA do módulo desligado só é dispensada; etapa com comando de módulo desligado torna o pipeline INDISPONÍVEL
  const off = cfg.modulos_desligados;
  if (off !== undefined && off.size > 0) {
    etapas = etapas.map((e) => {
      const def = etapaDef(e.etapa_id);
      return def !== null && def.comando === null && def.tipo === "consulta" && off.has(def.skill) && e.estado_inicial !== "pulada_nivel" ? { ...e, estado_inicial: "pulada_usuario" as const, motivo: `o módulo ${def.skill} está desligado neste projeto` } : e;
    });
    const bloqueados = [...new Set(etapas.filter((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario").map((e) => etapaDef(e.etapa_id)).filter((def) => def !== null && def.comando !== null && off.has(def.skill)).map((def) => (def as { skill: string }).skill))];
    if (bloqueados.length > 0) {
      avisos.push(`Este pipeline usa ${bloqueados.join(", ")}, que ${bloqueados.length > 1 ? "estão desligados" : "está desligado"} neste projeto: ative em Método › Módulos da suíte para executar.`);
      return { ...base, pipeline_id: efetivo, etapas, alvo, executar_direto: false, modulos_desligados: bloqueados };
    }
  }

  const pulou = etapas.filter((e) => e.estado_inicial === "pulada_nivel");
  if (pulou.length > 0) avisos.push(`Nível ${nivel}: ${pulou.length} etapa(s) dispensada(s) (dá para rodar depois).`);
  if (cfg.trava !== undefined && cfg.trava !== null && nivel < cfg.trava.minimo && cfg.override_trava !== true) avisos.push(`Trava: ${cfg.trava.motivo}.`);
  if (cfg.pipeline_ativo_no_alvo === true) avisos.push("Já há um pipeline em andamento para este alvo: abra esse ou crie outro (exige confirmação).");
  if (c.confianca < FAIXA_ALTA) avisos.push("Confiança média: confira a intenção ou escolha uma candidata antes de executar.");
  if (etapas.some((e) => e.etapa_id === "mergex.pr" && e.estado_inicial === "confirmar")) avisos.push("O push e o PR só saem com a sua confirmação.");

  const hooks = Object.entries(hooksDoNivel(nivel, { legado })).map(([nome, m]) => ({ nome, modo: m }));
  const primeira = etapas.find((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario");
  const remoto = cfg.via !== undefined && VIAS_REMOTAS.includes(cfg.via);
  const travaAtiva = cfg.trava !== undefined && cfg.trava !== null && nivel < cfg.trava.minimo && cfg.override_trava !== true;
  const direto =
    cfg.executar_direto_permitido === true &&
    c.confianca >= FAIXA_ALTA &&
    INTENCOES_ACIONAVEIS.includes(c.intencao as Intencao) &&
    !travaAtiva &&
    !remoto &&
    cfg.pipeline_ativo_no_alvo !== true &&
    primeira !== undefined &&
    primeira.estado_inicial !== "humano" &&
    !(((cfg.permissao ?? "seguro") === "seguro") && etapas.some((e) => e.etapa_id === "mergex.pr")) &&
    !(cfg.branch_protegida === true && nivel <= 2 && cfg.confirmou_rigidez_baixa !== true);

  return {
    ...base,
    pipeline_id: efetivo,
    etapas,
    alvo,
    hooks_a_aplicar: hooks,
    executar_direto: direto,
    ...(c.confianca < FAIXA_ALTA ? { candidatas: c.candidatas.slice(0, 3) } : {}),
  };
}

/** Alias do nome do plano (T-16.07). */
export const montarPlano = planejar;

/** Primeira etapa despachável do plano (para "executar direto" e para a UI). */
export const primeiraEtapaDoPlano = (p: PlanoMaestro): EtapaDoPlano | null => p.etapas.find((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario") ?? null;
/** `PIPELINES` reexportado para quem monta a UI a partir do plano. */
export const definicaoDoPipeline = (id: PipelineId) => PIPELINES[id];
