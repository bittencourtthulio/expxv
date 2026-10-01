import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarTmp, limparTmps } from "../../../tests/fixtures/metodo/util";
import { evento, gerarProjetoExpx, gerarVolume } from "../../../tests/fixtures/metodo/gerar";
import { criarObservador, WatcherRecursivo, type Agendador, type LoteMudanca, type WatcherLike } from "./observador";

afterEach(limparTmps);

/** relógio manual: nada dorme de verdade. */
function agendadorFalso(): Agendador & { avancar(ms: number): Promise<void>; pendentes(): number } {
  let agora = 0;
  let seq = 0;
  const tarefas = new Map<number, { em: number; fn: () => void }>();
  return {
    agendar(fn, ms) {
      const id = ++seq;
      tarefas.set(id, { em: agora + ms, fn });
      return id;
    },
    cancelar(h) {
      tarefas.delete(h as number);
    },
    async avancar(ms) {
      const alvo = agora + ms;
      for (;;) {
        const proxima = [...tarefas.entries()].filter(([, t]) => t.em <= alvo).sort((a, b) => a[1].em - b[1].em)[0];
        if (!proxima) break;
        tarefas.delete(proxima[0]);
        agora = proxima[1].em;
        proxima[1].fn();
        await new Promise((r) => setTimeout(r, 25)); // deixa os async do observador (I/O real do tail) andarem
      }
      agora = alvo;
    },
    pendentes: () => tarefas.size,
  };
}

class WatcherFalso extends EventEmitter implements WatcherLike {
  fechado = 0;
  caminhos: string[] = [];
  async close(): Promise<void> {
    this.fechado++;
  }
  emitir(ev: string, p: string): void {
    this.emit("all", ev, p);
  }
}

async function montar(raiz: string, extra: Partial<Parameters<typeof criarObservador>[0]> = {}) {
  const w = new WatcherFalso();
  const ag = agendadorFalso();
  const lotes: LoteMudanca[] = [];
  const obs = criarObservador({
    raiz,
    aoMudar: (l) => void lotes.push(l),
    agendador: ag,
    criarWatcher: (caminhos) => {
      w.caminhos = caminhos;
      queueMicrotask(() => w.emit("ready"));
      return w;
    },
    assentamentoMs: 0,
    ...extra,
  });
  await obs.pronto;
  return { w, ag, lotes, obs, raiz };
}

