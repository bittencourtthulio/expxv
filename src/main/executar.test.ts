import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoExecutar } from "../compartilhado/executar";
import { criarArmazemExecutar } from "../nucleo/executar/armazem";
import type { ConfigExecucao } from "../nucleo/executar/modelo";
import { GerenciadorSessoes, type AdaptadorPty, type ExecutavelPty, type ProcessoPty } from "../nucleo/terminais/sessoes";
import { criarServicoExecutar, ErroExecutar, type DependenciasExecutar, type ServicoExecutar } from "./executar";

// Processos REAIS (sh) atrás do gerenciador de sessões real; só o PTY é trocado por um filho com grupo próprio (`detached` = setsid).
const vivos = new Set<number>();
const estaVivo = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

function adaptadorReal(): AdaptadorPty {
  return {
    spawn(exe: ExecutavelPty, argv, o): ProcessoPty {
      const filho = spawn(exe.caminho, [...argv], { cwd: o.cwd, env: o.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      if (filho.pid !== undefined) vivos.add(filho.pid);
      const dados = new Set<(d: string) => void>();
      const saidas = new Set<(e: { exitCode: number; signal?: number | undefined }) => void>();
      const emitir = (b: Buffer): void => dados.forEach((f) => f(b.toString("utf8")));
      filho.stdout.on("data", emitir);
      filho.stderr.on("data", emitir);
      filho.stdin.on("error", () => undefined);
      filho.on("error", () => saidas.forEach((f) => f({ exitCode: 127 })));
      filho.on("close", (codigo, sinal) => saidas.forEach((f) => f({ exitCode: codigo ?? 0, signal: sinal === null ? undefined : (({ SIGINT: 2, SIGTERM: 15, SIGKILL: 9 }) as Record<string, number>)[sinal] })));
      const pid = filho.pid ?? 0;
      return {
        pid,
        onData: (f) => { dados.add(f); return { dispose: () => void dados.delete(f) }; },
        onExit: (f) => { saidas.add(f); return { dispose: () => void saidas.delete(f) }; },
        write: (d) => { if (d === "\x03") { try { process.kill(-pid, "SIGINT"); } catch { /* já saiu */ } } else filho.stdin.write(d); },
        resize: () => undefined,
        pause: () => { filho.stdout.pause(); filho.stderr.pause(); },
        resume: () => { filho.stdout.resume(); filho.stderr.resume(); },
        kill: (sinal = "SIGTERM") => { try { process.kill(-pid, sinal as NodeJS.Signals); } catch { /* já saiu */ } },
      };
    },
  };
}

interface Cenario {
  raiz: string;
  dados: string;
  servico: ServicoExecutar;
  eventos: EventoExecutar[];
  bus: Array<{ tipo: string; payload: Record<string, unknown> }>;
  abertos: string[];
  notificacoes: string[];
  gerenciador: GerenciadorSessoes;
  registrados: Map<string, ExecutavelPty>;
}

const WS = "ws_ABCDEFGHIJKL";
const limpar: string[] = [];
const cenarios: Cenario[] = [];

function criar(extra: Partial<DependenciasExecutar> = {}): Cenario {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "executar-ws-")));
  const dados = realpathSync(mkdtempSync(join(tmpdir(), "executar-dados-")));
  limpar.push(raiz, dados);
  const registrados = new Map<string, ExecutavelPty>();
  const gerenciador = new GerenciadorSessoes({
    resolverCwd: () => raiz, janela_id: 1, geracao: 1, adaptador: adaptadorReal(),
    registro: { obter: (id) => registrados.get(id) },
  });
  const eventos: EventoExecutar[] = [];
  const bus: Cenario["bus"] = [];
  const abertos: string[] = [];
  const notificacoes: string[] = [];
  const servico = criarServicoExecutar({
    pastaDados: dados,
    raizDe: (id) => (id === WS ? raiz : null),
    sessoes: async () => gerenciador,
    registrarExecutavel: (caminho) => { const id = `exe_${registrados.size}`; registrados.set(id, { ferramenta_id: "personalizado", caminho, modo_lancamento: "direto" }); return id; },
    emitir: (e) => eventos.push(e),
    barramento: { emitir: (tipo, payload) => bus.push({ tipo, payload: payload as Record<string, unknown> }) },
    abrirExterno: (url) => { abertos.push(url); },
    notificar: (t, c) => notificacoes.push(`${t}|${c}`),
    esperas: { sigint_ms: 250, sigterm_ms: 250, sigkill_ms: 1_500 },
    path: process.env["PATH"] ?? "",
    ...extra,
  });
  const c: Cenario = { raiz, dados, servico, eventos, bus, abertos, notificacoes, gerenciador, registrados };
  cenarios.push(c);
  return c;
}

