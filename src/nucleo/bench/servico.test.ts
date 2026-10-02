// Integração do ServicoBench com a CLI falsa (tests/fixtures/cli-bench.mjs) e, no macOS, com o sandbox-exec REAL. Nenhuma chamada paga, nenhuma rede.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { criarSandboxIndisponivel, criarSandboxNenhum, type Sandbox } from "./sandbox/sandbox";
import { criarSandboxMacos } from "./sandbox/macos";
import { criarServicoBench, type DepsServicoBench, type ServicoBench } from "./servico";
import type { EventoBenchIpc, TarefaEditavel } from "./tipos";

const CLI = resolve(__dirname, "../../../tests/fixtures/cli-bench.mjs");
const AJUDA = "-p --output-format --permission-mode --strict-mcp-config --mcp-config --disable-slash-commands --no-session-persistence --model --effort --tools --json --skip-git-repo-check --ephemeral -s -C";
/** chave FALSA montada em runtime (nenhum segredo literal no arquivo versionado). */
const CHAVE_FALSA = ["sk", "ant", "abcdefghijklmnopqrstuvwxyz0123"].join("-");
const raiz = realpathSync(mkdtempSync(join(tmpdir(), "bench-svc-")));
const macos = process.platform === "darwin";
const bancos: Banco[] = [];
const servicos: ServicoBench[] = [];
const extras: string[] = [];
let seq = 0;

beforeAll(() => { mkdirSync(join(raiz, "tmp"), { recursive: true }); });
afterEach(async () => { for (const s of servicos.splice(0)) await s.encerrar(); delete process.env["SEGREDO_TESTE_TOKEN"]; delete process.env["CHAVE_TESTE_API_KEY"]; });
afterAll(() => { for (const b of bancos) b.fechar(); rmSync(raiz, { recursive: true, force: true }); for (const e of extras) rmSync(e, { recursive: true, force: true }); });

const tarefa = (slug: string, marcador: string, extra: Partial<TarefaEditavel> = {}): TarefaEditavel => ({ slug, titulo: slug, atividade: "web-interativa", tipo: "web", prompt: `Crie index.html. ${marcador}`, escopo: "", checagens: [{ tipo: "file_exists", alvo: "index.html", critica: true }], estado: "ativa", ...extra });

interface Amb { svc: ServicoBench; banco: Banco; base: string; eventos: EventoBenchIpc[]; deps: DepsServicoBench; relogio: { t: number } }

function ambiente(o: Partial<DepsServicoBench> & { sandbox?: "real" | "nenhum" | "indisponivel"; banco?: Banco; base?: string } = {}): Amb {
  const { sandbox, banco: bancoOpc, base: baseOpc, ...resto } = o;
  const base = baseOpc ?? join(raiz, `a${++seq}`);
  mkdirSync(base, { recursive: true });
  const banco = bancoOpc ?? abrirBanco(":memory:");
  if (bancoOpc === undefined) { bancos.push(banco); migrar(banco); }
  const eventos: EventoBenchIpc[] = [];
  const relogio = { t: 1_700_000_000_000 };
  const real: Sandbox = macos ? criarSandboxMacos({ pastaPerfis: join(base, "perfis"), tmp: join(raiz, "tmp") }) : criarSandboxNenhum();
  const sbx = sandbox === "indisponivel" ? criarSandboxIndisponivel() : sandbox === "nenhum" ? criarSandboxNenhum() : real;
  const deps: DepsServicoBench = {
    banco, pastaBench: join(base, "bench"), pastaDados: base, homeReal: join(base, "home-real"),
    sandboxPara: () => sbx, sandboxChecagens: sbx,
    contas: { resolver: (id) => ({ home: join(base, "contas", id, "home"), configDir: join(base, "contas", id, "cfg") }) },
    emitir: (e) => void eventos.push(e),
    relogio: () => relogio.t,
    prepararComando: (c) => ({ executavel: process.execPath, args: [CLI, ...c.args] }),
    lerAjuda: async () => AJUDA,
    ambientePai: () => ({ PATH: process.env["PATH"], LANG: "pt_BR.UTF-8", SEGREDO_TESTE_TOKEN: "vazou-token", CHAVE_TESTE_API_KEY: CHAVE_FALSA }),
    plataforma: macos && sandbox !== "nenhum" ? "darwin" : "win32",
    timeoutPadraoMs: 20_000,
    ...resto,
  };
  const svc = criarServicoBench(deps);
  servicos.push(svc);
  svc.alvosSalvar([
    { provedor: "anthropic", modelo: "modelo-a", esforco: "high", cli: "claude", conta_id: "cta_A", rotulo: null },
    { provedor: "anthropic", modelo: "modelo-b", esforco: null, cli: "claude", conta_id: "cta_B", rotulo: null },
    { provedor: "openai", modelo: "modelo-j", esforco: null, cli: "claude", conta_id: "cta_J", rotulo: null },
  ]);
  return { svc, banco, base, eventos, deps, relogio };
}
const A = "anthropic-modelo-a-high";
const B = "anthropic-modelo-b-padrao";
const J = "openai-modelo-j-padrao";

