import { describe, expect, it, vi } from "vitest";
import { ambienteMinimo } from "./executar";
import { lerMemoriaSistema, lerSwap, type FontesMemoria } from "./leitores";

const fontes = (p: Partial<FontesMemoria>): FontesMemoria => ({ plataforma: "darwin", executar: async () => "", lerArquivo: async () => "", totalBytes: () => 1000, livreBytes: () => 250, ...p });
const VM = "Mach Virtual Memory Statistics: (page size of 512 bytes)\nPages wired down: 2.\nAnonymous pages: 3.\nPages occupied by compressor: 1.\nPages purgeable: 0.\n";

describe("leitores de memória", () => {
  it("macOS usa o vm_stat com caminho absoluto e argumentos fixos", async () => {
    const executar = vi.fn(async () => VM);
    const m = await lerMemoriaSistema(fontes({ executar, totalBytes: () => 10_000 }));
    expect(executar).toHaveBeenCalledWith("/usr/bin/vm_stat", [], expect.any(Number));
    expect(m.usada).toBe((3 + 2 + 1) * 512);
  });
  it("macOS com vm_stat quebrado cai no cálculo genérico (total − livre), sem lançar", async () => {
    const m = await lerMemoriaSistema(fontes({ executar: async () => { throw new Error("x"); } }));
    expect(m).toEqual({ total: 1000, usada: 750, disponivel: 250 });
  });
  it("Linux lê /proc/meminfo (MemAvailable)", async () => {
    const lerArquivo = vi.fn(async () => "MemTotal: 1 kB\nMemAvailable: 1 kB\n");
    const m = await lerMemoriaSistema(fontes({ plataforma: "linux", lerArquivo }));
    expect(lerArquivo).toHaveBeenCalledWith("/proc/meminfo");
    expect(m.usada).toBe(0);
  });
  it("Windows usa total − livre do os (o livre do Windows já é o disponível)", async () => {
    expect(await lerMemoriaSistema(fontes({ plataforma: "win32" }))).toEqual({ total: 1000, usada: 750, disponivel: 250 });
  });
  it("swap: macOS via sysctl fixo, Linux via meminfo, Windows = null", async () => {
    const executar = vi.fn(async () => "total = 2.00G  used = 1.00G  free = 1.00G");
    expect(await lerSwap(fontes({ executar }))).toEqual({ total: 2 * 1024 ** 3, usado: 1024 ** 3 });
    expect(executar).toHaveBeenCalledWith("/usr/sbin/sysctl", ["-n", "vm.swapusage"], expect.any(Number));
    expect(await lerSwap(fontes({ plataforma: "linux", lerArquivo: async () => "SwapTotal: 4 kB\nSwapFree: 1 kB\n" }))).toEqual({ total: 4096, usado: 3072 });
    expect(await lerSwap(fontes({ plataforma: "win32" }))).toBeNull();
  });
});

describe("ambiente do filho", () => {
  it("é mínimo: nenhuma variável do usuário (segredos) chega ao processo", () => {
    const env = { OPENAI_API_KEY: "sk-x", HOME: "/h", PATH: "/x" } as NodeJS.ProcessEnv;
    expect(ambienteMinimo("darwin", env)).toEqual({ LC_ALL: "C", LANG: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
    expect(JSON.stringify(ambienteMinimo("win32", { ...env, SystemRoot: "C:\\Windows" }))).not.toContain("sk-x");
  });
});
