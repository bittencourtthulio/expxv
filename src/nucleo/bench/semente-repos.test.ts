// Semente (fixtures que DISCRIMINAM), validação, checagens e repositórios (invariantes por constraint, P-54/P-55).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { abrirBanco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { MIGRACOES } from "../banco/migracoes";
import { executarChecagens } from "./medicao/checagens";
import { comandoPermitido } from "./medicao/comandos";
import { criarReposBench } from "./repositorios";
import { sementes, sementesInvalidas } from "./tarefas/catalogo";
import { CABECALHO_HEADLESS, SEMENTE_TAREFAS, promptEfetivo } from "./tarefas/semente";
import { indicaEsforco, validarTarefa } from "./tarefas/validacao";
import { compararTarefas, pontuarTarefa, recomendar } from "./score";

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "bench-sem-")));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));
let n = 0;
function materializar(slug: string): string {
  const t = SEMENTE_TAREFAS.find((x) => x.slug === slug)!;
  const dir = join(raiz, `w${++n}`);
  for (const [rel, c] of Object.entries(t.fixtures)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), c); }
  mkdirSync(dir, { recursive: true });
  return dir;
}
const nodeTest = (dir: string) => spawnSync(process.execPath, ["--test"], { cwd: dir, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" }, timeout: 30_000 });

describe("semente de 9 tarefas", () => {
  it("9 tarefas: 7 ativas e 2 rascunho; todas as ativas passam na validação; nenhuma cita nome de modelo", () => {
    expect(SEMENTE_TAREFAS).toHaveLength(9);
    expect(SEMENTE_TAREFAS.filter((t) => t.estado === "ativa")).toHaveLength(7);
    expect(SEMENTE_TAREFAS.filter((t) => t.estado === "rascunho").map((t) => t.slug).sort()).toEqual(["apple-site-clone", "fps-dust2"]);
    expect(sementesInvalidas()).toEqual([]);
    const texto = JSON.stringify(sementes()).toLowerCase();
    for (const proibido of ["claude", "gpt", "gemini", "opus", "sonnet", "anthropic", "openai", "codex", "grok"]) expect(texto).not.toContain(proibido);
  });
  it("só o sistema solar tem prompt literal da spec; as de código trazem fixture e `node --test` crítico", () => {
    expect(SEMENTE_TAREFAS.filter((t) => t.origem === "observada_literal").map((t) => t.slug)).toEqual(["solar-system-3d"]);
    for (const slug of ["debug-find-and-fix", "refactor-existing-code", "dirty-data"]) {
      const t = SEMENTE_TAREFAS.find((x) => x.slug === slug)!;
      expect(Object.keys(t.fixtures).length).toBeGreaterThan(0);
      expect(t.checagens.some((c) => c.tipo === "command_exit_zero" && c.alvo === "node --test" && c.critica)).toBe(true);
    }
  });
  it("a checagem `node --test` FALHA antes de qualquer solução (discrimina) e PASSA com uma solução correta", () => {
    // debug: corrige o laço que começava em 1
    let d = materializar("debug-find-and-fix");
    expect(nodeTest(d).status).not.toBe(0);
    writeFileSync(join(d, "soma.js"), 'function somar(l){let t=0;for(let i=0;i<l.length;i++){if(typeof l[i]==="number")t+=l[i];}return t;}\nmodule.exports={somar};\n');
    expect(nodeTest(d).status).toBe(0);
    // refatoração: extrai as duas funções pedidas
    d = materializar("refactor-existing-code");
    expect(nodeTest(d).status).not.toBe(0);
    writeFileSync(join(d, "precos.js"), 'const formatarMoeda=(v)=>"R$ "+v.toFixed(2).replace(".",",");const somarItens=(is)=>is.reduce((t,i)=>t+i.preco*i.qtd,0);\nmodule.exports={formatarMoeda,somarItens,totalCarrinho:(is)=>formatarMoeda(somarItens(is)),totalPedido:(is,f)=>formatarMoeda(somarItens(is)+f)};\n');
    expect(nodeTest(d).status).toBe(0);
    // dados: gera limpo.csv e RELATORIO.md
    d = materializar("dirty-data");
    expect(nodeTest(d).status).not.toBe(0);
    writeFileSync(join(d, "limpo.csv"), "id,nome,email,cidade\n1,Ana Souza,ana@exemplo.com,São Paulo\n2,Bruno Lima,bruno@exemplo.com,Rio De Janeiro\n4,Carla Dias,,Curitiba\n");
    writeFileSync(join(d, "RELATORIO.md"), "2 duplicados removidos.");
    expect(nodeTest(d).status).toBe(0);
  });
  it("css-responsive: a checagem crítica (@media) falha antes da solução", async () => {
    const d = materializar("css-responsive");
    const t = SEMENTE_TAREFAS.find((x) => x.slug === "css-responsive")!;
    const antes = await executarChecagens(t.checagens, { workdir: d, rodarComando: async () => null });
    expect(antes.find((c) => c.alvo === "styles.css" && c.tipo === "contains_text")!.ok).toBe(false);
    writeFileSync(join(d, "styles.css"), "body{margin:0}@media (max-width: 600px){.grade{display:block}}");
    const depois = await executarChecagens(t.checagens, { workdir: d, rodarComando: async () => null });
    expect(depois.every((c) => c.ok)).toBe(true);
  });
  it("o prompt efetivo tem o cabeçalho headless SEM palavra de esforço", () => {
    for (const t of SEMENTE_TAREFAS) {
      const p = promptEfetivo(t);
      expect(p.startsWith(CABECALHO_HEADLESS)).toBe(true);
      expect(indicaEsforco(p)).toBe(false);
    }
  });
});

describe("validação de tarefa", () => {
  const base = { slug: "ok", titulo: "t", atividade: "bug", tipo: "codigo" as const, prompt: "faça", escopo: "", checagens: [], estado: "ativa" as const };
  it("esforço no prompt é recusado em PT e EN", () => {
    for (const p of ["rode em extra high", "use high effort", "com esforço máximo", "ultrathink sobre isso", "reasoning effort alto", "Think hard"]) expect(validarTarefa({ ...base, prompt: p }), p).toBe("esforco_no_prompt");
    for (const p of ["corrija o bug", "high-performance sort", "escreva um relatório"]) expect(validarTarefa({ ...base, prompt: p }), p).toBeNull();
  });
  it("slug, prompt vazio, checagens (lista fechada, caminho relativo) e tamanhos", () => {
    expect(validarTarefa({ ...base, slug: "../x" })).toBe("slug_invalido");
    expect(validarTarefa({ ...base, prompt: " " })).toBe("prompt_vazio");
    expect(validarTarefa({ ...base, checagens: [{ tipo: "command_exit_zero", alvo: "npm test", critica: true }] })).toBe("checagem_invalida");
    expect(validarTarefa({ ...base, checagens: [{ tipo: "command_exit_zero", alvo: "node --test; rm -rf /", critica: true }] })).toBe("checagem_invalida");
    expect(validarTarefa({ ...base, checagens: [{ tipo: "file_exists", alvo: "../fora", critica: true }] })).toBe("checagem_invalida");
    expect(validarTarefa({ ...base, checagens: [{ tipo: "file_exists", alvo: "/abs", critica: true }] })).toBe("checagem_invalida");
    expect(validarTarefa({ ...base, checagens: [{ tipo: "contains_text", alvo: "a.txt", critica: false }] })).toBe("checagem_invalida");
    expect(validarTarefa({ ...base, checagens: [{ tipo: "contains_text", alvo: "a.txt", texto: "x", critica: false }, { tipo: "command_exit_zero", alvo: "node --test", critica: true }] })).toBeNull();
    expect(validarTarefa({ ...base, prompt: "x".repeat(20_001) })).toBe("campo_invalido");
    expect(comandoPermitido("node   --test")).toEqual(["node", "--test"]);
    expect(comandoPermitido("node --test && rm")).toBeNull();
  });
});

describe("checagens", () => {
  it("file_exists/contains_text seguros: symlink e caminho fora são recusados; comando só da lista fechada", async () => {
    const d = join(raiz, `c${++n}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "index.html"), "<CANVAS>");
    symlinkSync("/etc/hosts", join(d, "link.txt"));
    const r = await executarChecagens([
      { tipo: "file_exists", alvo: "index.html", critica: true }, { tipo: "file_exists", alvo: "nao.html", critica: false }, { tipo: "file_exists", alvo: "link.txt", critica: false },
      { tipo: "contains_text", alvo: "index.html", texto: "canvas", critica: false }, { tipo: "contains_text", alvo: "index.html", texto: "svg", critica: false },
      { tipo: "command_exit_zero", alvo: "node --test", critica: true }, { tipo: "command_exit_zero", alvo: "rm -rf /", critica: true },
    ], { workdir: d, rodarComando: async (argv) => (argv.join(" ") === "node --test" ? 0 : 99) });
    expect(r.map((x) => x.ok)).toEqual([true, false, false, true, false, true, false]);
    expect(r[6]!.detalhe).toBe("comando fora da lista permitida");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // serializável em checagens_json
  });
});

describe("repositórios e migration 0016", () => {
  const novo = () => { const b = abrirBanco(":memory:"); migrar(b); return { b, r: criarReposBench(b) }; };
  const run = (r: ReturnType<typeof criarReposBench>) => r.runs.criar({ nome: "n", tarefas: [], alvos: [], max_paralelo: 3, teto_usd: null, juiz_alvo: null, pesos: { q: 0.6, s: 0.2, c: 0.2 }, sandbox: "macos" });
  it("é a migração 0016, aditiva, idempotente e cria as 6 tabelas", () => {
    const b = abrirBanco(":memory:");
    expect(MIGRACOES[15]?.nome).toBe("0016-bench");
    const res = migrar(b);
    expect(res.aplicadas).toContain("0016-bench");
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    for (const x of ["bench_tarefa", "bench_alvo", "bench_preco", "bench_run", "bench_resultado", "bench_veredito"]) expect(t).toContain(x);
    expect(migrar(b).aplicadas).toEqual([]);
    b.fechar();
  });
  it("migra de um banco na versão 15 sem perder dados", () => {
    const b = abrirBanco(":memory:");
    migrar(b, { migracoes: MIGRACOES.slice(0, 15) });
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
    expect(migrar(b).de).toBe(15);
    expect(b.consultarUm("SELECT nome FROM workspace WHERE id='ws_1'")).toEqual({ nome: "n" });
    b.fechar();
  });
  it("constraint: no máximo um resultado NÃO substituído por (run, tarefa, alvo); re-run substitui na mesma transação", () => {
    const { b, r } = novo();
    const ru = run(r);
    const a = r.resultados.criar({ run_id: ru.id, tarefa_slug: "t", tarefa_versao: 1, alvo_slug: "a" });
    expect(() => r.resultados.criar({ run_id: ru.id, tarefa_slug: "t", tarefa_versao: 1, alvo_slug: "a" })).toThrow(/UNIQUE/);
    const b2 = r.resultados.substituir(a.id, "p");
    expect(b2.tentativa).toBe(2);
    expect(r.resultados.obter(a.id)!.estado).toBe("substituido");
    expect(r.resultados.daRun(ru.id).map((x) => x.id)).toEqual([b2.id]);
    expect(r.resultados.daRun(ru.id, true)).toHaveLength(2);
    b.fechar();
  });
  it("constraint: qualidade só existe com juiz feito/manual; custo desconhecido ⇒ custo NULL; qualidade 0–10", () => {
    const { b, r } = novo();
    const ru = run(r);
    const x = r.resultados.criar({ run_id: ru.id, tarefa_slug: "t", tarefa_versao: 1, alvo_slug: "a" });
    expect(() => r.resultados.atualizar(x.id, { qualidade: 5 })).toThrow(/CHECK/); // juiz pendente
    r.resultados.atualizar(x.id, { juiz_estado: "manual", qualidade: 5 });
    expect(() => r.resultados.atualizar(x.id, { qualidade: 11 })).toThrow(/CHECK/);
    expect(() => r.resultados.atualizar(x.id, { custo_usd: 0 })).toThrow(/CHECK/); // custo_fonte ainda 'desconhecido'
    r.resultados.atualizar(x.id, { custo_fonte: "relatorio_cli", custo_usd: 0 });
    expect(r.resultados.obter(x.id)!.custo_usd).toBe(0); // zero MEDIDO é permitido; zero por falta de dado, não
    b.fechar();
  });
  it("tarefa: versao++ só com prompt/checagens; semear não sobrescreve edição do usuário", () => {
    const { b, r } = novo();
    expect(r.tarefas.semear(sementes())).toBe(9);
    const t = r.tarefas.obter("css-responsive")!;
    r.tarefas.salvar({ slug: t.slug, titulo: "meu título", atividade: t.atividade, tipo: t.tipo, prompt: t.prompt, escopo: t.escopo, checagens: t.checagens, estado: "ativa" });
    expect(r.tarefas.obter("css-responsive")!.versao).toBe(1);
    r.tarefas.salvar({ slug: t.slug, titulo: "meu título", atividade: t.atividade, tipo: t.tipo, prompt: t.prompt + " mais", escopo: t.escopo, checagens: t.checagens, estado: "ativa" });
    expect(r.tarefas.obter("css-responsive")!.versao).toBe(2);
    expect(r.tarefas.semear(sementes())).toBe(0);
    expect(r.tarefas.obter("css-responsive")!.titulo).toBe("meu título");
    b.fechar();
  });
  it("paginação por cursor das Runs e boot (interromperPendentes)", () => {
    const { b, r } = novo();
    const ids = Array.from({ length: 5 }, () => run(r).id);
    const p1 = r.runs.listar(null, 2);
    expect(p1.itens.map((x) => x.id)).toEqual([ids[4], ids[3]]);
    const p2 = r.runs.listar(p1.proximo, 2);
    expect(p2.itens.map((x) => x.id)).toEqual([ids[2], ids[1]]);
    expect(r.runs.listar(p2.proximo, 2).proximo).toBeNull();
    r.runs.atualizar(ids[0]!, { estado: "executando" });
    r.runs.atualizar(ids[1]!, { estado: "concluida" });
    expect(r.runs.interromperPendentes().runs).toBe(4); // as 3 enfileiradas restantes + a executando
    expect(r.runs.obter(ids[1]!)!.estado).toBe("concluida");
    b.fechar();
  });
  it("P-55: consulta quente ≤ 5 ms com 10 000 resultados; P-54: score+comparar+recomendar com 10 000 ≤ 50 ms", () => {
    const { b, r } = novo();
    const ru = run(r);
    b.transacao((bb) => {
      for (let i = 0; i < 10_000; i++) bb.executar("INSERT INTO bench_resultado (id,run_id,tarefa_slug,tarefa_versao,alvo_slug,tentativa,estado,juiz_estado,qualidade,duracao_s,custo_fonte,custo_usd,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,'concluido','feito',?,?,'relatorio_cli',?,?,?)", [`bres_${String(i).padStart(10, "0")}`, ru.id, `t${i % 100}`, 1, `a${Math.floor(i / 100)}`, 1, (i % 10) + 0.5, 10 + (i % 7), 0.01 + (i % 5) / 100, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`, `2026-01-01T00:00:00.000Z`]);
    });
    r.resultados.obter("bres_0000005000"); // aquece
    let t0 = performance.now();
    for (let i = 0; i < 50; i++) r.resultados.obter(`bres_${String(i * 100).padStart(10, "0")}`);
    expect((performance.now() - t0) / 50).toBeLessThan(5);
    t0 = performance.now();
    r.runs.listar(null, 30);
    expect(performance.now() - t0).toBeLessThan(5);
    const hist = r.resultados.historico();
    const porTarefa = new Map<string, typeof hist>();
    for (const h of hist) porTarefa.set(`${h.tarefa_slug}`, [...(porTarefa.get(h.tarefa_slug) ?? []), h]);
    const entradas = [...porTarefa.entries()].map(([tarefa, hs]) => ({ tarefa, versao: 1, atividade: "x", entradas: hs.slice(0, 100).map((h) => ({ resultado_id: h.id, alvo: h.alvo_slug, qualidade: h.qualidade, duracao_s: h.duracao_s, custo_usd: h.custo_usd, critica_falhou: false, revisoes: null })) }));
    t0 = performance.now();
    for (const e of entradas) pontuarTarefa(e.entradas);
    compararTarefas([...new Set(entradas.flatMap((e) => e.entradas.map((x) => x.alvo)))].slice(0, 2), entradas.map((e) => ({ ...e, entradas: e.entradas.slice(0, 2) })));
    const meta = new Map(Array.from({ length: 100 }, (_, i) => [`a${i}`, { provedor: "p", modelo: `m${i}`, esforco: null, cli: "claude" }]));
    recomendar("x", entradas, meta);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(readFileSync(__filename, "utf8").length).toBeGreaterThan(0);
    b.fechar();
  });
});
