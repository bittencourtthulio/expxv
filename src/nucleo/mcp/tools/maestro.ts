// Tools `maestro_request` e `maestro_status` (Fase 16, T-16.27). Só traduzem o contrato externo (inglês, snake_case) para a `PortaMaestroMcp`,
// implementada no main (`maestro/mcp.ts` sobre o `ServicoMaestro`). A identidade (Missão, Pane, papel, modo) vem SEMPRE do token; o texto do
// pedido é só dado (nunca executa, nunca vira argv aqui). Anti-loop: worker nunca vê a tool (catálogo) e a porta reconfere a cada chamada
// (`permitido`) que o Pane não é de etapa do Maestro. `level` só pode SUBIR o nível vigente. Resposta ≤ 4 KB.
import { ErroMcp, argumentoInvalido, indisponivel, violacaoDeRegra } from "../erros";
import type { ClaimsDeMaestro, PedidoMaestroMcp, PortaMaestroMcp, ResultadoPedidoMaestro } from "../portas";
import { caberEm4Kb } from "./harness";
import { comoObjeto, identificadorOpcional, inteiroOpcional, textoOpcional, texto, type ContextoTool, type DepsTools, type ImplTool } from "./comum";

export const TEXTO_MAESTRO_MAX = 4000;
export const EXCERTO_MAESTRO_MAX = 2000;
export const ARQUIVOS_MAESTRO_MAX = 20;

function exigirMaestro(deps: DepsTools): PortaMaestroMcp {
  if (deps.maestro === undefined) throw indisponivel("O Maestro não está disponível.");
  return deps.maestro;
}

/** Só o piloto e o Pane livre pedem; worker não (o catálogo já esconde a tool, isto é a segunda barreira). */
function identidade(claims: ContextoTool["claims"]): ClaimsDeMaestro {
  if (claims.role !== "piloto" && claims.role !== "nenhum") throw violacaoDeRegra("forbidden_role", "Só o piloto ou um painel livre pedem ao Maestro.");
  return { workspace_id: claims.workspace_id, mission_id: claims.mission_id, pane_id: claims.pane_id, role: claims.role, mode: claims.mode };
}

/** Erro nominal da porta passa intacto; o resto vira `unavailable` sem detalhe interno. */
async function daPorta<T>(chamada: () => Promise<T>, mensagem: string): Promise<T> {
  try {
    return await chamada();
  } catch (e) {
    if (e instanceof ErroMcp) throw e;
    throw indisponivel(mensagem);
  }
}

async function reconferir(porta: PortaMaestroMcp, claims: ClaimsDeMaestro): Promise<void> {
  const ok = await daPorta(() => porta.permitido(claims.pane_id), "Não foi possível consultar o Maestro.");
  if (!ok) throw violacaoDeRegra("loop_guard", "Este painel pertence ao Maestro: ele não pede ao Maestro.");
}

const CAMINHO_ABSOLUTO = /^(?:[\\/]|[A-Za-z]:)/;
function arquivos(contexto: Record<string, unknown>): string[] {
  const v = contexto["files"];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > ARQUIVOS_MAESTRO_MAX) throw argumentoInvalido(`O campo "context.files" deve ser uma lista de até ${ARQUIVOS_MAESTRO_MAX} caminhos.`);
  return v.map((f) => {
    if (typeof f !== "string" || f === "" || f.length > 300 || /[\u0000-\u001f]/.test(f)) throw argumentoInvalido('O campo "context.files" tem um caminho inválido.');
    if (CAMINHO_ABSOLUTO.test(f) || f.split(/[\\/]/).includes("..")) throw argumentoInvalido('O campo "context.files" aceita só caminhos relativos ao workspace.');
    return f;
  });
}

export const maestroRequest: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const text = texto(a, "text", { max: TEXTO_MAESTRO_MAX }).trim();
  const bruto = a["context"];
  if (bruto !== undefined && bruto !== null && (typeof bruto !== "object" || Array.isArray(bruto))) throw argumentoInvalido('O campo "context" deve ser um objeto.');
  const contexto = (bruto ?? {}) as Record<string, unknown>;
  const files = arquivos(contexto);
  const excerpt = textoOpcional(contexto, "excerpt", EXCERTO_MAESTRO_MAX);
  const level = inteiroOpcional(a, "level", 1, 5) as PedidoMaestroMcp["level"];
  const id = identidade(claims);
  const porta = exigirMaestro(deps);
  await reconferir(porta, id);
  // copia campo a campo: nada além do contrato atravessa para o main; a identidade NUNCA vem dos argumentos
  const r: ResultadoPedidoMaestro = await daPorta(() => porta.pedir(id, { text, files, excerpt, level }), "Não foi possível encaminhar o pedido ao Maestro.");
  const saida = caberEm4Kb(r.stages, (itens, extra) => ({
    plan_id: r.plan_id,
    intent: r.intent,
    confidence: Math.round(r.confidence * 100) / 100,
    pipeline: r.pipeline,
    stages: itens.map((e) => ({ id: e.id, skill: e.skill, profile: e.profile.slice(0, 80) })),
    state: r.state,
    needs_user_confirmation: r.needs_user_confirmation,
    message: r.message.slice(0, 600),
    ...extra,
  }));
  return saida;
};

export const maestroStatus: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const planId = identificadorOpcional(a, "plan_id");
  const id = identidade(claims);
  const porta = exigirMaestro(deps);
  await reconferir(porta, id);
  const r = await daPorta(() => porta.status(id, planId), "Não foi possível consultar o Maestro.");
  return caberEm4Kb(r.pipelines, (itens, extra) => ({
    pipelines: itens.map((p) => ({ id: p.id, state: p.state, current_stage: p.current_stage, stages: p.stages.slice(0, 30).map((e) => ({ id: e.id, state: e.state })), level: p.level })),
    ...extra,
  }));
};
