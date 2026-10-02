// Escalonador de Run (T-12.11): fila, `max_paralelo` (padrão 3, teto 5), cancelar, teto de custo e teto de execuções sem custo. Genérico: não sabe de banco nem de processo (o serviço injeta `executar`).
// Regras: nunca mais que `max_paralelo` em execução; `teto_usd` para de LANÇAR pares novos quando o custo CONHECIDO estoura; com custo desconhecido vale o teto de 20 execuções por Run;
// conta sem limite (porta da Fase 9) deixa o par na fila com aviso e SEM trocar de conta; cancelar durante a fila não lança nada novo.
import { MAX_EXECUCOES_SEM_CUSTO, MAX_PARALELO } from "../tipos";

export type MotivoPulo = "sem_limite" | "teto_usd" | "limite_execucoes" | "cancelado";
export interface ParEscalonavel { id: string; conta_id: string | null }
export type EstadoConta = "ok" | "sem_limite" | "desconhecido";

export interface OpcoesEscalonar {
  maxParalelo: number;
  tetoUsd: number | null;
  sinal: AbortSignal;
  /** soma do custo CONHECIDO até agora, e se algum custo ficou desconhecido. */
  custo: () => { conhecido_usd: number; algum_desconhecido: boolean };
  /** porta da Fase 9; ausente = `desconhecido` (segue). */
  estadoConta?: (contaId: string) => EstadoConta;
  executar: (par: ParEscalonavel) => Promise<void>;
  aoPular: (par: ParEscalonavel, motivo: MotivoPulo) => void;
}
export interface ResultadoEscalonar { lancados: number; pulados: Array<{ id: string; motivo: MotivoPulo }>; maxSimultaneo: number }

export const limitarParalelo = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.min(MAX_PARALELO, Math.trunc(n))) : 3);

export async function escalonar(pares: readonly ParEscalonavel[], op: OpcoesEscalonar): Promise<ResultadoEscalonar> {
  const limite = limitarParalelo(op.maxParalelo);
  const fila = [...pares];
  const pulados: ResultadoEscalonar["pulados"] = [];
  let emAndamento = 0;
  let lancados = 0;
  let maxSimultaneo = 0;
  let travaGlobal: MotivoPulo | null = null;

  return new Promise<ResultadoEscalonar>((resolve) => {
    const pular = (par: ParEscalonavel, motivo: MotivoPulo): void => { pulados.push({ id: par.id, motivo }); op.aoPular(par, motivo); };
    const avancar = (): void => {
      while (emAndamento < limite && fila.length > 0) {
        if (op.sinal.aborted) travaGlobal = "cancelado";
        if (travaGlobal === null && op.tetoUsd !== null && op.custo().conhecido_usd >= op.tetoUsd) travaGlobal = "teto_usd";
        if (travaGlobal === null && lancados >= MAX_EXECUCOES_SEM_CUSTO && op.custo().algum_desconhecido) travaGlobal = "limite_execucoes";
        if (travaGlobal !== null) { while (fila.length > 0) pular(fila.shift() as ParEscalonavel, travaGlobal); break; }
        const par = fila.shift() as ParEscalonavel;
        if (par.conta_id !== null && op.estadoConta?.(par.conta_id) === "sem_limite") { pular(par, "sem_limite"); continue; }
        emAndamento++;
        lancados++;
        maxSimultaneo = Math.max(maxSimultaneo, emAndamento);
        void op.executar(par).catch(() => undefined).finally(() => { emAndamento--; avancar(); });
      }
      if (emAndamento === 0 && fila.length === 0) resolve({ lancados, pulados, maxSimultaneo });
    };
    avancar();
  });
}
