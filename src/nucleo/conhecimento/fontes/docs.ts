// Fonte `docs/**` e relatórios do método (T-15.14): varredura inicial e incremental (mtime+tamanho em `rag_fonte`; hash igual =
// no-op). Só LÊ do disco. Gera `DocumentoEntrada`; o pipeline redige e chunka.
import type { Repos } from "../repos";
import { caminhoProibido } from "../seguranca";
import type { DocumentoEntrada } from "../tipos";
import { classificarDocumento } from "./dominio";
import type { PortaDisco } from "./disco";

export const PREFIXOS_DOCS = ["docs"] as const;
const RAIZES_ADICIONAIS = ["INDICE.md", "ORQUESTRADOR.md"];

/** Itera os documentos novos/alterados desde a última varredura. `alterados` é a lista de caminhos do evento `method.changed` (se houver). */
export async function* lerDocs(p: { disco: PortaDisco; repos: Repos; colecao_id: string; agora: () => string; alterados?: readonly string[] }): AsyncGenerator<DocumentoEntrada> {
  let lista;
  if (p.alterados) {
    lista = [];
    for (const rel of p.alterados) {
      const i = await p.disco.info(rel);
      if (i) lista.push(i);
    }
  } else {
    lista = await p.disco.listarDocs(PREFIXOS_DOCS);
    for (const r of RAIZES_ADICIONAIS) {
      const i = await p.disco.info(r);
      if (i) lista.push(i);
    }
  }
  for (const info of lista) {
    if (caminhoProibido(info.rel) || !/\.(?:md|mdx|markdown|txt)$/i.test(info.rel)) continue;
    const ant = p.repos.fonte.obter(p.colecao_id, "doc", info.rel);
    if (ant && ant.mtime_ms === info.mtime_ms && ant.tamanho === info.tamanho) continue;
    const texto = await p.disco.ler(info.rel, 512 * 1024);
    if (texto === null) continue;
    p.repos.fonte.gravar({ colecao_id: p.colecao_id, tipo: "doc", ref: info.rel, mtime_ms: info.mtime_ms, tamanho: info.tamanho });
    yield {
      tipo: classificarDocumento(info.rel),
      origem: info.rel,
      titulo: /^#\s+(.+)$/m.exec(texto)?.[1]?.slice(0, 200) ?? (info.rel.split("/").pop() as string),
      texto,
      formato: "markdown",
      fonte: "sistema",
      ocorrido_em: new Date(info.mtime_ms).toISOString(),
      importancia: 3,
    };
  }
}
