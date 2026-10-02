import { isMainThread, parentPort } from "node:worker_threads";
import type { ConfigMapa, FaseProgressoMapa } from "../../compartilhado/mapa";
import { abrirArmazem } from "./armazem";
import type { CamadaManual } from "./analises/camadas";
import { executarFaseDerivada, type ContextoDerivado, type ResultadoDerivada } from "./derivada";
import { calcularSaidasDoContexto } from "./saidas-derivadas";

// Worker da fase DERIVADA (T-17.21): roda resolução de imports/chamadas, análises e história git numa thread própria, para o main
// nunca bloquear (> 50 ms). Abre o MESMO `mapa.db` por uma conexão própria (WAL permite leitor concorrente; o serviço só escreve
// de novo depois que esta fase termina). Este arquivo é compilado para CommonJS (`dist/nucleo/mapa/worker-derivada.js`), fora do asar.

export interface MensagemIniciarDerivada {
  tipo: "iniciar";
  caminho_db: string;
  raiz: string;
  config: ConfigMapa;
  historia: boolean;
  camadas_manual?: CamadaManual[];
  /** Raiz do repositório (para o pacote de contexto): reservado. */
  gerar_saidas?: boolean;
}

export type MensagemDoWorkerDerivada =
  | { tipo: "progresso"; fase: FaseProgressoMapa; feito: number; total: number }
  | { tipo: "fim"; resultado: ResultadoDerivada }
  | { tipo: "erro"; erro: string };

if (!isMainThread && parentPort) {
  const porta = parentPort;
  const controle = new AbortController();
  porta.on("message", (msg: MensagemIniciarDerivada | { tipo: "cancelar" }) => {
    if (msg.tipo === "cancelar") {
      controle.abort();
      return;
    }
    if (msg.tipo !== "iniciar") return;
    void (async () => {
      const armazem = abrirArmazem({ caminho: msg.caminho_db, autocheckpointPaginas: 1000 });
      try {
        let ultimo = 0;
        const resultado = await executarFaseDerivada(armazem, {
          raiz: msg.raiz,
          config: msg.config,
          historia: msg.historia,
          ...(msg.camadas_manual !== undefined ? { camadasManual: msg.camadas_manual } : {}),
          signal: controle.signal,
          progresso: (fase, feito, total) => {
            const agora = Date.now();
            if (agora - ultimo < 120 && feito < total) return; // coalescido
            ultimo = agora;
            porta.postMessage({ tipo: "progresso", fase, feito, total } satisfies MensagemDoWorkerDerivada);
          },
          ...(msg.gerar_saidas === false ? {} : { aoConcluir: (ctx: ContextoDerivado) => calcularSaidasDoContexto(armazem, ctx) }),
        });
        porta.postMessage({ tipo: "fim", resultado } satisfies MensagemDoWorkerDerivada);
      } catch (e) {
        porta.postMessage({ tipo: "erro", erro: e instanceof Error ? e.message : String(e) } satisfies MensagemDoWorkerDerivada);
      } finally {
        armazem.fechar();
      }
    })();
  });
}