const script = (c: Cenario, nome: string, corpo: string): void => {
  const caminho = join(c.raiz, nome);
  mkdirSync(join(caminho, ".."), { recursive: true });
  writeFileSync(caminho, `#!/bin/sh\n${corpo}\n`);
  chmodSync(caminho, 0o755);
};
const cfg = (o: Partial<ConfigExecucao> = {}): ConfigExecucao => ({
  id: "dev", nome: "Rodar (dev)", tipo: "rodar", executavel: "./run.sh", argumentos: [], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null,
  abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null, origem: "usuario", ...o,
});
const esperar = async (cond: () => boolean, ms = 8_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond()) { if (Date.now() > fim) throw new Error("tempo esgotado esperando condição"); await new Promise((r) => setTimeout(r, 20)); }
};
/** grava a configuração, pede confirmação e confirma: devolve o resultado iniciado */
async function rodar(c: Cenario, config: ConfigExecucao, id = config.id) {
  c.servico.gravarConfig(WS, config, config.shell !== null);
  const r1 = await c.servico.iniciar(WS, { config_id: id });
  expect(r1.resultado).toBe("confirmar");
  if (r1.resultado !== "confirmar") throw new Error("esperava confirmação");
  const r2 = await c.servico.iniciar(WS, { config_id: id, confirmar_hash: r1.pedido.hash });
  expect(r2.resultado).toBe("iniciado");
  return r2;
}
const fases = (c: Cenario): string[] => c.eventos.flatMap((e) => (e.tipo === "estado" ? [e.estado.fase] : []));

beforeEach(() => { vi.stubEnv("ORCA_HERANCA_TESTE", "valor-do-orca"); vi.stubEnv("CLAUDECODE", "1"); });
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cenarios.splice(0).map(async (c) => { await c.servico.encerrar().catch(() => undefined); c.gerenciador.encerrarTodas(); }));
  for (const d of limpar.splice(0)) rmSync(d, { recursive: true, force: true });
});
afterAll(() => { for (const pid of vivos) { try { process.kill(-pid, "SIGKILL"); } catch { /* ok */ } } });

describe("confiança (rodar script do repositório é executar código)", () => {
  it("primeira execução pede confirmação com o comando exato e NÃO inicia nada", async () => {
    const c = criar();
    script(c, "run.sh", "echo rodou > rodou.txt\nsleep 30");
    c.servico.gravarConfig(WS, cfg(), false);
    const r = await c.servico.iniciar(WS, {});
    expect(r.resultado).toBe("confirmar");
    if (r.resultado === "confirmar") {
      expect(r.pedido).toMatchObject({ config_id: "dev", nome: "Rodar (dev)", linhas: ["./run.sh"], cwd: ".", shell: false, motivo: "primeira_vez", ambiente: [] });
      expect(r.pedido.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(r.pedido.corpo).toContain("./run.sh");
    }
    await new Promise((res) => setTimeout(res, 200));
    expect(existsSync(join(c.raiz, "rodou.txt"))).toBe(false);
    expect(c.servico.estado(WS).fase).toBe("ocioso");
    expect(c.bus).toEqual([]);
  });

  it("confirmar com o hash roda, grava a confiança e a próxima execução não pergunta", async () => {
    const c = criar();
    script(c, "run.sh", "echo ok\nsleep 30");
    const r = await rodar(c, cfg());
    expect(r.resultado === "iniciado" && r.estado.fase).toBeTruthy();
    expect(criarArmazemExecutar(c.dados).hashConfiado(WS, "dev")).toMatch(/^[0-9a-f]{40}$/);
    await c.servico.parar(WS);
    const outra = await c.servico.iniciar(WS, { config_id: "dev" });
    expect(outra.resultado).toBe("iniciado");
  });

  it("hash errado ou antigo não vale (o renderer não consegue confiar sem ver o comando)", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    c.servico.gravarConfig(WS, cfg(), false);
    const r = await c.servico.iniciar(WS, { config_id: "dev", confirmar_hash: "a".repeat(40) });
    expect(r.resultado).toBe("confirmar");
    expect(c.servico.estado(WS).fase).toBe("ocioso");
  });

  it("mudar o COMANDO, os ARGUMENTOS ou o CORPO do script depois de confiar pede nova confirmação (comando_mudou)", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    await rodar(c, cfg());
    await c.servico.parar(WS);
    // 1) o corpo do script do repositório muda
    script(c, "run.sh", "echo outra-coisa\nsleep 30");
    const r1 = await c.servico.iniciar(WS, { config_id: "dev" });
    expect(r1.resultado).toBe("confirmar");
    expect(r1.resultado === "confirmar" && r1.pedido.motivo).toBe("comando_mudou");
    // 2) os argumentos mudam
    script(c, "run.sh", "sleep 30");
    c.servico.gravarConfig(WS, cfg({ argumentos: ["--x"] }), false);
    expect((await c.servico.iniciar(WS, { config_id: "dev" })).resultado).toBe("confirmar");
  });

  it("revogar a confiança faz perguntar de novo; nome e porta não invalidam", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    await rodar(c, cfg());
    await c.servico.parar(WS);
    c.servico.gravarConfig(WS, cfg({ nome: "Outro nome", porta: 3000 }), false);
    expect((await c.servico.iniciar(WS, { config_id: "dev" })).resultado).toBe("iniciado");
    await c.servico.parar(WS);
    const lista = c.servico.revogarConfianca(WS, "dev");
    expect(lista.configuracoes.find((x) => x.id === "dev")!.confiavel).toBe(false);
    expect((await c.servico.iniciar(WS, { config_id: "dev" })).resultado).toBe("confirmar");
  });

  it("confiança vale por configuração (não vaza para outra)", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    await rodar(c, cfg());
    await c.servico.parar(WS);
    c.servico.gravarConfig(WS, cfg({ id: "outra", nome: "Outra" }), false);
    expect((await c.servico.iniciar(WS, { config_id: "outra" })).resultado).toBe("confirmar");
  });

  it("usar shell: o diálogo marca shell e mostra a linha exata; gravar sem confirmação é recusado", async () => {
    const c = criar();
    const sh = cfg({ id: "sh", nome: "Com shell", executavel: "", shell: "echo a && echo b; sleep 30" });
    expect(() => c.servico.gravarConfig(WS, sh, false)).toThrow(ErroExecutar);
    c.servico.gravarConfig(WS, sh, true);
    const r = await c.servico.iniciar(WS, { config_id: "sh" });
    expect(r.resultado === "confirmar" && r.pedido).toMatchObject({ shell: true, linhas: ["[shell] echo a && echo b; sleep 30"] });
  });
});

