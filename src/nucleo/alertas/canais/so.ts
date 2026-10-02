// Canal "notificação nativa do SO" (T-20.17): só metadados, só sem foco (configurável), `silent` por severidade, respeita a preferência.
// Não precisa de consentimento (nada sai da máquina). A `Notification` do Electron é INJETADA: o núcleo não importa Electron.
import type { CanalComunicacao, CapacidadesCanal, MensagemSaida, ResultadoEnvio } from "../canal";
import { redigirParaCanal, truncarVisivel } from "../texto";

export interface NotificacaoSo {
  titulo: string;
  corpo: string;
  silenciosa: boolean;
  alerta_ids: string[];
}
export interface DepsCanalSo {
  mostrar(n: NotificacaoSo): void;
  /** a janela do app está em foco? */
  emFoco(): boolean;
  /** preferência `notificacoes` do usuário. */
  preferenciaLigada(): boolean;
  /** padrão `true`: com a janela em foco só o alerta aparece no app. */
  apenasSemFoco?(): boolean;
}

export const CAPACIDADES_SO: CapacidadesCanal = { entrada: false, botoes: false, formato: "texto", limite_visivel: 200, edita_mensagem: false, precisa_consentimento: false, min_intervalo_ms: 0, max_por_min: 60 };

export function criarCanalSo(deps: DepsCanalSo): CanalComunicacao {
  return {
    tipo: "so",
    capacidades: CAPACIDADES_SO,
    estado: () => "ativo",
    async enviar(msg: MensagemSaida): Promise<ResultadoEnvio> {
      if (!deps.preferenciaLigada()) return { ok: true };
      if (deps.emFoco() && (deps.apenasSemFoco?.() ?? true)) return { ok: true };
      deps.mostrar({
        titulo: truncarVisivel(redigirParaCanal(msg.titulo), 80),
        corpo: truncarVisivel(redigirParaCanal(msg.texto), CAPACIDADES_SO.limite_visivel),
        silenciosa: msg.silenciosa,
        alerta_ids: msg.alerta_ids,
      });
      return { ok: true };
    },
    async testar() {
      deps.mostrar({ titulo: "Teste de notificação", corpo: "Se você viu isto, as notificações do sistema funcionam.", silenciosa: true, alerta_ids: [] });
      return { ok: true, detalhe: "notificação de teste enviada" };
    },
  };
}
