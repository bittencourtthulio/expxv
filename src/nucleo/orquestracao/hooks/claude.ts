/**
 * Hooks por Pane para o Claude Code (T-03.04, 05-CONTRATOS §4).
 *
 * COMO OS HOOKS FALAM COM O APP: cada hook é o mesmo script mínimo (`scripts/gancho.mjs`) que lê o
 * JSON do hook no stdin e o repassa por `POST <urlGanchos>/<evento>` (loopback, `Authorization: Bearer`
 * com o token do próprio Pane; a URL e o token chegam por variáveis de ambiente do Pane). A decisão
 * mora aqui, em TS, sobre as mesmas portas do MCP (testável sem Electron); o script só imprime a
 * resposta. Escolhido em vez de "ler estado de arquivo" porque (a) contador de tentativas, marcação de
 * `failed` e wake precisam do app de qualquer jeito, (b) não há arquivo de estado para sincronizar.
 * Falha de rede: Stop/PostToolUse/SessionStart liberam (app fora = sem orquestração); o guarda de
 * escrita do piloto (PreToolUse) falha FECHADO.
 *
 * O arquivo de settings é POR Pane, em diretório do app, marcado `managed_by_<produto>`. Nunca se
 * escreve em `~/.claude` nem em `.claude/` do projeto.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Papel } from "../../dominio";
import type { DecisaoGate } from "../../catalogo/gate";
import type { IsolamentoClaude } from "../../catalogo/isolamento/claude";
import { EVENTO_GANCHO_MAESTRO, fragmentoDeHooksDoMaestro, juntarHooksDoClaude } from "../../maestro/gancho/settings";
import type { ContextoGancho, PortaGanchos, RespostaGancho } from "../../mcp/portas";
import { PRODUTO } from "../../produto";
import { lerBriefing } from "../briefing";
import type { ServicoHandoff } from "../handoff";
import { PASTA_PROMPTS_PADRAO, carregarPrompt, renderizarPrompt, type NomePrompt } from "../prompts";
import { FERRAMENTAS_DE_ESCRITA, MAX_STOP_RETRIES, guardaDoPiloto } from "../regras";
import type { FilaWake } from "../wake";
import { EVENTO_GANCHO_RAG, fragmentoDeHooksDoRag } from "./rag";

/** Mensagem do stop hook (05-CONTRATOS §4). */
export const MENSAGEM_STOP =
  "O worker tentou encerrar o turno sem chamar handoff_submit. O orquestrador está bloqueado esperando. Chame handoff_submit com o resumo do trabalho antes de encerrar.";

export const MENSAGEM_STOP_RELATORIO =
  "O handoff foi registrado, mas o relatório indicado não existe, não é legível ou está vazio. Grave o relatório em report_path e chame handoff_submit de novo antes de encerrar.";

export const MARCADOR_GERENCIADO = `managed_by_${PRODUTO.id}`;

const ID_PANE = /^[A-Za-z0-9_-]{1,128}$/;

export interface OpcoesSettingsPane {
  /** diretório do app onde ficam os arquivos por Pane (nunca o settings global do usuário) */
  dirApp: string;
  pane_id: string;
  papel: Papel;
  /** nome do servidor MCP na config da CLI (define o nome da tool: mcp__<nome>__handoff_submit) */
  nomeServidor: string;
  /** executável que roda o script (process.execPath no app) */
  executavelNode: string;
  /** o executável é o Electron rodando como Node */
  electronComoNode?: boolean;
  /** caminho absoluto do `gancho.mjs` */
  script: string;
  /** nomes das variáveis de ambiente com a URL dos ganchos e o token do Pane */
  variavelUrl: string;
  variavelToken: string;
  /** Fase 7B: o Pane recebe servidores da Loja de MCPs; liga o gate `pre-mcp` em `mcp__ev_*` (falha fechada). */
  gateMcpLoja?: boolean;
  /** Fase 15 (DEC-4 c): caminho absoluto do `rag-contexto.mjs`; presente = o `UserPromptSubmit` do RAG SOMA aos hooks do Pane (o chamador decide a elegibilidade). */
  ragScript?: string;
  /**
   * Fase 7 (T-07.21): isolamento duro de skills/MCP de usuário. `ativo` soma `PreToolUse` `Skill` → `pre-skill`, `mcp__.*` → `pre-mcp` (no lugar do matcher
   * só da Loja) e `permissions.deny`. Ausente ou `ativo:false` (Pane livre) = settings idêntico ao de antes.
   */
  isolamento?: IsolamentoClaude;
}

