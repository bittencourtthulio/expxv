// Memória do sistema por plataforma. Parsers PUROS (testados com fixtures) + cálculo de "em uso".
//  - macOS: `os.freemem()` conta cache como livre e engana; usa o `vm_stat` com a conta do Monitor de Atividade:
//    em uso = (páginas anônimas − purgáveis) + wired + ocupadas pelo compressor  (App + Wired + Comprimida).
//    Sem "Anonymous pages" (vm_stat antigo), cai em total − (free + inactive + purgeable + speculative).
//  - Linux: /proc/meminfo, `MemAvailable` (não `MemFree`).
//  - Windows: `os.totalmem/freemem` (o "livre" do Windows já é o disponível, como o Gerenciador de Tarefas).
export interface MemoriaSistema { total: number; usada: number; disponivel: number }
export interface SwapSistema { usado: number; total: number }

const KB = 1024;
const MB = 1024 * 1024;

export function memoriaDeUso(total: number, usada: number): MemoriaSistema {
  const u = Math.min(total, Math.max(0, usada));
  return { total, usada: u, disponivel: total - u };
}

export interface VmStat { tamanhoPagina: number; paginas: Readonly<Record<string, number>> }

const NOMES_VM: Readonly<Record<string, string>> = {
  "pages free": "free", "pages active": "active", "pages inactive": "inactive", "pages speculative": "speculative",
  "pages wired down": "wired", "pages purgeable": "purgeable", "anonymous pages": "anonymous",
  "pages occupied by compressor": "compressor", "file-backed pages": "fileBacked",
};

/** Parse robusto do `vm_stat`: ignora linhas desconhecidas, aceita ponto final e aspas; `null` se não achar o tamanho da página. */
export function parsearVmStat(texto: string): VmStat | null {
  const cab = /page size of (\d+) bytes/i.exec(texto);
  const tamanhoPagina = cab === null ? 0 : Number(cab[1]);
  if (!Number.isInteger(tamanhoPagina) || tamanhoPagina < 512 || tamanhoPagina > 1 << 20) return null;
  const paginas: Record<string, number> = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*"?([^":]+?)"?\s*:\s*(\d+)\.?\s*$/.exec(linha);
    if (m === null) continue;
    const chave = NOMES_VM[m[1]!.trim().toLowerCase()];
    if (chave !== undefined) paginas[chave] = Number(m[2]);
  }
  return { tamanhoPagina, paginas };
}

export function memoriaMac(vm: VmStat, total: number): MemoriaSistema | null {
  const p = vm.paginas;
  const t = vm.tamanhoPagina;
  if (p["anonymous"] !== undefined && p["wired"] !== undefined && p["compressor"] !== undefined) {
    const app = Math.max(0, p["anonymous"] - (p["purgeable"] ?? 0));
    return memoriaDeUso(total, (app + p["wired"] + p["compressor"]) * t);
  }
  if (p["free"] !== undefined && p["inactive"] !== undefined) {
    return memoriaDeUso(total, total - ((p["free"] + p["inactive"] + (p["purgeable"] ?? 0) + (p["speculative"] ?? 0)) * t));
  }
  return null;
}

/** `/proc/meminfo` → mapa chave → bytes (valores em kB). */
export function parsearMeminfo(texto: string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^([A-Za-z_()0-9]+):\s+(\d+)(?:\s*kB)?\s*$/.exec(linha);
    if (m !== null) r[m[1]!] = Number(m[2]) * KB;
  }
  return r;
}

export function memoriaLinux(info: Readonly<Record<string, number>>): MemoriaSistema | null {
  const total = info["MemTotal"];
  if (total === undefined || total <= 0) return null;
  const disponivel = info["MemAvailable"] ?? (info["MemFree"] !== undefined ? info["MemFree"] + (info["Buffers"] ?? 0) + (info["Cached"] ?? 0) : undefined);
  return disponivel === undefined ? null : memoriaDeUso(total, total - disponivel);
}

export function swapLinux(info: Readonly<Record<string, number>>): SwapSistema | null {
  const total = info["SwapTotal"];
  const livre = info["SwapFree"];
  return total === undefined || livre === undefined ? null : { total, usado: Math.max(0, total - livre) };
}

/** `sysctl -n vm.swapusage`: "total = 9216.00M  used = 8636.12M  free = 579.88M  (encrypted)". */
export function parsearSwapMac(texto: string): SwapSistema | null {
  const un = (s: string, u: string): number => Number(s) * (u === "G" ? 1024 * MB : u === "K" ? KB : MB);
  const t = /total\s*=\s*([\d.,]+)([KMG])/.exec(texto);
  const u = /used\s*=\s*([\d.,]+)([KMG])/.exec(texto);
  if (t === null || u === null) return null;
  const total = un(t[1]!.replace(",", "."), t[2]!);
  const usado = un(u[1]!.replace(",", "."), u[2]!);
  return Number.isFinite(total) && Number.isFinite(usado) ? { total, usado } : null;
}

export const paraMb = (bytes: number): number => Math.round(bytes / MB);
export const pctDe = (parte: number, total: number): number => (total <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((parte / total) * 100))));
