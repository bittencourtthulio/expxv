// Auditoria de segurança do Bench (T-12.25; achados em docs/ade/AUDITORIA-BENCH.md). Cada achado tem teste que FALHA sem a correção.
// Eixos: (1) execução em pasta isolada, (2) vazamento de segredo nos resultados, (3) custo sem confirmação, (4) escrita fora da pasta de execução.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { executarChecagens } from "./medicao/checagens";
import { criarSandboxMacos } from "./sandbox/macos";
import { criarSandboxIndisponivel, criarSandboxNenhum, type Sandbox } from "./sandbox/sandbox";
import { montarAmbiente, sanearPath } from "./sandbox/ambiente";
import { criarWorkdir } from "./execucao/workdir";
import { criarServicoBench, type DepsServicoBench, type ServicoBench } from "./servico";
import { MAX_EXECUCOES_POR_RUN, type TarefaEditavel } from "./tipos";

const CLI = resolve(__dirname, "../../../tests/fixtures/cli-bench.mjs");
const AJUDA = "-p --output-format --permission-mode --strict-mcp-config --mcp-config --disable-slash-commands --no-session-persistence --model --effort --tools --json --skip-git-repo-check --ephemeral -s -C";
/** chave FALSA montada em runtime (nenhum segredo literal no arquivo versionado). */
const CHAVE_FALSA = ["sk", "ant", "abcdefghijklmnopqrstuvwxyz0123"].join("-");
const PATH_PAI = process.env["PATH"];
const raiz = realpathSync(mkdtempSync(join(tmpdir(), "bench-aud-")));
const macos = process.platform === "darwin";
const bancos: Banco[] = [];
const servicos: ServicoBench[] = [];
let seq = 0;
mkdirSync(join(raiz, "tmp"), { recursive: true });
afterEach(async () => { for (const s of servicos.splice(0)) await s.encerrar(); });
afterAll(() => { for (const b of bancos) b.fechar(); rmSync(raiz, { recursive: true, force: true }); });

const tarefa = (slug: string, marcador: string, extra: Partial<TarefaEditavel> = {}): TarefaEditavel => ({ slug, titulo: slug, atividade: "web-interativa", tipo: "web", prompt: `Crie index.html. ${marcador}`, escopo: "", checagens: [{ tipo: "file_exists", alvo: "index.html", critica: true }], estado: "ativa", ...extra });

interface Espioes { spawns: number; juizes: number }
function ambiente(o: Partial<DepsServicoBench> & { sandbox?: "real" | "indisponivel"; juizPadrao?: boolean } = {}) {
  const { sandbox, juizPadrao, ...resto } = o;
  const base = join(raiz, `a${++seq}`);
  mkdirSync(base, { recursive: true });
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const esp: Espioes = { spawns: 0, juizes: 0 };
  const real: Sandbox = macos ? criarSandboxMacos({ pastaPerfis: join(base, "perfis"), tmp: join(raiz, "tmp") }) : criarSandboxNenhum();
  const sbx = sandbox === "indisponivel" ? criarSandboxIndisponivel() : real;
  const deps: DepsServicoBench = {
    banco, pastaBench: join(base, "bench"), pastaDados: base, homeReal: join(base, "home-real"), sandboxPara: () => sbx, sandboxChecagens: sbx,
    contas: { resolver: (id) => ({ home: join(base, "contas", id, "home"), configDir: join(base, "contas", id, "cfg") }) },
    prepararComando: (c) => { esp.spawns++; return { executavel: process.execPath, args: [CLI, ...c.args] }; },
    lerAjuda: async () => AJUDA, plataforma: macos ? "darwin" : "win32", timeoutPadraoMs: 20_000,
    ambientePai: () => ({ PATH: PATH_PAI }),
    chamarJuiz: async () => { esp.juizes++; return { texto: "{}", custo_usd: null }; },
    ...resto,
  };
  if (juizPadrao === true) delete deps.chamarJuiz; // usa o juiz padrão do serviço (CLI em modo somente leitura)
  const svc = criarServicoBench(deps);
  servicos.push(svc);
  svc.alvosSalvar([
    { provedor: "anthropic", modelo: "modelo-a", esforco: null, cli: "claude", conta_id: "cta_A", rotulo: null },
    { provedor: "openai", modelo: "modelo-j", esforco: null, cli: "claude", conta_id: "cta_J", rotulo: null },
  ]);
  return { svc, banco, base, deps, esp };
}
const A = "anthropic-modelo-a-padrao";
const J = "openai-modelo-j-padrao";
async function rodarCompleto(svc: ServicoBench, tarefas: string[]) {
  const est = await svc.estimar({ tarefas, alvos: [A], max_paralelo: 3, teto_usd: null, juiz_alvo: null });
  const c = svc.consentir(est.estimativa_id, est.frase_exigida ?? "RODAR");
  if ("erro" in c) throw new Error(est.avisos.join(" | "));
  const r = await svc.rodar(est.estimativa_id, c.token);
  if ("erro" in r) throw new Error(r.erro);
  await svc.aguardar();
  return r.run_id;
}
const wdDe = (a: { svc: ServicoBench; deps: DepsServicoBench }, id: string): string => join(a.deps.pastaBench, "exec", ...((a.svc.repos.resultados.obter(id)?.workdir ?? "") as string).split("/"));
const rotulosDe = (prompt: string): string[] => [...new Set([...prompt.matchAll(/ENTREGA ([A-Z])\b/g)].map((m) => m[1] as string))];

