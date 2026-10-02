// Auditoria de privacidade e segurança da voz e da captura (Fase 11, T-11.22): testes ESTÁTICOS sobre o código-fonte (com mutação, para provar que a varredura enxerga o problema) e testes dinâmicos
// de ponta a ponta do que dá para provar sem Electron: zero conexão sem consentimento, WAV só no tmp 0700 apagado, microfone fechado, nenhuma fala em log.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawn as spawnReal } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarClienteRede, criarRegistroConsentimento } from "../src/nucleo/rede";
import { criarMotorComandoLocal } from "../src/nucleo/voz/motores/comando-local";
import { criarMotorHttp } from "../src/nucleo/voz/motores/http-compativel";
import { redigirSegredos } from "../src/nucleo/privacidade/redacao";

const RAIZ = resolve(__dirname, "..");
const src = (...p: string[]): string => join(RAIZ, "src", ...p);
const rel = (f: string): string => relative(RAIZ, f).split("\\").join("/");

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? fontes(c) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [c] : [];
  });
}

const VOZ_E_CAPTURA = [
  ...fontes(src("nucleo", "voz")), ...fontes(src("nucleo", "captura")), ...fontes(src("nucleo", "privacidade")),
  src("main", "voz.ts"), src("main", "captura.ts"), src("main", "captura-boot.ts"), src("main", "captura-eletron.ts"), src("main", "permissoes.ts"),
  src("main", "ipc", "captura.ts"), src("main", "ipc", "captura-voz.ts"),
  ...fontes(src("renderer", "voz")), ...fontes(src("renderer", "telas", "captura")),
  src("renderer", "telas", "terminais", "BotaoVoz.tsx"), src("renderer", "telas", "config", "SecaoVozCaptura.tsx"),
];

/** `console.*` ou logger que recebe variável de fala/segredo/imagem. */
const VAZAMENTO_EM_LOG = /\b(?:console\.(?:log|info|warn|error|debug)|aviso(?:\?\.)?|logger\.\w+)\s*\([^)]*\b(?:texto|fala|bruto|transcri\w*|chave|valor|segredo|token|wav|pcm|dados|bytes|imagem|png)\b/i;

describe("T-11.22 (1) rede: zero conexão sem consentimento", () => {
  let servidor: http.Server;
  let porta = 0;
  let conexoes = 0;
  beforeEach(async () => {
    conexoes = 0;
    servidor = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end('{"text":"ok"}'); });
    servidor.on("connection", () => void (conexoes += 1));
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    porta = (servidor.address() as AddressInfo).port;
  });
  afterEach(async () => { await new Promise((r) => servidor.close(r)); });

  const motor = (consentido: () => boolean) => {
    const registroRede = criarRegistroConsentimento();
    const rede = criarClienteRede({ consentimento: registroRede, permitirLoopbackHttp: true });
    return criarMotorHttp({ url: `http://127.0.0.1:${porta}/v1`, chave: async () => "k", consentido, rede, registroRede, permitirLoopbackHttp: true, timeout_ms: 2_000 });
  };

  it("sem consentimento o motor remoto recusa e NENHUM socket é aberto", async () => {
    await expect(motor(() => false).transcrever(new Uint8Array(64), { idioma: "pt", modelo: null, prompt: "" })).rejects.toMatchObject({ codigo: "consentimento_ausente" });
    expect(conexoes).toBe(0);
  });

  it("mutação: se o consentimento fosse removido do código, esta auditoria DERRUBARIA (a conexão acontece)", async () => {
    await motor(() => true).transcrever(new Uint8Array(64), { idioma: "pt", modelo: null, prompt: "" });
    expect(conexoes).toBe(1); // o teste acima só passa porque a regra existe
  });

  it("voz e captura nunca importam http/https/net/tls nem usam fetch (a saída de rede é só nucleo/rede)", () => {
    for (const f of VOZ_E_CAPTURA) {
      // `isIP` só valida texto de IP (não abre conexão); o download do modelo passa por nucleo/rede (D-540)
      expect(readFileSync(f, "utf8").replace(/import \{ isIP \} from "node:net";/g, ""), rel(f)).not.toMatch(/\bfetch\s*\(|from "node:(?:https?|net|tls|dns|dgram)"|XMLHttpRequest|new WebSocket|navigator\.sendBeacon|\bnet\.request/);
    }
  });

  it("sem telemetria: nenhum módulo de voz/captura cita analytics, sentry, mixpanel ou similar", () => {
    for (const f of VOZ_E_CAPTURA) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/analytics|sentry|mixpanel|segment\.io/i);
  });
});

