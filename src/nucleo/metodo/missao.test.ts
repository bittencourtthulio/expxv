import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PedidoCriarMissao } from "../../compartilhado/dominio";
import { criarServicoMissoes } from "../missoes/servico";
import { criarServicoPanes } from "../missoes/panes";
import { criarServicoContas } from "../provedores/contas";
import { criarServicoWorkspaces } from "../workspaces/servico";
import { criarRepoGit, criarTmp, detectorFalso, ferramenta, git, limpar, novoBanco, sessoesFalsas } from "../../../tests/fixtures/dominio/ambiente";
import { escreverFeatureSimples, gerarProjetoExpx } from "../../../tests/fixtures/metodo/gerar";
import { criarConjunto } from "./indexador";
import type { IndiceProjeto } from "./tipos";
import { comandoInicialDaMissao, criarServicoMetodoMissao, descobrirTrabalhoDaMissao, gestoInicialDaOrigem, listarAdotaveis } from "./missao";

afterEach(limpar);

describe("origem → gesto → comando inicial", () => {
  it("feature → sprintx; ocorrência → runx; pedido → prodx-triar; projeto → buildx; livre → nada", () => {
    expect(gestoInicialDaOrigem("feature")).toBe("nova_feature");
    expect(gestoInicialDaOrigem("ocorrencia")).toBe("nova_ocorrencia");
    expect(gestoInicialDaOrigem("pedido")).toBe("pedido_cru");
    expect(gestoInicialDaOrigem("projeto")).toBe("projeto");
    expect(gestoInicialDaOrigem("livre")).toBeNull();
    const e = { titulo: "t", pedido: "cobrar por pix" };
    expect(comandoInicialDaMissao({ ...e, origem: "feature", cli: "claude" })).toBe("/expx:sprintx cobrar por pix");
    expect(comandoInicialDaMissao({ ...e, origem: "ocorrencia", cli: "claude" })).toBe("/expx:runx cobrar por pix");
    expect(comandoInicialDaMissao({ ...e, origem: "pedido", cli: "opencode" })).toBe("/prodx-triar cobrar por pix");
    expect(comandoInicialDaMissao({ ...e, origem: "projeto", cli: "claude" })).toBe("/expx:buildx cobrar por pix");
  });

  it("sem pedido, origem livre ou CLI sem suporte: nenhum comando (não trava o Pane)", () => {
    expect(comandoInicialDaMissao({ titulo: "t", pedido: "", origem: "feature", cli: "claude" })).toBeNull();
    expect(comandoInicialDaMissao({ titulo: "t", pedido: "x", origem: "livre", cli: "claude" })).toBeNull();
    expect(comandoInicialDaMissao({ titulo: "t", pedido: "x", origem: "feature", cli: "codex" })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------ montagem

async function montar(opcoes: { ferramentas?: ReturnType<typeof ferramenta>[]; contextoPrevio?: (ws: string, texto: string, arquivos: string[]) => Promise<string>; modulosDesligados?: (ws: string) => ReadonlySet<string>; confirmarEntregaMs?: number } = {}) {
  const { banco, repos } = novoBanco();
  const sessoes = sessoesFalsas();
  const workspaces = criarServicoWorkspaces({ repos, escolherPasta: async () => null });
  const contas = criarServicoContas({ banco, repos, pastaDeDados: criarTmp("dados-") });
  const detector = detectorFalso(opcoes.ferramentas);
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes, comandoInicial: comandoInicialDaMissao });
  const conjunto = criarConjunto();
  const metodo = criarServicoMetodoMissao({
    repos, workspaces, missoes, panes, detector,
    ...(opcoes.contextoPrevio === undefined ? {} : { contextoPrevio: opcoes.contextoPrevio }),
    ...(opcoes.modulosDesligados === undefined ? {} : { modulosDesligados: opcoes.modulosDesligados }),
    ...(opcoes.confirmarEntregaMs === undefined ? {} : { confirmarEntregaMs: opcoes.confirmarEntregaMs }),
    indices: async (wsId) => {
      const ws = workspaces.exigir(wsId);
      const { worktreeList } = await import("../git");
      const raizes = ws.e_git ? (await worktreeList(ws.raiz)).map((w) => w.caminho) : [ws.raiz];
      await conjunto.sincronizar(raizes);
      for (const r of raizes) await conjunto.reindexar(r);
      return new Map(raizes.map((r) => [r, conjunto.obter(r) as IndiceProjeto]));
    },
  });
  return { repos, sessoes, workspaces, panes, missoes, metodo, conjunto };
}

const pedidoMissao = (ws: string, extra: Partial<PedidoCriarMissao> = {}): PedidoCriarMissao => ({
  workspace_id: ws, modo: "agentico", origem: "feature", titulo: "Cobrança via PIX", pedido: "cobrar por pix", clis: { piloto: "claude" }, ...extra,
});

describe("Missão ↔ trabalho", () => {
  it("criar Missão feature → worktree + Pane + /expx:sprintx <pedido> rodando NO worktree", async () => {
    const { workspaces, missoes, repos, sessoes } = await montar();
    const { raiz, pai } = criarRepoGit();
    const ws = await workspaces.abrir(raiz);
    const m = await missoes.criar(pedidoMissao(ws?.id as string));
    const pane = repos.pane.listarPorMissao(m.id)[0];
    const s = sessoes.sessoes.get(pane?.sessao_pty_id as string);
    expect(s?.cwd).toBe(join(pai, "repo--cobranca-via-pix"));
    expect(s?.pedido["prompt_inicial"]).toBe("/expx:sprintx cobrar por pix");
  });

  it("descobre o trabalho_id pelo disco e liga à Missão (junção por trabalho_id)", async () => {
    const { workspaces, missoes, metodo, repos } = await montar();
    const { raiz, pai } = criarRepoGit();
    const ws = await workspaces.abrir(raiz);
    const m = await missoes.criar(pedidoMissao(ws?.id as string, { clis: {}, modo: "livre" }));
    // a skill (F1) grava o trabalho DENTRO do worktree
    escreverFeatureSimples(join(pai, "repo--cobranca-via-pix"), "docs/sprintx/features/cobranca-via-pix", "cobranca-via-pix");
    const ligadas = await metodo.sincronizarLigacoes(ws?.id as string);
    expect(ligadas).toEqual([{ mission_id: m.id, trabalho_id: "cobranca-via-pix" }]);
    expect(repos.mission.exigir(m.id).trabalho_id).toBe("cobranca-via-pix");
    expect(await metodo.sincronizarLigacoes(ws?.id as string)).toEqual([]); // idempotente
  });

  it("o worktree traz cópia do docs/ da principal: só o que é novo nele conta (não liga o trabalho errado)", async () => {
    const { workspaces, missoes, metodo, repos } = await montar();
    const { raiz, pai } = criarRepoGit();
    const info = gerarProjetoExpx(raiz);
    const ws = await workspaces.abrir(raiz);
    const m = await missoes.criar(pedidoMissao(ws?.id as string, { clis: {}, modo: "livre" }));
    const wt = join(pai, "repo--cobranca-via-pix");
    gerarProjetoExpx(wt); // cópia do que já existia (commitado) na árvore principal
    expect(info.ids["emExecucao"]).toBe("cobranca-pix");
    expect(await metodo.sincronizarLigacoes(ws?.id as string)).toEqual([]); // nada novo ainda
    escreverFeatureSimples(wt, "docs/sprintx/features/cobranca-via-pix", "cobranca-via-pix");
    expect((await metodo.sincronizarLigacoes(ws?.id as string))[0]?.trabalho_id).toBe("cobranca-via-pix");
    expect(repos.mission.exigir(m.id).trabalho_id).toBe("cobranca-via-pix");
  });

  it("ambíguo: dois trabalhos novos sem pista de nome → não adivinha", () => {
    const indice = (ids: string[]): IndiceProjeto => ({ trabalhos: ids.map((id) => ({ id, tipo: "feature", status: "em_andamento", worktree: null, ultima_atividade: null })) }) as unknown as IndiceProjeto;
    const ws = { id: "ws_1", raiz: "/r/repo" } as never;
    const missao = { id: "mis_1", origem: "feature", titulo: "Algo sem relação", worktree: "../repo--algo", branch: "feature/algo", trabalho_id: null } as never;
    const indices = new Map([["/r/repo", indice([])], ["/r/repo--algo", indice(["a-um", "b-dois"])]]);
    expect(descobrirTrabalhoDaMissao(missao, ws, indices, new Set())).toBeNull();
    const unico = new Map([["/r/repo", indice([])], ["/r/repo--algo", indice(["a-um"])]]);
    expect(descobrirTrabalhoDaMissao(missao, ws, unico, new Set())).toBe("a-um");
    expect(descobrirTrabalhoDaMissao(missao, ws, unico, new Set(["a-um"]))).toBeNull(); // já ligado a outra Missão
  });

  it("ocorrência casa pelo sufixo do branch (fix/<OC-ID>-<slug>)", () => {
    const indice = (ids: string[]): IndiceProjeto => ({ trabalhos: ids.map((id) => ({ id, tipo: "ocorrencia", status: "em_andamento", worktree: null, ultima_atividade: null })) }) as unknown as IndiceProjeto;
    const ws = { id: "ws_1", raiz: "/r/repo" } as never;
    const missao = { id: "mis_1", origem: "ocorrencia", titulo: "Frete errado", worktree: "../repo--frete-errado", branch: "fix/OC-2026-0142-frete-errado", trabalho_id: null } as never;
    const indices = new Map([["/r/repo", indice([])], ["/r/repo--frete-errado", indice(["OC-2026-0141-outra", "OC-2026-0142-frete-errado"])]]);
    expect(descobrirTrabalhoDaMissao(missao, ws, indices, new Set())).toBe("OC-2026-0142-frete-errado");
  });

  it("trabalho criado fora do ADE aparece como adotável; adotar cria a Missão ligada, sem worktree novo", async () => {
    const { workspaces, metodo, repos } = await montar();
    const { raiz } = criarRepoGit();
    gerarProjetoExpx(raiz);
    const ws = await workspaces.abrir(raiz);
    const a = await metodo.adotaveis(ws?.id as string);
    const ids = a.map((x) => x.trabalho_id);
    expect(ids).toContain("cobranca-pix");
    expect(ids).not.toContain("OC-2026-0142-frete-errado"); // concluído: nada a adotar
    expect(a.find((x) => x.trabalho_id === "cobranca-pix")).toMatchObject({ tipo: "feature", worktree: null });
    const m = await metodo.adotar(ws?.id as string, "cobranca-pix");
    expect(m).toMatchObject({ trabalho_id: "cobranca-pix", origem: "feature", worktree: null, estado: "intake" });
    expect((await metodo.adotaveis(ws?.id as string)).map((x) => x.trabalho_id)).not.toContain("cobranca-pix");
    await expect(metodo.adotar(ws?.id as string, "cobranca-pix")).rejects.toThrow(/adot/i);
    expect(repos.mission.listarPorWorkspace(ws?.id as string).itens).toHaveLength(1);
  });

  it("listarAdotaveis é pura: ignora pedido/projeto e o que já tem Missão", () => {
    const t = (id: string, tipo: string, status = "em_andamento") => ({ id, tipo, titulo: id, status, estagio: "f6", worktree: null });
    const indice = { trabalhos: [t("a", "feature"), t("b", "ocorrencia"), t("c", "pedido"), t("d", "projeto"), t("e", "feature", "concluido"), t("f", "feature")] } as unknown as IndiceProjeto;
    const r = listarAdotaveis(new Map([["/r", indice]]), "/r", new Set(["f"]));
    expect(r.map((x) => x.trabalho_id)).toEqual(["a", "b"]);
  });
});

describe("disparar comando com contexto prévio do RAG (Fase 15)", () => {
  const ENV = '<conhecimento_previo tipo="dados">já houve correção parecida</conhecimento_previo>';
  async function ws(contextoPrevio: (ws: string, texto: string, arquivos: string[]) => Promise<string>) {
    const ctx = await montar({ contextoPrevio });
    const { raiz } = criarRepoGit();
    const w = await ctx.workspaces.abrir(raiz);
    return { ...ctx, w: w as NonNullable<typeof w>, raiz };
  }
  const pedido = (w: string, extra: Record<string, unknown> = {}) => ({ workspace_id: w, trabalho_id: null, gesto: "nova_feature" as const, argumento: "cobrar por pix", pane_id: null, ...extra });

  it("grava o contexto na pasta do produto e aponta para ele no argumento (uma linha, sem o envelope inline)", async () => {
    const chamadas: unknown[][] = [];
    const { metodo, w, raiz, sessoes } = await ws(async (...a) => (chamadas.push(a), ENV));
    const r = await metodo.disparar(pedido(w.id));
    expect(r.ok).toBe(true);
    expect(chamadas[0]).toEqual([w.id, "cobrar por pix", []]);
    expect(r.comando).toMatch(/^\/expx:sprintx cobrar por pix — Contexto prévio: \.expxv\/contexto\/[A-Za-z0-9._-]+\.md$/);
    const rel = /Contexto prévio: (\S+)$/.exec(r.comando as string)?.[1] as string;
    expect(readFileSync(join(raiz, rel), "utf8")).toBe(ENV);
    expect(r.comando).not.toContain("\n");
    expect([...sessoes.sessoes.values()][0]?.pedido["prompt_inicial"]).toBe(r.comando);
  });

  it("falha, lentidão (> 150 ms), vazio ou gesto sem texto livre: segue com o comando original", async () => {
    for (const rag of [async () => { throw new Error("rag fora"); }, () => new Promise<string>(() => undefined), async () => "  "]) {
      const { metodo, w } = await ws(rag);
      expect(await metodo.disparar(pedido(w.id))).toMatchObject({ ok: true, comando: "/expx:sprintx cobrar por pix" });
    }
    const spy: string[] = [];
    const { metodo, w } = await ws(async (_w, t) => (spy.push(t), ENV));
    const r = await metodo.disparar(pedido(w.id, { gesto: "auditar", trabalho_id: null, argumento: "x" }));
    expect(spy).toEqual([]);
    expect(r.comando ?? "").not.toContain("Contexto prévio");
  });
});

describe("disparar comando", () => {
  async function comTrabalho() {
    const ctx = await montar();
    const { raiz, pai } = criarRepoGit();
    gerarProjetoExpx(raiz);
    const ws = await ctx.workspaces.abrir(raiz);
    return { ...ctx, ws: ws as NonNullable<typeof ws>, raiz, pai };
  }
  const base = (ws: string, extra: Record<string, unknown> = {}) => ({ workspace_id: ws, trabalho_id: "cobranca-pix", gesto: "retomar" as const, argumento: null, pane_id: null, ...extra });

  it("'Avançar' abre um Pane e digita /expx:sprintx <slug> (prompt inicial) com cwd do trabalho", async () => {
    const { metodo, ws, sessoes, raiz } = await comTrabalho();
    const r = await metodo.disparar(base(ws.id));
    expect(r).toMatchObject({ ok: true, comando: "/expx:sprintx cobranca-pix", motivo: null });
    expect(r.pane_id).not.toBeNull();
    const s = [...sessoes.sessoes.values()][0];
    expect(s?.pedido["prompt_inicial"]).toBe("/expx:sprintx cobranca-pix");
    expect(s?.cwd).toBe(raiz);
  });

  it("trabalho que vive num worktree abre o Pane nele (cwd = worktree do trabalho)", async () => {
    const { metodo, ws, sessoes, raiz, pai } = await comTrabalho();
    git(raiz, "worktree", "add", "-q", "-b", "feature/nova-coisa", join(pai, "repo--nova-coisa"));
    escreverFeatureSimples(join(pai, "repo--nova-coisa"), "docs/sprintx/features/nova-coisa", "nova-coisa");
    const r = await metodo.disparar(base(ws.id, { trabalho_id: "nova-coisa" }));
    expect(r.ok).toBe(true);
    expect([...sessoes.sessoes.values()][0]?.cwd).toBe(join(pai, "repo--nova-coisa"));
  });

  it("vai para o Pane pedido quando ele está pronto, digitando com Enter", async () => {
    const { metodo, ws, panes, sessoes } = await comTrabalho();
    const p = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", papel: "executor" });
    sessoes.emitir(p.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    const r = await metodo.disparar(base(ws.id, { pane_id: p.pane.id }));
    expect(r).toMatchObject({ ok: true, pane_id: p.pane.id });
    expect(sessoes.sessoes.get(p.sessao_id)?.escritas).toEqual(["/expx:sprintx cobranca-pix\r"]);
  });

  it("Pane aguardando não recebe reenvio: nada é escrito e a razão volta para a UI", async () => {
    const { metodo, ws, panes, sessoes } = await comTrabalho();
    const p = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", papel: "executor" });
    sessoes.emitir(p.sessao_id, { tipo: "atividade", atividade: "aguardando" });
    const r = await metodo.disparar(base(ws.id, { pane_id: p.pane.id }));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/aguardando/);
    expect(sessoes.sessoes.get(p.sessao_id)?.escritas).toEqual([]);
  });

  it("avaliador em Pane separado: não entra no do implementador; sem pane_id abre um revisor novo", async () => {
    const { metodo, ws, panes, sessoes } = await comTrabalho();
    const impl = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", papel: "executor" });
    sessoes.emitir(impl.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    const recusado = await metodo.disparar(base(ws.id, { gesto: "auditar", pane_id: impl.pane.id }));
    expect(recusado.ok).toBe(false);
    expect(recusado.motivo).toMatch(/separado/);
    expect(sessoes.sessoes.get(impl.sessao_id)?.escritas).toEqual([]);
    const novo = await metodo.disparar(base(ws.id, { gesto: "auditar" }));
    expect(novo).toMatchObject({ ok: true, comando: "/expx:sprintx-auditoria cobranca-pix" });
    expect(novo.pane_id).not.toBe(impl.pane.id);
    expect(sessoes.sessoes.size).toBe(2);
  });

  it("o Pane do avaliador é um revisor", async () => {
    const { metodo, ws, repos } = await comTrabalho();
    const r = await metodo.disparar(base(ws.id, { gesto: "entrega_atencao" }));
    expect(repos.pane.exigir(r.pane_id as string).papel).toBe("revisor");
  });

  it("ações sempre humanas não disparam nada nem abrem Pane", async () => {
    const { metodo, ws, sessoes } = await comTrabalho();
    const r = await metodo.disparar(base(ws.id, { trabalho_id: "PD-2026-0007" }));
    expect(r).toMatchObject({ ok: false, pane_id: null, comando: null });
    expect(r.motivo).toMatch(/assinatura/i);
    const raio = await metodo.disparar(base(ws.id, { trabalho_id: "exportar-csv" }));
    expect(raio.ok).toBe(false);
    expect(raio.motivo).toMatch(/raio ALTO/);
    expect(sessoes.sessoes.size).toBe(0);
  });

  it("sem argumento nos gestos que criam trabalho: recusa com motivo, sem Pane", async () => {
    const { metodo, ws, sessoes } = await comTrabalho();
    const r = await metodo.disparar({ workspace_id: ws.id, trabalho_id: null, gesto: "nova_feature", argumento: "  ", pane_id: null });
    expect(r).toMatchObject({ ok: false, comando: null });
    expect(r.motivo).toMatch(/argumento/);
    expect(sessoes.sessoes.size).toBe(0);
    const ok = await metodo.disparar({ workspace_id: ws.id, trabalho_id: null, gesto: "nova_feature", argumento: "exportar csv", pane_id: null });
    expect(ok).toMatchObject({ ok: true, comando: "/expx:sprintx exportar csv" });
  });

  it("trabalho inexistente, Pane de outro workspace e CLI ausente devolvem motivo (nunca lançam)", async () => {
    const { metodo, ws, workspaces } = await comTrabalho();
    expect((await metodo.disparar(base(ws.id, { trabalho_id: "nao-existe" }))).motivo).toMatch(/não encontrado/i);
    const outro = await workspaces.abrir(criarTmp());
    const p = await metodo.disparar(base(ws.id));
    const cruzado = await metodo.disparar({ ...base(outro?.id as string), trabalho_id: null, gesto: "nova_feature", argumento: "x", pane_id: p.pane_id });
    expect(cruzado.ok).toBe(false);
    const sem = await montar({ ferramentas: [ferramenta("claude", false), ferramenta("opencode", false), ferramenta("terminal")] });
    const w = await sem.workspaces.abrir(criarTmp());
    const r = await sem.metodo.disparar({ workspace_id: w?.id as string, trabalho_id: null, gesto: "nova_feature", argumento: "x", pane_id: null });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/Claude Code ou OpenCode/);
  });

  it("comando_sugerido usa o harness do lock e devolve o mesmo que o disparo usaria", async () => {
    const { metodo, ws, raiz } = await comTrabalho();
    mkdirSync(join(raiz, ".expx"), { recursive: true });
    writeFileSync(join(raiz, ".expx", "expx-lock.json"), JSON.stringify({ lock_version: 1, cli_version: "0.9.0", harness: ["opencode"], skills: {} }));
    const s = await metodo.comandoSugeridoPara({ workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "retomar", argumento: null });
    expect(s).toMatchObject({ comando: "/sprintx cobranca-pix", pane_separado: false, somente_humano: false });
    const a = await metodo.comandoSugeridoPara({ workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "auditar", argumento: null });
    expect(a.pane_separado).toBe(true);
  });
});

describe("módulos da suíte desligados (D-480)", () => {
  async function comModulos(desligados: string[]) {
    const ctx = await montar({ modulosDesligados: () => new Set(desligados) });
    const { raiz } = criarRepoGit();
    gerarProjetoExpx(raiz);
    const ws = await ctx.workspaces.abrir(raiz);
    return { ...ctx, ws: ws as NonNullable<typeof ws> };
  }

  it("comando_sugerido de um módulo desligado sai vazio com o motivo; de outro módulo passa", async () => {
    const { metodo, ws } = await comModulos(["sprintx"]);
    const bloqueado = await metodo.comandoSugeridoPara({ workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "retomar", argumento: null });
    expect(bloqueado.comando).toBe("");
    expect(bloqueado.motivo_bloqueio).toMatch(/módulo sprintx está desligado.*Módulos da suíte/);
    const livre = await metodo.comandoSugeridoPara({ workspace_id: ws.id, trabalho_id: null, gesto: "nova_ocorrencia", argumento: "bug no login" });
    expect(livre.comando).toBe("/expx:runx bug no login");
  });

  it("disparar de um módulo desligado é recusado e NÃO abre Pane; ligado volta a abrir", async () => {
    let off = ["sprintx"];
    const ctx = await montar({ modulosDesligados: () => new Set(off) });
    const { raiz } = criarRepoGit();
    gerarProjetoExpx(raiz);
    const ws = (await ctx.workspaces.abrir(raiz)) as NonNullable<Awaited<ReturnType<typeof ctx.workspaces.abrir>>>;
    const pedido = { workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "retomar" as const, argumento: null, pane_id: null };
    const r = await ctx.metodo.disparar(pedido);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/sprintx está desligado/);
    expect([...ctx.sessoes.sessoes.values()]).toHaveLength(0);
    off = [];
    expect((await ctx.metodo.disparar(pedido)).ok).toBe(true);
  });

  it("uma porta que lança vale como nenhum módulo desligado", async () => {
    const ctx = await montar({ modulosDesligados: () => { throw new Error("x"); } });
    const { raiz } = criarRepoGit();
    gerarProjetoExpx(raiz);
    const ws = (await ctx.workspaces.abrir(raiz)) as NonNullable<Awaited<ReturnType<typeof ctx.workspaces.abrir>>>;
    expect((await ctx.metodo.comandoSugeridoPara({ workspace_id: ws.id, trabalho_id: "cobranca-pix", gesto: "retomar", argumento: null })).comando).toBe("/expx:sprintx cobranca-pix");
  });
});

describe("entrega confirmada do comando (causa do 'Pane aberto e vazio')", () => {
  const base = (ws: string, extra: Record<string, unknown> = {}) => ({ workspace_id: ws, trabalho_id: null, gesto: "nova_feature" as const, argumento: "exportar relatório", pane_id: null, ...extra });
  async function ctxEntrega(confirmarEntregaMs = 0) {
    const ctx = await montar({ confirmarEntregaMs });
    const { raiz } = criarRepoGit();
    gerarProjetoExpx(raiz);
    const ws = (await ctx.workspaces.abrir(raiz)) as NonNullable<Awaited<ReturnType<typeof ctx.workspaces.abrir>>>;
    return { ...ctx, ws };
  }

  it("Pane livre COM preparo de MCP/settings (o caso real do dono): o comando chega à CLI como prompt inicial e o resultado diz 'entregue'", async () => {
    const { metodo, panes, ws, sessoes } = await ctxEntrega();
    panes.definirPreparador(async () => ({ argumentos: ["--mcp-config", "/x/mcp.json", "--settings", "/x/s.json"], ambiente: {} }));
    const r = await metodo.disparar(base(ws.id));
    expect(r).toMatchObject({ ok: true, estado: "entregue", entrega: "prompt_inicial", motivo: null, comando: "/expx:sprintx exportar relatório" });
    const s = sessoes.sessoes.get(r.sessao_id as string);
    expect(s?.pedido["prompt_inicial"]).toBe("/expx:sprintx exportar relatório");
  });

  it("CLI que sai na largada: NÃO é 'enviado'; volta falhou com a causa em linguagem simples e a ação", async () => {
    const { metodo, ws, sessoes } = await ctxEntrega(300);
    const abrir = sessoes.abrir;
    sessoes.abrir = ((...a: Parameters<typeof abrir>) => {
      const r = abrir(...a);
      setTimeout(() => sessoes.emitir(r.sessao_id, { tipo: "encerramento", codigo: 1, sinal: null }), 20);
      return r;
    }) as typeof abrir;
    const r = await metodo.disparar(base(ws.id));
    expect(r.ok).toBe(false);
    expect(r.estado).toBe("falhou");
    expect(r.motivo).toMatch(/A CLI Claude Code saiu antes de receber o comando/);
    expect(r.motivo).toMatch(/autentic|instal/i);
    expect(r.pane_id).not.toBeNull();
  });

  it("Pane existente pronto: escrita real no PTY => entregue/escrita; Pane ocupado => falhou (nada escrito)", async () => {
    const { metodo, panes, ws, sessoes } = await ctxEntrega();
    const p = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", papel: "nenhum" });
    sessoes.emitir(p.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    const ok = await metodo.disparar(base(ws.id, { pane_id: p.pane.id }));
    expect(ok).toMatchObject({ ok: true, estado: "entregue", entrega: "escrita", sessao_id: p.sessao_id });
    expect(sessoes.sessoes.get(p.sessao_id)?.escritas).toEqual(["/expx:sprintx exportar relatório\r"]);
    sessoes.emitir(p.sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    const ocupado = await metodo.disparar(base(ws.id, { pane_id: p.pane.id }));
    expect(ocupado).toMatchObject({ ok: false, estado: "falhou" });
    expect(sessoes.sessoes.get(p.sessao_id)?.escritas).toHaveLength(1);
  });
});