describe("eixo 1 · execução em pasta isolada", () => {
  it("A-04 · PATH do filho só tem entradas ABSOLUTAS (um `claude`/`node` plantado no workdir nunca é resolvido)", () => {
    expect(sanearPath(["/usr/bin", "", ".", "bin", "../x", "/bin", "relativo/sub"].join(delimiter))).toBe(["/usr/bin", "/bin"].join(delimiter));
    expect(montarAmbiente({ pai: { PATH: [".", "/usr/bin", ""].join(delimiter) }, home: "/h" })["PATH"]).toBe("/usr/bin");
    expect(montarAmbiente({ pai: { PATH: [".", ""].join(delimiter) }, home: "/h" })["PATH"]).toBeUndefined();
  });
  it.skipIf(process.platform === "win32")("A-04 · integração: com PATH relativo no pai, o executável plantado no workdir NÃO roda", () => {
    const wd = criarWorkdir({ raizExec: join(raiz, "exec-a04"), run: "brun_AAAAAAAAAA", tarefa: "t", alvo: "a", fixtures: {} });
    writeFileSync(join(wd.abs, "plantado"), "#!/bin/sh\necho EXECUTOU > pwned.txt\n", { mode: 0o755 });
    const ambienteFilho = montarAmbiente({ pai: { PATH: `.${delimiter}/usr/bin${delimiter}/bin` }, home: join(raiz, "h") });
    spawnSync("sh", ["-c", "plantado"], { cwd: wd.abs, env: ambienteFilho, stdio: "ignore" });
    expect(existsSync(join(wd.abs, "pwned.txt"))).toBe(false);
  });
  it("A-03 · symlink de DIRETÓRIO dentro do workdir não vaza leitura: checagem e artefato recusam", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tsym", "entrega"));
    const fora = join(raiz, "fora-do-workdir");
    mkdirSync(fora, { recursive: true });
    writeFileSync(join(fora, "segredo.txt"), "SEGREDO-FORA");
    const run = await rodarCompleto(a.svc, ["tsym"]);
    const r = a.svc.estadoRun(run).resultados[0]!;
    const wd = wdDe(a, r.id);
    symlinkSync(fora, join(wd, "ponte"));
    const c = await executarChecagens([{ tipo: "contains_text", alvo: "ponte/segredo.txt", texto: "SEGREDO-FORA", critica: false }, { tipo: "file_exists", alvo: "ponte/segredo.txt", critica: false }], { workdir: wd, rodarComando: async () => 0 });
    expect(c.map((x) => x.ok)).toEqual([false, false]);
    a.svc.repos.resultados.atualizar(r.id, { artefatos: [{ nome: "ponte/segredo.txt", tipo: "text/plain", bytes: 12, sha256: "" }] });
    expect(() => a.svc.artefatoLer(r.id, "ponte/segredo.txt")).toThrow();
  });
  it("A-05 · a pasta de execução fica FORA de repositório git, é 0700 e limpar só mexe na Run pedida", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tiso", "entrega"));
    const run = await rodarCompleto(a.svc, ["tiso"]);
    const wd = wdDe(a, a.svc.repos.resultados.daRun(run)[0]!.id);
    expect(existsSync(wd)).toBe(true);
    expect(statSync(wd).mode & 0o077).toBe(0);
    let p = wd;
    while (p !== resolve(p, "..")) { expect(existsSync(join(p, ".git"))).toBe(false); p = resolve(p, ".."); }
    const outra = join(a.deps.pastaBench, "exec", "brun_OUTRAAAAAAA");
    mkdirSync(outra, { recursive: true });
    a.svc.limparExecucoes(run);
    expect(existsSync(wd)).toBe(false);
    expect(existsSync(outra)).toBe(true);
    // D-04: `..`/separador nunca sobem da pasta `exec/` (antes, `limparExecucoes("../..")` apagava a pasta de dados)
    for (const ruim of ["../..", "..", "brun_/../..", "brun_AAAAAAAAAA/../..", "/", ""]) expect(() => a.svc.limparExecucoes(ruim), ruim).toThrow();
    expect(existsSync(a.deps.pastaBench)).toBe(true);
    expect(existsSync(a.base)).toBe(true);
  });
  it("D-11 · o juiz padrão (CLI em modo somente leitura) funciona de ponta a ponta com a CLI falsa", async () => {
    const reg = join(raiz, "tmp", `juiz-${++seq}.json`);
    const a = ambiente({ juizPadrao: true, ambienteExtra: { CLI_FALSA_REGISTRO: reg } });
    a.svc.tarefaSalvar(tarefa("tjuiz", "entrega"));
    const run = await rodarCompleto(a.svc, ["tjuiz"]);
    const est = await a.svc.estimar({ tarefas: ["tjuiz"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: J });
    expect(est.avisos.join(" ")).toMatch(/Julgar envia os arquivos entregues .* ao provedor do juiz \(openai\/modelo-j\)/); // B-11
    const t = a.svc.consentir(est.estimativa_id, "RODAR", "julgar") as { token: string };
    const r = (await a.svc.julgar(run, null, J, t.token)) as { veredito_ids: string[] };
    expect(r.veredito_ids).toHaveLength(1);
    const g = a.svc.estadoRun(run);
    expect([g.resultados[0]!.juiz_estado, g.resultados[0]!.qualidade]).toEqual(["feito", 7.5]);
    const o = JSON.parse(readFileSync(reg, "utf8")) as { args: string[]; stdin: string; cwd: string }; // o registro guarda a ÚLTIMA chamada: a do juiz
    expect(readdirSync(join(raiz, "tmp")).filter((n) => n.startsWith(`juiz-`) && n.includes(".erro"))).toEqual([]); // o juiz (somente leitura) precisa ler o próprio cwd: sem isso a CLI real abortava (achado D-12)
    expect(JSON.stringify(o.args)).toContain("--tools");
    expect(o.args[o.args.indexOf("--tools") + 1]).toBe("Read");
    expect(o.args).not.toContain("bypassPermissions");
    expect(o.stdin).toContain("avaliador imparcial");
    expect(o.stdin).not.toMatch(/modelo-a|anthropic/i);
  });
});

