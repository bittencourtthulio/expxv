import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdaptadorPty, ProcessoPty } from "../nucleo/terminais/lancamento";
import { iniciarServidor, type ServidorDaemon } from "./servidor";
import { ClienteDaemon } from "./cliente";
import type { MetaSessao } from "./protocolo";

class PtyFalso implements ProcessoPty {
  pid = 900;
  escrito: string[] = [];
  tamanhos: Array<[number, number]> = [];
  mortos: Array<string | undefined> = [];
  pausas: string[] = [];
  #dados = new Set<(d: string) => void>();
  #saidas = new Set<(e: { exitCode: number; signal?: number | undefined }) => void>();
  onData(fn: (d: string) => void) { this.#dados.add(fn); return { dispose: () => this.#dados.delete(fn) }; }
  onExit(fn: (e: { exitCode: number; signal?: number | undefined }) => void) { this.#saidas.add(fn); return { dispose: () => this.#saidas.delete(fn) }; }
  write(d: string) { this.escrito.push(d); }
  resize(c: number, l: number) { this.tamanhos.push([c, l]); }
  pause() { this.pausas.push("pause"); }
  resume() { this.pausas.push("resume"); }
  kill(sinal?: string) { this.mortos.push(sinal); }
  emitir(d: string) { this.#dados.forEach((fn) => fn(d)); }
  sair(codigo = 0) { this.#saidas.forEach((fn) => fn({ exitCode: codigo })); }
}
class AdaptadorFalso implements AdaptadorPty {
  criados: PtyFalso[] = [];
  spawn() { const p = new PtyFalso(); this.criados.push(p); return p; }
}

const META: MetaSessao = { ferramenta_id: "terminal", executavel_id: "exe_1", argumentos: ["a"], raiz: "/x", workspace_id: null, colunas: 80, linhas: 24, criada_em: 1 };
const EXE = { ferramenta_id: "terminal", caminho: "/bin/sh", modo_lancamento: "direto" } as const;
const OPC = { cwd: "/x", colunas: 80, linhas: 24, env: {}, meta: META };

const abertos: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (abertos.length > 0) await abertos.pop()?.(); });

function caminhos() {
  return { dir: mkdtempSync(join(tmpdir(), "dmn-")), socket: join(mkdtempSync(join(tmpdir(), "sk-")), "d.sock") };
}
async function servidor(c: { dir: string; socket: string }, adaptador = new AdaptadorFalso(), extra: { token?: string; protocolo?: number } = {}): Promise<{ adaptador: AdaptadorFalso; servidor: ServidorDaemon }> {
  const s = await iniciarServidor({ ...c, token: extra.token ?? "segredo", adaptador, ...(extra.protocolo === undefined ? {} : { protocolo: extra.protocolo }) });
  abertos.push(() => s.fechar());
  return { adaptador, servidor: s };
}
function cliente(socket: string, extra: Partial<ConstructorParameters<typeof ClienteDaemon>[0]> = {}): ClienteDaemon {
  const c = new ClienteDaemon({ socket, token: "segredo", intervaloMs: 10, tentativas: 30, ...extra });
  abertos.push(() => c.fechar());
  return c;
}
/** Ponte entre cliente e daemon: `derrubar()` corta só as conexões (o daemon e as sessões seguem vivos). */
async function criarPonte(destino: string): Promise<{ caminho: string; derrubar(): void }> {
  const { createServer, connect } = await import("node:net");
  const caminho = join(mkdtempSync(join(tmpdir(), "pt-")), "p.sock");
  const pares = new Set<{ destroy(): void }>();
  const srv = createServer((entrada) => {
    const saida = connect(destino);
    pares.add(entrada); pares.add(saida);
    entrada.pipe(saida); saida.pipe(entrada);
    entrada.on("error", () => saida.destroy()); saida.on("error", () => entrada.destroy());
    entrada.on("close", () => saida.destroy()); saida.on("close", () => entrada.destroy());
  });
  await new Promise<void>((r) => srv.listen(caminho, r));
  abertos.push(() => { for (const p of pares) p.destroy(); srv.close(); });
  return { caminho, derrubar: () => { for (const p of pares) p.destroy(); pares.clear(); } };
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate(cond: () => boolean): Promise<void> { for (let i = 0; i < 300 && !cond(); i++) await espera(10); if (!cond()) throw new Error("condição não ocorreu"); }

describe("daemon de PTY: cliente", () => {
  it("cria a sessão, entrega a saída com o total acumulado e repassa teclado, tamanho e kill", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const cli = cliente(c.socket);
    expect(await cli.pronto).toBe(true);
    const proc = cli.spawn(EXE, ["--x"], { ...OPC, sessao_id: "sessao_a" });
    const recebido: Array<[string, number | undefined]> = [];
    proc.onData((d, fim) => recebido.push([d, fim]));
    await ate(() => adaptador.criados.length === 1);
    adaptador.criados[0]?.emitir("oi");
    await ate(() => recebido.length === 1);
    expect(recebido).toEqual([["oi", 2]]);
    proc.write("ls\r");
    proc.resize(100, 30);
    proc.kill("SIGTERM");
    await ate(() => adaptador.criados[0]?.mortos.length === 1);
    expect(adaptador.criados[0]?.escrito).toEqual(["ls\r"]);
    expect(adaptador.criados[0]?.tamanhos).toEqual([[100, 30]]);
    expect(adaptador.criados[0]?.mortos).toEqual(["SIGTERM"]);
  });

  it("avisa o encerramento do processo", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const cli = cliente(c.socket);
    const proc = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    let saida: number | null = null;
    proc.onExit(({ exitCode }) => { saida = exitCode; });
    await ate(() => adaptador.criados.length === 1);
    adaptador.criados[0]?.sair(7);
    await ate(() => saida !== null);
    expect(saida).toBe(7);
  });

  it("sobe o daemon quando o socket não existe e usa os pedidos enfileirados na ordem", async () => {
    const c = caminhos();
    const adaptador = new AdaptadorFalso();
    let subidas = 0;
    const cli = cliente(c.socket, { iniciarDaemon: () => { subidas += 1; void servidor(c, adaptador); } });
    const proc = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    proc.write("primeiro");
    expect(await cli.pronto).toBe(true);
    await ate(() => adaptador.criados[0]?.escrito.length === 1);
    expect(subidas).toBe(1);
    expect(adaptador.criados[0]?.escrito).toEqual(["primeiro"]);
  });

  it("sessão criada por um cliente é listada, anexada e recuperada com o histórico por outro cliente", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const primeiro = cliente(c.socket);
    primeiro.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    await ate(() => adaptador.criados.length === 1);
    adaptador.criados[0]?.emitir("antes do app fechar");
    await primeiro.fechar();

    adaptador.criados[0]?.emitir(" e depois");
    const segundo = cliente(c.socket);
    expect(await segundo.listar()).toMatchObject([{ sessao_id: "sessao_a", estado: "executando", argumentos: ["a"], raiz: "/x" }]);
    const proc = segundo.anexar("sessao_a");
    const aoVivo: string[] = [];
    proc.onData((d) => aoVivo.push(d));
    const hist = await segundo.historico("sessao_a");
    expect(hist.dados).toBe("antes do app fechar e depois");
    adaptador.criados[0]?.emitir("!");
    await ate(() => aoVivo.length === 1);
    expect(aoVivo).toEqual(["!"]);
  });

  it("recuperar (anexar + histórico + fim) não duplica: o que chega ao vivo com fim <= histórico é descartável", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const primeiro = cliente(c.socket);
    primeiro.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    await ate(() => adaptador.criados.length === 1);
    adaptador.criados[0]?.emitir("abc");
    await primeiro.fechar();
    const segundo = cliente(c.socket);
    const proc = segundo.anexar("sessao_a");
    const vivo: Array<[string, number | undefined]> = [];
    proc.onData((d, fim) => vivo.push([d, fim]));
    await segundo.listar(); // round-trip: o `anexar` já foi processado pelo daemon
    adaptador.criados[0]?.emitir("def");
    const hist = await segundo.historico("sessao_a");
    await ate(() => vivo.length >= 1);
    // `fim` do pedaço ao vivo é o total depois dele: quem recupera descarta os com fim <= hist.fim
    const novos = vivo.filter(([, fim]) => fim === undefined || fim > hist.fim).map(([d]) => d);
    expect(hist).toEqual({ dados: "abcdef", fim: 6 });
    expect(novos).toEqual([]);
  });