export interface SettingsDoPane {
  caminho: string;
  conteudo: string;
}

const aspas = (valor: string): string => `"${valor.replace(/(["\\$`])/g, "\\$1")}"`;

function comandoDoGancho(o: OpcoesSettingsPane, evento: string): string {
  const prefixo = o.electronComoNode === true ? "ELECTRON_RUN_AS_NODE=1 " : "";
  return `${prefixo}${aspas(o.executavelNode)} ${aspas(o.script)} ${evento} ${o.variavelUrl} ${o.variavelToken}`;
}

/** Matcher do hook `pre-mcp`: só as tools que a Loja criou (`mcp__ev_<id>__*`). */
export const MATCHER_MCP_LOJA = "mcp__ev_.*";
/** Matcher do gate de skills (Fase 7). */
export const MATCHER_SKILL = "Skill";
/** Matcher amplo do `pre-mcp` quando há isolamento: toda ferramenta MCP passa pelo gate (Loja + MCP de usuário). */
export const MATCHER_MCP_TODOS = "mcp__.*";

/**
 * Settings de um Pane SEM orquestração (Pane livre) que recebe servidores da Loja: só o gate `pre-mcp`. Mesmo caminho e marcador do
 * settings da orquestração (um Pane nunca tem os dois fluxos), nunca `~/.claude`.
 */
export function gerarSettingsSoGateLoja(o: Pick<OpcoesSettingsPane, "dirApp" | "pane_id" | "executavelNode" | "electronComoNode" | "script" | "variavelUrl" | "variavelToken" | "nomeServidor"> & { maestroScript?: string; ragScript?: string; deny?: readonly string[] }): SettingsDoPane {
  const comando = comandoDoGancho({ ...o, papel: "nenhum" }, "pre-mcp");
  const loja = { PreToolUse: [{ matcher: MATCHER_MCP_LOJA, hooks: [{ type: "command", command: comando, timeout: 10 }] }] };
  // Fase 16: o hook do Maestro SOMA ao gate da Loja (Pane livre do Claude); nunca no settings global/do projeto
  const comMaestro = o.maestroScript === undefined ? loja : juntarHooksDoClaude(loja, fragmentoDoMaestro(o, o.maestroScript));
  // Fase 15: o hook do RAG também SOMA (nunca substitui) ao gate da Loja e ao Maestro
  const hooks = o.ragScript === undefined ? comMaestro : juntarHooksDoClaude(comMaestro, fragmentoDoRag(o, o.ragScript));
  return { caminho: caminhoDeSettings(o.dirApp, o.pane_id), conteudo: JSON.stringify({ [MARCADOR_GERENCIADO]: true, ...(o.deny === undefined || o.deny.length === 0 ? {} : { permissions: { deny: [...o.deny] } }), hooks }, null, 2) };
}

/**
 * D-425: tools do app que o painel livre que orquestra chama SEM pedir aprovação a cada uso (abrir e LER o que ele mesmo abriu). `pane_send` (digita em outro painel) e
 * `pane_close` continuam com a aprovação normal da CLI. Só vale para o servidor do app e só para esta lista; a matriz do token (`TOOLS_AVULSO`) segue sendo o teto.
 */
export const TOOLS_AVULSO_SEM_APROVACAO: readonly string[] = ["provider_list", "model_list", "pane_spawn", "pane_list", "pane_read", "task_list", "task_get", "cost_report"];

/**
 * Settings do painel livre que orquestra (Claude): `permissions.allow` das tools de abrir/ler do app (D-425), o gate `pre-mcp` só quando há Loja (falha fechada) e `deny`
 * opcional. SEM os hooks de piloto (guarda de escrita) nem de worker (Stop/handoff): o painel continua sendo o agente do usuário, com as aprovações normais para o resto.
 */
export function gerarSettingsDoPaneAvulso(o: Pick<OpcoesSettingsPane, "dirApp" | "pane_id" | "executavelNode" | "electronComoNode" | "script" | "variavelUrl" | "variavelToken" | "nomeServidor"> & { gateMcpLoja?: boolean; deny?: readonly string[] }): SettingsDoPane {
  const comando = comandoDoGancho({ ...o, papel: "nenhum" }, "pre-mcp");
  const hooks = o.gateMcpLoja === true ? { PreToolUse: [{ matcher: MATCHER_MCP_LOJA, hooks: [{ type: "command", command: comando, timeout: 10 }] }] } : null;
  const permissions = { allow: TOOLS_AVULSO_SEM_APROVACAO.map((t) => `mcp__${o.nomeServidor}__${t}`), ...(o.deny === undefined || o.deny.length === 0 ? {} : { deny: [...o.deny] }) };
  return { caminho: caminhoDeSettings(o.dirApp, o.pane_id), conteudo: JSON.stringify({ [MARCADOR_GERENCIADO]: true, permissions, ...(hooks === null ? {} : { hooks }) }, null, 2) };
}

