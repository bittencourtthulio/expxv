import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ErroMotor } from "../motores/motor";
import type { ConfigCarga, MensagemDoWorker, MensagemParaWorker } from "./protocolo";
import { criarRuntimeVoz, type PortaProcesso } from "./runtime";

const CONFIG: ConfigCarga = { chave: "m|pt", sherpa: { x: 1 }, trecho_max_s: 28 };
const pcm = (segundos: number): Uint8Array => new Uint8Array(segundos * 32_000);

/** processo falso programável (em memória). */
class Falso implements PortaProcesso {
  enviados: MensagemParaWorker[] = [];
  vivo = true;
  private cbM: (m: MensagemDoWorker) => void = () => undefined;
  private cbS: () => void = () => undefined;
  constructor(readonly comportamento: (m: MensagemParaWorker, f: Falso) => void) { queueMicrotask(() => this.cbM({ t: "pronto" })); }
  enviar(m: MensagemParaWorker): void { this.enviados.push(m); if (m.t !== "sair") queueMicrotask(() => this.comportamento(m, this)); }
  aoMensagem(cb: (m: MensagemDoWorker) => void): void { this.cbM = cb; }
  aoSair(cb: () => void): void { this.cbS = cb; }
  matar(): void { this.vivo = false; }
  responder(m: MensagemDoWorker): void { this.cbM(m); }
  morrer(): void { this.vivo = false; this.cbS(); }
}
const padrao = (m: MensagemParaWorker, f: Falso): void => {
  if (m.t === "carregar") f.responder({ t: "carregado", req: m.req, ms: 40, ram_mb: 700 });
  if (m.t === "transcrever") f.responder({ t: "resultado", req: m.req, texto: "olá mundo", ms: 90, duracao_ms: Math.round(m.pcm.byteLength / 32), ram_mb: 720 });
};

/** relógio manual para a ociosidade. */
function relogio(): { agendar: (fn: () => void, ms: number) => () => void; avancar: (ms: number) => void; pendentes: () => number } {
  let agora = 0;
  const itens = new Map<number, { quando: number; fn: () => void }>();
  let id = 0;
  return {
    agendar(fn, ms) { const i = ++id; itens.set(i, { quando: agora + ms, fn }); return () => void itens.delete(i); },
    avancar(ms) { agora += ms; for (const [i, t] of [...itens]) if (t.quando <= agora) { itens.delete(i); t.fn(); } },
    pendentes: () => itens.size,
  };
}

