/**
 * Comandos do piloto e dos workers por CLI (T-03.06). Funções que MONTAM o lançamento (executável,
 * argv sem shell, ambiente e arquivos 0600 a gravar no diretório do app); quem abre o PTY é o main.
 *
 * - Canal de instruções do piloto: `--append-system-prompt` no Claude; arquivo + flag nas demais
 *   (Codex `model_instructions_file`, OpenCode `instructions` na config). CLI sem MCP/prompt por argv
 *   não tem contrato de intake: `pilot_cli_unsupported_intake`.
 * - Workers nascem com contexto limpo (sem retomar conversa) e prompt mínimo: "execute o card X e
 *   entregue pelo handoff"; as instruções completas chegam pelo hook SessionStart (Claude) ou pelo
 *   arquivo de instruções (demais, que usam o fallback de ociosidade).
 * - Todo arquivo gerado vive em `<dirApp>/panes/<pane_id>/`; nada toca a configuração global do usuário.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ModoMissao, Papel, Permissao } from "../dominio";
import { ErroMcp, indisponivel, violacaoDeRegra } from "../mcp/erros";
import type { PedidoToken } from "../mcp/tokens";
import { PRODUTO, variavelDeAmbiente } from "../produto";
import type { FerramentaId } from "../terminais/catalogo";
import { argumentosAutomaticos, argumentosDePromptInicial, combinarAmbientes, configuracaoDeMcp, recursosDaFerramenta } from "../terminais/catalogo";
import { gerarSettingsDoPane } from "./hooks/claude";
import { PASTA_PROMPTS_PADRAO, carregarPrompt, renderizarPrompt, type NomePrompt } from "./prompts";

export interface ServidorParaComando {
  url: string;
  urlGanchos: string;
  emitirToken(pedido: PedidoToken): string;
  revogar(pane_id: string): void;
}

export interface ScriptDeGancho {
  /** executável que roda o script (no app: process.execPath) */
  executavelNode: string;
  electronComoNode?: boolean;
  /** caminho absoluto de hooks/scripts/gancho.mjs */
  script: string;
}

export interface EntradaComando {
  /** id da ferramenta no catálogo de terminais: claude, codex, opencode… */
  ferramenta: string;
  /** caminho do executável detectado */
  executavel: string;
  permissao: Permissao;
  servidor: ServidorParaComando;
  /** diretório do app (userData) onde ficam os arquivos por Pane */
  dirApp: string;
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  modo: ModoMissao;
  ganchos: ScriptDeGancho;
  pastaDePrompts?: string;
}

export interface EntradaPiloto extends EntradaComando {
  /** pedido do usuário / primeira mensagem; `null` = só as instruções */
  objetivo: string | null;
}

export interface EntradaWorker extends EntradaComando {
  papel: Extract<Papel, "executor" | "explorador" | "revisor">;
  task_id: string;
  task_ref: string;
  briefing_path: string | null;
}

export interface ArquivoDoComando {
  /** absoluto, dentro de `<dirApp>/panes/<pane_id>/` */
  caminho: string;
  conteudo: string;
}

export interface ComandoPane {
  executavel: string;
  argumentos: string[];
  ambiente: Record<string, string>;
  arquivos: ArquivoDoComando[];
  /** quem garante o handoff: hooks do Claude Code ou o vigia de ociosidade */
  estrategia_handoff: "hooks" | "fallback" | "nenhuma";
  prompt_inicial: string;
}

const FERRAMENTAS_COM_INTAKE = ["claude", "codex", "opencode"];
const ID_PANE = /^[A-Za-z0-9_-]{1,128}$/;

export const VARIAVEL_URL_GANCHOS = variavelDeAmbiente("GANCHOS_URL");
export const VARIAVEL_TOKEN = variavelDeAmbiente("MCP_TOKEN");

function pastaDoPane(e: EntradaComando): string {
  if (!ID_PANE.test(e.pane_id)) throw new ErroMcp("invalid_argument", "pane_id inválido.");
  return join(e.dirApp, "panes", e.pane_id);
}

function exigirContratoDeIntake(ferramenta: string): void {
  const r = recursosDaFerramenta(ferramenta);
  if (!FERRAMENTAS_COM_INTAKE.includes(ferramenta) || !r.mcp || !r.prompt_inicial) {
    throw violacaoDeRegra("pilot_cli_unsupported_intake", `A CLI "${ferramenta}" não oferece contrato de intake (MCP, canal de instruções e prompt inicial).`);
  }
}

