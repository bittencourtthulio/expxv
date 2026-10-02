import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ambienteMinimo, criarMotorComandoLocal, substituirMarcadores, validarComando } from "./comando-local";
import { ErroMotor, lerTranscricao } from "./motor";

const FALSO = resolve(__dirname, "../../../../tests/fixtures/stt-falso.mjs");
const WAV = new Uint8Array(44 + 640);
WAV.set([0x52, 0x49, 0x46, 0x46]);
WAV.set([0x57, 0x41, 0x56, 0x45], 8);
const OPCOES = { idioma: "pt" as const, modelo: null, prompt: "" };

let base = "";
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), "motor-cmd-")); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

const motor = (extra: string[] = [], op: Partial<Parameters<typeof criarMotorComandoLocal>[0]> = {}) =>
  criarMotorComandoLocal({ executavel: process.execPath, args: [FALSO, "--wav", "{wav}", ...extra], tmp: base, ...op });
const sobras = async (): Promise<string[]> => (await readdir(base)).filter((n) => n.includes("-voz-"));

describe("motor por comando local", () => {
  it("o motor falso transcreve (texto puro e JSON) e o WAV chega íntegro", async () => {
    expect(await motor(["--texto", "olá mundo"]).transcrever(WAV, OPCOES)).toBe("olá mundo");
    expect(await motor(["--texto", "em json", "--json"]).transcrever(WAV, OPCOES)).toBe("em json");
    expect(await motor(["--duracao"]).transcrever(WAV, OPCOES)).toBe("20");
  });

  it("executável ausente vira motor_ausente e não deixa WAV", async () => {
    const m = criarMotorComandoLocal({ executavel: join(base, "nao-existe"), args: ["{wav}"], tmp: base });
    await expect(m.transcrever(WAV, OPCOES)).rejects.toMatchObject({ codigo: "motor_ausente" });
    expect(await sobras()).toEqual([]);
  });

  it("falha do processo vira motor_falhou sem vazar saída", async () => {
    const e = await motor(["--falhar", "7"]).transcrever(WAV, OPCOES).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroMotor);
    expect((e as ErroMotor).codigo).toBe("motor_falhou");
    expect((e as ErroMotor).message).toContain("7");
  });

  it("timeout mata a árvore e apaga o WAV", async () => {
    const t0 = Date.now();
    const e = await motor(["--pendurar", "--atraso", "60000"], { timeout_ms: 400 }).transcrever(WAV, OPCOES).catch((x: unknown) => x);
    expect((e as ErroMotor).codigo).toBe("tempo_esgotado");
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(await sobras()).toEqual([]);
  });

  it("cancelar pelo sinal encerra e limpa", async () => {
    const ctl = new AbortController();
    const p = motor(["--pendurar", "--atraso", "60000"]).transcrever(WAV, { ...OPCOES, sinal: ctl.signal });
    setTimeout(() => ctl.abort(), 150);
    await expect(p).rejects.toMatchObject({ codigo: "cancelado" });
    expect(await sobras()).toEqual([]);
  });

  it("nenhum WAV sobra depois de 20 execuções (incluindo falhas)", async () => {
    for (let i = 0; i < 20; i++) {
      const extra = i % 3 === 0 ? ["--falhar", "1"] : i % 3 === 1 ? ["--apagar"] : [];
      await motor(extra).transcrever(WAV, OPCOES).catch(() => undefined);
    }
    expect(await sobras()).toEqual([]);
  });

  it("texto com aspas, cifrão e crases passa sem shell", async () => {
    const t = "a 'b' \"c\" $HOME `x`";
    expect(await motor(["--texto", t]).transcrever(WAV, OPCOES)).toBe(t);
  });

  it("valida o comando: absoluto, {wav}, sem controle", () => {
    expect(validarComando("/usr/bin/x", ["{wav}"]).ok).toBe(true);
    expect(validarComando("whisper", ["{wav}"]).ok).toBe(false);
    expect(validarComando("/usr/bin/x", ["--sem-marcador"]).ok).toBe(false);
    expect(validarComando("/usr/bin/x\n", ["{wav}"]).ok).toBe(false);
    expect(validarComando("/usr/bin/x", ["{wav}", "a\u0000b"]).ok).toBe(false);
    expect(substituirMarcadores(["-f", "{wav}", "-l", "{idioma}", "-m", "{modelo}"], { wav: "/t/a.wav", idioma: "pt", modelo: "base" })).toEqual(["-f", "/t/a.wav", "-l", "pt", "-m", "base"]);
  });

  it("o ambiente do motor não herda chaves de provedor", () => {
    const origem: NodeJS.ProcessEnv = { PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "segredo", ANTHROPIC_API_KEY: "outro" };
    expect(ambienteMinimo(origem)).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("leitor tolerante de transcrição", () => {
    expect(lerTranscricao('{"transcript":"a"}')).toBe("a");
    expect(lerTranscricao('{"transcription":[{"text":"a"},{"text":"b"}]}')).toBe("a b");
    expect(lerTranscricao("  puro \n")).toBe("puro");
    expect(lerTranscricao("{não é json")).toBe("{não é json");
  });
});