describe("observador (watcher e relógio falsos)", () => {
  it("observa docs, .expx e devolve só o que interessa", async () => {
    const raiz = criarTmp();
    const { w } = await montar(raiz);
    expect(w.caminhos).toEqual([join(raiz, "docs"), join(raiz, ".expx")]);
  });

  it("rajada de 50 toques no mesmo arquivo vira 1 releitura", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes } = await montar(raiz);
    for (let i = 0; i < 50; i++) {
      w.emitir("change", join(raiz, "docs/sprintx/features/x/sprint-01/tasks.md"));
      await ag.avancar(10); // toques espaçados de 10 ms: o debounce de 300 ms é renovado
    }
    expect(lotes).toHaveLength(0);
    await ag.avancar(300);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toMatchObject({ documentos: true, config: false, arquivos: ["docs/sprintx/features/x/sprint-01/tasks.md"] });
    await ag.avancar(5000);
    expect(lotes).toHaveLength(1);
  });

  it("rajada de 50 arquivos diferentes também é 1 lote, com todos os caminhos", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes } = await montar(raiz);
    for (let i = 0; i < 50; i++) w.emitir("add", join(raiz, `docs/manutencao/OC-${i}/00-OCORRENCIA.md`));
    await ag.avancar(300);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]?.arquivos).toHaveLength(50);
  });

  it("o debounce usa 300 ms por padrão", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes } = await montar(raiz);
    w.emitir("change", join(raiz, "docs/a/ORQUESTRADOR.md"));
    await ag.avancar(299);
    expect(lotes).toHaveLength(0);
    await ag.avancar(1);
    expect(lotes).toHaveLength(1);
  });

  it("remoção de arquivo e de pasta também dispara releitura", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes } = await montar(raiz);
    w.emitir("unlink", join(raiz, "docs/a/QA.md"));
    w.emitir("unlinkDir", join(raiz, "docs/b"));
    await ag.avancar(300);
    expect(lotes[0]).toMatchObject({ documentos: true });
  });

  it("configuração do .expx marca config sem marcar documentos", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes } = await montar(raiz);
    w.emitir("change", join(raiz, ".expx/hooks.json"));
    w.emitir("change", join(raiz, ".expx/expx-lock.json"));
    w.emitir("change", join(raiz, ".expx/memoria/indice.json"));
    await ag.avancar(300);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toMatchObject({ documentos: false, config: true });
    expect(lotes[0]?.arquivos.sort()).toEqual([".expx/expx-lock.json", ".expx/hooks.json", ".expx/memoria/indice.json"]);
  });

  it("ignora node_modules, dist, .git, marketplace e arquivos fora de docs/.expx", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes } = await montar(raiz);
    for (const p of ["docs/node_modules/x/ORQUESTRADOR.md", "docs/dist/a.md", "docs/.git/HEAD", ".expx/marketplace/plugins/a.json", ".expx/estado.json", "src/a.ts", "README.md"]) {
      w.emitir("change", join(raiz, p));
    }
    await ag.avancar(1000);
    expect(lotes).toHaveLength(0);
    expect(ag.pendentes()).toBe(0);
  });

  it("JSONL: entrega só as linhas novas (tail por offset) e adia a linha incompleta", async () => {
    const raiz = criarTmp();
    mkdirSync(join(raiz, "docs/eventos"), { recursive: true });
    const arq = join(raiz, "docs/eventos/x.jsonl");
    writeFileSync(arq, evento({ trabalho_id: "x", task: "antiga" }) + "\n");
    const { w, ag, lotes } = await montar(raiz);
    const nova = evento({ trabalho_id: "x", task: "nova" });
    appendFileSync(arq, nova.slice(0, 30));
    w.emitir("change", arq);
    await ag.avancar(300);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]?.eventos).toEqual([]);
    expect(lotes[0]).toMatchObject({ documentos: false, jsonl: ["docs/eventos/x.jsonl"] });
    appendFileSync(arq, nova.slice(30) + "\n");
    w.emitir("change", arq);
    await ag.avancar(300);
    expect(lotes[1]?.eventos.map((e) => e.task)).toEqual(["nova"]);
  });

  it("JSONL criado depois do início é lido desde o zero", async () => {
    const raiz = criarTmp();
    mkdirSync(join(raiz, "docs/eventos"), { recursive: true });
    const { w, ag, lotes } = await montar(raiz);
    const arq = join(raiz, "docs/eventos/y.jsonl");
    writeFileSync(arq, evento({ trabalho_id: "y", task: "A" }) + "\n" + evento({ trabalho_id: "y", task: "B" }) + "\n");
    w.emitir("add", arq);
    await ag.avancar(300);
    expect(lotes[0]?.eventos.map((e) => e.task)).toEqual(["A", "B"]);
  });

  it("aoMudar que lança não derruba o observador; o próximo lote chega", async () => {
    const raiz = criarTmp();
    let chamadas = 0;
    const { w, ag } = await montar(raiz, {
      aoMudar: () => {
        chamadas++;
        if (chamadas === 1) throw new Error("boom");
      },
    });
    w.emitir("change", join(raiz, "docs/a/tasks.md"));
    await ag.avancar(300);
    w.emitir("change", join(raiz, "docs/a/tasks.md"));
    await ag.avancar(300);
    expect(chamadas).toBe(2);
  });

  it("nunca roda duas releituras ao mesmo tempo: o que chega durante uma vira outra depois", async () => {
    const raiz = criarTmp();
    let ativos = 0;
    let maxAtivos = 0;
    let chamadas = 0;
    let liberar: () => void = () => undefined;
    const { w, ag } = await montar(raiz, {
      aoMudar: async () => {
        chamadas++;
        ativos++;
        maxAtivos = Math.max(maxAtivos, ativos);
        await new Promise<void>((r) => (liberar = r));
        ativos--;
      },
    });
    w.emitir("change", join(raiz, "docs/a/tasks.md"));
    await ag.avancar(300);
    expect(chamadas).toBe(1);
    w.emitir("change", join(raiz, "docs/a/tasks.md")); // chega enquanto a 1a roda
    await ag.avancar(1000);
    expect(chamadas).toBe(1);
    liberar();
    await new Promise((r) => setTimeout(r, 20)); // a 1a termina e o toque pendente é reagendado
    await ag.avancar(300); // o toque que esperou agora vira a 2a releitura
    expect(chamadas).toBe(2);
    liberar();
    await ag.avancar(10);
    expect(ativos).toBe(0);
    expect(maxAtivos).toBe(1);
  });

  it("fechar cancela o debounce pendente, fecha o watcher uma vez e ignora o que vier depois", async () => {
    const raiz = criarTmp();
    const { w, ag, lotes, obs } = await montar(raiz);
    w.emitir("change", join(raiz, "docs/a/tasks.md"));
    await obs.fechar();
    await obs.fechar();
    expect(w.fechado).toBe(1);
    expect(ag.pendentes()).toBe(0);
    w.emitir("change", join(raiz, "docs/a/tasks.md"));
    await ag.avancar(5000);
    expect(lotes).toHaveLength(0);
    expect(w.listenerCount("all")).toBe(0);
  });

  it("erro do watcher não lança e é entregue a aoErro", async () => {
    const raiz = criarTmp();
    const erros: string[] = [];
    const { w } = await montar(raiz, { aoErro: (e) => void erros.push(e.message) });
    expect(() => w.emit("error", new Error("EMFILE"))).not.toThrow();
    expect(erros).toEqual(["EMFILE"]);
  });
});

