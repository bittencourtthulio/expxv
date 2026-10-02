// Serviço da suíte ExpxDev no main (D-470…) com `npm` e `expxdev` FALSOS (tests/fixtures/suite): sem rede, sem instalar nada de verdade.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listarProcessos, matarArvoreDaPasta, registrarPasta } from "../../tests/limpeza";
import type { EventoSuite, ProgressoSuite } from "../compartilhado/suite";
import { criarServicoSuite, ErroSuite, type DependenciasSuite } from "./suite";

const FIX = resolve(__dirname, "../../tests/fixtures/suite");
const base = realpathSync(mkdtempSync(join(tmpdir(), "suite-main-")));
registrarPasta(base);
afterAll(() => { matarArvoreDaPasta(base); rmSync(base, { recursive: true, force: true }); });
let n = 0;

const esperar = async (cond: () => boolean, ms = 30_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (cond()) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error("condição não atendida a tempo");
};

function montar(o: { projeto?: string; env?: Record<string, string>; prefs?: Record<string, unknown>; sonda?: DependenciasSuite["sondarRegistro"]; tempo?: number; silencio?: number } = {}) {
  n += 1;
  const dir = join(base, `s${n}`);
  mkdirSync(join(dir, "tmp"), { recursive: true });
  mkdirSync(join(dir, "home"), { recursive: true });
  const raiz = join(dir, "proj");
  cpSync(join(FIX, "projetos", o.projeto ?? "ausente"), raiz, { recursive: true });
  const prefs: Record<string, unknown> = { ...(o.prefs ?? {}) };
  const eventos: EventoSuite[] = [];
  const bus: Array<{ tipo: string; payload: unknown }> = [];
  const registrados: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
  const recarregados: string[] = [];
  const log = join(dir, "chamadas.jsonl");
  let sondas = 0;
  const deps: DependenciasSuite = {
    pastaDados: join(dir, "dados"), raizDe: (id) => (id === "ws_AAAAAAAAAAAA" ? raiz : null), emitir: (e) => eventos.push(e),
    barramento: { emitir: (tipo, payload) => bus.push({ tipo, payload }) }, registrarEvento: (tipo, payload) => registrados.push({ tipo, payload }),
    preferencias: { obter: (k) => prefs[k] ?? null, definir: async (k, v) => { prefs[k] = v; } },
    recarregarMetodo: async (id) => { recarregados.push(id); },
    statusGit: async () => ({ alteracoes: 2 }),
    ambienteOrigem: { PATH: `${join(FIX, "npm-falso")}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(dir, "home"), FAKE_LOG: log, FAKE_NPM_MODO: "ok", FAKE_INIT_MODO: "ok", ORCA_X: "1", ...(o.env ?? {}) },
    inicio: join(dir, "home"), pastaTemporaria: join(dir, "tmp"),
    sondarRegistro: o.sonda ?? (async () => { sondas += 1; return { ok: true }; }),
    tempoTotalMs: o.tempo ?? 30_000, silencioMs: o.silencio ?? 20_000, coalescerMs: 60, versaoDaApp: "0.0.0-teste",
  };
  const servico = criarServicoSuite(deps);
  const progressos = (): ProgressoSuite[] => eventos.filter((e): e is ProgressoSuite => e.tipo === "progresso");
  return { servico, raiz, dir, eventos, bus, registrados, recarregados, prefs, progressos, sondas: () => sondas, log };
}
const WS = "ws_AAAAAAAAAAAA";

describe("detecção e dispensa", () => {
  it("estado por workspace; workspace desconhecido é erro nominal", async () => {
    const m = montar();
    expect(await m.servico.estado(WS)).toMatchObject({ estado: "ausente", dispensado: false, instalando: false, versao_pedida: "0.9.0", versao_instalada: null });
    await expect(m.servico.estado("ws_BBBBBBBBBBBB")).rejects.toBeInstanceOf(ErroSuite);
    expect((await montar({ projeto: "completa" }).servico.estado(WS)).estado).toBe("completa");
  });

  it("'Agora não' é lembrado por workspace e pode ser reativado; emite o estado", async () => {
    const m = montar();
    const e1 = await m.servico.dispensar(WS, true);
    expect(e1.dispensado).toBe(true);
    expect((await m.servico.estado(WS)).dispensado).toBe(true);
    expect(m.prefs[`suite_dispensada_${WS}`]).toBe(true);
    expect((await m.servico.dispensar(WS, false)).dispensado).toBe(false);
    expect(m.eventos.filter((e) => e.tipo === "estado")).toHaveLength(2);
  });

  it("o cache é invalidado pelo observador e só publica quando o estado mudou", async () => {
    const m = montar({ projeto: "incompleta-sem-skill" });
    await m.servico.estado(WS);
    m.servico.aoMetodoMudou(WS);
    await new Promise((r) => setTimeout(r, 80));
    expect(m.eventos.filter((e) => e.tipo === "estado")).toHaveLength(0); // nada mudou: nada publicado
    cpSync(join(FIX, "projetos", "completa", ".claude", "skills", "memox"), join(m.raiz, ".claude", "skills", "memox"), { recursive: true });
    m.servico.aoMetodoMudou(WS);
    await esperar(() => m.eventos.some((e) => e.tipo === "estado"));
    const e = m.eventos.find((x) => x.tipo === "estado")!;
    expect(e.tipo === "estado" && e.estado.estado).toBe("completa");
  });
});

describe("requisitos (primeiro passo do modal)", () => {
  it("monta o plano SEM tocar a rede: internet fica pendente até o clique", async () => {
    const m = montar({ projeto: "ausente-com-claude" });
    const p = await m.servico.requisitos(WS);
    expect(p.modo).toBe("instalar");
    expect(p.versao).toBe("0.9.0");
    expect(p.skills).toHaveLength(9);
    expect(p.comando.join("\n")).toContain("expxdev@0.9.0");
    expect(p.pasta_alvo).not.toMatch(/^\/Users\//);
    expect(p.requisitos.find((r) => r.id === "internet")?.situacao).toBe("pendente");
    expect(p.requisitos.find((r) => r.id === "git")?.detalhe).toContain("2 alteração");
    expect(p.existentes.find((x) => x.pasta === ".claude")?.quantidade).toBe(1);
    expect(p.pode_instalar).toBe(true);
    expect(m.sondas()).toBe(0);
  });
  it("suíte incompleta propõe reparar; desatualizada propõe atualizar", async () => {
    expect((await montar({ projeto: "incompleta-sem-skill" }).servico.requisitos(WS)).modo).toBe("reparar");
    expect((await montar({ projeto: "desatualizada" }).servico.requisitos(WS)).modo).toBe("atualizar");
  });
});

describe("preferências hostis nunca viram argumento", () => {
  it("versão inválida volta ao padrão, registro http é ignorado, só flags no formato --palavra", async () => {
    const m = montar({ prefs: { suite_versao: "latest; rm -rf /", suite_registro: "http://evil.example/", suite_init_args: ["--yes", "rm -rf", "--x;y", 3, "--a", "--b", "--c", "--d", "--e"] } });
    await m.servico.instalar(WS, "instalar");
    await esperar(() => m.progressos().some((p) => p.fase !== "rodando"));
    const ch = readFileSync(m.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const npm = ch.find((c) => c["tipo"] === "install")!;
    expect((npm["argv"] as string[]).join(" ")).toContain("expxdev@0.9.0");
    expect((npm["argv"] as string[]).join(" ")).toContain("https://registry.npmjs.org/");
    const init = ch.find((c) => c["quem"] === "expxdev" && (c["argv"] as string[])[0] === "init")!;
    // --yes e --skills (a suíte completa) e --harness são do app; as flags extras do usuário vêm depois e nunca repetem as do app
    expect(init["argv"]).toEqual(["init", "--yes", "--skills", "sprintx,runx,legadox,stackx,mergex,memox,prodx,buildx,designx", "--harness", "claude,opencode", "--a", "--b", "--c", "--d"]);
  });
});

describe("instalação de ponta a ponta", () => {
  it("sucesso: devolve o id, coalesce o progresso, publica suite.instalada, registra o evento e relê o método", async () => {
    const m = montar({ projeto: "ausente-com-claude" });
    const { instalacao_id } = await m.servico.instalar(WS, "instalar");
    expect(instalacao_id).toMatch(/^suite_[0-9a-f]{16}$/);
    expect((await m.servico.estado(WS)).instalando).toBe(true);
    await esperar(() => m.progressos().some((p) => p.fase === "concluida"));
    const finais = m.progressos();
    expect(finais.at(-1)!.instalacao_id).toBe(instalacao_id);
    expect(finais.at(-1)!.resumo?.skills).toHaveLength(9);
    // coalescido: bem menos eventos que linhas de log
    expect(finais.length).toBeLessThan(40);
    expect(m.bus.map((b) => b.tipo)).toEqual(["suite.instalada"]);
    const pay = m.bus[0]!.payload as Record<string, unknown>;
    expect(pay).toMatchObject({ workspace_id: WS, versao: "0.9.0", skills: 9, modo: "instalar" });
    expect(JSON.stringify(pay)).not.toMatch(/\/Users\/|\/private\/|token/i);
    expect((pay["criados"] as string[])).toContain(".expx/expx-lock.json");
    expect(m.registrados.map((r) => r.tipo)).toEqual(["suite.instalada"]);
    expect(m.recarregados).toEqual([WS]);
    await esperar(() => m.eventos.some((e) => e.tipo === "estado" && e.estado.estado === "completa" && !e.estado.instalando));
    expect((await m.servico.estado(WS)).estado).toBe("completa");
    // nenhuma pasta temporária sobrou
    expect(readdirSync(join(m.dir, "tmp")).filter((x) => x.startsWith("suite-"))).toEqual([]);
  });

  it("um instalador por workspace por vez; suíte completa não instala de novo", async () => {
    const m = montar({ env: { FAKE_INIT_MODO: "trava" } });
    await m.servico.instalar(WS, "instalar");
    await expect(m.servico.instalar(WS, "instalar")).rejects.toThrow(/já há uma instalação/i);
    expect(await m.servico.cancelar(WS)).toBe(true);
    await esperar(() => m.progressos().some((p) => p.fase === "cancelada"));
    const c = montar({ projeto: "completa" });
    await expect(c.servico.instalar(WS, "instalar")).rejects.toThrow(/já está instalada/);
  });

  it("cancelar: árvore morta, limpeza segura, evento suite.cancelada e nada vivo", async () => {
    const m = montar({ projeto: "ausente-com-claude", env: { FAKE_INIT_MODO: "trava" } });
    await m.servico.instalar(WS, "instalar");
    await esperar(() => m.progressos().some((p) => p.log.some((l) => l.includes("meio da instalacao"))));
    expect(await m.servico.cancelar(WS)).toBe(true);
    await esperar(() => m.progressos().some((p) => p.fase === "cancelada"));
    expect(m.progressos().at(-1)!.limpeza).toMatch(/Removi/);
    expect(existsSync(join(m.raiz, ".expx"))).toBe(false);
    expect(m.bus.map((b) => b.tipo)).toEqual(["suite.cancelada"]);
    expect(m.recarregados).toEqual([]);
    expect(await m.servico.cancelar(WS)).toBe(false);
    await esperar(() => listarProcessos().filter((x) => x.comando.includes(m.dir)).length === 0);
  });

  it("falha publica suite.falhou sem log nem caminho no evento", async () => {
    const m = montar({ env: { FAKE_NPM_MODO: "rede" } });
    await m.servico.instalar(WS, "instalar");
    await esperar(() => m.progressos().some((p) => p.fase === "falhou"));
    await esperar(() => m.bus.length > 0); // o evento de domínio sai logo depois do último progresso
    expect(m.bus.map((b) => b.tipo)).toEqual(["suite.falhou"]);
    expect(m.bus[0]!.payload).toMatchObject({ causa: "sem_internet", etapa: "baixando" });
    expect(m.recarregados).toEqual([]);
  });

  it("encerrar (sair do app) cancela a instalação, mata a árvore e espera a limpeza", async () => {
    const m = montar({ env: { FAKE_NPM_MODO: "trava" } });
    await m.servico.instalar(WS, "instalar");
    await esperar(() => m.progressos().some((p) => p.log.some((l) => l.includes("registry"))));
    await m.servico.encerrar();
    expect(listarProcessos().filter((x) => x.comando.includes(m.dir))).toEqual([]);
    await expect(m.servico.instalar(WS, "instalar")).rejects.toThrow(/fechando/);
  });
});

describe("sem MCP para agentes iniciarem instalação", () => {
  it("nenhum arquivo do MCP cita a suíte", () => {
    const raiz = resolve(__dirname, "..");
    const pastas = [join(raiz, "nucleo", "mcp")];
    const arquivos: string[] = [join(__dirname, "mcp-worker.ts"), join(__dirname, "mcp-remoto.ts"), join(__dirname, "mcp-rpc.ts")];
    for (const p of pastas) for (const f of readdirSync(p)) if (f.endsWith(".ts") && !f.endsWith(".test.ts")) arquivos.push(join(p, f));
    const vazou = arquivos.filter((f) => existsSync(f) && /suite:|criarServicoSuite|ServicoSuite/.test(readFileSync(f, "utf8")));
    expect(vazou).toEqual([]);
  });
});
