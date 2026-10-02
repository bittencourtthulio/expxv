// Ingestão incremental (T-10.07). Watchers por fonte (debounce 300 ms, só com a janela em FOCO; sem foco o backlog é drenado na volta), UM worker de leitura
// (lê do `offset` salvo e devolve lotes ≤ 500), no máximo 1 lote em voo (o worker só continua depois do `continuar`), gravação por lote numa transação curta
// (`servico.ingerir` = registros + agregados + atribuição na MESMA transação) e retomada pelo offset. Idempotente por `(fonte_id, chave)`: reler não duplica.
// Sem Electron e sem rede: worker, vigia de arquivo, relógio e agenda entram por injeção. Nunca lança para fora; falha vira `erro_codigo` nominal da fonte.
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { Fontes } from "./fontes";
import type { RespostaWorker, PedidoWorker, CliLida } from "./worker";
import type { FonteUso } from "./repos";
import type { ServicoCusto } from "./servico";

export interface ProcessoLeitor {
  postMessage(m: PedidoWorker): void;
  on(ev: "message", f: (m: RespostaWorker) => void): unknown;
  on(ev: "error", f: (e: Error) => void): unknown;
  on(ev: "exit", f: (code: number) => void): unknown;
  off(ev: "message", f: (m: RespostaWorker) => void): unknown;
  off(ev: "error", f: (e: Error) => void): unknown;
  off(ev: "exit", f: (code: number) => void): unknown;
  terminate(): Promise<number> | void;
}
export interface DepsIngestao {
  servico: Pick<ServicoCusto, "ingerir" | "repo">;
  fontes: Pick<Fontes, "resolver" | "sessaoDe">;
  criarWorker(): ProcessoLeitor;
  /** `ler_transcripts` (P-81): desligado, nada é lido e o que já existe fica. */
  lerTranscripts(): boolean;
  emFoco(): boolean;
  agora?(): number;
  agendar?(fn: () => void, ms: number): () => void;
  vigiar?(caminho: string, aoMudar: () => void): () => void;
  avisar?(m: string): void;
  debounceMs?: number;
  minIntervaloMs?: number;
  ociosoMs?: number;
  /** o `opencode.db` não emite evento de arquivo confiável (WAL): fontes do OpenCode são sondadas neste intervalo (só com a janela em foco). */
  sondagemOpenCodeMs?: number;
}
export interface EstatisticasIngestao {
  lotes: number;
  registros: number;
  maiorLoteMs: number;
  leituras: number;
}

const agendarReal = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return () => clearTimeout(t);
};
const vigiarReal = (caminho: string, aoMudar: () => void): (() => void) => {
  try {
    const w = watch(caminho, { persistent: false }, () => aoMudar());
    w.on("error", () => undefined);
    return () => w.close();
  } catch {
    return () => undefined;
  }
};
const cliLida = (cli: string): CliLida | null => (cli === "claude" ? "claude" : cli === "codex" ? "codex" : cli === "opencode" ? "opencode" : null);

interface EstadoFonte {
  cancelarAgenda: (() => void) | null;
  cancelarSondagem: (() => void) | null;
  fechar: (() => void) | null;
  ultimaLeituraMs: number;
  estadoLeitor: unknown;
  emLeitura: Promise<void> | null;
  novaLeituraPedida: boolean;
}