describe("observador com chokidar de verdade", () => {
  const recursos = (): number => process.getActiveResourcesInfo().filter((r) => r === "FSEventWrap" || r === "FSWatcher").length;
  const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  async function ate(cond: () => boolean, limite = 20_000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < limite) {
      if (cond()) return true;
      await esperar(25);
    }
    return cond();
  }

  it("rajada de 50 gravações vira 1 lote com o arquivo certo (a latência P-11 é medida em tests/perf)", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const lotes: LoteMudanca[] = [];
    const obs = criarObservador({ raiz, aoMudar: (l) => void lotes.push(l) });
    try {
      await obs.pronto;
      const arq = join(raiz, "docs/sprintx/features/cobranca-pix/sprint-01/tasks.md");
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        appendFileSync(arq, `\n<!-- toque ${i} -->`);
        await esperar(4);
      }
      const tFim = performance.now();
      expect(await ate(() => lotes.length >= 1, 15_000)).toBe(true);
      const latencia = performance.now() - tFim;
      await esperar(900); // nenhum lote extra pode aparecer
      // a rajada vira 1 lote (provado de forma determinística com o watcher falso); com o FSEvents real sob carga os
      // eventos podem chegar em 2 levas, então aqui só se exige "poucos lotes, todos sobre o arquivo certo"
      expect(lotes.length).toBeLessThanOrEqual(3);
      // o FSEvents também reentrega eventos de instantes ANTES do watch (arquivos recém-gerados): basta o arquivo tocado estar num lote
      expect(lotes.some((l) => l.arquivos.includes("docs/sprintx/features/cobranca-pix/sprint-01/tasks.md"))).toBe(true);
      process.stderr.write(`[P-11] ${(tFim - t0).toFixed(0)} ms de rajada; lote ${latencia.toFixed(0)} ms após o último toque (debounce 300 + estabilização); o limite de 600 ms é verificado em tests/perf\n`);
    } finally {
      await obs.fechar();
    }
  }, 20_000);

  it("arquivo em escrita não é entregue antes de estabilizar (awaitWriteFinish)", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const lotes: LoteMudanca[] = [];
    const obs = criarObservador({ raiz, aoMudar: (l) => void lotes.push(l) });
    try {
      await obs.pronto;
      const arq = join(raiz, "docs/sprintx/features/cobranca-pix/ORQUESTRADOR.md");
      writeFileSync(arq, "---\nexpx_schema: 1\nkind: orq");
      await esperar(30);
      appendFileSync(arq, "uestrador\n---\n");
      expect(lotes).toHaveLength(0);
      expect(await ate(() => lotes.length >= 1)).toBe(true);
    } finally {
      await obs.fechar();
    }
  }, 20_000);

  it("pasta docs criada depois do início é percebida; config do .expx idem", async () => {
    const raiz = criarTmp();
    const lotes: LoteMudanca[] = [];
    const obs = criarObservador({ raiz, aoMudar: (l) => void lotes.push(l) });
    try {
      await obs.pronto;
      mkdirSync(join(raiz, "docs/manutencao/OC-1"), { recursive: true });
      writeFileSync(join(raiz, "docs/manutencao/OC-1/00-OCORRENCIA.md"), "x");
      mkdirSync(join(raiz, ".expx"), { recursive: true });
      writeFileSync(join(raiz, ".expx/hooks.json"), "{}");
      expect(await ate(() => lotes.some((l) => l.documentos) && lotes.some((l) => l.config), 20_000)).toBe(true);
    } finally {
      await obs.fechar();
    }
  }, 20_000);

  it("fechar libera todos os handles (sem vazamento)", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await esperar(150); // handles de testes anteriores ainda fechando
    const base = recursos();
    const obs = criarObservador({ raiz, aoMudar: () => undefined });
    await obs.pronto;
    expect(recursos()).toBeGreaterThan(base);
    await obs.fechar();
    expect(await ate(() => recursos() <= base, 3000)).toBe(true);
    // abrir e fechar de novo várias vezes não acumula
    for (let i = 0; i < 3; i++) {
      const o = criarObservador({ raiz, aoMudar: () => undefined });
      await o.pronto;
      await o.fechar();
    }
    expect(await ate(() => recursos() <= base, 3000)).toBe(true);
  }, 30_000);
});

