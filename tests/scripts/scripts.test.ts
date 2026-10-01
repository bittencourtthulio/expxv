import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarDebounce, mudancaRelevante } from "../../scripts/lib/debounce.mjs";
import { localizarPacote, smokeOk } from "../../scripts/lib/pacote.mjs";

describe("debounce do dev", () => {
  it("uma rajada vira uma ação só, com 300 ms", () => {
    vi.useFakeTimers();
    const acao = vi.fn();
    const d = criarDebounce(acao, 300);
    d();
    vi.advanceTimersByTime(200);
    d();
    vi.advanceTimersByTime(299);
    expect(acao).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(acao).toHaveBeenCalledTimes(1);
    expect(d.pendente()).toBe(false);
    vi.useRealTimers();
  });
  it("cancelar impede a ação", () => {
    vi.useFakeTimers();
    const acao = vi.fn();
    const d = criarDebounce(acao, 300);
    d();
    d.cancelar();
    vi.advanceTimersByTime(1000);
    expect(acao).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("só .js reinicia", () => {
    expect(mudancaRelevante("main.js")).toBe(true);
    expect(mudancaRelevante("main.js.map")).toBe(false);
    expect(mudancaRelevante(null)).toBe(false);
  });
});

describe("localização do pacote", () => {
  it("acha o executável no mac e no win; null sem pacote", () => {
    const raiz = mkdtempSync(join(tmpdir(), "pacote-"));
    expect(localizarPacote(raiz, "darwin")).toBeNull();
    const macos = join(raiz, "dist-app", "mac-arm64", "App.app", "Contents", "MacOS");
    mkdirSync(macos, { recursive: true });
    writeFileSync(join(macos, "App"), "");
    expect(localizarPacote(raiz, "darwin")?.executavel).toBe(join(macos, "App"));
    const win = join(raiz, "dist-app", "win-unpacked");
    mkdirSync(win, { recursive: true });
    writeFileSync(join(win, "App.exe"), "");
    expect(localizarPacote(raiz, "win32")?.executavel).toBe(join(win, "App.exe"));
  });
  it("smoke ok só com código 0 e sem sinal", () => {
    expect(smokeOk(0, null)).toBe(true);
    expect(smokeOk(1, null)).toBe(false);
    expect(smokeOk(0, "SIGKILL")).toBe(false);
  });
});
