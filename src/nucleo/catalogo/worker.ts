// Worker da varredura do catálogo (T-07.11): roda em `worker_threads` para nunca bloquear o main (P-12). Compilado para CommonJS
// (`dist/nucleo/catalogo/worker.js`, FORA do asar). Mantém o cache `mtime+size` entre varreduras. Protocolo: o main envia `varrer`/`cancelar`;
// o worker responde com `progresso`, `lote` (≤ 100 itens por mensagem) e `fim`. Nada é gravado em disco por aqui (só leitura).
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { join } from "node:path";
import type { CliCatalogo, TipoCatalogo } from "../../compartilhado/catalogo";
import { criarContexto } from "./raizes";
import type { CacheVarredura, ErroScanner } from "./tipos";
import { executarVarredura, type ItemAgregado, type ProgressoScanner } from "./varredura";

export const TAMANHO_LOTE = 100;

export interface PedidoVarreduraWorker {
  id: number;
  tipo: "varrer";
  home: string;
  workspaces: Array<{ id: string; raiz: string }>;
  tipos: TipoCatalogo[] | null;
  clis: CliCatalogo[] | null;
  /** nome normalizado → hashes sha256 do SKILL.md embarcado */
  embarcadas: Array<[string, string[]]>;
}
export type MensagemParaWorker = PedidoVarreduraWorker | { id: number; tipo: "cancelar" };
export type MensagemDoWorker =
  | { id: number; tipo: "progresso"; progresso: ProgressoScanner }
  | { id: number; tipo: "lote"; itens: ItemAgregado[] }
  | { id: number; tipo: "fim"; erros: ErroScanner[]; duracao_ms: number; cancelada: boolean; cobertura: { clis: CliCatalogo[]; tipos: TipoCatalogo[]; workspace_ids: string[] }; total: number }
  | { id: number; tipo: "falha"; erro: string };

/** Função pura do worker (testável sem thread): executa a varredura e emite as mensagens por `enviar`. Nunca lança. */
export async function tratarPedido(p: PedidoVarreduraWorker, cache: CacheVarredura, abort: AbortSignal, enviar: (m: MensagemDoWorker) => void): Promise<void> {
  try {
    const contexto = criarContexto({
      home: p.home,
      workspaces: p.workspaces,
      abort,
      cache,
      embarcadas: new Map(p.embarcadas.map(([n, h]) => [n, new Set(h)])),
    });
    const r = await executarVarredura({ contexto, tipos: p.tipos, clis: p.clis, onProgresso: (progresso) => enviar({ id: p.id, tipo: "progresso", progresso }) });
    for (let i = 0; i < r.itens.length; i += TAMANHO_LOTE) enviar({ id: p.id, tipo: "lote", itens: r.itens.slice(i, i + TAMANHO_LOTE) });
    enviar({ id: p.id, tipo: "fim", erros: r.erros, duracao_ms: r.duracao_ms, cancelada: r.cancelada, cobertura: r.cobertura, total: r.itens.length });
  } catch (e) {
    enviar({ id: p.id, tipo: "falha", erro: e instanceof Error ? e.name : "erro" });
  }
}

// ---- lado worker
if (!isMainThread && parentPort) {
  const porta = parentPort;
  const cache: CacheVarredura = new Map();
  const abortos = new Map<number, AbortController>();
  porta.on("message", (m: MensagemParaWorker) => {
    if (m.tipo === "cancelar") {
      abortos.get(m.id)?.abort();
      return;
    }
    if (m.tipo === "varrer") {
      const ac = new AbortController();
      abortos.set(m.id, ac);
      void tratarPedido(m, cache, ac.signal, (x) => porta.postMessage(x)).finally(() => abortos.delete(m.id));
    }
  });
}

// ---- lado main
export interface ResultadoWorker {
  itens: ItemAgregado[];
  erros: ErroScanner[];
  duracao_ms: number;
  cancelada: boolean;
  cobertura: { clis: CliCatalogo[]; tipos: TipoCatalogo[]; workspace_ids: string[] };
}
export interface ClienteVarredura {
  /** `onLote` recebe cada lote assim que chega (o main faz o upsert em fatias). */
  varrer(p: Omit<PedidoVarreduraWorker, "id" | "tipo">, ganchos: { onProgresso?: (p: ProgressoScanner) => void; onLote?: (itens: ItemAgregado[]) => void | Promise<void> }): { id: number; resultado: Promise<ResultadoWorker> };
  cancelar(id: number): void;
  encerrar(): Promise<void>;
}

export function criarClienteVarredura(caminho: string = join(__dirname, "worker.js")): ClienteVarredura {
  const worker = new Worker(caminho);
  worker.unref();
  let proximo = 1;
  let encerrado = false;
  interface Pendente { itens: ItemAgregado[]; ok: (r: ResultadoWorker) => void; erro: (e: Error) => void; g: { onProgresso?: (p: ProgressoScanner) => void; onLote?: (i: ItemAgregado[]) => void | Promise<void> }; fila: Promise<void> }
  const pendentes = new Map<number, Pendente>();
  const falhar = (e: Error): void => {
    for (const p of pendentes.values()) p.erro(e);
    pendentes.clear();
  };
  worker.on("message", (m: MensagemDoWorker) => {
    const p = pendentes.get(m.id);
    if (p === undefined) return;
    if (m.tipo === "progresso") p.g.onProgresso?.(m.progresso);
    else if (m.tipo === "lote") {
      p.itens.push(...m.itens);
      if (p.g.onLote !== undefined) {
        const cb = p.g.onLote;
        p.fila = p.fila.then(() => cb(m.itens)).catch(() => undefined);
      }
    } else if (m.tipo === "fim") {
      pendentes.delete(m.id);
      void p.fila.then(() => p.ok({ itens: p.itens, erros: m.erros, duracao_ms: m.duracao_ms, cancelada: m.cancelada, cobertura: m.cobertura }));
    } else {
      pendentes.delete(m.id);
      p.erro(new Error(`varredura falhou: ${m.erro}`));
    }
  });
  worker.on("error", (e) => falhar(e instanceof Error ? e : new Error(String(e))));
  worker.on("exit", () => {
    encerrado = true;
    falhar(new Error("worker do catálogo encerrado"));
  });
  return {
    varrer(p, g) {
      const id = proximo++;
      const resultado = new Promise<ResultadoWorker>((ok, erro) => {
        if (encerrado) {
          erro(new Error("worker do catálogo encerrado"));
          return;
        }
        pendentes.set(id, { itens: [], ok, erro, g, fila: Promise.resolve() });
        worker.postMessage({ ...p, id, tipo: "varrer" } satisfies PedidoVarreduraWorker);
      });
      return { id, resultado };
    },
    cancelar(id) {
      if (!encerrado) worker.postMessage({ id, tipo: "cancelar" } satisfies MensagemParaWorker);
    },
    async encerrar() {
      if (encerrado) return;
      encerrado = true;
      await worker.terminate();
    },
  };
}
