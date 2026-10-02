import { randomBytes } from "node:crypto";
import type { Papel } from "../../dominio";
import { PRODUTO } from "../../produto";
import { LIMITE_TEXTO_DIRETO_BYTES, taskDoBriefing, verificarConsultaRag, verificarFechamento, verificarSpawn } from "../../orquestracao/regras";
import { gravarNaPastaDoProduto } from "../../orquestracao/pasta";
import { normalizarNomeSkill } from "../../catalogo/politica";
import { aplicarSkills } from "../../harness/skills";
import { ESTADO_FECHADO_EXTERNO, FECHADO_POR_EXTERNO } from "../../orquestracao/ciclo-worker";
import { ErroMcp, argumentoInvalido, grande, indisponivel, naoAutorizado, naoEncontrado, violacaoDeRegra } from "../erros";
import type { PaneFechadoInfo, PaneInfo, RotaDoSpawn } from "../portas";
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
import { FAIXAS_MCP, erroDeRegra } from "./harness";

const LIMITE_LEITURA = 2000;
const PADRAO_LEITURA = 200;
const LIMITE_TEXTO_TOTAL = 512 * 1024;
/** Teto do recibo devolvido em `pane_spawn` (contrato §3). */
const LIMITE_RECIBO_SPAWN = 240;
/** `route:"auto"` é o padrão a partir deste nível do workspace (D-100); nível 1 nunca roteia. */
const NIVEL_AUTO_PADRAO = 3;

/** `pane_spawn.prompt` (painel que orquestra): até 4000 caracteres, igual ao `agent_invoke.prompt`. */
const LIMITE_PROMPT_SPAWN = 4000;
const LIMITE_TITULO_SPAWN = 60;

const NOME_SKILL_PEDIDA = /^[A-Za-z0-9][A-Za-z0-9:._ -]{0,79}$/;
const MAX_SKILLS_PEDIDAS = 50;

/** `pane_spawn.skills`: lista de nomes (≤ 50, ≤ 80 caracteres, sem controle); ausente = vazia. */
function listaDeSkills(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_SKILLS_PEDIDAS) throw argumentoInvalido('O campo "skills" deve ser uma lista de até 50 nomes.');
  const saida: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !NOME_SKILL_PEDIDA.test(x)) throw argumentoInvalido('Cada item de "skills" deve ser um nome de skill válido.');
    if (!saida.includes(x)) saida.push(x);
  }
  return saida;
}