interface Montagem {
  papel: Papel;
  instrucoes: string;
  /** Claude injeta instruções pelo system prompt (piloto) ou pelo hook (worker) */
  instrucoesNoSystemPrompt: boolean;
  promptInicial: string;
}

async function montar(e: EntradaComando, m: Montagem): Promise<ComandoPane> {
  const dir = pastaDoPane(e);
  const token = e.servidor.emitirToken({ workspace_id: e.workspace_id, mission_id: e.mission_id, pane_id: e.pane_id, role: m.papel, mode: e.modo });
  const arquivos: ArquivoDoComando[] = [];
  const nomeServidor = PRODUTO.id;
  const mcpArquivo = join(dir, "mcp.json");
  const mcp = configuracaoDeMcp(e.ferramenta, { nome: nomeServidor, url: e.servidor.url, variavel_token: VARIAVEL_TOKEN, token }, mcpArquivo);
  if (mcp === null) throw indisponivel(`A CLI "${e.ferramenta}" não suporta o MCP do app.`);
  if (mcp.arquivo !== null) arquivos.push({ caminho: mcpArquivo, conteudo: mcp.arquivo });

  const automaticos = [...argumentosAutomaticos(e.ferramenta as FerramentaId, e.permissao)];
  const promptArgv = argumentosDePromptInicial(e.ferramenta, m.promptInicial);
  if (promptArgv === null) throw indisponivel(`A CLI "${e.ferramenta}" não aceita prompt inicial por argumento.`);
  const ambienteGanchos = { [VARIAVEL_URL_GANCHOS]: e.servidor.urlGanchos, [VARIAVEL_TOKEN]: token };
  const instrucoesArquivo = join(dir, "instrucoes.md");

  if (e.ferramenta === "claude") {
    const settings = gerarSettingsDoPane({
      dirApp: e.dirApp,
      pane_id: e.pane_id,
      papel: m.papel,
      nomeServidor,
      executavelNode: e.ganchos.executavelNode,
      ...(e.ganchos.electronComoNode === undefined ? {} : { electronComoNode: e.ganchos.electronComoNode }),
      script: e.ganchos.script,
      variavelUrl: VARIAVEL_URL_GANCHOS,
      variavelToken: VARIAVEL_TOKEN,
    });
    arquivos.push({ caminho: settings.caminho, conteudo: settings.conteudo });
    const argumentos = [...automaticos, ...mcp.argumentos, "--settings", settings.caminho];
    if (m.instrucoesNoSystemPrompt) argumentos.push("--append-system-prompt", m.instrucoes);
    argumentos.push(...promptArgv);
    return {
      executavel: e.executavel,
      argumentos,
      ambiente: combinarAmbientes([mcp.ambiente, ambienteGanchos]),
      arquivos,
      estrategia_handoff: m.papel === "piloto" ? "nenhuma" : "hooks",
      prompt_inicial: m.promptInicial,
    };
  }

  // Codex e OpenCode: arquivo de instruções + flag/config da CLI; sem hooks de Pane, o handoff é vigiado por ociosidade
  arquivos.push({ caminho: instrucoesArquivo, conteudo: m.instrucoes });
  if (e.ferramenta === "codex") {
    return {
      executavel: e.executavel,
      argumentos: [...automaticos, ...mcp.argumentos, "-c", `model_instructions_file=${JSON.stringify(instrucoesArquivo)}`, ...promptArgv],
      ambiente: combinarAmbientes([mcp.ambiente]),
      arquivos,
      estrategia_handoff: m.papel === "piloto" ? "nenhuma" : "fallback",
      prompt_inicial: m.promptInicial,
    };
  }
  return {
    executavel: e.executavel,
    argumentos: [...automaticos, ...promptArgv],
    ambiente: combinarAmbientes([mcp.ambiente, { OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [instrucoesArquivo] }) }]),
    arquivos,
    estrategia_handoff: m.papel === "piloto" ? "nenhuma" : "fallback",
    prompt_inicial: m.promptInicial,
  };
}

