import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarTmp, limparTmps } from "../../../tests/fixtures/metodo/util";
import { evento, gerarProjetoExpx, gerarVolume, HOJE_FIXTURE } from "../../../tests/fixtures/metodo/gerar";
import { criarConjunto, criarIndexador, indexarProjeto } from "./indexador";

afterEach(limparTmps);
const agora = () => Date.parse(HOJE_FIXTURE);

describe("indexarProjeto", () => {
  it("indexa a fixture completa: trabalhos, violações, rejeições, camadas e avisos", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const ind = await indexarProjeto(raiz, { agora });
    expect(ind.trabalhos).toHaveLength(15);
    expect(ind.raiz).toBe(raiz);
    expect(ind.gerado_em).toBe(HOJE_FIXTURE.replace("Z", ".000Z"));
    expect(ind.violacoes.length).toBe(ind.trabalhos.reduce((n, t) => n + t.violacoes.length, 0));
    expect(ind.violacoes.length).toBeGreaterThan(8);
    expect(ind.rejeicoes).toEqual([{ caminho: "docs/sprintx/features/feature-truncada/sprint-01/tasks.md", motivo: "yaml_invalido" }]);
    expect(ind.avisos.some((a) => a.includes("feature-truncada/sprint-01/tasks.md"))).toBe(true);
    expect(ind.camadas).toEqual({ convencoes: true, perfil_legado: true, design_system: true, produto: true, hooks: true, lock: true, memoria: true });
    expect(ind.artefatos_lidos).toBeGreaterThan(60);
  });

  it("mede a data (mtime) de cada camada gerada e omite as ausentes", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const alvo = join(raiz, "docs/stack/CONVENCOES.md");
    const quando = new Date("2026-03-04T10:20:30.000Z");
    utimesSync(alvo, quando, quando);
    const ind = await indexarProjeto(raiz, { agora });
    expect(ind.camadas_mtime?.convencoes).toBe("2026-03-04T10:20:30.000Z");
    expect(Object.keys(ind.camadas_mtime ?? {}).sort()).toEqual(["convencoes", "design_system", "memoria", "perfil_legado", "produto"]);
    rmSync(join(raiz, "docs/produto/PRODUTO.md"));
    const sem = await indexarProjeto(raiz, { agora });
    expect(sem.camadas.produto).toBe(false);
    expect(sem.camadas_mtime?.produto).toBeUndefined();
  });

  it("é clonável por structuredClone (atravessa o worker)", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const ind = await indexarProjeto(raiz, { agora });
    expect(structuredClone(ind)).toEqual(ind);
  });

  it("nunca lança: raiz inexistente, arquivos binários e JSONL de lixo", async () => {
    const vazio = await indexarProjeto("/nao/existe/mesmo", { agora });
    expect(vazio.trabalhos).toEqual([]);
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    writeFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/sprint-01/tasks.md"), Buffer.from([0, 255, 254, 1, 2, 3]));
    writeFileSync(join(raiz, "docs/eventos/lixo.jsonl"), Buffer.from([0, 1, 2, 10, 255, 10]));
    const ind = await indexarProjeto(raiz, { agora });
    expect(ind.trabalhos.length).toBeGreaterThan(10);
  });
});

