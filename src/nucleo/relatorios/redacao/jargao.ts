// Lint de linguagem do relatório do cliente (T-19.12). Termos e padrões PORTADOS de `sem-jargao-no-uso.py` (hook do runx) — as MESMAS exclusões deliberadas
// ("tabela", "campo", "banco", "fila", "servidor"… colidem com o português do cliente e não são jargão). Soma ids internos, SHA e caminhos.
const TERMOS = [
  "api", "endpoint", "backend", "front-end", "frontend", "deploy", "commit", "branch", "merge", "pull request", "repositorio", "repositório",
  "query", "sql", "select *", "insert into", "schema", "migration", "migracao de banco de dados", "migração de banco de dados", "banco de dados", "database",
  "cache", "stacktrace", "stack trace", "exception", "nullable", "boolean", "array", "json", "yaml", "payload", "webhook", "refactor", "refatoracao", "refatoração",
  "hotfix", "regex", "parser", "runtime", "framework", "middleware", "controller", "repository", "unit test", "teste unitario", "teste unitário", "suite de testes", "docker",
  "front end", "back end", "codigo-fonte", "código-fonte", "codigo fonte", "código fonte",
];
const ESTRUTURAIS: [RegExp, string][] = [
  [/`[^`\n]*`/, "trecho de código entre crases"],
  [/```/, "bloco de código"],
  [/\b[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|jsx|mjs|py|rb|go|rs|java|kt|cs|php|sql|sh|ya?ml|json|xml|html|css|scss|vue|swift|c|cpp|h)\b/, "caminho de arquivo"],
  [/\b\w+\.(?:ts|tsx|js|jsx|py|rb|go|java|cs|php|sql|json|ya?ml|sh)\b/, "nome de arquivo de código"],
  [/\b\w+\s*\([^)\n]*\)\s*(?:\{|=>)/, "assinatura de função"],
  [/^\s*at\s+\S+.*:\d+/m, "stack trace"],
  [/\b(?:Error|Exception|Traceback|NullPointer|undefined is not)\b/, "mensagem de erro técnica"],
  [/\b[a-z]+[A-Z]\w*\(/, "nome de função em camelCase"],
  [/\b\w+_\w+\s*\(/, "nome de função em snake_case"],
  // ids internos do sistema de gestão e referências do método: nunca aparecem para o cliente
  [/\b(?:spr|it|ws|mis|pane|epi|mbr|rel|cer|rta)_[0-9A-Za-z]{10,}\b/, "identificador interno"],
  [/\bT-\d{2}\.\d{2}\b/, "referência de task"],
  [/\b(?:OC|PD)-[\w-]+\b/, "referência de ocorrência"],
  [/\bD-\d{1,3}\b/, "referência de decisão"],
  [/\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/, "hash de commit"],
];
export interface ConfigJargao { termos?: readonly string[]; ignorar?: readonly string[] }

/** achados legíveis ("termo técnico: api, cache"); lista vazia = texto limpo. */
export function lintarJargao(texto: string, cfg: ConfigJargao = {}): string[] {
  const achados: string[] = [];
  for (const [re, rotulo] of ESTRUTURAIS) {
    const m = re.exec(texto);
    if (m) achados.push(`${rotulo} ("${m[0].trim().slice(0, 40)}")`);
  }
  const baixo = texto.toLowerCase();
  const ignorar = new Set((cfg.ignorar ?? []).map((t) => t.toLowerCase()));
  const termos = [...TERMOS, ...(cfg.termos ?? []).map((t) => t.toLowerCase())].filter((t) => !ignorar.has(t));
  const achados2 = [...new Set(termos.filter((t) => new RegExp(`(?<![\\w-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(baixo)))].sort().slice(0, 8);
  if (achados2.length > 0) achados.push(`termo técnico: ${achados2.join(", ")}`);
  return achados;
}
export const temJargao = (t: string, cfg?: ConfigJargao): boolean => lintarJargao(t, cfg).length > 0;
