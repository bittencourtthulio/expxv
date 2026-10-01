import type { FerramentaId, RecursosFerramenta } from "../../compartilhado/terminais";

export type { FerramentaId, RecursosFerramenta };
export type PermissaoWorkspace = "seguro" | "automatico";

export interface FerramentaCatalogo {
  id: Exclude<FerramentaId, "personalizado">;
  nome: string;
  /** Nomes de executável candidatos, em ordem de preferência. */
  executaveis: readonly string[];
  mapeada: boolean;
  descricao: string;
}

/** Catálogo enxuto do MVP. Presença local não significa autenticação. */
export const CATALOGO_TERMINAIS: readonly FerramentaCatalogo[] = [
  { id: "terminal", nome: "Terminal", executaveis: ["zsh", "bash", "sh", "pwsh", "cmd.exe"], mapeada: true, descricao: "Shell na raiz do workspace" },
  { id: "claude", nome: "Claude Code", executaveis: ["claude"], mapeada: true, descricao: "CLI do Claude Code" },
  { id: "codex", nome: "Codex", executaveis: ["codex"], mapeada: true, descricao: "CLI do Codex" },
  { id: "gemini", nome: "Gemini CLI", executaveis: ["gemini"], mapeada: true, descricao: "CLI do Gemini" },
  { id: "opencode", nome: "OpenCode", executaveis: ["opencode"], mapeada: true, descricao: "CLI do OpenCode" },
  { id: "aider", nome: "Aider", executaveis: ["aider"], mapeada: true, descricao: "AI pair programming no terminal" },
  { id: "qwen", nome: "Qwen Code", executaveis: ["qwen"], mapeada: true, descricao: "CLI do Qwen Code" },
  { id: "kilo", nome: "Kilo Code", executaveis: ["kilo", "kilocode"], mapeada: true, descricao: "CLI do Kilo Code" },
] as const;

/**
 * Opções oficiais que iniciam a CLI sem diálogos de aprovação repetidos. Só saem quando o workspace
 * habilitou o modo automático (D-14); em `seguro` a CLI abre com as aprovações normais.
 */
export function argumentosAutomaticos(id: FerramentaId, permissao: PermissaoWorkspace): readonly string[] {
  if (permissao !== "automatico") return [];
  if (id === "claude") return ["--dangerously-skip-permissions"];
  // O Codex revisa as aprovações automaticamente e mantém o sandbox workspace-write.
  // NUNCA usar o bypass total de sandbox: remove a proteção e provoca pedidos amplos de acesso do macOS.
  if (id === "codex") return ["--approve-for-me"];
  if (id === "gemini") return ["--approval-mode=yolo", "--skip-trust"];
  if (id === "opencode") return ["--auto"];
  if (id === "aider") return ["--yes-always"];
  if (id === "qwen") return ["--approval-mode=yolo"];
  return [];
}

/** Ferramentas cujo agente para com ESC; as demais (terminal, personalizado, aider) recebem Ctrl+C. Nunca encerra o processo. */
const INTERROMPEM_COM_ESC: readonly string[] = ["claude", "codex", "gemini", "opencode", "qwen", "kilo"];

export function teclaDeInterrupcao(id: string): string {
  return INTERROMPEM_COM_ESC.includes(id) ? "\x1b" : "\x03";
}

/** Começa por letra ou dígito: um id iniciado por `-` viraria opção da CLI em `--resume`/`resume` (AUD-24). */
export const ID_CONVERSA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Retomar a conversa: só Claude (`--resume <id>`) e Codex (subcomando `resume <id>`). */
export function argumentosDeRetomada(id: string, conversaId: string): string[] | null {
  if (!ID_CONVERSA.test(conversaId)) return null;
  if (id === "claude") return ["--resume", conversaId];
  if (id === "codex") return ["resume", conversaId];
  return null;
}

