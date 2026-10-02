// T-16.18 · Escopos da rigidez: pedido > Missão > squad > workspace > padrão 3; depois `max(efetivo, mínimo travado)` (salvo override registrado).
// Replanejamento no meio do pipeline: vale a partir da PRÓXIMA etapa; a em execução não é tocada; etapas passadas não voltam.
// Implementa a `PortaNivelRigidez` (Fase 14) por leitores injetados (nada de banco aqui).
import { NIVEIS_RIGIDEZ, type EtapaExec, type EtapaId, type NivelRigidez, type PipelineId } from "../../../compartilhado/maestro";
import { NIVEL_RIGIDEZ_PADRAO, type PortaNivelRigidez } from "../../squads/rigor";
import { PIPELINES } from "../etapas/catalogo";
import { pipelineEfetivo, planoDeEtapas, type ContextoPlano } from "./plano-de-etapas";

export type OrigemNivel = "pedido" | "missao" | "squad" | "workspace" | "padrao";
const valido = (n: number | null | undefined): n is NivelRigidez => (NIVEIS_RIGIDEZ as readonly number[]).includes(n as number);

export interface EntradaNivel {
  pedido?: number | null;
  missao?: number | null;
  squad?: number | null;
  workspace?: number | null;
  minimo_travado?: NivelRigidez | null;
  motivo_trava?: string | null;
  /** override registrado (justificativa ≥ 20): a trava deixa de elevar o nível. */
  override_trava?: boolean;
}
export interface NivelEfetivo {
  efetivo: NivelRigidez;
  origem: OrigemNivel;
  minimo_travado: NivelRigidez;
  motivo_trava: string | null;
  /** o nível escolhido estava abaixo da trava e foi elevado. */
  elevado_pela_trava: boolean;
}
export function resolverNivel(e: EntradaNivel): NivelEfetivo {
  const cadeia: Array<[OrigemNivel, number | null | undefined]> = [["pedido", e.pedido], ["missao", e.missao], ["squad", e.squad], ["workspace", e.workspace]];
  let base: NivelRigidez = NIVEL_RIGIDEZ_PADRAO;
  let origem: OrigemNivel = "padrao";
  for (const [o, n] of cadeia) {
    if (valido(n)) {
      base = n;
      origem = o;
      break;
    }
  }
  const minimo = e.minimo_travado ?? 1;
  if (e.override_trava !== true && base < minimo) return { efetivo: minimo, origem, minimo_travado: minimo, motivo_trava: e.motivo_trava ?? null, elevado_pela_trava: true };
  return { efetivo: base, origem, minimo_travado: minimo, motivo_trava: e.motivo_trava ?? null, elevado_pela_trava: false };
}

// ---------------------------------------------------------------- PortaNivelRigidez (Fase 14)
export interface LeitoresDeNivel {
  workspace(workspace_id: string): Promise<number | null>;
  missao(mission_id: string): Promise<number | null>;
  squad?(workspace_id: string, squad_slug: string, membro_slug: string | null): Promise<number | null>;
}
export function criarPortaNivelRigidez(l: LeitoresDeNivel): PortaNivelRigidez {
  return {
    async efetivo(ctx) {
      try {
        const [missao, squad, workspace] = await Promise.all([
          ctx.mission_id === null ? Promise.resolve(null) : l.missao(ctx.mission_id),
          ctx.squad_slug === null || l.squad === undefined ? Promise.resolve(null) : l.squad(ctx.workspace_id, ctx.squad_slug, ctx.membro_slug),
          l.workspace(ctx.workspace_id),
        ]);
        return resolverNivel({ missao, squad, workspace }).efetivo;
      } catch {
        return NIVEL_RIGIDEZ_PADRAO;
      }
    },
  };
}

