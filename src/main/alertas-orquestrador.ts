// Adaptadores das portas da ENTRADA remota (Fase 20, T-20.28/29/30) sobre o Maestro (Fase 16: classificação por REGRAS, plano por código, um terminal por etapa;
// ele já aceita `via: "telegram"` e, por ser via remota, só SOBE a rigidez e nunca sobrescreve trava) e as consultas do banco. A LLM nunca decide ação: o plano é
// montado pelo Maestro, convertido aqui em `PlanoRemoto` e reavaliado pela política pura do núcleo (`avaliarPlano`) na proposta E na execução. Falha de qualquer porta
// = recusa/desktop (falha segura). O texto do pedido entra SEMPRE dentro de `<pedido_remoto tipo="dados">` (nunca instrução direta).
import type { PlanoRemoto } from "../compartilhado/alertas";
import type { DetalhePipeline, NivelRigidez, PedidoMaestro, PipelineResumo, PlanoMaestro } from "../compartilhado/maestro";
import { envolverPedidoRemoto, hashArgs } from "../nucleo/alertas/texto";
import type { EstadoPlanoRemoto, PortaOrquestrador, PortaRigidez } from "../nucleo/telegram/portas-entrada";

/** O que o adaptador usa do Maestro (subconjunto do `ServicoMaestro` + `LigacaoMaestro`). Injetado: testa sem Electron. */
export interface MaestroParaTelegram {
  pedir(p: PedidoMaestro): Promise<{ plano: PlanoMaestro }>;
  confirmar(plano_id: string): Promise<PipelineResumo>;
  /** estado atual (rigidez, estado, plano vivo). */
  detalhe(id: string): Promise<DetalhePipeline | null>;
  cancelar(id: string): Promise<unknown>;
  /** `pausar`: para o avanço do pipeline; NUNCA apaga Pane nem worktree. */
  pausar(id: string): Promise<unknown>;
}

export interface DepsOrquestradorTelegram {
  maestro: () => MaestroParaTelegram | null;
  nomeWorkspace(workspace_id: string): string | null;
  /** `permissao = automatico` (D-14): fora do modo `direto` a política manda para o desktop. */
  workspaceAutomatico(workspace_id: string): boolean;
}

const ETAPAS_HUMANAS_PROIBIDAS: readonly string[] = ["mergex.revisar", "prodx.assinatura"];

const nivel = (n: NivelRigidez): 1 | 2 | 3 | 4 | 5 => n as 1 | 2 | 3 | 4 | 5;

