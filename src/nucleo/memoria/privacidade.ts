// Exclusão, privacidade e exportação (T-08.19). Nada aqui grava arquivo: o main abre o diálogo de salvar e grava atômico.
// Eventos `memory.forgotten|purged` NUNCA levam conteúdo (só ids e contagens).
import type { Banco } from "../banco";
import type { Scrubber } from "../cofre/scrubber";
import type { EscopoMemoria } from "./tipos";
import { relativizarTexto } from "./eventos-conhecimento";
import { raizDaLinhagem } from "./linhagem";
import { redigirTexto } from "./redacao";
import { criarRepoMemoria } from "./repo";
import { MemoriaErro, type ContextoMemoria } from "./tipos";

export interface DepsPrivacidade {
  banco: Banco;
  agora?: () => Date;
  scrubber?: Pick<Scrubber, "scrub">;
  /** raiz do workspace: a exportação (artefato que o usuário pode compartilhar) sai com caminhos relativos a ela. */
  raizDoWorkspace?: (workspaceId: string) => string | undefined;
  /** barramento de domínio (`memory.forgotten` | `memory.purged`); só metadados. */
  emitir?: (tipo: "memory.forgotten" | "memory.purged", payload: Record<string, string | number>) => void;
}

const emitir = (d: DepsPrivacidade, t: "memory.forgotten" | "memory.purged", p: Record<string, string | number>): void => {
  try {
    d.emitir?.(t, p);
  } catch {
    /* auditoria nunca derruba a operação */
  }
};

/**
 * Apagar de verdade (auditoria 2026-10): `DELETE` comum deixa o texto legível em páginas livres do arquivo, no WAL e nos segmentos do
 * índice FTS5. Aqui: `secure_delete` (zera as páginas), `optimize` do FTS5 (funde os segmentos que ainda tinham os termos) e
 * checkpoint TRUNCATE (descarta as páginas antigas do WAL). Tudo é melhor esforço: nunca impede a exclusão.
 */
export function apagarDeVerdade<T>(banco: Banco, apagar: () => T): T {
  return apagarComSecureDelete(banco, apagar, true);
}

/** Só o `secure_delete` (usado pela purga em fatias do ciclo, que tem orçamento de 20 ms e não pode fundir o índice a cada fatia). */
export function apagarComSecureDelete<T>(banco: Banco, apagar: () => T, higienizar = false): T {
  let anterior: number | null = null;
  try {
    anterior = Number(banco.consultarUm<{ secure_delete: number }>("PRAGMA secure_delete")?.secure_delete ?? 0);
    banco.executar("PRAGMA secure_delete = ON");
  } catch {
    /* sem o pragma: segue com o DELETE comum */
  }
  try {
    return apagar();
  } finally {
    const depois = [...(higienizar ? ["INSERT INTO memoria_fts(memoria_fts) VALUES('optimize')", "PRAGMA wal_checkpoint(TRUNCATE)"] : []), `PRAGMA secure_delete = ${anterior === 1 ? "ON" : anterior === 2 ? "FAST" : "OFF"}`];
    for (const sql of depois) {
      try {
        banco.executar(sql);
      } catch {
        /* FTS5 ausente ou leitor ativo: o apagamento já foi feito */
      }
    }
  }
}

/** Ação humana: esquece uma entrada qualquer. */
export function esquecer(d: DepsPrivacidade, entradaId: string): { ok: boolean } {
  const ok = apagarDeVerdade(d.banco, () => criarRepoMemoria(d.banco).apagarEntrada(entradaId)) > 0;
  if (ok) emitir(d, "memory.forgotten", { entrada_id: entradaId, removidas: 1 });
  return { ok };
}

/** `memory_forget` de agente: só entrada da própria linhagem/Missão do token, de fonte agente ou do próprio Pane. */
export function esquecerComoAgente(d: DepsPrivacidade, ctx: ContextoMemoria, entradaId: string): { ok: true } {
  const l = criarRepoMemoria(d.banco).obter(entradaId);
  if (!l || l.workspace_id !== ctx.workspace_id) throw new MemoriaErro("not_found", "entrada não encontrada.");
  const daLinhagem = ctx.linhagem_id !== null && l.linhagem_id === ctx.linhagem_id;
  const daMissao = ctx.mission_id !== null && l.mission_id === ctx.mission_id && l.escopo === "missao";
  if (!daLinhagem && !daMissao) throw new MemoriaErro("unauthorized", "a entrada não é deste Pane/Missão.");
  if (l.escopo === "usuario" || l.anel === 3) throw new MemoriaErro("unauthorized", "preferências do usuário só se removem por ação humana.");
  if (l.fonte !== "agente" && !(l.autor_pane_id !== null && l.autor_pane_id === ctx.pane_id)) throw new MemoriaErro("unauthorized", "só entradas de fonte agente ou do próprio Pane.");
  apagarDeVerdade(d.banco, () => criarRepoMemoria(d.banco).apagarEntrada(entradaId));
  emitir(d, "memory.forgotten", { entrada_id: entradaId, removidas: 1 });
  return { ok: true };
}

