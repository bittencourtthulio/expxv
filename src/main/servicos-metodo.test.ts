import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarIndexador } from "../nucleo/metodo/indexador";
import type { IndiceProjeto, Trabalho } from "../nucleo/metodo/tipos";
import { criarRepoGit, criarTmp, git, limpar } from "../../tests/fixtures/dominio/ambiente";
import { escreverFeatureSimples, evento, gerarProjetoExpx } from "../../tests/fixtures/metodo/gerar";
import { criarGerenciadorMetodo, mesclarIndices, type WorkspaceMetodo } from "./servicos-metodo";

afterEach(limpar);

const aguardar = (ms: number) => new Promise((r) => setTimeout(r, ms));
// espera por evento real do sistema de arquivos: o limite é só "não travou", sem valer como orçamento (a suíte roda sob carga)
async function ate(cond: () => boolean, limiteMs = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > limiteMs) throw new Error("tempo esgotado esperando a condição");
    await aguardar(15);
  }
}

function clienteLocal() {
  const indexador = criarIndexador();
  return {
    chamadas: [] as string[],
    indexar(raiz: string) { this.chamadas.push(`indexar:${raiz}`); return indexador.indexar(raiz); },
    async descartar(raiz: string) { this.chamadas.push(`descartar:${raiz}`); indexador.descartar(raiz); },
    async encerrar() { this.chamadas.push("encerrar"); },
  };
}

const ws = (id: string, raiz: string, e_git = false): WorkspaceMetodo => ({ id, raiz, e_git });

function montar(opcoes: { debounceMs?: number } = {}) {
  const resumos: Array<{ workspace_id: string; trabalhos: number; violacoes: number; gerado_em: string }> = [];
  const cliente = clienteLocal();
  const criarCliente = vi.fn(() => cliente);
  const gm = criarGerenciadorMetodo({
    criarCliente: criarCliente as never,
    aoMudar: (r) => void resumos.push(r),
    debounceMs: opcoes.debounceMs ?? 40,
    estabilidadeMs: 30,
    assentamentoMs: 0,
  });
  return { gm, resumos, cliente, criarCliente };
}

describe("mesclarIndices (um índice por worktree → um só por workspace)", () => {
  const t = (id: string, ultima: string | null, extra: Partial<Trabalho> = {}): Trabalho => ({ id, tipo: "feature", titulo: id, worktree: null, ultima_atividade: ultima, violacoes: [], ...extra }) as unknown as Trabalho;
  const ind = (raiz: string, trabalhos: Trabalho[], extra: Partial<IndiceProjeto> = {}): IndiceProjeto =>
    ({ raiz, gerado_em: "2026-09-30T10:00:00.000Z", duracao_ms: 5, trabalhos, violacoes: [], rejeicoes: [], avisos: [], camadas: { convencoes: true }, artefatos_lidos: 3, ...extra }) as unknown as IndiceProjeto;

  it("une os trabalhos; o que só existe no worktree ganha o caminho relativo dele", () => {
    const m = mesclarIndices("/r/repo", new Map([["/r/repo", ind("/r/repo", [t("a", null)])], ["/r/repo--x", ind("/r/repo--x", [t("x", null)])]]));
    expect(m.raiz).toBe("/r/repo");
    expect(m.trabalhos.map((x) => x.id).sort()).toEqual(["a", "x"]);
    expect(m.trabalhos.find((x) => x.id === "x")?.worktree).toBe("../repo--x");
    expect(m.trabalhos.find((x) => x.id === "a")?.worktree).toBeNull();
    expect(m.artefatos_lidos).toBe(6);
  });

  it("mesmo trabalho nas duas árvores: vence a atividade mais recente; empate fica com a principal", () => {
    const novo = t("a", "2026-09-30T09:00:00Z", { titulo: "do worktree" });
    const velho = t("a", "2026-09-29T09:00:00Z", { titulo: "da principal" });
    expect(mesclarIndices("/r/repo", new Map([["/r/repo", ind("/r/repo", [velho])], ["/r/repo--x", ind("/r/repo--x", [novo])]])).trabalhos[0]?.titulo).toBe("do worktree");
    const empate = mesclarIndices("/r/repo", new Map([["/r/repo", ind("/r/repo", [{ ...velho, ultima_atividade: "2026-09-30T09:00:00Z" } as Trabalho])], ["/r/repo--x", ind("/r/repo--x", [novo])]]));
    expect(empate.trabalhos[0]?.titulo).toBe("da principal");
  });

  it("violações são as dos trabalhos escolhidos; camadas e rejeições vêm da principal", () => {
    const v = { tipo: "teste_ausente", trabalho_id: "a", alvo: "T-1", arquivo: "x", detalhe: "" };
    const m = mesclarIndices("/r/repo", new Map([["/r/repo", ind("/r/repo", [t("a", null, { violacoes: [v] as never })], { rejeicoes: [{ caminho: "p", motivo: "yaml_invalido" }] })], ["/r/repo--x", ind("/r/repo--x", [], { camadas: { convencoes: false } as never })]]));
    expect(m.violacoes).toEqual([v]);
    expect(m.camadas.convencoes).toBe(true);
    expect(m.rejeicoes).toHaveLength(1);
  });

  it("sem índice da principal ainda, devolve só o que há", () => {
    const m = mesclarIndices("/r/repo", new Map([["/r/repo--x", ind("/r/repo--x", [t("x", null)])]]));
    expect(m.trabalhos).toHaveLength(1);
  });
});

