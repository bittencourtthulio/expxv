// Ligação do medidor ao main (D-530…): sob demanda, sem timer sem assinante, fronteira de segredo no detalhe. Sem Electron.
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarSistemaMain } from "./sistema";

const SEGREDO = "ghp_SEGREDO_NA_LINHA_DE_COMANDO";
afterEach(() => { vi.useRealTimers(); });

function criar(extra: Partial<Parameters<typeof criarSistemaMain>[0]> = {}) {
  const enviar = vi.fn();
  const chamadas: Array<[string, readonly string[]]> = [];
  const executar = vi.fn(async (bin: string, args: readonly string[]) => {
    chamadas.push([bin, args]);
    if (bin.endsWith("ps")) return `  10 1 2048 1.0 /usr/bin/daemon\n  20 10 4096 9.0 /Users/x/.local/bin/claude --token=${SEGREDO}\n`;
    if (bin.endsWith("sysctl")) return "total = 1024.00M  used = 512.00M  free = 512.00M";
    return "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages wired down: 10.\nAnonymous pages: 10.\nPages occupied by compressor: 0.\nPages purgeable: 0.\n";
  });
  const s = criarSistemaMain({
    enviar, executar, plataforma: "darwin", pidApp: 1,
    metricasApp: () => [{ pid: 1, tipo: "Browser", cpu: 2, memKb: 100_000 }],
    sessoes: () => [{ rotulo: "Claude Code", pid: 20 }],
    fontes: { plataforma: "darwin", executar, lerArquivo: async () => "", totalBytes: () => 1024 * 1024 * 1024, livreBytes: () => 0 },
    ...extra,
  });
  return { s, enviar, executar, chamadas };
}

describe("sistema no main", () => {
  it("criar o serviço não agenda nada nem executa nada (custo ocioso zero)", () => {
    vi.useFakeTimers();
    const { s, executar } = criar();
    expect(vi.getTimerCount()).toBe(0);
    expect(executar).not.toHaveBeenCalled();
    expect(s.servico.ativo()).toBe(false);
    s.encerrar();
  });

  it("assinar agenda UM timer (unref); desassinar zera", () => {
    vi.useFakeTimers();
    const { s } = criar();
    s.servico.definirAssinatura(true);
    expect(vi.getTimerCount()).toBe(1);
    s.servico.definirAssinatura(false);
    expect(vi.getTimerCount()).toBe(0);
    s.encerrar();
  });

  it("detalhe: só nomes-base e inteiros; nada do segredo da linha de comando; só pede ps/sysctl fixos", async () => {
    const { s, chamadas } = criar();
    s.servico.definirAssinatura(true);
    const d = (await s.servico.detalhe(true))!;
    const texto = JSON.stringify(d);
    expect(texto).not.toContain("SEGREDO");
    expect(texto).not.toContain("--token");
    expect(texto).not.toContain("/Users");
    expect(d.agentes.sessoes[0]).toMatchObject({ rotulo: "Claude Code", processos: 1 });
    expect(d.swap).toEqual({ usado_mb: 512, total_mb: 1024 });
    expect(chamadas.find(([b]) => b === "/bin/ps")![1]).toEqual(["-axo", "pid=,ppid=,rss=,pcpu=,comm="]);
    expect(JSON.stringify(chamadas)).not.toMatch(/args|command|shell/i);
    s.encerrar();
  });
});