export function criarIngestao(d: DepsIngestao) {
  const agora = d.agora ?? ((): number => Date.now());
  const agendar = d.agendar ?? agendarReal;
  const vigiar = d.vigiar ?? vigiarReal;
  const debounce = d.debounceMs ?? 300;
  const minIntervalo = d.minIntervaloMs ?? 2000;
  const ocioso = d.ociosoMs ?? 30_000;
  const sondagem = d.sondagemOpenCodeMs ?? 5000;
  const fontes = new Map<string, EstadoFonte>();
  const semFoco = new Set<string>();
  const stats: EstatisticasIngestao = { lotes: 0, registros: 0, maiorLoteMs: 0, leituras: 0 };
  let processo: ProcessoLeitor | null = null;
  let req = 0;
  let cancelarOcioso: (() => void) | null = null;
  /** fila FIFO: um worker, uma fonte por vez (1 lote em voo). */
  let cauda: Promise<void> = Promise.resolve();
  let parado = false;

  function obterProcesso(): ProcessoLeitor {
    cancelarOcioso?.();
    cancelarOcioso = null;
    if (processo === null) {
      const p = d.criarWorker();
      processo = p;
      p.on("exit", () => {
        if (processo === p) processo = null;
      });
      p.on("error", () => {
        if (processo === p) processo = null;
      });
    }
    return processo;
  }
  function agendarOcioso(): void {
    cancelarOcioso?.();
    cancelarOcioso = agendar(() => {
      const p = processo;
      processo = null;
      void p?.terminate();
    }, ocioso);
  }

  const marcar = (id: string, patch: Parameters<ServicoCusto["repo"]["fontes"]["atualizar"]>[1]): void => {
    try {
      d.servico.repo.fontes.atualizar(id, patch);
    } catch {
      /* fonte apagada no meio da leitura */
    }
  };

  /** Lê UMA fonte até o fim (lote a lote). Resolve sempre; nunca rejeita. */
  async function lerFonte(id: string): Promise<void> {
    const est = fontes.get(id);
    const fonte = d.servico.repo.fontes.obter(id);
    if (est === undefined || fonte === undefined || !d.lerTranscripts()) return;
    const cli = cliLida(fonte.cli);
    const caminho = d.fontes.resolver(fonte);
    const sessao = cli === "opencode" ? d.fontes.sessaoDe(fonte) : null;
    if (cli === null || caminho === null || (cli === "opencode" && sessao === null)) return;
    stats.leituras++;
    est.ultimaLeituraMs = agora();
    let offset = fonte.offset;
    try {
      const st = await stat(caminho);
      if (fonte.inode !== null && fonte.inode !== String(st.ino)) {
        offset = 0;
        est.estadoLeitor = undefined;
      }
    } catch {
      marcar(id, { estado: "erro", erro_codigo: "arquivo_ausente" });
      return;
    }
    await new Promise<void>((resolver) => {
      let p: ProcessoLeitor;
      try {
        p = obterProcesso();
      } catch {
        marcar(id, { estado: "erro", erro_codigo: "worker_indisponivel" });
        resolver();
        return;
      }
      const meuReq = ++req;
      let pulCumul = fonte.linhas_puladas;
      let fim = false;
      const terminar = (): void => {
        if (fim) return;
        fim = true;
        p.off("message", aoMsg);
        p.off("exit", aoSair);
        p.off("error", aoErro);
        agendarOcioso();
        resolver();
      };
      const aoMsg = (m: RespostaWorker): void => {
        if (m.req !== meuReq || fim || m.tipo === "sessao") return;
        if (m.tipo === "erro") {
          marcar(id, { estado: "erro", erro_codigo: m.codigo });
          terminar();
          return;
        }
        const t0 = performance.now();
        try {
          const lote = m.lote;
          d.servico.ingerir(id, lote.registros);
          pulCumul += lote.puladas;
          est.estadoLeitor = lote.estado;
          marcar(id, { offset: lote.offset, tamanho: lote.tamanho, mtime_ms: lote.mtime_ms, inode: lote.inode, linhas_puladas: pulCumul, estado: "lendo", erro_codigo: null });
          stats.lotes++;
          stats.registros += lote.registros.length;
        } catch {
          marcar(id, { estado: "erro", erro_codigo: "gravacao_falhou" });
          p.postMessage({ tipo: "cancelar", req: meuReq });
          stats.maiorLoteMs = Math.max(stats.maiorLoteMs, performance.now() - t0);
          terminar();
          return;
        }
        stats.maiorLoteMs = Math.max(stats.maiorLoteMs, performance.now() - t0);
        if (m.lote.ultimo) terminar();
        else p.postMessage({ tipo: "continuar", req: meuReq });
      };
      const aoSair = (): void => {
        if (fim) return;
        marcar(id, { erro_codigo: "worker_caiu" });
        terminar();
      };
      const aoErro = aoSair;
      p.on("message", aoMsg);
      p.on("exit", aoSair);
      p.on("error", aoErro);
      p.postMessage({ tipo: "ler", req: meuReq, cli, caminho, offset, ...(sessao === null ? {} : { sessao }), ...(est.estadoLeitor === undefined ? {} : { estado: est.estadoLeitor }) });
    });
  }

  /** Enfileira a leitura (serializa entre fontes); leituras repetidas da mesma fonte se juntam. */
  function enfileirar(id: string): Promise<void> {
    const est = fontes.get(id);
    if (est === undefined || parado) return Promise.resolve();
    if (est.emLeitura !== null) {
      est.novaLeituraPedida = true;
      return est.emLeitura;
    }
    const p = cauda.then(async () => {
      do {
        est.novaLeituraPedida = false;
        await lerFonte(id);
      } while (est.novaLeituraPedida && !parado);
    });
    cauda = p.catch(() => undefined);
    est.emLeitura = p.finally(() => {
      est.emLeitura = null;
    });
    return est.emLeitura;
  }

  function tocar(id: string): void {
    const est = fontes.get(id);
    if (est === undefined || parado || !d.lerTranscripts()) return;
    if (!d.emFoco()) {
      semFoco.add(id);
      return;
    }
    if (est.cancelarAgenda !== null) return; // já agendada: junta
    const espera = Math.max(debounce, est.ultimaLeituraMs + minIntervalo - agora());
    est.cancelarAgenda = agendar(() => {
      est.cancelarAgenda = null;
      if (!d.emFoco()) {
        semFoco.add(id);
        return;
      }
      void enfileirar(id);
    }, espera);
  }

  return {
    stats,
    /** começa a vigiar a fonte e já agenda a leitura do backlog. */
    observar(fonteId: string): void {
      if (parado || fontes.has(fonteId)) return;
      const f = d.servico.repo.fontes.obter(fonteId);
      if (f === undefined) return;
      const caminho = d.fontes.resolver(f);
      const est: EstadoFonte = { cancelarAgenda: null, cancelarSondagem: null, fechar: null, ultimaLeituraMs: Number.NEGATIVE_INFINITY, estadoLeitor: undefined, emLeitura: null, novaLeituraPedida: false };
      fontes.set(fonteId, est);
      if (f.base === "opencode_data") {
        // sondagem periódica (só toca com a janela em foco, como qualquer fonte); o 1º toque já drena o backlog
        const ciclo = (): void => {
          est.cancelarSondagem = agendar(() => {
            if (parado || !fontes.has(fonteId)) return;
            tocar(fonteId);
            ciclo();
          }, sondagem);
        };
        ciclo();
      } else if (caminho !== null) est.fechar = vigiar(caminho, () => tocar(fonteId));
      tocar(fonteId);
    },
    /** Acha a sessão do OpenCode no `opencode.db` DENTRO do worker (o main nunca abre o banco). `null` = sem banco/sessão (ou worker indisponível). */
    localizarSessaoOpenCode(caminho: string, p: { conversa: string | null; cwd: string | null; desdeMs: number }): Promise<string | null> {
      if (parado) return Promise.resolve(null);
      const executar = (): Promise<string | null> =>
        new Promise<string | null>((resolver) => {
          let proc: ProcessoLeitor;
          try {
            proc = obterProcesso();
          } catch {
            resolver(null);
            return;
          }
          const meuReq = ++req;
          let fim = false;
          const terminar = (v: string | null): void => {
            if (fim) return;
            fim = true;
            proc.off("message", aoMsg);
            proc.off("exit", aoFim);
            proc.off("error", aoFim);
            agendarOcioso();
            resolver(v);
          };
          const aoMsg = (m: RespostaWorker): void => {
            if (m.req !== meuReq) return;
            terminar(m.tipo === "sessao" ? m.sessao : null);
          };
          const aoFim = (): void => terminar(null);
          proc.on("message", aoMsg);
          proc.on("exit", aoFim);
          proc.on("error", aoFim);
          proc.postMessage({ tipo: "localizar", req: meuReq, cli: "opencode", caminho, ...p });
        });
      const r = cauda.then(executar);
      cauda = r.then(() => undefined, () => undefined);
      return r;
    },
    tocar,
    /** a janela voltou ao foco: drena o backlog das fontes tocadas sem foco (respeita ≤ 1 releitura / 2 s por fonte). */
    aoFocar(): void {
      for (const id of [...semFoco]) {
        semFoco.delete(id);
        tocar(id);
      }
    },
    /** lê já (ignora debounce e intervalo): usado ao encerrar o Pane e em teste/reindexar. */
    drenar: (fonteId: string): Promise<void> => enfileirar(fonteId),
    /** Pane encerrado: drena e marca `encerrada`. */
    async encerrarFonte(fonteId: string): Promise<void> {
      await enfileirar(fonteId);
      const est = fontes.get(fonteId);
      est?.cancelarAgenda?.();
      est?.cancelarSondagem?.();
      est?.fechar?.();
      fontes.delete(fonteId);
      semFoco.delete(fonteId);
      marcar(fonteId, { estado: "encerrada" });
    },
    /** esquece o estado em memória (reindexar zera offsets no banco). */
    reiniciarEstado(fonteId?: string): void {
      if (fonteId === undefined) for (const e of fontes.values()) e.estadoLeitor = undefined;
      else {
        const e = fontes.get(fonteId);
        if (e) e.estadoLeitor = undefined;
      }
    },
    observadas: (): string[] => [...fontes.keys()],
    async parar(): Promise<void> {
      parado = true;
      for (const e of fontes.values()) {
        e.cancelarAgenda?.();
        e.cancelarSondagem?.();
        e.fechar?.();
      }
      fontes.clear();
      semFoco.clear();
      cancelarOcioso?.();
      const p = processo;
      processo = null;
      await p?.terminate();
    },
  };
}
export type Ingestao = ReturnType<typeof criarIngestao>;
export type { FonteUso };
