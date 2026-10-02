import { MessageChannel } from "node:worker_threads";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarAnfitriaoConhecimento } from "./anfitriao";
import { criarHostConhecimento, type ThreadDoWorker } from "./host";
import { atenderRpc, criarClienteRpc, RpcCanceladoErro, RpcIndisponivelErro, RpcRemotoErro, RpcTimeoutErro, type MetodoRpc } from "./rpc";

const limpezas: Array<() => void> = [];
afterEach(() => {
  limpezas.splice(0).forEach((f) => f());
  vi.useRealTimers();
});

function par(): { a: MessageChannel["port1"]; b: MessageChannel["port2"] } {
  const c = new MessageChannel();
  limpezas.push(() => (c.port1.close(), c.port2.close()));
  return { a: c.port1, b: c.port2 };
}

describe("RPC (id, timeout, cancelamento, erro curto)", () => {
  it("chama e responde nos dois sentidos sem confundir as respostas", async () => {
    const { a, b } = par();
    atenderRpc(b, "worker", { soma: ([x, y]) => (x as number) + (y as number) });
    atenderRpc(a, "main", { eco: ([x]) => `main:${String(x)}` });
    const cMain = criarClienteRpc(a, "main");
    const cWorker = criarClienteRpc(b, "worker");
    const [r1, r2] = await Promise.all([cMain.chamar<number>("soma", [2, 3]), cWorker.chamar<string>("eco", ["oi"])]);
    expect(r1).toBe(5);
    expect(r2).toBe("main:oi");
  });

  it("método desconhecido e erro de negócio viram RpcRemotoErro; caminho absoluto não atravessa a fronteira", async () => {
    const { a, b } = par();
    atenderRpc(b, "worker", {
      falha: () => {
        throw new Error("não abriu /Users/maria/segredo/arquivo.txt agora");
      },
    });
    const c = criarClienteRpc(a, "main");
    await expect(c.chamar("nao_existe")).rejects.toBeInstanceOf(RpcRemotoErro);
    const erro = await c.chamar("falha").catch((e: Error) => e);
    expect(erro).toBeInstanceOf(RpcRemotoErro);
    expect((erro as Error).message).not.toContain("/Users/maria");
    expect((erro as Error).message).toContain("<caminho>");
  });

  it("timeout e cancelamento abortam o sinal do lado que atende", async () => {
    const { a, b } = par();
    let abortou = 0;
    const lento: MetodoRpc = (_args, sinal) =>
      new Promise((r) => {
        sinal.addEventListener("abort", () => (abortou++, r(null)));
      });
    atenderRpc(b, "worker", { lento });
    const c = criarClienteRpc(a, "main");
    await expect(c.chamar("lento", [], { timeoutMs: 20 })).rejects.toBeInstanceOf(RpcTimeoutErro);
    const ctl = new AbortController();
    const p = c.chamar("lento", [], { sinal: ctl.signal, timeoutMs: 5000 });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(RpcCanceladoErro);
    await new Promise((r) => setTimeout(r, 30));
    expect(abortou).toBe(2);
    expect(c.pendentes()).toBe(0);
  });
});

function threadFalsa(): { thread: ThreadDoWorker; cair(): void; encerrada: () => boolean } {
  const { a, b } = par();
  atenderRpc(b, "worker", { ping: () => "pong" });
  let saiu: ((m: string) => void) | null = null;
  let enc = false;
  return {
    thread: { porta: a, aoSair: (f) => (saiu = f), encerrar: () => void (enc = true) },
    cair: () => saiu?.("saiu"),
    encerrada: () => enc,
  };
}

