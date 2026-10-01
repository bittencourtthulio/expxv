import { randomBytes } from "node:crypto";
import type { Papel } from "../../dominio";
import { PRODUTO } from "../../produto";
import { LIMITE_TEXTO_DIRETO_BYTES, verificarFechamento, verificarSpawn } from "../../orquestracao/regras";
import { gravarNaPastaDoProduto } from "../../orquestracao/pasta";
import { argumentoInvalido, grande, indisponivel, naoAutorizado, naoEncontrado, violacaoDeRegra } from "../erros";
import type { PaneInfo } from "../portas";
import {
  ESTADO_PANE_EXTERNO,
  PAPEL_EXTERNO,
  PAPEL_INTERNO,
  booleanoOpcional,
  comoObjeto,
  identificador,
  identificadorOpcional,
  inteiroOpcional,
  texto,
  textoOpcional,
  type ContextoTool,
  type ImplTool,
} from "./comum";

const LIMITE_LEITURA = 2000;
const PADRAO_LEITURA = 200;
const LIMITE_TEXTO_TOTAL = 512 * 1024;

export const paneSpawn: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const provedor = identificador(a, "provider");
  const modelo = identificadorOpcional(a, "model");
  const conta = identificadorOpcional(a, "account_id");
  const agente = identificadorOpcional(a, "agent_id");
  const briefing = textoOpcional(a, "briefing_path", 500);
  const cwd = textoOpcional(a, "cwd", 500);
  const roleBruto = textoOpcional(a, "role", 30);
  let papelPedido: Papel | null = null;
  if (roleBruto !== null) {
    const p = PAPEL_INTERNO[roleBruto];
    if (p === undefined) throw argumentoInvalido('O campo "role" deve ser executor, scout ou reviewer.');
    papelPedido = p;
  }

  const [missao, provedores, panes] = await Promise.all([
    claims.mission_id === null ? Promise.resolve(null) : deps.missoes.obter(claims.mission_id),
    deps.provedores.listar(claims.workspace_id),
    deps.panes.listar({ workspace_id: claims.workspace_id, mission_id: claims.mission_id }),
  ]);
  if (missao !== null && missao.workspace_id !== claims.workspace_id) throw naoAutorizado();

  const { papel, avisos } = verificarSpawn({
    chamador: { pane_id: claims.pane_id, papel: claims.role, modo: claims.mode },
    missao,
    papel_pedido: papelPedido,
    agente_id: agente,
    provedor,
    provedores,
    panes_vivos: panes,
    max_paralelos: deps.maxPanesParalelos,
  });
  if (conta !== null) {
    const p = provedores.find((x) => x.provedor === provedor);
    if (p !== undefined && p.contas.length > 0 && !p.contas.includes(conta)) throw argumentoInvalido('O campo "account_id" não pertence ao provedor.');
  }
  for (const aviso of avisos) deps.avisar(aviso);

  try {
    // workers herdam mission_id e papel: nunca vêm do argumento
    const { pane_id } = await deps.panes.spawn({
      workspace_id: claims.workspace_id,
      mission_id: claims.mission_id,
      pedido_por_pane_id: claims.pane_id,
      provedor,
      modelo,
      conta_id: conta,
      papel,
      agente_id: agente,
      briefing_path: briefing,
      cwd,
    });
    return { pane_id };
  } catch {
    throw indisponivel("Não foi possível abrir o Pane.");
  }
};

function resumo(p: PaneInfo): Record<string, unknown> {
  return { pane_id: p.pane_id, provider: p.provedor, role: PAPEL_EXTERNO[p.papel], state: ESTADO_PANE_EXTERNO[p.estado], task_id: p.task_id };
}

export const paneList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const pedida = identificadorOpcional(a, "mission_id");
  if (pedida !== null && pedida !== claims.mission_id) throw violacaoDeRegra("not_in_mission", "A Missão pedida não é a do token.");
  const panes = await deps.panes.listar({ workspace_id: claims.workspace_id, mission_id: claims.mission_id });
  return panes.filter((p) => p.estado !== "encerrado").map(resumo);
};

async function paneDoEscopo(id: string, { claims, deps }: ContextoTool): Promise<PaneInfo> {
  const pane = await deps.panes.obter(id);
  if (pane === null) throw naoEncontrado(`Pane não encontrado: ${id}.`);
  if (pane.workspace_id !== claims.workspace_id || pane.mission_id !== claims.mission_id) {
    throw naoAutorizado("O Pane não pertence ao escopo deste token.");
  }
  return pane;
}

export const paneRead: ImplTool = async (args, ctx) => {
  const a = comoObjeto(args);
  const id = identificador(a, "pane_id");
  const ultimas = inteiroOpcional(a, "last_n", 1, 100_000) ?? PADRAO_LEITURA;
  const teto = Math.min(inteiroOpcional(a, "max_n", 1, 100_000) ?? LIMITE_LEITURA, LIMITE_LEITURA);
  await paneDoEscopo(id, ctx);
  const n = Math.min(ultimas, teto);
  const leitura = await ctx.deps.panes.ler(id, n);
  if (leitura === null) throw naoEncontrado(`Pane não encontrado: ${id}.`);
  const linhas = leitura.linhas.length > n ? leitura.linhas.slice(-n) : leitura.linhas;
  return { lines: linhas, state: ESTADO_PANE_EXTERNO[leitura.estado] };
};

export const paneSend: ImplTool = async (args, ctx) => {
  const a = comoObjeto(args);
  const id = identificador(a, "pane_id");
  const conteudo = texto(a, "text");
  const submeter = booleanoOpcional(a, "submit", true);
  const bytes = Buffer.byteLength(conteudo, "utf8");
  if (bytes > LIMITE_TEXTO_TOTAL) throw grande(`O texto excede ${LIMITE_TEXTO_TOTAL} bytes.`);
  const pane = await paneDoEscopo(id, ctx);
  if (pane.pane_id === ctx.claims.pane_id) throw violacaoDeRegra("forbidden_role", "Um Pane não envia texto a si mesmo.");

  let entrega = conteudo;
  if (bytes > LIMITE_TEXTO_DIRETO_BYTES) {
    const raiz = await ctx.deps.raiz(ctx.claims.workspace_id, ctx.claims.mission_id);
    const nome = `${ctx.deps.relogio.agora()}-${randomBytes(4).toString("hex")}.md`;
    const pasta = id.replace(/[^A-Za-z0-9_-]/g, "_");
    const caminho = await gravarNaPastaDoProduto(raiz, `${PRODUTO.pastaNoProjeto}/entradas/${pasta}/${nome}`, conteudo);
    entrega = `O texto é longo e foi gravado em ${caminho}. Leia o arquivo e siga as instruções dele.`;
  }
  const aceito = await ctx.deps.panes.enviar(id, entrega, submeter);
  return { accepted: aceito };
};

export const paneClose: ImplTool = async (args, ctx) => {
  const a = comoObjeto(args);
  const id = identificador(a, "pane_id");
  const alvo = await paneDoEscopo(id, ctx);
  verificarFechamento({ chamador: { pane_id: ctx.claims.pane_id, papel: ctx.claims.role }, alvo });
  const ok = await ctx.deps.panes.fechar(id, "pilot_request");
  return { ok };
};