/** Prompt inicial por argumento da CLI; vai sempre por último. */
export function argumentosDePromptInicial(id: string, prompt: string): string[] | null {
  if (id === "claude" || id === "codex") return [prompt];
  if (id === "opencode") return ["--prompt", prompt];
  return null;
}

/** Modelo de uma CLI como o MCP (`model_list`) o enxerga. `padrao: true` = o que a própria CLI escolhe sem `--model`. */
export interface ModeloDaFerramenta {
  /** valor aceito em `--model` (ou `default` = deixar a CLI escolher; nunca vira flag). */
  modelo: string;
  padrao?: boolean;
  niveis_esforco: string[];
}

export const MODELO_PADRAO_DA_CLI = "default";

/**
 * Lista ESTÁTICA de modelos por CLI (o app não consulta as CLIs). Para estender, acrescente a CLI/valor aqui:
 * só entram valores que a documentação pública da CLI aceita em `--model`. Sem valor conhecido com certeza,
 * a CLI fica só com o padrão dela (`default`, `padrao: true`), que não gera `--model`.
 * - claude: aliases `opus`, `sonnet`, `haiku` (sempre apontam para o modelo atual da família).
 * - codex, gemini: os nomes de modelo mudam com frequência; por ora só o padrão da CLI.
 */
const MODELOS_ESTATICOS: Readonly<Record<string, readonly ModeloDaFerramenta[]>> = {
  claude: [
    { modelo: "opus", niveis_esforco: [] },
    { modelo: "sonnet", niveis_esforco: [] },
    { modelo: "haiku", niveis_esforco: [] },
  ],
  codex: [{ modelo: MODELO_PADRAO_DA_CLI, padrao: true, niveis_esforco: [] }],
  gemini: [{ modelo: MODELO_PADRAO_DA_CLI, padrao: true, niveis_esforco: [] }],
};

export function modelosDaFerramenta(id: string): ModeloDaFerramenta[] {
  return (MODELOS_ESTATICOS[id] ?? []).map((m) => ({ ...m, niveis_esforco: [...m.niveis_esforco] }));
}

/** CLIs cujo seletor de modelo é `--model <valor>` (documentado nas respectivas CLIs). */
const CLIS_COM_FLAG_MODELO: readonly string[] = ["claude", "codex", "gemini", "opencode", "aider"];
const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;

/** `--model <modelo>` quando a CLI suporta e o valor é seguro (não começa com `-`, sem espaço); senão nenhum argumento. */
export function argumentosDeModelo(id: string, modelo: string | null | undefined): string[] {
  if (modelo === null || modelo === undefined || modelo === MODELO_PADRAO_DA_CLI) return [];
  if (!CLIS_COM_FLAG_MODELO.includes(id) || !MODELO_VALIDO.test(modelo)) return [];
  return ["--model", modelo];
}

/** Ferramentas com hook de atividade (sinaleira exata; `painel_aguardar` do orquestrador). */
export const FERRAMENTAS_COM_HOOK: readonly string[] = ["claude", "codex", "opencode"];

/** O MCP do app é HTTP com `Authorization: Bearer <token>`. O token é o único segredo. */
export interface ServidorMcp {
  /** chave do servidor na configuração da CLI: [a-z][a-z0-9-]*. */
  nome: string;
  /** http://127.0.0.1:<porta>/... */
  url: string;
  /** nome da variável de ambiente que carrega o token para as CLIs que sabem lê-la. */
  variavel_token: string;
  token: string;
}

export interface ConfiguracaoMcp {
  argumentos: string[];
  ambiente: Record<string, string>;
  /** Conteúdo do arquivo 0600 a gravar em `arquivo` (só o Claude usa); `null` nas demais. */
  arquivo: string | null;
}

const NOME_SERVIDOR = /^[a-z][a-z0-9-]{0,63}$/;
const NOME_VARIAVEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const toml = (valor: string): string => JSON.stringify(valor); // string básica do TOML: as escapadas do JSON valem