describe("T-11.22 (2) áudio: só o WAV temporário 0700 do motor local, apagado em finally", () => {
  let base = "";
  beforeEach(async () => { base = await mkdtemp(join(tmpdir(), "priv-voz-")); });
  afterEach(async () => { await rm(base, { recursive: true, force: true }); });

  it("o WAV existe só dentro de pasta própria durante a execução e nada sobra depois (inclusive em falha)", async () => {
    let pastaVista = "";
    const falso = resolve(__dirname, "fixtures", "stt-falso.mjs");
    const m = criarMotorComandoLocal({
      executavel: process.execPath, args: [falso, "--wav", "{wav}", "--texto", "ok", "--atraso", "50"], tmp: base,
      spawn: (cmd, args, op) => { pastaVista = resolve(String(args[args.indexOf("--wav") + 1]), ".."); return spawnReal(cmd, [...args], op); },
    });
    const wav = new Uint8Array(44 + 64);
    wav.set([0x52, 0x49, 0x46, 0x46]);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    await m.transcrever(wav, { idioma: "pt", modelo: null, prompt: "" });
    expect(pastaVista.startsWith(base)).toBe(true);
    expect(await readdir(base)).toEqual([]);
    await criarMotorComandoLocal({ executavel: process.execPath, args: [falso, "--wav", "{wav}", "--falhar", "3"], tmp: base }).transcrever(wav, { idioma: "pt", modelo: null, prompt: "" }).catch(() => undefined);
    expect(await readdir(base)).toEqual([]);
  });

  it("a pasta temporária nasce por mkdtemp (0700) e é apagada em finally", () => {
    const t = readFileSync(src("nucleo", "voz", "motores", "comando-local.ts"), "utf8");
    expect(t).toMatch(/mkdtemp\(/);
    expect(t).toMatch(/mode: 0o600/);
    expect(t).toMatch(/finally\s*\{[\s\S]*rm\(dir,\s*\{ recursive: true, force: true \}\)/);
  });

  it("nenhum módulo de voz grava áudio em disco: só comando-local escreve arquivo (o WAV temporário)", () => {
    const comEscrita = VOZ_E_CAPTURA.filter((f) => /nucleo[\\/]voz|main[\\/]voz\.ts|renderer[\\/]voz/.test(f)).filter((f) => /writeFile|createWriteStream|appendFile|localStorage|sessionStorage|indexedDB|MediaRecorder|showSaveFilePicker/.test(readFileSync(f, "utf8"))).map(rel);
    // integridade.ts grava só o manifesto JSON do modelo baixado (D-540), nunca áudio
    expect(comEscrita).toEqual(["src/nucleo/voz/local/integridade.ts", "src/nucleo/voz/motores/comando-local.ts"]);
  });

  it("o histórico de falas não tem caminho para banco nem arquivo (só memória)", () => {
    const t = readFileSync(src("main", "voz.ts"), "utf8");
    expect(t).not.toMatch(/from "node:fs|banco|sqlite|repos\./i);
    expect(t).not.toMatch(/prefs\.definir\(K\.hist/);
  });
});

describe("T-11.22 (3) log e diagnóstico sem conteúdo de fala, segredo ou imagem", () => {
  it("nenhum console.* ou aviso() de voz/captura recebe texto, áudio, chave ou bytes", () => {
    const achados: string[] = [];
    for (const f of VOZ_E_CAPTURA) {
      readFileSync(f, "utf8").split("\n").forEach((linha, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;
        if (VAZAMENTO_EM_LOG.test(linha) && !/mensagemSegura\(/.test(linha)) achados.push(`${rel(f)}:${i + 1}: ${linha.trim().slice(0, 100)}`);
      });
    }
    expect(achados).toEqual([]);
  });

  it("mutação: a varredura pega um console.log(texto) introduzido de propósito", () => {
    expect(VAZAMENTO_EM_LOG.test("  console.log(texto);")).toBe(true);
    expect(VAZAMENTO_EM_LOG.test("  d.aviso?.(`voz: ${texto}`);")).toBe(true);
    expect(VAZAMENTO_EM_LOG.test("  console.error(`falha ${e.message}`);")).toBe(false);
  });

  it("a redação mascara chave e token antes de qualquer saída de erro", () => {
    const chave = ["sk", "ant", "api03", "AbCdEfGhIjKlMnOpQr"].join("-");
    expect(redigirSegredos(`falhou com Authorization: Bearer abcdefgh12345678 e ${chave}`)).not.toMatch(/abcdefgh12345678|AbCdEfGhIjKl/);
  });
});

describe("T-11.22 (4) getUserMedia só durante a fala", () => {
  it("só capturaAudio.ts chama getUserMedia e ele fecha as trilhas", () => {
    const usam = fontes(src("renderer")).filter((f) => /getUserMedia|getDisplayMedia|MediaRecorder/.test(readFileSync(f, "utf8"))).map(rel);
    expect(usam).toEqual(["src/renderer/voz/capturaAudio.ts"]);
    const t = readFileSync(src("renderer", "voz", "capturaAudio.ts"), "utf8");
    expect(t).toMatch(/t\.stop\(\)/);
    expect(t).not.toMatch(/getDisplayMedia\(/);
  });

  it("o hook cancela em blur, pagehide, visibilitychange e pointercancel", () => {
    const t = readFileSync(src("renderer", "voz", "usarDitado.ts"), "utf8");
    for (const ev of ["blur", "pagehide", "visibilitychange", "pointercancel"]) expect(t).toContain(`"${ev}"`);
  });
});

describe("T-11.22 (5) imagem: sem janelas extras, sem upload, sem agente", () => {
  it("captura não cria BrowserWindow (nada de overlay para vazar) e desktopCapturer só no adaptador", () => {
    for (const f of VOZ_E_CAPTURA) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/new BrowserWindow|BrowserWindow\.getAllWindows/);
    const usam = VOZ_E_CAPTURA.filter((f) => /\bdesktopCapturer\.getSources\(/.test(readFileSync(f, "utf8"))).map(rel);
    expect(usam).toEqual(["src/main/captura-eletron.ts"]);
  });

  it("não existe tool MCP de captura nem de voz (D-65): o agente não captura tela nem ouve microfone", () => {
    for (const f of fontes(src("nucleo", "mcp"))) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/captura:|voz:|desktopCapturer|getUserMedia|screenshot|capturar_tela|dictate/i);
  });

  it("a captura só sai da máquina por ação explícita: clipboard só em copiarCaminho e nunca Enter no PTY", () => {
    const t = readFileSync(src("main", "captura.ts"), "utf8");
    expect((t.match(/copiarTexto\(/g) ?? []).length).toBe(1); // o único uso, em copiarCaminho
    expect(t).not.toMatch(/escrever\([^)]*\\r/);
  });
});

describe("T-11.22 (6) processos e permissões", () => {
  it("nenhum spawn com shell: true em nucleo/voz e main", () => {
    for (const f of [...fontes(src("nucleo", "voz")), src("main", "voz.ts"), src("main", "captura.ts")]) {
      const t = readFileSync(f, "utf8");
      expect(t, rel(f)).not.toMatch(/shell:\s*true/);
      expect(t, rel(f)).not.toMatch(/(?<![.\w])exec(?:Sync)?\s*\(/);
    }
    expect(readFileSync(src("nucleo", "voz", "motores", "comando-local.ts"), "utf8")).toMatch(/shell:\s*false/);
  });

  it("o handler de permissões do Chromium no main usa decidirPermissao (nega tudo que não é áudio do app)", () => {
    const t = readFileSync(src("main", "main.ts"), "utf8");
    expect(t).toContain("setPermissionRequestHandler(");
    expect(t).toContain("decidirPermissao");
    expect(t).not.toMatch(/setPermissionRequestHandler\(\(_wc, _permissao, callback\) => callback\(true\)\)/);
  });

  it("atalhos nativos do macOS nunca são alterados (sem defaults write nem plist de atalhos)", () => {
    for (const f of VOZ_E_CAPTURA) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/defaults\s+write|com\.apple\.symbolichotkeys|osascript/);
  });
});
