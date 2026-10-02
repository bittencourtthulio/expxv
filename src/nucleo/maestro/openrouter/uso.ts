// T-16.13 (parte pura) · Uso do OpenRouter nos perfis: argv por CLI, ambiente (só entrada NÃO sensível) e pré-voo. Sem rede, sem cofre, sem disco.
// O ADE nunca lê credenciais das CLIs (D-52): o pré-voo só AVISA o que falta; jamais bloqueia por não conseguir provar autenticação.
// Os formatos de codex/goose/kilo/cline mudam por versão ([LAC]): validar contra a CLI real por `--help` antes de ligar (regra geral 4).
export const HOST_OPENROUTER = "openrouter.ai";
export const URL_OPENROUTER = `https://${HOST_OPENROUTER}/api/v1`;
/** `vendor/modelo[:variante]`; sem espaço, sem `--`, sem começar por hífen, com `/`. */
const ID_OPENROUTER = /^[A-Za-z0-9][A-Za-z0-9._:@-]*\/[A-Za-z0-9][A-Za-z0-9._:/@-]{0,98}$/;
export const idOpenRouterValido = (id: unknown): id is string => typeof id === "string" && id.length <= 100 && ID_OPENROUTER.test(id) && !id.includes("--");

export type CliOpenRouter = "opencode" | "aider" | "codex" | "claude" | "goose" | "kilo" | "cline";
export const CLIS_OPENROUTER: readonly CliOpenRouter[] = ["opencode", "aider", "codex", "claude", "goose", "kilo", "cline"];
/** CLIs que executam os comandos do método (V2); o resto só serve fora do método (squads, rápido, chat). */
export const CLIS_DO_METODO_COM_OPENROUTER: readonly string[] = ["opencode", "claude"];

export interface ArgumentosOpenRouter {
  suportado: boolean;
  /** argumentos SEPARADOS (nunca shell). */
  argv: string[];
  /** a CLI usa a configuração própria (goose/kilo/cline): nada em argv. */
  configuracao_propria: boolean;
  avisos: string[];
}
const NAO: ArgumentosOpenRouter = { suportado: false, argv: [], configuracao_propria: false, avisos: [] };

export function argumentosDoOpenRouter(cli: string, modelo: unknown): ArgumentosOpenRouter {
  if (!idOpenRouterValido(modelo)) return { ...NAO, avisos: ["Modelo OpenRouter inválido: use `vendor/modelo`, sem espaços nem flags."] };
  switch (cli) {
    case "opencode":
    case "aider":
      return { suportado: true, argv: ["--model", `openrouter/${modelo}`], configuracao_propria: false, avisos: [] };
    case "claude":
      return { suportado: true, argv: ["--model", modelo], configuracao_propria: false, avisos: ["Claude Code por gateway desliga o login por assinatura neste Pane."] };
    case "codex":
      return {
        suportado: true,
        argv: ["-c", 'model_providers.openrouter.name="OpenRouter"', "-c", `model_providers.openrouter.base_url="${URL_OPENROUTER}"`, "-c", 'model_providers.openrouter.env_key="OPENROUTER_API_KEY"', "-c", 'model_providers.openrouter.wire_api="chat"', "-c", 'model_provider="openrouter"', "--model", modelo],
        configuracao_propria: false,
        avisos: ["Formato do Codex muda por versão: valide contra `codex --help`."],
      };
    case "goose":
    case "kilo":
    case "cline":
      return { suportado: true, argv: [], configuracao_propria: true, avisos: [`${cli} usa a configuração própria para o endpoint compatível; o ADE não a escreve.`] };
    default:
      return { ...NAO, avisos: [`${cli} não aceita endpoint compatível com o OpenRouter.`] };
  }
}

export interface EntradaDeAmbiente {
  valor: string;
  /** entrada do cofre marcada como sensível (broker): NUNCA vai ao ambiente do Pane. */
  sensivel: boolean;
}
/** Só a entrada NÃO sensível, e só se o workspace ligou `injetar_cofre_no_env`, chega ao ambiente do Pane. */
export function ambienteDoOpenRouter(cli: string, entrada: EntradaDeAmbiente | null, workspaceInjeta: boolean): Record<string, string> {
  if (entrada === null || entrada.sensivel || !workspaceInjeta || entrada.valor === "") return {};
  if (cli === "claude") return { ANTHROPIC_BASE_URL: `https://${HOST_OPENROUTER}/api`, ANTHROPIC_AUTH_TOKEN: entrada.valor };
  if (cli === "opencode" || cli === "aider" || cli === "codex" || cli === "goose" || cli === "kilo" || cli === "cline") return { OPENROUTER_API_KEY: entrada.valor };
  return {};
}

export interface EstadoParaPrevoo {
  chave_no_cofre: boolean;
  workspace_injeta: boolean;
  cli_instalada: boolean;
  modelo_habilitado: boolean;
}
/** O que falta (avisos). Nunca lê credencial nem bloqueia. */
export function prevoo(perfil: { cli: string; modelo: string | null; origem_modelo: "cli" | "openrouter" }, e: EstadoParaPrevoo): string[] {
  if (perfil.origem_modelo !== "openrouter") return [];
  const avisos: string[] = [];
  if (!e.cli_instalada) avisos.push(`${perfil.cli} não está instalada.`);
  if (!e.modelo_habilitado) avisos.push("O modelo não está habilitado na lista do OpenRouter (atualize os modelos e habilite).");
  if (perfil.cli === "claude" || perfil.cli === "aider" || perfil.cli === "codex") {
    if (!e.chave_no_cofre) avisos.push("Não há chave do OpenRouter no cofre.");
    else if (!e.workspace_injeta) avisos.push("O workspace não injeta a chave do cofre no ambiente: autentique a CLI por conta própria.");
  } else avisos.push(`Autentique ${perfil.cli} no OpenRouter por conta própria: o ADE não lê credenciais.`);
  const a = argumentosDoOpenRouter(perfil.cli, perfil.modelo);
  avisos.push(...a.avisos);
  return avisos;
}