describe("eixo 2 · vazamento de segredo nos resultados", () => {
  it("B-04 · segredo e caminho que o código gerado copiou para o artefato são REDIGIDOS na leitura da UI e no pacote do juiz", async () => {
    let promptDoJuiz = "";
    const a = ambiente({ chamarJuiz: async (_x, prompt) => { promptDoJuiz = prompt; return { texto: JSON.stringify({ scores: Object.fromEntries(rotulosDe(prompt).map((x) => [x, { functionality: 5, visual: 5, completeness: 5, robustness: 5 }])) }), custo_usd: null }; } });
    a.svc.tarefaSalvar(tarefa("tseg", "entrega"));
    const run = await rodarCompleto(a.svc, ["tseg"]);
    const r = a.svc.estadoRun(run).resultados[0]!;
    writeFileSync(join(wdDe(a, r.id), "index.html"), `<!-- ${CHAVE_FALSA} --><p>${join(a.base, "contas", "cta_A", "cfg", ".credentials.json")}</p>`);
    const art = Buffer.from(a.svc.artefatoLer(r.id, "index.html").bytes).toString("utf8");
    expect(art).not.toContain("abcdefghijklmnop");
    expect(art).toContain("[SEGREDO]");
    expect(art).not.toContain(a.base);
    const est = await a.svc.estimar({ tarefas: ["tseg"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: J });
    await a.svc.julgar(run, null, J, (a.svc.consentir(est.estimativa_id, "RODAR", "julgar") as { token: string }).token);
    expect(promptDoJuiz).toContain("ENTREGA A");
    expect(promptDoJuiz).not.toContain("abcdefghijklmnop");
  });
  it("B-01 · o filho nunca recebe segredo do pai, nem o valor do cofre quando o scrubber o reconhece", async () => {
    const a = ambiente({ ambientePai: () => ({ PATH: PATH_PAI, LANG: "VALOR-DO-COFRE-123", GITHUB_TOKEN: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" }), scrub: (t) => t.replace("VALOR-DO-COFRE-123", "***") });
    a.svc.tarefaSalvar(tarefa("tenv", "MODO:ENV"));
    const run = await rodarCompleto(a.svc, ["tenv"]);
    const dump = readFileSync(join(wdDe(a, a.svc.repos.resultados.daRun(run)[0]!.id), "env.json"), "utf8");
    expect(dump).not.toMatch(/VALOR-DO-COFRE|ghp_/);
  });
  it("B-06 · nada com segredo ou caminho absoluto sai em log, nota ou detalhe", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tlog2", "entrega"));
    const run = await rodarCompleto(a.svc, ["tlog2"]);
    const r = a.svc.estadoRun(run).resultados[0]!;
    writeFileSync(join(a.deps.pastaBench, "exec", ...(a.svc.repos.resultados.obter(r.id)!.log_ref as string).split("/")), `${CHAVE_FALSA} ${a.base}/contas/x\n`);
    const p = a.svc.logLer(r.id, 0, 65_536);
    expect(p.texto).not.toMatch(/abcdefghijklmnop/);
    expect(p.texto).not.toContain(a.base);
    a.svc.notaManual(r.id, 5, `nota com ${CHAVE_FALSA} em ${a.base}`);
    const d = JSON.stringify(a.svc.resultado(r.id));
    expect(d).not.toMatch(/abcdefghijklmnop/);
    expect(d).not.toContain(a.base);
  });
});

describe("eixo 3 · custo sem confirmação", () => {
  it("C-01 · token inválido (forjado, finalidade errada, estimativa inexistente, expirado) em Run, re-run e julgamento: NENHUM spawn e NENHUMA chamada ao juiz", async () => {
    const relogio = { t: 1_700_000_000_000 };
    const a = ambiente({ relogio: () => relogio.t });
    a.svc.tarefaSalvar(tarefa("tc1", "entrega"));
    const run = await rodarCompleto(a.svc, ["tc1"]);
    const spawnsBase = a.esp.spawns;
    const est = await a.svc.estimar({ tarefas: ["tc1"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: J });
    const cert = (f: "rodar" | "rerodar" | "julgar") => (a.svc.consentir(est.estimativa_id, "RODAR", f) as { token: string }).token;
    const tentativas: Array<Promise<unknown>> = [
      a.svc.rodar(est.estimativa_id, "forjado"), a.svc.rodar(est.estimativa_id, cert("julgar")), a.svc.rodar("est_naoexiste", cert("rodar")),
      a.svc.rerodar(run, "tc1", A, "forjado"), a.svc.rerodar(run, "tc1", A, cert("rodar")),
      a.svc.julgar(run, null, J, "forjado"), a.svc.julgar(run, null, J, cert("rodar")),
    ];
    const expirado = cert("rodar");
    relogio.t += 121_000;
    tentativas.push(a.svc.rodar(est.estimativa_id, expirado));
    const resultados = await Promise.all(tentativas.map((p) => p.catch(() => ({ erro: "lancou" }))));
    expect(resultados.every((r) => (r as { erro?: string }).erro === "consentimento_invalido")).toBe(true);
    await a.svc.aguardar();
    expect(a.esp.spawns).toBe(spawnsBase);
    expect(a.esp.juizes).toBe(0);
    expect(a.svc.runsListar(null).itens).toHaveLength(1);
  });
  it("C-01 · o token é de USO ÚNICO: depois de uma Run, o mesmo token não inicia outra", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tc2", "entrega"));
    const est = await a.svc.estimar({ tarefas: ["tc2"], alvos: [A], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    const { token } = a.svc.consentir(est.estimativa_id, "RODAR") as { token: string };
    expect("run_id" in (await a.svc.rodar(est.estimativa_id, token))).toBe(true);
    await a.svc.aguardar();
    const gastos = a.esp.spawns;
    expect(await a.svc.rodar(est.estimativa_id, token)).toEqual({ erro: "consentimento_invalido" });
    expect(a.esp.spawns).toBe(gastos);
  });
  it("C-02 · teto DURO de execuções por Run: acima dele a estimativa não oferece a frase de consentimento", async () => {
    const a = ambiente();
    const slugs: string[] = [];
    for (let i = 0; i < 11; i++) { slugs.push(`massa-${i}`); a.svc.tarefaSalvar(tarefa(`massa-${i}`, "entrega")); }
    a.svc.alvosSalvar(Array.from({ length: 10 }, (_, i) => ({ provedor: "anthropic", modelo: `m${i}`, esforco: null, cli: "claude" as const, conta_id: "cta_A", rotulo: null })));
    const alvos = a.svc.repos.alvos.listar().map((x) => x.slug);
    expect(slugs.length * alvos.length).toBeGreaterThan(MAX_EXECUCOES_POR_RUN);
    const est = await a.svc.estimar({ tarefas: slugs, alvos, max_paralelo: 5, teto_usd: null, juiz_alvo: null });
    expect(est.frase_exigida).toBeNull();
    expect(est.avisos.join(" ")).toMatch(/teto é 100 por Run/);
    expect(a.svc.consentir(est.estimativa_id, "RODAR")).toEqual({ erro: "confirmacao_invalida" });
  });
  it("C-03 · sem retentativa automática: a falha fica em `tentativa 1` com um único spawn", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("tc3", "MODO:FALHA", { checagens: [] }));
    const run = await rodarCompleto(a.svc, ["tc3"]);
    expect(a.svc.repos.resultados.daRun(run, true)).toHaveLength(1);
    expect(a.esp.spawns).toBe(1);
  });
  it("C-04 · o MCP não tem nenhuma referência ao Bench (agente não consegue iniciar, re-rodar nem julgar)", () => {
    const achados: string[] = [];
    const varrer = (dir: string): void => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) varrer(p); else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && /bench/i.test(readFileSync(p, "utf8"))) achados.push(p); } };
    varrer(resolve(__dirname, "../mcp"));
    expect(achados).toEqual([]);
  });
});

