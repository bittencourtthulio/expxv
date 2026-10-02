import { describe, expect, it } from "vitest";
import { ARGUMENTOS_POWERSHELL, ARGUMENTOS_PS, arvoreDe, converterCpuWindows, nomeBase, parsearListaWindows, parsearPs, resumirAgentes, topPor } from "./processos";

describe("nomeBase (nunca caminho)", () => {
  it("tira diretórios, .exe, controle e limita o tamanho", () => {
    expect(nomeBase("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")).toBe("Google Chrome");
    expect(nomeBase("C:\\Users\\ana\\segredo\\node.exe")).toBe("node");
    expect(nomeBase("bash\u0007\n")).toBe("bash");
    expect(nomeBase("x".repeat(100))).toHaveLength(40);
    expect(nomeBase("/")).toBe("?");
    // se uma linha trouxesse argumentos, eles saem (o segredo nunca chega ao dado)
    expect(nomeBase("/usr/local/bin/tool --token=sk-segredo --senha abc")).toBe("tool");
    expect(nomeBase("/opt/x/agente API_KEY=sk-segredo")).toBe("agente");
    expect(nomeBase("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)")).toBe("Google Chrome Helper (Renderer)");
  });
});

const PS = `    1     0   8816   0.3 /sbin/launchd
  500     1  20000   2.5 /Applications/Foo Bar.app/Contents/MacOS/Foo Bar
  600   500  30000  10,5 /usr/local/bin/node
  700   600  40000  50.0 claude
  900     1   1000   0.0 /usr/bin/ssh
linha quebrada
`;
describe("ps", () => {
  it("pede só pid, ppid, rss, pcpu e comm (nunca args/command), sem shell", () => {
    expect(ARGUMENTOS_PS).toEqual(["-axo", "pid=,ppid=,rss=,pcpu=,comm="]);
    expect(ARGUMENTOS_PS.join(" ")).not.toMatch(/args|command|\bcmd\b/);
    expect(ARGUMENTOS_POWERSHELL.join(" ")).not.toMatch(/CommandLine/i);
  });
  it("parseia nomes com espaço, vírgula decimal e ignora linha inválida", () => {
    const l = parsearPs(PS);
    expect(l.map((p) => p.nome)).toEqual(["launchd", "Foo Bar", "node", "claude", "ssh"]);
    expect(l[2]).toMatchObject({ pid: 600, ppid: 500, rssKb: 30000, cpu: 10.5 });
  });
  it("árvore: raízes e descendentes, sem laço com ppid cíclico", () => {
    const l = parsearPs(PS);
    expect([...arvoreDe(l, [500]).keys()].sort()).toEqual([500, 600, 700]);
    const ciclo = [{ pid: 1, ppid: 2, rssKb: 0, cpu: 0, nome: "a" }, { pid: 2, ppid: 1, rssKb: 0, cpu: 0, nome: "b" }];
    expect(arvoreDe(ciclo, [1]).size).toBe(2);
  });
  it("resumo por sessão soma CPU e RSS da árvore e acha o pai comum (daemon)", () => {
    const l = parsearPs(`10 1 1000 1.0 daemon\n20 10 2048 10.0 claude\n21 20 4096 5.0 node\n30 10 1024 2.0 codex\n99 1 9999 80.0 outro\n`);
    const r = resumirAgentes(l, [{ rotulo: "Claude Code", pid: 20 }, { rotulo: "Codex", pid: 30 }]);
    expect(r.agentes.sessoes).toEqual([{ rotulo: "Claude Code", processos: 2, cpu: 15, mem_mb: 6 }, { rotulo: "Codex", processos: 1, cpu: 2, mem_mb: 1 }]);
    expect(r.agentes.cpu).toBe(17);
    expect(r.paiComum).toBe(10);
    expect(r.processos.map((p) => p.nome).sort()).toEqual(["claude", "codex", "node"]);
  });
  it("top 5 por CPU e por memória", () => {
    const l = Array.from({ length: 8 }, (_, i) => ({ nome: `p${i}`, origem: "app" as const, sessao: null, cpu: i, mem_mb: 100 - i }));
    expect(topPor(l, "cpu").map((p) => p.nome)).toEqual(["p7", "p6", "p5", "p4", "p3"]);
    expect(topPor(l, "mem_mb").map((p) => p.nome)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});

describe("Windows", () => {
  it("parseia a lista e converte tempo de CPU em % por delta", () => {
    const a = parsearListaWindows("4,0,1048576,0,System\n100,4,2097152,10000000,node.exe\nlixo\n");
    expect(a.map((p) => p.nome)).toEqual(["System", "node"]);
    const b = parsearListaWindows("100,4,2097152,15000000,node.exe\n");
    const r = converterCpuWindows(new Map(a.map((p) => [p.pid, p.tempo100ns])), b, 1000);
    expect(Math.round(r[0]!.cpu)).toBe(50); // 5 000 000 × 100 ns = 0,5 s em 1 s
    expect(converterCpuWindows(null, b, 1000)[0]!.cpu).toBe(0);
  });
});