async function textoDePrompts(nomes: NomePrompt[], pasta: string | undefined, variaveis: Record<string, string>): Promise<string> {
  const textos: string[] = [];
  for (const nome of nomes) textos.push(renderizarPrompt(await carregarPrompt(nome, pasta ?? PASTA_PROMPTS_PADRAO), variaveis));
  return textos.join("\n\n");
}

/** Comando do piloto: prompt-base + intake como instruções; MCP com token `piloto`; guarda de escrita via settings do Pane. */
export async function montarComandoPiloto(e: EntradaPiloto): Promise<ComandoPane> {
  exigirContratoDeIntake(e.ferramenta);
  const instrucoes = await textoDePrompts(["piloto", "intake"], e.pastaDePrompts, { MISSAO: e.mission_id ?? "" });
  const promptInicial = e.objetivo !== null && e.objetivo.trim() !== "" ? e.objetivo.trim() : "Inicie o intake da Missão com o usuário.";
  return montar(e, { papel: "piloto", instrucoes, instrucoesNoSystemPrompt: true, promptInicial });
}

/** Comando de um worker: contexto limpo e prompt mínimo; o resto vem do hook SessionStart ou do arquivo de instruções. */
export async function montarComandoWorker(e: EntradaWorker): Promise<ComandoPane> {
  const nome: NomePrompt = e.papel === "revisor" ? "revisor" : "worker";
  const instrucoes = await textoDePrompts([nome], e.pastaDePrompts, { MISSAO: e.mission_id ?? "", CARD: e.task_ref });
  const briefing = e.briefing_path === null ? "" : ` Briefing: ${e.briefing_path}.`;
  const promptInicial = `Execute o card ${e.task_ref} (task_id: ${e.task_id}) e entregue pelo handoff_submit.${briefing}`;
  return montar(e, { papel: e.papel, instrucoes, instrucoesNoSystemPrompt: false, promptInicial });
}

export interface EntradaRespawnPiloto extends EntradaPiloto {
  conta_id: string | null;
  /** resumo/handoff da Missão para reinjetar; `null` se não há */
  handoff_da_missao: string | null;
  /** o conteúdo da conversa anterior foi persistido? Se não, o aviso amarelo aparece na UI */
  conteudo_persistido: boolean;
}

export interface RespawnPiloto {
  /** SEMPRE o mesmo pane_id (troca de conta não cria Pane novo) */
  pane_id: string;
  conta_id: string | null;
  comando: ComandoPane;
  aviso_sem_conteudo: boolean;
}

/** Troca de conta do piloto: revoga o token antigo e remonta o comando para o MESMO `pane_id`, reinjetando o contexto da Missão. */
export async function prepararRespawnPiloto(e: EntradaRespawnPiloto): Promise<RespawnPiloto> {
  e.servidor.revogar(e.pane_id);
  const contexto =
    e.handoff_da_missao !== null && e.handoff_da_missao.trim() !== ""
      ? `Você foi reiniciado por troca de conta. Retome a Missão a partir deste contexto:\n\n${e.handoff_da_missao.trim()}`
      : `Você foi reiniciado por troca de conta e o histórico da conversa não foi preservado. Leia os relatórios em ${PRODUTO.pastaNoProjeto}/missoes/${e.mission_id ?? ""}/ e peça ao usuário o que faltar antes de continuar.`;
  const comando = await montarComandoPiloto({ ...e, objetivo: contexto });
  return { pane_id: e.pane_id, conta_id: e.conta_id, comando, aviso_sem_conteudo: !e.conteudo_persistido };
}

/** Grava os arquivos do comando (0600, atômico). Recusa qualquer caminho fora de `<dirApp>/panes/`. */
export async function gravarArquivosDoComando(dirApp: string, arquivos: readonly ArquivoDoComando[]): Promise<void> {
  const base = resolve(join(dirApp, "panes")) + sep;
  for (const a of arquivos) {
    if (!resolve(a.caminho).startsWith(base)) throw new Error("Arquivo fora do diretório do app.");
  }
  for (const a of arquivos) {
    await mkdir(dirname(a.caminho), { recursive: true, mode: 0o700 });
    const temporario = `${a.caminho}.tmp`;
    await writeFile(temporario, a.conteudo, { mode: 0o600 });
    await rename(temporario, a.caminho);
  }
}
