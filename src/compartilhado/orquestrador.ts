// Orquestrador de verdade (D-510 em diante): contrato entre main e renderer sobre o que "Orquestrar neste painel" GARANTE em cada CLI. Tipos e uma tabela pura:
// o main usa para montar o comando de lançamento (`nucleo/orquestracao/canal-orquestrador.ts`) e a UI usa para dizer a verdade ao dono (selo e explicação).
// Nada aqui carrega segredo, caminho de máquina nem texto de prompt.

/**
 * Nível de cada proteção, sempre dito com honestidade:
 * - `garantido`: a CLI aplica por flag/configuração oficial por sessão (bloqueio técnico ou canal de sistema);
 * - `parcial`: só instrução forte, ou cobertura incompleta (ex.: arquivos bloqueados, mas o shell segue com as aprovações normais);
 * - `nenhum`: não aplicado (CLI sem o canal, ou liberado pelo dono).
 */
export type NivelDeGarantia = "garantido" | "parcial" | "nenhum";

/** Selo mostrado na UI: `completo` = instrução em canal de sistema E subagentes internos bloqueados; `parcial` = falta uma das duas; `nao_orquestra` = a CLI não consegue abrir agentes. */
export type SeloOrquestrador = "completo" | "parcial" | "nao_orquestra";

export interface GarantiasDoOrquestrador {
  cli: string;
  /** a CLI consegue chamar `pane_spawn` neste projeto agora? */
  orquestra: boolean;
  selo: SeloOrquestrador;
  /** como o prompt do orquestrador chega à CLI (texto curto para a UI), ou `null` quando não chega */
  canal_instrucao: string | null;
  instrucao: NivelDeGarantia;
  subagentes_internos: NivelDeGarantia;
  edicao: NivelDeGarantia;
  /** uma frase para o dono (PT-BR, sem jargão desnecessário) */
  resumo: string;
  /** limites honestos, um por item */
  limites: string[];
  /** a alternativa quando a CLI não orquestra (`null` quando orquestra) */
  alternativa: string | null;
}

export interface OpcoesGarantias {
  /** opt-out do workspace "orquestrador pode editar" */
  orquestradorEdita?: boolean;
  /** permissão efetiva do painel (`automatico` desliga o sandbox somente-leitura do Codex) */
  permissao?: "seguro" | "equilibrado" | "automatico";
  /** Grok: a ponte (D-514) está ativa neste projeto? */
  ponteGrok?: boolean;
}

/** CLIs do catálogo que falam com o MCP do app por sessão (token escopado): é o que permite abrir agentes. */
export const CLIS_QUE_ORQUESTRAM: readonly string[] = ["claude", "codex", "opencode"];

const ALTERNATIVA = "Use Claude Code, Codex ou OpenCode como orquestrador deste painel; esta CLI continua disponível como agente aberto por eles.";

const LIMITE_SHELL = "O shell da CLI segue com as aprovações normais: o app não consegue provar que um comando não grava arquivo.";

/** O que o orquestrador faz com a edição de arquivos, por CLI, antes do opt-out. */
function edicaoDaCli(cli: string, o: OpcoesGarantias): { nivel: NivelDeGarantia; limite: string | null } {
  if (o.orquestradorEdita === true) return { nivel: "nenhum", limite: "Edição liberada pelo projeto (\"orquestrador pode editar\"): só a instrução manda delegar." };
  if (cli === "claude") return { nivel: "parcial", limite: `Edit, Write, MultiEdit e NotebookEdit ficam negados por sessão. ${LIMITE_SHELL}` };
  if (cli === "opencode") return { nivel: "parcial", limite: `As permissões edit e patch ficam negadas por sessão. ${LIMITE_SHELL}` };
  if (cli === "codex") {
    return o.permissao === "automatico"
      ? { nivel: "parcial", limite: "No modo automático o Codex roda com sandbox de escrita no projeto: aqui só a instrução manda delegar." }
      : { nivel: "garantido", limite: "O Codex abre com sandbox somente-leitura: o orquestrador lê e delega, não grava." };
  }
  if (cli === "grok") return { nivel: "parcial", limite: `Regra de negação de Edit e Write por sessão (não validada de ponta a ponta). ${LIMITE_SHELL}` };
  return { nivel: "nenhum", limite: null };
}