describe("AUD-06: fechar é O(1) e não trava o event loop", () => {
  it("com ~10 000 arquivos o fechar leva <= 100 ms e nenhuma batida de timer de 10 ms atrasa mais de 100 ms", async () => {
    const raiz = criarTmp();
    gerarVolume(raiz, 10_000);
    const obs = criarObservador({ raiz, aoMudar: () => undefined, assentamentoMs: 0 });
    await obs.pronto;
    let ultima = performance.now();
    let maiorGap = 0;
    const batida = setInterval(() => { const t = performance.now(); maiorGap = Math.max(maiorGap, t - ultima); ultima = t; }, 10);
    await new Promise((r) => setTimeout(r, 60));
    const t0 = performance.now();
    await obs.fechar();
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 30));
    clearInterval(batida);
    process.stderr.write(`[AUD-06] fechar com 10 000 arquivos: ${ms.toFixed(1)} ms; maior intervalo do timer: ${maiorGap.toFixed(0)} ms\n`);
    expect(ms).toBeLessThanOrEqual(100);
    expect(maiorGap).toBeLessThanOrEqual(100);
  }, 60_000);

  it("cai para o observador por arquivo SOMENTE quando o recursivo não é suportado, avisando", async () => {
    const raiz = criarTmp();
    mkdirSync(join(raiz, "docs"), { recursive: true });
    const reserva = new WatcherFalso();
    const erros: string[] = [];
    const w = new WatcherRecursivo([join(raiz, "docs")], { estabilidadeMs: 10, ignorar: () => false }, () => reserva, () => {
      throw Object.assign(new Error("recursive não suportado"), { code: "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM" });
    });
    w.on("error", (e: Error) => erros.push(e.message));
    const eventos: string[] = [];
    w.on("all", (ev: string, p: string) => eventos.push(`${ev}:${p}`));
    await new Promise((r) => setTimeout(r, 5));
    expect(w.usandoReserva).toBe(true);
    expect(erros.join("|")).toContain("usando o observador por arquivo");
    reserva.emitir("change", "/x/a.md");
    expect(eventos).toEqual(["change:/x/a.md"]);
    await w.close();
    expect(reserva.fechado).toBe(1);
  });

  it("estabiliza: vários toques no mesmo caminho são coalescidos, e rename de arquivo apagado vira unlink", async () => {
    const raiz = criarTmp();
    mkdirSync(join(raiz, "docs"), { recursive: true });
    const w = new WatcherRecursivo([join(raiz, "docs")], { estabilidadeMs: 40, ignorar: () => false });
    const eventos: string[] = [];
    w.on("all", (ev: string, p: string) => eventos.push(`${ev}:${p.slice(raiz.length + 1)}`));
    await new Promise((r) => setTimeout(r, 30));
    const arq = join(raiz, "docs/a.md");
    for (let i = 0; i < 5; i++) { appendFileSync(arq, `${i}\n`); await new Promise((r) => setTimeout(r, 10)); }
    await new Promise((r) => setTimeout(r, 200));
    expect(eventos.filter((e) => e.endsWith("docs/a.md")).length).toBeLessThan(3); // 5 toques; o FSEvents pode partir a rajada em 2 lotes
    expect(eventos).toContain("add:docs/a.md");
    eventos.length = 0;
    rmSync(arq);
    await new Promise((r) => setTimeout(r, 200));
    expect(eventos).toContain("unlink:docs/a.md");
    await w.close();
  });
});
