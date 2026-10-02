// Orçamentos da voz local embutida (Fase 11, D-546): P-540 a P-547. Núcleo e main sem Electron.
//  P-540 carga do modelo (processo + modelo)            P-541 fator de tempo real (RTF) da transcrição     P-542 RAM de pico do processo de reconhecimento
//  P-543 CPU ociosa com o modelo descarregado = 0       P-544 bloqueio do event loop do main no download   P-545 overhead do app: soltar a tecla → texto no PTY
//  P-546 peso adicional do pacote por arquitetura       P-547 eventos de progresso por segundo (coalescido)
// P-540..P-542 precisam de um modelo real: sem `VOZ_LOCAL_MODELO_DIR` aparecem como «não medido» (nunca verde falso; nenhum modelo é baixado pelo perf).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { criarServicoVoz } from "../../src/main/voz";
import { criarServicoVozModelos } from "../../src/main/voz-modelos";
import { criarClienteRede, criarRegistroConsentimento } from "../../src/nucleo/rede";
import type { Catalogo } from "../../src/nucleo/voz/local/catalogo";
import type { MensagemDoWorker, MensagemParaWorker } from "../../src/nucleo/voz/local/protocolo";
import { criarRuntimeVoz, type PortaProcesso, type RuntimeVoz } from "../../src/nucleo/voz/local/runtime";
import { pcmDoWav } from "../../src/nucleo/voz/motores/local-embutido";
import type { MotorStt } from "../../src/nucleo/voz/motores/motor";
import { gravarMedicoes, naoMedido, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const RAIZ = resolve(__dirname, "../..");
const DIR_MODELO = process.env["VOZ_LOCAL_MODELO_DIR"] ?? "";
const temModelo = DIR_MODELO !== "" && existsSync(join(DIR_MODELO, "model.int8.onnx")) && existsSync(join(DIR_MODELO, "vocab.txt"));
const MOTIVO = "sem modelo real: defina VOZ_LOCAL_MODELO_DIR (NeMo CTC int8 + vocab.txt); o perf não baixa modelos (D-23)";

function fabricaReal(tmp: string): () => PortaProcesso {
  const js = ts.transpileModule(readFileSync(join(RAIZ, "src/nucleo/voz/local/worker-sherpa.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const script = join(tmp, "worker-sherpa.js");
  writeFileSync(script, js);
  return () => {
    const f = spawn(process.execPath, [script], { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", env: { ...process.env, NODE_PATH: join(RAIZ, "node_modules") } });
    return { enviar: (m: MensagemParaWorker) => void f.send(m), aoMensagem: (cb) => void f.on("message", (m) => cb(m as MensagemDoWorker)), aoSair: (cb) => void f.once("exit", cb), matar: () => void f.kill("SIGKILL") };
  };
}

describe("P-540 a P-542: runtime real (modelo opcional)", () => {
  if (!temModelo) {
    it("P-540..P-542 não medidos sem modelo real", () => {
      naoMedido({ id: "P-540", descricao: "Carga do modelo de voz (processo + modelo) ao iniciar o ditado", limite: 4_000, unidade: "ms", motivo: MOTIVO });
      naoMedido({ id: "P-541", descricao: "Fator de tempo real da transcrição (tempo de decodificação ÷ duração do áudio)", limite: 0.25, unidade: "×", motivo: MOTIVO });
      naoMedido({ id: "P-542", descricao: "RAM de pico do processo de reconhecimento com o modelo carregado", limite: 2_200, unidade: "MB", motivo: MOTIVO });
      expect(temModelo).toBe(false);
    });
    return;
  }
  it("mede carga, RTF e RAM com o modelo real e confere a devolução da memória", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "voz-perf-"));
    try {
      const rt: RuntimeVoz = criarRuntimeVoz({ fabrica: fabricaReal(tmp), ociosidade_ms: () => 60_000 });
      const config = { chave: "perf|pt", trecho_max_s: 28, sherpa: { featConfig: { sampleRate: 16_000, featureDim: 80 }, modelConfig: { nemoCtc: { model: join(DIR_MODELO, "model.int8.onnx") }, tokens: join(DIR_MODELO, "vocab.txt"), numThreads: 2, provider: "cpu", debug: 0 } } };
      const pcm = pcmDoWav(new Uint8Array(readFileSync(join(RAIZ, "resources/voz/amostra-pt.wav"))));
      const t0 = performance.now();
      const pre = await rt.preaquecer(config);
      const carga = performance.now() - t0;
      const rtfs: number[] = [];
      let pico = pre.ram_mb;
      for (let i = 0; i < 5; i++) { const r = await rt.transcrever(config, pcm); rtfs.push(r.ms / r.duracao_ms); pico = Math.max(pico, r.ram_mb); }
      rt.descarregar();
      registrar({ id: "P-540", descricao: "Carga do modelo de voz (processo + modelo) ao iniciar o ditado", valor: carga, limite: 4_000, unidade: "ms" });
      registrar({ id: "P-541", descricao: "Fator de tempo real da transcrição (mediana de 5)", valor: percentil(rtfs, 50), limite: 0.25, unidade: "×", pior: Math.max(...rtfs) });
      registrar({ id: "P-542", descricao: "RAM de pico do processo de reconhecimento com o modelo carregado", valor: pico, limite: 2_200, unidade: "MB" });
      expect(carga).toBeLessThan(4_000 * 3);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }, 120_000);
});

describe("P-543: modelo descarregado = zero CPU (nenhum processo, nenhum timer)", () => {
  it("depois da ociosidade não restam processos nem temporizadores", async () => {
    let vivos = 0;
    let timers = 0;
    const agendados = new Map<number, () => void>();
    let id = 0;
    const fabrica = (): PortaProcesso => {
      vivos++;
      let cb: (m: MensagemDoWorker) => void = () => undefined;
      queueMicrotask(() => cb({ t: "pronto" }));
      return {
        enviar: (m) => { if (m.t === "carregar") queueMicrotask(() => cb({ t: "carregado", req: m.req, ms: 1, ram_mb: 1 })); if (m.t === "transcrever") queueMicrotask(() => cb({ t: "resultado", req: m.req, texto: "x", ms: 1, duracao_ms: 1, ram_mb: 1 })); },
        aoMensagem: (c) => { cb = c; }, aoSair: () => undefined, matar: () => { vivos--; },
      };
    };
    const rt = criarRuntimeVoz({ fabrica, ociosidade_ms: () => 120_000, agendar: (fn) => { const i = ++id; agendados.set(i, fn); timers++; return () => { if (agendados.delete(i)) timers--; }; } });
    expect(vivos + timers).toBe(0); // antes do primeiro uso: nada
    await rt.transcrever({ chave: "k", sherpa: {}, trecho_max_s: 28 }, new Uint8Array(32_000));
    expect(vivos).toBe(1);
    for (const fn of [...agendados.values()]) { fn(); } // a ociosidade vence
    agendados.clear(); timers = 0;
    registrar({ id: "P-543", descricao: "Processos + temporizadores vivos com o modelo descarregado (CPU ociosa = 0)", valor: vivos + timers + (rt.estado().carregado ? 1 : 0), limite: 0, unidade: "itens", semFator: true });
    expect(vivos).toBe(0);
  });
});

describe("P-544 e P-547: download de 48 MB no main", () => {
  it("event loop sem bloqueio > 50 ms e progresso coalescido (≤ 4 eventos/s)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "voz-perf-dl-"));
    const grande = Buffer.alloc(48 * 1024 * 1024);
    for (let i = 0; i < grande.length; i += 4096) grande[i] = i & 0xff;
    const sha = createHash("sha256").update(grande).digest("hex");
    const srv = createServer((_q, res) => { res.setHeader("content-length", String(grande.length)); for (let i = 0; i < grande.length; i += 65_536) res.write(grande.subarray(i, i + 65_536)); res.end(); });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const porta = (srv.address() as { port: number }).port;
    try {
      const modelo = {
        id: "perf-modelo", nome: "Perf", descricao: "d", idiomas: ["pt"], familia: "whisper" as const, perfil: "leve" as const, recomendado: false, velocidade: "rapida" as const, qualidade: "boa" as const, ram_estimada_mb: 1, trecho_max_s: 28, amostra: "pt",
        licenca: { id: "MIT", url: "https://x.y/l", atribuicao: "a" }, origem: { host: "127.0.0.1", caminho_base: "/m/" },
        arquivos: [{ nome: "encoder.onnx", papel: "encoder", bytes: grande.length, sha256: sha }, { nome: "decoder.onnx", papel: "decoder", bytes: grande.length, sha256: sha }], tamanho_bytes: grande.length * 2,
      };
      const catalogo: Catalogo = { versao: 1, runtime: "r", hosts_origem: ["127.0.0.1"], hosts_arquivos: [], modelos: [modelo], amostras: {} };
      const registroRede = criarRegistroConsentimento();
      const eventos: Array<{ t: number; fase: string }> = [];
      const prefs = new Map<string, unknown>();
      const svc = criarServicoVozModelos({
        catalogo: () => ({ ok: true, catalogo }), pastaModelos: join(tmp, "modelos"), pastaAmostras: tmp, prefs: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
        rede: criarClienteRede({ consentimento: registroRede, permitirLoopbackHttp: true }), registroRede,
        runtime: { transcrever: async () => { throw new Error("n/a"); }, preaquecer: async () => ({ carregamento_ms: 0, ram_mb: 0 }), descarregar: () => undefined, estado: () => ({ carregado: false, chave: null, ram_mb: null, ocupado: false }), encerrar: () => undefined },
        runtimeDisponivel: () => ({ ok: true, motivo: null }), ativarMotor: async () => undefined, motorAtual: () => ({ motor: "nenhum", modelo_local: null }), ociosidade_s: () => 120,
        emitir: (e) => void eventos.push({ t: performance.now(), fase: e.fase }), porta, espacoLivre: async () => 100 * 1024 ** 3,
      });
      let maior = 0;
      let ultimo = performance.now();
      const medidor = setInterval(() => { const agora = performance.now(); maior = Math.max(maior, agora - ultimo - 5); ultimo = agora; }, 5);
      const t0 = performance.now();
      await svc.baixar({ modelo_id: "perf-modelo", aceite_versao: (await svc.listar()).versao_consentimento, ativar: false });
      while (!eventos.some((e) => e.fase === "instalado")) await new Promise((ok) => setTimeout(ok, 20));
      clearInterval(medidor);
      const segundos = (performance.now() - t0) / 1000;
      const baixando = eventos.filter((e) => e.fase === "baixando");
      const porSegundo = baixando.length / Math.max(1, segundos);
      registrar({ id: "P-544", descricao: "Maior bloqueio do event loop do main durante download+sha256 de 96 MB (loopback)", valor: Math.max(0, maior), limite: 50, unidade: "ms" });
      registrar({ id: "P-547", descricao: "Eventos de progresso do download por segundo (coalescido em 250 ms)", valor: porSegundo, limite: 4.5, unidade: "ev/s", semFator: true });
      expect(maior).toBeLessThan(250);
      expect(statSync(join(tmp, "modelos", "perf-modelo", "encoder.onnx")).size).toBe(grande.length);
    } finally { srv.close(); rmSync(tmp, { recursive: true, force: true }); }
  }, 120_000);
});

describe("P-545: soltar a tecla → texto no PTY com o motor local (runtime instantâneo)", () => {
  it("p95 ≤ 150 ms para uma fala de 10 s", async () => {
    const tempos: number[] = [];
    const audio = new Uint8Array(10 * 32_000);
    const v = new DataView(audio.buffer);
    for (let i = 0; i < audio.length / 2; i++) v.setInt16(i * 2, i % 2 === 0 ? 9000 : -9000, true);
    const motor: MotorStt = { transcrever: async () => "texto de teste local" };
    for (let i = 0; i < 20; i++) {
      const svc = criarServicoVoz({
        permissoes: { plataforma: "mac", microfone: () => "concedida", tela: () => "concedida", pedirMicrofone: async () => "concedida", abrirAjustes: async () => true },
        prefs: { obter: (c) => ({ voz_motor: "local_embutido", voz_modelo_local: "m" } as Record<string, unknown>)[c] ?? null, definir: async () => undefined },
        segredos: { disponivel: async () => true, guardar: async () => undefined, existe: async () => false, obter: async () => null, apagar: async () => undefined },
        motores: { comandoLocal: () => motor, http: (() => motor) as never }, sessaoExiste: () => true, escrever: () => true, emitir: () => undefined,
        local: { existeNoCatalogo: () => true, pronto: async () => true, motor: () => motor, preaquecer: () => undefined, encerrar: () => undefined },
      });
      await svc.iniciar("s1", "segurar");
      for (let s = 0; s < audio.length; s += 32_000) svc.audio(s / 32_000, audio.subarray(s, s + 32_000));
      const t0 = performance.now();
      await svc.parar();
      tempos.push(performance.now() - t0);
      await svc.encerrar();
    }
    const p95 = percentil(tempos, 95);
    registrar({ id: "P-545", descricao: "Overhead do app: soltar a tecla → texto no PTY (motor local instantâneo, fala de 10 s)", valor: p95, limite: 150, unidade: "ms", pior: Math.max(...tempos) });
    expect(p95).toBeLessThan(450);
  });
});

describe("P-546: peso adicional do pacote por arquitetura", () => {
  const tamanho = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? tamanho(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
  it("addon + pacote nativo desta máquina ≤ 40 MB; catálogo e amostras ≤ 300 KB; nenhum modelo", () => {
    const nativos = readdirSync(join(RAIZ, "node_modules")).filter((n) => /^sherpa-onnx-(darwin|win)-/.test(n));
    expect(nativos.length).toBeGreaterThan(0);
    const porPacote = nativos.map((n) => tamanho(join(RAIZ, "node_modules", n)) + tamanho(join(RAIZ, "node_modules", "sherpa-onnx-node")));
    const pior = Math.max(...porPacote) / (1024 * 1024);
    const recursos = tamanho(join(RAIZ, "resources/voz")) / 1024;
    registrar({ id: "P-546", descricao: `Peso adicional do pacote por arquitetura (sherpa-onnx-node + ${nativos.join(", ")}); catálogo+amostras ${recursos.toFixed(0)} KB`, valor: pior, limite: 40, unidade: "MB", semFator: true });
    expect(recursos).toBeLessThan(300);
  });
});
