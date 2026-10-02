// Hook `UserPromptSubmit` do ADE para o RAG (Fase 15, DEC-4 camada c; amenda o D-47: o ADE PODE registrar este evento no settings POR Pane).
//
// COMO FALA COM O APP: o script `scripts/rag-contexto.mjs` lê o JSON do hook no stdin e o repassa por `POST <urlGanchos>/rag-contexto` (loopback,
// `Authorization: Bearer` com o token do próprio Pane; URL e token chegam por variáveis de ambiente, nunca por argv), com `AbortSignal.timeout(400)` e FALHA
// ABERTA: erro, recusa ou estouro = nada injetado, saída vazia, código 0 e o prompt segue. A decisão mora aqui (TS, testável sem Electron): só com
// `hook_prompt` ligado, RAG ativo e prompt com intenção de implementação. A resposta vai como `additionalContext` (o envelope do núcleo já vem saneado).
//
// Vive SÓ no settings por Pane (`--settings <arquivo>` em diretório do app); nunca em `~/.claude` nem no `.claude/` do projeto, e NUNCA toca o hook
// `memox-injetar.sh`/`Stop` do projeto: os hooks SOMAM (`juntarHooksDoClaude`). O hook não escreve em `docs/` nem em `.expx/` (D-04): só lê e responde.
// Anti-loop: Pane de etapa do Maestro não recebe o hook (as respostas da entrevista do método não podem ser interceptadas).
import type { Papel } from "../../dominio";
import { TIMEOUT_DO_HOOK_S, type FragmentoDeHooks } from "../../maestro/gancho/settings";
import type { ContextoGancho, PortaRag, RespostaGancho } from "../../mcp/portas";

export const EVENTO_GANCHO_RAG = "rag-contexto";
export const NOME_SCRIPT_RAG = "rag-contexto.mjs";
/** teto do hook (o script também tem o seu de 400 ms; este é o da decisão no main, para a porta pendurada). */
export const TETO_DECISAO_MS = 350;
/** tarefa enviada ao RAG: o prompt do usuário cortado. */
export const MAX_PROMPT_CHARS = 2000;

export interface OpcoesFragmentoRag {
  executavelNode: string;
  electronComoNode?: boolean;
  /** caminho absoluto do `rag-contexto.mjs` */
  script: string;
  variavelUrl: string;
  variavelToken: string;
}

const aspas = (v: string): string => `"${v.replace(/(["\\$`])/g, "\\$1")}"`;

/** Fragmento `UserPromptSubmit` do RAG (soma com o do Maestro e demais via `juntarHooksDoClaude`). */
export function fragmentoDeHooksDoRag(o: OpcoesFragmentoRag): FragmentoDeHooks {
  const prefixo = o.electronComoNode === true ? "ELECTRON_RUN_AS_NODE=1 " : "";
  const comando = `${prefixo}${aspas(o.executavelNode)} ${aspas(o.script)} ${o.variavelUrl} ${o.variavelToken}`;
  return { UserPromptSubmit: [{ hooks: [{ type: "command", command: comando, timeout: TIMEOUT_DO_HOOK_S }] }] };
}

/**
 * O Pane pode ter o hook? Só Claude Code, só com `hook_prompt` ligado e nunca um Pane de etapa do Maestro (anti-loop). O piloto e os workers podem:
 * o texto que o usuário digita neles é o prompt com intenção de implementação.
 */
export function painelRecebeHookRag(p: { cli: string; papel: Papel; hook_prompt: boolean; pane_do_maestro: boolean }): boolean {
  return p.cli === "claude" && p.hook_prompt && !p.pane_do_maestro;
}

// ------------------------------------------------------------------ intenção de implementação
const VERBOS_IMPLEMENTACAO =
  /\b(implement\w*|cri(?:e|ar|ando|ei)|adicion\w+|add|create|creating|build|fix(?:ing)?|corrij\w*|corrig\w+|consert\w+|refator\w*|refactor\w*|alter(?:e|ar|ando)|modifi\w+|troque|trocar|migr\w+|integr\w+|escrev\w+|escreva|construa\w*|desenvolv\w+|develop|ajust\w+|atualiz\w+|remov\w+|apague|delete|rename|renome\w+|extraia|extend\w*|estend\w+|novo|nova|feature|funcionalidade|endpoint|bug)\b/i;
const PERGUNTA_PURA = /^\s*(como|o que|oque|por ?que|porque|qual|quais|onde|quando|quem|what|how|why|where|when|who|explain|explique|me explica|o que é)\b/i;

/** O prompt pede para IMPLEMENTAR/alterar algo? Pergunta pura, comando de barra e texto curto não contam. */
export function temIntencaoDeImplementar(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length < 12 || p.length > 20_000) return false;
  if (p.startsWith("/") || p.includes("<conhecimento_previo")) return false;
  if (PERGUNTA_PURA.test(p) && p.endsWith("?")) return false;
  return VERBOS_IMPLEMENTACAO.test(p);
}

// ------------------------------------------------------------------ decisão (roda no main, rota `/hooks/rag-contexto`)
export interface DepsGanchoRag {
  /** `null` = RAG não ligado neste app: o prompt segue. */
  rag(): Pick<PortaRag, "ativo" | "politica" | "contextoParaInjecao"> | null;
  /** Pane de etapa do Maestro (anti-loop, reconferência no main). */
  ehPaneDoMaestro?(pane_id: string): boolean;
  tetoMs?: number;
}

const vazio: RespostaGancho = { saida: null };

function promptDoCorpo(corpo: unknown): string {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return "";
  const p = (corpo as Record<string, unknown>)["prompt"];
  return typeof p === "string" ? p : "";
}

/** Decisor do `UserPromptSubmit` do RAG: FALHA ABERTA (qualquer erro/lentidão/vazio = o prompt segue sem contexto). Nunca bloqueia (`decision`). */
export function criarDecisorRagPrompt(deps: DepsGanchoRag): (contexto: ContextoGancho, corpo: unknown) => Promise<RespostaGancho> {
  return async (contexto, corpo) => {
    try {
      const rag = deps.rag();
      if (rag === null) return vazio;
      if (deps.ehPaneDoMaestro?.(contexto.pane_id) === true) return vazio;
      const prompt = promptDoCorpo(corpo);
      if (!temIntencaoDeImplementar(prompt)) return vazio;
      const limite = new Promise<RespostaGancho>((ok) => {
        const t = setTimeout(() => ok(vazio), deps.tetoMs ?? TETO_DECISAO_MS);
        t.unref?.();
      });
      const trabalho = (async (): Promise<RespostaGancho> => {
        if (!(await rag.ativo(contexto.workspace_id))) return vazio;
        const politica = await rag.politica(contexto.workspace_id);
        if (!politica.hook_prompt) return vazio;
        const md = (
          await rag.contextoParaInjecao({
            workspace_id: contexto.workspace_id,
            mission_id: contexto.mission_id,
            task_ref: null, // o main resolve a task pelo Pane do token
            pane_id: contexto.pane_id,
            tarefa: prompt.trim().slice(0, MAX_PROMPT_CHARS),
            arquivos: [],
            origem: "hook",
          })
        ).trim();
        return md === "" ? vazio : { saida: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: md } } };
      })();
      trabalho.catch(() => undefined); // a perdedora da corrida não gera rejeição solta
      return await Promise.race([trabalho, limite]);
    } catch {
      return vazio;
    }
  };
}