describe("gerenciador do método", () => {
  it("não faz nada até alguém pedir: criar o gerenciador não abre worker nem watcher", () => {
    const { criarCliente, gm } = montar();
    expect(criarCliente).not.toHaveBeenCalled();
    expect(gm.estado("ws_1")).toBeNull();
  });

  it("garantir indexa o workspace pelo worker e devolve o estado", async () => {
    const { gm, criarCliente } = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    expect(criarCliente).toHaveBeenCalledTimes(1);
    const e = gm.estado("ws_1");
    expect(e?.trabalhos.length).toBeGreaterThan(5);
    expect(e?.raiz).toBe(raiz);
    await gm.garantir(ws("ws_1", raiz)); // idempotente
    expect(criarCliente).toHaveBeenCalledTimes(1);
    await gm.encerrar();
  });

  it("tocar tasks.md → metodo:mudou (resumo); a latência (P-11, 600 ms) é medida em tests/perf", async () => {
    const { gm, resumos } = montar({ debounceMs: 300 });
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    await gm.prontoObservadores("ws_1");
    resumos.length = 0;
    appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/sprint-01/tasks.md"), "\n<!-- toque -->\n");
    await ate(() => resumos.length > 0, 15_000);
    expect(resumos[0]).toMatchObject({ workspace_id: "ws_1" });
    expect(resumos[0]?.trabalhos).toBeGreaterThan(5);
    await gm.encerrar();
  });

  it("rajada de toques vira poucas releituras (não uma por toque)", async () => {
    const { gm, resumos } = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    await gm.prontoObservadores("ws_1");
    resumos.length = 0;
    for (let i = 0; i < 30; i++) appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/00-DECISOES.md"), `\n<!-- ${i} -->`);
    await ate(() => resumos.length > 0); // espera o evento do FSEvents (sob carga demora); só depois conta as releituras
    await aguardar(700);
    expect(resumos.length).toBeLessThanOrEqual(3);
    await gm.encerrar();
  });

  it("indexa um worktree por git worktree list, inclusive o criado depois (ressincronizar)", async () => {
    const { gm, cliente } = montar();
    const { raiz, pai } = criarRepoGit();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz, true));
    expect(cliente.chamadas.filter((c) => c.startsWith("indexar:"))).toHaveLength(1);
    git(raiz, "worktree", "add", "-q", "-b", "feature/nova", join(pai, "repo--nova"));
    escreverFeatureSimples(join(pai, "repo--nova"), "docs/sprintx/features/nova", "nova");
    await gm.ressincronizar("ws_1");
    const e = gm.estado("ws_1");
    expect(e?.trabalhos.find((x) => x.id === "nova")?.worktree).toBe("../repo--nova");
    const indices = await gm.indices("ws_1");
    expect([...indices.keys()].sort()).toEqual([raiz, join(pai, "repo--nova")].sort());
    await gm.encerrar();
  });

  it("worktree removido sai do conjunto e libera o watcher", async () => {
    const { gm, cliente } = montar();
    const { raiz, pai } = criarRepoGit();
    git(raiz, "worktree", "add", "-q", "-b", "feature/x", join(pai, "repo--x"));
    await gm.garantir(ws("ws_1", raiz, true));
    expect([...(await gm.indices("ws_1")).keys()]).toHaveLength(2);
    git(raiz, "worktree", "remove", join(pai, "repo--x"));
    await gm.ressincronizar("ws_1");
    expect([...(await gm.indices("ws_1")).keys()]).toEqual([raiz]);
    expect(cliente.chamadas).toContain(`descartar:${join(pai, "repo--x")}`);
    await gm.encerrar();
  });

  it("rastro: lê o JSONL do trabalho (inclusive rotacionado) com cursor", async () => {
    const { gm } = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    const tudo = await gm.rastro("ws_1", "cobranca-pix", 0);
    expect(tudo.eventos.length).toBe(6);
    expect(tudo.proximo).toBe(6);
    expect(tudo.eventos.map((e) => e.ts)).toEqual([...tudo.eventos.map((e) => e.ts)].sort());
    const resto = await gm.rastro("ws_1", "cobranca-pix", 4);
    expect(resto.eventos).toHaveLength(2);
    expect(resto.proximo).toBe(6);
    expect((await gm.rastro("ws_1", "cobranca-pix", 6)).eventos).toEqual([]);
    expect(await gm.rastro("ws_1", "nao-existe", 0)).toEqual({ eventos: [], proximo: 0 });
    expect(await gm.rastro("ws_desconhecido", "cobranca-pix", 0)).toEqual({ eventos: [], proximo: 0 });
    await gm.encerrar();
  });

  it("evento novo no JSONL aparece no rastro", async () => {
    const { gm } = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    await gm.prontoObservadores("ws_1");
    const antes = (await gm.rastro("ws_1", "cobranca-pix", 0)).proximo;
    appendFileSync(join(raiz, "docs/eventos/cobranca-pix.jsonl"), evento({ ts: "2026-09-30T10:00:00Z", trabalho_id: "cobranca-pix", evento: "task_concluida", task: "T-01.04" }) + "\n");
    expect((await gm.rastro("ws_1", "cobranca-pix", 0)).proximo).toBe(antes + 1);
    await gm.encerrar();
  });

  it("soltar/encerrar libera watchers e worker; depois disso nada mais emite", async () => {
    const { gm, resumos, cliente } = montar();
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    await gm.prontoObservadores("ws_1");
    await gm.soltar("ws_1");
    expect(gm.estado("ws_1")).toBeNull();
    resumos.length = 0;
    appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/00-DECISOES.md"), "\n<!-- x -->");
    await aguardar(400);
    expect(resumos).toEqual([]);
    await gm.garantir(ws("ws_2", raiz));
    await gm.encerrar();
    expect(cliente.chamadas).toContain("encerrar");
    appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/00-DECISOES.md"), "\n<!-- y -->");
    await aguardar(400);
    expect(resumos).toEqual([]);
    await gm.encerrar(); // idempotente
  });

  it("soltarExceto mantém só o workspace atual", async () => {
    const { gm } = montar();
    const a = criarTmp();
    const b = criarTmp();
    gerarProjetoExpx(a);
    gerarProjetoExpx(b);
    await gm.garantir(ws("ws_a", a));
    await gm.garantir(ws("ws_b", b));
    await gm.soltarExceto("ws_b");
    expect(gm.estado("ws_a")).toBeNull();
    expect(gm.estado("ws_b")).not.toBeNull();
    await gm.encerrar();
  });

  it("após cada releitura avisa quem liga Missões ao trabalho (aoAtualizar)", async () => {
    const chamadas: string[] = [];
    const cliente = clienteLocal();
    const gm = criarGerenciadorMetodo({ criarCliente: () => cliente as never, aoMudar: () => undefined, aoAtualizar: (id) => void chamadas.push(id), debounceMs: 40, estabilidadeMs: 30, assentamentoMs: 0 });
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    await gm.garantir(ws("ws_1", raiz));
    await gm.prontoObservadores("ws_1");
    expect(chamadas).toEqual(["ws_1"]);
    // o stream do FSEvents pode demorar a valer sob carga e perder o primeiro toque: toca de novo até a releitura vir
    for (let i = 0; i < 15 && chamadas.length < 2; i++) {
      appendFileSync(join(raiz, "docs/sprintx/features/cobranca-pix/00-DECISOES.md"), `\n<!-- z${i} -->`);
      await ate(() => chamadas.length >= 2, 1_500).catch(() => undefined);
    }
    await ate(() => chamadas.length >= 2, 1_000);
    await gm.encerrar();
  });

  it("erro do worker vira aviso e o estado anterior continua (nunca derruba)", async () => {
    const avisos: string[] = [];
    const falho = { indexar: async () => { throw new Error("worker caiu"); }, descartar: async () => undefined, encerrar: async () => undefined };
    const gm = criarGerenciadorMetodo({ criarCliente: () => falho as never, aoMudar: () => undefined, aviso: (m) => void avisos.push(m), debounceMs: 40, estabilidadeMs: 30, assentamentoMs: 0 });
    const raiz = criarTmp();
    mkdirSync(join(raiz, "docs"));
    writeFileSync(join(raiz, "docs", "x.md"), "x");
    await expect(gm.garantir(ws("ws_1", raiz))).resolves.toBeUndefined();
    expect(avisos.join(" ")).toMatch(/worker caiu/);
    expect(gm.estado("ws_1")?.trabalhos ?? []).toEqual([]);
    await gm.encerrar();
  });
});