/** Apaga a linhagem inteira do Pane. */
export function esquecerPane(d: DepsPrivacidade, paneId: string): { removidas: number } {
  const raiz = raizDaLinhagem(d.banco, paneId);
  const removidas = apagarDeVerdade(d.banco, () => criarRepoMemoria(d.banco).apagarLinhagem(raiz));
  emitir(d, "memory.forgotten", { pane_id: paneId, removidas });
  return { removidas };
}

/** `confirmacao` precisa ser o NOME do workspace digitado. `usuario` não pertence a workspace (use `removerPreferencia`). */
export function purgar(d: DepsPrivacidade, p: { workspace_id: string; escopo: EscopoMemoria | "tudo"; confirmacao: string }): { removidas: number } {
  const ws = d.banco.consultarUm<{ nome: string }>("SELECT nome FROM workspace WHERE id = ?", [p.workspace_id]);
  if (!ws) throw new MemoriaErro("not_found", "workspace não encontrado.");
  if (typeof p.confirmacao !== "string" || p.confirmacao !== ws.nome) throw new MemoriaErro("invalid_argument", "confirmação inválida: digite o nome do projeto.");
  const removidas = apagarDeVerdade(d.banco, () => criarRepoMemoria(d.banco).apagarWorkspace(p.workspace_id, p.escopo));
  emitir(d, "memory.purged", { workspace_id: p.workspace_id, escopo: p.escopo, removidas });
  return { removidas };
}

export interface ExportacaoMemoria {
  versao: 1;
  exportado_em: string;
  entradas: Array<{ id: string; escopo: string; anel: number; tipo: string; conteudo: string; fonte: string; importancia: number; redigido: boolean; estado: string; criado_em: string; atualizado_em: string }>;
}

/** JSON `{versao, exportado_em, entradas[]}`; redige DE NOVO (defesa em profundidade). Entradas esquecidas já não existem. */
export function exportar(d: DepsPrivacidade, p: { workspace_id: string; escopo: EscopoMemoria | "tudo" }): ExportacaoMemoria {
  const filtroEscopo = p.escopo === "tudo" ? "" : " AND escopo = ?";
  const linhas = d.banco.consultar<{ id: string; escopo: string; anel: number; tipo: string; conteudo: string; fonte: string; importancia: number; redigido: number; estado: string; criado_em: string; atualizado_em: string }>(
    `SELECT id, escopo, anel, tipo, conteudo, fonte, importancia, redigido, estado, criado_em, atualizado_em FROM memoria_entrada WHERE workspace_id = ? AND estado = 'ativa' AND (expira_em IS NULL OR expira_em > ?)${filtroEscopo} ORDER BY id`,
    [p.workspace_id, (d.agora ?? (() => new Date()))().toISOString(), ...(p.escopo === "tudo" ? [] : [p.escopo])],
  );
  if (p.escopo === "tudo" || p.escopo === "usuario") {
    linhas.push(...d.banco.consultar<(typeof linhas)[number]>("SELECT id, escopo, anel, tipo, conteudo, fonte, importancia, redigido, estado, criado_em, atualizado_em FROM memoria_entrada WHERE escopo = 'usuario' AND estado = 'ativa' ORDER BY id"));
  }
  return {
    versao: 1,
    exportado_em: (d.agora ?? (() => new Date()))().toISOString(),
    entradas: linhas.map((l) => {
      // o arquivo sai do app: caminhos relativos à raiz do projeto; o que for absoluto e de fora vira "…" (nunca o nome do usuário do sistema)
      const r = redigirTexto(relativizarTexto(l.conteudo, d.raizDoWorkspace?.(p.workspace_id)), d.scrubber ? { scrubber: d.scrubber } : {});
      return { id: l.id, escopo: l.escopo, anel: l.anel, tipo: l.tipo, conteudo: r.texto, fonte: l.fonte, importancia: l.importancia, redigido: l.redigido === 1 || r.redigido, estado: l.estado, criado_em: l.criado_em, atualizado_em: l.atualizado_em };
    }),
  };
}