export const paneSpawn: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const provedorPedido = identificadorOpcional(a, "provider");
  let modelo = identificadorOpcional(a, "model");
  let conta = identificadorOpcional(a, "account_id");
  const agente = identificadorOpcional(a, "agent_id");
  const briefing = textoOpcional(a, "briefing_path", 500);
  const cwd = textoOpcional(a, "cwd", 500);
  const roleBruto = textoOpcional(a, "role", 30);
  const rotaBruta = textoOpcional(a, "route", 10);
  const taskType = identificadorOpcional(a, "task_type");
  const descricao = textoOpcional(a, "task_description", 2000);
  const faixaBruta = textoOpcional(a, "faixa", 20);
  const cliPedida = identificadorOpcional(a, "cli");
  const skillsPedidas = listaDeSkills(a["skills"]);
  // D-421 (painel que orquestra): o que o worker deve fazer (vira o briefing quando não há `briefing_path`), o nome da tarefa e o isolamento em worktree
  const prompt = textoOpcional(a, "prompt", LIMITE_PROMPT_SPAWN);
  const titulo = textoOpcional(a, "title", LIMITE_TITULO_SPAWN);
  const isolarBruto = a["isolate"];
  if (isolarBruto !== undefined && isolarBruto !== null && typeof isolarBruto !== "boolean") throw argumentoInvalido('O campo "isolate" deve ser booleano.');
  const aprovacaoBruta = a["aprovacao"];
  if (aprovacaoBruta !== undefined && aprovacaoBruta !== null && aprovacaoBruta !== "perguntar" && aprovacaoBruta !== "automatico_seguro") {
    throw argumentoInvalido('O campo "aprovacao" só pode ser perguntar ou automatico_seguro (o agente nunca eleva o nível configurado pelo dono).');
  }
  if (prompt !== null && briefing !== null) throw argumentoInvalido('Informe "prompt" ou "briefing_path", não os dois.');
  if (rotaBruta !== null && rotaBruta !== "auto" && rotaBruta !== "none") throw argumentoInvalido('O campo "route" deve ser auto ou none.');
  if (faixaBruta !== null && !FAIXAS_MCP.includes(faixaBruta)) throw argumentoInvalido('O campo "faixa" deve ser topo, alto, medio ou rapido.');
  let papelPedido: Papel | null = null;
  if (roleBruto !== null) {
    const p = PAPEL_INTERNO[roleBruto];
    if (p === undefined) throw argumentoInvalido('O campo "role" deve ser executor, scout ou reviewer.');
    papelPedido = p;
  }

  if (cliPedida !== null && provedorPedido !== "openrouter") throw argumentoInvalido('O campo "cli" só vale com provider:"openrouter".');

  // Explícito vence: com `provider` o comportamento é o do MVP (nada de rota). Sem ele, o harness roteia (nível ≥ 3 por padrão).
  let provedor: string;
  let rota: RotaDoSpawn | null = null;
  if (provedorPedido !== null) {
    provedor = provedorPedido;
  } else if (agente !== null && rotaBruta !== "auto") {
    // RA-2 (Fase 14): com `agent_id` o perfil do membro manda (a porta de agentes sobrepõe provedor/modelo no spawn); não gasta decisão do roteador.
    // O provedor aqui é só o espaço reservado para as regras comuns: o primeiro habilitado (sem nenhum, a regra recusa como `provider_disabled`).
    const lista = await deps.provedores.listar(claims.workspace_id);
    provedor = lista.find((p) => p.habilitado)?.provedor ?? "";
  } else {
    if (rotaBruta === "none") throw argumentoInvalido('Com route:"none" o campo "provider" é obrigatório.');
    if (deps.rota === undefined) identificador(a, "provider"); // sem harness ligado: o erro é o do MVP
    const porta = deps.rota;
    if (porta === undefined) throw argumentoInvalido('O campo "provider" é obrigatório.');
    const nivel = await porta.nivel(claims.workspace_id);
    if (nivel <= 1) throw argumentoInvalido('O nível do harness neste workspace não roteia: informe "provider".');
    if (rotaBruta !== "auto" && nivel < NIVEL_AUTO_PADRAO) throw argumentoInvalido('O campo "provider" é obrigatório (use route:"auto" para o harness escolher).');
    const r = await porta.rotear({
      workspace_id: claims.workspace_id,
      mission_id: claims.mission_id,
      pedido_por_pane_id: claims.pane_id,
      papel: papelPedido ?? "executor",
      agente_id: agente,
      task_type: taskType,
      descricao,
      faixa: faixaBruta as RotaDoSpawn["faixa"],
    });
    if (!r.ok) {
      if (r.erro === "no_capacity") throw new ErroMcp("unavailable", r.mensagem, "no_capacity");
      if (r.erro === "no_compatible_cli") throw new ErroMcp("unavailable", r.mensagem, "no_compatible_cli");
      throw erroDeRegra(r.erro, r.mensagem);
    }
    const { ok: _ok, ...resto } = r;
    void _ok;
    rota = resto;
    provedor = rota.provedor;
    modelo ??= rota.modelo;
    conta ??= rota.conta_id;
  }

  const [missao, provedores, panes] = await Promise.all([
    claims.mission_id === null ? Promise.resolve(null) : deps.missoes.obter(claims.mission_id),
    deps.provedores.listar(claims.workspace_id),
    deps.panes.listar({ workspace_id: claims.workspace_id, mission_id: claims.mission_id }),
  ]);
  if (missao !== null && missao.workspace_id !== claims.workspace_id) throw naoAutorizado();

  // OpenRouter (T-09.28): o motivo nominal (sem consentimento / sem modelo habilitado) vem da lista de provedores; só depois as regras comuns
  if (provedor === "openrouter") {
    const or = provedores.find((p) => p.provedor === "openrouter");
    if (or !== undefined && !or.habilitado && or.motivo_desabilitado !== undefined) {
      throw violacaoDeRegra(or.motivo_desabilitado, or.motivo_desabilitado === "openrouter_not_consented" ? "O OpenRouter ainda não foi consentido." : "Nenhum modelo do OpenRouter está habilitado.");
    }
  }
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
  // Fase 15 (DEC-4 d): consulta obrigatória ao RAG antes de implementar (aviso por padrão; bloqueio opcional). RAG fora/desligado nunca bloqueia.
  const consultaRag = await verificarConsultaRag({ rag: deps.rag, workspace_id: claims.workspace_id, mission_id: claims.mission_id, task_ref: taskDoBriefing(briefing), papel });
  if (consultaRag.aviso !== undefined) deps.avisar(consultaRag.aviso);

  // Fase 7 (T-07.20): `skills` só ESTREITA a política do papel do novo worker; o que não cabe é `skill_not_allowed` (nada é aberto)
  if (skillsPedidas.length > 0) {
    const porta = deps.catalogo;
    if (porta === undefined) throw indisponivel("O catálogo não está disponível para validar as skills pedidas.");
    const permitidas = await porta.permitidasDoPapel({ workspace_id: claims.workspace_id, mission_id: claims.mission_id, modo: claims.mode, papel, agente_id: agente });
    if (permitidas !== null) {
      const ok = new Set(permitidas);
      const fora = skillsPedidas.filter((n) => !ok.has(normalizarNomeSkill(n)));
      if (fora.length > 0) throw new ErroMcp("skill_not_allowed", `skill_not_allowed: ${fora.slice(0, 5).join(", ")}. A skill não está na política deste papel.`);
    }
  }
  const skills = [...new Set([...(rota === null ? [] : rota.skills), ...skillsPedidas])];
  const linhaDeSkills = skills.length === 0 ? null : aplicarSkills(rota?.cli ?? provedor, skills, { modo: claims.mode }).linha_no_prompt;
  let paneId: string;
  try {
    // workers herdam mission_id e papel: nunca vêm do argumento
    const { pane_id } = await deps.panes.spawn({
      workspace_id: claims.workspace_id,
      mission_id: claims.mission_id,
      pedido_por_pane_id: claims.pane_id,
      provedor,
      ...(provedor === "openrouter" ? { cli: cliPedida ?? rota?.cli ?? null } : {}),
      modelo,
      conta_id: conta,
      papel,
      agente_id: agente,
      briefing_path: briefing,
      cwd,
      ...(prompt === null ? {} : { prompt }),
      ...(titulo === null ? {} : { titulo }),
      ...(typeof isolarBruto === "boolean" ? { isolar: isolarBruto } : {}),
      ...(aprovacaoBruta === "perguntar" || aprovacaoBruta === "automatico_seguro" ? { aprovacao: aprovacaoBruta } : {}),
      ...(linhaDeSkills === null ? {} : { skills }),
    });
    paneId = pane_id;
  } catch (e) {
    // erro nominal da porta (ex.: OpenRouter sem modelo habilitado/CLI compatível) atravessa; o resto é falha de infraestrutura
    if (e instanceof ErroMcp) throw e;
    throw indisponivel("Não foi possível abrir o Pane.");
  }
  if (rota === null) return { pane_id: paneId };
  try {
    await deps.rota?.gravar(paneId, rota, agente);
  } catch {
    deps.avisar("A rota do Pane não foi gravada; a troca por consumo não verá o perfil dele.");
  }
  const recibo = [...rota.recibo].slice(0, LIMITE_RECIBO_SPAWN).join("");
  return { pane_id: paneId, receipt: recibo, decisions: rota.decisoes.slice(0, 10) };
};

