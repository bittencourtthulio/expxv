// Notificação nativa da troca por consumo (T-09.20): só o texto curto do recibo (já sem segredo), com a janela SEM foco (o filtro está
// na cola, `harness-troca.ts`). Nada de Electron aqui: `Notification` entra injetado. Falha ao notificar nunca se propaga.
import type { AvisoTroca } from "../nucleo/harness/troca";
import { PRODUTO } from "../nucleo/produto";
import type { DadosNotificacao } from "./notificar";

const TITULO: Readonly<Record<AvisoTroca["tipo"], string>> = {
  sugerida: "Trocar de conta?",
  feita: "Conta trocada",
  falhou: "A troca de conta falhou",
  adiada: "Troca de conta adiada",
  sem_alternativa: "Sem conta com folga",
};

export interface OpcoesNotificadorDeTroca {
  suportado: () => boolean;
  criar: (dados: DadosNotificacao, aoClicar: () => void) => { show(): void };
  /** preferência `notificacoes` e "Pausar notificações". */
  ativo?: () => boolean;
  /** traz a janela ao primeiro plano (clique na notificação). */
  abrirJanela: () => void;
}

export function criarNotificadorDeTroca(op: OpcoesNotificadorDeTroca): (aviso: AvisoTroca) => boolean {
  return (aviso) => {
    try {
      if (op.ativo?.() === false || !op.suportado()) return false;
      const corpo = [...aviso.texto].slice(0, 240).join("");
      op.criar({ title: `${PRODUTO.nome}: ${TITULO[aviso.tipo]}`, body: corpo, silent: aviso.tipo === "feita" }, op.abrirJanela).show();
      return true;
    } catch {
      return false;
    }
  };
}
