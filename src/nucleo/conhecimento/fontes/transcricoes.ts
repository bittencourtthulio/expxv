// Fonte transcrições (T-15.17): por padrão SÓ sessões iniciadas pelo app (o chamador passa só as sessões conhecidas, via
// `sessao.cli_ref_conversa`). Importar histórico antigo das CLIs é ação explícita com consentimento (P-51): este módulo recusa sem ele.
// Incremental por offset em `rag_fonte`; saída de ferramenta e raciocínio nunca entram (parsers).
import type { Repos } from "../repos";
import type { EntradaConhecimento } from "../tipos";
import { parsearClaude, type ResultadoParse } from "./transcricoes/claude";
import { parsearCodex } from "./transcricoes/codex";

export type CliTranscricao = "claude" | "codex";

export interface SessaoTranscricao {
  sessao_id: string;
  cli: CliTranscricao;
  modelo: string | null;
  mission_id: string | null;
  pane_id: string | null;
  /** conteúdo jsonl COMPLETO (a leitura do arquivo é do chamador). */
  jsonl: string;
  /** a sessão foi iniciada pelo app? Histórico antigo (false) exige `consentimentoHistorico`. */
  iniciadaPeloApp: boolean;
  ocorrido_em: string;
}

export class HistoricoSemConsentimentoErro extends Error {
  override name = "HistoricoSemConsentimentoErro";
  constructor() {
    super("Importar o histórico das CLIs exige consentimento explícito do usuário.");
  }
}

export function lerTranscricao(p: { repos: Repos; colecao_id: string; workspace_id: string; sessao: SessaoTranscricao; consentimentoHistorico?: boolean }): EntradaConhecimento[] {
  const s = p.sessao;
  if (!s.iniciadaPeloApp && p.consentimentoHistorico !== true) throw new HistoricoSemConsentimentoErro();
  const ant = p.repos.fonte.obter(p.colecao_id, "transcricao", s.sessao_id);
  const inicio = ant?.ultimo_offset ?? 0;
  const r: ResultadoParse = s.cli === "claude" ? parsearClaude(s.jsonl, inicio) : parsearCodex(s.jsonl, inicio);
  const base = ant?.tamanho ?? 0; // número de trocas já emitidas
  const saida: EntradaConhecimento[] = r.trocas.map((t, i) => ({
    tipo: "session.turn_ended",
    workspace_id: p.workspace_id,
    sessao_id: s.sessao_id,
    pane_id: s.pane_id,
    mission_id: s.mission_id,
    cli: s.cli,
    modelo: s.modelo,
    usuario: t.usuario,
    resposta: t.resposta,
    ferramentas: [...(t.ferramentas ?? [])],
    arquivos: [...(t.arquivos ?? [])],
    ocorrido_em: s.ocorrido_em,
    indice: base + i,
  }));
  p.repos.fonte.gravar({ colecao_id: p.colecao_id, tipo: "transcricao", ref: s.sessao_id, ultimo_offset: r.offset, tamanho: base + saida.length });
  return saida;
}
