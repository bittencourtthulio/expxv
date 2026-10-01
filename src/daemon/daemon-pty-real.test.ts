// E2E do protocolo com node-pty REAL e a CLI falsa (eco, resize, SIGINT) e a prova de que a sessão
// sobrevive ao app: desanexar, "reabrir" com outro cliente e recuperar a saída acumulada.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventoTerminal } from "../compartilhado/terminais";
import { AdaptadorNodePty, nodePtyDisponivel } from "../nucleo/terminais/adaptador-node-pty";
import { GerenciadorSessoes } from "../nucleo/terminais/sessoes";
import { ClienteDaemon } from "./cliente";
import { iniciarServidor, type ServidorDaemon } from "./servidor";

const FIXTURE = resolve(__dirname, "../../tests/fixtures/cli-pty.mjs");
const EXE = { ferramenta_id: "personalizado", caminho: process.execPath, modo_lancamento: "direto" as const };
const PEDIDO = { versao: 1, ferramenta_id: "personalizado", executavel_id: "exe_x", argumentos: [FIXTURE], colunas: 80, linhas: 24, workspace_id: null };

const limpeza: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (limpeza.length > 0) await limpeza.pop()?.(); });

async function ambiente() {
  const dir = mkdtempSync(join(tmpdir(), "dmn-real-"));
  const socket = join(mkdtempSync(join(tmpdir(), "sk-")), "d.sock");
  const servidor: ServidorDaemon = await iniciarServidor({ dir, socket, token: "segredo", adaptador: new AdaptadorNodePty() });
  limpeza.push(() => servidor.fechar());
  const novoGerenciador = async () => {
    const cliente = new ClienteDaemon({ socket, token: "segredo", intervaloMs: 10, tentativas: 50 });
    limpeza.push(() => cliente.fechar());
    expect(await cliente.pronto).toBe(true);
    const g = new GerenciadorSessoes({ resolverCwd: () => process.cwd(), janela_id: 1, geracao: 1, adaptador: cliente, registro: { obter: () => ({ ...EXE }) } });
    const eventos: EventoTerminal[] = [];
    g.assinar((e) => eventos.push(e));
    const texto = (id: string) => eventos.flatMap((e) => (e.tipo === "saida" && e.sessao_id === id ? [e.dados] : [])).join("");
    const esperar = async (id: string, alvo: string): Promise<void> => {
      for (let i = 0; i < 1500 && !texto(id).includes(alvo); i++) await new Promise((r) => setTimeout(r, 20));
      if (!texto(id).includes(alvo)) throw new Error(`não apareceu ${alvo}: ${JSON.stringify(texto(id).slice(-300))}`);
    };
    return { g, cliente, eventos, texto, esperar };
  };
  return { novoGerenciador };
}

describe.skipIf(!nodePtyDisponivel())("daemon com node-pty real", () => {
  it("eco, resize e SIGINT passam pelo daemon", async () => {
    const { novoGerenciador } = await ambiente();
    const { g, esperar, texto } = await novoGerenciador();
    const { sessao_id } = g.abrir(PEDIDO);
    await esperar(sessao_id, "pty> ");
    g.escrever(sessao_id, "ola\r");
    await esperar(sessao_id, "eco:ola");
    g.redimensionar(sessao_id, 100, 30);
    // o filho só vê o novo tamanho quando trata o SIGWINCH; sob carga isso pode vir DEPOIS da primeira pergunta.
    // Pergunta de novo até a resposta refletir o resize (a correção é "o resize chega", não "chega antes da linha seguinte").
    for (let i = 0; i < 100 && !texto(sessao_id).includes("tamanho:100x30"); i++) {
      g.escrever(sessao_id, "tamanho\r");
      await new Promise((r) => setTimeout(r, 200));
    }
    await esperar(sessao_id, "tamanho:100x30");
    g.interromper(sessao_id);
    await esperar(sessao_id, "interrompido");
    for (let i = 0; i < 1000 && g.obter(sessao_id)?.estado !== "encerrada"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(g.obter(sessao_id)?.estado).toBe("encerrada");
  }, 60_000);

  it("a sessão sobrevive ao app: desanexar, reabrir com outro cliente, recuperar a saída sem duplicar e continuar digitando", async () => {
    const { novoGerenciador } = await ambiente();
    const primeiro = await novoGerenciador();
    const { sessao_id } = primeiro.g.abrir(PEDIDO);
    await primeiro.esperar(sessao_id, "pty> ");
    primeiro.g.escrever(sessao_id, "antes\r");
    await primeiro.esperar(sessao_id, "eco:antes");
    // o app fecha: larga as sessões sem matar e fecha a conexão
    primeiro.g.desanexar();
    await primeiro.cliente.fechar();

    // o app reabre
    const segundo = await novoGerenciador();
    const recuperadas = await segundo.g.recuperar();
    expect(recuperadas.map((r) => [r.sessao_id, r.estado, r.persistente])).toEqual([[sessao_id, "executando", true]]);
    const reidratado = segundo.texto(sessao_id);
    expect(reidratado).toContain("eco:antes");
    expect(reidratado.match(/eco:antes/g)).toHaveLength(1);
    segundo.g.escrever(sessao_id, "depois\r");
    await segundo.esperar(sessao_id, "eco:depois");
    expect(segundo.texto(sessao_id).match(/eco:antes/g)).toHaveLength(1);
    segundo.g.escrever(sessao_id, "sair 0\r");
    for (let i = 0; i < 200 && segundo.g.obter(sessao_id)?.estado !== "encerrada"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(segundo.g.obter(sessao_id)?.estado).toBe("encerrada");
    expect(segundo.g.descartar(sessao_id)).toBe(true);
    expect(await segundo.cliente.listar()).toEqual([]);
  });

  it("flood de saída pelo daemon chega inteiro, com backpressure e sequência contígua", async () => {
    const { novoGerenciador } = await ambiente();
    const { g, esperar, eventos, texto } = await novoGerenciador();
    const { sessao_id } = g.abrir(PEDIDO);
    await esperar(sessao_id, "pty> ");
    g.escrever(sessao_id, "flood 2000000\r");
    // o renderer de mentira confirma o consumo conforme a saída chega
    const confirmar = setInterval(() => {
      const bytes = eventos.filter((e): e is Extract<EventoTerminal, { tipo: "saida" }> => e.tipo === "saida").reduce((s, e) => s + Buffer.byteLength(e.dados), 0);
      g.confirmarConsumo(sessao_id, bytes);
    }, 5);
    try { await esperar(sessao_id, "flood-fim"); } finally { clearInterval(confirmar); }
    expect(texto(sessao_id).length).toBeGreaterThan(2_000_000);
    const seqs = eventos.filter((e) => e.sessao_id === sessao_id).map((e) => e.sequencia);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    g.encerrar(sessao_id);
  });
});
