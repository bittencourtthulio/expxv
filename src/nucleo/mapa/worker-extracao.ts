import { readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { ErroExtracao } from "./extratores/comum";
import { extrairArquivo } from "./extratores/registro";
import type { OpcoesRuntime } from "./gramaticas";
import { hashConteudo } from "./hash";
import { ehArquivoSensivel } from "./sensiveis";
import type { Extracao, Linguagem } from "./tipos";

// Worker de extração (T-17.05): roda numa thread própria para NUNCA bloquear o main nem a UI (P-12). Este arquivo
// é compilado para CommonJS (`dist/nucleo/mapa/worker-extracao.js`) e carregado com `new Worker(caminho)`; no
// pacote fica FORA do asar (worker_threads não lê de dentro dele; ver `asarUnpack`). Lê o arquivo, calcula o hash
// e roda o extrator da linguagem. Nunca executa o código analisado e nunca abre arquivo de ambiente ou chave.

export interface MensagemExtrair {
  id: number;
  tipo: "extrair";
  caminho_abs: string;
  /** Raiz ABSOLUTA do workspace: o worker confere (realpath) que o arquivo continua DENTRO dela na hora de ler (contra troca por symlink depois da varredura). */
  raiz?: string;
  /** Caminho relativo à raiz (para `e_teste`, rotas por arquivo…). Padrão: o nome do arquivo. */
  caminho?: string;
  linguagem: Linguagem;
  versao_extrator?: number;
  /** Teto de bytes lidos (padrão 5 000 000). */
  tamanho_max?: number;
}

export type RespostaExtracao =
  | { id: number; ok: true; extracao: Extracao; ms: number }
  | { id: number; ok: false; erro: string; codigo: "erro" | "nao_implementado" | "sem_gramatica" | "parse_falhou" | "arquivo_sensivel" | "arquivo_ilegivel" };

export interface DadosWorker {
  runtime?: OpcoesRuntime;
}

const TAMANHO_MAX_PADRAO = 5_000_000;

/** A função pura que o worker executa: testável sem thread. Nunca lança. */
export async function executarExtracao(msg: MensagemExtrair, dados: DadosWorker = {}, ler: (caminho: string) => Promise<Buffer> = (c) => readFile(c)): Promise<RespostaExtracao> {
  const id = typeof msg?.id === "number" ? msg.id : -1;
  try {
    if (msg.tipo !== "extrair") return { id, ok: false, erro: `tipo de tarefa desconhecida: ${String((msg as { tipo?: unknown }).tipo)}`, codigo: "erro" };
    if (typeof msg.caminho_abs !== "string" || msg.caminho_abs === "") return { id, ok: false, erro: "caminho ausente", codigo: "erro" };
    if (ehArquivoSensivel(msg.caminho_abs)) return { id, ok: false, erro: "arquivo sensível: não é aberto", codigo: "arquivo_sensivel" };
    const inicio = performance.now();
    if (typeof msg.raiz === "string" && msg.raiz !== "") {
      try {
        const [real, base] = await Promise.all([realpath(msg.caminho_abs), realpath(msg.raiz)]);
        if (real !== base && !real.startsWith(base.endsWith(sep) ? base : base + sep)) return { id, ok: false, erro: "arquivo fora da raiz do workspace: não é aberto", codigo: "arquivo_ilegivel" };
        if (ehArquivoSensivel(real)) return { id, ok: false, erro: "arquivo sensível: não é aberto", codigo: "arquivo_sensivel" };
      } catch (e) {
        return { id, ok: false, erro: e instanceof Error ? e.message : String(e), codigo: "arquivo_ilegivel" };
      }
    }
    let buf: Buffer;
    try {
      buf = await ler(msg.caminho_abs);
    } catch (e) {
      return { id, ok: false, erro: e instanceof Error ? e.message : String(e), codigo: "arquivo_ilegivel" };
    }
    if (buf.length > (msg.tamanho_max ?? TAMANHO_MAX_PADRAO)) return { id, ok: false, erro: "arquivo acima do limite", codigo: "arquivo_ilegivel" };
    const inicioTexto = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
    const texto = buf.toString("utf8", inicioTexto);
    const caminho = msg.caminho ?? msg.caminho_abs.slice(Math.max(msg.caminho_abs.lastIndexOf("/"), msg.caminho_abs.lastIndexOf("\\")) + 1);
    const extracao = await extrairArquivo(texto, msg.linguagem, caminho, { hash: hashConteudo(buf), ...(dados.runtime !== undefined ? { runtime: dados.runtime } : {}) });
    return { id, ok: true, extracao, ms: performance.now() - inicio };
  } catch (e) {
    if (e instanceof ErroExtracao) return { id, ok: false, erro: e.message, codigo: e.codigo === "nao_implementado" || e.codigo === "sem_gramatica" || e.codigo === "parse_falhou" ? e.codigo : "erro" };
    return { id, ok: false, erro: e instanceof Error ? e.message : String(e), codigo: "erro" };
  }
}

// ---- lado worker: só liga quando este arquivo roda como thread
if (!isMainThread && parentPort) {
  const porta = parentPort;
  const dados = (workerData ?? {}) as DadosWorker;
  // tarefas em série: o parser WASM é síncrono e o pool manda uma por vez
  let fila: Promise<void> = Promise.resolve();
  porta.on("message", (msg: MensagemExtrair) => {
    fila = fila.then(async () => {
      porta.postMessage(await executarExtracao(msg, dados));
    });
  });
}