/** `PlanoMaestro` -> `PlanoRemoto` (PURO). Conservador: na dúvida, o plano exige o desktop (ver a política). */
export function mapearPlano(plano: PlanoMaestro, ctx: { workspace_id: string; workspace_nome: string; workspace_automatico: boolean; nivel_atual: NivelRigidez }): PlanoRemoto {
  const visiveis = plano.etapas.filter((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario");
  const paineis = visiveis.filter((e) => e.tipo !== "humano" && e.tipo !== "consulta" && e.comando !== null).length;
  const squadId = plano.etapas.map((e) => e.perfil?.agente_id ?? null).find((a): a is string => a !== null && a !== "");
  const slug = squadId?.split(".")[0] ?? null;
  // gesto humano que este canal nunca faz (D-21): entrega (push/PR/merge), `mergex-revisar`, assinatura do prodx
  // `mergex.pr` (push + PR) SEM confirmação (workspace automático, D-14) também é gesto humano: com confirmação o pipeline PAUSA esperando o clique no desktop (nada sai por aqui)
  const prSemConfirmacao = visiveis.some((e) => e.etapa_id === "mergex.pr" && e.estado_inicial !== "confirmar");
  const humana = plano.intencao === "entrega" || plano.pipeline_id === "mergex" || prSemConfirmacao || visiveis.some((e) => ETAPAS_HUMANAS_PROIBIDAS.includes(e.etapa_id));
  const altoPelaTrava = plano.trava !== null && /ALTO/i.test(plano.trava.motivo);
  const bruto = {
    plano_id: plano.id,
    intencao: plano.intencao,
    confianca: plano.confianca,
    squad: slug === null ? null : { id: slug, nome: slug },
    pipeline: { skill: plano.pipeline_id, etapas: visiveis.slice(0, 12).map((e) => ({ id: e.etapa_id, rotulo: e.etapa_id, perfil_resumo: e.resumo_perfil ?? "" })) },
    // `workspace` é o nome exibido; `workspace_id` é o ID que a política, as consultas e a auditoria usam (auditoria M2)
    workspace: ctx.workspace_nome,
    workspace_id: ctx.workspace_id,
    // a Missão cria a worktree/branch própria; o ADE nunca trabalha na branch padrão por este canal
    branch_de_trabalho: "worktree da Missão",
    branch_protegida: plano.avisos.some((a) => /branch protegida|produ[cç][aã]o/i.test(a)),
    paineis_estimados: paineis,
    estimativa: { pontos: null, tempo_trabalho_ms: null },
    // raio de trabalho novo é avaliado pelo prodx/legadox DENTRO do pipeline e a aprovação de raio ALTO segue humana (D-21): sem evidência de ALTO marcamos MEDIO
    // (nunca BAIXO), de modo que o modo `direto` (exige BAIXO) não dispara para trabalho novo.
    raio: altoPelaTrava ? ("ALTO" as const) : ("MEDIO" as const),
    rigidez: nivel(ctx.nivel_atual),
    acoes: paineis > 0 ? ["criar_missao", "abrir_pane", "disparar_metodo"] : ["criar_missao", "disparar_metodo"],
    destrutivo: false,
    acao_humana: humana,
    workspace_automatico: ctx.workspace_automatico,
  };
  const args_hash = hashArgs({ plano_id: bruto.plano_id, ws: ctx.workspace_id, i: bruto.intencao, p: plano.pipeline_id, n: bruto.rigidez, e: visiveis.map((e) => `${e.etapa_id}:${e.estado_inicial}`), bp: bruto.branch_protegida, h: humana, a: ctx.workspace_automatico });
  return { ...bruto, args_hash };
}

const ESTADOS: Record<string, EstadoPlanoRemoto> = {
  proposto: "proposto",
  executando: "executando",
  pausado: "executando",
  concluido: "concluido",
  concluido_parcial: "concluido",
  falhou: "falhou",
  expirado: "falhou",
  cancelado: "cancelado",
};

export interface OrquestradorTelegram extends PortaOrquestrador {
  /** workspace do plano (para a política e as consultas). */
  workspaceDoPlano(plano_id: string): string | null;
}

export function criarOrquestradorTelegram(d: DepsOrquestradorTelegram): OrquestradorTelegram {
  const workspaces = new Map<string, string>();
  const estados = new Map<string, EstadoPlanoRemoto>();
  const guardar = (plano_id: string, ws: string, e: EstadoPlanoRemoto): void => {
    workspaces.set(plano_id, ws);
    estados.set(plano_id, e);
    if (workspaces.size > 500) {
      const velho = workspaces.keys().next().value;
      if (velho !== undefined) (workspaces.delete(velho), estados.delete(velho));
    }
  };
  const nome = (ws: string): string => d.nomeWorkspace(ws) ?? ws;

  return {
    workspaceDoPlano: (id) => workspaces.get(id) ?? null,
    async proporPlano(p) {
      const m = d.maestro();
      if (m === null) return { recusado: "orquestrador_indisponivel" };
      try {
        const texto = envolverPedidoRemoto(p.ajuste === undefined ? p.texto_redigido : `${p.texto_redigido}\n\n[ajuste do usuário] ${p.ajuste}`);
        if (p.plano_anterior_id !== undefined) await m.cancelar(p.plano_anterior_id).catch(() => undefined);
        // via remota: o Maestro só sobe rigidez e respeita trava; `executar_direto: false` (o modo direto é decidido pela política do núcleo, não aqui)
        const r = await m.pedir({ workspace_id: p.workspace_id, texto, contexto: null, via: "telegram", nivel_pedido: null, executar_direto: false });
        const plano = mapearPlano(r.plano, { workspace_id: p.workspace_id, workspace_nome: nome(p.workspace_id), workspace_automatico: d.workspaceAutomatico(p.workspace_id), nivel_atual: r.plano.nivel });
        guardar(plano.plano_id, p.workspace_id, "proposto");
        return plano;
      } catch {
        return { recusado: "orquestrador_indisponivel" };
      }
    },
    async planoAtual(plano_id) {
      const m = d.maestro();
      const ws = workspaces.get(plano_id);
      if (m === null || ws === undefined) return null;
      try {
        const det = await m.detalhe(plano_id);
        if (det === null || det.estado !== "proposto") return null;
        // plano VIVO: rigidez/branch atuais; o `args_hash` é recalculado e confrontado com o do nonce (TOCTOU)
        return mapearPlano(det.plano, { workspace_id: ws, workspace_nome: nome(ws), workspace_automatico: d.workspaceAutomatico(ws), nivel_atual: det.nivel_atual });
      } catch {
        return null;
      }
    },
    async executarPlano(plano_id, aprovacao) {
      const m = d.maestro();
      const ws = workspaces.get(plano_id);
      if (m === null || ws === undefined) return { iniciado: false, motivo: "orquestrador_indisponivel" };
      // reavalia o hash do plano VIVO antes de confirmar: se mudou desde a proposta, não executa
      const atual = await this.planoAtual(plano_id);
      if (atual === null) return { iniciado: false, motivo: "plano_indisponivel" };
      if (atual.args_hash !== aprovacao.args_hash) return { iniciado: false, motivo: "plano_alterado" };
      try {
        const r = await m.confirmar(plano_id);
        estados.set(plano_id, ESTADOS[r.estado] ?? "executando");
        return { iniciado: true, ...(r.mission_id === null ? {} : { mission_id: r.mission_id }) };
      } catch (e) {
        const codigo = typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "falha";
        return { iniciado: false, motivo: codigo };
      }
    },
    async pararPlano(plano_id) {
      const m = d.maestro();
      if (m === null) return false;
      try {
        const det = await m.detalhe(plano_id);
        if (det === null) return false;
        if (det.estado === "proposto") await m.cancelar(plano_id);
        else await m.pausar(plano_id);
        estados.set(plano_id, det.estado === "proposto" ? "cancelado" : "executando");
        return true;
      } catch {
        return false;
      }
    },
    estadoPlano: (id) => estados.get(id) ?? "desconhecido",
  };
}

/**
 * Rigidez (F16): o nível do `PlanoRemoto` já é o EFETIVO resolvido pelo Maestro (pedido > Missão > squad > workspace > padrão, com a trava de raio ALTO/branch protegida) e é
 * relido do pipeline vivo em `planoAtual` na aprovação. Acima do máximo remoto, ou se o Maestro estiver ausente, o plano só vale no desktop (falha segura).
 */
export function criarRigidezTelegram(d: { maestro: () => MaestroParaTelegram | null; maximoRemoto: () => number }): PortaRigidez {
  return {
    exigeDesktop({ plano }) {
      if (d.maestro() === null) return { exige: true, motivo: "maestro_indisponivel" };
      const max = d.maximoRemoto();
      return plano.rigidez > max ? { exige: true, motivo: `rigidez_${plano.rigidez}_exige_desktop` } : { exige: false, motivo: "" };
    },
  };
}

/** Maestro real (`LigacaoMaestro`) visto pelo adaptador: o serviço nasce no primeiro uso; nada é criado aqui. */
export function maestroDaLigacao(l: Pick<import("./maestro").LigacaoMaestro, "servico" | "detalhe">): MaestroParaTelegram {
  return {
    pedir: async (p) => (await l.servico()).pedir(p),
    confirmar: async (id) => (await l.servico()).confirmar(id),
    detalhe: (id) => l.detalhe(id),
    cancelar: async (id) => (await l.servico()).cancelar(id),
    pausar: async (id) => (await l.servico()).acao(id, "pausar", null),
  };
}