export function garantiasDaCli(cli: string, o: OpcoesGarantias = {}): GarantiasDoOrquestrador {
  const edicao = edicaoDaCli(cli, o);
  const limites: string[] = edicao.limite === null ? [] : [edicao.limite];
  if (cli === "claude") {
    return {
      cli, orquestra: true, selo: "completo", canal_instrucao: "prompt de sistema anexado (--append-system-prompt)", instrucao: "garantido",
      subagentes_internos: "garantido", edicao: edicao.nivel, alternativa: null, limites,
      resumo: "Prompt de orquestrador no sistema, subagentes internos (Agent/Task) negados e edição de arquivos negada.",
    };
  }
  if (cli === "codex") {
    return {
      cli, orquestra: true, selo: "completo", canal_instrucao: "instruções do desenvolvedor (-c developer_instructions)", instrucao: "garantido",
      subagentes_internos: "garantido", edicao: edicao.nivel, alternativa: null, limites,
      resumo: "Prompt de orquestrador nas instruções do desenvolvedor, subagentes internos desligados (multi_agent) e sandbox somente-leitura.",
    };
  }
  if (cli === "opencode") {
    return {
      cli, orquestra: true, selo: "completo", canal_instrucao: "arquivo de instruções efêmero (OPENCODE_CONFIG_CONTENT)", instrucao: "garantido",
      subagentes_internos: "garantido", edicao: edicao.nivel, alternativa: null, limites,
      resumo: "Prompt de orquestrador por arquivo de instruções da sessão, subagentes internos (task) negados e edição negada.",
    };
  }
  if (cli === "grok") {
    const ponte = o.ponteGrok === true;
    const naoAbre = ponte ? [] : ["Grok ainda não orquestra: o Grok só lê servidores MCP de arquivos do usuário ou do projeto, nunca por flag ou variável. Autorize a ponte do projeto (mostra o arquivo exato, é removida ao desligar) ou use outra CLI."];
    return {
      cli, orquestra: ponte, selo: ponte ? "parcial" : "nao_orquestra", canal_instrucao: "regras da sessão (--rules)", instrucao: "garantido",
      subagentes_internos: "garantido", edicao: edicao.nivel, alternativa: ponte ? null : ALTERNATIVA,
      limites: [...naoAbre, ...limites, ...(ponte ? ["A ponte depende de o Grok confiar na pasta do projeto e ainda não foi validada de ponta a ponta com o Grok real."] : [])],
      resumo: ponte ? "Ponte do projeto ligada: prompt por --rules e subagentes internos desligados (--no-subagents)." : "Grok ainda não orquestra sem a ponte do projeto.",
    };
  }
  const nome = cli === "gemini" ? "Gemini CLI" : cli === "aider" ? "Aider" : cli === "qwen" ? "Qwen Code" : cli === "kilo" ? "Kilo Code" : cli;
  return {
    cli, orquestra: false, selo: "nao_orquestra", canal_instrucao: null, instrucao: "nenhum", subagentes_internos: "nenhum", edicao: "nenhum", alternativa: ALTERNATIVA,
    resumo: `${nome} não fala com o MCP do app por sessão: não orquestra.`,
    limites: [`${nome} ainda não aceita o servidor do app por sessão sem editar a configuração do usuário, o que o app nunca faz.`],
  };
}

/** Texto único (UI, diálogo e MCP) que explica o "orquestrador só lê e delega" e o opt-out. */
export const TEXTO_ORQUESTRADOR_SO_DELEGA =
  "O orquestrador só lê e delega: ele não edita arquivos nem usa os subagentes internos da CLI; cada tarefa vira um terminal novo, visível ao lado. Se preferir que ele também edite, ligue \"orquestrador pode editar\" neste projeto (a instrução de delegar continua valendo).";

/** Rótulo do selo para a UI. */
export const ROTULO_DO_SELO: Readonly<Record<SeloOrquestrador, string>> = {
  completo: "orquestração completa",
  parcial: "orquestração parcial",
  nao_orquestra: "não orquestra",
};
