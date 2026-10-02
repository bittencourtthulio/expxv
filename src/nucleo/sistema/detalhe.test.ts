import { describe, expect, it, vi } from "vitest";
import { criarListadorProcessos, criarMontadorDetalhe } from "./detalhe";
import type { ProcessoSO } from "./processos";

const SEGREDO = "sk-ant-SEGREDO-123";

describe("detalhe do popover", () => {
  it("separa app e agentes, acha o daemon e nunca devolve caminho nem argumento", async () => {
    const lista: ProcessoSO[] = [
      { pid: 10, ppid: 1, rssKb: 51200, cpu: 1, nome: "node" },     // daemon de PTY (pai das sessões)
      { pid: 20, ppid: 10, rssKb: 204800, cpu: 30, nome: "claude" }, // sessão Claude
      { pid: 21, ppid: 20, rssKb: 102400, cpu: 20, nome: "node" },
    ];
    const montar = criarMontadorDetalhe({
      listarProcessos: async () => lista,
      metricasApp: () => [{ pid: 1, tipo: "Browser", cpu: 3.4, memKb: 307200 }, { pid: 2, tipo: "Tab", cpu: 8, memKb: 409600 }],
      sessoes: () => [{ rotulo: "Claude Code", pid: 20 }],
      lerSwap: async () => ({ usado: 1048576 * 100, total: 1048576 * 1000 }),
      pidApp: 1,
    });
    const d = await montar({ cpu: { total: 40, nucleos: [10, 70] }, memoria: { total: 1048576 * 1000, usada: 1048576 * 600, disponivel: 1048576 * 400 } });
    expect(d.cpu_total).toBe(40);
    expect(d.ram).toEqual({ pct: 60, usada_mb: 600, total_mb: 1000, disponivel_mb: 400 });
    expect(d.swap).toEqual({ usado_mb: 100, total_mb: 1000 });
    expect(d.app.processos.map((p) => p.nome)).toEqual(["Principal", "Interface", "Daemon de PTY"]);
    expect(d.agentes.sessoes).toEqual([{ rotulo: "Claude Code", processos: 2, cpu: 50, mem_mb: 300 }]);
    expect(d.top_cpu[0]).toMatchObject({ nome: "claude", origem: "agente", sessao: "Claude Code" });
    expect(JSON.stringify(d)).not.toMatch(/[\\/]/);
  });

  it("ps falhando não derruba: lista vazia, app continua", async () => {
    const montar = criarMontadorDetalhe({ listarProcessos: async () => { throw new Error("x"); }, metricasApp: () => [], sessoes: () => [], lerSwap: async () => null, pidApp: 1 });
    const d = await montar({ cpu: null, memoria: null });
    expect(d.agentes.sessoes).toEqual([]);
    expect(d.swap).toBeNull();
    expect(d.nucleos).toEqual([]);
  });
});

describe("fronteira: processo com segredo na linha de comando", () => {
  it("o listador só pede pid/ppid/rss/pcpu/comm; mesmo que a saída traga a linha inteira, só o nome-base sai", async () => {
    const executar = vi.fn(async (_b: string, _a: readonly string[], _t: number) => ` 50 1 1000 5.0 /usr/local/bin/tool --token=${SEGREDO} --senha=abc\n`);
    const lista = await criarListadorProcessos({ plataforma: "darwin", executar, agora: () => 0 })();
    expect(executar).toHaveBeenCalledWith("/bin/ps", ["-axo", "pid=,ppid=,rss=,pcpu=,comm="], expect.any(Number));
    expect(JSON.stringify(executar.mock.calls)).not.toMatch(/args|command/i);
    // o `comm` real nunca traz argumentos; se algo vazasse na linha, o nome-base ainda é limitado e sem barras
    expect(lista[0]!.nome).toBe("tool");
  });
  it("nenhum dado do detalhe contém o segredo quando o SO só devolve nomes", async () => {
    const executar = vi.fn(async (_b: string, _a: readonly string[], _t: number) => ` 50 1 1000 5.0 /opt/agente/bin/cli\n`);
    const montar = criarMontadorDetalhe({
      listarProcessos: criarListadorProcessos({ plataforma: "linux", executar, agora: () => 0 }),
      metricasApp: () => [], sessoes: () => [{ rotulo: "Agente", pid: 50 }], lerSwap: async () => null, pidApp: 1,
    });
    const texto = JSON.stringify(await montar({ cpu: null, memoria: null }));
    expect(texto).not.toContain(SEGREDO);
    expect(texto).toContain("cli");
    expect(texto).not.toContain("/opt");
  });
  it("Windows: powershell com argumentos fixos e a lista sem linha de comando", async () => {
    const executar = vi.fn(async (_b: string, _a: readonly string[], _t: number) => "100,4,2097152,10000000,node.exe\n");
    const lista = await criarListadorProcessos({ plataforma: "win32", executar, agora: () => 1000, raizWindows: "C:\\Windows" })();
    expect(executar.mock.calls[0]![0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(JSON.stringify(executar.mock.calls)).not.toMatch(/CommandLine/i);
    expect(lista[0]).toMatchObject({ pid: 100, nome: "node", rssKb: 2048 });
  });
});
