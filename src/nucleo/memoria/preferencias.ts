// Anel 3 (T-08.18/T-08.25, P-23): preferências do usuário. SÓ por ação humana (nunca por `memory_write`), até 50 itens, ≤ 300 chars,
// passam por redação. Valem para todos os projetos (workspace_id NULL).
import type { Banco } from "../banco";
import type { Scrubber } from "../cofre/scrubber";
import { PREFERENCIAS_MAX, PREFERENCIA_CHARS_MAX } from "./constantes";
import { cortarPontos, hashDoConteudo } from "./escrita";
import { redigirTexto } from "./redacao";
import { criarRepoMemoria, novoIdMemoria } from "./repo";
import { MemoriaErro, type Importancia, type LinhaEntrada } from "./tipos";

const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const COLS = "id, workspace_id, mission_id, pane_id, linhagem_id, squad_slug, escopo, anel, tipo, conteudo, fonte, autor_pane_id, importancia, substitui_id, estado, expira_em, redigido, hash_conteudo, contagem, criado_em, atualizado_em";

export interface DepsPreferencias {
  banco: Banco;
  agora?: () => Date;
  scrubber?: Pick<Scrubber, "scrub">;
}

export const listarPreferencias = (banco: Banco): LinhaEntrada[] =>
  banco.consultar<LinhaEntrada>(`SELECT ${COLS} FROM memoria_entrada WHERE workspace_id IS NULL AND anel = 3 AND estado = 'ativa' ORDER BY importancia DESC, atualizado_em DESC`);

export function gravarPreferencia(deps: DepsPreferencias, p: { id: string | null; conteudo: string; importancia?: number }): LinhaEntrada {
  if (typeof p.conteudo !== "string") throw new MemoriaErro("invalid_argument", "conteudo deve ser texto.");
  if (Array.from(p.conteudo).length > PREFERENCIA_CHARS_MAX * 4 || p.conteudo.length > 5000) throw new MemoriaErro("too_large", `a preferência passa de ${PREFERENCIA_CHARS_MAX} caracteres.`);
  const limpo = p.conteudo.replace(CONTROLES, " ").trim();
  if (limpo === "") throw new MemoriaErro("invalid_argument", "preferência vazia.");
  if (Array.from(limpo).length > PREFERENCIA_CHARS_MAX) throw new MemoriaErro("too_large", `a preferência passa de ${PREFERENCIA_CHARS_MAX} caracteres.`);
  const imp = p.importancia ?? 3;
  if (!Number.isInteger(imp) || imp < 1 || imp > 5) throw new MemoriaErro("invalid_argument", "importancia deve estar entre 1 e 5.");
  const red = redigirTexto(limpo, deps.scrubber ? { scrubber: deps.scrubber } : {});
  const conteudo = cortarPontos(red.texto, PREFERENCIA_CHARS_MAX);
  const hash = hashDoConteudo(conteudo);
  const iso = (deps.agora ?? (() => new Date()))().toISOString();
  return deps.banco.transacao((tx) => {
    const repo = criarRepoMemoria(tx);
    if (p.id !== null) {
      const atual = repo.obter(p.id);
      if (!atual || atual.escopo !== "usuario") throw new MemoriaErro("not_found", "preferência não encontrada.");
      tx.executar("UPDATE memoria_entrada SET conteudo = ?, hash_conteudo = ?, importancia = ?, redigido = ?, estado = 'ativa', atualizado_em = ? WHERE id = ?", [conteudo, hash, imp, red.redigido ? 1 : 0, iso, p.id]);
      tx.executar("DELETE FROM memoria_vetor WHERE entrada_id = ?", [p.id]); // o vetor antigo não vale mais
      return repo.obter(p.id) as LinhaEntrada;
    }
    const igual = tx.consultarUm<LinhaEntrada>(`SELECT ${COLS} FROM memoria_entrada WHERE workspace_id IS NULL AND anel = 3 AND hash_conteudo = ? AND estado = 'ativa'`, [hash]);
    if (igual) {
      tx.executar("UPDATE memoria_entrada SET importancia = ?, atualizado_em = ? WHERE id = ?", [imp, iso, igual.id]);
      return repo.obter(igual.id) as LinhaEntrada;
    }
    const n = Number(tx.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE workspace_id IS NULL AND anel = 3 AND estado = 'ativa'")?.n ?? 0);
    if (n >= PREFERENCIAS_MAX) throw new MemoriaErro("limit_reached", `o limite de ${PREFERENCIAS_MAX} preferências foi atingido.`);
    const linha: LinhaEntrada = {
      id: novoIdMemoria(), workspace_id: null, mission_id: null, pane_id: null, linhagem_id: null, squad_slug: null, escopo: "usuario", anel: 3, tipo: "preferencia",
      conteudo, fonte: "usuario", autor_pane_id: null, importancia: imp as Importancia, substitui_id: null, estado: "ativa", expira_em: null, redigido: red.redigido ? 1 : 0,
      hash_conteudo: hash, contagem: 1, criado_em: iso, atualizado_em: iso,
    };
    repo.inserir(linha);
    return linha;
  });
}

export function removerPreferencia(banco: Banco, id: string): boolean {
  return banco.executar("DELETE FROM memoria_entrada WHERE id = ? AND escopo = 'usuario'", [id]).alteracoes > 0;
}