/**
 * Settings de um Pane de ETAPA do Maestro no Claude (Fase 16, piso I4): SÓ `permissions.deny` com os comandos git destrutivos (vale também sob
 * `--dangerously-skip-permissions`: negativa vence). Sem hooks, sem token: o Pane de etapa nunca fala com o MCP do app.
 */
export function gerarSettingsSoDeny(o: Pick<OpcoesSettingsPane, "dirApp" | "pane_id"> & { deny: readonly string[] }): SettingsDoPane {
  return { caminho: caminhoDeSettings(o.dirApp, o.pane_id), conteudo: JSON.stringify({ [MARCADOR_GERENCIADO]: true, permissions: { deny: [...o.deny] } }, null, 2) };
}

function fragmentoDoMaestro(o: Pick<OpcoesSettingsPane, "executavelNode" | "electronComoNode" | "variavelUrl" | "variavelToken">, script: string) {
  return fragmentoDeHooksDoMaestro({ executavelNode: o.executavelNode, ...(o.electronComoNode === undefined ? {} : { electronComoNode: o.electronComoNode }), script, variavelUrl: o.variavelUrl, variavelToken: o.variavelToken });
}

/**
 * Settings de um Pane LIVRE do Claude sem Loja: SÓ o hook `UserPromptSubmit` do Maestro (T-16.28). O chamador decide a elegibilidade
 * (`painelElegivel`): piloto, workers, Panes de etapa e Missões nunca recebem este arquivo.
 */
export function gerarSettingsSoMaestro(o: Pick<OpcoesSettingsPane, "dirApp" | "pane_id" | "executavelNode" | "electronComoNode" | "variavelUrl" | "variavelToken"> & { maestroScript: string }): SettingsDoPane {
  const hooks = juntarHooksDoClaude(fragmentoDoMaestro(o, o.maestroScript));
  return { caminho: caminhoDeSettings(o.dirApp, o.pane_id), conteudo: JSON.stringify({ [MARCADOR_GERENCIADO]: true, hooks }, null, 2) };
}

function fragmentoDoRag(o: Pick<OpcoesSettingsPane, "executavelNode" | "electronComoNode" | "variavelUrl" | "variavelToken">, script: string) {
  return fragmentoDeHooksDoRag({ executavelNode: o.executavelNode, ...(o.electronComoNode === undefined ? {} : { electronComoNode: o.electronComoNode }), script, variavelUrl: o.variavelUrl, variavelToken: o.variavelToken });
}

/**
 * Settings de um Pane LIVRE do Claude SÓ com o hook `UserPromptSubmit` do RAG (e, se houver, o do Maestro SOMADO). O chamador decide a elegibilidade
 * (`painelRecebeHookRag`); Pane de etapa do Maestro nunca recebe.
 */
export function gerarSettingsSoRag(o: Pick<OpcoesSettingsPane, "dirApp" | "pane_id" | "executavelNode" | "electronComoNode" | "variavelUrl" | "variavelToken"> & { ragScript: string; maestroScript?: string }): SettingsDoPane {
  const hooks = juntarHooksDoClaude(o.maestroScript === undefined ? null : fragmentoDoMaestro(o, o.maestroScript), fragmentoDoRag(o, o.ragScript));
  return { caminho: caminhoDeSettings(o.dirApp, o.pane_id), conteudo: JSON.stringify({ [MARCADOR_GERENCIADO]: true, hooks }, null, 2) };
}

export function caminhoDeSettings(dirApp: string, pane_id: string): string {
  if (!ID_PANE.test(pane_id)) throw new Error("pane_id inválido para o arquivo de settings.");
  return join(dirApp, "panes", pane_id, "claude-settings.json");
}

/**
 * Settings do Pane (puro). Worker: SessionStart, Stop×2 (handoff registrado; relatório não vazio) e
 * PostToolUse em `handoff_submit`. Piloto: SessionStart e PreToolUse (guarda contra escrever fora da
 * pasta do produto; vale sob skip-permissions).
 */
