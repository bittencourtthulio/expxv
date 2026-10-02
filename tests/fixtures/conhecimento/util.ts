// Utilitários de TESTE do conhecimento (não importado em produção).
import { abrirBancoConhecimento } from "../../../src/nucleo/conhecimento/banco";
import { RegistroEmbeddings } from "../../../src/nucleo/conhecimento/embeddings/registro";
import { ServicoConhecimento, type DepsServico } from "../../../src/nucleo/conhecimento/servico";
import type { DocumentoEntrada } from "../../../src/nucleo/conhecimento/tipos";

export const T0 = "2026-09-01T10:00:00.000Z";

export function novoServico(extra: Partial<DepsServico> = {}, opcoes: { semFts?: boolean } = {}): { s: ServicoConhecimento; fechar(): void } {
  const { banco } = abrirBancoConhecimento(":memory:", opcoes);
  const s = new ServicoConhecimento({ banco, workspace_id: "ws_1", nomeWorkspace: "meu-projeto", raiz: "/work/proj", ...extra });
  return { s, fechar: () => (s.fechar(), banco.fechar()) };
}

export function doc(p: Partial<DocumentoEntrada> & { origem: string; texto: string }): DocumentoEntrada {
  return { tipo: "doc", titulo: p.origem, formato: "markdown", fonte: "sistema", ocorrido_em: T0, ...p };
}

export { RegistroEmbeddings };
