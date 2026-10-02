// Entrega da instrução ao agente (D-635), com o contrato de entrega confirmada (D-620): `entregue` só quando a instrução JÁ está na CLI.
//  - painel em foco é uma CLI de IA "pronta" deste workspace → escreve nele (uma linha; a instrução completa mora num arquivo da pasta do produto);
//  - painel ocupado (trabalhando/aguardando/iniciando) → devolve `ocupado` e a UI pergunta antes de abrir um novo;
//  - sem painel de CLI → abre um Pane novo com a CLI padrão do workspace, instrução como prompt inicial, e observa a largada;
//  - falhou → motivo claro e NADA de navegar.
// O módulo é puro: Pane, escrita e abertura vêm injetados (o main liga ao serviço de Panes; o teste usa dublês).
import type { PedidoEnviarInstrucao, ResultadoEnviarInstrucao } from "../../../compartilhado/vcs-publicar";

export interface PaneDeCli {
  id: string;
  workspace_id: string;
  cli: string;
  estado: string;
  sessao_pty_id: string | null;
  /** Pane de uma Missão trabalha numa árvore própria (worktree): o resumo do diálogo é do workspace, então ele NÃO serve de destino. */
  mission_id?: string | null;
  /** cwd forçado (worktree de trabalho): idem. */
  cwd?: string | null;
}

export interface DependenciasEntrega {
  /** Pane vivo da sessão (ausente = terminal avulso/sem Pane). */
  paneDaSessao(sessaoId: string): PaneDeCli | undefined;
  cliPadrao(): Promise<string | null>;
  /** só CLIs de IA (nunca `terminal`/`personalizado`). */
  cliDeIa(cli: string): boolean;
  /** escreve a linha no PTY do Pane (lança com `motivo` quando o Pane não aceita). */
  escrever(paneId: string, linha: string): Promise<{ sessao_id: string | null }>;
  abrir(cli: string, linha: string): Promise<{ pane_id: string; sessao_id: string | null }>;
  /** `null` = a CLI segue viva; texto (possivelmente vazio) = já saiu, com o motivo. Chamado até o fim da janela de confirmação. */
  saiuNaLargada(paneId: string): Promise<string | null>;
  nomeDaCli(cli: string): string;
}

const vazio = (p: Partial<ResultadoEnviarInstrucao>): ResultadoEnviarInstrucao => ({ estado: "falhou", motivo: null, pane_id: null, sessao_id: null, entrega: null, instrucao_rel: null, ...p });

export const MOTIVO_SEM_CLI = "Nenhuma CLI de IA está instalada neste workspace: instale o Claude Code, Codex, OpenCode ou outra e tente de novo.";
export const MOTIVO_OCUPADO = "O agente está trabalhando. Abrir um painel novo para isto?";

/** Decisão pura (testável por tabela): o que fazer dado o painel em foco e a escolha. */
export type DecisaoEntrega = { acao: "escrever"; pane: PaneDeCli } | { acao: "ocupado"; pane: PaneDeCli } | { acao: "abrir"; cli: string | null };

export function decidirEntrega(p: { foco: PaneDeCli | undefined; workspace_id: string; cliEscolhida: string | null; modo_painel: "auto" | "novo"; cliDeIa: (c: string) => boolean }): DecisaoEntrega {
  const f = p.foco;
  // só Pane LIVRE do workspace (sem Missão nem cwd próprio): o agente precisa enxergar o mesmo repositório que o diálogo resumiu
  const valido = f !== undefined && f.workspace_id === p.workspace_id && f.estado !== "encerrado" && f.sessao_pty_id !== null && (f.mission_id ?? null) === null && (f.cwd ?? null) === null && p.cliDeIa(f.cli) ? f : undefined;
  if (p.modo_painel === "novo") return { acao: "abrir", cli: p.cliEscolhida ?? valido?.cli ?? null };
  if (valido === undefined) return { acao: "abrir", cli: p.cliEscolhida };
  if (p.cliEscolhida !== null && p.cliEscolhida !== valido.cli) return { acao: "abrir", cli: p.cliEscolhida };
  return valido.estado === "pronto" ? { acao: "escrever", pane: valido } : { acao: "ocupado", pane: valido };
}

export async function entregarInstrucao(d: DependenciasEntrega, pedido: Pick<PedidoEnviarInstrucao, "workspace_id" | "sessao_foco" | "cli" | "modo_painel">, linha: string): Promise<ResultadoEnviarInstrucao> {
  const foco = pedido.sessao_foco === null ? undefined : d.paneDaSessao(pedido.sessao_foco);
  const decisao = decidirEntrega({ foco, workspace_id: pedido.workspace_id, cliEscolhida: pedido.cli, modo_painel: pedido.modo_painel, cliDeIa: d.cliDeIa });
  if (decisao.acao === "ocupado") return vazio({ estado: "ocupado", motivo: MOTIVO_OCUPADO, pane_id: decisao.pane.id });
  if (decisao.acao === "escrever") {
    try {
      const r = await d.escrever(decisao.pane.id, linha);
      return vazio({ estado: "entregue", pane_id: decisao.pane.id, sessao_id: r.sessao_id ?? decisao.pane.sessao_pty_id, entrega: "escrita" });
    } catch (e) {
      const motivo = (e as { motivo?: unknown }).motivo;
      if (typeof motivo === "string" && ["trabalhando", "aguardando", "iniciando", "bloqueado", "entrada_pendente"].includes(motivo)) return vazio({ estado: "ocupado", motivo: MOTIVO_OCUPADO, pane_id: decisao.pane.id });
      return vazio({ motivo: "O painel não aceitou a instrução agora. Tente de novo ou abra um painel novo." });
    }
  }
  const cli = decisao.cli ?? (await d.cliPadrao());
  if (cli === null || !d.cliDeIa(cli)) return vazio({ motivo: MOTIVO_SEM_CLI });
  try {
    const aberto = await d.abrir(cli, linha);
    const saiu = await d.saiuNaLargada(aberto.pane_id);
    if (saiu !== null) {
      return vazio({ pane_id: aberto.pane_id, sessao_id: aberto.sessao_id, motivo: `A CLI ${d.nomeDaCli(cli)} saiu antes de receber a instrução${saiu === "" ? "" : ` (${saiu})`}. Confirme que ela está instalada e autenticada: abra um terminal neste workspace, rode a CLI uma vez e tente de novo.` });
    }
    return vazio({ estado: "entregue", pane_id: aberto.pane_id, sessao_id: aberto.sessao_id, entrega: "prompt_inicial" });
  } catch (e) {
    return vazio({ motivo: e instanceof Error && e.name === "CliIndisponivelErro" ? e.message : "Não foi possível abrir um painel novo para o agente." });
  }
}
