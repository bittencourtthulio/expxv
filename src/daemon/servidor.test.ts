import { afterEach, describe, expect, it } from "vitest";
import { connect, type Socket } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdaptadorPty, ProcessoPty } from "../nucleo/terminais/lancamento";
import { iniciarServidor, type ServidorDaemon } from "./servidor";
import { PROTOCOLO_DAEMON, separarLinhas, type MensagemDoDaemon, type MetaSessao } from "./protocolo";

class PtyFalso implements ProcessoPty {
  pid = 900;
  escrito: string[] = [];
  pausas: string[] = [];
  mortos: Array<string | undefined> = [];
  #dados = new Set<(d: string) => void>();
  #saidas = new Set<(e: { exitCode: number; signal?: number | undefined }) => void>();
  onData(fn: (d: string) => void) { this.#dados.add(fn); return { dispose: () => this.#dados.delete(fn) }; }
  onExit(fn: (e: { exitCode: number; signal?: number | undefined }) => void) { this.#saidas.add(fn); return { dispose: () => this.#saidas.delete(fn) }; }
  write(d: string) { this.escrito.push(d); }
  resize() { /* sem efeito */ }
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

const META: MetaSessao = { ferramenta_id: "terminal", executavel_id: "exe_1", argumentos: [], raiz: "/x", workspace_id: "ws_1", colunas: 80, linhas: 24, criada_em: 1 };
const EXE = { ferramenta_id: "terminal", caminho: "/bin/sh", modo_lancamento: "direto" } as const;

class Cliente {
  mensagens: MensagemDoDaemon[] = [];
  #n = 0;
  #resto = "";
  constructor(readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (pedaco: string) => {
      const { linhas, resto } = separarLinhas(this.#resto, pedaco);
      this.#resto = resto;
      for (const l of linhas) this.mensagens.push(JSON.parse(l) as MensagemDoDaemon);
    });
  }
  enviar(pedido: Record<string, unknown>): number { const n = ++this.#n; this.socket.write(`${JSON.stringify({ ...pedido, n })}\n`); return n; }
  async pedir(pedido: Record<string, unknown>): Promise<Record<string, unknown>> {
    const n = this.enviar(pedido);
    return this.esperar((m) => "re" in m && m.re === n) as Promise<Record<string, unknown>>;
  }
  async esperar(cond: (m: MensagemDoDaemon) => boolean): Promise<MensagemDoDaemon> {
    for (let i = 0; i < 200; i++) {
      const achada = this.mensagens.find(cond);
      if (achada !== undefined) return achada;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`mensagem não chegou: ${JSON.stringify(this.mensagens)}`);
  }
}

const abertos: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (abertos.length > 0) await abertos.pop()?.(); });

async function subir(opcoes: { limite?: number; dir?: string; ociosoMs?: number; protocolo?: number; aoEncerrar?: () => void } = {}) {
  const dir = opcoes.dir ?? mkdtempSync(join(tmpdir(), "dmn-"));
  const socket = join(mkdtempSync(join(tmpdir(), "sk-")), "d.sock");
  const adaptador = new AdaptadorFalso();
  const servidor: ServidorDaemon = await iniciarServidor({ dir, socket, token: "segredo", adaptador, ...opcoes });
  abertos.push(async () => { await servidor.fechar(); });
  return { dir, socket, adaptador, servidor };
}

async function conectar(socket: string, token = "segredo"): Promise<Cliente> {
  const s = connect(socket);
  await new Promise<void>((ok, erro) => { s.once("connect", () => ok()); s.once("error", erro); });
  abertos.push(() => { s.destroy(); });
  const c = new Cliente(s);
  const r = await c.pedir({ op: "ola", protocolo: PROTOCOLO_DAEMON, token });
  if (r["ok"] !== true) throw new Error(String(r["erro"]));
  return c;
}

const criar = (c: Cliente, id: string) => c.pedir({ op: "criar", id, executavel: EXE, argumentos: [], cwd: "/x", colunas: 80, linhas: 24, env: {}, meta: META });

describe("daemon de PTY: servidor", () => {
  it("recusa conexão sem o token certo", async () => {
    const { socket } = await subir();
    await expect(conectar(socket, "errado")).rejects.toThrow(/token/i);
  });

  it("derruba quem fala antes do `ola`", async () => {
    const { socket } = await subir();
    const s = connect(socket);
    await new Promise<void>((ok) => s.once("connect", () => ok()));
    s.write(`${JSON.stringify({ op: "listar", n: 1 })}\n`);
    const fechou = await new Promise<boolean>((r) => { s.once("close", () => r(true)); setTimeout(() => r(false), 1_000); });
    expect(fechou).toBe(true);
  });

  it("um segundo daemon no mesmo socket não toma o lugar do primeiro", async () => {
    const { socket, dir } = await subir();
    await expect(iniciarServidor({ dir, socket, token: "segredo", adaptador: new AdaptadorFalso() })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(await conectar(socket)).toBeDefined();
  });

  it("recusa protocolo de outra versão (daemon de outra versão não é reaproveitado)", async () => {
    const { socket } = await subir();
    const s = connect(socket);
    await new Promise<void>((ok) => s.once("connect", () => ok()));
    abertos.push(() => { s.destroy(); });
    const c = new Cliente(s);
    const r = await c.pedir({ op: "ola", protocolo: 999, token: "segredo" });
    expect(r["ok"]).toBe(false);
    expect(String(r["erro"])).toMatch(/incompatível/);
  });

  it("um daemon que fala outro protocolo recusa o cliente atual", async () => {
    const { socket } = await subir({ protocolo: PROTOCOLO_DAEMON + 1 });
    await expect(conectar(socket)).rejects.toThrow(/incompatível/);
  });

  it("cria a sessão, guarda a saída e entrega ao cliente com o total acumulado", async () => {
    const { socket, adaptador } = await subir();
    const c = await conectar(socket);
    expect((await criar(c, "sessao_a"))["ok"]).toBe(true);
    adaptador.criados[0]?.emitir("ola ");
    adaptador.criados[0]?.emitir("mundo");
    const ultimo = await c.esperar((m) => "ev" in m && m.ev === "dados" && m.fim === 9);
    expect(ultimo).toMatchObject({ id: "sessao_a", dados: "mundo", fim: 9 });
    expect(await c.pedir({ op: "historico", id: "sessao_a" })).toMatchObject({ ok: true, dados: "ola mundo", fim: 9 });
  });

  it("o processo continua vivo e a saída continua sendo guardada sem nenhum cliente", async () => {
    const { socket, adaptador } = await subir();
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    c.socket.destroy();
    await new Promise((r) => setTimeout(r, 30));
    expect(adaptador.criados[0]?.mortos).toEqual([]);
    adaptador.criados[0]?.emitir("durante a ausência");
    const c2 = await conectar(socket);
    const lista = await c2.pedir({ op: "listar" });
    expect(lista["sessoes"]).toMatchObject([{ sessao_id: "sessao_a", estado: "executando", raiz: "/x", workspace_id: "ws_1" }]);
    await c2.pedir({ op: "anexar", id: "sessao_a" });
    expect(await c2.pedir({ op: "historico", id: "sessao_a" })).toMatchObject({ dados: "durante a ausência" });
  });

  it("não deixa o processo travado por causa de um cliente pausado que sumiu", async () => {
    const { socket, adaptador } = await subir();
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    c.enviar({ op: "pausar", id: "sessao_a" });
    await new Promise((r) => setTimeout(r, 30));
    c.socket.destroy();
    await new Promise((r) => setTimeout(r, 30));
    expect(adaptador.criados[0]?.pausas).toEqual(["pause", "resume"]);
  });

  it("limita o histórico ao tamanho configurado, guardando o fim", async () => {
    const { socket, adaptador } = await subir({ limite: 10 });
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    adaptador.criados[0]?.emitir("aaaaaa");
    adaptador.criados[0]?.emitir("bbbbbb");
    adaptador.criados[0]?.emitir("cccccc");
    const h = await c.pedir({ op: "historico", id: "sessao_a" });
    expect(String(h["dados"]).length).toBeLessThanOrEqual(12);
    expect(String(h["dados"]).endsWith("cccccc")).toBe(true);
    expect(h["fim"]).toBe(18);
  });

  it("compacta o log em disco (só a cauda) quando passa de 4x o limite", async () => {
    const { socket, adaptador, dir } = await subir({ limite: 10 });
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    for (let i = 0; i < 20; i++) adaptador.criados[0]?.emitir("0123456789");
    const disco = readFileSync(join(dir, "sessao_a.log"), "utf8");
    expect(disco.length).toBeLessThanOrEqual(10 * 4 + 10);
    expect(disco.endsWith("0123456789")).toBe(true);
  });

  it("registra o encerramento e mantém a sessão listada como encerrada", async () => {
    const { socket, adaptador } = await subir();
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    adaptador.criados[0]?.sair(3);
    expect(await c.esperar((m) => "ev" in m && m.ev === "saiu")).toMatchObject({ id: "sessao_a", codigo: 3 });
    expect((await c.pedir({ op: "listar" }))["sessoes"]).toMatchObject([{ estado: "erro", codigo: 3 }]);
  });

  it("depois que o daemon reinicia, sessão encerrada volta com o histórico e a que estava viva vira interrompida", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmn-"));
    const primeiro = await subir({ dir });
    const c = await conectar(primeiro.socket);
    await criar(c, "sessao_viva");
    await criar(c, "sessao_fim");
    primeiro.adaptador.criados[0]?.emitir("saída da viva");
    primeiro.adaptador.criados[1]?.emitir("saída do fim");
    primeiro.adaptador.criados[1]?.sair(0);
    await c.esperar((m) => "ev" in m && m.ev === "saiu");
    c.socket.destroy();
    await primeiro.servidor.fechar();
    const segundo = await subir({ dir });
    const c2 = await conectar(segundo.socket);
    const lista = (await c2.pedir({ op: "listar" }))["sessoes"] as Array<{ sessao_id: string; estado: string; workspace_id: string | null }>;
    expect(Object.fromEntries(lista.map((s) => [s.sessao_id, s.estado]))).toEqual({ sessao_viva: "erro", sessao_fim: "encerrada" });
    expect(lista[0]?.workspace_id).toBe("ws_1");
    expect(await c2.pedir({ op: "historico", id: "sessao_fim" })).toMatchObject({ dados: "saída do fim" });
    expect(await c2.pedir({ op: "historico", id: "sessao_viva" })).toMatchObject({ dados: "saída da viva" });
  });

  it("retenção: sessão encerrada há mais de 7 dias some do disco ao subir; viva/recente fica", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmn-"));
    const info = (id: string, estado: string) => JSON.stringify({ ...META, sessao_id: id, estado, codigo: 0, sinal: null });
    for (const [id, estado] of [["sessao_velha", "encerrada"], ["sessao_nova", "encerrada"], ["sessao_viva", "executando"]] as const) {
      writeFileSync(join(dir, `${id}.json`), info(id, estado));
      writeFileSync(join(dir, `${id}.log`), "x");
    }
    const velho = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
    const { utimesSync } = await import("node:fs");
    utimesSync(join(dir, "sessao_velha.json"), velho, velho);
    utimesSync(join(dir, "sessao_viva.json"), velho, velho); // viva (interrompida) não expira por idade
    const { socket } = await subir({ dir });
    const c = await conectar(socket);
    const ids = ((await c.pedir({ op: "listar" }))["sessoes"] as Array<{ sessao_id: string }>).map((s) => s.sessao_id).sort();
    expect(ids).toEqual(["sessao_nova", "sessao_viva"]);
    expect(existsSync(join(dir, "sessao_velha.json"))).toBe(false);
    expect(existsSync(join(dir, "sessao_velha.log"))).toBe(false);
  });

  it("descartar mata o processo e apaga os arquivos da sessão", async () => {
    const { socket, adaptador, dir } = await subir();
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    adaptador.criados[0]?.emitir("x");
    expect(existsSync(join(dir, "sessao_a.json"))).toBe(true);
    await c.pedir({ op: "descartar", id: "sessao_a" });
    expect(adaptador.criados[0]?.mortos).toHaveLength(1);
    expect(existsSync(join(dir, "sessao_a.json"))).toBe(false);
    expect(existsSync(join(dir, "sessao_a.log"))).toBe(false);
    expect((await c.pedir({ op: "listar" }))["sessoes"]).toEqual([]);
  });

  it("rejeita id de sessão que sairia da pasta de dados, e id repetido", async () => {
    const { socket } = await subir();
    const c = await conectar(socket);
    expect((await criar(c, "../fora"))["ok"]).toBe(false);
    expect((await criar(c, "sessao_a"))["ok"]).toBe(true);
    expect((await criar(c, "sessao_a"))["ok"]).toBe(false);
  });

  it("sai sozinho quando não há cliente nem processo vivo, e fica enquanto há processo", async () => {
    let encerrou = 0;
    const { socket, adaptador } = await subir({ ociosoMs: 40, aoEncerrar: () => { encerrou += 1; } });
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    c.socket.destroy();
    await new Promise((r) => setTimeout(r, 150));
    expect(encerrou).toBe(0);
    adaptador.criados[0]?.sair(0);
    await new Promise((r) => setTimeout(r, 150));
    expect(encerrou).toBe(1);
  });

  it("o tempo ocioso padrão é de 60 s (não sai logo depois de subir)", async () => {
    let encerrou = 0;
    await subir({ aoEncerrar: () => { encerrou += 1; } });
    await new Promise((r) => setTimeout(r, 120));
    expect(encerrou).toBe(0);
  });

  it("encerrar_tudo mata todos os processos vivos e encerra o daemon", async () => {
    let encerrou = 0;
    const { socket, adaptador } = await subir({ aoEncerrar: () => { encerrou += 1; } });
    const c = await conectar(socket);
    await criar(c, "sessao_a");
    await criar(c, "sessao_b");
    await c.pedir({ op: "encerrar_tudo" });
    expect(adaptador.criados.map((p) => p.mortos.length)).toEqual([1, 1]);
    await new Promise((r) => setTimeout(r, 50));
    expect(encerrou).toBe(1);
  });

  it("não guarda nada além do necessário no meta: sem ambiente nem caminho de executável", async () => {
    const { socket, dir } = await subir();
    const c = await conectar(socket);
    await c.pedir({ op: "criar", id: "sessao_a", executavel: EXE, argumentos: ["--x"], cwd: "/x", colunas: 80, linhas: 24, env: { SEGREDO: "valor-secreto" }, meta: { ...META, env: { SEGREDO: "valor-secreto" }, caminho: "/bin/sh" } });
    const bruto = readFileSync(join(dir, "sessao_a.json"), "utf8");
    expect(bruto).not.toContain("valor-secreto");
    expect(bruto).not.toContain("/bin/sh");
  });

  it("ignora arquivos que não são de sessão na pasta de dados", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dmn-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "token"), "x");
    writeFileSync(join(dir, "lixo.json"), "{nao é json");
    writeFileSync(join(dir, "sessao_quebrada.json"), "{nao é json");
    const { socket } = await subir({ dir });
    const c = await conectar(socket);
    expect((await c.pedir({ op: "listar" }))["sessoes"]).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