// ---------------------------------------------------------------- replanejamento
const FINAIS_OU_EM_VOO = new Set(["concluida", "reprovada", "falhou", "pulada_usuario", "despachando", "executando", "aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "sem_progresso"]);

export interface ResultadoReplanejamento {
  execs: EtapaExec[];
  /** o que mudou, para o log e a UI. */
  adicionadas: EtapaId[];
  puladas: EtapaId[];
  reativadas: EtapaId[];
}

/**
 * Replaneja as PENDENTES para o novo nível. Etapas concluídas/em voo/reprovadas ficam como estão; pendentes que o novo nível dispensa viram
 * `pulada_nivel`; dispensadas que o novo nível pede voltam a `pendente` se ainda estão à frente da posição atual; etapas novas à frente são inseridas.
 * Nunca volta a uma etapa anterior à posição atual.
 */
export function replanejarExecs(execs: readonly EtapaExec[], pipelineBase: PipelineId, novoNivel: NivelRigidez, ctx: ContextoPlano, agoraIso: string): ResultadoReplanejamento {
  const pipeline = pipelineEfetivo(pipelineBase, novoNivel);
  void pipeline;
  const passos = PIPELINES[pipelineBase].passos.map((p) => p.etapa);
  const pos = (e: EtapaId): number => passos.indexOf(e);
  const atual = Math.max(-1, ...execs.filter((x) => FINAIS_OU_EM_VOO.has(x.estado)).map((x) => pos(x.etapa_id)));
  const novo = planoDeEtapas(pipelineBase, novoNivel, ctx);
  const noNovo = new Map(novo.map((e) => [e.etapa_id, e] as const));
  const adicionadas: EtapaId[] = [];
  const puladas: EtapaId[] = [];
  const reativadas: EtapaId[] = [];
  const saida: EtapaExec[] = [];

  for (const x of execs) {
    if (FINAIS_OU_EM_VOO.has(x.estado)) {
      saida.push(x);
      continue;
    }
    const n = noNovo.get(x.etapa_id);
    if (x.estado === "pendente") {
      if (n === undefined || n.estado_inicial === "pulada_nivel" || n.estado_inicial === "pulada_usuario") {
        saida.push({ ...x, estado: "pulada_nivel", nivel: novoNivel, detalhe: "dispensada pelo novo nível", fim_em: agoraIso });
        puladas.push(x.etapa_id);
      } else saida.push({ ...x, nivel: novoNivel, tipo: n.tipo, reduz: n.reduz, reforco: n.reforco, agrupa_com_anterior: n.agrupa_com_anterior, avaliacoes: n.avaliacoes ?? 1, piso: n.piso });
      continue;
    }
    if (x.estado === "pulada_nivel") {
      if (n !== undefined && n.estado_inicial !== "pulada_nivel" && n.estado_inicial !== "pulada_usuario" && pos(x.etapa_id) > atual) {
        saida.push({ ...x, estado: "pendente", nivel: novoNivel, detalhe: null, fim_em: null, tipo: n.tipo, reduz: n.reduz, reforco: n.reforco, agrupa_com_anterior: n.agrupa_com_anterior, avaliacoes: n.avaliacoes ?? 1, piso: n.piso });
        reativadas.push(x.etapa_id);
      } else saida.push(x);
      continue;
    }
    saida.push(x);
  }
  // etapas novas (que o plano antigo não tinha) à frente da posição atual
  const existentes = new Set(execs.map((x) => x.etapa_id));
  for (const n of novo) {
    if (existentes.has(n.etapa_id) || n.estado_inicial === "pulada_nivel" || n.estado_inicial === "pulada_usuario") continue;
    if (pos(n.etapa_id) <= atual) continue;
    const exec: EtapaExec = {
      etapa_id: n.etapa_id, ordem: 0, tentativa: 1, rodada: 1, estado: "pendente", pane_id: null, perfil: null, nivel: novoNivel, comando: null, reutilizou_pane: false, detectada_por: null,
      inicio_em: null, fim_em: null, detalhe: null, tipo: n.tipo, piso: n.piso, reduz: n.reduz, reforco: n.reforco, agrupa_com_anterior: n.agrupa_com_anterior, avaliacoes: n.avaliacoes ?? 1, confirmada: false,
    };
    // insere antes da primeira exec cuja posição no pipeline é maior
    const idx = saida.findIndex((x) => pos(x.etapa_id) > pos(n.etapa_id) && !FINAIS_OU_EM_VOO.has(x.estado));
    if (idx < 0) saida.push(exec);
    else saida.splice(idx, 0, exec);
    adicionadas.push(n.etapa_id);
  }
  return { execs: saida.map((x, i) => ({ ...x, ordem: i + 1 })), adicionadas, puladas, reativadas };
}

// ---------------------------------------------------------------- "voltar ao padrão" e lembretes
export interface EscopoDeVoltar {
  escopo: "pedido" | "missao" | "workspace";
  voltar_ao_padrao: boolean;
}
/** "Só este pedido" sempre volta sozinho; Missão volta se marcada; workspace nunca (é o padrão do usuário). */
export const deveVoltarAoPadrao = (e: EscopoDeVoltar): boolean => e.escopo === "pedido" || (e.escopo === "missao" && e.voltar_ao_padrao);
export const LEMBRETE_HORAS_NIVEL_BAIXO = 8;
/** Banner discreto no topo se o workspace ficar ≥ 8 h em nível ≤ 2. */
export function lembreteDeNivelBaixo(nivel: NivelRigidez, desdeMs: number | null, agoraMs: number): boolean {
  return nivel <= 2 && desdeMs !== null && agoraMs - desdeMs >= LEMBRETE_HORAS_NIVEL_BAIXO * 3_600_000;
}
/** Toast ao concluir um pipeline em nível < 3. */
export const lembreteAoConcluir = (nivel: NivelRigidez): boolean => nivel < 3;
