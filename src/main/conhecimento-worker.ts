// Thread do conhecimento (Fase 15, T-15.12): abre o `conhecimento.db` e hospeda o `ServicoConhecimento` por workspace. Só ela abre
// esse arquivo; o main fala com ela por RPC (`nucleo/conhecimento/worker/rpc.ts`) e nunca bloqueia (consulta 150 ms, teto 170 ms).
// Compilado para CommonJS e carregado com `new Worker(caminho)`; no pacote fica FORA do asar (worker_threads não lê de dentro dele).
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { criarAnfitriaoConhecimento, type Anfitriao } from "../nucleo/conhecimento/worker/anfitriao";
import { atenderRpc, criarClienteRpc, type PortaMensagens } from "../nucleo/conhecimento/worker/rpc";

export interface DadosDoWorkerConhecimento {
  /** marca que a thread é do conhecimento (evita assumir `parentPort` num worker de teste). */
  paraConhecimento: true;
  caminhoBanco: string;
  home: string | null;
  codexHome?: string | null;
}

/** Monta o anfitrião desta thread falando com o main por `porta`. Exportado para teste em processo (com `semFts` opcional). */
export function montarWorkerConhecimento(porta: PortaMensagens, dados: DadosDoWorkerConhecimento, extra: { semFts?: boolean } = {}): { anfitriao: Anfitriao; parar(): void } {
  const chamador = criarClienteRpc(porta, "worker", 60_000);
  const anfitriao = criarAnfitriaoConhecimento({
    caminhoBanco: dados.caminhoBanco,
    home: dados.home,
    ...(dados.codexHome === undefined ? {} : { codexHome: dados.codexHome }),
    chamarMain: (metodo, args, sinal) => chamador.chamar(metodo, args, { timeoutMs: 15_000, ...(sinal === undefined ? {} : { sinal }) }),
    ...(extra.semFts === undefined ? {} : { semFts: extra.semFts }),
  });
  const desligar = atenderRpc(porta, "worker", anfitriao.metodos);
  return {
    anfitriao,
    parar() {
      desligar();
      anfitriao.fechar();
    },
  };
}

if (!isMainThread && parentPort !== null && (workerData as Partial<DadosDoWorkerConhecimento> | null)?.paraConhecimento === true) {
  const { parar } = montarWorkerConhecimento(parentPort as unknown as PortaMensagens, workerData as DadosDoWorkerConhecimento);
  parentPort.on("close", parar);
}