describe("eixo 4 · escrita fora da pasta de execução", () => {
  it.skipIf(!macos)("D-01 · o sandbox do macOS impede escrever fora do workdir e ler a pasta de dados do app", async () => {
    const fora = join(process.cwd(), `.bench-aud-fora-${process.pid}`);
    const a = ambiente({ homeReal: join(raiz, "home-real-aud") });
    a.svc.tarefaSalvar(tarefa("td1", `MODO:ESCAPE:${fora}`));
    const run = await rodarCompleto(a.svc, ["td1"]);
    expect(JSON.parse(readFileSync(join(wdDe(a, a.svc.repos.resultados.daRun(run)[0]!.id), "escape.json"), "utf8"))).toEqual({ escreveu: false });
    expect(existsSync(fora)).toBe(false);
    rmSync(fora, { recursive: true, force: true });
    writeFileSync(join(a.base, "dados-do-app.sqlite"), "BANCO-DO-APP");
    a.svc.tarefaSalvar(tarefa("td2", `MODO:LER:${join(a.base, "dados-do-app.sqlite")}`));
    const run2 = await rodarCompleto(a.svc, ["td2"]);
    expect(JSON.parse(readFileSync(join(wdDe(a, a.svc.repos.resultados.daRun(run2)[0]!.id), "leu.json"), "utf8"))).toEqual({ leu: null });
  });
  it("D-02 · o serviço só sugere um NOME de arquivo; o caminho de destino vem do diálogo do sistema (main)", async () => {
    const destinos: string[] = [];
    const a = ambiente({ salvar: { salvar: async (nome) => { destinos.push(nome); return null; } } });
    a.svc.tarefaSalvar(tarefa("td3", "entrega"));
    const run = await rodarCompleto(a.svc, ["td3"]);
    expect(await a.svc.exportarRelatorio([run], "md")).toEqual({ caminho: null });
    expect(destinos).toEqual(["bench-relatorio.md"]);
  });
  it("D-03 · tudo que o serviço criou fica dentro da pasta do Bench (exec) e das pastas das contas; nada ao lado", async () => {
    const a = ambiente();
    a.svc.tarefaSalvar(tarefa("td4", "entrega"));
    await rodarCompleto(a.svc, ["td4"]);
    const dentro = readdirSync(a.base);
    expect(dentro.filter((n) => !["bench", "perfis", "contas"].includes(n))).toEqual([]);
    expect(existsSync(join(a.deps.pastaBench, "exec"))).toBe(true);
  });
});