async function rodarCompleto(a: Amb, tarefas: string[], alvos: string[], extra: { max_paralelo?: number; teto_usd?: number | null; juiz_alvo?: string | null } = {}) {
  const est = await a.svc.estimar({ tarefas, alvos, max_paralelo: extra.max_paralelo ?? 3, teto_usd: extra.teto_usd ?? null, juiz_alvo: extra.juiz_alvo ?? null });
  const c = a.svc.consentir(est.estimativa_id, est.frase_exigida ?? "RODAR");
  if ("erro" in c) throw new Error(`consentir: ${c.erro} ${est.avisos.join(" | ")}`);
  const r = await a.svc.rodar(est.estimativa_id, c.token);
  if ("erro" in r) throw new Error(`rodar: ${r.erro}`);
  await a.svc.aguardar();
  return { est, run_id: r.run_id };
}
const rotulosDe = (prompt: string): string[] => [...new Set([...prompt.matchAll(/ENTREGA ([A-Z])\b/g)].map((m) => m[1] as string))];
const respostaOk = (rotulos: string[]) => ({ scores: Object.fromEntries(rotulos.map((r, i) => [r, { functionality: 9 - i, visual: 8, completeness: 9 - i, robustness: 8, overall: 9, rationale: "ok" }])), ranking: rotulos });
const juizOk: DepsServicoBench["chamarJuiz"] = async (_alvo, prompt) => ({ texto: JSON.stringify(respostaOk(rotulosDe(prompt))), custo_usd: null });
const wdDe = (a: Amb, id: string): string => join(a.deps.pastaBench, "exec", ...((a.svc.repos.resultados.obter(id)?.workdir ?? "") as string).split("/"));
async function tokenJulgar(a: Amb, tarefas: string[], alvos: string[], juiz: string) {
  const est = await a.svc.estimar({ tarefas, alvos, max_paralelo: 3, teto_usd: null, juiz_alvo: juiz });
  return a.svc.consentir(est.estimativa_id, est.frase_exigida ?? "RODAR", "julgar") as { token: string };
}

describe("catálogo e semente", () => {
  it("semeia as 9 tarefas (7 ativas, 2 rascunho) e a semente passa na validação", () => {
    const a = ambiente();
    const todas = a.svc.tarefasListar(null, null);
    expect(todas).toHaveLength(9);
    expect(todas.filter((t) => t.estado === "ativa")).toHaveLength(7);
    expect(todas.filter((t) => t.estado === "rascunho").map((t) => t.slug).sort()).toEqual(["apple-site-clone", "fps-dust2"]);
    expect(a.svc.tarefasListar("bug", null).map((t) => t.slug)).toEqual(["debug-find-and-fix"]);
  });
  it("salvar com esforço no prompt é recusado; só mudar o título não incrementa a versão; mudar o prompt incrementa", () => {
    const a = ambiente();
    expect(a.svc.tarefaSalvar(tarefa("t-esforco", "faça em extra high"))).toEqual({ erro: "esforco_no_prompt" });
    expect(a.svc.tarefaSalvar(tarefa("t-vazia", "", { prompt: "   " }))).toEqual({ erro: "prompt_vazio" });
    expect(a.svc.tarefaSalvar(tarefa("t-chk", "x", { checagens: [{ tipo: "command_exit_zero", alvo: "rm -rf /", critica: true }] }))).toEqual({ erro: "checagem_invalida" });
    expect((a.svc.tarefaSalvar(tarefa("t-ok", "x")) as { versao: number }).versao).toBe(1);
    expect((a.svc.tarefaSalvar({ ...tarefa("t-ok", "x"), titulo: "outro título" }) as { versao: number }).versao).toBe(1);
    expect((a.svc.tarefaSalvar(tarefa("t-ok", "y")) as { versao: number }).versao).toBe(2);
  });
  it("tarefa aposentada some do seletor ativo e continua listável", () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("t-vel", "x", { estado: "aposentada" }));
    expect(a.svc.tarefasListar(null, "ativa").map((t) => t.slug)).not.toContain("t-vel");
    expect(a.svc.tarefasListar(null, "aposentada").map((t) => t.slug)).toContain("t-vel");
  });
});