describe("host: sobe sob demanda, reinicia com backoff e desiste", () => {
  it("só cria a thread na primeira chamada e atende", async () => {
    const criadas: ReturnType<typeof threadFalsa>[] = [];
    const host = criarHostConhecimento({ criarThread: () => (criadas.push(threadFalsa()), criadas.at(-1)!.thread) });
    expect(host.estado()).toBe("parado");
    expect(criadas).toHaveLength(0);
    await expect(host.chamar("ping")).resolves.toBe("pong");
    expect(host.estado()).toBe("pronto");
    host.encerrar();
    expect(criadas[0]?.encerrada()).toBe(true);
  });

  it("queda rejeita o pendente, entra em reiniciando, recomeça no backoff e desiste depois de maxFalhas", async () => {
    vi.useFakeTimers();
    const criadas: ReturnType<typeof threadFalsa>[] = [];
    const host = criarHostConhecimento({
      criarThread: () => (criadas.push(threadFalsa()), criadas.at(-1)!.thread),
      backoffMs: [100, 200],
      maxFalhas: 3,
      agora: () => Date.now(),
    });
    await host.chamar("ping");
    criadas[0]?.cair();
    expect(host.estado()).toBe("reiniciando");
    await expect(host.chamar("ping")).rejects.toBeInstanceOf(RpcIndisponivelErro);
    vi.advanceTimersByTime(100);
    expect(host.estado()).toBe("pronto");
    criadas[1]?.cair();
    vi.advanceTimersByTime(200);
    criadas[2]?.cair();
    expect(host.estado()).toBe("indisponivel");
    await expect(host.chamar("ping")).rejects.toBeInstanceOf(RpcIndisponivelErro);
    host.reiniciar();
    expect(host.estado()).toBe("pronto");
    host.encerrar();
  });
});

