import { describe, expect, it } from "vitest";
import type { EventoTerminal } from "../../compartilhado/terminais";
import type { InfoSessaoDaemon, MetaSessao } from "../../daemon/protocolo";
import { GerenciadorSessoes, type AdaptadorPty, type ProcessoPty } from "./sessoes";

class PtyRemotoFalso implements ProcessoPty {
  pid = 0;
  escrito: string[] = [];
  mortos = 0;
  #dados = new Set<(d: string, fim?: number) => void>();
  #saidas = new Set<(e: { exitCode: number; signal?: number | undefined }) => void>();
  onData(fn: (d: string, fim?: number) => void) { this.#dados.add(fn); return { dispose: () => this.#dados.delete(fn) }; }
  onExit(fn: (e: { exitCode: number; signal?: number | undefined }) => void) { this.#saidas.add(fn); return { dispose: () => this.#saidas.delete(fn) }; }
  write(d: string) { this.escrito.push(d); }
  resize() { /* sem efeito */ }
  pause() { /* sem efeito */ }
  resume() { /* sem efeito */ }
  kill() { this.mortos += 1; }
  emitir(d: string, fim?: number) { this.#dados.forEach((fn) => fn(d, fim)); }
  sair(codigo = 0) { this.#saidas.forEach((fn) => fn({ exitCode: codigo })); }
}

const meta = (raiz = "/ws/a", workspace_id: string | null = "ws_a"): MetaSessao => ({ ferramenta_id: "personalizado", executavel_id: "exe_antigo", argumentos: ["--x"], raiz, workspace_id, colunas: 80, linhas: 24, criada_em: 1 });
const info = (id: string, estado: InfoSessaoDaemon["estado"], raiz = "/ws/a"): InfoSessaoDaemon => ({ ...meta(raiz), sessao_id: id, estado, codigo: estado === "executando" ? null : 0, sinal: null });

class DaemonFalso implements AdaptadorPty {
  persistente = true;
  spawns: Array<{ sessao_id?: string | undefined; meta?: MetaSessao | undefined }> = [];
  processos = new Map<string, PtyRemotoFalso>();
  sessoes: InfoSessaoDaemon[] = [];
  historicos = new Map<string, { dados: string; fim: number }>();
  soltas: string[] = [];
  descartadas: string[] = [];
  anexadas: string[] = [];
  bloqueio: Promise<void> | null = null;
  spawn(_e: unknown, _a: unknown, opcoes: { sessao_id?: string; meta?: MetaSessao }) {
    const p = new PtyRemotoFalso();
    this.spawns.push({ sessao_id: opcoes.sessao_id, meta: opcoes.meta });
    if (opcoes.sessao_id !== undefined) this.processos.set(opcoes.sessao_id, p);
    return p;
  }
  async listar() { return this.sessoes; }
  anexar(id: string) { this.anexadas.push(id); const p = new PtyRemotoFalso(); this.processos.set(id, p); return p; }
  async historico(id: string) { await this.bloqueio; return this.historicos.get(id) ?? { dados: "", fim: 0 }; }
  soltar(id: string) { this.soltas.push(id); }
  descartar(id: string) { this.descartadas.push(id); }
}

const PEDIDO = { versao: 1, ferramenta_id: "personalizado", executavel_id: "exe_fixture", argumentos: [] as string[], colunas: 80, linhas: 24, workspace_id: null };

function cenario(filtrar?: (i: InfoSessaoDaemon) => boolean) {
  const daemon = new DaemonFalso();
  const g = new GerenciadorSessoes({
    resolverCwd: () => "/ws/a", janela_id: 1, geracao: 1, adaptador: daemon, criar_id: (n) => `sessao_${n}`,
    registro: { obter: () => ({ ferramenta_id: "personalizado", caminho: process.execPath, modo_lancamento: "direto" }) },
    ...(filtrar ? { filtrar_recuperacao: filtrar } : {}),
  });
  const eventos: EventoTerminal[] = [];
  g.assinar((e) => eventos.push(e));
  return { daemon, g, eventos };
}
const saidas = (eventos: EventoTerminal[], id: string) => eventos.flatMap((e) => (e.tipo === "saida" && e.sessao_id === id ? [e.dados] : []));
const aguardar = () => new Promise<void>((r) => setImmediate(r));

describe("sessões sobre o daemon", () => {
  it("é persistente e abrir entrega ao daemon a identidade e os metadados da aba", () => {
    const { daemon, g } = cenario();
    g.abrir({ ...PEDIDO, argumentos: ["--y"], colunas: 90, linhas: 30 });
    expect(daemon.spawns).toEqual([{ sessao_id: "sessao_1", meta: { ferramenta_id: "personalizado", executavel_id: "exe_fixture", argumentos: ["--y"], raiz: "/ws/a", workspace_id: null, colunas: 90, linhas: 30, criada_em: expect.any(Number) } }]);
    expect(g.persistente).toBe(true);
    expect(g.listarMetadados()[0]).toMatchObject({ persistente: true });
  });

  it("recuperar reproduz o histórico antes do que chegou durante a leitura, sem duplicar o que o histórico já cobre", async () => {
    const { daemon, g, eventos } = cenario();
    daemon.sessoes = [info("sessao_viva", "executando"), info("sessao_fim", "encerrada")];
    daemon.historicos.set("sessao_viva", { dados: "historico", fim: 9 });
    daemon.historicos.set("sessao_fim", { dados: "acabou", fim: 6 });
    let liberar!: () => void;
    daemon.bloqueio = new Promise<void>((r) => { liberar = r; });
    const promessa = g.recuperar();
    await aguardar();
    // chegam durante a leitura do histórico: o primeiro já está nele (fim 9), o segundo não
    daemon.processos.get("sessao_viva")?.emitir("historico", 9);
    daemon.processos.get("sessao_viva")?.emitir("+novo", 14);
    liberar();
    const recuperadas = await promessa;
    expect(recuperadas.map((r) => [r.sessao_id, r.estado])).toEqual([["sessao_viva", "executando"], ["sessao_fim", "encerrada"]]);
    expect(recuperadas[0]).toMatchObject({ ferramenta_id: "personalizado", executavel_id: "exe_antigo", argumentos: ["--x"], colunas: 80, linhas: 24, workspace_id: "ws_a", persistente: true });
    expect(saidas(eventos, "sessao_viva").join("")).toBe("historico+novo");
    expect(saidas(eventos, "sessao_fim").join("")).toBe("acabou");
    expect(daemon.anexadas).toEqual(["sessao_viva"]);
    // depois da recuperação a saída volta a ir direto
    daemon.processos.get("sessao_viva")?.emitir("!", 15);
    expect(saidas(eventos, "sessao_viva").join("")).toBe("historico+novo!");
    expect(g.tem_sessoes_ativas).toBe(true);
    expect(g.obter("sessao_viva")).toMatchObject({ workspace_id: "ws_a", cwd: "/ws/a" });
  });

  it("recuperar só adota o que o filtro deixa", async () => {
    const { daemon, g } = cenario((i) => i.raiz === "/ws/a");
    daemon.sessoes = [info("sessao_a", "executando"), info("sessao_b", "executando", "/outra")];
    const r = await g.recuperar();
    expect(r.map((x) => x.sessao_id)).toEqual(["sessao_a"]);
    expect(daemon.processos.has("sessao_b")).toBe(false);
  });

  it("duas chamadas de recuperar em paralelo não anexam duas vezes e mantêm a sequência contígua", async () => {
    const { daemon, g, eventos } = cenario();
    daemon.sessoes = [info("sessao_viva", "executando")];
    daemon.historicos.set("sessao_viva", { dados: "tudo", fim: 4 });
    await Promise.all([g.recuperar(), g.recuperar()]);
    expect(daemon.anexadas).toEqual(["sessao_viva"]);
    expect(saidas(eventos, "sessao_viva")).toEqual(["tudo", "tudo"]);
    const seqs = eventos.map((e) => e.sequencia);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("a sessão recuperada aceita teclado e o encerramento dela chega como evento", async () => {
    const { daemon, g, eventos } = cenario();
    daemon.sessoes = [info("sessao_viva", "executando")];
    await g.recuperar();
    expect(g.escrever("sessao_viva", "ls\r")).toBe(true);
    expect(daemon.processos.get("sessao_viva")?.escrito).toEqual(["ls\r"]);
    daemon.processos.get("sessao_viva")?.sair(0);
    expect(eventos.some((e) => e.sessao_id === "sessao_viva" && e.tipo === "estado" && e.estado === "encerrada")).toBe(true);
  });

  it("recuperar de novo reproduz o histórico das sessões já adotadas (tela recriada)", async () => {
    const { daemon, g, eventos } = cenario();
    daemon.sessoes = [info("sessao_viva", "executando")];
    daemon.historicos.set("sessao_viva", { dados: "tudo", fim: 4 });
    await g.recuperar();
    await g.recuperar();
    expect(saidas(eventos, "sessao_viva")).toEqual(["tudo", "tudo"]);
    expect(daemon.anexadas).toEqual(["sessao_viva"]);
  });

  it("recuperar inclui a sessão aberta neste mesmo contexto sem anexá-la de novo", async () => {
    const { daemon, g } = cenario();
    const aberta = g.abrir(PEDIDO);
    daemon.sessoes = [info(aberta.sessao_id, "executando")];
    daemon.historicos.set(aberta.sessao_id, { dados: "saida", fim: 5 });
    const r = await g.recuperar();
    expect(r.map((x) => x.sessao_id)).toEqual([aberta.sessao_id]);
    expect(daemon.anexadas).toEqual([]);
  });

  it("desanexar solta as sessões sem matar nada e para de emitir eventos", async () => {
    const { daemon, g, eventos } = cenario();
    const a = g.abrir(PEDIDO);
    await aguardar();
    const processo = daemon.processos.get(a.sessao_id) as PtyRemotoFalso;
    g.desanexar();
    expect(daemon.soltas).toEqual([a.sessao_id]);
    expect(processo.mortos).toBe(0);
    const antes = eventos.length;
    processo.emitir("depois");
    processo.sair(0);
    expect(eventos.length).toBe(antes);
    expect(g.tem_sessoes_ativas).toBe(false);
    expect(() => g.abrir(PEDIDO)).toThrow();
  });

  it("descartar encerra o processo vivo, apaga no daemon e tira da lista", async () => {
    const { daemon, g } = cenario();
    daemon.sessoes = [info("sessao_viva", "executando"), info("sessao_fim", "encerrada")];
    await g.recuperar();
    expect(g.descartar("sessao_viva")).toBe(true);
    expect(g.descartar("sessao_fim")).toBe(true);
    expect(daemon.processos.get("sessao_viva")?.mortos).toBe(1);
    expect(daemon.descartadas).toEqual(["sessao_viva", "sessao_fim"]);
    expect(g.listar()).toEqual([]);
    expect(g.descartar("sessao_inexistente")).toBe(false);
  });

  it("sem daemon (adaptador comum) recuperar devolve vazio, não é persistente e desanexar encerra", async () => {
    const p = new PtyRemotoFalso();
    const g = new GerenciadorSessoes({
      resolverCwd: () => "/x", janela_id: 1, geracao: 1, adaptador: { spawn: () => p },
      registro: { obter: () => ({ ferramenta_id: "personalizado", caminho: "/x", modo_lancamento: "direto" }) },
    });
    g.abrir(PEDIDO);
    expect(g.persistente).toBe(false);
    expect(await g.recuperar()).toEqual([]);
    g.desanexar();
    expect(p.mortos).toBe(1);
  });
});
