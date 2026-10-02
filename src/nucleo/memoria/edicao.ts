// Edição humana de uma entrada (UI da Fase 8: "Editar" e "Fixar"). SÓ por ação humana (canal `memoria:atualizar`), nunca por tool MCP.
// O texto novo passa pelo mesmo caminho da escrita: sem controles, redação de segredos, corte em code points e novo hash;
// o vetor antigo deixa de valer. "Fixar" = importância 5: a entrada fica fora da compactação, da retenção e da expiração por Missão.
import type { Banco } from "../banco";
import type { Scrubber } from "../cofre/scrubber";
import { CONTEUDO_MAX } from "./constantes";
import { cortarPontos, hashDoConteudo } from "./escrita";
import { gravarPreferencia } from "./preferencias";
import { redigirTexto } from "./redacao";
import { criarRepoMemoria } from "./repo";
import { MemoriaErro, type Importancia, type LinhaEntrada } from "./tipos";

const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export interface DepsEdicao {
  banco: Banco;
  agora?: () => Date;
  scrubber?: Pick<Scrubber, "scrub">;
}

export interface PedidoEdicao {
  id: string;
  conteudo?: string;
  importancia?: number;
}

export function atualizarEntrada(d: DepsEdicao, p: PedidoEdicao): LinhaEntrada {
  if (p.conteudo === undefined && p.importancia === undefined) throw new MemoriaErro("invalid_argument", "nada para atualizar.");
  if (p.importancia !== undefined && (!Number.isInteger(p.importancia) || p.importancia < 1 || p.importancia > 5)) throw new MemoriaErro("invalid_argument", "importancia deve estar entre 1 e 5.");
  if (p.conteudo !== undefined) {
    if (typeof p.conteudo !== "string") throw new MemoriaErro("invalid_argument", "conteudo deve ser texto.");
    if (p.conteudo.length > CONTEUDO_MAX * 8) throw new MemoriaErro("too_large", `o texto passa de ${CONTEUDO_MAX} caracteres.`);
  }
  const atual = criarRepoMemoria(d.banco).obter(p.id);
  if (!atual || atual.estado !== "ativa") throw new MemoriaErro("not_found", "entrada não encontrada.");
  // anel 3 (preferências): mesmo caminho e mesmos limites da tela de preferências
  if (atual.escopo === "usuario") {
    return gravarPreferencia({ banco: d.banco, ...(d.agora ? { agora: d.agora } : {}), ...(d.scrubber ? { scrubber: d.scrubber } : {}) }, { id: p.id, conteudo: p.conteudo ?? atual.conteudo, importancia: p.importancia ?? atual.importancia });
  }
  const iso = (d.agora ?? (() => new Date()))().toISOString();
  const importancia = (p.importancia ?? atual.importancia) as Importancia;
  if (p.conteudo === undefined) {
    d.banco.executar("UPDATE memoria_entrada SET importancia = ?, atualizado_em = ? WHERE id = ?", [importancia, iso, p.id]);
    return criarRepoMemoria(d.banco).obter(p.id) as LinhaEntrada;
  }
  const limpo = p.conteudo.replace(CONTROLES, " ").trim();
  if (limpo === "") throw new MemoriaErro("invalid_argument", "conteudo vazio.");
  if (Array.from(limpo).length > CONTEUDO_MAX) throw new MemoriaErro("too_large", `o texto passa de ${CONTEUDO_MAX} caracteres.`);
  const red = redigirTexto(limpo, d.scrubber ? { scrubber: d.scrubber } : {});
  const conteudo = cortarPontos(red.texto, CONTEUDO_MAX);
  d.banco.transacao((tx) => {
    // texto mudou por mão humana: a fonte passa a "usuario" (um agente não apaga o que o usuário reescreveu)
    tx.executar("UPDATE memoria_entrada SET conteudo = ?, hash_conteudo = ?, importancia = ?, redigido = ?, fonte = 'usuario', atualizado_em = ? WHERE id = ?", [conteudo, hashDoConteudo(conteudo), importancia, red.redigido ? 1 : atual.redigido, iso, p.id]);
    tx.executar("DELETE FROM memoria_vetor WHERE entrada_id = ?", [p.id]);
  });
  return criarRepoMemoria(d.banco).obter(p.id) as LinhaEntrada;
}
