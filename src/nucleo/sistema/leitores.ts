// Leitores de memória do sistema por plataforma, com as fontes injetadas (testável sem SO).
import { totalmem, freemem } from "node:os";
import { readFile } from "node:fs/promises";
import type { Executar } from "./executar";
import { memoriaDeUso, memoriaLinux, memoriaMac, parsearMeminfo, parsearSwapMac, parsearVmStat, swapLinux, type MemoriaSistema, type SwapSistema } from "./memoria";

export interface FontesMemoria {
  plataforma: NodeJS.Platform;
  executar: Executar;
  lerArquivo: (caminho: string) => Promise<string>;
  totalBytes: () => number;
  livreBytes: () => number;
}

export const fontesReais = (executar: Executar): FontesMemoria => ({
  plataforma: process.platform, executar, lerArquivo: (c) => readFile(c, "utf8"), totalBytes: totalmem, livreBytes: freemem,
});

/** Memória do sistema (barata o bastante para a amostra periódica; no macOS custa um `vm_stat`, por isso o serviço a espaça). */
export async function lerMemoriaSistema(f: FontesMemoria): Promise<MemoriaSistema> {
  const total = f.totalBytes();
  try {
    if (f.plataforma === "darwin") {
      const vm = parsearVmStat(await f.executar("/usr/bin/vm_stat", [], 1_500));
      const m = vm === null ? null : memoriaMac(vm, total);
      if (m !== null) return m;
    } else if (f.plataforma === "linux") {
      const m = memoriaLinux(parsearMeminfo(await f.lerArquivo("/proc/meminfo")));
      if (m !== null) return m;
    }
  } catch { /* cai no cálculo genérico abaixo */ }
  return memoriaDeUso(total, total - f.livreBytes());
}

/** Swap (só no detalhe do popover): nulo quando a plataforma não expõe sem custo (Windows). */
export async function lerSwap(f: FontesMemoria): Promise<SwapSistema | null> {
  try {
    if (f.plataforma === "darwin") return parsearSwapMac(await f.executar("/usr/sbin/sysctl", ["-n", "vm.swapusage"], 1_500));
    if (f.plataforma === "linux") return swapLinux(parsearMeminfo(await f.lerArquivo("/proc/meminfo")));
  } catch { /* sem swap */ }
  return null;
}
