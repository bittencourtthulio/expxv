// Testes com PTY REAL (node-pty) e a CLI falsa tests/fixtures/cli-pty.mjs. Rodam no vitest normal quando
// o node-pty carrega no Node do sistema; senão ficam pulados (a via Electron está em
// tests/terminais-electron.cjs).
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptadorNodePty, nodePtyDisponivel } from "./adaptador-node-pty";
import { ambienteSeguro } from "./ambiente";
import { GerenciadorSessoes, type ProcessoPty } from "./sessoes";
import type { EventoTerminal } from "../../compartilhado/terminais";

const FIXTURE = resolve(__dirname, "../../../tests/fixtures/cli-pty.mjs");
const EXE = { ferramenta_id: "personalizado", caminho: process.execPath, modo_lancamento: "direto" as const };
const disponivel = nodePtyDisponivel();

// Tetos de ESPERA, não de latência: só impedem o teste de pendurar se algo travar de verdade. Sob carga (máquina com
// dezenas de processos) um PTY real leva segundos para responder; o que o teste prova é o resultado, não a rapidez.
const TETO_MS = 30_000;
const TETO_FLOOD_MS = 60_000;

const abertos: ProcessoPty[] = [];
afterEach(() => { while (abertos.length > 0) abertos.pop()?.kill("SIGKILL"); });

function iniciar(colunas = 80, linhas = 24): { proc: ProcessoPty; saida: () => string; esperar: (texto: string | RegExp, ms?: number) => Promise<void>; saiu: Promise<number> } {
  const proc = new AdaptadorNodePty().spawn(EXE, [FIXTURE], { cwd: process.cwd(), colunas, linhas, env: ambienteSeguro(EXE) });
  abertos.push(proc);
  let texto = "";
  proc.onData((d) => { texto += d; });
  const saiu = new Promise<number>((r) => { proc.onExit((e) => r(e.exitCode)); });
  const esperar = async (alvo: string | RegExp, ms = TETO_MS): Promise<void> => {
    const inicio = Date.now();
    while (!(typeof alvo === "string" ? texto.includes(alvo) : alvo.test(texto))) {
      if (Date.now() - inicio > ms) throw new Error(`não apareceu ${String(alvo)}; saída: ${JSON.stringify(texto.slice(-300))}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  return { proc, saida: () => texto, esperar, saiu };
}

/**
 * `resize` + `write` imediato é uma corrida do próprio SO: o SIGWINCH chega ao processo de forma assíncrona e a CLI pode
 * ler `columns/rows` antes dele (a linha seguinte ainda vem com o tamanho antigo). O que se prova aqui é que o novo tamanho
 * CHEGA ao processo: pergunta de novo até a resposta mais recente ser o tamanho esperado (teto TETO_MS; nunca passa sem isso).
 */
async function esperarTamanho(escrever: (t: string) => void, texto: () => string, esperado: string): Promise<void> {
  const inicio = Date.now();
  for (;;) {
    escrever("tamanho\r");
    const base = texto().length;
    const ate = Date.now() + 1_500;
    while (Date.now() < ate && !/tamanho:\d+x\d+/.test(texto().slice(base))) await new Promise((r) => setTimeout(r, 15));
    const respostas = texto().slice(base).match(/tamanho:\d+x\d+/g) ?? [];
    if (respostas.at(-1) === `tamanho:${esperado}`) return;
    if (Date.now() - inicio > TETO_MS) throw new Error(`o processo nunca viu o tamanho ${esperado}; saída: ${JSON.stringify(texto().slice(-300))}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!disponivel)("node-pty real + cli-pty.mjs", { timeout: 90_000 }, () => {
  it("eco: o que se digita volta", async () => {
    const { proc, esperar } = iniciar();
    await esperar("pty> ");
    proc.write("ola mundo\r");
    await esperar("eco:ola mundo");
  });

  it("resize propaga para o processo (colunas x linhas)", async () => {
    const { proc, esperar, saida } = iniciar(80, 24);
    await esperar("pty> ");
    await esperarTamanho((t) => proc.write(t), saida, "80x24");
    proc.resize(132, 43);
    await esperarTamanho((t) => proc.write(t), saida, "132x43");
  });

  it("SIGINT (Ctrl+C) chega ao processo", async () => {
    const { proc, esperar, saiu } = iniciar();
    await esperar("pty> ");
    proc.write("\x03");
    await esperar("interrompido");
    expect(await saiu).toBe(0);
  });

  it("kill encerra a árvore e o onExit dispara", async () => {
    const { proc, esperar, saiu } = iniciar();
    await esperar("pty> ");
    proc.kill();
    const codigo = await Promise.race([saiu, new Promise<string>((r) => setTimeout(() => r("demorou"), TETO_MS))]);
    expect(codigo).not.toBe("demorou");
  });

  it("flood com pausa/retomada: o volume chega inteiro e o processo termina", async () => {
    const { proc, saida, esperar } = iniciar();
    await esperar("pty> ");
    proc.write("flood 3000000\r");
    await esperar("flood-fim", TETO_FLOOD_MS);
    expect(saida().length).toBeGreaterThan(3_000_000);
  });

  it("GerenciadorSessoes de ponta a ponta: abrir, eco com sequência crescente, redimensionar, interromper e encerrar", async () => {
    const eventos: EventoTerminal[] = [];
    const g = new GerenciadorSessoes({
      resolverCwd: () => process.cwd(), janela_id: 1, geracao: 1, adaptador: new AdaptadorNodePty(),
      registro: { obter: () => ({ ...EXE }) },
    });
    g.assinar((e) => eventos.push(e));
    const { sessao_id } = g.abrir({ versao: 1, ferramenta_id: "personalizado", executavel_id: "exe_x", argumentos: [FIXTURE], colunas: 80, linhas: 24, workspace_id: null });
    const texto = () => eventos.flatMap((e) => (e.tipo === "saida" ? [e.dados] : [])).join("");
    const esperar = async (alvo: string): Promise<void> => {
      for (let i = 0; i < TETO_MS / 20 && !texto().includes(alvo); i++) await new Promise((r) => setTimeout(r, 20));
      if (!texto().includes(alvo)) throw new Error(`não apareceu ${alvo}: ${JSON.stringify(texto())}`);
    };
    await esperar("pty> ");
    g.escrever(sessao_id, "abc\r");
    await esperar("eco:abc");
    g.redimensionar(sessao_id, 100, 30);
    await esperarTamanho((t) => g.escrever(sessao_id, t), texto, "100x30"); // SIGWINCH assíncrono: ver esperarTamanho
    expect(g.interromper(sessao_id)).toBe(true); // ferramenta "personalizado" => Ctrl+C
    await esperar("interrompido");
    for (let i = 0; i < TETO_MS / 20 && g.obter(sessao_id)?.estado !== "encerrada"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(g.obter(sessao_id)?.estado).toBe("encerrada");
    const seqs = eventos.map((e) => e.sequencia);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });
});