function validarServidor(s: ServidorMcp): void {
  if (!NOME_SERVIDOR.test(s.nome)) throw new Error("Nome de servidor MCP inválido.");
  if (!NOME_VARIAVEL.test(s.variavel_token)) throw new Error("Nome de variável do token inválido.");
  let url: URL;
  try { url = new URL(s.url); } catch { throw new Error("URL do servidor MCP inválida."); }
  if (url.protocol !== "http:" || url.username !== "" || url.password !== "") throw new Error("URL do servidor MCP deve ser http local sem credenciais.");
}

/**
 * Servidor MCP HTTP do app (painéis/orquestração), por CLI:
 * - Claude: `--mcp-config <arquivo 0600>` (o conteúdo devolvido em `arquivo` leva o cabeçalho);
 * - Codex: `-c mcp_servers.<nome>.url` + `bearer_token_env_var` (o token entra só pelo ambiente);
 * - OpenCode: `OPENCODE_CONFIG_CONTENT` (`mcp.<nome>` remoto, token por `{env:VAR}`).
 * `null` quando a ferramenta não suporta. Combine com os hooks por `combinarAmbientes`.
 */
export function configuracaoDeMcp(id: string, servidor: ServidorMcp, arquivo: string): ConfiguracaoMcp | null {
  if (id !== "claude" && id !== "codex" && id !== "opencode") return null;
  validarServidor(servidor);
  if (id === "claude") {
    const conteudo = { mcpServers: { [servidor.nome]: { type: "http", url: servidor.url, headers: { Authorization: `Bearer ${servidor.token}` } } } };
    return { argumentos: ["--mcp-config", arquivo], ambiente: {}, arquivo: JSON.stringify(conteudo) };
  }
  if (id === "codex") {
    const chave = `mcp_servers.${servidor.nome}`; // só [a-z0-9-]: chave TOML simples, sem aspas
    return {
      argumentos: ["-c", `${chave}.url=${toml(servidor.url)}`, "-c", `${chave}.bearer_token_env_var=${toml(servidor.variavel_token)}`],
      ambiente: { [servidor.variavel_token]: servidor.token },
      arquivo: null,
    };
  }
  const config = { mcp: { [servidor.nome]: { type: "remote", url: servidor.url, headers: { Authorization: `Bearer {env:${servidor.variavel_token}}` }, enabled: true } } };
  return { argumentos: [], ambiente: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), [servidor.variavel_token]: servidor.token }, arquivo: null };
}

export function recursosDaFerramenta(id: string): RecursosFerramenta {
  return {
    prompt_inicial: argumentosDePromptInicial(id, "x") !== null,
    retomar: argumentosDeRetomada(id, "x") !== null,
    mcp: id === "claude" || id === "codex" || id === "opencode",
    hook: FERRAMENTAS_COM_HOOK.includes(id),
  };
}

function fundir(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const saida: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) saida[k] = k in saida ? fundir(saida[k], v) : v;
    return saida;
  }
  return b;
}

/**
 * Junta os ambientes extras de uma sessão (hooks + MCP). Variáveis comuns: a última vence.
 * `OPENCODE_CONFIG_CONTENT` é fundida (plugins somam, `mcp` se junta), porque hook e MCP do OpenCode usam a mesma variável.
 */
export function combinarAmbientes(ambientes: ReadonlyArray<Record<string, string>>): Record<string, string> {
  const saida: Record<string, string> = {};
  let opencode: unknown;
  for (const ambiente of ambientes) {
    for (const [k, v] of Object.entries(ambiente)) {
      if (k !== "OPENCODE_CONFIG_CONTENT") { saida[k] = v; continue; }
      let json: unknown;
      try { json = JSON.parse(v); } catch { continue; }
      opencode = opencode === undefined ? json : fundir(opencode, json);
    }
  }
  if (opencode !== undefined) saida["OPENCODE_CONFIG_CONTENT"] = JSON.stringify(opencode);
  return saida;
}
