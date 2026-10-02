// Integração REAL (opcional): runtime + worker + `sherpa-onnx-node` com um modelo de verdade. Não há fixture legítima pequena o bastante para ir no repositório (o menor modelo do catálogo tem ~124 MB),
// então o teste só roda quando `VOZ_LOCAL_MODELO_DIR` aponta para uma pasta com `model.int8.onnx` (NeMo CTC) e o vocabulário `vocab.txt`; caso contrário PULA com aviso (D-547).
// Mede e imprime: carga, primeira palavra, RTF e RAM do processo; confere o texto da amostra embutida e a devolução da memória ao descarregar.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { pcmDoWav } from "../motores/local-embutido";
import type { MensagemDoWorker, MensagemParaWorker } from "./protocolo";
import { criarRuntimeVoz, type PortaProcesso } from "./runtime";

const DIR = process.env["VOZ_LOCAL_MODELO_DIR"] ?? "";
const temModelo = DIR !== "" && existsSync(join(DIR, "model.int8.onnx")) && existsSync(join(DIR, "vocab.txt"));
const RAIZ = join(__dirname, "../../../..");
const WAV = join(RAIZ, "resources/voz/amostra-pt.wav");
let tmp = "";
afterAll(() => { if (tmp !== "") rmSync(tmp, { recursive: true, force: true }); });

function fabricaReal(): () => PortaProcesso {
  tmp = mkdtempSync(join(tmpdir(), "voz-int-"));
  const js = ts.transpileModule(readFileSync(join(__dirname, "worker-sherpa.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const script = join(tmp, "worker-sherpa.js");
  writeFileSync(script, js);
  return () => {
    const f = spawn(process.execPath, [script], { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", env: { ...process.env, NODE_PATH: join(RAIZ, "node_modules") } });
    return {
      enviar: (m: MensagemParaWorker) => void f.send(m),
      aoMensagem: (cb) => void f.on("message", (m) => cb(m as MensagemDoWorker)),
      aoSair: (cb) => void f.once("exit", cb),
      matar: () => void f.kill("SIGKILL"),
    };
  };
}

describe.skipIf(!temModelo)("runtime real com sherpa-onnx-node", () => {
  it("transcreve a amostra em PT-BR, mede carga/RTF/RAM e descarrega", async () => {
    const rt = criarRuntimeVoz({ fabrica: fabricaReal(), ociosidade_ms: () => 60_000 });
    const config = { chave: "real|pt", trecho_max_s: 28, sherpa: { featConfig: { sampleRate: 16_000, featureDim: 80 }, modelConfig: { nemoCtc: { model: join(DIR, "model.int8.onnx") }, tokens: join(DIR, "vocab.txt"), numThreads: 2, provider: "cpu", debug: 0 } } };
    const pcm = pcmDoWav(new Uint8Array(readFileSync(WAV)));
    const t0 = Date.now();
    const r1 = await rt.transcrever(config, pcm);
    const total1 = Date.now() - t0;
    const r2 = await rt.transcrever(config, pcm);
    const rtf = r2.ms / r2.duracao_ms;
    // eslint-disable-next-line no-console
    console.log(`[voz-local real] primeira transcrição ${total1} ms (carga ${r1.carregamento_ms} ms), RTF ${rtf.toFixed(3)}, RAM do processo ${r2.ram_mb} MB, texto: "${r1.texto}"`);
    expect(r1.texto.toLowerCase()).toMatch(/teste/);
    expect(r1.texto.toLowerCase()).toMatch(/voz/);
    expect(rtf).toBeLessThan(0.5);
    expect(rt.estado().carregado).toBe(true);
    rt.descarregar();
    expect(rt.estado()).toMatchObject({ carregado: false, ram_mb: null });
  }, 60_000);
});

describe.skipIf(temModelo)("runtime real (pulado)", () => {
  it("PULADO: defina VOZ_LOCAL_MODELO_DIR (pasta com model.int8.onnx NeMo CTC + vocab.txt) para rodar a integração real", () => {
    // eslint-disable-next-line no-console
    console.warn("[voz-local] integração real pulada: sem VOZ_LOCAL_MODELO_DIR (nenhum modelo é baixado nos testes)");
    expect(temModelo).toBe(false);
  });
});