  it("soltar para de entregar saída sem matar o processo; descartar apaga a sessão", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const cli = cliente(c.socket);
    const proc = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    const recebido: string[] = [];
    proc.onData((d) => recebido.push(d));
    await ate(() => adaptador.criados.length === 1);
    cli.soltar("sessao_a");
    await cli.listar();
    adaptador.criados[0]?.emitir("ninguém ouve");
    await espera(40);
    expect(recebido).toEqual([]);
    expect(adaptador.criados[0]?.mortos).toEqual([]);
    cli.descartar("sessao_a");
    await ate(() => adaptador.criados[0]?.mortos.length === 1);
    expect(await cli.listar()).toEqual([]);
  });

  it("token recusado: estado falhou e o spawn cai no adaptador de reserva", async () => {
    const c = caminhos();
    await servidor(c, new AdaptadorFalso(), { token: "outro" });
    const reserva = new AdaptadorFalso();
    const cli = cliente(c.socket, { reserva });
    expect(await cli.pronto).toBe(false);
    expect(cli.estado).toBe("falhou");
    expect(cli.persistente).toBe(false);
    cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    expect(reserva.criados).toHaveLength(1);
    await expect(cli.listar()).rejects.toThrow(/indisponível/); // indisponível não é "sem sessões" (AUD-10)
  });

  it("daemon de outra versão do protocolo não é reaproveitado: o cliente cai na reserva", async () => {
    const c = caminhos();
    const velho = await servidor(c, new AdaptadorFalso(), { protocolo: 0 });
    const reserva = new AdaptadorFalso();
    const cli = cliente(c.socket, { reserva });
    expect(await cli.pronto).toBe(false);
    cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    expect(reserva.criados).toHaveLength(1);
    expect(velho.adaptador.criados).toHaveLength(0); // nada foi criado no daemon antigo
  });

  it("sem daemon e sem como subi-lo: falha depois das tentativas", async () => {
    const c = caminhos();
    const cli = cliente(c.socket, { tentativas: 3 });
    expect(await cli.pronto).toBe(false);
  });

  it("o daemon não sobe: a sessão pedida durante a espera nasce na reserva, com teclado e tamanho repetidos", async () => {
    const c = caminhos();
    const reserva = new AdaptadorFalso();
    let tentativasDeSubir = 0;
    const cli = cliente(c.socket, { tentativas: 3, reserva, iniciarDaemon: () => { tentativasDeSubir += 1; } });
    expect(cli.persistente).toBe(true); // ainda conectando
    const proc = cli.spawn(EXE, ["--x"], { ...OPC, sessao_id: "sessao_a" });
    const recebido: string[] = [];
    let saida: number | null = null;
    proc.onData((d) => recebido.push(d));
    proc.onExit(({ exitCode }) => { saida = exitCode; });
    proc.write("primeiro\r");
    proc.resize(120, 40);
    expect(await cli.pronto).toBe(false);
    expect(tentativasDeSubir).toBe(1);
    expect(reserva.criados).toHaveLength(1);
    expect(reserva.criados[0]?.escrito).toEqual(["primeiro\r"]);
    expect(reserva.criados[0]?.tamanhos).toEqual([[120, 40]]);
    // depois da adoção, o processo da reserva responde direto
    proc.write("segundo\r");
    reserva.criados[0]?.emitir("saida da reserva");
    reserva.criados[0]?.sair(4);
    expect(reserva.criados[0]?.escrito).toEqual(["primeiro\r", "segundo\r"]);
    expect(recebido).toEqual(["saida da reserva"]);
    expect(saida).toBe(4);
    expect(cli.persistente).toBe(false);
  });

  it("sem reserva e sem daemon, a sessão pedida durante a espera termina com erro em vez de ficar pendurada", async () => {
    const c = caminhos();
    const cli = cliente(c.socket, { tentativas: 2 });
    const proc = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    let saida: number | null = null;
    proc.onExit(({ exitCode }) => { saida = exitCode; });
    await cli.pronto;
    expect(saida).toBe(-1);
  });

  it("queda do daemon que não volta derruba as sessões anexadas como erro, depois das tentativas", async () => {
    const c = caminhos();
    const { servidor: s } = await servidor(c);
    const estados: string[] = [];
    const cli = cliente(c.socket, { religar: { tentativas: 2, base_ms: 10, teto_ms: 20 }, aoMudarEstado: (e) => estados.push(e) });
    const proc = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    let saida: number | null = null;
    proc.onExit(({ exitCode }) => { saida = exitCode; });
    await cli.listar();
    await s.fechar();
    await ate(() => saida !== null);
    expect(saida).toBe(-1);
    expect(cli.estado).toBe("falhou");
    expect(estados).toEqual(["conectado", "reconectando", "falhou"]);
  });

  it("AUD-09: conexão cai com o daemon vivo: religa, reanexa a sessão que existe, preenche a saída perdida e segue", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const ponte = await criarPonte(c.socket);
    const estados: string[] = [];
    const cli = cliente(ponte.caminho, { religar: { base_ms: 10, teto_ms: 20 }, aoMudarEstado: (e) => estados.push(e) });
    const proc = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    const recebido: string[] = [];
    let saida: number | null = null;
    proc.onData((d) => recebido.push(d));
    proc.onExit(({ exitCode }) => { saida = exitCode; });
    await ate(() => adaptador.criados.length === 1);
    adaptador.criados[0]?.emitir("antes|");
    await ate(() => recebido.join("") === "antes|");
    ponte.derrubar();
    adaptador.criados[0]?.emitir("durante|"); // sai enquanto o cliente está sem conexão
    await ate(() => estados.includes("reconectando") && cli.estado === "conectado");
    await ate(() => recebido.join("") === "antes|durante|");
    adaptador.criados[0]?.emitir("depois");
    await ate(() => recebido.join("") === "antes|durante|depois");
    proc.write("teclado");
    await ate(() => adaptador.criados[0]?.escrito.includes("teclado") === true);
    expect(saida).toBeNull(); // a sessão NUNCA foi dada como morta
    expect(estados).toEqual(["conectado", "reconectando", "conectado"]);
  });

  it("AUD-09: daemon morre e volta (um novo sobe): só a sessão que não existe mais é dada como encerrada; sessões novas funcionam", async () => {
    const c = caminhos();
    const { servidor: antigo } = await servidor(c);
    const novoAdaptador = new AdaptadorFalso();
    let subidas = 0;
    const cli = cliente(c.socket, {
      religar: { base_ms: 10, teto_ms: 20 },
      iniciarDaemon: () => { subidas += 1; void iniciarServidor({ ...c, token: "segredo", adaptador: novoAdaptador }).then((s) => abertos.push(() => s.fechar())); },
    });
    const velha = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_velha" });
    let saidaVelha: number | null = null;
    velha.onExit(({ exitCode }) => { saidaVelha = exitCode; });
    await cli.listar();
    await antigo.fechar(); // o daemon morre (as sessões dele vão junto)
    await ate(() => saidaVelha !== null); // depois de religar e conferir: a sessão não existe mais
    expect(saidaVelha).toBe(-1);
    expect(cli.estado).toBe("conectado");
    expect(subidas).toBe(1); // um daemon novo é pedido uma única vez, ao religar (o inicial já existia)
    const nova = cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_nova" });
    expect(nova.pid).toBeDefined();
    await ate(() => novoAdaptador.criados.length === 1);
    // o daemon novo lembra a sessão antiga do histórico em disco, já sem processo (estado "erro")
    expect(await cli.listar()).toMatchObject([{ sessao_id: "sessao_velha", estado: "erro" }, { sessao_id: "sessao_nova", estado: "executando" }]);
  });

  it("encerrarTudo mata os processos e o daemon sai", async () => {
    const c = caminhos();
    const { adaptador } = await servidor(c);
    const cli = cliente(c.socket);
    cli.spawn(EXE, [], { ...OPC, sessao_id: "sessao_a" });
    await ate(() => adaptador.criados.length === 1);
    await cli.encerrarTudo();
    expect(adaptador.criados[0]?.mortos).toHaveLength(1);
  });

  it("spawn exige id e metadados quando o daemon está de pé", async () => {
    const c = caminhos();
    await servidor(c);
    const cli = cliente(c.socket);
    await cli.pronto;
    expect(() => cli.spawn(EXE, [], { cwd: "/x", colunas: 80, linhas: 24, env: {} })).toThrow(/identificador/);
  });
});