describe("execução, estado e saída", () => {
  it("roda no cwd da configuração, com o ambiente da configuração e SEM identidade nem herança do Orca", async () => {
    const c = criar();
    mkdirSync(join(c.raiz, "sub"));
    script(c, "run.sh", 'pwd > pwd.txt\necho "modo=$MEU_MODO orca=${ORCA_HERANCA_TESTE-ausente} id=${CLAUDECODE-ausente}" > amb.txt\nsleep 30');
    await rodar(c, cfg({ cwd: "sub", ambiente: { MEU_MODO: "dev" } }));
    await esperar(() => existsSync(join(c.raiz, "sub/amb.txt")));
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(join(c.raiz, "sub/pwd.txt"), "utf8").trim()).toBe(join(c.raiz, "sub"));
    expect(readFileSync(join(c.raiz, "sub/amb.txt"), "utf8").trim()).toBe("modo=dev orca=ausente id=ausente");
  });

  it("referência {{vault:NOME}} é resolvida só no main; o valor nunca aparece em evento, estado, histórico nem barramento", async () => {
    const resolverCofre = vi.fn(async (t: string) => (t === "{{vault:CHAVE_BD}}" ? "valor-super-secreto-123" : t));
    const c = criar({ resolverCofre });
    script(c, "run.sh", 'echo "$DB_PASSWORD" > senha.txt\nsleep 30');
    await rodar(c, cfg({ ambiente: { DB_PASSWORD: "{{vault:CHAVE_BD}}" } }));
    await esperar(() => existsSync(join(c.raiz, "senha.txt")));
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(join(c.raiz, "senha.txt"), "utf8").trim()).toBe("valor-super-secreto-123");
    await c.servico.parar(WS);
    const tudo = JSON.stringify([c.eventos, c.bus, c.servico.historico(WS), c.servico.listar(WS), c.servico.estado(WS)]);
    expect(tudo).not.toContain("valor-super-secreto-123");
    expect(tudo).toContain("{{vault:CHAVE_BD}}"); // a referência (não o valor) é o que a configuração guarda
    expect(readFileSync(join(c.raiz, ".expxv/executar.json"), "utf8")).not.toContain("valor-super-secreto-123");
  });

  it("cofre indisponível ou entrada ausente: erro cita o NOME da variável, nunca o valor", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    c.servico.gravarConfig(WS, cfg({ ambiente: { TOKEN_X: "{{vault:X}}" } }), false);
    const r = await c.servico.iniciar(WS, {});
    if (r.resultado !== "confirmar") throw new Error("esperava confirmação");
    await expect(c.servico.iniciar(WS, { confirmar_hash: r.pedido.hash })).rejects.toThrow(/TOKEN_X.*cofre/);
    expect(c.servico.estado(WS).fase).not.toBe("rodando");
  });

  it("detecta porta/URL na saída, mostra no estado e abre o navegador UMA vez quando configurado", async () => {
    const c = criar();
    script(c, "run.sh", "echo 'ready on http://localhost:5199/'\nsleep 1\necho 'http://localhost:6000/'\nsleep 30");
    await rodar(c, cfg({ abrir_navegador: true }));
    await esperar(() => c.servico.estado(WS).porta !== null);
    expect(c.servico.estado(WS)).toMatchObject({ fase: "rodando", porta: 5199, url: "http://localhost:5199/" });
    await new Promise((r) => setTimeout(r, 1_300));
    expect(c.abertos).toEqual(["http://localhost:5199/"]);
    expect(c.servico.estado(WS).porta).toBe(5199);
    expect(await c.servico.abrirUrl(WS)).toBe(true);
    expect(c.abertos).toHaveLength(2);
  });

  it("URL maliciosa na saída (externa, com credenciais) nunca vira porta nem abre o navegador", async () => {
    const c = criar();
    script(c, "run.sh", "echo 'http://evil.example.com:3000/ http://u:p@localhost:3000/ javascript:alert(1)'\nsleep 30");
    await rodar(c, cfg({ abrir_navegador: true }));
    await new Promise((r) => setTimeout(r, 400));
    expect(c.servico.estado(WS).porta).toBeNull();
    expect(c.abertos).toEqual([]);
    expect(await c.servico.abrirUrl(WS)).toBe(false);
  });

  it("saída infinita não derruba nem trava: o serviço continua respondendo e a execução ainda pode ser parada", async () => {
    const c = criar();
    script(c, "run.sh", "yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    await rodar(c, cfg());
    await new Promise((r) => setTimeout(r, 600));
    expect(c.servico.estado(WS).fase).toBe("rodando");
    const t0 = Date.now();
    expect(c.servico.listar(WS).configuracoes.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(await c.servico.parar(WS)).toBe(true);
    expect(c.servico.estado(WS).fase).toBe("parada");
  });

  it("código de saída traduzido: build falhou, histórico gravado, run.failed no barramento e notificação de build longo", async () => {
    const c = criar({ notificar_apos_ms: 0 });
    script(c, "run.sh", "echo compilando\nexit 3");
    await rodar(c, cfg({ id: "build", nome: "Build completo", tipo: "build" }));
    await esperar(() => c.servico.estado(WS).fase === "falhou");
    expect(c.servico.estado(WS)).toMatchObject({ codigo: 3, mensagem: "Build falhou (código 3): veja o painel Execução." });
    expect(c.bus.map((b) => b.tipo)).toEqual(["run.started", "run.failed"]);
    expect(c.bus[1]!.payload).toMatchObject({ workspace_id: WS, config_id: "build", codigo: 3 });
    expect(c.notificacoes).toEqual(["Build completo: falhou|Build falhou (código 3): veja o painel Execução."]);
    const h = c.servico.historico(WS);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ config_id: "build", codigo: 3, resultado: "falha", comando: "./run.sh" });
  });

  it("sucesso emite run.stopped e não notifica quando o build é curto", async () => {
    const c = criar();
    script(c, "run.sh", "exit 0");
    await rodar(c, cfg({ id: "build", tipo: "build" }));
    await esperar(() => c.servico.estado(WS).fase === "concluida");
    expect(c.bus.map((b) => b.tipo)).toEqual(["run.started", "run.stopped"]);
    expect(c.bus[1]!.payload).toMatchObject({ resultado: "sucesso", codigo: 0 });
    expect(c.notificacoes).toEqual([]);
  });

  it("pré-passos em sequência no mesmo painel; falha de um aborta o resto", async () => {
    const c = criar();
    script(c, "pre.sh", "echo p >> ordem.txt");
    script(c, "run.sh", "echo r >> ordem.txt\nsleep 30");
    await rodar(c, cfg({ id: "br", nome: "Build e rodar", pre_passos: [{ executavel: "./pre.sh", argumentos: [] }] }));
    await esperar(() => c.servico.estado(WS).fase === "rodando" && c.servico.estado(WS).passo === 2);
    await esperar(() => readFileSync(join(c.raiz, "ordem.txt"), "utf8") === "p\nr\n");
    expect(readFileSync(join(c.raiz, "ordem.txt"), "utf8")).toBe("p\nr\n");
    const sessoes = c.eventos.filter((e) => e.tipo === "sessao");
    expect(sessoes).toHaveLength(2);
    expect(sessoes[1]).toMatchObject({ tipo: "sessao", anterior: (sessoes[0] as { sessao_id: string }).sessao_id });
    await c.servico.parar(WS);

    const d = criar();
    script(d, "pre.sh", "exit 7");
    script(d, "run.sh", "echo nao-deveria > rodou.txt");
    await rodar(d, cfg({ id: "br", pre_passos: [{ executavel: "./pre.sh", argumentos: [] }] }));
    await esperar(() => d.servico.estado(WS).fase === "falhou");
    expect(d.servico.estado(WS).mensagem).toBe("Pré-passo 1 de 1 falhou (código 7): veja o painel Execução.");
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(join(d.raiz, "rodou.txt"))).toBe(false);
  });

  it("modo shell opt-in executa a linha exata pelo /bin/sh", async () => {
    const c = criar();
    await rodar(c, cfg({ id: "sh", executavel: "", shell: "echo um > a.txt && echo dois > b.txt" }));
    await esperar(() => c.servico.estado(WS).fase === "concluida");
    expect(readFileSync(join(c.raiz, "b.txt"), "utf8").trim()).toBe("dois");
  });

  it("um processo exclusivo por workspace; configurações de grupos diferentes rodam juntas", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    await rodar(c, cfg({ id: "a", nome: "A", grupo: "api" }));
    c.servico.gravarConfig(WS, cfg({ id: "b", nome: "B", grupo: "web" }), false);
    const rb = await c.servico.iniciar(WS, { config_id: "b" });
    if (rb.resultado !== "confirmar") throw new Error("confirmar");
    expect((await c.servico.iniciar(WS, { config_id: "b", confirmar_hash: rb.pedido.hash })).resultado).toBe("iniciado");
    expect(c.servico.estados(WS).filter((e) => e.fase === "rodando")).toHaveLength(2);
    // mesmo grupo e exclusiva conflitam
    c.servico.gravarConfig(WS, cfg({ id: "a2", nome: "A2", grupo: "api" }), false);
    await expect(c.servico.iniciar(WS, { config_id: "a2" })).rejects.toThrow(/Já há uma execução em andamento/);
    c.servico.gravarConfig(WS, cfg({ id: "ex", nome: "Excl" }), false);
    await expect(c.servico.iniciar(WS, { config_id: "ex" })).rejects.toThrow(/Já há uma execução em andamento/);
    expect(await c.servico.parar(WS, "a")).toBe(true);
    expect(c.servico.estados(WS).filter((e) => e.fase === "rodando").map((e) => e.config_id)).toEqual(["b"]);
    await c.servico.parar(WS);
  });
});

