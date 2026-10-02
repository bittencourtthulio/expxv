// Canal "toast" no app (sem rede, sem consentimento): o renderer mostra o aviso breve. `mostrar` é injetado pelo main (evento IPC).
import type { Severidade } from "../../../compartilhado/alertas";
import type { CanalComunicacao, CapacidadesCanal, MensagemSaida, ResultadoEnvio } from "../canal";
import { redigirParaCanal, truncarVisivel } from "../texto";

export interface ToastApp {
  titulo: string;
  texto: string;
  severidade: Severidade;
  alerta_ids: string[];
}
export const CAPACIDADES_TOAST: CapacidadesCanal = { entrada: false, botoes: false, formato: "texto", limite_visivel: 160, edita_mensagem: false, precisa_consentimento: false, min_intervalo_ms: 0, max_por_min: 120 };

export function criarCanalToast(deps: { mostrar(t: ToastApp): void }): CanalComunicacao {
  return {
    tipo: "toast",
    capacidades: CAPACIDADES_TOAST,
    estado: () => "ativo",
    async enviar(msg: MensagemSaida): Promise<ResultadoEnvio> {
      deps.mostrar({ titulo: truncarVisivel(redigirParaCanal(msg.titulo), 80), texto: truncarVisivel(redigirParaCanal(msg.texto), CAPACIDADES_TOAST.limite_visivel), severidade: msg.severidade, alerta_ids: msg.alerta_ids });
      return { ok: true };
    },
    async testar() {
      deps.mostrar({ titulo: "Teste", texto: "Aviso de teste no app.", severidade: "info", alerta_ids: [] });
      return { ok: true, detalhe: "toast de teste exibido" };
    },
  };
}
