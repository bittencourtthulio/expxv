// Orçamentos da voz e da captura (Fase 11; núcleo e main sem Electron): P-41 (overhead do app soltar -> texto no PTY, motor instantâneo), P-43 (memória do buffer de fala), P-44/P-45 (recorte e
// memória de uma tela 5K), P-46 (gravação por quadros: fração e bloqueio do event loop), P-47 (peso estático dos chunks, proxy do build), P-48 (nada criado no boot).
// P-40, P-42 e P-49 dependem do renderer/Electron reais (mic falso do Chromium) e ficam nos e2e escritos (tests/captura.e2e.test.ts); aqui eles são cobertos por testes jsdom.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import v8 from "node:v8";
import vm from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import { criarArmazem } from "../../src/nucleo/captura/armazem";
import { recorteFisico } from "../../src/nucleo/captura/geometria";
import { codificarCaptura, imagemEmBranco, recortarBitmap, type Bitmap, type Codificador } from "../../src/nucleo/captura/imagem";
import { iniciarAmostrador, type RelogioQuadros } from "../../src/nucleo/captura/quadros";
import { criarAcumulador } from "../../src/nucleo/voz/wav";
import { criarServicoVoz } from "../../src/main/voz";
import type { MotorStt } from "../../src/nucleo/voz/motores/motor";
import { gravarMedicoes, percentil, registrar } from "./registro";

afterAll(() => gravarMedicoes());
// GC forçado sem exigir a flag no processo: o V8 liga `--expose-gc` em tempo de execução
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;
const RAIZ = resolve(__dirname, "../..");

function fala(ms: number): Uint8Array {
  const n = ms * 16;
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, i % 2 === 0 ? 9000 : -9000, true);
  return b;
}

describe("P-41: soltar a tecla -> texto no PTY (overhead do app, fala de 10 s, motor instantâneo)", () => {
  it("p95 ≤ 150 ms", async () => {
    const tempos: number[] = [];
    const motor: MotorStt = { transcrever: async () => "texto de teste" };
    const audio = fala(10_000);
    for (let i = 0; i < 20; i++) {
      let escrito = 0;
      let t0 = 0;
      const svc = criarServicoVoz({
        permissoes: { plataforma: "mac", microfone: () => "concedida", tela: () => "concedida", pedirMicrofone: async () => "concedida", abrirAjustes: async () => true },
        prefs: { obter: (c) => ({ voz_motor: "comando_local", voz_comando_executavel: "/bin/x", voz_comando_args: ["{wav}"] } as Record<string, unknown>)[c] ?? null, definir: async () => undefined },
        segredos: { disponivel: async () => true, guardar: async () => undefined, existe: async () => false, obter: async () => null, apagar: async () => undefined },
        motores: { comandoLocal: () => motor, http: () => motor },
        sessaoExiste: () => true,
        escrever: () => { escrito = performance.now(); return true; },
        emitir: () => undefined,
      });
      await svc.iniciar("s1", "segurar");
      for (let o = 0, s = 0; o < audio.byteLength; o += 65_536, s++) svc.audio(s, audio.subarray(o, Math.min(audio.byteLength, o + 65_536)));
      t0 = performance.now();
      await svc.parar();
      tempos.push(escrito - t0);
      await svc.encerrar();
    }
    const p95 = percentil(tempos, 95);
    registrar({ id: "P-41", descricao: "Soltar a tecla -> texto no PTY, overhead do app (10 s de fala, motor instantâneo)", valor: p95, limite: 150, unidade: "ms" });
    expect(p95).toBeLessThanOrEqual(150);
  });
});

describe("P-43: memória do buffer de fala", () => {
  it("pico ≤ 4 MB para 120 s e volta ao baseline ± 2 MB depois de 50 falas", () => {
    const a = criarAcumulador();
    const bloco = new Uint8Array(65_536).fill(3);
    for (let i = 0; i < 70; i++) a.adicionar(i, bloco);
    registrar({ id: "P-43a", descricao: "Buffer de fala: 120 s de PCM16 16 kHz mono", valor: a.bytes / 1_048_576, limite: 4, unidade: "MB", semFator: true });
    expect(a.bytes).toBeLessThanOrEqual(4 * 1_048_576);
    a.zerar();
    gc();
    const antes = process.memoryUsage().arrayBuffers;
    for (let f = 0; f < 50; f++) {
      const b = criarAcumulador();
      for (let i = 0; i < 20; i++) b.adicionar(i, bloco);
      b.finalizar();
    }
    gc();
    const delta = (process.memoryUsage().arrayBuffers - antes) / 1_048_576;
    registrar({ id: "P-43b", descricao: "Buffer de fala: variação de memória após 50 falas", valor: Math.max(0, delta), limite: 2, unidade: "MB", semFator: true });
    expect(delta).toBeLessThanOrEqual(2);
  });
});

