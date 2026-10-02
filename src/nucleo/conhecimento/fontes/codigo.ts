// Fonte código (T-15.15): `git ls-files` (respeita .gitignore), arquivo ≤ 256 KB, sem binário/lock/minificado/gerado e SEM arquivo
// de ambiente/chave (denylist antes de abrir). Incremental por mtime+tamanho. Por símbolo (chunker) com cabeçalho `arquivo › símbolo`.
import { ARQUIVO_CODIGO_MAX_BYTES } from "../constantes";
import { extensaoDe, linguagensSuportadas } from "../chunking/codigo";
import type { Repos } from "../repos";
import type { DocumentoEntrada } from "../tipos";
import { codigoIndexavel, type PortaDisco } from "./disco";

const TEXTO_PURO = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|py|go|rs|java|kt|cs|php|rb|c|h|cpp|hpp|cc|swift|sql|sh|ya?ml|json|toml|css|scss|html|vue|svelte)$/i;

export function arquivosDeCodigo(versionados: readonly string[]): string[] {
  return versionados.filter((r) => codigoIndexavel(r) && TEXTO_PURO.test(r) && !r.startsWith("docs/"));
}

export async function* lerCodigo(p: { disco: PortaDisco; repos: Repos; colecao_id: string; versionados: readonly string[] }): AsyncGenerator<DocumentoEntrada> {
  for (const rel of arquivosDeCodigo(p.versionados)) {
    const info = await p.disco.info(rel);
    if (!info || info.tamanho > ARQUIVO_CODIGO_MAX_BYTES) continue;
    const ant = p.repos.fonte.obter(p.colecao_id, "codigo", rel);
    if (ant && ant.mtime_ms === info.mtime_ms && ant.tamanho === info.tamanho) continue;
    const texto = await p.disco.ler(rel);
    if (texto === null) continue;
    p.repos.fonte.gravar({ colecao_id: p.colecao_id, tipo: "codigo", ref: rel, mtime_ms: info.mtime_ms, tamanho: info.tamanho });
    yield { tipo: "codigo", origem: rel, titulo: rel, texto, formato: "codigo", fonte: "sistema", ocorrido_em: new Date(info.mtime_ms).toISOString(), linguagem: extensaoDe(rel), importancia: 2 };
  }
}

export { linguagensSuportadas };