describe("runtime de voz local (stub de processo)", () => {
  it("nada nasce antes do primeiro uso; carrega sob demanda e reutiliza o mesmo processo", async () => {
    let criados = 0;
    const rel = relogio();
    const rt = criarRuntimeVoz({ fabrica: () => { criados++; return new Falso(padrao); }, ociosidade_ms: () => 120_000, agendar: rel.agendar });
    expect(criados).toBe(0);
    expect(rel.pendentes()).toBe(0); // sem timer algum
    expect(rt.estado()).toEqual({ carregado: false, chave: null, ram_mb: null, ocupado: false });
    const r1 = await rt.transcrever(CONFIG, pcm(2));
    expect(r1.texto).toBe("olá mundo");
    expect(r1.carregamento_ms).toBe(40);
    const r2 = await rt.transcrever(CONFIG, pcm(1));
    expect(r2.carregamento_ms).toBe(0);
    expect(criados).toBe(1);
    expect(rt.estado().carregado).toBe(true);
    expect(rt.estado().ram_mb).toBe(720);
  });

  it("ociosidade: descarrega (mata o processo) depois do tempo, não durante uso, e recarrega no uso seguinte", async () => {
    const procs: Falso[] = [];
    const rel = relogio();
    let limite = 120_000;
    const rt = criarRuntimeVoz({ fabrica: () => { const p = new Falso(padrao); procs.push(p); return p; }, ociosidade_ms: () => limite, agendar: rel.agendar });
    await rt.transcrever(CONFIG, pcm(1));
    rel.avancar(119_000);
    expect(rt.estado().carregado).toBe(true);
    await rt.transcrever(CONFIG, pcm(1)); // uso reinicia o relógio
    rel.avancar(119_000);
    expect(rt.estado().carregado).toBe(true);
    rel.avancar(2_000);
    expect(rt.estado().carregado).toBe(false);
    expect(procs[0]?.vivo).toBe(false);
    expect(procs[0]?.enviados.at(-1)).toEqual({ t: "sair" });
    expect(rel.pendentes()).toBe(0); // CPU ociosa = 0: nenhum timer com o modelo descarregado
    limite = 15_000; // configurável
    await rt.transcrever(CONFIG, pcm(1));
    expect(procs).toHaveLength(2);
    rel.avancar(15_001);
    expect(rt.estado().carregado).toBe(false);
  });

  it("não descarrega com pedido em andamento", async () => {
    const rel = relogio();
    let liberar: () => void = () => undefined;
    const rt = criarRuntimeVoz({
      fabrica: () => new Falso((m, f) => {
        if (m.t === "carregar") f.responder({ t: "carregado", req: m.req, ms: 1, ram_mb: 1 });
        if (m.t === "transcrever") liberar = () => f.responder({ t: "resultado", req: m.req, texto: "x", ms: 1, duracao_ms: 1, ram_mb: 1 });
      }),
      ociosidade_ms: () => 1_000, agendar: rel.agendar,
    });
    const p = rt.transcrever(CONFIG, pcm(1));
    await new Promise((ok) => setTimeout(ok, 10));
    rel.avancar(5_000);
    expect(rt.estado().carregado).toBe(true);
    expect(rt.estado().ocupado).toBe(true);
    liberar();
    await p;
    rel.avancar(1_001);
    expect(rt.estado().carregado).toBe(false);
  });

  it("modelo diferente (ou idioma) descarrega o anterior e carrega o novo", async () => {
    const procs: Falso[] = [];
    const rt = criarRuntimeVoz({ fabrica: () => { const p = new Falso(padrao); procs.push(p); return p; }, ociosidade_ms: () => 1e9 });
    await rt.transcrever(CONFIG, pcm(1));
    await rt.transcrever({ ...CONFIG, chave: "outro|pt" }, pcm(1));
    expect(procs).toHaveLength(2);
    expect(procs[0]?.vivo).toBe(false);
    expect(rt.estado().chave).toBe("outro|pt");
  });

  it("erros do processo viram códigos nominais; depois da falha o estado é 'descarregado' e a próxima chamada recria", async () => {
    let n = 0;
    const procs: Falso[] = [];
    const rt = criarRuntimeVoz({
      fabrica: () => {
        const p = new Falso((m, f) => {
          if (m.t === "carregar") { n++; return n === 1 ? f.responder({ t: "erro", req: m.req, codigo: "modelo_corrompido" }) : n === 2 ? f.responder({ t: "erro", req: m.req, codigo: "runtime_indisponivel" }) : padrao(m, f); }
          padrao(m, f);
        });
        procs.push(p);
        return p;
      },
      ociosidade_ms: () => 1e9,
    });
    await expect(rt.transcrever(CONFIG, pcm(1))).rejects.toMatchObject({ codigo: "modelo_corrompido" });
    expect(rt.estado().carregado).toBe(false);
    await expect(rt.transcrever(CONFIG, pcm(1))).rejects.toMatchObject({ codigo: "runtime_indisponivel" });
    expect((await rt.transcrever(CONFIG, pcm(1))).texto).toBe("olá mundo");
    expect(procs).toHaveLength(3);
  });

  it("processo que morre no meio: ErroMotor motor_falhou, estado limpo, recria no uso seguinte", async () => {
    let primeiro = true;
    const procs: Falso[] = [];
    const rt = criarRuntimeVoz({
      fabrica: () => {
        const p = new Falso((m, f) => {
          if (m.t === "carregar") return f.responder({ t: "carregado", req: m.req, ms: 1, ram_mb: 1 });
          if (primeiro) { primeiro = false; f.morrer(); return; }
          padrao(m, f);
        });
        procs.push(p);
        return p;
      },
      ociosidade_ms: () => 1e9,
    });
    const e = await rt.transcrever(CONFIG, pcm(1)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroMotor);
    expect((e as ErroMotor).codigo).toBe("motor_falhou");
    expect(rt.estado().carregado).toBe(false);
    expect((await rt.transcrever(CONFIG, pcm(1))).texto).toBe("olá mundo");
  });

  it("processo que morre DURANTE a carga (a biblioteca nativa chama exit() em configuração inválida): motor_falhou, sem travar, e recria depois", async () => {
    let n = 0;
    const rt = criarRuntimeVoz({ fabrica: () => new Falso((m, f) => { if (m.t === "carregar" && ++n === 1) return f.morrer(); padrao(m, f); }), ociosidade_ms: () => 1e9 });
    await expect(rt.transcrever(CONFIG, pcm(1))).rejects.toMatchObject({ codigo: "motor_falhou" });
    expect(rt.estado().carregado).toBe(false);
    expect((await rt.transcrever(CONFIG, pcm(1))).texto).toBe("olá mundo");
  });

  it("timeout de transcrição encerra o processo", async () => {
    const procs: Falso[] = [];
    const rt = criarRuntimeVoz({
      fabrica: () => { const p = new Falso((m, f) => { if (m.t === "carregar") f.responder({ t: "carregado", req: m.req, ms: 1, ram_mb: 1 }); }); procs.push(p); return p; },
      ociosidade_ms: () => 1e9, timeoutTranscricao_ms: 30,
    });
    await expect(rt.transcrever(CONFIG, pcm(1))).rejects.toMatchObject({ codigo: "tempo_esgotado" });
    expect(procs[0]?.vivo).toBe(false);
    expect(rt.estado().carregado).toBe(false);
  });

  it("cancelamento (AbortSignal) rejeita sem esperar o processo", async () => {
    const rt = criarRuntimeVoz({
      fabrica: () => new Falso((m, f) => { if (m.t === "carregar") f.responder({ t: "carregado", req: m.req, ms: 1, ram_mb: 1 }); }),
      ociosidade_ms: () => 1e9,
    });
    const ac = new AbortController();
    const p = rt.transcrever(CONFIG, pcm(1), { sinal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ codigo: "cancelado" });
    rt.encerrar();
  });

  it("operações são serializadas (uma por vez) e preaquecer só carrega", async () => {
    const f: Falso[] = [];
    const rt = criarRuntimeVoz({ fabrica: () => { const p = new Falso(padrao); f.push(p); return p; }, ociosidade_ms: () => 1e9 });
    const pre = await rt.preaquecer(CONFIG);
    expect(pre.ram_mb).toBe(700);
    expect(f[0]?.enviados.map((m) => m.t)).toEqual(["carregar"]);
    const [a, b] = await Promise.all([rt.transcrever(CONFIG, pcm(1)), rt.transcrever(CONFIG, pcm(2))]);
    expect(a.duracao_ms).toBe(1000);
    expect(b.duracao_ms).toBe(2000);
    expect(f[0]?.enviados.map((m) => m.t)).toEqual(["carregar", "transcrever", "transcrever"]);
  });
});

