// O que NUNCA entra no dossiê do assistente (nem o conteúdo, nem o NOME): arquivos de ambiente, chaves, credenciais, `.git`, lockfiles, binários.
// Puro. A regra é por NOME de caminho (a decisão acontece antes de qualquer leitura).

const PASTAS_SENSIVEIS = new Set([".git", ".ssh", ".aws", ".gnupg", ".kube", ".azure", ".gcloud", ".config", "secrets", ".secrets", "credentials", "private", ".terraform", ".vault"]);

/** Arquivos de ambiente, chaves, credenciais e tokens (o NOME já os denuncia). */
const ARQUIVO_SENSIVEL = [
  /^\.env(\..*)?$/i, /\.env$/i, /^env\.(local|prod|production|development|staging)$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|ppk|asc|gpg|kdbx|tfvars|tfstate)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /^\.?npmrc$/i, /^\.yarnrc(\.yml)?$/i, /^\.netrc$/i, /^_netrc$/i, /^\.pypirc$/i, /^\.pgpass$/i, /^\.my\.cnf$/i,
  /^\.htpasswd$/i, /^\.git-credentials$/i, /^\.dockercfg$/i, /^\.vault-token$/i,
  /credential/i, /secret/i, /password|senha/i, /^service[-_]?account.*\.json$/i, /^(auth|token)s?\.json$/i, /^kubeconfig/i, /^terraform\.tfvars/i,
  /^\.?(aws|gcloud)[-_]?(credentials|config)/i, /^firebase.*adminsdk.*\.json$/i, /^google[-_]?services\.json$/i, /^\.envrc$/i,
];

const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock",
  "composer.lock", "Gemfile.lock", "go.sum", "pubspec.lock", "packages.lock.json", "gradle.lockfile", "mix.lock", "flake.lock",
]);

const BINARIOS = /\.(png|jpe?g|gif|webp|bmp|ico|icns|svgz|tiff?|heic|avif|mp[34]|mov|avi|mkv|webm|wav|flac|ogg|m4a|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|ear|class|o|a|so|dylib|dll|exe|bin|dmg|pkg|deb|rpm|apk|ipa|wasm|ttf|otf|woff2?|eot|psd|ai|sketch|fig|db|sqlite3?|mdb|parquet|npy|pkl|onnx|pt|safetensors|ckpt|gguf|pyc|pyo|map)$/i;

/** Nome de PASTA que não entra (nem aparece): dependências, artefatos, caches, ocultas e as sensíveis. */
export function pastaOmitida(nome: string, ignoradas: ReadonlySet<string>): { omitir: boolean; sensivel: boolean } {
  if (PASTAS_SENSIVEIS.has(nome.toLowerCase())) return { omitir: true, sensivel: true };
  if (ignoradas.has(nome) || nome.startsWith(".")) return { omitir: true, sensivel: false };
  return { omitir: false, sensivel: false };
}

export const ehArquivoSensivel = (nome: string): boolean => ARQUIVO_SENSIVEL.some((r) => r.test(nome));

/** Arquivo que não entra na árvore nem como conteúdo (lockfile, binário, lixo do sistema); NÃO é sensível, só inútil e pesado. */
export const ehArquivoInutil = (nome: string): boolean => LOCKFILES.has(nome) || BINARIOS.test(nome) || nome === ".DS_Store" || nome === "Thumbs.db";

/** Nome com caractere que não deve ir a prompt (controle, quebra de linha, delimitador de dados). */
// eslint-disable-next-line no-control-regex
export const nomeSeguroParaPrompt = (nome: string): boolean => nome.length <= 120 && !/[\u0000-\u001f\u007f<>`$]/.test(nome);
