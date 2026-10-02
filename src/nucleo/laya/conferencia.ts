// Conferência do catálogo do laya contra a API do host (T-25.04, D-697). Função PURA: recebe os metadados que a API
// `?blobs=true` devolve (`rfilename`, `size`, `lfs.sha256`) e o catálogo validado; devolve divergências nominais e a
// lista de arquivos que precisam de hash local (não-LFS, ≤ 5 MB — quem baixa é o script, nunca o app em produção).
import type { CatalogoLaya } from "./catalogo";

export interface IrmaoApiOrigem {
  rfilename: string;
  size: number;
  lfs?: { sha256: string; size: number };
}

export interface ResultadoConferenciaLaya {
  divergencias: string[];
  /** arquivos não-LFS cujo sha256 o script confirma baixando (≤ 5 MB cada). */
  arquivosParaHashLocal: string[];
}

export function conferirCatalogoLaya(catalogo: CatalogoLaya, api: IrmaoApiOrigem[]): ResultadoConferenciaLaya {
  const divergencias: string[] = [];
  const arquivosParaHashLocal: string[] = [];
  const porCaminho = new Map(api.map((a) => [a.rfilename, a]));
  for (const modelo of catalogo.modelos) {
    for (const arquivo of modelo.arquivos) {
      const irmao = porCaminho.get(arquivo.origem_caminho);
      if (irmao === undefined) {
        if (arquivo.sha256 !== null) divergencias.push(`${modelo.id}/${arquivo.nome}: arquivo_ausente_na_origem (${arquivo.origem_caminho})`);
        continue; // a_verificar sem publicação: estado esperado hoje
      }
      if (irmao.size !== arquivo.bytes) divergencias.push(`${modelo.id}/${arquivo.nome}: tamanho divergente (catálogo ${arquivo.bytes}, origem ${irmao.size})`);
      if (arquivo.sha256 === null) {
        if (irmao.lfs?.sha256 !== undefined) divergencias.push(`${modelo.id}/${arquivo.nome}: checksum_publicado_nao_catalogado — atualize o catálogo para liberar o download`);
        continue;
      }
      if (irmao.lfs?.sha256 !== undefined) {
        if (irmao.lfs.sha256 !== arquivo.sha256) divergencias.push(`${modelo.id}/${arquivo.nome}: sha256 divergente do lfs.oid da origem`);
      } else {
        arquivosParaHashLocal.push(arquivo.origem_caminho);
      }
    }
  }
  return { divergencias, arquivosParaHashLocal };
}
