// Injeção do gateway no Pane (Fase 7C): UMA entrada MCP (`ev_gateway`) no lugar dos servidores diretos da Loja. A CLI só recebe a URL de `POST /gateway` e um
// token de audiência `gateway` (sem acesso às tools do app nem aos segredos): quem lança os servidores é o main, com segredos do cofre fora do alcance do Pane.
import { variavelDeAmbiente } from "../produto";
import type { ConfiguracaoMcpLoja } from "../loja-mcp/injecao";
import { nomeNaCli } from "../loja-mcp/injecao";

/** id interno do "servidor" gateway: dá o nome `ev_gateway` (prefixo da Loja, então o gate `pre-mcp` o enxerga) */
export const ID_GATEWAY = "gateway";
export const NOME_GATEWAY_NA_CLI = nomeNaCli(ID_GATEWAY);
/** nome da variável de ambiente (derivado do produto) que carrega o token do gateway nas CLIs que leem de ambiente */
export const VARIAVEL_GATEWAY_TOKEN = variavelDeAmbiente("GATEWAY_TOKEN");

export interface EntradaInjecaoGateway {
  cli: string;
  /** `http://127.0.0.1:<porta>/gateway` */
  url: string;
  token: string;
  /** nome da variável de ambiente que carrega o token nas CLIs que leem de ambiente */
  variavelToken: string;
  /** arquivo `mcp.json` do Pane (Claude) */
  arquivo: string;
  /** Missão deny-by-default: Claude recebe `--strict-mcp-config` (só o MCP do app e o gateway entram) */
  estrito?: boolean;
}

const toml = (v: string): string => JSON.stringify(v);
const NOME_VARIAVEL = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Configuração do gateway para a CLI do Pane. Mesma forma de `configuracaoDeMcp`, mas com o nome `ev_gateway` (o nome da Loja tem `_`, que a função do
 * app não aceita) e SEM servidor stdio: a CLI só fala HTTP loopback com o token de audiência `gateway`.
 */
export function configuracaoDoGateway(e: EntradaInjecaoGateway): ConfiguracaoMcpLoja | null {
  if (e.cli !== "claude" && e.cli !== "codex" && e.cli !== "opencode") return null;
  if (!NOME_VARIAVEL.test(e.variavelToken)) throw new Error("Nome de variável do token inválido.");
  const u = new URL(e.url);
  if (u.protocol !== "http:" || u.username !== "" || u.password !== "" || u.pathname !== "/gateway") throw new Error("URL do gateway inválida.");
  const meta = { servidores: [ID_GATEWAY], nomes: { [ID_GATEWAY]: NOME_GATEWAY_NA_CLI }, ambiente_requerido: [], avisos: [] };
  if (e.cli === "claude") {
    const conteudo = { mcpServers: { [NOME_GATEWAY_NA_CLI]: { type: "http", url: e.url, headers: { Authorization: `Bearer ${e.token}` } } } };
    return { argumentos: ["--mcp-config", e.arquivo, ...(e.estrito === true ? ["--strict-mcp-config"] : [])], ambiente: {}, arquivo: JSON.stringify(conteudo), ...meta };
  }
  if (e.cli === "codex") {
    const k = `mcp_servers.${NOME_GATEWAY_NA_CLI}`;
    return { argumentos: ["-c", `${k}.url=${toml(e.url)}`, "-c", `${k}.bearer_token_env_var=${toml(e.variavelToken)}`], ambiente: { [e.variavelToken]: e.token }, arquivo: null, ...meta };
  }
  const config = { mcp: { [NOME_GATEWAY_NA_CLI]: { type: "remote", url: e.url, headers: { Authorization: `Bearer {env:${e.variavelToken}}` }, enabled: true } } };
  return { argumentos: [], ambiente: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), [e.variavelToken]: e.token }, arquivo: null, ...meta };
}

/** Tool do gateway na CLI: `mcp__ev_gateway__<nome>`; o gate `pre-mcp` do gateway reconhece só este prefixo. */
export const PREFIXO_TOOL_GATEWAY = `mcp__${NOME_GATEWAY_NA_CLI}__`;
export const ehToolDoGateway = (ferramenta: unknown): boolean => typeof ferramenta === "string" && ferramenta.startsWith(PREFIXO_TOOL_GATEWAY);
