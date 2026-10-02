// Adaptadores de CLI para modelo do OpenRouter (T-09.27/28): função PURA `montar` → só argv/ambiente/arquivo 0600 do Pane.
// Nunca lê nem escreve configuração global da CLI (teste compara o hash antes/depois). A chave do dono NUNCA vai em argv: no máximo
// em VARIÁVEL DE AMBIENTE do Pane, e só quando o workspace opta por `injetar_cofre_no_env` (P-319, modo b); o padrão é o usuário
// autenticar a CLI por conta própria (modo a). Com proxy local (modo c), `baseUrl`+`tokenPane` entram no lugar da chave: o token do
// Pane é a "chave de API" da CLI, nunca a chave do OpenRouter.
import type { StatusAdaptadorCli } from "../../../compartilhado/harness";

export interface EntradaMontagem {
  /** id do modelo no OpenRouter (`vendor/modelo`). */
  modelo: string;
  /** modo proxy: base URL local. */
  baseUrl?: string;
  /** modo proxy: token do Pane. */
  tokenPane?: string;
  /** modo (b): chave lida do cofre pelo main e entregue só por ambiente. */
  chave?: string;
}
export interface LancamentoMontado {
  argumentos: string[];
  ambiente: Record<string, string>;
  arquivo_temporario?: { nome: string; conteudo: string };
}
export interface AdaptadorCliOpenRouter {
  cli: string;
  status: StatusAdaptadorCli;
  montar(e: EntradaMontagem): LancamentoMontado;
}

const VARIAVEL_CHAVE = "OPENROUTER_API_KEY";

function opencode(e: EntradaMontagem): LancamentoMontado {
  if (e.baseUrl !== undefined && e.tokenPane !== undefined) {
    // proxy: provider `openrouter` apontado para o proxy local, com o token do Pane como chave (config inline, sem arquivo global)
    const config = { provider: { openrouter: { options: { baseURL: e.baseUrl, apiKey: e.tokenPane } } } };
    return { argumentos: ["--model", `openrouter/${e.modelo}`], ambiente: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } };
  }
  return { argumentos: ["--model", `openrouter/${e.modelo}`], ambiente: e.chave === undefined ? {} : { [VARIAVEL_CHAVE]: e.chave } };
}

function aider(e: EntradaMontagem): LancamentoMontado {
  if (e.baseUrl !== undefined && e.tokenPane !== undefined) {
    return { argumentos: ["--model", `openai/${e.modelo}`], ambiente: { OPENAI_API_BASE: e.baseUrl, OPENAI_API_KEY: e.tokenPane } };
  }
  return { argumentos: ["--model", `openrouter/${e.modelo}`], ambiente: e.chave === undefined ? {} : { [VARIAVEL_CHAVE]: e.chave } };
}

// codex: provider customizado por `-c` (a verificar contra a CLI real; desligado até o dono/coordenador validar: P-33)
function codex(e: EntradaMontagem): LancamentoMontado {
  const base = e.baseUrl ?? "https://openrouter.ai/api/v1";
  const chaveVar = e.tokenPane !== undefined ? "OPENROUTER_PANE_TOKEN" : VARIAVEL_CHAVE;
  const ambiente: Record<string, string> = e.tokenPane !== undefined ? { [chaveVar]: e.tokenPane } : e.chave === undefined ? {} : { [chaveVar]: e.chave };
  return {
    argumentos: ["-c", `model_providers.openrouter={name="openrouter",base_url=${JSON.stringify(base)},env_key=${JSON.stringify(chaveVar)}}`, "-c", `model_provider="openrouter"`, "--model", e.modelo],
    ambiente,
  };
}

// goose: ainda fora do catálogo de CLIs; o adaptador existe desligado
function goose(e: EntradaMontagem): LancamentoMontado {
  return { argumentos: ["--model", e.modelo], ambiente: e.chave === undefined ? {} : { [VARIAVEL_CHAVE]: e.chave } };
}

/** Só `verificado` é CLI utilizável (CT-9.35). Ordem = ordem padrão de preferência. */
export const ADAPTADORES_CLI: readonly AdaptadorCliOpenRouter[] = [
  { cli: "opencode", status: "verificado", montar: opencode },
  { cli: "aider", status: "verificado", montar: aider },
  { cli: "codex", status: "a_verificar", montar: codex },
  { cli: "goose", status: "desligado", montar: goose },
];

export const CLIS_PREFERIDAS_PADRAO: readonly string[] = ["opencode", "aider"];

export const adaptadorDaCli = (cli: string): AdaptadorCliOpenRouter | undefined => ADAPTADORES_CLI.find((a) => a.cli === cli);

/** CLIs utilizáveis: instalada E adaptador `verificado`, na ordem de `preferidas` (as demais verificadas vêm depois). */
export function clisUtilizaveis(instaladas: Iterable<string>, preferidas: readonly string[] = CLIS_PREFERIDAS_PADRAO): string[] {
  const ok = new Set(instaladas);
  const verificadas = ADAPTADORES_CLI.filter((a) => a.status === "verificado" && ok.has(a.cli)).map((a) => a.cli);
  const ordem = [...preferidas.filter((c) => verificadas.includes(c)), ...verificadas];
  return [...new Set(ordem)];
}

/** `--model` do OpenRouter começa com letra/dígito: nunca vira opção da CLI. */
export const modeloSeguroParaArgv = (modelo: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._:/@~+-]{2,119}$/.test(modelo);