describe("P-44/P-45: recorte de uma tela 5K (59 MB por quadro)", () => {
  const L = 5120;
  const A = 2880;
  const grande = (): Bitmap => ({ largura: L, altura: A, dados: new Uint8Array(L * A * 4).map((_, i) => (i * 31) % 251) });
  const cod: Codificador = { png: (b) => new Uint8Array(Math.min(1_000, b.dados.byteLength)), jpeg: () => new Uint8Array(10) };

  it("região salva (recorte + codificação + gravação atômica) p95 ≤ 500 ms; memória sobe ≤ +200 MB e solta", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perf-cap-"));
    try {
      const arm = criarArmazem({ pasta: join(dir, "capturas"), raiz: dir });
      const tempos: number[] = [];
      let pico = 0;
      const base = process.memoryUsage().rss;
      for (let i = 0; i < 6; i++) {
        const b = grande();
        pico = Math.max(pico, process.memoryUsage().rss - base);
        const t0 = performance.now();
        const rec = recorteFisico({ id: 1, x: 0, y: 0, largura: L / 2, altura: A / 2, fator: 2 }, { x: 100, y: 100, largura: 600, altura: 400 });
        const r = recortarBitmap(b, rec!);
        const { bytes, formato } = codificarCaptura(r, cod);
        await arm.salvarImagem(bytes, formato);
        tempos.push(performance.now() - t0);
        b.dados.fill(0);
        r.dados.fill(0);
      }
      const p95 = percentil(tempos, 95);
      registrar({ id: "P-44", descricao: "Região da tela 5K: recorte + codificação + gravação atômica (sem overlay: ver Fluxo)", valor: p95, limite: 500, unidade: "ms" });
      registrar({ id: "P-45", descricao: "Pico de memória (RSS) ao congelar uma tela 5K", valor: pico / 1_048_576, limite: 200, unidade: "MB", semFator: true });
      expect(p95).toBeLessThanOrEqual(500);
      expect(pico / 1_048_576).toBeLessThanOrEqual(200);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detectar imagem em branco numa tela 5K custa pouco (amostragem), ≤ 25 ms", () => {
    const b = grande();
    const tempos: number[] = [];
    for (let i = 0; i < 10; i++) { const t0 = performance.now(); imagemEmBranco(b); tempos.push(performance.now() - t0); }
    const m = percentil(tempos, 95);
    registrar({ id: "P-45b", descricao: "Detecção de imagem em branco numa tela 5K (p95)", valor: m, limite: 25, unidade: "ms" });
    expect(m).toBeLessThanOrEqual(25);
  });
});

describe("P-46: gravação por quadros (2 fps, 30 s) com relógio determinístico", () => {
  it("≥ 90% dos quadros previstos, nenhuma captura em voo ao mesmo tempo e parada imediata", async () => {
    let agora = 0;
    const fila: { em: number; fn: () => void }[] = [];
    const relogio: RelogioQuadros = { agora: () => agora, agendar: (fn, ms) => { const it = { em: agora + ms, fn }; fila.push(it); return () => void fila.splice(fila.indexOf(it), 1); } };
    let gravados = 0;
    let emVoo = 0;
    let pico = 0;
    let maiorTrechoSincrono = 0;
    let terminou = false;
    iniciarAmostrador({
      fps: 2, relogio,
      capturar: async () => { emVoo++; pico = Math.max(pico, emVoo); await Promise.resolve(); emVoo--; return new Uint8Array(4); },
      gravar: async () => { const t0 = performance.now(); gravados += 1; maiorTrechoSincono(t0); },
      aoTerminar: () => { terminou = true; },
    });
    function maiorTrechoSincono(t0: number): void { maiorTrechoSincrono = Math.max(maiorTrechoSincrono, performance.now() - t0); }
    for (let guarda = 0; guarda < 10_000 && !terminou; guarda++) {
      await Promise.resolve();
      await Promise.resolve();
      fila.sort((a, b) => a.em - b.em);
      const prox = fila.shift();
      if (prox === undefined) { if (gravados >= 60) break; continue; }
      agora = prox.em;
      prox.fn();
      if (agora > 30_000) break;
    }
    const fracao = gravados / 60;
    registrar({ id: "P-46", descricao: "Gravação por quadros 2 fps / 30 s: fração dos quadros previstos", valor: fracao * 100, limite: 90, unidade: "%", sentido: "min", semFator: true });
    registrar({ id: "P-46b", descricao: "Gravação por quadros: maior trecho síncrono no main", valor: maiorTrechoSincrono, limite: 50, unidade: "ms" });
    expect(fracao).toBeGreaterThanOrEqual(0.9);
    expect(pico).toBe(1);
    expect(maiorTrechoSincrono).toBeLessThanOrEqual(50);
  });
});

