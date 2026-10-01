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
import type { ContextoGancho, PortaGanchos, RespostaGancho } from "../../mcp/portas";
import { PRODUTO } from "../../produto";
import { lerBriefing } from "../briefing";
import type { ServicoHandoff } from "../handoff";
import { PASTA_PROMPTS_PADRAO, carregarPrompt, renderizarPrompt, type NomePrompt } from "../prompts";
import { FERRAMENTAS_DE_ESCRITA, MAX_STOP_RETRIES, guardaDoPiloto } from "../regras";
import type { FilaWake } from "../wake";

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
  const conteudo = JSON.stringify({ [MARCADOR_GERENCIADO]: true, hooks }, null, 2);
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
  pastaDePrompts?: string;
  maxStopRetries?: number;
  emitir?(tipo: string, payload: unknown): void;
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

  return {
    async tratar(evento, contexto, corpo) {
      switch (evento) {
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
