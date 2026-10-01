// Notificação nativa da sinaleira: avisa quando o agente termina ou pede aprovação e a pessoa não
// está olhando a janela. Só metadados: nunca o conteúdo da sessão (saída, prompt, caminhos).
// O `Notification` do Electron entra injetado — nada aqui importa `electron`, então testa sem ele.

import type { AtividadeTerminal } from "../compartilhado/terminais";
import { PRODUTO } from "../nucleo/produto";

export interface DadosNotificacao {
  title: string;
  body: string;
  silent: boolean;
}

/** `null` quando a atividade não merece aviso (trabalhando). */
export function montarNotificacaoAtividade(atividade: AtividadeTerminal, nomeFerramenta: string): DadosNotificacao | null {
  if (atividade === "trabalhando") return null;
  const body = atividade === "aguardando" ? `${nomeFerramenta} está aguardando sua aprovação.` : `${nomeFerramenta} terminou.`;
  return { title: PRODUTO.nome, body, silent: false };
}

export interface OpcoesNotificador {
  suportado: () => boolean;
  criar: (dados: DadosNotificacao) => { show(): void };
  /** a janela do app tem o foco agora? */
  janelaEmFoco: () => boolean;
  /** nome de exibição da ferramenta (vem do catálogo; id desconhecido vira o próprio id). */
  nomeDaFerramenta: (ferramentaId: string) => string;
  /** notificações ligadas? (preferência `notificacoes`; ausente = ligadas). */
  ativo?: () => boolean;
}

export type Notificador = (ferramentaId: string, atividade: AtividadeTerminal) => boolean;

/** Devolve `true` se mostrou a notificação. Falha ao notificar nunca se propaga: é acessório. */
export function criarNotificador(op: OpcoesNotificador): Notificador {
  return (ferramentaId, atividade) => {
    try {
      if (atividade === "trabalhando" || op.ativo?.() === false || op.janelaEmFoco() || !op.suportado()) return false;
      const dados = montarNotificacaoAtividade(atividade, op.nomeDaFerramenta(ferramentaId));
      if (dados === null) return false;
      op.criar(dados).show();
      return true;
    } catch {
      return false;
    }
  };
}
