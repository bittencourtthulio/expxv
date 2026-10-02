// T-16.27 · Adaptador do MCP: `ServicoMaestro` → `PortaMaestroMcp` (as tools `maestro_request`/`maestro_status`). PURO: o serviço entra por injeção.
// A identidade (workspace, Missão, Pane) vem SEMPRE dos claims do token; o texto é só dado e atravessa como `texto` do pedido (o serviço o normaliza).
// O pedido NUNCA executa pela tool: `executar_direto` é sempre `null` aqui (só a UI/config do workspace decide). `level` só SOBE o nível vigente.
// Traduz `MaestroErro.codigo` para os erros nominais do MCP.
import { ErroMcp, argumentoInvalido, indisponivel, violacaoDeRegra } from "../mcp/erros";
import type { ClaimsDeMaestro, PedidoMaestroMcp, PipelineDoStatusMaestro, PortaMaestroMcp, ResultadoPedidoMaestro } from "../mcp/portas";
import type { NivelRigidez, PedidoMaestro, PipelineEstado, PipelineResumo, PlanoMaestro } from "../../compartilhado/maestro";
import { etapaDef } from "./etapas/catalogo";
import { resolverNivel, type LeitoresDeNivel } from "./rigidez/escopos";
import { MaestroErro } from "./servico";

/** O que o adaptador usa do serviço (o `ServicoMaestro` real satisfaz). */
export interface ServicoParaMcp {
  pedir(p: PedidoMaestro): Promise<{ plano: PlanoMaestro; recibo: unknown }>;
  estado(id: string): Promise<PipelineEstado | null>;
  status(workspace_id: string): Promise<PipelineResumo[]>;
  ehPaneDoMaestro(pane_id: string): boolean;
}
export interface DepsPortaMaestroMcp {
  /** níveis persistidos (workspace/Missão): `level` do pedido só vale se SUBIR o vigente. */
  niveis: LeitoresDeNivel;
}

export const MENSAGEM_DO_MAESTRO =
  "O Maestro assumiu este pedido e gravou um plano PROPOSTO. Avise o usuário para confirmar o plano na barra do painel (ou na tela Pipelines). Não implemente o pedido neste painel e não chame maestro_request de novo para o mesmo texto.";
const MENSAGEM_EXECUTANDO = "O Maestro já está executando este pedido em terminais próprios. Avise o usuário e acompanhe por maestro_status; não implemente o pedido neste painel.";

/** Erro do serviço → erro nominal do MCP (sem vazar detalhe interno). */
export function erroMcpDoMaestro(e: unknown): ErroMcp {
  if (e instanceof ErroMcp) return e;
  if (e instanceof MaestroErro) {
    switch (e.codigo) {
      case "loop_guard":
        return violacaoDeRegra("loop_guard", "Este painel pertence ao Maestro: ele não pede ao Maestro.");
      case "taxa_excedida":
        return violacaoDeRegra("limit_reached", "Pedidos demais deste painel; espere um minuto.");
      case "module_disabled":
        return violacaoDeRegra("module_disabled", "Este pedido usa um módulo da suíte que está desligado neste projeto. Avise o usuário para ligar o módulo em Método › Módulos da suíte; não tente contornar.");
      case "invalid_argument":
        return argumentoInvalido("Pedido inválido.");
      case "ignorado":
        return argumentoInvalido("Este texto é um comando direto (barra, @direto ou marcador do Maestro) e não é encaminhado.");
      case "plano_inexistente":
        return new ErroMcp("not_found", "Plano não encontrado.");
      default:
        return indisponivel("O Maestro não pôde atender agora.");
    }
  }
  return indisponivel("O Maestro não está disponível.");
}

const textoDoPipeline = (p: PipelineResumo): PipelineDoStatusMaestro => ({
  id: p.id,
  state: p.estado,
  current_stage: p.etapa_atual,
  stages: p.etapas.map((e) => ({ id: e.etapa_id, state: e.estado })),
  level: p.nivel_atual,
});

export function criarPortaMaestroMcp(servico: ServicoParaMcp, deps: DepsPortaMaestroMcp): PortaMaestroMcp {
  async function nivelDoPedido(claims: ClaimsDeMaestro, level: PedidoMaestroMcp["level"]): Promise<NivelRigidez | null> {
    if (level === null) return null;
    const [ws, missao] = await Promise.all([deps.niveis.workspace(claims.workspace_id).catch(() => null), claims.mission_id === null ? Promise.resolve(null) : deps.niveis.missao(claims.mission_id).catch(() => null)]);
    const vigente = resolverNivel({ workspace: ws, missao }).efetivo;
    // a tool nunca baixa a rigidez: pedir nível menor ou igual ao vigente é ignorado
    return level > vigente ? level : null;
  }
  return {
    async permitido(pane_id) {
      return !servico.ehPaneDoMaestro(pane_id);
    },
    async pedir(claims, pedido) {
      if (servico.ehPaneDoMaestro(claims.pane_id)) throw erroMcpDoMaestro(new MaestroErro("loop_guard", "pane do maestro"));
      const nivel_pedido = await nivelDoPedido(claims, pedido.level);
      let r: Awaited<ReturnType<ServicoParaMcp["pedir"]>>;
      try {
        r = await servico.pedir({
          workspace_id: claims.workspace_id,
          texto: pedido.text,
          contexto: { pane_id: claims.pane_id, mission_id: claims.mission_id, trabalho_id: null, arquivos: pedido.files.slice(0, 20), trecho: pedido.excerpt },
          via: "mcp",
          nivel_pedido,
          executar_direto: null,
        });
      } catch (e) {
        throw erroMcpDoMaestro(e);
      }
      const plano = r.plano;
      const estado = await servico.estado(plano.id).catch(() => null);
      const rodando = estado?.estado === "executando";
      const stages = plano.etapas
        .filter((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario")
        .map((e) => ({ id: e.etapa_id, skill: etapaDef(e.etapa_id)?.skill ?? e.etapa_id.split(".")[0] ?? "", profile: e.resumo_perfil ?? "" }));
      const saida: ResultadoPedidoMaestro = {
        plan_id: plano.id,
        intent: plano.intencao,
        confidence: plano.confianca,
        pipeline: plano.pipeline_id,
        stages,
        state: rodando ? "running" : "proposed",
        needs_user_confirmation: !rodando,
        message: rodando ? MENSAGEM_EXECUTANDO : MENSAGEM_DO_MAESTRO,
      };
      return saida;
    },
    async status(claims, plan_id) {
      if (servico.ehPaneDoMaestro(claims.pane_id)) throw erroMcpDoMaestro(new MaestroErro("loop_guard", "pane do maestro"));
      try {
        if (plan_id !== null) {
          const p = await servico.estado(plan_id);
          // só o workspace do token: plano de outro workspace é "inexistente"
          if (p === null || p.workspace_id !== claims.workspace_id) return { pipelines: [] };
          return { pipelines: [{ id: p.id, state: p.estado, current_stage: p.execs.find((e) => e.estado === "executando" || e.estado === "despachando")?.etapa_id ?? null, stages: p.execs.map((e) => ({ id: e.etapa_id, state: e.estado })), level: p.nivel_atual }] };
        }
        return { pipelines: (await servico.status(claims.workspace_id)).map(textoDoPipeline) };
      } catch (e) {
        throw erroMcpDoMaestro(e);
      }
    },
  };
}
