/**
 * Ponte do Grok (D-514): o Grok só lê servidores MCP de arquivos (`~/.grok/config.toml`, `.grok/config.toml` do projeto, `.mcp.json`), nunca por flag ou variável de
 * ambiente (D-441). A única forma segura de dar o MCP do app ao Grok sem tocar na configuração GLOBAL do usuário é um arquivo de PROJETO, e só com a autorização explícita do
 * dono, depois de ver o arquivo exato. Garantias deste módulo:
 *  - o arquivo é o `.grok/config.toml` do workspace, criado com `wx` (nunca sobrescreve nem edita um arquivo que já existe);
 *  - o conteúdo NÃO tem segredo: só referências `${VARIAVEL}` que o app preenche no ambiente de cada sessão (URL local e token por Pane);
 *  - tem uma marca na primeira linha; só remove o que tem a marca (e, depois, a pasta `.grok` se ficou vazia e foi criada por ele);
 *  - recusa pasta `.grok` que seja link simbólico ou que resolva para fora do workspace.
 * O app nunca escreve em `~/.grok` (nem lê `config.toml`/`auth.json`).
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { PRODUTO, variavelDeAmbiente } from "../produto";

/** Caminho RELATIVO do arquivo de projeto que o Grok exige (relativo à raiz do workspace; regra 12). */
export const ARQUIVO_DA_PONTE_GROK = ".grok/config.toml";
/** Variáveis do ambiente da sessão que o arquivo referencia (valores só no ambiente do Pane, nunca no disco). */
export const VARIAVEL_PONTE_URL = variavelDeAmbiente("MCP_URL");
export const VARIAVEL_PONTE_TOKEN = variavelDeAmbiente("MCP_TOKEN");
/** Primeira linha do arquivo: o que prova que ele é nosso (e que a remoção pode apagá-lo). */
export const MARCA_DA_PONTE_GROK = `# ${PRODUTO.id}:ponte-mcp v1`;

export type EstadoDaPonteGrok = "ausente" | "ativa" | "bloqueada";

export interface ResumoDaPonteGrok {
  estado: EstadoDaPonteGrok;
  /** caminho relativo do arquivo (sempre `.grok/config.toml`) */
  arquivo: string;
  /** o conteúdo EXATO que será gravado (mostrado no diálogo de autorização) */
  conteudo: string;
  /** explicação curta do estado (PT-BR) */
  detalhe: string;
}

/** O arquivo exato da ponte. Sem segredo: `${...}` é expandido pelo Grok a partir do ambiente da sessão. */
export function conteudoDaPonteGrok(): string {
  return [
    MARCA_DA_PONTE_GROK,
    `# Gerenciado por ${PRODUTO.nome}: liga o servidor MCP do app ao Grok enquanto "Orquestrar neste painel" estiver ligado neste projeto.`,
    "# Não tem segredo: a URL local e o token (por painel) vêm do ambiente da sessão. O app apaga este arquivo ao desligar a orquestração.",
    `[mcp_servers.${PRODUTO.id}]`,
    `url = "\${${VARIAVEL_PONTE_URL}}"`,
    `headers = { "Authorization" = "Bearer \${${VARIAVEL_PONTE_TOKEN}}" }`,
    "",
  ].join("\n");
}

function dentroDe(raiz: string, alvo: string): boolean {
  const rel = relative(resolve(raiz), resolve(alvo));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Pasta `.grok` utilizável: não é link simbólico e fica dentro do workspace. `null` = ok; texto = motivo. */
function problemaNaPasta(raiz: string): string | null {
  const pasta = join(raiz, ".grok");
  if (!existsSync(pasta)) return null;
  const st = lstatSync(pasta);
  if (st.isSymbolicLink()) return "A pasta .grok do projeto é um link simbólico: o app não escreve através de links.";
  if (!st.isDirectory()) return "Já existe um arquivo chamado .grok neste projeto.";
  return dentroDe(raiz, pasta) ? null : "A pasta .grok resolve para fora do projeto.";
}

export function estadoDaPonteGrok(raiz: string): ResumoDaPonteGrok {
  const base = { arquivo: ARQUIVO_DA_PONTE_GROK, conteudo: conteudoDaPonteGrok() };
  const problema = problemaNaPasta(raiz);
  if (problema !== null) return { ...base, estado: "bloqueada", detalhe: problema };
  const arquivo = join(raiz, ARQUIVO_DA_PONTE_GROK);
  if (!existsSync(arquivo)) return { ...base, estado: "ausente", detalhe: "A ponte não está ligada neste projeto." };
  try {
    if (lstatSync(arquivo).isSymbolicLink()) return { ...base, estado: "bloqueada", detalhe: "O .grok/config.toml é um link simbólico." };
    const primeira = readFileSync(arquivo, "utf8").split("\n", 1)[0]?.trim();
    if (primeira === MARCA_DA_PONTE_GROK) return { ...base, estado: "ativa", detalhe: "A ponte está ligada: o Grok enxerga o servidor do app neste projeto." };
  } catch { /* ilegível: tratado como de outra pessoa */ }
  return { ...base, estado: "bloqueada", detalhe: "Já existe um .grok/config.toml neste projeto: o app não o edita. Acrescente o servidor à mão (o conteúdo está no diálogo) ou use outra CLI." };
}

/** Grava a ponte (só depois da autorização do dono, no main). Nunca sobrescreve; devolve o estado resultante. */
export function aplicarPonteGrok(raiz: string): ResumoDaPonteGrok {
  const atual = estadoDaPonteGrok(raiz);
  if (atual.estado !== "ausente") return atual;
  const pasta = join(raiz, ".grok");
  if (!existsSync(pasta)) mkdirSync(pasta, { recursive: false, mode: 0o755 });
  writeFileSync(join(raiz, ARQUIVO_DA_PONTE_GROK), conteudoDaPonteGrok(), { flag: "wx", mode: 0o600 });
  return estadoDaPonteGrok(raiz);
}

/** Remove SÓ o que tem a marca; apaga a pasta `.grok` se ficou vazia. Idempotente. */
export function removerPonteGrok(raiz: string): ResumoDaPonteGrok {
  const atual = estadoDaPonteGrok(raiz);
  if (atual.estado !== "ativa") return atual;
  unlinkSync(join(raiz, ARQUIVO_DA_PONTE_GROK));
  const pasta = join(raiz, ".grok");
  try { if (readdirSync(pasta).length === 0) rmdirSync(pasta); } catch { /* a pasta tem outras coisas: fica */ }
  return estadoDaPonteGrok(raiz);
}

/** Variáveis de ambiente da sessão do Grok que preenchem o arquivo (valores só aqui, nunca no disco). */
export function ambienteDaPonteGrok(url: string, token: string): Record<string, string> {
  return { [VARIAVEL_PONTE_URL]: url, [VARIAVEL_PONTE_TOKEN]: token };
}