function resumo(p: PaneInfo): Record<string, unknown> {
  return { pane_id: p.pane_id, provider: p.provedor, role: PAPEL_EXTERNO[p.papel], state: ESTADO_PANE_EXTERNO[p.estado], task_id: p.task_id };
}

function resumoFechado(p: PaneFechadoInfo): Record<string, unknown> {
  return {
    pane_id: p.pane_id,
    provider: p.provedor,
    role: PAPEL_EXTERNO[p.papel],
    state: ESTADO_FECHADO_EXTERNO[p.estado],
    task_id: p.task_id,
    closed_by: FECHADO_POR_EXTERNO[p.fechado_por],
    closed_at: p.fechado_em,
    ...(p.codigo === null ? {} : { exit_code: p.codigo }),
    // worker que falhou sem ninguém pedir: o final da saída (redigido) para o orquestrador decidir sem outra chamada
    ...(p.ultimo_trecho === undefined || p.ultimo_trecho === "" ? {} : { last_output: p.ultimo_trecho }),
  };
}

export const paneList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const pedida = identificadorOpcional(a, "mission_id");
  if (pedida !== null && pedida !== claims.mission_id) throw violacaoDeRegra("not_in_mission", "A Missão pedida não é a do token.");
  const panes = await deps.panes.listar({ workspace_id: claims.workspace_id, mission_id: claims.mission_id });
  const vivos = panes.filter((p) => p.estado !== "encerrado").map(resumo);
  // D-520: workers que saíram da grade há pouco (~10 min) continuam na lista com o estado final e quem fechou; `pane_read` devolve a cauda
  let fechados: PaneFechadoInfo[] = [];
  try {
    fechados = (await deps.panes.fechados?.({ workspace_id: claims.workspace_id, mission_id: claims.mission_id })) ?? [];
  } catch {
    fechados = [];
  }
  const ids = new Set(vivos.map((v) => v["pane_id"]));
  return [...vivos, ...fechados.filter((f) => !ids.has(f.pane_id)).map(resumoFechado)];
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
  // D-520: worker fechado há pouco devolve a cauda guardada no main; o estado diz como terminou e quem fechou
  if (leitura.fechado !== undefined) {
    return {
      lines: linhas,
      state: ESTADO_FECHADO_EXTERNO[leitura.fechado.estado],
      closed_by: FECHADO_POR_EXTERNO[leitura.fechado.fechado_por],
      ...(leitura.fechado.codigo === null ? {} : { exit_code: leitura.fechado.codigo }),
    };
  }
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

/** `handoff_read` (D-520): o resumo e o relatório que o worker entregou, lidos do disco pelo main (redigidos e cortados). Só quem tem o worker no escopo da Missão. */
export const handoffRead: ImplTool = async (args, ctx) => {
  const a = comoObjeto(args);
  const id = identificador(a, "pane_id");
  await paneDoEscopo(id, ctx);
  const r = (await ctx.deps.panes.relatorio?.(id)) ?? null;
  if (r === null) throw naoEncontrado("Este worker ainda não entregou handoff: use pane_read para ver a saída dele.");
  return { pane_id: r.pane_id, task_ref: r.task_ref, status: r.status, summary: r.resumo, report_path: r.relatorio_path, report: r.relatorio, truncated: r.truncado };
};