describe("worker real (processo Node com um sherpa-onnx-node falso no NODE_PATH)", () => {
  let tmp = "";
  let filho: ChildProcess | null = null;
  afterEach(() => { filho?.kill("SIGKILL"); filho = null; if (tmp !== "") rmSync(tmp, { recursive: true, force: true }); tmp = ""; });

  function subir(modulo: string): { esperar: (t: string) => Promise<MensagemDoWorker>; enviar: (m: MensagemParaWorker) => void } {
    tmp = mkdtempSync(join(tmpdir(), "voz-worker-"));
    mkdirSync(join(tmp, "node_modules", "sherpa-onnx-node"), { recursive: true });
    writeFileSync(join(tmp, "node_modules", "sherpa-onnx-node", "index.js"), modulo);
    // o worker compilado para JS: transpila com o TypeScript do projeto para um arquivo temporário
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = require("typescript") as typeof import("typescript");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fonte = (require("node:fs") as typeof import("node:fs")).readFileSync(join(__dirname, "worker-sherpa.ts"), "utf8");
    const js = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const script = join(tmp, "worker-sherpa.js");
    writeFileSync(script, js);
    filho = spawn(process.execPath, [script], { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", env: { ...process.env, NODE_PATH: join(tmp, "node_modules") } });
    const fila: MensagemDoWorker[] = [];
    const esperando: Array<{ t: string; ok: (m: MensagemDoWorker) => void }> = [];
    filho.on("message", (m) => { const msg = m as MensagemDoWorker; const i = esperando.findIndex((e) => e.t === msg.t); if (i >= 0) esperando.splice(i, 1)[0]?.ok(msg); else fila.push(msg); });
    return {
      esperar: (t) => new Promise((ok) => { const i = fila.findIndex((m) => m.t === t); if (i >= 0) ok(fila.splice(i, 1)[0] as MensagemDoWorker); else esperando.push({ t, ok }); }),
      enviar: (m) => void filho?.send(m),
    };
  }

  const FALSO = `class OfflineRecognizer { constructor(c) { if (c.quebrar) throw new Error("x"); this.c = c; }
    createStream() { return { n: 0, acceptWaveform(a) { this.n = a.samples.length; this.rate = a.sampleRate; } }; }
    decode(s) { this.ultimo = s; } getResult(s) { return { text: " trecho-" + s.n + "@" + s.rate + " " }; } }
    module.exports = { OfflineRecognizer };`;

  it("carrega, divide em trechos iguais ≤ limite, junta o texto e informa RAM", async () => {
    const w = subir(FALSO);
    expect((await w.esperar("pronto")).t).toBe("pronto");
    w.enviar({ t: "carregar", req: 1, config: { chave: "k", sherpa: {}, trecho_max_s: 2 } });
    expect(await w.esperar("carregado")).toMatchObject({ t: "carregado", req: 1 });
    w.enviar({ t: "transcrever", req: 2, pcm: pcm(5) }); // 5 s com limite de 2 s => 3 trechos de ~1,67 s
    const r = await w.esperar("resultado");
    expect(r).toMatchObject({ t: "resultado", req: 2, duracao_ms: 5000 });
    const texto = (r as { texto: string }).texto;
    expect(texto.split(" ")).toHaveLength(3);
    expect(texto).toMatch(/^trecho-26667@16000 trecho-26667@16000 trecho-26666@16000$/);
    expect((r as { ram_mb: number }).ram_mb).toBeGreaterThan(0);
  });

  it("falha ao criar o reconhecedor vira modelo_corrompido; addon ausente vira runtime_indisponivel; transcrever sem carga vira falha", async () => {
    const w = subir(FALSO);
    await w.esperar("pronto");
    w.enviar({ t: "transcrever", req: 1, pcm: pcm(1) });
    expect(await w.esperar("erro")).toMatchObject({ req: 1, codigo: "falha" });
    w.enviar({ t: "carregar", req: 2, config: { chave: "k", sherpa: { quebrar: true }, trecho_max_s: 28 } });
    expect(await w.esperar("erro")).toMatchObject({ req: 2, codigo: "modelo_corrompido" });
    filho?.kill("SIGKILL");
    const sem = subir("throw new Error('addon ausente')");
    await sem.esperar("pronto");
    sem.enviar({ t: "carregar", req: 3, config: { chave: "k", sherpa: {}, trecho_max_s: 28 } });
    expect(await sem.esperar("erro")).toMatchObject({ req: 3, codigo: "runtime_indisponivel" });
  });

  it("'sair' encerra o processo (é assim que o modelo é descarregado) e desconexão do pai também", async () => {
    const w = subir(FALSO);
    await w.esperar("pronto");
    const saiu = new Promise<number | null>((ok) => filho?.once("exit", (c) => ok(c)));
    w.enviar({ t: "sair" });
    expect(await saiu).toBe(0);
    expect(existsSync(tmp)).toBe(true);
  });
});
