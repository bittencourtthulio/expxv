// T-16.20 · Máquina de estados do pipeline. PURA: `avancar(pipeline, observação) → { pipeline, acoes }`; os efeitos (abrir Pane, digitar comando, notificar,
// fechar Pane) são AÇÕES devolvidas, executadas por portas no serviço. O estado é serializável (retomável após reinício: reconstrói do banco + disco).
// O disco vence (D-19): conclusão vem de `etapaConcluida`, nunca do texto do terminal. Ações humanas continuam humanas (D-21).
import type { EstadoPane, Papel } from "../dominio/enums";
import { ESTADOS_PIPELINE_TERMINAIS, type EstadoEtapa, type EtapaDoPlano, type EtapaExec, type EtapaId, type PipelineEstado, type PlanoMaestro } from "../../compartilhado/maestro";
import type { PermissaoMembro } from "../../compartilhado/squads";
import { PIPELINES } from "./etapas/catalogo";
import { etapaConcluida, proximaEtapa, type ContextoConclusao, type RelatorioRapido, type SondaDeDisco, type TrabalhoParaMaestro } from "./etapas/conclusao";
import type { ItemDePiso } from "./rigidez/piso";
import { PARAMETROS_POR_NIVEL } from "./rigidez/matriz";

export interface ObservacaoDoDisco {
  agora_ms: number;
  trabalho: TrabalhoParaMaestro | null;
  sondas: SondaDeDisco;
  /** estado atual de cada Pane conhecido (id → estado); ausente = não existe mais. */
  panes: Readonly<Record<string, { estado: EstadoPane }>>;
  rapido_relatorio?: RelatorioRapido | null;
  ultima_task_concluida_ms?: number | null;
  /** última mudança de disco vista para este pipeline (ms); `null` = nenhuma. */
  ultima_mudanca_ms?: number | null;
  piso?: readonly ItemDePiso[];
  permissao?: PermissaoMembro;
  max_terminais: number;
  timeout_sem_progresso_ms: number;
  fechar_concluidos: boolean;
}

export type MotivoNotificacao = "humano" | "raio_alto" | "confirmacao" | "usuario_responde" | "sem_progresso" | "trava" | "piso" | "falhou" | "concluido" | "limite_de_voltas" | "expirado";
export type Acao =
  | { tipo: "despachar"; etapa_id: EtapaId; indice: number; tentativa: number; rodada: number; papel: Papel; reusar_pane_id: string | null; nivel: number }
  | { tipo: "consultar"; etapa_id: EtapaId }
  | { tipo: "notificar"; motivo: MotivoNotificacao; etapa_id: EtapaId | null; detalhe: string }
  | { tipo: "fechar_pane"; pane_id: string; etapa_id: EtapaId }
  | { tipo: "oferecer_retomada"; etapa_id: EtapaId }
  | { tipo: "aprendizado" }
  | { tipo: "voltar_ao_padrao" };

