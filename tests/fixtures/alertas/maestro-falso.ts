// Maestro FALSO para os testes do adaptador de entrada: plano proposto por regras (sem LLM, sem terminal), estado do pipeline e contagem de chamadas.
import type { PlanoMaestro } from "../../../src/compartilhado/maestro";
import type { MaestroParaTelegram } from "../../../src/main/alertas-orquestrador";

export interface MaestroFalso extends MaestroParaTelegram {
  pedidos: Array<{ workspace_id: string; texto: string; via: string }>;
  confirmados: string[];
  cancelados: string[];
  pausados: string[];
  /** o próximo plano muda de rigidez/etapas (para os testes de TOCTOU). */
  configurar(p: Partial<{ nivel: number; intencao: string; pipeline: string; humano: boolean; trava: string | null; avisos: string[] }>): void;
  /** muda o plano VIVO depois da proposta (TOCTOU). */
  mutarVivo(id: string, f: (p: PlanoMaestro) => void): void;
  falhar: { pedir: boolean; confirmar: boolean };
  estado: Map<string, string>;
}

export function maestroFalso(): MaestroFalso {
  let n = 0;
  const planos = new Map<string, { plano: PlanoMaestro; estado: string; nivel: number; mission_id: string | null }>();
  let cfg: Parameters<MaestroFalso["configurar"]>[0] = {};
  const f: MaestroFalso = {
    pedidos: [],
    confirmados: [],
    cancelados: [],
    pausados: [],
    falhar: { pedir: false, confirmar: false },
    estado: new Map(),
    configurar: (p) => void (cfg = p),
    mutarVivo(id, fn) {
      const x = planos.get(id);
      if (x !== undefined) fn(x.plano);
    },
    async pedir(p) {
      if (f.falhar.pedir) throw new Error("maestro fora");
      f.pedidos.push({ workspace_id: p.workspace_id, texto: p.texto, via: p.via });
      const id = `mpl_${++n}`;
      const nivel = cfg.nivel ?? 3;
      const plano = {
        id,
        intencao: cfg.intencao ?? "bug",
        pipeline_id: cfg.pipeline ?? "runx",
        confianca: 0.9,
        fonte: "regra",
        nivel,
        nivel_origem: "padrao",
        etapas: [
          { etapa_id: "runx.e1", ordem: 1, estado_inicial: "pendente", tipo: "investigador", comando: "/expx:runx-causa x", perfil: { agente_id: null }, resumo_perfil: "claude·opus", reduz: false, piso: false, reforco: null, agrupa_com_anterior: false, motivo: null },
          { etapa_id: "runx.e3", ordem: 2, estado_inicial: "pendente", tipo: "implementador", comando: "/expx:runx-fix x", perfil: { agente_id: null }, resumo_perfil: "claude·sonnet", reduz: false, piso: false, reforco: null, agrupa_com_anterior: false, motivo: null },
          ...(cfg.humano === true ? [{ etapa_id: "mergex.revisar", ordem: 3, estado_inicial: "humano", tipo: "humano", comando: null, perfil: null, resumo_perfil: null, reduz: false, piso: false, reforco: null, agrupa_com_anterior: false, motivo: null }] : []),
        ],
        alvo: { trabalho_id: null, retomada: false, estagio_atual: null },
        avisos: cfg.avisos ?? [],
        trava: cfg.trava === undefined || cfg.trava === null ? null : { minimo: 4, motivo: cfg.trava },
        hooks_a_aplicar: [],
        executar_direto: false,
        expira_em: new Date(Date.now() + 600_000).toISOString(),
      } as unknown as PlanoMaestro;
      planos.set(id, { plano, estado: "proposto", nivel, mission_id: null });
      f.estado.set(id, "proposto");
      return { plano };
    },
    async confirmar(id) {
      if (f.falhar.confirmar) throw Object.assign(new Error("x"), { codigo: "plano_expirado" });
      const x = planos.get(id);
      if (x === undefined) throw new Error("sem plano");
      f.confirmados.push(id);
      x.estado = "executando";
      x.mission_id = `mis_${id}`;
      f.estado.set(id, "executando");
      return { id, pipeline_id: x.plano.pipeline_id, estado: "executando", etapa_atual: "runx.e1", etapas: [], nivel_atual: x.nivel, mission_id: x.mission_id, trabalho_id: null } as never;
    },
    async detalhe(id) {
      const x = planos.get(id);
      if (x === undefined) return null;
      return { id, workspace_id: "w", mission_id: x.mission_id, trabalho_id: null, pipeline_id: x.plano.pipeline_id, intencao: x.plano.intencao, estado: x.estado, via: "telegram", texto_resumo: "", nivel_atual: x.plano.nivel, nivel_base: x.plano.nivel, override_trava: false, plano: x.plano, execs: [], recibo: null, piso: [], motivo_fim: null, criado_em: "", atualizado_em: "", concluido_em: null, arquivo_humano: null } as never;
    },
    async cancelar(id) {
      f.cancelados.push(id);
      const x = planos.get(id);
      if (x !== undefined) x.estado = "cancelado";
      f.estado.set(id, "cancelado");
    },
    async pausar(id) {
      f.pausados.push(id);
    },
  };
  return f;
}