export function gerarSettingsDoPane(o: OpcoesSettingsPane): SettingsDoPane {
  const gancho = (evento: string, timeout: number) => ({ type: "command", command: comandoDoGancho(o, evento), timeout });
  const hooks: Record<string, unknown[]> = {
    SessionStart: [{ hooks: [gancho("session-start", 10)] }],
  };
  if (o.papel === "piloto") {
    hooks["PreToolUse"] = [{ matcher: FERRAMENTAS_DE_ESCRITA.join("|"), hooks: [gancho("pre-tool-use", 10)] }];
  } else {
    hooks["Stop"] = [{ hooks: [gancho("stop-handoff", 10), gancho("stop-relatorio", 10)] }];
    hooks["PostToolUse"] = [{ matcher: `mcp__${o.nomeServidor}__handoff_submit`, hooks: [gancho("post-tool-use", 10)] }];
  }
  const iso = o.isolamento !== undefined && o.isolamento.ativo ? o.isolamento : null;
  if (iso !== null && iso.gateSkill) hooks["PreToolUse"] = [...(hooks["PreToolUse"] ?? []), { matcher: MATCHER_SKILL, hooks: [gancho("pre-skill", 10)] }];
  if (iso !== null && iso.gateMcpAmplo) hooks["PreToolUse"] = [...(hooks["PreToolUse"] ?? []), { matcher: MATCHER_MCP_TODOS, hooks: [gancho("pre-mcp", 10)] }];
  else if (o.gateMcpLoja === true) hooks["PreToolUse"] = [...(hooks["PreToolUse"] ?? []), { matcher: MATCHER_MCP_LOJA, hooks: [gancho("pre-mcp", 10)] }];
  const somados = o.ragScript === undefined ? hooks : juntarHooksDoClaude(hooks, fragmentoDoRag(o, o.ragScript));
  const conteudo = JSON.stringify({ [MARCADOR_GERENCIADO]: true, ...(iso === null || iso.deny.length === 0 ? {} : { permissions: { deny: [...iso.deny] } }), hooks: somados }, null, 2);
  return { caminho: caminhoDeSettings(o.dirApp, o.pane_id), conteudo };
}

/** Grava o settings do Pane (0600, atômico) e devolve o caminho. Só escreve dentro de `dirApp`. */
export async function gravarSettingsDoPane(o: OpcoesSettingsPane): Promise<string> {
  const { caminho, conteudo } = gerarSettingsDoPane(o);
  const base = resolve(o.dirApp) + sep;
  if (!resolve(caminho).startsWith(base)) throw new Error("Settings fora do diretório do app.");
  await mkdir(join(caminho, ".."), { recursive: true });
  const temporario = `${caminho}.tmp`;
  await writeFile(temporario, conteudo, { mode: 0o600 });
  await rename(temporario, caminho);
  return caminho;
}

export interface ContextoPane {
  workspace_id: string;
  mission_id: string | null;
  papel: Papel;
  task_id: string | null;
  task_ref: string | null;
  /** relativo à raiz */
  briefing_path: string | null;
}

export interface DepsGanchosClaude {
  handoff: Pick<ServicoHandoff, "doPane" | "registrarFalha" | "relatorioLegivel">;
  fila: Pick<FilaWake, "sondar">;
  contexto(pane_id: string): Promise<ContextoPane | null>;
  raiz(workspace_id: string, mission_id: string | null): Promise<string>;
  /**
   * Fase 8 (T-08.16): pacote da Missão (≤ 1 500 caracteres, envelope de dado) do worker, anexado ao `additionalContext` do SessionStart.
   * `null`/ausente = nada a anexar (memória desligada, `pacote_workers` desligado ou sem conteúdo). Falha nunca bloqueia o início.
   */
  pacote?(pane_id: string): Promise<string | null>;
  pastaDePrompts?: string;
  maxStopRetries?: number;
  emitir?(tipo: string, payload: unknown): void;
  /** Fase 7B: gate das tools da Loja (`mcp__ev_*`). Ausente = o gate NEGA (falha fechada). */
  gateMcp?(pane_id: string, ferramenta: string): { permitido: boolean; motivo: string | null };
  /**
   * Fase 7 (T-07.22): gate de skills e de MCP de usuário sobre o snapshot do Pane (`decidirGate`). Ausente = os eventos `pre-skill` e `pre-mcp` fora da Loja NEGAM
   * (falha fechada). Pane sem snapshot (livre) deve devolver `permitido:true`.
   */
  gatePolitica?(pane_id: string, tipo: "skill" | "mcp", nome: string): DecisaoGate;
  /** Fase 16 (T-16.28): decisão do `UserPromptSubmit` do Maestro. Ausente = o evento é ignorado (o prompt segue). Falha aberta. */
  maestroPrompt?(contexto: ContextoGancho, corpo: unknown): Promise<RespostaGancho>;
  /** Fase 15 (DEC-4 c): decisão do `UserPromptSubmit` do RAG (`criarDecisorRagPrompt`). Ausente = o evento é ignorado (o prompt segue). Falha aberta. */
  ragPrompt?(contexto: ContextoGancho, corpo: unknown): Promise<RespostaGancho>;
}