export interface ResultadoAvancar {
  pipeline: PipelineEstado;
  acoes: Acao[];
  mudou: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();
export const ehTerminal = (e: PipelineEstado["estado"]): boolean => ESTADOS_PIPELINE_TERMINAIS.includes(e);
const FINAIS: readonly EstadoEtapa[] = ["concluida", "pulada_nivel", "pulada_usuario", "falhou", "reprovada"];
const AGRUPAVEIS = new Set(["investigador", "planejador", "implementador"]);
const AO_VIVO: readonly EstadoEtapa[] = ["despachando", "executando", "aguardando_usuario", "sem_progresso"];
/** laço de reprovação: avaliador → etapa a que se volta. */
const LACOS_DE = (pipeline: PlanoMaestro["pipeline_id"]): Partial<Record<EtapaId, EtapaId>> => {
  const saida: Partial<Record<EtapaId, EtapaId>> = {};
  for (const p of PIPELINES[pipeline].passos) if (p.laco !== undefined) saida[p.etapa] = p.laco;
  return saida;
};
const PAPEL_DO_TIPO: Readonly<Record<EtapaExec["tipo"], Papel>> = { investigador: "explorador", planejador: "executor", implementador: "executor", avaliador: "revisor", utilitario: "executor", humano: "nenhum", consulta: "nenhum" };

// ---------------------------------------------------------------- criação
export function execDoPlano(e: EtapaDoPlano, nivel: EtapaExec["nivel"], tentativa = 1): EtapaExec {
  const estado: EstadoEtapa = e.estado_inicial === "pulada_nivel" ? "pulada_nivel" : e.estado_inicial === "pulada_usuario" ? "pulada_usuario" : "pendente";
  return {
    etapa_id: e.etapa_id, ordem: e.ordem, tentativa, rodada: 1, estado, pane_id: null, perfil: null, nivel, comando: null, reutilizou_pane: false, detectada_por: null,
    inicio_em: null, fim_em: null, detalhe: estado === "pendente" ? null : e.motivo, tipo: e.tipo, piso: e.piso, reduz: e.reduz, reforco: e.reforco,
    agrupa_com_anterior: e.agrupa_com_anterior, avaliacoes: e.avaliacoes ?? 1, confirmada: false,
  };
}
/** Execuções iniciais do plano (nível 5: avaliador com 2 avaliações vira duas execuções, em perfis diferentes). */
export function criarExecs(plano: PlanoMaestro): EtapaExec[] {
  const saida: EtapaExec[] = [];
  for (const e of plano.etapas) {
    saida.push(execDoPlano(e, plano.nivel));
    if ((e.avaliacoes ?? 1) >= 2 && e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario") saida.push(execDoPlano(e, plano.nivel, 2));
  }
  return saida.map((x, i) => ({ ...x, ordem: i + 1 }));
}
export function novoPipeline(base: Omit<PipelineEstado, "execs" | "estado" | "motivo_fim" | "concluido_em" | "override_trava"> & { override_trava?: boolean }, agora_ms: number): PipelineEstado {
  return { ...base, override_trava: base.override_trava ?? false, estado: "proposto", execs: criarExecs(base.plano), motivo_fim: null, concluido_em: null, criado_em: base.criado_em ?? iso(agora_ms), atualizado_em: iso(agora_ms) };
}

// ---------------------------------------------------------------- transições válidas (documentadas e testadas)
const TRANSICOES: Readonly<Record<PipelineEstado["estado"], readonly PipelineEstado["estado"][]>> = {
  proposto: ["executando", "cancelado", "expirado"],
  executando: ["aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "bloqueado_piso", "bloqueado_trava", "pausado", "concluido", "concluido_parcial", "falhou", "cancelado"],
  aguardando_humano: ["executando", "pausado", "cancelado", "concluido", "concluido_parcial", "falhou"],
  aguardando_usuario: ["executando", "pausado", "cancelado", "falhou"],
  aguardando_confirmacao: ["executando", "pausado", "cancelado"],
  bloqueado_piso: ["executando", "pausado", "cancelado", "falhou"],
  bloqueado_trava: ["executando", "pausado", "cancelado"],
  pausado: ["executando", "cancelado"],
  concluido: [], concluido_parcial: [], falhou: [], cancelado: [], expirado: [],
};
export const transicaoValida = (de: PipelineEstado["estado"], para: PipelineEstado["estado"]): boolean => de === para || TRANSICOES[de].includes(para);

// ---------------------------------------------------------------- avançar
const clonar = (p: PipelineEstado): PipelineEstado => ({ ...p, execs: p.execs.map((e) => ({ ...e })) });
const ctxDe = (e: EtapaExec, obs: ObservacaoDoDisco): ContextoConclusao => ({
  sondas: obs.sondas,
  desde_ms: e.inicio_em === null ? null : Date.parse(e.inicio_em),
  rodada: Math.max(e.rodada, e.tentativa),
  pane_pronto: e.pane_id !== null && obs.panes[e.pane_id]?.estado === "pronto",
  rapido_relatorio: obs.rapido_relatorio ?? null,
  ultima_task_concluida_ms: obs.ultima_task_concluida_ms ?? null,
});

function marcarConcluida(e: EtapaExec, agora: number, por: EtapaExec["detectada_por"], detalhe: string | null): void {
  e.estado = "concluida";
  e.detectada_por = por;
  e.fim_em = iso(agora);
  if (detalhe !== null) e.detalhe = detalhe;
}

/**
 * Voltas PERMITIDAS do laço por nível. QA: `qa_voltas_max` é o número máximo de QAs (nível 3 ⇒ o 2º QA reprovado já pausa); auditoria F5: `reauditoria`
 * é o número de reauditorias (nível 3 ⇒ até 2 voltas; a 3ª reprovação pausa).
 */
export function voltasPermitidas(etapa: EtapaId, nivel: EtapaExec["nivel"]): number {
  const p = PARAMETROS_POR_NIVEL[nivel];
  if (etapa === "runx.e4") return Math.max(0, (p.qa_voltas_max ?? 1) - 1);
  if (etapa === "sprintx.f5") return p.auditoria_reauditoria ?? 0;
  return 0;
}

function reconciliar(p: PipelineEstado, obs: ObservacaoDoDisco): void {
  const agora = obs.agora_ms;
  // O disco vence: toda etapa ainda aberta (em voo OU ainda pendente) que o disco já mostra concluída é concluída. Pendente concluída = a skill avançou
  // sozinha no mesmo terminal ("avançou na mesma sessão"): nada é despachado em dobro e o terminal em andamento é adotado.
  let adotado: string | null = null;
  for (const e of p.execs) {
    if (e.pane_id !== null && AO_VIVO.includes(e.estado) && adotado === null) adotado = e.pane_id;
    if (FINAIS.includes(e.estado) || e.tipo === "consulta") continue;
    const r = etapaConcluida(e.etapa_id, obs.trabalho, ctxDe(e, obs));
    if (!r.concluida) continue;
    const vinhaPendente = e.estado === "pendente";
    if (r.reprovada) {
      e.estado = "reprovada";
      e.detectada_por = r.detectada_por;
      e.fim_em = iso(agora);
      e.detalhe = r.motivo;
      continue;
    }
    marcarConcluida(e, agora, r.detectada_por ?? "disco", vinhaPendente ? "avançou na mesma sessão" : r.motivo);
    if (vinhaPendente && e.pane_id === null && adotado !== null) e.pane_id = adotado;
  }
}

function abrirLaco(p: PipelineEstado, indiceReprovada: number, para: EtapaId): void {
  const rep = p.execs[indiceReprovada] as EtapaExec;
  const rodada = rep.rodada + 1;
  const de = rep.etapa_id;
  const passos = PIPELINES[p.pipeline_id].passos.map((s) => s.etapa);
  const faixa = passos.slice(passos.indexOf(para), passos.indexOf(de) + 1);
  const novos: EtapaExec[] = [];
  for (const etapa of faixa) {
    const modelos = p.execs.filter((e) => e.etapa_id === etapa && e.rodada === rep.rodada && e.estado !== "pulada_nivel" && e.estado !== "pulada_usuario");
    for (const m of modelos) {
      novos.push({ ...m, rodada, estado: "pendente", pane_id: null, perfil: null, comando: null, reutilizou_pane: false, detectada_por: null, inicio_em: null, fim_em: null, detalhe: `rodada ${rodada}: volta por reprovação em ${de}`, confirmada: false, nivel: p.nivel_atual, pane_fechado: false });
    }
  }
  // insere logo depois da última exec da rodada que reprovou
  let pos = indiceReprovada;
  for (let i = indiceReprovada; i < p.execs.length; i++) if ((p.execs[i] as EtapaExec).etapa_id === de && (p.execs[i] as EtapaExec).rodada === rep.rodada) pos = i;
  p.execs.splice(pos + 1, 0, ...novos);
  p.execs.forEach((e, i) => (e.ordem = i + 1));
}

function podeReusar(p: PipelineEstado, idx: number, obs: ObservacaoDoDisco): string | null {
  const e = p.execs[idx] as EtapaExec;
  if (e.tipo === "avaliador" || !AGRUPAVEIS.has(e.tipo)) return null;
  const modo = e.agrupa_com_anterior;
  if (!modo) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const a = p.execs[i] as EtapaExec;
    if (a.estado === "pulada_nivel" || a.estado === "pulada_usuario" || a.tipo === "consulta") continue;
    if (a.estado !== "concluida" || a.pane_id === null || !AGRUPAVEIS.has(a.tipo)) return null;
    return obs.panes[a.pane_id]?.estado === "pronto" ? a.pane_id : null;
  }
  return null;
}

const planoDe = (p: PipelineEstado, e: EtapaExec): EtapaDoPlano | undefined => p.plano.etapas.find((x) => x.etapa_id === e.etapa_id);

/** Raio ALTO sem aprovação humana: nada que implemente ou entregue pode ser despachado. */
function raioAltoPendente(p: PipelineEstado, e: EtapaExec, obs: ObservacaoDoDisco): boolean {
  const r = obs.trabalho?.raio;
  if (r == null || r.faixa === null || r.faixa.toLowerCase() !== "alto" || r.aprovado) return false;
  if (e.etapa_id === "legadox.raio" || e.tipo === "consulta" || e.tipo === "humano") return false;
  const iRaio = p.execs.findIndex((x) => x.etapa_id === "legadox.raio");
  const iE = p.execs.indexOf(e);
  return iRaio >= 0 ? iE > iRaio : e.tipo === "implementador" || e.etapa_id.startsWith("mergex.");
}

export function avancar(entrada: PipelineEstado, obs: ObservacaoDoDisco): ResultadoAvancar {
  if (ehTerminal(entrada.estado) || entrada.estado === "pausado") return { pipeline: entrada, acoes: [], mudou: false };
  if (entrada.estado === "proposto") {
    if (obs.agora_ms > Date.parse(entrada.plano.expira_em)) {
      return { pipeline: { ...entrada, estado: "expirado", motivo_fim: "proposta expirou sem confirmação", atualizado_em: iso(obs.agora_ms), concluido_em: iso(obs.agora_ms) }, acoes: [{ tipo: "notificar", motivo: "expirado", etapa_id: null, detalhe: "a proposta do Maestro expirou" }], mudou: true };
    }
    return { pipeline: entrada, acoes: [], mudou: false };
  }
  const antes = JSON.stringify(entrada);
  const p = clonar(entrada);
  const acoes: Acao[] = [];
  const agora = obs.agora_ms;
  const notificar = (motivo: MotivoNotificacao, etapa_id: EtapaId | null, detalhe: string): void => void acoes.push({ tipo: "notificar", motivo, etapa_id, detalhe });
  let estado: PipelineEstado["estado"] = "executando";

  reconciliar(p, obs);
  const lacos = LACOS_DE(p.pipeline_id);

  for (let giro = 0; giro < 64; giro++) {
    const prox = proximaEtapa(p.execs, lacos);
    if (prox.tipo === "fim") {
      const houveFalha = p.execs.some((e) => e.estado === "falhou");
      const pulouNaoPiso = p.execs.some((e) => e.estado === "pulada_nivel" && !e.piso && e.detalhe !== null && !e.detalhe.startsWith("desligada"));
      estado = houveFalha ? "falhou" : pulouNaoPiso ? "concluido_parcial" : "concluido";
      p.motivo_fim = houveFalha ? "uma etapa falhou" : pulouNaoPiso ? "concluído; o nível dispensou etapas (dá para rodar depois)" : null;
      p.concluido_em = iso(agora);
      acoes.push({ tipo: "aprendizado" });
      if (p.voltar_ao_padrao) acoes.push({ tipo: "voltar_ao_padrao" });
      notificar("concluido", null, p.motivo_fim ?? "pipeline concluído");
      break;
    }
    if (prox.tipo === "laco") {
      const rep = p.execs[prox.indice_reprovada] as EtapaExec;
      const voltas = p.execs.filter((e) => e.etapa_id === rep.etapa_id && e.estado === "reprovada" && e.tentativa === rep.tentativa).length;
      const limite = voltasPermitidas(rep.etapa_id, p.nivel_atual);
      if (voltas > limite) {
        estado = "aguardando_usuario";
        notificar("limite_de_voltas", rep.etapa_id, `${rep.etapa_id === "runx.e4" ? "O QA" : "A auditoria"} reprovou ${voltas} vez(es): veja ${rep.etapa_id === "runx.e4" ? "o QA.md" : "a 00-AUDITORIA.md"}`);
        break;
      }
      abrirLaco(p, prox.indice_reprovada, prox.para);
      continue;
    }
    const e = p.execs[prox.indice] as EtapaExec;

    if (prox.tipo === "em_voo") {
      if (e.estado === "aguardando_humano") {
        // reconciliar já teria concluído; ainda aberto ⇒ segue esperando a pessoa
        estado = "aguardando_humano";
        break;
      }
      if (e.estado === "aguardando_confirmacao") {
        if (e.confirmada) {
          e.estado = "pendente";
          continue;
        }
        estado = "aguardando_confirmacao";
        break;
      }
      const pane = e.pane_id === null ? undefined : obs.panes[e.pane_id];
      if (e.estado === "despachando") {
        if (e.pane_id !== null && pane === undefined) {
          e.estado = "falhou";
          e.fim_em = iso(agora);
          e.detalhe = "o terminal não abriu";
          continue;
        }
        if (e.pane_id === null && e.inicio_em !== null && agora - Date.parse(e.inicio_em) > 30_000) {
          // reinício no meio do despacho: o Pane não chegou a ser registrado; tenta de novo uma vez
          e.estado = "pendente";
          e.detalhe = "o despacho não se completou; tentando de novo";
          continue;
        }
        break; // o serviço ainda está abrindo o Pane
      }
      if (pane === undefined || pane.estado === "encerrado") {
        if (e.etapa_id === "buildx.condutor") {
          estado = "aguardando_usuario";
          notificar("falhou", e.etapa_id, "o terminal do condutor morreu: ofereça buildx-retomar");
          acoes.push({ tipo: "oferecer_retomada", etapa_id: e.etapa_id });
          e.estado = "aguardando_usuario";
          break;
        }
        e.estado = "falhou";
        e.fim_em = iso(agora);
        e.detalhe = "o terminal encerrou sem concluir a etapa";
        estado = "falhou";
        p.motivo_fim = `a etapa ${e.etapa_id} falhou: o terminal encerrou`;
        p.concluido_em = iso(agora);
        notificar("falhou", e.etapa_id, p.motivo_fim);
        break;
      }
      if (pane.estado === "aguardando") {
        if (e.estado !== "aguardando_usuario") {
          e.estado = "aguardando_usuario";
          notificar("usuario_responde", e.etapa_id, `o método está perguntando no terminal: responda lá (${e.etapa_id})`);
        }
        estado = "aguardando_usuario";
        break;
      }
      if (e.estado === "aguardando_usuario") e.estado = "executando"; // voltou a trabalhar
      if (e.estado === "sem_progresso" && pane.estado === "trabalhando") e.estado = "executando";
      const base = Math.max(obs.ultima_mudanca_ms ?? 0, e.inicio_em === null ? 0 : Date.parse(e.inicio_em));
      const parado = pane.estado === "pronto" && base > 0 && agora - base >= obs.timeout_sem_progresso_ms;
      if (parado && e.estado === "executando") {
        e.estado = "sem_progresso";
        notificar("sem_progresso", e.etapa_id, `sem mudança no disco há ${Math.round(obs.timeout_sem_progresso_ms / 60_000)} min e o terminal está ocioso: nada será reenviado`);
      }
      estado = "executando";
      break;
    }

    // ---- etapa pendente
    if (e.tipo === "consulta") {
      acoes.push({ tipo: "consultar", etapa_id: e.etapa_id });
      marcarConcluida(e, agora, null, "consulta feita pelo Maestro (sem terminal)");
      continue;
    }
    // trava de nível (raio ALTO exige nível ≥ 4) vem antes de qualquer despacho
    const raio = obs.trabalho?.raio;
    if (raio != null && raio.faixa !== null && raio.faixa.toLowerCase() === "alto" && p.nivel_atual < 4 && !p.override_trava && e.etapa_id !== "legadox.raio") {
      estado = "bloqueado_trava";
      notificar("trava", e.etapa_id, "raio de impacto ALTO: o nível mínimo é Rigoroso (4). Suba o nível ou justifique o override.");
      break;
    }
    if (e.tipo === "humano" || planoDe(p, e)?.estado_inicial === "humano") {
      const r = etapaConcluida(e.etapa_id, obs.trabalho, ctxDe(e, obs));
      if (r.concluida) {
        marcarConcluida(e, agora, "disco", r.motivo);
        continue;
      }
      e.estado = "aguardando_humano";
      e.inicio_em ??= iso(agora);
      estado = "aguardando_humano";
      notificar("humano", e.etapa_id, e.etapa_id === "mergex.revisar" ? "o merge é seu: revise e faça o merge no repositório" : "assine o veredito no arquivo: o Maestro não preenche assinatura");
      break;
    }
    if (raioAltoPendente(p, e, obs)) {
      estado = "aguardando_humano";
      notificar("raio_alto", e.etapa_id, "a aprovação do raio ALTO é humana: abra o arquivo do raio e aprove; o Maestro não dispara nada aqui");
      break;
    }
    const violado = (obs.piso ?? []).filter((i) => i.estado === "violado");
    if (violado.length > 0) {
      estado = "bloqueado_piso";
      notificar("piso", e.etapa_id, `piso violado: ${violado.map((v) => `${v.id} ${v.detalhe}`).slice(0, 3).join("; ")}`);
      break;
    }
    if (planoDe(p, e)?.estado_inicial === "confirmar" && !e.confirmada) {
      e.estado = "aguardando_confirmacao";
      estado = "aguardando_confirmacao";
      notificar("confirmacao", e.etapa_id, e.etapa_id === "mergex.pr" ? "confirme o push e a abertura do PR" : "confirme esta etapa");
      break;
    }
    const vivos = p.execs.filter((x) => AO_VIVO.includes(x.estado) && x.pane_id !== null).length;
    if (vivos >= obs.max_terminais) {
      estado = "executando";
      break;
    }
    const reusar = podeReusar(p, prox.indice, obs);
    e.estado = "despachando";
    e.inicio_em = iso(agora);
    e.nivel = p.nivel_atual;
    e.reutilizou_pane = reusar !== null;
    acoes.push({ tipo: "despachar", etapa_id: e.etapa_id, indice: prox.indice, tentativa: e.tentativa, rodada: e.rodada, papel: PAPEL_DO_TIPO[e.tipo], reusar_pane_id: reusar, nivel: p.nivel_atual });
    estado = "executando";
    break;
  }

  // fechar Panes das etapas concluídas (exceto o último implementador, falhas, esperas e Panes que a próxima etapa vai reusar)
  if (obs.fechar_concluidos) {
    const fechados = new Set<string>(p.execs.filter((x) => x.pane_fechado === true && x.pane_id !== null).map((x) => x.pane_id as string));
    const ultimoImpl = [...p.execs].reverse().find((x) => x.tipo === "implementador" && x.pane_id !== null)?.etapa_id ?? null;
    for (const [i, x] of p.execs.entries()) {
      if (x.estado !== "concluida" || x.pane_id === null || x.pane_fechado === true) continue;
      if (x.etapa_id === ultimoImpl) continue;
      const seguinteReusa = p.execs.slice(i + 1).some((y) => !FINAIS.includes(y.estado) && y.agrupa_com_anterior && AGRUPAVEIS.has(y.tipo));
      if (seguinteReusa && AGRUPAVEIS.has(x.tipo)) continue;
      if (obs.panes[x.pane_id] === undefined) continue;
      x.pane_fechado = true;
      if (fechados.has(x.pane_id)) continue;
      fechados.add(x.pane_id);
      acoes.push({ tipo: "fechar_pane", pane_id: x.pane_id, etapa_id: x.etapa_id });
    }
  }

  p.estado = estado;
  p.atualizado_em = iso(agora);
  const mudou = JSON.stringify(p) !== antes || acoes.length > 0;
  return { pipeline: mudou ? p : entrada, acoes, mudou };
}

// ---------------------------------------------------------------- ações do usuário (puras)
function exec(p: PipelineEstado, etapa: EtapaId): EtapaExec | undefined {
  return [...p.execs].reverse().find((e) => e.etapa_id === etapa);
}
export type AcaoDoUsuario = "pausar" | "retomar" | "pular_etapa" | "reabrir_etapa" | "confirmar_etapa" | "cancelar";
/** `maestro:pipeline_acao`. Não existe ação de assinar/aprovar raio/merge. Nunca lança; estado inválido devolve o mesmo pipeline com `erro`. */
export function aplicarAcaoDoUsuario(p: PipelineEstado, acao: AcaoDoUsuario, etapa: EtapaId | null, agora_ms: number): { pipeline: PipelineEstado; erro: string | null } {
  const novo = clonar(p);
  const marca = (): void => {
    novo.atualizado_em = iso(agora_ms);
  };
  switch (acao) {
    case "pausar":
      if (!transicaoValida(p.estado, "pausado")) return { pipeline: p, erro: "não dá para pausar neste estado" };
      novo.estado = "pausado";
      marca();
      return { pipeline: novo, erro: null };
    case "retomar":
      if (p.estado !== "pausado") return { pipeline: p, erro: "o pipeline não está pausado" };
      novo.estado = "executando";
      marca();
      return { pipeline: novo, erro: null };
    case "cancelar":
      if (ehTerminal(p.estado)) return { pipeline: p, erro: "o pipeline já terminou" };
      novo.estado = "cancelado";
      novo.motivo_fim = "cancelado pelo usuário";
      novo.concluido_em = iso(agora_ms);
      marca();
      return { pipeline: novo, erro: null };
    case "confirmar_etapa": {
      const e = etapa === null ? undefined : exec(novo, etapa);
      if (e === undefined) return { pipeline: p, erro: "etapa não encontrada" };
      if (e.tipo === "humano") return { pipeline: p, erro: "ação humana: o Maestro não confirma por você" };
      e.confirmada = true;
      marca();
      return { pipeline: novo, erro: null };
    }
    case "pular_etapa": {
      const e = etapa === null ? undefined : exec(novo, etapa);
      if (e === undefined) return { pipeline: p, erro: "etapa não encontrada" };
      if (e.piso || e.tipo === "humano") return { pipeline: p, erro: "etapa de piso ou humana não pode ser pulada" };
      if (FINAIS.includes(e.estado) && e.estado !== "reprovada") return { pipeline: p, erro: "a etapa já terminou" };
      e.estado = "pulada_usuario";
      e.detalhe = "pulada por você";
      e.fim_em = iso(agora_ms);
      marca();
      return { pipeline: novo, erro: null };
    }
    case "reabrir_etapa": {
      const e = etapa === null ? undefined : exec(novo, etapa);
      if (e === undefined) return { pipeline: p, erro: "etapa não encontrada" };
      if (e.estado === "executando" || e.estado === "despachando") return { pipeline: p, erro: "a etapa está em andamento" };
      e.estado = "pendente";
      e.pane_id = null;
      e.detalhe = "reaberta por você";
      e.fim_em = null;
      e.inicio_em = null;
      e.confirmada = false;
      if (novo.estado === "bloqueado_piso" || novo.estado === "falhou" || novo.estado === "aguardando_usuario") {
        if (novo.estado === "falhou") novo.concluido_em = null;
        novo.estado = "executando";
        novo.motivo_fim = null;
      }
      marca();
      return { pipeline: novo, erro: null };
    }
  }
}

/** Resumo para a UI (`PipelineResumo`). */
export function resumoDoPipeline(p: PipelineEstado): { id: string; pipeline_id: PipelineEstado["pipeline_id"]; estado: string; etapa_atual: string | null; etapas: Array<{ etapa_id: string; estado: string; pane_id: string | null }>; nivel_atual: PipelineEstado["nivel_atual"]; mission_id: string | null; trabalho_id: string | null } {
  const atual = p.execs.find((e) => !FINAIS.includes(e.estado)) ?? null;
  return { id: p.id, pipeline_id: p.pipeline_id, estado: p.estado, etapa_atual: atual?.etapa_id ?? null, etapas: p.execs.map((e) => ({ etapa_id: e.etapa_id, estado: e.estado, pane_id: e.pane_id })), nivel_atual: p.nivel_atual, mission_id: p.mission_id, trabalho_id: p.trabalho_id };
}
