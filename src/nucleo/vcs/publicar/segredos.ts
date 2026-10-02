import { PRODUTO } from "../../produto";

// Arquivos que NUNCA entram num commit feito por este fluxo (D-633): ambiente, chaves, credenciais. Só NOMES são examinados (nunca conteúdo).
// A lista vale em dois lugares: o diálogo avisa em destaque e a instrução ao agente proíbe commitá-los. Falso positivo é preferível a vazamento.

const EXEMPLOS_DE_AMBIENTE = /^\.env\.(example|sample|template|dist|defaults?)$/i;
const EXTENSOES_DE_CHAVE = /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|asc|gpg|crt|cer)$/i;
const NOMES_EXATOS = new Set([
  ".npmrc", ".netrc", "_netrc", ".pgpass", ".htpasswd", ".git-credentials", ".dockercfg", "kubeconfig", ".boto", ".s3cfg", ".pypirc", "secrets.json", "credentials.json", "service-account.json", "terraform.tfstate",
]);
const NOME_SEGREDO = /(^|[._-])(secrets?|credentials?|segredos?|credenciais)([._-]|$)/i;
const EXT_DE_CONFIG = /\.(json|ya?ml|txt|env|ini|toml|conf|cfg|properties|xml|plist)$/i;

export function ehArquivoSensivel(caminho: string): boolean {
  const nome = caminho.replace(/\\/g, "/").split("/").pop() ?? "";
  if (nome === "") return false;
  const baixo = nome.toLowerCase();
  if (baixo === ".env" || (baixo.startsWith(".env.") && !EXEMPLOS_DE_AMBIENTE.test(baixo)) || baixo.endsWith(".env")) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/i.test(nome) && !baixo.endsWith(".pub")) return true;
  if (EXTENSOES_DE_CHAVE.test(nome) && !baixo.endsWith(".pub")) return true;
  if (NOMES_EXATOS.has(baixo) || /^terraform\.tfstate(\.|$)/.test(baixo) || /\.tfvars$/.test(baixo)) return true;
  if (NOME_SEGREDO.test(nome) && EXT_DE_CONFIG.test(nome)) return true;
  if (/^(client_secret|service[-_]account)[^/]*\.json$/i.test(nome)) return true;
  return false;
}

/** Pasta do produto (artefatos do próprio app, ignorada pelo git): fora da contagem e da lista. */
export function naPastaDoProduto(caminho: string): boolean {
  const pasta = PRODUTO.pastaNoProjeto.replace(/\/+$/, "");
  const c = caminho.replace(/\\/g, "/");
  return c === pasta || c.startsWith(`${pasta}/`);
}

export function separarSensiveis(caminhos: readonly string[]): { sensiveis: string[]; comuns: string[] } {
  const sensiveis: string[] = [];
  const comuns: string[] = [];
  for (const c of caminhos) (ehArquivoSensivel(c) ? sensiveis : comuns).push(c);
  return { sensiveis, comuns };
}