describe("criarIndexador (estado incremental)", () => {
  it("tail do JSONL: só o novo é lido; linha incompleta é adiada", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const idx = criarIndexador({ agora });
    const a = await idx.indexar(raiz);
    expect(a.trabalhos.find((t) => t.id === "cobranca-pix")?.eventos_total).toBe(6);
    const linha = evento({ ts: "2026-09-29T11:30:00Z", trabalho_id: "cobranca-pix", evento: "task_concluida", task: "T-01.04" });
    appendFileSync(join(raiz, "docs/eventos/cobranca-pix.jsonl"), linha.slice(0, 40));
    expect((await idx.indexar(raiz)).trabalhos.find((t) => t.id === "cobranca-pix")?.eventos_total).toBe(6);
    appendFileSync(join(raiz, "docs/eventos/cobranca-pix.jsonl"), linha.slice(40) + "\n");
    const c = await idx.indexar(raiz);
    const t = c.trabalhos.find((x) => x.id === "cobranca-pix");
    expect(t?.eventos_total).toBe(7);
    expect(t?.divergencias).toEqual([{ task: "T-01.04", disco: "em_andamento", rastro: "concluida" }]);
    expect(t?.ultima_atividade).toBe("2026-09-29T11:30:00Z");
  });

  it("YAML truncado em gravação mantém a última leitura válida e avisa", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const idx = criarIndexador({ agora });
    const arq = join(raiz, "docs/sprintx/features/cobranca-pix/sprint-01/tasks.md");
    const antes = await idx.indexar(raiz);
    const tasksAntes = antes.trabalhos.find((t) => t.id === "cobranca-pix")!.sprints[0]!.fases.flatMap((f) => f.tasks).length;
    expect(tasksAntes).toBe(4);
    writeFileSync(arq, "---\nexpx_schema: 1\nkind: tasks\ntasks:\n  - id: T-01.01\n    titulo: Ta");
    const meio = await idx.indexar(raiz);
    expect(meio.trabalhos.find((t) => t.id === "cobranca-pix")!.sprints[0]!.fases.flatMap((f) => f.tasks)).toHaveLength(4);
    expect(meio.avisos.some((a) => a.includes("cobranca-pix/sprint-01/tasks.md"))).toBe(true);
  });

  it("arquivo removido some do modelo; trabalho removido some do índice", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const idx = criarIndexador({ agora });
    await idx.indexar(raiz);
    rmSync(join(raiz, "docs/sprintx/features/cobranca-pix/sprint-02"), { recursive: true });
    const a = await idx.indexar(raiz);
    expect(a.trabalhos.find((t) => t.id === "cobranca-pix")!.sprints.map((s) => s.id)).toEqual(["sprint-01"]);
    rmSync(join(raiz, "docs/sprintx/features/so-base"), { recursive: true });
    expect((await idx.indexar(raiz)).trabalhos.some((t) => t.id === "so-base")).toBe(false);
  });
});

describe("criarConjunto (um indexador por worktree)", () => {
  it("worktree novo entra no conjunto e o removido sai", async () => {
    const a = criarTmp();
    const b = criarTmp();
    gerarProjetoExpx(a);
    gerarProjetoExpx(b);
    rmSync(join(b, "docs/sprintx/features/so-base"), { recursive: true });
    const conj = criarConjunto({ agora });
    const r1 = await conj.sincronizar([a]);
    expect(r1.entraram).toEqual([a]);
    expect(conj.raizes()).toEqual([a]);
    const r2 = await conj.sincronizar([a, b]);
    expect(r2.entraram).toEqual([b]);
    expect(r2.sairam).toEqual([]);
    expect(conj.obter(b)?.trabalhos.some((t) => t.id === "so-base")).toBe(false);
    expect(conj.obter(a)?.trabalhos.some((t) => t.id === "so-base")).toBe(true);
    const r3 = await conj.sincronizar([a]);
    expect(r3.sairam).toEqual([b]);
    expect(conj.obter(b)).toBeUndefined();
    expect(conj.raizes()).toEqual([a]);
  });

  it("reindexar devolve o índice novo e guarda no conjunto", async () => {
    const a = criarTmp();
    gerarProjetoExpx(a);
    const conj = criarConjunto({ agora });
    await conj.sincronizar([a]);
    rmSync(join(a, "docs/sprintx/features/so-base"), { recursive: true });
    const ind = await conj.reindexar(a);
    expect(ind?.trabalhos.some((t) => t.id === "so-base")).toBe(false);
    expect(conj.obter(a)).toBe(ind);
    expect(await conj.reindexar("/nao/registrada")).toBeUndefined();
  });

  it("raiz que falha não derruba o conjunto", async () => {
    const a = criarTmp();
    gerarProjetoExpx(a);
    const conj = criarConjunto({ agora });
    const r = await conj.sincronizar(["/nao/existe", a]);
    expect(r.indices.map((i) => i.raiz).sort()).toEqual([a, "/nao/existe"].sort());
  });
});

describe("P-10: 200 artefatos em <= 300 ms", () => {
  it("mediana de 7 execuções (descoberta + leitura + modelo, fora da thread principal em produção)", async () => {
    const raiz = criarTmp();
    const n = gerarVolume(raiz, 200);
    expect(n).toBe(200);
    await indexarProjeto(raiz, { agora }); // aquecimento (JIT, cache de disco)
    const tempos: number[] = [];
    let lidos = 0;
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const ind = await indexarProjeto(raiz, { agora });
      tempos.push(performance.now() - t0);
      lidos = ind.artefatos_lidos;
    }
    tempos.sort((x, y) => x - y);
    const mediana = tempos[3] as number;
    console.log(`[P-10] ${lidos} artefatos lidos; mediana ${mediana.toFixed(1)} ms; min ${tempos[0]!.toFixed(1)}; max ${tempos[6]!.toFixed(1)}`);
    expect(lidos).toBeGreaterThanOrEqual(200);
    // o limite de 300 ms (P-10) é verificado em tests/perf; aqui só a correção, sem limite de tempo (a suíte roda sob carga)
  });
});
