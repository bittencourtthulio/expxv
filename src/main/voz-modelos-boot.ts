// Ligação da voz local no main (Fase 11, D-544): fábrica do processo de reconhecimento (Node/Electron com `ELECTRON_RUN_AS_NODE`, canal IPC, sem shell), disponibilidade do runtime nesta máquina
// e caminho do worker fora do asar. Nada daqui roda no boot: só quando o serviço de voz é criado (primeiro uso).
import { spawn as spawnReal, type ChildProcess, type SpawnOptions } from "node:child_process";
import { dirname, join } from "node:path";
import { ambienteMinimo } from "../nucleo/voz/motores/comando-local";
import type { MensagemDoWorker, MensagemParaWorker } from "../nucleo/voz/local/protocolo";
import type { PortaProcesso } from "../nucleo/voz/local/runtime";

export type SpawnProcesso = (cmd: string, args: readonly string[], op: SpawnOptions) => ChildProcess;

/** Executável e argumentos SEPARADOS, sem shell; stdout/stderr descartados (nada do runtime vai a log); ambiente mínimo; serialização avançada (bytes sem base64). */
export function criarFabricaProcesso(o: { execPath: string; script: string; spawn?: SpawnProcesso }): () => PortaProcesso {
  const spawn = o.spawn ?? spawnReal;
  return () => {
    const filho = spawn(o.execPath, [o.script], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
      shell: false,
      windowsHide: true,
      cwd: dirname(o.script),
      env: { ...ambienteMinimo(), ELECTRON_RUN_AS_NODE: "1" },
    });
    return {
      enviar: (m: MensagemParaWorker) => { filho.send(m); },
      aoMensagem: (cb: (m: MensagemDoWorker) => void) => { filho.on("message", (m) => cb(m as MensagemDoWorker)); },
      aoSair: (cb: () => void) => { filho.once("exit", cb); filho.once("error", cb); },
      matar: () => { try { filho.kill("SIGKILL"); } catch { /* já saiu */ } },
    };
  };
}

/** `app.asar` → `app.asar.unpacked`: o que roda como processo (e o addon nativo) não carrega de dentro do asar. */
export function caminhoDoWorker(o: { dirMain: string; empacotado: boolean }): string {
  const script = join(o.dirMain, "..", "nucleo", "voz", "local", "worker-sherpa.js");
  return o.empacotado ? script.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2") : script;
}

export interface DisponibilidadeRuntime { ok: boolean; motivo: string | null }

/** O pacote do addon da plataforma existe? (o `sherpa-onnx-node` escolhe `sherpa-onnx-<so>-<arq>` em tempo de execução). A carga real acontece no processo e, se falhar lá, vira `runtime_indisponivel`. */
export function runtimeDisponivel(o: { platform: NodeJS.Platform; arch: string; resolver: (id: string) => string }): DisponibilidadeRuntime {
  const so = o.platform === "darwin" ? "darwin" : o.platform === "win32" ? "win" : null;
  const arquiteturas = o.platform === "darwin" ? ["arm64", "x64"] : ["x64"];
  if (so === null || !arquiteturas.includes(o.arch)) return { ok: false, motivo: `A voz local embutida ainda não é suportada em ${o.platform}/${o.arch}.` };
  try {
    o.resolver("sherpa-onnx-node/package.json");
    o.resolver(`sherpa-onnx-${so}-${o.arch}/package.json`);
    return { ok: true, motivo: null };
  } catch {
    return { ok: false, motivo: "O componente de reconhecimento de voz não está presente neste pacote." };
  }
}