describe("Run completa: 3 tarefas × 2 alvos", () => {
  it("executa em workdirs distintos, coleta duração/uso/custo, emite progresso e só conclui com decisão", async () => {
    const a = ambiente();
    for (const s of ["t1", "t2", "t3"]) a.svc.tarefaSalvar(tarefa(s, "entrega normal"));
    const { run_id } = await rodarCompleto(a, ["t1", "t2", "t3"], [A, B]);
    const g = a.svc.estadoRun(run_id);
    expect(g.resultados).toHaveLength(6);
    expect(g.resultados.every((r) => r.estado === "concluido")).toBe(true);
    expect(g.resultados.every((r) => r.duracao_s !== null && r.duracao_s > 0 && r.custo_usd === 0.0123 && r.custo_fonte === "relatorio_cli")).toBe(true);
    expect(g.run.estado).toBe("julgando"); // sem nota ainda: não conclui sem decisão
    const d0 = a.svc.resultado(g.resultados[0]!.id);
    expect([d0.tokens_in, d0.tokens_out, d0.turnos]).toEqual([1000, 500, 3]);
    expect(d0.checagens.every((c) => c.ok)).toBe(true);
    expect(d0.isolamento).toBe("garantido");
    expect(new Set(g.resultados.map((r) => a.svc.repos.resultados.obter(r.id)!.workdir)).size).toBe(6);
    expect(a.eventos.some((e) => e.tipo === "progresso" && e.concluidos === 6 && e.total === 6)).toBe(true);
    expect(a.eventos.at(-1)).toMatchObject({ tipo: "run_terminou", run_id });
    // o preço entra no resultado e nada de `max_paralelo` estourado: no máximo 3 executando ao mesmo tempo
    expect(g.run.max_paralelo).toBe(3);
  });
  it("nunca mais que max_paralelo executando ao mesmo tempo", async () => {
    const a = ambiente();
    for (const s of ["q1", "q2", "q3", "q4", "q5", "q6"]) a.svc.tarefaSalvar(tarefa(s, "MODO:LENTO:250"));
    let pico = 0;
    const timer = setInterval(() => { const n = a.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM bench_resultado WHERE estado='executando'")!.n; if (n > pico) pico = n; }, 15);
    await rodarCompleto(a, ["q1", "q2", "q3", "q4", "q5", "q6"], [A], { max_paralelo: 2 });
    clearInterval(timer);
    expect(pico).toBeGreaterThan(0);
    expect(pico).toBeLessThanOrEqual(2);
  });
});

describe("consentimento: sem token válido nada executa", () => {
  async function estimativa(a: Amb) { a.svc.tarefaSalvar(tarefa("tc", "entrega")); return a.svc.estimar({ tarefas: ["tc"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null }); }
  const contarRuns = (a: Amb) => a.svc.runsListar(null).itens.length;

  it("frase diferente de RODAR não gera token", async () => {
    const a = ambiente();
    const est = await estimativa(a);
    expect(a.svc.consentir(est.estimativa_id, "rodar")).toEqual({ erro: "confirmacao_invalida" });
    expect(a.svc.consentir(est.estimativa_id, "RODAR ")).toEqual({ erro: "confirmacao_invalida" });
    expect(a.svc.consentir("est_inexistente", "RODAR")).toEqual({ erro: "estimativa_desconhecida" });
  });
  it("token ausente/forjado, reutilizado, expirado e de outra estimativa → consentimento_invalido, sem Run", async () => {
    const a = ambiente();
    const est = await estimativa(a);
    const est2 = await a.svc.estimar({ tarefas: ["tc"], alvos: [B], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    expect(await a.svc.rodar(est.estimativa_id, "token-forjado")).toEqual({ erro: "consentimento_invalido" });
    const t1 = a.svc.consentir(est.estimativa_id, "RODAR") as { token: string };
    expect(await a.svc.rodar(est2.estimativa_id, t1.token)).toEqual({ erro: "consentimento_invalido" });
    const t2 = a.svc.consentir(est.estimativa_id, "RODAR") as { token: string };
    a.relogio.t += 121_000; // TTL 120 s
    expect(await a.svc.rodar(est.estimativa_id, t2.token)).toEqual({ erro: "consentimento_invalido" });
    expect(contarRuns(a)).toBe(0);
    const est3 = await estimativa(a);
    const t3 = a.svc.consentir(est3.estimativa_id, "RODAR") as { token: string };
    expect("run_id" in (await a.svc.rodar(est3.estimativa_id, t3.token))).toBe(true);
    await a.svc.aguardar();
    expect(await a.svc.rodar(est3.estimativa_id, t3.token)).toEqual({ erro: "consentimento_invalido" }); // reutilizado
    expect(contarRuns(a)).toBe(1);
  });
  it("tarefa mudou entre o consentimento e a execução (versão nova) → o token deixa de valer", async () => {
    const a = ambiente();
    const est = await estimativa(a);
    const t = a.svc.consentir(est.estimativa_id, "RODAR") as { token: string };
    a.svc.tarefaSalvar(tarefa("tc", "entrega MUDOU"));
    expect(await a.svc.rodar(est.estimativa_id, t.token)).toEqual({ erro: "consentimento_invalido" });
    expect(contarRuns(a)).toBe(0);
  });
  it("alvo mudou (conta) depois do consentimento → o token deixa de valer", async () => {
    const a = ambiente();
    const est = await estimativa(a);
    const t = a.svc.consentir(est.estimativa_id, "RODAR") as { token: string };
    a.svc.alvosSalvar([{ provedor: "anthropic", modelo: "modelo-a", esforco: "high", cli: "claude", conta_id: "cta_OUTRA", rotulo: null }, { provedor: "anthropic", modelo: "modelo-b", esforco: null, cli: "claude", conta_id: "cta_B", rotulo: null }]);
    expect(await a.svc.rodar(est.estimativa_id, t.token)).toEqual({ erro: "consentimento_invalido" });
  });
  it("re-run e julgamento também exigem token próprio (e da finalidade certa)", async () => {
    const a = ambiente({ chamarJuiz: juizOk });
    a.svc.tarefaSalvar(tarefa("tr", "entrega"));
    const { run_id } = await rodarCompleto(a, ["tr"], [A]);
    await expect(a.svc.rerodar(run_id, "tr", A, "forjado")).resolves.toEqual({ erro: "consentimento_invalido" });
    const est = await a.svc.estimar({ tarefas: ["tr"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    const tRodar = a.svc.consentir(est.estimativa_id, "RODAR", "rodar") as { token: string };
    await expect(a.svc.rerodar(run_id, "tr", A, tRodar.token)).resolves.toEqual({ erro: "consentimento_invalido" }); // finalidade errada
    await expect(a.svc.julgar(run_id, null, J, "forjado")).resolves.toEqual({ erro: "consentimento_invalido" });
    expect(a.svc.repos.vereditos.contarDaRun(run_id)).toBe(0);
  });
});

describe("sandbox obrigatório", () => {
  it("sem sandbox utilizável a Run é RECUSADA: estimativa sem frase, consentir recusa, nenhuma Run", async () => {
    const a = ambiente({ sandbox: "indisponivel" });
    a.svc.tarefaSalvar(tarefa("ts", "entrega"));
    const est = await a.svc.estimar({ tarefas: ["ts"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    expect(est.sandbox).toBe("indisponivel");
    expect(est.frase_exigida).toBeNull();
    expect(est.avisos.join(" ")).toMatch(/não posso rodar/);
    expect(a.svc.consentir(est.estimativa_id, "RODAR")).toEqual({ erro: "confirmacao_invalida" });
    expect(a.svc.runsListar(null).itens).toHaveLength(0);
  });
  it("alvo some dos disponíveis com o motivo (flag removida do --help; sem conta dedicada)", async () => {
    const a = ambiente({ lerAjuda: async () => AJUDA.replace("--strict-mcp-config", "") });
    const l = await a.svc.alvosListar();
    expect(l.every((x) => !x.disponivel)).toBe(true);
    expect(l[0]!.motivo).toMatch(/não oferece/);
    const b = ambiente();
    b.svc.alvosSalvar([{ provedor: "anthropic", modelo: "m", esforco: null, cli: "claude", conta_id: null, rotulo: null }]);
    expect((await b.svc.alvosListar())[0]!.motivo).toMatch(/conta dedicada/);
  });
  it("sem sandbox (Windows, P-38) só com a frase reforçada, e marca isolamento parcial", async () => {
    const a = ambiente({ sandbox: "nenhum", plataforma: "win32" });
    a.svc.tarefaSalvar(tarefa("tw", "entrega"));
    const est = await a.svc.estimar({ tarefas: ["tw"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    expect(est.sandbox).toBe("nenhum");
    expect(est.frase_exigida).toBe("RODAR SEM SANDBOX");
    expect(a.svc.consentir(est.estimativa_id, "RODAR")).toEqual({ erro: "confirmacao_invalida" });
    const t = a.svc.consentir(est.estimativa_id, "RODAR SEM SANDBOX") as { token: string };
    const r = (await a.svc.rodar(est.estimativa_id, t.token)) as { run_id: string };
    await a.svc.aguardar();
    expect(a.svc.resultado(a.svc.estadoRun(r.run_id).resultados[0]!.id).isolamento).toBe("parcial");
  });
  it("o sandbox 'nenhum' fora do Windows é tratado como indisponível (recusa)", async () => {
    const a = ambiente({ sandbox: "nenhum", plataforma: "linux" });
    a.svc.tarefaSalvar(tarefa("tl2", "entrega"));
    const est = await a.svc.estimar({ tarefas: ["tl2"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    expect(est.sandbox).toBe("indisponivel");
    expect(est.frase_exigida).toBeNull();
  });
});

describe("ambiente e isolamento do filho", () => {
  it("o filho NÃO recebe segredo do pai nem token do app; HOME é o da conta dedicada", async () => {
    process.env["SEGREDO_TESTE_TOKEN"] = "vazou-token";
    process.env["CHAVE_TESTE_API_KEY"] = CHAVE_FALSA;
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("te", "MODO:ENV"));
    const { run_id } = await rodarCompleto(a, ["te"], [A]);
    const r = a.svc.estadoRun(run_id).resultados[0]!;
    const env = JSON.parse(readFileSync(join(wdDe(a, r.id), "env.json"), "utf8")) as Record<string, string>;
    expect(env["SEGREDO_TESTE_TOKEN"]).toBeUndefined();
    expect(env["CHAVE_TESTE_API_KEY"]).toBeUndefined();
    expect(env["HOME"]).toBe(join(a.base, "contas", "cta_A", "home"));
    expect(env["CLAUDE_CONFIG_DIR"]).toBe(join(a.base, "contas", "cta_A", "cfg"));
    expect(JSON.stringify(env)).not.toMatch(/vazou|abcdefghijklmnop/);
    expect(Object.keys(env).every((k) => !/TOKEN|KEY|SECRET|PASSWORD|SSH_AUTH/i.test(k))).toBe(true);
  });
  it("o esforço vai como flag e NUNCA no prompt entregue por stdin", async () => {
    const reg = join(raiz, "tmp", `reg${++seq}.json`);
    const a = ambiente({ ambienteExtra: { CLI_FALSA_REGISTRO: reg } });
    a.svc.tarefaSalvar(tarefa("tf", "entrega"));
    await rodarCompleto(a, ["tf"], [A]);
    const o = JSON.parse(readFileSync(reg, "utf8")) as { args: string[]; stdin: string };
    expect(o.args[o.args.indexOf("--effort") + 1]).toBe("high");
    expect(o.args).toContain("bypassPermissions");
    expect(o.args[o.args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect(o.stdin).not.toMatch(/high|effort|esforço/i);
    expect(o.stdin).toMatch(/headless/);
  });
  it.skipIf(!macos)("ESCAPE do sandbox (macOS real): escrita fora do workdir e leitura de credencial falsa FALHAM", async () => {
    const fora = join(process.cwd(), `.bench-escape-${process.pid}-${Date.now()}`);
    extras.push(fora);
    const a = ambiente();
    const credencial = join(a.base, "home-real", ".ssh", "id_falso");
    mkdirSync(join(a.base, "home-real", ".ssh"), { recursive: true });
    writeFileSync(credencial, "CHAVE-FALSA-NAO-VAZAR");
    a.svc.tarefaSalvar(tarefa("tx", `MODO:ESCAPE:${fora} MODO:LER:${credencial}`));
    const { run_id } = await rodarCompleto(a, ["tx"], [A]);
    const wd = wdDe(a, a.svc.estadoRun(run_id).resultados[0]!.id);
    expect(JSON.parse(readFileSync(join(wd, "escape.json"), "utf8"))).toEqual({ escreveu: false });
    expect(existsSync(fora)).toBe(false);
    expect(JSON.parse(readFileSync(join(wd, "leu.json"), "utf8"))).toEqual({ leu: null });
  });
});

describe("falha, timeout, cancelamento e boot", () => {
  it("falha → falhou, nota 0 automática e sem retentativa; timeout preserva o artefato parcial", async () => {
    const a = ambiente({ timeoutPadraoMs: 900 });
    a.svc.tarefaSalvar(tarefa("tfal", "MODO:FALHA"));
    a.svc.tarefaSalvar(tarefa("ttmo", "MODO:TIMEOUT", { checagens: [{ tipo: "file_exists", alvo: "parcial.html", critica: false }] }));
    const { run_id } = await rodarCompleto(a, ["tfal", "ttmo"], [A]);
    const rs = a.svc.estadoRun(run_id).resultados;
    const fal = rs.find((r) => r.tarefa === "tfal")!;
    const tmo = rs.find((r) => r.tarefa === "ttmo")!;
    expect(fal.estado).toBe("falhou");
    expect(fal.qualidade).toBe(0);
    expect(fal.juiz_estado).toBe("feito");
    expect(a.svc.resultado(fal.id).tentativa).toBe(1);
    expect(tmo.estado).toBe("tempo_esgotado");
    const d = a.svc.resultado(tmo.id);
    expect(d.artefatos.map((x) => x.nome)).toContain("parcial.html");
    expect(d.checagens[0]?.ok).toBe(true);
    expect(tmo.qualidade).toBeNull(); // há artefato: precisa de juiz/nota manual
  });
  it("cancelar mata a ÁRVORE (inclusive o neto), marca cancelada e deixa 0 processos", async () => {
    const a = ambiente({ timeoutPadraoMs: 60_000 });
    a.svc.tarefaSalvar(tarefa("tk", "MODO:FILHO", { checagens: [] }));
    const est = await a.svc.estimar({ tarefas: ["tk"], alvos: [A, B], max_paralelo: 2, teto_usd: null, juiz_alvo: null });
    const c = a.svc.consentir(est.estimativa_id, est.frase_exigida!) as { token: string };
    const { run_id } = (await a.svc.rodar(est.estimativa_id, c.token)) as { run_id: string };
    const t0 = Date.now();
    const filhos: Array<{ pid: number; neto: number }> = [];
    while (filhos.length < 2 && Date.now() - t0 < 10_000) {
      filhos.length = 0;
      for (const r of a.svc.repos.resultados.daRun(run_id)) {
        const p = r.workdir === null ? "" : join(a.deps.pastaBench, "exec", ...r.workdir.split("/"), "filhos.json");
        if (p !== "" && existsSync(p)) { try { filhos.push(JSON.parse(readFileSync(p, "utf8")) as { pid: number; neto: number }); } catch { /* escrevendo */ } }
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(filhos).toHaveLength(2);
    const c0 = Date.now();
    expect(await a.svc.cancelar(run_id)).toBe(true);
    expect(Date.now() - c0).toBeLessThan(3000);
    await new Promise((r) => setTimeout(r, 150));
    for (const f of filhos) for (const pid of [f.pid, f.neto]) expect(() => process.kill(pid, 0)).toThrow();
    const g = a.svc.estadoRun(run_id);
    expect(g.run.estado).toBe("cancelada");
    expect(g.resultados.every((r) => r.estado === "cancelado")).toBe(true);
  });
  it("reiniciar o app com Run executando → interrompida; nada retoma sozinho", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("ti", "x"));
    const run = a.svc.repos.runs.criar({ nome: "n", tarefas: [{ slug: "ti", versao: 1 }], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null, pesos: { q: 0.6, s: 0.2, c: 0.2 }, sandbox: "macos" });
    const res = a.svc.repos.resultados.criar({ run_id: run.id, tarefa_slug: "ti", tarefa_versao: 1, alvo_slug: A });
    a.svc.repos.runs.atualizar(run.id, { estado: "executando" });
    a.svc.repos.resultados.atualizar(res.id, { estado: "executando" });
    const b = ambiente({ banco: a.banco, base: a.base });
    expect(b.svc.estadoRun(run.id).run.estado).toBe("interrompida");
    expect(b.svc.estadoRun(run.id).resultados[0]!.estado).toBe("interrompido");
    await new Promise((r) => setTimeout(r, 100));
    expect(b.svc.estadoRun(run.id).resultados[0]!.estado).toBe("interrompido");
  });
});

describe("custo: nunca zero por falta de dado", () => {
  it("sem custo relatado e sem preço → null + desconhecido; com preço → tabela_precos (equivalente_api); preço alterado depois não muda o resultado antigo", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tcu", "MODO:SEMCUSTO"));
    const r1 = await rodarCompleto(a, ["tcu"], [A]);
    const x1 = a.svc.estadoRun(r1.run_id).resultados[0]!;
    expect(x1.custo_usd).toBeNull();
    expect(x1.custo_fonte).toBe("desconhecido");
    a.svc.precosGravar([{ provedor: "anthropic", modelo: "modelo-a", preco_in_mtok: 3, preco_out_mtok: 15, preco_cache_mtok: null, vale_desde: "2020-01-01T00:00:00.000Z" }]);
    const r2 = await rodarCompleto(a, ["tcu"], [A]);
    const x2 = a.svc.estadoRun(r2.run_id).resultados[0]!;
    expect(x2.custo_fonte).toBe("tabela_precos");
    expect(x2.custo_usd).toBeCloseTo((1100 * 3 + 500 * 15) / 1e6, 6); // (1000 in + 100 cache) × 3 + 500 out × 15, por milhão
    expect(a.svc.resultado(x2.id).custo_tipo).toBe("equivalente_api");
    a.svc.precosGravar([{ provedor: "anthropic", modelo: "modelo-a", preco_in_mtok: 300, preco_out_mtok: 1500, preco_cache_mtok: null, vale_desde: "2020-01-01T00:00:00.000Z" }]);
    expect(a.svc.estadoRun(r2.run_id).resultados[0]!.custo_usd).toBeCloseTo((1100 * 3 + 500 * 15) / 1e6, 6);
    expect(a.svc.repos.resultados.obter(x2.id)!.preco?.preco_in_mtok).toBe(3);
  });
  it("estimativa sem histórico nem preço → custo desconhecido (nunca 0); com histórico → faixa", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("te2", "entrega"));
    const e1 = await a.svc.estimar({ tarefas: ["te2"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    expect([e1.custo_min_usd, e1.custo_max_usd, e1.alvos_sem_custo]).toEqual([null, null, 1]);
    expect(e1.avisos.join(" ")).toMatch(/Custo desconhecido/);
    await rodarCompleto(a, ["te2"], [A]);
    const e2 = await a.svc.estimar({ tarefas: ["te2"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    expect([e2.custo_min_usd, e2.custo_max_usd, e2.alvos_sem_custo]).toEqual([0.0123, 0.0123, 0]);
  });
  it("teto_usd: para de lançar pares novos quando o custo conhecido estoura", async () => {
    const a = ambiente();
    for (const s of ["u1", "u2", "u3", "u4"]) a.svc.tarefaSalvar(tarefa(s, "entrega"));
    const { run_id } = await rodarCompleto(a, ["u1", "u2", "u3", "u4"], [A], { max_paralelo: 1, teto_usd: 0.02 });
    const rs = a.svc.estadoRun(run_id).resultados;
    expect(rs.filter((r) => r.estado === "concluido")).toHaveLength(2); // 0,0123 + 0,0123 ≥ 0,02
    expect(rs.filter((r) => r.estado === "enfileirado" && /teto de custo/.test(r.aviso ?? ""))).toHaveLength(2);
  });
});

describe("conta sem limite", () => {
  it("o par fica enfileirado com aviso, a conta NÃO muda e a Run termina parcial", async () => {
    const a = ambiente({ limites: { estadoConta: (c) => (c === "cta_B" ? "sem_limite" : "ok") } });
    a.svc.tarefaSalvar(tarefa("tl", "entrega"));
    const { run_id } = await rodarCompleto(a, ["tl"], [A, B]);
    const rs = a.svc.estadoRun(run_id).resultados;
    const b = rs.find((r) => r.alvo === B)!;
    expect(b.estado).toBe("enfileirado");
    expect(b.aviso).toMatch(/NÃO foi trocada/);
    expect(rs.find((r) => r.alvo === A)!.estado).toBe("concluido");
    expect(a.svc.repos.alvos.obter(B)!.conta_id).toBe("cta_B");
  });
});

describe("re-run", () => {
  it("recria a pasta, cria tentativa 2 e marca a anterior como substituída", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("trr", "entrega"));
    const { run_id } = await rodarCompleto(a, ["trr"], [A]);
    const antes = a.svc.estadoRun(run_id).resultados[0]!;
    const wd = wdDe(a, antes.id);
    writeFileSync(join(wd, "sobra.txt"), "sobra da tentativa 1");
    const est = await a.svc.estimar({ tarefas: ["trr"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    const t = a.svc.consentir(est.estimativa_id, "RODAR", "rerodar") as { token: string };
    const novo = (await a.svc.rerodar(run_id, "trr", A, t.token)) as { resultado_id: string };
    await a.svc.aguardar();
    expect(existsSync(join(wd, "sobra.txt"))).toBe(false);
    expect(a.svc.repos.resultados.obter(antes.id)!.estado).toBe("substituido");
    const depois = a.svc.resultado(novo.resultado_id);
    expect([depois.tentativa, depois.estado]).toEqual([2, "concluido"]);
    expect(a.svc.estadoRun(run_id).resultados.map((r) => r.id)).toEqual([novo.resultado_id]);
  });
});

describe("julgamento", () => {
  async function comResultados(juiz?: DepsServicoBench["chamarJuiz"]) {
    const a = ambiente({ ...(juiz === undefined ? {} : { chamarJuiz: juiz }) });
    a.svc.tarefaSalvar(tarefa("tj", "entrega"));
    const r = await rodarCompleto(a, ["tj"], [A, B]);
    return { a, run_id: r.run_id };
  }
  it("juiz de outro provedor dá nota, cria veredito e conclui a Run; o mapa cego NÃO aparece em nenhuma saída", async () => {
    const { a, run_id } = await comResultados(async (_alvo, prompt) => {
      expect(prompt).not.toMatch(/modelo-a|modelo-b|anthropic|openai/i);
      return { texto: JSON.stringify(respostaOk(rotulosDe(prompt))), custo_usd: 0.002 };
    });
    const t = await tokenJulgar(a, ["tj"], [A, B], J);
    const r = (await a.svc.julgar(run_id, null, J, t.token)) as { veredito_ids: string[] };
    expect(r.veredito_ids).toHaveLength(1);
    const g = a.svc.estadoRun(run_id);
    expect(g.resultados.every((x) => x.juiz_estado === "feito" && x.qualidade !== null)).toBe(true);
    expect(g.run.estado).toBe("concluida");
    const saidas = JSON.stringify([g, a.svc.resultado(g.resultados[0]!.id), a.svc.comparar([A, B], null, "tarefa")]);
    expect(saidas).not.toMatch(/mapa/i);
    expect(a.svc.repos.vereditos.daRun(run_id)[0]!.custo_juiz_usd).toBe(0.002);
  });
  it("juiz igual a um executor é recusado", async () => {
    const { a, run_id } = await comResultados(juizOk);
    // a estimativa só enxerga o alvo B (o juiz A passa), mas a Run tem resultados do A: o julgamento confere os executores REAIS dos resultados
    const t = await tokenJulgar(a, ["tj"], [B], A);
    await expect(a.svc.julgar(run_id, null, A, t.token)).resolves.toEqual({ erro: "juiz_igual_a_executor" });
    // e a própria estimativa já recusa juiz = executor
    const est = await a.svc.estimar({ tarefas: ["tj"], alvos: [A, B], max_paralelo: 1, teto_usd: null, juiz_alvo: A });
    expect(est.frase_exigida).toBeNull();
    expect(est.avisos.join(" ")).toMatch(/juiz não pode ser/);
  });
  it("JSON inválido 2× → juiz_estado erro, sem nota, a Run NÃO conclui sem decisão; a nota manual destrava", async () => {
    let chamadas = 0;
    const { a, run_id } = await comResultados(async () => { chamadas++; return { texto: "isto não é json", custo_usd: null }; });
    const t = await tokenJulgar(a, ["tj"], [A, B], J);
    await a.svc.julgar(run_id, null, J, t.token);
    expect(chamadas).toBe(2); // 1 retry
    const g = a.svc.estadoRun(run_id);
    expect(g.resultados.every((x) => x.juiz_estado === "erro" && x.qualidade === null)).toBe(true);
    expect(g.run.estado).toBe("julgando");
    for (const x of g.resultados) expect(a.svc.notaManual(x.id, 7.5, "ok")).toBe(true);
    const g2 = a.svc.estadoRun(run_id);
    expect(g2.resultados.every((x) => x.juiz_estado === "manual" && x.qualidade === 7.5)).toBe(true);
    expect(g2.run.estado).toBe("concluida");
    expect(a.svc.notaManual(g2.resultados[0]!.id, 11, null)).toBe(false);
    expect(a.svc.notaManual("bres_inexistente", 5, null)).toBe(false);
  });
  it("rejulgar mantém os resultados e cria NOVO veredito; nota manual não é sobrescrita", async () => {
    const { a, run_id } = await comResultados(juizOk);
    const [r1, r2] = a.svc.estadoRun(run_id).resultados;
    a.svc.notaManual(r1!.id, 10, "manual");
    await a.svc.julgar(run_id, null, J, (await tokenJulgar(a, ["tj"], [A, B], J)).token);
    await a.svc.julgar(run_id, null, J, (await tokenJulgar(a, ["tj"], [A, B], J)).token);
    expect(a.svc.repos.vereditos.contarDaRun(run_id)).toBe(2);
    const g = a.svc.estadoRun(run_id).resultados;
    expect(g.find((x) => x.id === r1!.id)!.juiz_estado).toBe("manual");
    expect(g.find((x) => x.id === r1!.id)!.qualidade).toBe(10);
    expect(g.find((x) => x.id === r2!.id)!.juiz_estado).toBe("feito");
  });
});

describe("comparar, recomendar e política", () => {
  it("2 alvos × 3 tarefas: 3 linhas e placar que soma 3; recomendar com evidência; rascunho nunca grava política", async () => {
    const a = ambiente({ chamarJuiz: juizOk });
    for (const s of ["c1", "c2", "c3"]) a.svc.tarefaSalvar(tarefa(s, "entrega"));
    const { run_id } = await rodarCompleto(a, ["c1", "c2", "c3"], [A, B]);
    await a.svc.julgar(run_id, null, J, (await tokenJulgar(a, ["c1", "c2", "c3"], [A, B], J)).token);
    const c = a.svc.comparar([A, B], null, "tarefa");
    if ("erro" in c) throw new Error("não comparável");
    expect(c.linhas).toHaveLength(3);
    expect(Object.values(c.placar.vitorias).reduce((x, y) => x + y, 0) + c.placar.empates).toBe(3);
    expect(c.selos).toEqual([]);
    expect(c.veredito).toMatch(/venceu|score/);
    const porAtividade = a.svc.comparar([A, B], null, "atividade");
    expect("erro" in porAtividade ? 0 : porAtividade.linhas.length).toBe(1);
    expect(a.svc.comparar([A], null, "tarefa")).toEqual({ erro: "nao_comparavel" });
    const rec = a.svc.recomendar("web-interativa", null, null);
    expect(rec.sem_dados).toBe(false);
    expect(rec.ranking[0]!.evidencia.length).toBeGreaterThan(0);
    expect(a.svc.recomendar("atividade-sem-dados", null, null)).toEqual({ atividade: "atividade-sem-dados", sem_dados: true, ranking: [] });
    const antes = a.banco.consultar("SELECT * FROM politica");
    const p = a.svc.exportarPolitica(["web-interativa", "atividade-sem-mapa"]);
    expect(p.rascunho[0]!.task_type).toBe("front");
    expect(p.avisos.join(" ")).toMatch(/nada foi gravado/);
    expect(a.banco.consultar("SELECT * FROM politica")).toEqual(antes);
  });
  it("tarefa em versão diferente entre os alvos → naquela tarefa não comparável (selo versoes_diferentes)", async () => {
    const a = ambiente({ chamarJuiz: juizOk });
    a.svc.tarefaSalvar(tarefa("v1", "entrega"));
    a.svc.tarefaSalvar(tarefa("v2", "entrega"));
    const r1 = await rodarCompleto(a, ["v1", "v2"], [A]);
    a.svc.tarefaSalvar(tarefa("v1", "entrega NOVA"));
    const r2 = await rodarCompleto(a, ["v1", "v2"], [B]);
    for (const r of [r1, r2]) { const est = await a.svc.estimar({ tarefas: ["v1", "v2"], alvos: [A, B], max_paralelo: 3, teto_usd: null, juiz_alvo: J }); await a.svc.julgar(r.run_id, null, J, (a.svc.consentir(est.estimativa_id, "RODAR", "julgar") as { token: string }).token); }
    const c = a.svc.comparar([A, B], null, "tarefa");
    if ("erro" in c) throw new Error("devia comparar a tarefa v2");
    expect(c.linhas.map((l) => l.tarefa)).toEqual(["v2"]);
    expect(c.selos).toContain("versoes_diferentes");
  });
  it("provedor desabilitado ou sem conta NUNCA aparece na recomendação", async () => {
    const a = ambiente({ provedores: { habilitados: () => new Set(["codex"]) }, chamarJuiz: juizOk });
    a.svc.tarefaSalvar(tarefa("p1", "entrega"));
    const { run_id } = await rodarCompleto(a, ["p1"], [A, B]);
    await a.svc.julgar(run_id, null, J, (await tokenJulgar(a, ["p1"], [A, B], J)).token);
    expect(a.svc.recomendar("web-interativa", null, null).sem_dados).toBe(true);
  });
});

describe("leitura segura de log, artefato e relatório", () => {
  it("log paginado (≤ 64 KiB) com segredo e caminho redigidos; artefato só por nome registrado", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tlog", "entrega"));
    const { run_id } = await rodarCompleto(a, ["tlog"], [A]);
    const r = a.svc.estadoRun(run_id).resultados[0]!;
    const rl = a.svc.repos.resultados.obter(r.id)!;
    writeFileSync(join(a.deps.pastaBench, "exec", ...(rl.log_ref as string).split("/")), `${"x".repeat(70_000)}\nchave ${CHAVE_FALSA} e /Users/dono/projeto/segredo.txt ok\n`);
    const p1 = a.svc.logLer(r.id, 0, 10_000_000);
    expect(p1.texto.length).toBeLessThanOrEqual(65_536);
    expect(p1.proximo).toBeLessThanOrEqual(65_536);
    const p2 = a.svc.logLer(r.id, p1.proximo, 65_536);
    expect(p2.texto).toContain("[SEGREDO]");
    expect(p2.texto).toContain("[CAMINHO]");
    expect(p2.texto).not.toMatch(/abcdefghijklmnop|\/Users\/dono/);
    expect(a.svc.logLer(r.id, p2.proximo + 99999, 100).texto).toBe("");
    const art = a.svc.artefatoLer(r.id, "index.html");
    expect(art.tipo).toBe("text/html");
    expect(Buffer.from(art.bytes).toString()).toContain("canvas");
    for (const ruim of ["../x", "/etc/passwd", "nao-registrado.txt", "a/../../b"]) expect(() => a.svc.artefatoLer(r.id, ruim)).toThrow();
  });
  it("relatório exportado sem caminho absoluto, segredo, prompt privado nem mapa cego", async () => {
    let gravado = "";
    const a = ambiente({ salvar: { salvar: async (_n, c) => { gravado = c; return "relatorio.md"; } } });
    a.svc.tarefaSalvar(tarefa("trel", "PROMPT-PRIVADO-DA-TAREFA"));
    const { run_id } = await rodarCompleto(a, ["trel"], [A]);
    a.svc.repos.resultados.atualizar(a.svc.repos.resultados.daRun(run_id)[0]!.id, { aviso: `falha em /Users/dono/x com ${CHAVE_FALSA}` });
    for (const f of ["md", "json"] as const) {
      expect((await a.svc.exportarRelatorio([run_id], f)).caminho).toBe("relatorio.md");
      expect(gravado).not.toMatch(/\/Users\/|abcdefghijklmnop|PROMPT-PRIVADO|mapa_cego|bench-svc-|\/var\/folders/);
      expect(gravado).toContain(A);
    }
  });
});