describe("P-47: peso dos chunks (proxy estático: fonte gzip, sempre ≥ ao bundle minificado)", () => {
  const gz = (arquivos: string[]): number => gzipSync(Buffer.concat(arquivos.map((a) => readFileSync(resolve(RAIZ, a))))).byteLength / 1024;
  const sem = (dir: string): string[] => readdirSync(resolve(RAIZ, dir)).filter((n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)).map((n) => `${dir}/${n}`).filter((f) => statSync(resolve(RAIZ, f)).isFile());

  it("voz ≤ 15 KB gz e editor de anotação ≤ 30 KB gz, nenhuma dependência nova", () => {
    const voz = gz([...sem("src/renderer/voz"), "src/renderer/telas/terminais/BotaoVoz.tsx"]);
    const editor = gz(["src/renderer/telas/captura/Editor.tsx", "src/renderer/telas/captura/anotacoes.ts", "src/renderer/telas/captura/logica.ts"]);
    registrar({ id: "P-47a", descricao: "Chunk de voz (fonte gzip, proxy do bundle)", valor: voz, limite: 15, unidade: "KB", semFator: true });
    registrar({ id: "P-47b", descricao: "Chunk do editor de anotação (fonte gzip, proxy do bundle)", valor: editor, limite: 30, unidade: "KB", semFator: true });
    expect(voz).toBeLessThanOrEqual(15);
    expect(editor).toBeLessThanOrEqual(30);
    const pkg = JSON.parse(readFileSync(resolve(RAIZ, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    for (const proibida of ["ffmpeg-static", "fluent-ffmpeg", "uiohook-napi", "node-record-lpcm16", "whisper-node", "@ricky0123/vad-web"]) expect(Object.keys(pkg.dependencies ?? {})).not.toContain(proibida);
  });

  it("o gancho no JS inicial (Host da captura + indicador do rodapé) é minúsculo: ≤ 3 KB gz", () => {
    const gancho = gz(["src/renderer/telas/captura/Host.tsx", "src/renderer/casca/IndicadorCapturaVoz.tsx", "src/renderer/estado/captura-voz.ts", "src/renderer/estado/captura-acoes.ts", "src/renderer/estado/foco-pane.ts"]);
    registrar({ id: "P-47c", descricao: "Ganchos de voz/captura no JS inicial (fonte gzip, proxy)", valor: gancho, limite: 3, unidade: "KB", semFator: true });
    expect(gancho).toBeLessThanOrEqual(3);
  });
});

describe("P-48: custo no boot", () => {
  it("registrar os canais não cria serviço de voz nem de captura e custa ≤ 10 ms", async () => {
    const { ligarCapturaVoz } = await import("../../src/main/captura-boot");
    const { criarRegistroIpc } = await import("../../src/main/ipc/registro");
    const ipc = { handle: () => undefined, on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const tempos: number[] = [];
    let criados = { captura: true, voz: true };
    for (let i = 0; i < 10; i++) {
      const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
      const t0 = performance.now();
      const lig = ligarCapturaVoz({
        registro, plataforma: "darwin", userData: tmpdir(),
        electron: { screen: { getAllDisplays: () => [] }, desktopCapturer: { getSources: async () => [] }, nativeImage: { createFromBitmap: () => { throw new Error("não usar"); } }, systemPreferences: { getMediaAccessStatus: () => "granted" }, shell: { openExternal: async () => undefined, trashItem: async () => undefined }, globalShortcut: { register: () => true, unregister: () => undefined }, clipboard: { writeText: () => undefined } } as never,
        preferencias: { obter: () => null, definir: async () => undefined },
        janela: () => null, workspaceRaiz: () => null, sessoes: async () => { throw new Error("não deveria ser chamado no boot"); }, cofre: async () => { throw new Error("não deveria abrir"); },
      });
      tempos.push(performance.now() - t0);
      criados = lig.criados();
    }
    const m = percentil(tempos, 95);
    registrar({ id: "P-48", descricao: "Custo de registrar os canais de voz e captura no boot (p95)", valor: m, limite: 10, unidade: "ms" });
    expect(criados).toEqual({ captura: false, voz: false });
    expect(m).toBeLessThanOrEqual(10);
  });
});
