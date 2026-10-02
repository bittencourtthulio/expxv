// Fase 11 (T-11.01/T-11.23): o pacote traz o necessário para o microfone no macOS (texto de uso em PT-BR e entitlement de áudio) e NADA além disso; o worklet de áudio existe como arquivo estático.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const RAIZ = resolve(__dirname, "..", "..");
const cfg = parse(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")) as Record<string, any>;

describe("pacote: microfone e captura", () => {
  it("Info.plist tem NSMicrophoneUsageDescription em português que diz o que NÃO acontece", () => {
    const texto: string = cfg.mac.extendInfo.NSMicrophoneUsageDescription;
    expect(texto).toMatch(/ditado|fala/i);
    expect(texto).toMatch(/não é gravado em disco/);
    expect(Object.keys(cfg.mac.extendInfo)).toEqual(["NSMicrophoneUsageDescription"]); // nenhuma permissão a mais (câmera, contatos…)
  });

  it("o entitlement de áudio existe, vale também para os processos filhos e nada além de microfone e do runtime do Electron", () => {
    expect(cfg.mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(cfg.mac.entitlementsInherit).toBe("build/entitlements.mac.plist");
    const plist = readFileSync(join(RAIZ, cfg.mac.entitlements), "utf8");
    const chaves = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    expect(chaves).toContain("com.apple.security.device.audio-input");
    expect(chaves.sort()).toEqual(["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.cs.disable-library-validation", "com.apple.security.device.audio-input"]);
    for (const proibida of ["device.camera", "personal-information", "network.server", "files.all", "automation.apple-events"]) expect(plist).not.toContain(proibida);
    expect((plist.match(/<true\/>/g) ?? []).length).toBe(chaves.length);
  });

  it("o worklet de áudio é um asset estático (nada de blob:) e o renderer o referencia por URL relativa", () => {
    expect(existsSync(join(RAIZ, "src/renderer/voz/worklet-pcm.js"))).toBe(true);
    const js = readFileSync(join(RAIZ, "src/renderer/voz/worklet-pcm.js"), "utf8");
    expect(js).toContain('registerProcessor("captura-pcm"');
    expect(js).not.toMatch(/fetch|XMLHttpRequest|WebSocket|importScripts|localStorage/);
    const ts = readFileSync(join(RAIZ, "src/renderer/voz/capturaAudio.ts"), "utf8");
    expect(ts).toContain('new URL("./worklet-pcm.js", import.meta.url)');
    expect(ts).not.toMatch(/URL\.createObjectURL|blob:/);
  });

  it("a CSP do app continua sem blob: e sem relaxar script-src por causa do áudio", () => {
    const scheme = readFileSync(join(RAIZ, "src/main/scheme.ts"), "utf8");
    expect(scheme).toContain("\"script-src 'self'\"");
    expect(scheme).not.toMatch(/blob:|unsafe-eval|worker-src/);
  });
});
