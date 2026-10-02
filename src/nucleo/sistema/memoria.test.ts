import { describe, expect, it } from "vitest";
import { memoriaLinux, memoriaMac, parsearMeminfo, parsearSwapMac, parsearVmStat, swapLinux } from "./memoria";

// saída real de um Mac Apple Silicon (páginas de 16 KB, 18 GB)
const VM_STAT_M = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4696.
Pages active:                                 255609.
Pages inactive:                               235555.
Pages speculative:                             18934.
Pages throttled:                                   0.
Pages wired down:                             224274.
Pages purgeable:                                  10.
"Translation faults":                    21580387405.
Pages copy-on-write:                       551881133.
File-backed pages:                            138578.
Anonymous pages:                              371520.
Pages stored in compressor:                  1705767.
Pages occupied by compressor:                 400190.
Decompressions:                           5679041494.
`;
const TOTAL = 19327352832;

describe("vm_stat (macOS)", () => {
  it("parseia tamanho da página e contadores (aspas, ponto final, linhas desconhecidas ignoradas)", () => {
    const vm = parsearVmStat(VM_STAT_M)!;
    expect(vm.tamanhoPagina).toBe(16384);
    expect(vm.paginas["wired"]).toBe(224274);
    expect(vm.paginas["anonymous"]).toBe(371520);
    expect(vm.paginas["compressor"]).toBe(400190);
    expect(vm.paginas["fileBacked"]).toBe(138578);
  });
  it("sem cabeçalho/lixo = null, nunca lança", () => {
    expect(parsearVmStat("")).toBeNull();
    expect(parsearVmStat("Pages free: 12.")).toBeNull();
    expect(parsearVmStat("page size of 3 bytes")).toBeNull();
  });
  it("em uso como o Monitor de Atividade: (anônimas − purgáveis) + wired + compressor (≠ total − freemem)", () => {
    const m = memoriaMac(parsearVmStat(VM_STAT_M)!, TOTAL)!;
    expect(m.usada).toBe((371520 - 10 + 224274 + 400190) * 16384);
    expect(Math.round((m.usada / TOTAL) * 100)).toBe(84);
    expect(m.disponivel).toBe(TOTAL - m.usada);
    // o "livre" ingênuo (só páginas free) diria ~100%: o cache não pode contar como livre
    expect(Math.round((1 - (4696 * 16384) / TOTAL) * 100)).toBe(100);
  });
  it("sem 'Anonymous pages' cai em total − (free + inactive + purgeable + speculative)", () => {
    const antigo = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free: 1000.
Pages active: 5000.
Pages inactive: 2000.
Pages speculative: 500.
Pages wired down: 1500.
Pages purgeable: 100.
`;
    const m = memoriaMac(parsearVmStat(antigo)!, 10000 * 4096)!;
    expect(m.usada).toBe((10000 - (1000 + 2000 + 100 + 500)) * 4096);
  });
  it("sem dado suficiente = null", () => {
    expect(memoriaMac({ tamanhoPagina: 4096, paginas: { wired: 1 } }, 1000)).toBeNull();
  });
  it("swap: parse de vm.swapusage", () => {
    const s = parsearSwapMac("total = 9216.00M  used = 8636.12M  free = 579.88M  (encrypted)")!;
    expect(Math.round(s.total / 1048576)).toBe(9216);
    expect(Math.round(s.usado / 1048576)).toBe(8636);
    expect(parsearSwapMac("lixo")).toBeNull();
  });
});

const MEMINFO = `MemTotal:       16000000 kB
MemFree:          500000 kB
MemAvailable:    4000000 kB
Buffers:          200000 kB
Cached:          3000000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
HugePages_Total:       0
`;
describe("/proc/meminfo (Linux)", () => {
  it("usa MemAvailable (não MemFree) e calcula swap", () => {
    const info = parsearMeminfo(MEMINFO);
    expect(info["MemTotal"]).toBe(16000000 * 1024);
    const m = memoriaLinux(info)!;
    expect(m.disponivel).toBe(4000000 * 1024);
    expect(m.usada).toBe(12000000 * 1024);
    expect(swapLinux(info)).toEqual({ total: 2000000 * 1024, usado: 500000 * 1024 });
  });
  it("sem MemAvailable (kernel antigo) soma Free + Buffers + Cached; sem MemTotal = null", () => {
    const m = memoriaLinux(parsearMeminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 50 kB\n"))!;
    expect(m.disponivel).toBe(200 * 1024);
    expect(memoriaLinux({})).toBeNull();
  });
});
