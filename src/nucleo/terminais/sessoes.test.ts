import { describe, expect, it } from "vitest";
import type { EventoTerminal } from "../../compartilhado/terminais";
import { CATALOGO_NEUTRO, GerenciadorSessoes, type AdaptadorPty, type CatalogoSessoes, type ExecutavelPty, type ProcessoPty } from "./sessoes";

class PtyFalso implements ProcessoPty {
  pid = 123;
  escrito: string[] = [];
  tamanhos: Array<[number, number]> = [];
  pausas = 0;
  retomadas = 0;
  pausado = false;
  morto = false;
  sinais: Array<string | undefined> = [];
  #dados = new Set<(dados: string) => void>();
  #saidas = new Set<(evento: { exitCode: number; signal?: number | undefined }) => void>();
  onData(fn: (dados: string) => void) { this.#dados.add(fn); return { dispose: () => this.#dados.delete(fn) }; }
  onExit(fn: (evento: { exitCode: number; signal?: number | undefined }) => void) { this.#saidas.add(fn); return { dispose: () => this.#saidas.delete(fn) }; }
  write(dados: string) { this.escrito.push(dados); }
  resize(colunas: number, linhas: number) { this.tamanhos.push([colunas, linhas]); }
  pause() { this.pausado = true; this.pausas += 1; }
  resume() { this.pausado = false; this.retomadas += 1; }
  kill(sinal?: string) { this.morto = true; this.sinais.push(sinal); }
  emitir(dados: string) { this.#dados.forEach((fn) => fn(dados)); }
  sair(codigo = 0) { this.#saidas.forEach((fn) => fn({ exitCode: codigo })); }
}

const aguardar = () => new Promise<void>((r) => setImmediate(r));
const PEDIDO = { versao: 1, ferramenta_id: "personalizado", executavel_id: "exe_fixture", argumentos: [] as string[], colunas: 80, linhas: 24, workspace_id: null };

interface Chamada { executavel: ExecutavelPty; argv: string[]; cwd: string; ambiente: Record<string, string>; meta: unknown }

function cenario(opcoes: { ferramenta?: string; catalogo?: CatalogoSessoes; limite?: number | (() => number); ajustar?: (f: string, argv: string[]) => string[] } = {}) {
  const processos: PtyFalso[] = [];
  const chamadas: Chamada[] = [];
  const adaptador: AdaptadorPty = {
    spawn: (executavel, argv, o) => {
      const p = new PtyFalso();
      processos.push(p);
      chamadas.push({ executavel, argv: [...argv], cwd: o.cwd, ambiente: o.env, meta: o.meta });
      return p;
    },
  };
  const ferramenta = opcoes.ferramenta ?? "personalizado";
  const registro = { obter: (id: string): ExecutavelPty | undefined => (id.startsWith("exe_") ? { ferramenta_id: ferramenta, caminho: process.execPath, modo_lancamento: "direto" } : undefined) };
  const cwds = new Map<string | null, string>([[null, "/ws/atual"], ["ws_a", "/ws/a"]]);
  const eventos: EventoTerminal[] = [];
  const g = new GerenciadorSessoes({
    resolverCwd: (w) => { const c = cwds.get(w); if (c === undefined) throw new Error("sem workspace"); return c; },
    janela_id: 7, geracao: 1, registro, adaptador,
    criar_id: (n) => `sessao_${n}`,
    ...(opcoes.catalogo ? { catalogo: opcoes.catalogo } : {}),
    ...(opcoes.limite ? { limite_sessoes: opcoes.limite } : {}),
    ...(opcoes.ajustar ? { ajustar_argumentos: opcoes.ajustar } : {}),
  });
  g.assinar((e) => eventos.push(e));
  const abrir = (extra: object = {}) => g.abrir({ ...PEDIDO, ferramenta_id: ferramenta, ...extra });
  return { g, processos, chamadas, eventos, abrir };
}

const saidas = (eventos: EventoTerminal[], id?: string) => eventos.flatMap((e) => (e.tipo === "saida" && (id === undefined || e.sessao_id === id) ? [e.dados] : []));

describe("abrir", () => {
  it("o cwd vem do main por resolverCwd(workspace_id); o renderer não escolhe", () => {
    const { g, chamadas, abrir } = cenario();
    abrir();
    abrir({ workspace_id: "ws_a" });
    expect(chamadas.map((c) => c.cwd)).toEqual(["/ws/atual", "/ws/a"]);
    expect(() => abrir({ workspace_id: "ws_inexistente" })).toThrow("Workspace desconhecido.");
    expect(() => abrir({ cwd: "/etc" })).toThrow(/cwd/);
    expect(g.obter("sessao_2")).toMatchObject({ workspace_id: "ws_a", cwd: "/ws/a" });
  });

  it("entrega ao adaptador identidade e metadados (incluindo workspace e cwd)", () => {
    const { chamadas, abrir } = cenario();
    abrir({ argumentos: ["--y"], colunas: 90, linhas: 30, workspace_id: "ws_a" });
    expect(chamadas[0]!.meta).toEqual({ ferramenta_id: "personalizado", executavel_id: "exe_fixture", argumentos: ["--y"], raiz: "/ws/a", workspace_id: "ws_a", colunas: 90, linhas: 30, criada_em: expect.any(Number) });
  });

  it("recusa executável desconhecido ou de outra ferramenta", () => {
    const { abrir, g } = cenario();
    expect(() => abrir({ executavel_id: "exe_x", ferramenta_id: "claude" })).toThrow(/Executável desconhecido/);
    expect(g.listar()).toEqual([]);
  });

  it("argv separado: argumentos do usuário nunca viram uma string de shell, ordem correta", () => {
    const catalogo: CatalogoSessoes = {
      argumentosAutomaticos: (f, w) => [`--auto-${f}-${String(w)}`],
      argumentosDeRetomada: (f, c) => (f === "claude" ? ["--resume", c] : null),
      argumentosDePromptInicial: (f, p) => (f === "claude" ? [p] : null),
      teclaDeInterrupcao: () => "\x1b",
    };
    const { chamadas, abrir } = cenario({ ferramenta: "claude", catalogo });
    abrir({ argumentos: ["--x", "a b; rm -rf /"], retomar: "c-1", prompt_inicial: "faça $(isto)", workspace_id: "ws_a" });
    expect(chamadas[0]!.argv).toEqual(["--auto-claude-ws_a", "--x", "a b; rm -rf /", "--resume", "c-1", "faça $(isto)"]);
    expect(() => cenario({ ferramenta: "codex", catalogo }).abrir({ retomar: "c-1" })).toThrow(/retoma/);
    expect(() => cenario({ ferramenta: "codex", catalogo }).abrir({ prompt_inicial: "oi" })).toThrow(/prompt inicial/);
  });

  it("o ambiente do filho não leva a identidade do Claude Code", () => {
    const anterior = process.env["CLAUDE_CODE_SESSION_ID"];
    process.env["CLAUDE_CODE_SESSION_ID"] = "mae";
    try {
      const { chamadas, abrir } = cenario();
      abrir();
      expect(chamadas[0]!.ambiente["CLAUDE_CODE_SESSION_ID"]).toBeUndefined();
      expect(chamadas[0]!.ambiente["PATH"]).toBeTruthy();
    } finally {
      if (anterior === undefined) delete process.env["CLAUDE_CODE_SESSION_ID"]; else process.env["CLAUDE_CODE_SESSION_ID"] = anterior;
    }
  });

  it("falha de spawn não deixa sessão e não vaza a mensagem interna", () => {
    const g = new GerenciadorSessoes({
      resolverCwd: () => "/x", janela_id: 1, geracao: 1,
      registro: { obter: () => ({ ferramenta_id: "personalizado", caminho: "/ausente", modo_lancamento: "direto" }) },
      adaptador: { spawn: () => { throw new Error("token=segredo interno"); } },
    });
    expect(() => g.abrir(PEDIDO)).toThrow("Não foi possível iniciar o terminal.");
    expect(g.listar()).toEqual([]);
  });

  it("a sessão nasce pausada e passa a executando no próximo ciclo", async () => {
    const { processos, eventos, abrir, g } = cenario();
    const { sessao_id } = abrir();
    expect(processos[0]!.pausado).toBe(true);
    expect(g.obter(sessao_id)!.estado).toBe("iniciando");
    await aguardar();
    expect(processos[0]!.pausado).toBe(false);
    expect(eventos.find((e) => e.tipo === "estado")).toMatchObject({ estado: "executando", sequencia: 1 });
  });
});

describe("limite de sessões", () => {
  it("o limite pode ser dinâmico: mudar vale para novas sessões e não derruba as existentes", () => {
    let limite = 3;
    const { abrir, g } = cenario({ limite: () => limite });
    for (let i = 0; i < 3; i++) abrir();
    expect(() => abrir()).toThrow("Limite de sessões por janela atingido.");
    limite = 2; // abaixo do que já existe: nada é derrubado, só não abre mais
    expect(g.temAtivas()).toBe(3);
    expect(() => abrir()).toThrow("Limite de sessões por janela atingido.");
    limite = 4;
    expect(() => abrir()).not.toThrow();
    expect(g.temAtivas()).toBe(4);
  });

  it("a 17ª sessão é recusada (16 por janela)", () => {
    const { abrir, g } = cenario();
    for (let i = 0; i < 16; i++) abrir();
    expect(() => abrir()).toThrow("Limite de sessões por janela atingido.");
    expect(g.temAtivas()).toBe(16);
  });

  it("sessão encerrada libera vaga", async () => {
    const { abrir, processos } = cenario();
    for (let i = 0; i < 16; i++) abrir();
    await aguardar();
    processos[0]!.sair(0);
    expect(() => abrir()).not.toThrow();
  });
});

describe("saída, sequência e backpressure", () => {
  it("duas sessões mantêm saída, entrada e estado independentes", async () => {
    const { g, processos, eventos, abrir } = cenario();
    const a = abrir();
    const b = abrir({ colunas: 100, linhas: 30 });
    await aguardar();
    processos[0]!.emitir("primeira");
    processos[1]!.emitir("segunda");
    g.escrever(a.sessao_id, "a\n");
    g.redimensionar(b.sessao_id, 120, 40);
    processos[0]!.sair(0);
    expect(saidas(eventos)).toEqual(["primeira", "segunda"]);
    expect(processos[0]!.escrito).toEqual(["a\n"]);
    expect(processos[1]!.tamanhos).toEqual([[120, 40]]);
    expect(g.listar().map((s) => s.estado)).toEqual(["encerrada", "executando"]);
  });

  it("sequência é monotônica e contígua por sessão, em todos os tipos de evento", async () => {
    const { g, processos, eventos, abrir } = cenario();
    const a = abrir();
    const b = abrir();
    await aguardar();
    processos[0]!.emitir("x");
    processos[1]!.emitir("y");
    g.emitirEvento(a.sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    processos[0]!.emitir("z".repeat(200_000)); // vários eventos de 64 KB
    processos[0]!.sair(0);
    for (const id of [a.sessao_id, b.sessao_id]) {
      const seqs = eventos.filter((e) => e.sessao_id === id).map((e) => e.sequencia);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    }
    expect(eventos.filter((e) => e.sessao_id === a.sessao_id).length).toBeGreaterThan(6);
  });

  it("a saída sai em pedaços de no máximo 64 KB e sem partir um emoji", async () => {
    const { processos, eventos, abrir } = cenario();
    abrir();
    await aguardar();
    processos[0]!.emitir("x".repeat(64 * 1024 - 1) + "😀" + "y".repeat(10));
    const pedacos = saidas(eventos);
    expect(pedacos.length).toBe(2);
    for (const p of pedacos) expect(p.length).toBeLessThanOrEqual(64 * 1024);
    expect(pedacos[0]!.endsWith("x")).toBe(true);
    expect(pedacos.join("")).toContain("😀");
  });

  it("pausa acima de 256 KB pendentes e retoma abaixo de 128 KB após confirmarConsumo", async () => {
    const { g, processos, abrir } = cenario();
    const { sessao_id } = abrir();
    await aguardar();
    const p = processos[0]!;
    const pausasIniciais = p.pausas;
    p.emitir("x".repeat(200 * 1024));
    expect(p.pausado).toBe(false);
    p.emitir("x".repeat(100 * 1024)); // 300 KB pendentes
    expect(p.pausado).toBe(true);
    expect(p.pausas).toBe(pausasIniciais + 1);
    p.emitir("x".repeat(10 * 1024)); // já pausado: não pausa de novo
    expect(p.pausas).toBe(pausasIniciais + 1);
    g.confirmarConsumo(sessao_id, 100 * 1024); // 210 KB: ainda acima de 128 KB
    expect(p.pausado).toBe(true);
    g.confirmarConsumo(sessao_id, 100 * 1024); // 110 KB
    expect(p.pausado).toBe(false);
    expect(g.confirmarConsumo("sessao_inexistente", 1)).toBe(false);
    expect(g.confirmarConsumo(sessao_id, -5)).toBe(false);
  });

  it("remove OSC 52/8 também quando partidos entre chunks de saída", async () => {
    const { processos, eventos, abrir } = cenario();
    abrir();
    await aguardar();
    const p = processos[0]!;
    p.emitir("antes\u001b]5");
    p.emitir("2;c;Y29waWFy");
    p.emitir("\u0007depois\u001b]8;;file:///tmp/x\u001b");
    p.emitir("\\link\u001b]8;;\u0007");
    expect(saidas(eventos).join("")).toBe("antesdepoislink");
  });

  it("escrever: limites, NUL e chamadas tardias", async () => {
    const { g, processos, abrir } = cenario();
    const { sessao_id } = abrir();
    expect(g.escrever(sessao_id, "antes")).toBe(false); // ainda iniciando
    await aguardar();
    expect(() => g.escrever(sessao_id, "a\0")).toThrow();
    expect(() => g.escrever(sessao_id, "x".repeat(64 * 1024 + 1))).toThrow();
    expect(() => g.escrever("sessao_outra", "x")).toThrow(/desconhecida/);
    expect(() => g.redimensionar(sessao_id, 1, 10)).toThrow();
    processos[0]!.sair(0);
    expect(g.escrever(sessao_id, "tarde")).toBe(false);
    expect(g.redimensionar(sessao_id, 90, 25)).toBe(false);
  });
});

describe("encerramento", () => {
  it("encerrar é idempotente; saída com código diferente de zero sem pedido vira erro", async () => {
    const { g, processos, eventos, abrir } = cenario();
    const a = abrir();
    const b = abrir();
    await aguardar();
    expect(g.encerrar(a.sessao_id)).toBe(true);
    expect(g.encerrar(a.sessao_id)).toBe(true);
    expect(processos[0]!.sinais).toHaveLength(1);
    processos[0]!.sair(143);
    processos[1]!.sair(1);
    expect(g.obter(a.sessao_id)!.estado).toBe("encerrada");
    expect(g.obter(b.sessao_id)!.estado).toBe("erro");
    expect(eventos.some((e) => e.tipo === "encerramento" && e.sessao_id === b.sessao_id && e.codigo === 1)).toBe(true);
    expect(g.encerrar("sessao_nada")).toBe(false);
  });

  it("encerrarTodasEAguardar bloqueia a admissão e fecha tudo", async () => {
    const { g, processos, abrir } = cenario();
    abrir();
    abrir();
    await aguardar();
    const espera = g.encerrarTodasEAguardar();
    processos.forEach((p) => p.sair(0));
    await espera;
    expect(g.tem_sessoes_ativas).toBe(false);
    expect(() => abrir()).toThrow(/encerradas/);
    g.liberarAdmissao();
    expect(() => abrir()).not.toThrow();
  });
});

describe("interromper, diagnóstico e descarte", () => {
  it("interromper: ESC nas CLIs de IA, Ctrl+C no terminal; nunca mata", async () => {
    for (const [id, tecla] of [["claude", "\x1b"], ["terminal", "\x03"]] as const) {
      const { g, processos, abrir } = cenario({ ferramenta: id, catalogo: CATALOGO_NEUTRO });
      const { sessao_id } = abrir();
      await aguardar();
      expect(g.interromper(sessao_id)).toBe(true);
      expect(processos[0]!.escrito).toEqual([tecla]);
      expect(processos[0]!.morto).toBe(false);
    }
  });

  it("diagnóstico traz pid, atividade, criada_em e só a quantidade de argumentos", async () => {
    const { g, abrir } = cenario();
    const { sessao_id } = abrir({ argumentos: ["--segredo"] });
    await aguardar();
    g.emitirEvento(sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    const [info] = g.diagnostico();
    expect(info).toMatchObject({ sessao_id, pid: 123, atividade: "trabalhando", quantidade_argumentos: 1 });
    expect(JSON.stringify(info)).not.toContain("segredo");
  });

  it("listarMetadados segue o contrato e ao_descartar é chamado", () => {
    const descartadas: string[] = [];
    const g = new GerenciadorSessoes({
      resolverCwd: () => "/x", janela_id: 1, geracao: 1, criar_id: (n) => `sessao_${n}`,
      registro: { obter: () => ({ ferramenta_id: "personalizado", caminho: "/x", modo_lancamento: "direto" }) },
      adaptador: { spawn: () => new PtyFalso() },
      ao_descartar: (id) => descartadas.push(id),
    });
    const r = g.abrir(PEDIDO);
    expect(g.listarMetadados()).toEqual([{ sessao_id: r.sessao_id, ferramenta_id: "personalizado", estado: "iniciando", workspace_id: null, criada_em: expect.stringMatching(/^\d{4}-/), persistente: false }]);
    expect(g.descartar(r.sessao_id)).toBe(true);
    expect(descartadas).toEqual([r.sessao_id]);
    expect(g.descartar(r.sessao_id)).toBe(false);
  });
});

describe("ajustar_argumentos", () => {
  it("recebe uma cópia do argv final e o que devolve é o que vai ao adaptador (o registro da sessão guarda os argumentos do pedido)", () => {
    const vistos: string[][] = [];
    const { chamadas, abrir } = cenario({ ajustar: (f, argv) => { vistos.push(argv); argv.push("x"); return [f, ...argv.slice(0, -1), "--juntado"]; } });
    abrir({ argumentos: ["--a", "--b"] });
    expect(vistos).toEqual([["--a", "--b", "x"]]);
    expect(chamadas[0]?.argv).toEqual(["personalizado", "--a", "--b", "--juntado"]);
    expect((chamadas[0]?.meta as { argumentos: string[] }).argumentos).toEqual(["--a", "--b"]);
  });
  it("sem a opção nada muda", () => {
    const { chamadas, abrir } = cenario();
    abrir({ argumentos: ["--a"] });
    expect(chamadas[0]?.argv).toEqual(["--a"]);
  });
});