describe("parar mata a árvore (sem órfãos)", () => {
  it("o neto em segundo plano (que ignora SIGINT) morre no passo seguinte e nada fica vivo", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 300 &\necho $! > filho.pid\nwait");
    await rodar(c, cfg());
    await esperar(() => existsSync(join(c.raiz, "filho.pid")));
    await new Promise((r) => setTimeout(r, 100));
    const filho = Number(readFileSync(join(c.raiz, "filho.pid"), "utf8").trim());
    expect(estaVivo(filho)).toBe(true);
    const t0 = Date.now();
    expect(await c.servico.parar(WS)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(c.servico.estado(WS)).toMatchObject({ fase: "parada", mensagem: "Rodar (dev) foi parado." });
    await esperar(() => !estaVivo(filho), 4_000);
    expect(fases(c)).toEqual(expect.arrayContaining(["preparando", "rodando", "parando", "parada"]));
    expect(c.bus.map((b) => b.tipo)).toEqual(["run.started", "run.stopped"]);
    expect(c.bus[1]!.payload).toMatchObject({ resultado: "parada" });
  });

  it("quem ignora SIGINT e SIGTERM é morto com SIGKILL, junto com os netos", async () => {
    const c = criar();
    script(c, "run.sh", "trap '' INT TERM\nsleep 300 &\necho $! > neto.pid\nwhile true; do sleep 1; done");
    await rodar(c, cfg());
    await esperar(() => existsSync(join(c.raiz, "neto.pid")));
    await new Promise((r) => setTimeout(r, 150));
    const neto = Number(readFileSync(join(c.raiz, "neto.pid"), "utf8").trim());
    const lider = [...vivos].at(-1)!;
    expect(estaVivo(neto)).toBe(true);
    expect(estaVivo(lider)).toBe(true);
    await c.servico.parar(WS);
    await esperar(() => !estaVivo(neto) && !estaVivo(lider), 4_000);
    expect(c.servico.estado(WS).fase).toBe("parada");
  });

  it("parar sem nada rodando devolve false; parar duas vezes seguidas é seguro", async () => {
    const c = criar();
    expect(await c.servico.parar(WS)).toBe(false);
    script(c, "run.sh", "sleep 300");
    await rodar(c, cfg());
    const [a, b] = await Promise.all([c.servico.parar(WS), c.servico.parar(WS)]);
    expect([a, b]).toEqual([true, true]);
    expect(c.servico.estado(WS).fase).toBe("parada");
  });

  it("reiniciar para e sobe de novo, reaproveitando o painel (a sessão anterior sai)", async () => {
    const c = criar();
    script(c, "run.sh", "echo $$ >> pids.txt\nsleep 300");
    await rodar(c, cfg());
    await esperar(() => existsSync(join(c.raiz, "pids.txt")));
    const primeira = c.servico.estado(WS).sessao_id!;
    const r = await c.servico.reiniciar(WS);
    expect(r.resultado).toBe("iniciado");
    await esperar(() => readFileSync(join(c.raiz, "pids.txt"), "utf8").trim().split("\n").length === 2);
    const [p1] = readFileSync(join(c.raiz, "pids.txt"), "utf8").trim().split("\n").map(Number);
    await esperar(() => !estaVivo(p1!), 3_000);
    const segunda = c.servico.estado(WS).sessao_id!;
    expect(segunda).not.toBe(primeira);
    const sessao = c.eventos.filter((e) => e.tipo === "sessao").at(-1);
    expect(sessao).toMatchObject({ sessao_id: segunda, anterior: primeira, focar: true });
    expect(c.gerenciador.listar().map((s) => s.sessao_id)).not.toContain(primeira);
    await c.servico.parar(WS);
  });

  it("fechar a aba 'Execução' (descartar a sessão) conta como parar, não como falha; a sessão antiga de um reuso é ignorada", async () => {
    const c = criar();
    script(c, "run.sh", "echo $$ > pid.txt\nsleep 300");
    await rodar(c, cfg());
    await esperar(() => existsSync(join(c.raiz, "pid.txt")));
    const pid = Number(readFileSync(join(c.raiz, "pid.txt"), "utf8").trim());
    const sid = c.servico.estado(WS).sessao_id!;
    c.servico.aoSessaoDescartada("sessao_que_nao_e_a_ativa");
    expect(c.servico.estado(WS).fase).toBe("rodando");
    // o IPC chama o gancho ANTES de o gerenciador descartar (e matar) a sessão
    c.servico.aoSessaoDescartada(sid);
    c.gerenciador.descartar(sid);
    expect(c.servico.estado(WS)).toMatchObject({ fase: "parada", mensagem: "Rodar (dev) foi parado." });
    expect(c.bus.map((b) => b.tipo)).toEqual(["run.started", "run.stopped"]);
    await esperar(() => !estaVivo(pid), 3_000);
    // pode rodar de novo
    expect((await c.servico.iniciar(WS, { config_id: "dev" })).resultado).toBe("iniciado");
  });

  it("fechar o app (encerrar) PARA tudo; com manter_ao_fechar deixa vivo", async () => {
    const c = criar();
    script(c, "run.sh", "echo $$ > pid.txt\nsleep 300");
    await rodar(c, cfg());
    await esperar(() => existsSync(join(c.raiz, "pid.txt")));
    const pid = Number(readFileSync(join(c.raiz, "pid.txt"), "utf8").trim());
    await c.servico.encerrar();
    await esperar(() => !estaVivo(pid), 3_000);
    await expect(c.servico.iniciar(WS, {})).rejects.toThrow(/fechando/);

    const d = criar({ preferencias: () => ({ manter_ao_fechar: true }) });
    script(d, "run.sh", "echo $$ > pid.txt\nsleep 300");
    await rodar(d, cfg());
    await esperar(() => existsSync(join(d.raiz, "pid.txt")));
    const pid2 = Number(readFileSync(join(d.raiz, "pid.txt"), "utf8").trim());
    await d.servico.encerrar();
    expect(estaVivo(pid2)).toBe(true);
    d.gerenciador.encerrarTodas();
    await esperar(() => !estaVivo(pid2), 3_000);
  });
});

