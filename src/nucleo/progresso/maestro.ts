// Derivador (a): um pipeline do Maestro em execução -> `Progresso`. PURO. As etapas vêm do plano (catálogo), os estados das execuções e o portão humano
// vira "aguardando você". Nada do texto do usuário entra além de `texto_resumo`, que o Maestro já grava redigido (≤ 200) e aqui é cortado em 60.
import type { EstadoEtapa, EstadoPipeline, EtapaDoPlano, EtapaExec, PipelineId } from "../../compartilhado/maestro";
import { cortarRotulo, LIMITE_ITENS_PROGRESSO, type EstadoItemProgresso, type ItemProgresso, type Progresso, type ResultadoProgresso } from "../../compartilhado/progresso";
import { etapaDef } from "../maestro/etapas/catalogo";

/** O que o derivador lê de um pipeline (subconjunto estrutural de `PipelineEstado` e de `DetalhePipeline`). */
export interface PipelineParaProgresso {
  id: string;
  workspace_id: string;
  trabalho_id: string | null;
  pipeline_id: PipelineId;
  estado: EstadoPipeline;
  texto_resumo: string;
  plano: { etapas: ReadonlyArray<Pick<EtapaDoPlano, "etapa_id" | "ordem" | "estado_inicial" | "tipo">> };
  execs: ReadonlyArray<Pick<EtapaExec, "etapa_id" | "ordem" | "tentativa" | "rodada" | "estado" | "pane_id" | "inicio_em" | "fim_em" | "detalhe">>;
  motivo_fim: string | null;
  criado_em: string;
  concluido_em: string | null;
}

export const ROTULO_DO_PIPELINE: Readonly<Record<PipelineId, string>> = {
  runx: "corrigir bug",
  sprintx: "nova feature",
  sprintx_legadox: "refatoração em legado",
  prodx: "pedido cru",
  buildx: "projeto inteiro",
  mergex: "entrega",
  stackx: "convenções",
  designx: "design",
  onboarding: "onboarding",
  rapido: "alteração rápida",
  consulta: "consulta",
  controle: "controle",
};

const ESTADO_DA_ETAPA: Readonly<Record<EstadoEtapa, EstadoItemProgresso>> = {
  pendente: "pendente",
  pulada_nivel: "pulado",
  pulada_usuario: "pulado",
  despachando: "em_andamento",
  executando: "em_andamento",
  aguardando_humano: "aguardando",
  aguardando_usuario: "aguardando",
  aguardando_confirmacao: "aguardando",
  concluida: "concluido",
  reprovada: "falhou",
  falhou: "falhou",
  sem_progresso: "aguardando",
};

const DETALHE_DA_ESPERA: Readonly<Partial<Record<EstadoEtapa, string>>> = {
  aguardando_humano: "aguardando você",
  aguardando_usuario: "responda no terminal",
  aguardando_confirmacao: "confirme para seguir",
  sem_progresso: "sem progresso",
  reprovada: "reprovada",
};

const DETALHE_DO_PIPELINE: Readonly<Partial<Record<EstadoPipeline, string>>> = {
  aguardando_humano: "aguardando você",
  aguardando_usuario: "responda no terminal",
  aguardando_confirmacao: "confirme para seguir",
  bloqueado_piso: "piso de qualidade",
  bloqueado_trava: "trava de segurança",
  pausado: "pausado",
};

const ms = (iso: string | null): number | undefined => {
  if (iso === null) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
};

export function resultadoDoPipeline(estado: EstadoPipeline): ResultadoProgresso | null {
  switch (estado) {
    case "proposto":
      return null;
    case "executando":
      return "em_andamento";
    case "aguardando_humano":
    case "aguardando_usuario":
    case "aguardando_confirmacao":
    case "bloqueado_piso":
    case "bloqueado_trava":
    case "pausado":
      return "aguardando";
    case "concluido":
    case "concluido_parcial":
      return "concluido";
    case "falhou":
      return "falhou";
    case "cancelado":
    case "expirado":
      return "cancelado";
  }
}