const vazio: RespostaGancho = { saida: null };
const bloqueio = (motivo: string): RespostaGancho => ({ saida: { decision: "block", reason: motivo } });

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function criarGanchosClaude(deps: DepsGanchosClaude): PortaGanchos {
  const maximo = deps.maxStopRetries ?? MAX_STOP_RETRIES;
  /** tentativas de encerrar barradas, por Pane */
  const tentativas = new Map<string, number>();
  const falhou = new Set<string>();

  async function barrarOuLiberar(pane_id: string, ctx: ContextoPane, contextoGancho: ContextoGancho, motivo: string): Promise<RespostaGancho> {
    const feitas = tentativas.get(pane_id) ?? 0;
    if (feitas < maximo) {
      tentativas.set(pane_id, feitas + 1);
      return bloqueio(motivo);
    }
    // estourou max_stop_retries: libera o encerramento e marca failed (uma vez), para não haver laço infinito
    if (!falhou.has(pane_id) && ctx.task_id !== null) {
      falhou.add(pane_id);
      try {
        await deps.handoff.registrarFalha({
          workspace_id: ctx.workspace_id,
          mission_id: ctx.mission_id,
          pane_id: contextoGancho.pane_id,
          papel: ctx.papel,
          task_id: ctx.task_id,
          task_ref: ctx.task_ref,
          motivo: `O worker encerrou o turno ${maximo} vezes sem entregar um handoff válido.`,
        });
      } catch {
        // a liberação não depende da persistência da falha
      }
      deps.emitir?.("pane.closed", { pane_id, reason: "error" });
    }
    return vazio;
  }

  async function stop(evento: "stop-handoff" | "stop-relatorio", c: ContextoGancho): Promise<RespostaGancho> {
    const ctx = await deps.contexto(c.pane_id);
    if (ctx === null || ctx.task_id === null || ctx.papel === "piloto") return vazio; // nada a entregar
    const h = await deps.handoff.doPane(c.pane_id);
    if (evento === "stop-handoff") {
      if (h !== null) {
        tentativas.delete(c.pane_id);
        return vazio;
      }
      return barrarOuLiberar(c.pane_id, ctx, c, MENSAGEM_STOP);
    }
    if (h === null) return vazio; // o outro hook cuida
    if (await deps.handoff.relatorioLegivel(ctx.workspace_id, ctx.mission_id, h.relatorio_path)) {
      tentativas.delete(c.pane_id);
      return vazio;
    }
    return barrarOuLiberar(c.pane_id, ctx, c, MENSAGEM_STOP_RELATORIO);
  }

  async function sessionStart(c: ContextoGancho): Promise<RespostaGancho> {
    const ctx = await deps.contexto(c.pane_id);
    if (ctx === null) return vazio;
    const nome: NomePrompt = ctx.papel === "revisor" ? "revisor" : ctx.papel === "piloto" ? "piloto" : "worker";
    const prompt = await carregarPrompt(nome, deps.pastaDePrompts ?? PASTA_PROMPTS_PADRAO);
    const partes = [renderizarPrompt(prompt, { MISSAO: ctx.mission_id ?? "", CARD: ctx.task_ref ?? "" })];
    if (ctx.briefing_path !== null) {
      const raiz = await deps.raiz(ctx.workspace_id, ctx.mission_id);
      const briefing = await lerBriefing(raiz, ctx.briefing_path);
      if (briefing !== null) partes.push(`## Briefing do card\n\n${briefing.trim()}`);
    }
    if (ctx.papel !== "piloto" && deps.pacote !== undefined) {
      const pacote = await deps.pacote(c.pane_id).catch(() => null);
      if (pacote !== null && pacote.trim() !== "") partes.push(pacote.trim());
    }
    return { saida: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: partes.join("\n\n") } } };
  }

  async function posTool(c: ContextoGancho): Promise<RespostaGancho> {
    // o wake só acorda depois de persistir: sem handoff registrado não há nada a fazer
    if ((await deps.handoff.doPane(c.pane_id)) === null) return vazio;
    await deps.fila.sondar();
    return vazio;
  }

  async function preTool(c: ContextoGancho, corpo: unknown): Promise<RespostaGancho> {
    const ctx = await deps.contexto(c.pane_id);
    if (ctx === null || ctx.papel !== "piloto") return vazio;
    const b = objeto(corpo);
    const ferramenta = typeof b["tool_name"] === "string" ? b["tool_name"] : "";
    const raiz = await deps.raiz(ctx.workspace_id, ctx.mission_id);
    const decisao = guardaDoPiloto({ raiz, cwd: typeof b["cwd"] === "string" ? b["cwd"] : null, ferramenta, entrada: b["tool_input"] });
    if (decisao.permitido) return vazio;
    return {
      saida: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decisao.motivo ?? "Bloqueado." } },
    };
  }

  /**
   * `pre-mcp`: nega `mcp__ev_*` fora do snapshot do Pane. Permitir NÃO força `allow`: devolve vazio e a aprovação normal da CLI continua
   * valendo (a habilitação na UI da Loja libera o servidor; a chamada em si ainda é confirmada pela CLI quando ela pede).
   */
  function negar(motivo: string): RespostaGancho {
    return { saida: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: motivo } } };
  }

  function preMcp(c: ContextoGancho, corpo: unknown): RespostaGancho {
    const b = objeto(corpo);
    const ferramenta = typeof b["tool_name"] === "string" ? b["tool_name"] : "";
    // servidores da Loja (`mcp__ev_*`): o gate da Loja decide; os demais (MCP de usuário) só passam pela política do Pane (Fase 7)
    if (ferramenta.startsWith("mcp__ev_") || ferramenta === "") {
      const d = deps.gateMcp === undefined ? { permitido: false, motivo: "A Loja de MCPs não está ativa." } : deps.gateMcp(c.pane_id, ferramenta);
      if (!d.permitido) return negar(d.motivo ?? "Bloqueado pela Loja de MCPs.");
    }
    if (deps.gatePolitica === undefined) return ferramenta.startsWith("mcp__ev_") ? vazio : negar("O gate de MCP não está ativo: ação bloqueada.");
    let g: DecisaoGate;
    try { g = deps.gatePolitica(c.pane_id, "mcp", ferramenta); } catch { g = { permitido: false, motivo: "O gate de MCP falhou: ação bloqueada." }; }
    if (g.permitido) return vazio;
    return negar(g.motivo ?? "Bloqueado pela política do Pane.");
  }

  /** `pre-skill`: nega skill fora da allow-list do snapshot (vale em modo automático: é hook, não permissão). Falha fechada. */
  function preSkill(c: ContextoGancho, corpo: unknown): RespostaGancho {
    const b = objeto(corpo);
    const entrada = objeto(b["tool_input"]);
    const skill = typeof entrada["skill"] === "string" ? entrada["skill"] : typeof entrada["name"] === "string" ? entrada["name"] : "";
    let g: DecisaoGate;
    try { g = deps.gatePolitica === undefined ? { permitido: false, motivo: "O gate de skills não está ativo: ação bloqueada." } : deps.gatePolitica(c.pane_id, "skill", skill); } catch { g = { permitido: false, motivo: "O gate de skills falhou: ação bloqueada." }; }
    if (g.permitido) return vazio;
    deps.emitir?.("skill.blocked", { pane_id: c.pane_id, skill: g.nome ?? "" });
    return negar(g.motivo ?? "skill_not_allowed.");
  }

  return {
    async tratar(evento, contexto, corpo) {
      switch (evento) {
        case "pre-mcp":
          return preMcp(contexto, corpo);
        case "pre-skill":
          return preSkill(contexto, corpo);
        case EVENTO_GANCHO_MAESTRO:
          return deps.maestroPrompt === undefined ? vazio : deps.maestroPrompt(contexto, corpo).catch(() => vazio);
        case EVENTO_GANCHO_RAG:
          return deps.ragPrompt === undefined ? vazio : deps.ragPrompt(contexto, corpo).catch(() => vazio);
        case "stop-handoff":
        case "stop-relatorio":
          return stop(evento, contexto);
        case "session-start":
          return sessionStart(contexto);
        case "post-tool-use":
          return posTool(contexto);
        case "pre-tool-use":
          return preTool(contexto, corpo);
        default:
          return vazio;
      }
    },
  };
}