describe("confinamento: injeção, cwd, symlink e executável", () => {
  it("cwd por symlink para fora, executável inexistente, symlink de executável para fora: recusados SEM lançar processo", async () => {
    const c = criar();
    const fora = realpathSync(mkdtempSync(join(tmpdir(), "executar-fora-")));
    limpar.push(fora);
    writeFileSync(join(fora, "x.sh"), "#!/bin/sh\necho invadido > ../invadido.txt\n");
    chmodSync(join(fora, "x.sh"), 0o755);
    symlinkSync(fora, join(c.raiz, "atalho"));
    symlinkSync(join(fora, "x.sh"), join(c.raiz, "x.sh"));
    script(c, "run.sh", "echo ok > ok.txt");
    const tenta = async (config: ConfigExecucao): Promise<string> => {
      c.servico.gravarConfig(WS, config, false);
      const r = await c.servico.iniciar(WS, { config_id: config.id });
      if (r.resultado !== "confirmar") throw new Error("esperava confirmação");
      try { await c.servico.iniciar(WS, { config_id: config.id, confirmar_hash: r.pedido.hash }); } catch (e) { return (e as Error).message; }
      return "NÃO FALHOU";
    };
    expect(await tenta(cfg({ id: "a", cwd: "atalho" }))).toMatch(/fora do workspace/);
    expect(await tenta(cfg({ id: "b", executavel: "./x.sh" }))).toMatch(/fora do workspace/);
    expect(await tenta(cfg({ id: "c", executavel: "programa-que-nao-existe-xyz" }))).toMatch(/não encontrado no PATH/);
    expect(await tenta(cfg({ id: "d", cwd: "nao-existe" }))).toMatch(/não existe/);
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(join(fora, "../invadido.txt"))).toBe(false);
    expect(c.servico.estado(WS).fase).toBe("ocioso");
    expect(c.gerenciador.listar()).toEqual([]);
  });

  it("argumentos com metacaracteres de shell chegam LITERAIS ao processo (nunca interpretados)", async () => {
    const c = criar();
    script(c, "run.sh", 'for a in "$@"; do echo "[$a]"; done > args.txt');
    await rodar(c, cfg({ id: "args", tipo: "build", argumentos: ["a b", "$(touch pwn)", "x; touch pwn2", "--flag=`id`", "*"] }));
    await esperar(() => c.servico.estado(WS).fase === "concluida");
    expect(readFileSync(join(c.raiz, "args.txt"), "utf8")).toBe("[a b]\n[$(touch pwn)]\n[x; touch pwn2]\n[--flag=`id`]\n[*]\n");
    expect(existsSync(join(c.raiz, "pwn"))).toBe(false);
    expect(existsSync(join(c.raiz, "pwn2"))).toBe(false);
  });

  it("workspace desconhecido", async () => {
    const c = criar();
    await expect(c.servico.iniciar("ws_ZZZZZZZZZZZZ", {})).rejects.toThrow("Workspace desconhecido.");
    expect(() => c.servico.listar("ws_ZZZZZZZZZZZZ")).toThrow(ErroExecutar);
  });
});