/** A execução vigente de cada etapa: a de maior rodada e tentativa (o laço de reprovação cria novas). */
function execVigente(execs: PipelineParaProgresso["execs"], etapaId: string): PipelineParaProgresso["execs"][number] | undefined {
  let melhor: PipelineParaProgresso["execs"][number] | undefined;
  for (const e of execs) {
    if (e.etapa_id !== etapaId) continue;
    if (melhor === undefined || e.rodada > melhor.rodada || (e.rodada === melhor.rodada && e.tentativa > melhor.tentativa)) melhor = e;
  }
  return melhor;
}

export function derivarDoMaestro(p: PipelineParaProgresso, sessaoDoPane: (paneId: string) => string | null = () => null): Progresso | null {
  const resultado = resultadoDoPipeline(p.estado);
  if (resultado === null) return null; // plano proposto: ainda não foi confirmado, nada a acompanhar
  const etapas = [...p.plano.etapas].sort((a, b) => a.ordem - b.ordem).slice(0, LIMITE_ITENS_PROGRESSO);
  const itens: ItemProgresso[] = etapas.map((et) => {
    const exec = execVigente(p.execs, et.etapa_id);
    const def = etapaDef(et.etapa_id);
    const item: ItemProgresso = { id: et.etapa_id, rotulo: cortarRotulo(def?.nome ?? et.etapa_id), estado: "pendente" };
    if (exec === undefined) {
      if (et.estado_inicial === "pulada_nivel" || et.estado_inicial === "pulada_usuario") item.estado = "pulado";
      else if (et.estado_inicial === "humano") item.detalhe = "só você";
      else if (et.estado_inicial === "confirmar") item.detalhe = "pede confirmação";
      return item;
    }
    item.estado = ESTADO_DA_ETAPA[exec.estado];
    const detalhe = DETALHE_DA_ESPERA[exec.estado] ?? (exec.tentativa > 1 || exec.rodada > 1 ? `volta ${Math.max(exec.tentativa, exec.rodada)}` : undefined);
    if (detalhe !== undefined) item.detalhe = detalhe;
    const desde = ms(exec.inicio_em);
    if (desde !== undefined && item.estado !== "pendente" && item.estado !== "pulado") item.desde = desde;
    const fim = ms(exec.fim_em);
    if (fim !== undefined && (item.estado === "concluido" || item.estado === "falhou")) item.fim_em = fim;
    if (exec.pane_id !== null && item.estado !== "pulado") {
      const s = sessaoDoPane(exec.pane_id);
      if (s !== null) item.sessao_id = s;
    }
    return item;
  });

  // pipeline esperando alguém sem que nenhuma etapa mostre isso (portão humano ainda "pendente"): marca a primeira etapa viva
  if (resultado === "aguardando" && !itens.some((i) => i.estado === "aguardando")) {
    const alvo = itens.find((i) => i.estado === "em_andamento") ?? itens.find((i) => i.estado === "pendente");
    if (alvo !== undefined) {
      alvo.estado = "aguardando";
      const d = DETALHE_DO_PIPELINE[p.estado];
      if (d !== undefined) alvo.detalhe = d;
    }
  }
  // pipeline falhou sem etapa marcada: a etapa viva ou a primeira pendente carrega a falha, para o resumo "Parou na etapa X"
  if (resultado === "falhou" && !itens.some((i) => i.estado === "falhou")) {
    const alvo = itens.find((i) => i.estado === "em_andamento") ?? itens.find((i) => i.estado === "aguardando") ?? itens.find((i) => i.estado === "pendente");
    if (alvo !== undefined) {
      alvo.estado = "falhou";
      if (p.motivo_fim !== null) alvo.detalhe = cortarRotulo(p.motivo_fim, 40);
    }
  }
  const concluido = resultado === "concluido";
  const resumo = cortarRotulo(p.texto_resumo);
  const out: Progresso = {
    id: `pl:${p.id}`,
    origem: "maestro",
    titulo: `Pipeline: ${ROTULO_DO_PIPELINE[p.pipeline_id] ?? p.pipeline_id}`,
    itens,
    concluido,
    workspace_id: p.workspace_id,
    resultado,
    previsto: false,
    iniciado_em: ms(p.criado_em) ?? 0,
    fim_em: resultado === "concluido" || resultado === "falhou" || resultado === "cancelado" ? (ms(p.concluido_em) ?? null) : null,
  };
  if (resumo !== "") out.pedido = resumo;
  return out;
}