describe("anfitrião: serviço por workspace dentro do worker", () => {
  function montar(): { dir: string; chamar: (m: string, ...args: unknown[]) => Promise<unknown>; fechar(): void } {
    const dir = mkdtempSync(join(tmpdir(), "anf-"));
    const raiz = join(dir, "proj");
    mkdirSync(join(raiz, "docs"), { recursive: true });
    const anf = criarAnfitriaoConhecimento({ caminhoBanco: join(dir, "conhecimento.db"), home: null });
    limpezas.push(() => (anf.fechar(), rmSync(dir, { recursive: true, force: true })));
    const sinal = new AbortController().signal;
    return { dir, chamar: async (m, ...args) => anf.metodos[m]!(args, sinal), fechar: () => anf.fechar() };
  }
  const ws = { workspace_id: "ws_01ABCDEFGHIJK", nome: "meu-projeto", ativo: true };

  it("indexa docs por reindexar, busca por termo raro e nunca devolve segredo", async () => {
    const h = montar();
    const raiz = join(h.dir, "proj");
    const segredo = ["sk", "ant", "api03", "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ9999"].join("-");
    writeFileSync(join(raiz, "docs", "decisao.md"), `# Decisão\n\nUsamos a rotina zanzibar para exportar. Chave ${segredo}.\n`);
    await h.chamar("abrir", { ...ws, raiz });
    await expect(h.chamar("reindexar", ws.workspace_id, "docs", { indexar_codigo: false, indexar_transcricoes: false, sessoes_do_app: [] })).resolves.toEqual({ enfileirado: true });
    for (let i = 0; i < 100; i++) {
      const p = (await h.chamar("progresso", ws.workspace_id)) as { fase: string | null };
      if (p.fase === null) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const b = (await h.chamar("buscar", ws.workspace_id, { consulta: "zanzibar", modo: "lexical" })) as { resultados: Array<{ trecho: string; fonte: { origem: string } }>; estado: string };
    expect(b.resultados.some((r) => r.fonte.origem === "docs/decisao.md")).toBe(true);
    expect(JSON.stringify(b)).not.toContain("ZZZZZZZZ");
    const est = (await h.chamar("estado", ws.workspace_id)) as { documentos: number; indexando: { pendentes: number } };
    expect(est.documentos).toBeGreaterThanOrEqual(1);
  });

  it("registrar só enfileira; o passo drena em fatia; ativo=false bloqueia tudo", async () => {
    const h = montar();
    await h.chamar("abrir", { ...ws, raiz: join(h.dir, "proj") });
    await h.chamar("registrar", ws.workspace_id, { tipo: "user.note", workspace_id: ws.workspace_id, id: "n1", titulo: "Nota", texto: "A palavra mandragora identifica o fluxo de cobrança.", ocorrido_em: "2026-09-01T10:00:00.000Z" });
    expect(((await h.chamar("estado", ws.workspace_id)) as { indexando: { pendentes: number } }).indexando.pendentes).toBe(1);
    const p = (await h.chamar("passo", ws.workspace_id, { ocioso: true })) as { trabalho: string; pendentes: number };
    expect(p.trabalho).toBe("fila");
    expect(p.pendentes).toBe(0);
    const b = (await h.chamar("buscar", ws.workspace_id, { consulta: "mandragora", modo: "lexical" })) as { resultados: unknown[] };
    expect(b.resultados).toHaveLength(1);
    await h.chamar("ativar", ws.workspace_id, false);
    const off = (await h.chamar("buscar", ws.workspace_id, { consulta: "mandragora", modo: "lexical" })) as { estado: string; resultados: unknown[] };
    expect(off.estado).toBe("desligado");
    expect(off.resultados).toHaveLength(0);
    await h.chamar("registrar", ws.workspace_id, { tipo: "user.note", workspace_id: ws.workspace_id, id: "n2", titulo: "Outra", texto: "nada", ocorrido_em: "2026-09-01T10:00:00.000Z" });
    expect(((await h.chamar("estado", ws.workspace_id)) as { indexando: { pendentes: number } }).indexando.pendentes).toBe(0);
  });

  it("listagem paginada por cursor, detalhe do documento, purga exige o nome do workspace", async () => {
    const h = montar();
    await h.chamar("abrir", { ...ws, raiz: join(h.dir, "proj") });
    for (let i = 0; i < 5; i++) await h.chamar("registrar", ws.workspace_id, { tipo: "user.note", workspace_id: ws.workspace_id, id: `n${i}`, titulo: `Nota ${i}`, texto: `conteudo numero ${i} unico${i}`, ocorrido_em: `2026-09-0${i + 1}T10:00:00.000Z` });
    await h.chamar("passo", ws.workspace_id, { ocioso: true });
    const p1 = (await h.chamar("listarDocumentos", ws.workspace_id, { tipo: null, mission_id: null, busca: null, depois: null, limite: 2 })) as { itens: Array<{ documento_id: string }>; proximo: string | null };
    expect(p1.itens).toHaveLength(2);
    expect(p1.proximo).toBe("2");
    const p3 = (await h.chamar("listarDocumentos", ws.workspace_id, { tipo: null, mission_id: null, busca: null, depois: "4", limite: 2 })) as { itens: unknown[]; proximo: string | null };
    expect(p3.itens).toHaveLength(1);
    expect(p3.proximo).toBeNull();
    const det = (await h.chamar("detalheDocumento", ws.workspace_id, p1.itens[0]!.documento_id)) as { chunks: unknown[]; fonte: { documento_id: string } };
    expect(det.chunks.length).toBeGreaterThan(0);
    expect(det.fonte.documento_id).toBe(p1.itens[0]!.documento_id);
    expect(await h.chamar("purgar", ws.workspace_id, "errado")).toEqual({ removidos: -1 });
    const r = (await h.chamar("purgar", ws.workspace_id, "meu-projeto")) as { removidos: number };
    expect(r.removidos).toBeGreaterThan(0);
  });

  it("workspace não aberto e método inexistente falham sem derrubar nada", async () => {
    const h = montar();
    await expect(h.chamar("estado", "ws_nao_aberto")).rejects.toThrow("não aberto");
    await expect(h.chamar("buscar", 42, {})).rejects.toThrow();
  });
});