describe("configurações: detectadas + do usuário, padrão e persistência", () => {
  it("lista mescla detectadas e do usuário (usuário vence o mesmo id), marca padrão e confiança; sem nada: vazio", async () => {
    const c = criar();
    expect(c.servico.listar(WS)).toMatchObject({ vazio: true, configuracoes: [], armazenamento: "nenhum", padrao_id: null });
    expect(await c.servico.iniciar(WS, {})).toEqual({ resultado: "configurar" });
    writeFileSync(join(c.raiz, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build", test: "vitest" }, devDependencies: { vite: "5" } }));
    const l1 = c.servico.listar(WS);
    expect(l1.configuracoes.map((x) => x.id)).toEqual(expect.arrayContaining(["dev", "build", "test"]));
    expect(l1.padrao_id).toBe("dev");
    expect(l1.configuracoes.every((x) => !x.confiavel && x.origem === "detectada")).toBe(true);
    // o usuário edita a `dev` detectada (vira do usuário) e escolhe outra como padrão
    const l2 = c.servico.gravarConfig(WS, cfg({ id: "dev", nome: "Meu dev", executavel: "npm", argumentos: ["run", "dev", "--", "--host"] }), false);
    expect(l2.configuracoes.find((x) => x.id === "dev")).toMatchObject({ nome: "Meu dev", origem: "usuario", comando: "npm run dev -- --host" });
    expect(l2.armazenamento).toBe("arquivo");
    const l3 = c.servico.definirPadrao(WS, "build");
    expect(l3.padrao_id).toBe("build");
    expect(l3.configuracoes.filter((x) => x.padrao).map((x) => x.id)).toEqual(["build"]);
    expect(JSON.parse(readFileSync(join(c.raiz, ".expxv/executar.json"), "utf8")).padrao).toBe("build");
    // remover a do usuário devolve a detectada
    const l4 = c.servico.removerConfig(WS, "dev");
    expect(l4.configuracoes.find((x) => x.id === "dev")).toMatchObject({ origem: "detectada", nome: "Rodar (dev)" });
    expect(() => c.servico.definirPadrao(WS, "nao-existe")).toThrow(ErroExecutar);
  });

  it("iniciar sem config_id usa a padrão marcada", async () => {
    const c = criar();
    script(c, "a.sh", "echo a > a.txt");
    script(c, "b.sh", "echo b > b.txt");
    c.servico.gravarConfig(WS, cfg({ id: "a", nome: "A", tipo: "build", executavel: "./a.sh" }), false);
    c.servico.gravarConfig(WS, cfg({ id: "b", nome: "B", tipo: "build", executavel: "./b.sh" }), false);
    c.servico.definirPadrao(WS, "b");
    const r = await c.servico.iniciar(WS, {});
    if (r.resultado !== "confirmar") throw new Error("confirmar");
    expect(r.pedido.config_id).toBe("b");
  });

  it("emite `configuracoes` ao mudar e o arquivo nunca contém caminho absoluto", () => {
    const c = criar();
    c.servico.gravarConfig(WS, cfg(), false);
    expect(c.eventos).toContainEqual({ tipo: "configuracoes", workspace_id: WS });
    expect(readFileSync(join(c.raiz, ".expxv/executar.json"), "utf8")).not.toContain(c.raiz);
  });

  it("limite de configurações", () => {
    const c = criar();
    for (let i = 0; i < 40; i += 1) c.servico.gravarConfig(WS, cfg({ id: `c${i}` }), false);
    expect(() => c.servico.gravarConfig(WS, cfg({ id: "c40" }), false)).toThrow(/demais/);
  });
});

describe("reiniciar ao salvar (opcional)", () => {
  it("mudança observada reinicia a execução; sem a opção, nada observa", async () => {
    let gatilho: (() => void) | null = null;
    const observar = vi.fn((_r: string, f: () => void) => { gatilho = f; return () => { gatilho = null; }; });
    const c = criar({ observar });
    script(c, "run.sh", "echo $$ >> pids.txt\nsleep 300");
    await rodar(c, cfg({ reiniciar_ao_salvar: true }));
    await esperar(() => existsSync(join(c.raiz, "pids.txt")));
    expect(observar).toHaveBeenCalledTimes(1);
    gatilho!();
    gatilho!();
    await esperar(() => readFileSync(join(c.raiz, "pids.txt"), "utf8").trim().split("\n").length === 2, 10_000);
    expect(c.servico.estado(WS).fase).toBe("rodando");
    await c.servico.parar(WS);
    expect(gatilho).toBeNull();

    const d = criar({ observar });
    observar.mockClear();
    script(d, "run.sh", "sleep 300");
    await rodar(d, cfg());
    expect(observar).not.toHaveBeenCalled();
  });
});

describe("resumo para o MCP (somente leitura)", () => {
  it("fase, porta e tempo rodando; nunca comando nem ambiente", async () => {
    const c = criar();
    script(c, "run.sh", "echo http://localhost:4000/\nsleep 300");
    await rodar(c, cfg({ ambiente: { A: "b" } }));
    await esperar(() => c.servico.estado(WS).porta !== null);
    const r = c.servico.resumoMcp(WS);
    expect(r).toMatchObject({ workspace_id: WS, fase: "rodando", config_id: "dev", porta: 4000 });
    expect(typeof r.rodando_ha_s).toBe("number");
    expect(JSON.stringify(r)).not.toContain("run.sh");
    await c.servico.parar(WS);
  });
});

describe("desempenho (orçamentos do recurso)", () => {
  it("abrir o menu (listar com detecção) ≤ 50 ms, a frio e com cache por mtime", async () => {
    const c = criar();
    writeFileSync(join(c.raiz, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build", start: "vite preview", test: "vitest" }, devDependencies: { vite: "5" } }));
    writeFileSync(join(c.raiz, "Makefile"), "run:\n\techo x\n");
    const t0 = performance.now();
    const fria = c.servico.listar(WS);
    const frio = performance.now() - t0;
    const t1 = performance.now();
    c.servico.listar(WS);
    const quente = performance.now() - t1;
    expect(fria.configuracoes.length).toBeGreaterThan(4);
    expect(frio).toBeLessThan(50);
    expect(quente).toBeLessThan(50);
  });

  it("clique → processo iniciado (confirmado) ≤ 300 ms", async () => {
    const c = criar();
    script(c, "run.sh", "sleep 30");
    c.servico.gravarConfig(WS, cfg(), false);
    const r = await c.servico.iniciar(WS, { config_id: "dev" });
    if (r.resultado !== "confirmar") throw new Error("confirmar");
    const t0 = performance.now();
    const ok = await c.servico.iniciar(WS, { config_id: "dev", confirmar_hash: r.pedido.hash });
    const ms = performance.now() - t0;
    expect(ok.resultado).toBe("iniciado");
    expect(c.gerenciador.listar()).toHaveLength(1);
    expect(ms).toBeLessThan(300);
  });
});


describe("monorepo e prechecagens (D-580, D-581)", () => {
  it("lista as configurações das subpastas com cwd relativo e avisa sobre node_modules ausente sem executar nada", () => {
    const c = criar({ programaNoPath: (n) => n !== "docker" });
    mkdirSync(join(c.raiz, "desktop"), { recursive: true });
    writeFileSync(join(c.raiz, "desktop", "package.json"), JSON.stringify({ scripts: { dev: "node dev.js" }, devDependencies: { vite: "1" } }));
    mkdirSync(join(c.raiz, "infra"), { recursive: true });
    writeFileSync(join(c.raiz, "infra", "compose.yaml"), "services:\n  db:\n    image: postgres\n");
    const l = c.servico.listar(WS);
    const dev = l.configuracoes.find((x) => x.id === "desktop-dev")!;
    expect(dev).toMatchObject({ cwd: "desktop", nome: "desktop · Rodar (dev)", padrao: true });
    expect(dev.avisos).toEqual([expect.objectContaining({ codigo: "sem_node_modules", pre_passo: { executavel: "npm", argumentos: ["install"] } })]);
    expect(l.configuracoes.find((x) => x.cwd === "infra" && x.executavel === "docker")?.avisos?.[0]).toMatchObject({ codigo: "sem_docker" });
    expect(l.padrao_id).toBe("desktop-dev");
  });
});
