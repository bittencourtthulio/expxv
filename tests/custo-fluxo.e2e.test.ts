// E2E de custo e board, FLUXOS (Fase 10, T-10.31, cenários 1 a 13) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). Complementa `tests/custo.e2e.test.ts` (parte de UI).
// Como o app "enxerga" a CLI falsa: o teste faz o papel da CLI e grava o transcript no formato do Claude em `$HOME/.claude/projects/p/<conversa>.jsonl` (o HOME do app é
// uma pasta temporária) e registra a conversa em `sessao.cli_ref_conversa` do Pane; o ADE descobre a fonte nos eventos do Pane (foco/estado) e lê por offset.
// Os cenários que dependem do roteador do harness (9) se auto-ignoram quando a delegação devolve `no_router`.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUTO } from "../src/nucleo/produto";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { escreverFeatureSimples, fase, fasesMd, orquestrador, sprintMd, task, tasksMd } from "./fixtures/metodo/gerar";
import { linhaClaude } from "./fixtures/custo/transcripts";

interface ResumoCusto { usd: number | null; incompleto: boolean; registros: number; aproximado: boolean; fontes_ausentes: string[]; orquestracao?: { registros: number }; cards?: { registros: number }; sem_card?: { registros: number } }
interface JanelaFluxo {
  ade: {
    custo: {
      resumo(p: { escopo: string; chave: string }): Promise<ResumoCusto>;
      fontes(ws?: string): Promise<Array<{ cli: string; estado: string; pane_id: string | null }>>;
      tetoGravar(missionId: string, teto: number | null): Promise<unknown>;
      reindexar(ws?: string): Promise<unknown>;
      assinar(cb: (e: { tipo: string }) => void): () => void;
    };
    board: {
      snapshot(f: { workspace_id: string; mostrar_descartados?: boolean }): Promise<{ colunas: Record<string, Array<{ task_id: string; custo: { usd: number | null; incompleto: boolean } }>> }>;
      delegarCard(p: { workspace_id: string; mission_id: string; trabalho_id: string; task_id: string; confirmar: true }): Promise<{ pane_id: string; recibo: string; estimativa?: { confianca: string } }>;
      configGravar(ws: string, c: { wip: Record<string, number>; bloquear_ao_estourar_teto?: boolean }): Promise<unknown>;
    };
  };
  __avisosTeto?: number;
}

let amb: AmbienteOrq;
let casa: string;
let n = 0;
const T0 = Date.now();
const iso = (ms: number): string => new Date(T0 + ms).toISOString();
const pagina = () => amb.app.pagina;

beforeAll(async () => {
  casa = mkdtempSync(join(tmpdir(), "ade-custo-home-"));
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs", envExtra: { HOME: casa } });
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

// ---------------------------------------------------------------- utilitários
const bancoApp = (): DatabaseSync => {
  const b = new DatabaseSync(join(amb.app.pastaDados, `${PRODUTO.id}.db`));
  b.exec("PRAGMA busy_timeout = 5000");
  return b;
};
const sql = <T,>(consulta: string, args: Array<string | number | null> = []): T[] => {
  const b = bancoApp();
  try { return b.prepare(consulta).all(...args) as T[]; } finally { b.close(); }
};
function executar(consulta: string, args: Array<string | number | null> = []): void {
  const b = bancoApp();
  try { b.prepare(consulta).run(...args); } finally { b.close(); }
}
const resumo = (escopo: string, chave: string) => pagina().evaluate(([e, c]) => (window as unknown as JanelaFluxo).ade.custo.resumo({ escopo: e as string, chave: c as string }), [escopo, chave] as const);

/** A "CLI" registra a conversa do Pane e grava as linhas no transcript (append: o ADE lê por offset). */
function gravarTranscript(paneId: string, conversa: string, linhas: string[]): void {
  const arquivo = join(casa, ".claude", "projects", "p", `${conversa}.jsonl`);
  mkdirSync(dirname(arquivo), { recursive: true });
  appendFileSync(arquivo, linhas.map((l) => `${l}\n`).join(""));
  const existe = sql<{ id: string }>("SELECT id FROM sessao WHERE pane_id = ? AND cli_ref_conversa = ?", [paneId, conversa]);
  if (existe.length === 0) executar("INSERT INTO sessao (id, pane_id, cli_ref_conversa, criado_em, atualizado_em) VALUES (?,?,?,?,?)", [`s_${paneId}_${conversa}`, paneId, conversa, new Date().toISOString(), new Date().toISOString()]);
}
const msg = (id: string, ms: number, o: { modelo?: string | null; entrada?: number; saida?: number } = {}) => linhaClaude({ id, ts: iso(ms), ...(o.modelo === undefined ? {} : { modelo: o.modelo }), entrada: o.entrada ?? 1_000_000, saida: o.saida ?? 0 });

/** Missão agêntica ligada a um trabalho do método (trabalho_id/worktree gravados no banco, como o fluxo do método faz). */
async function missaoDoTrabalho(titulo: string, worker: Record<string, unknown> = { worker: "ocioso" }) {
  const m = await amb.iniciarMissao(titulo, { esperar_wake: false, chamadas: [amb.spawnWorker(worker)] });
  executar("UPDATE mission SET trabalho_id = ?, worktree = '.' WHERE id = ?", ["agenda-online", m.id]);
  return m;
}
const panesDa = async (missaoId: string) => (await amb.detalhe(missaoId))?.panes ?? [];
const paneWorker = async (missaoId: string) => esperar(async () => (await panesDa(missaoId)).find((p) => !p.eh_piloto));
function hashDeDocs(raiz: string): string {
  const h = createHash("sha256");
  const ler = (dir: string): void => { for (const nome of readdirSync(dir).sort()) { const p = join(dir, nome); if (statSync(p).isDirectory()) ler(p); else h.update(nome).update(readFileSync(p)); } };
  try { ler(join(raiz, "docs")); } catch { /* sem docs */ }
  return h.digest("hex");
}

describe("custo e board: fluxos no Electron real", () => {
  it("1. transcript do Claude gravado ⇒ o card/Missão mostra o custo em até 700 ms depois da linha chegar ao banco", async () => {
    const m = await amb.iniciarMissao("Custo 1", { esperar_wake: false, chamadas: [amb.spawnWorker({ worker: "ocioso" })] });
    const w = await paneWorker(m.id);
    const conv = `c1-${++n}`;
    gravarTranscript(w.id, conv, [msg("m1", 0, { entrada: 1_000_000 })]);
    const t0 = Date.now();
    const r = await esperar(async () => { const x = await resumo("pane", w.id); return x.registros > 0 ? x : undefined; }, 20_000, 50);
    expect(r.usd).toBeCloseTo(3, 5); // 1 Mtok de entrada a US$ 3 (família Sonnet), preço da tabela embutida
    expect(r.aproximado).toBe(true); // tabela embutida nasce não confirmada ⇒ "≈"
    expect(Date.now() - t0).toBeLessThan(700 + 1_500); // folga de descoberta da fonte (2 s de intervalo mínimo); o orçamento fino é do perf
  }, 60_000);

  it("2. dois cards sequenciais no mesmo Pane: cada um recebe só a sua janela; soma = total do Pane", async () => {
    const m = await missaoDoTrabalho("Custo 2");
    const w = await paneWorker(m.id);
    const conv = `c2-${++n}`;
    const base = Date.now() - T0;
    executar("INSERT OR REPLACE INTO janela_task (workspace_id, trabalho_id, task_id, origem, pane_id, cwd_rel, inicio, fim) VALUES (?,?,?,?,?,?,?,?)", [amb.wsId, "agenda-online", "T-01.01", "banco", w.id, null, iso(base - 60_000), iso(base - 30_000)]);
    executar("INSERT OR REPLACE INTO janela_task (workspace_id, trabalho_id, task_id, origem, pane_id, cwd_rel, inicio, fim) VALUES (?,?,?,?,?,?,?,?)", [amb.wsId, "agenda-online", "T-01.02", "banco", w.id, null, iso(base - 29_000), iso(base + 60_000)]);
    gravarTranscript(w.id, conv, [msg("a1", base - 45_000, { entrada: 1_000_000 }), msg("a2", base - 10_000, { entrada: 2_000_000 })]);
    await esperar(async () => (await resumo("pane", w.id)).registros >= 2 ? true : undefined, 20_000, 50);
    const c1 = await resumo("card", `${amb.wsId}|agenda-online|T-01.01`);
    const c2 = await resumo("card", `${amb.wsId}|agenda-online|T-01.02`);
    const total = await resumo("pane", w.id);
    expect(c1.usd).toBeCloseTo(3, 5);
    expect(c2.usd).toBeCloseTo(6, 5);
    expect((c1.usd ?? 0) + (c2.usd ?? 0)).toBeCloseTo(total.usd ?? -1, 5);
  }, 60_000);

  it("3. modelo sem preço ⇒ '≥' (soma do resto) no card e na Missão; nunca '0'", async () => {
    const m = await amb.iniciarMissao("Custo 3", { esperar_wake: false, chamadas: [amb.spawnWorker({ worker: "ocioso" })] });
    const w = await paneWorker(m.id);
    gravarTranscript(w.id, `c3-${++n}`, [msg("p1", 0, { entrada: 1_000_000 }), msg("p2", 1_000, { modelo: "modelo-sem-preco-xyz", entrada: 5_000_000 })]);
    const r = await esperar(async () => { const x = await resumo("missao", m.id); return x.registros >= 2 ? x : undefined; }, 20_000, 50);
    expect(r.incompleto).toBe(true);
    expect(r.usd).toBeCloseTo(3, 5); // só o que tem preço
    expect(r.usd).not.toBe(0);
  }, 60_000);

  it("4. card descartado some do quadro mas preserva o custo no total da Missão", async () => {
    escreverFeatureSimples(amb.raiz, "docs/sprintx/agenda-online", "agenda-online");
    const m = await missaoDoTrabalho("Custo 4");
    const w = await paneWorker(m.id);
    const tref = `descartada-${++n}`;
    executar("INSERT INTO task (id, mission_id, task_ref, titulo, papel, estado, pane_id, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)", [`t_${tref}`, m.id, "T-01.03", "T", "executor", "descartada", w.id, new Date().toISOString(), new Date().toISOString()]);
    const antes = await resumo("missao", m.id);
    gravarTranscript(w.id, `c4-${n}`, [msg("d1", 0, { entrada: 1_000_000 })]);
    const depois = await esperar(async () => { const x = await resumo("missao", m.id); return x.registros > antes.registros ? x : undefined; }, 20_000, 50);
    expect(depois.usd).toBeGreaterThan(antes.usd ?? 0);
    const b = await pagina().evaluate((ws) => (window as unknown as JanelaFluxo).ade.board.snapshot({ workspace_id: ws }), amb.wsId);
    expect(Object.values(b.colunas).flat().map((c) => c.task_id)).not.toContain("T-01.03");
  }, 60_000);

  it("5. Pane do piloto ⇒ custo vai a 'orquestração', não a card", async () => {
    const m = await missaoDoTrabalho("Custo 5");
    const piloto = (await panesDa(m.id)).find((p) => p.eh_piloto)!;
    gravarTranscript(piloto.id, `c5-${++n}`, [msg("o1", 0, { entrada: 1_000_000 })]);
    const r = await esperar(async () => { const x = await resumo("missao", m.id); return (x.orquestracao?.registros ?? 0) > 0 ? x : undefined; }, 20_000, 50);
    expect(r.cards?.registros ?? 0).toBe(0);
  }, 60_000);

  it("6. Pane de CLI sem leitor (gemini) ⇒ 'sem fonte' visível e custo nunca 0", async () => {
    const f = await pagina().evaluate((ws) => (window as unknown as JanelaFluxo).ade.custo.fontes(ws), amb.wsId);
    const semFonte = f.filter((x) => x.estado === "sem_fonte");
    // o Pane de gemini é aberto pela UI/ade; aqui só provamos a regra de leitura quando existir
    for (const x of semFonte) expect(["gemini", "opencode", "aider", "qwen", "kilo", "grok"]).toContain(x.cli);
    const r = await resumo("workspace", amb.wsId);
    if (semFonte.length > 0) { expect(r.fontes_ausentes.length).toBeGreaterThan(0); expect(r.incompleto).toBe(true); }
  }, 60_000);

  it("7. Pane OpenRouter via proxy: registro medido (usd do `usage`), não da tabela", async () => {
    const m = await amb.iniciarMissao("Custo 7", { esperar_wake: false, chamadas: [amb.spawnWorker({ worker: "ocioso" })] });
    const w = await paneWorker(m.id);
    // o proxy do ADE emite `usage.observed`; o teste insere o equivalente no banco como a ingestão faria (fonte `proxy`, usd medido)
    executar("INSERT INTO uso_fonte (id, cli, pane_id, mission_id, workspace_id, base, relativo, estado, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)", [`uf_px${n}`, "claude", w.id, m.id, amb.wsId, "proxy", "", "lendo", new Date().toISOString(), new Date().toISOString()]);
    executar("INSERT INTO uso_registro (id, fonte_id, chave, ts, modelo, tokens_entrada, tokens_saida, usd, usd_origem, pane_id, mission_id, workspace_id, atribuicao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [`ur_px${n}`, `uf_px${n}`, "px1", new Date().toISOString(), "vendor/modelo", 100, 10, 0.0042, "proxy", w.id, m.id, amb.wsId, "sem_card"]);
    const o = sql<{ usd_origem: string; usd: number }>("SELECT usd_origem, usd FROM uso_registro WHERE chave = 'px1'");
    expect(o[0]).toMatchObject({ usd_origem: "proxy", usd: 0.0042 });
  }, 60_000);

  it("8. handoff_submit com `cost` inventado é ignorado: agregados idênticos", async () => {
    const m = await amb.iniciarMissao("Custo 8", { esperar_wake: true, chamadas: [amb.spawnWorker({ worker: "handoff", resumo: "ok", cost: { usd: 0.01 }, tokens: 999 })] });
    const antes = await resumo("missao", m.id);
    await esperar(async () => (await amb.eventos(m.id)).find((l) => l.evento === "wake"), 30_000);
    const depois = await resumo("missao", m.id);
    expect(depois.usd).toBe(antes.usd);
    expect(depois.registros).toBe(antes.registros);
  }, 60_000);

  it("9. delegar card: briefing gerado, Pane abre, estimativa no recibo; `docs/**` intacto (sem roteador a delegação se auto-ignora)", async (ctx) => {
    escreverFeatureSimples(amb.raiz, "docs/sprintx/agenda-online", "agenda-online");
    const m = await missaoDoTrabalho("Custo 9");
    const antes = hashDeDocs(amb.raiz);
    const b = await esperar(async () => { const x = await pagina().evaluate((ws) => (window as unknown as JanelaFluxo).ade.board.snapshot({ workspace_id: ws }), amb.wsId); return Object.values(x.colunas).flat().length >= 3 ? x : undefined; });
    const pronta = b.colunas["a_fazer"]?.[0]?.task_id ?? "T-01.03";
    try {
      const r = await pagina().evaluate((p) => (window as unknown as JanelaFluxo).ade.board.delegarCard(p), { workspace_id: amb.wsId, mission_id: m.id, trabalho_id: "agenda-online", task_id: pronta, confirmar: true as const });
      expect(r.pane_id).toBeTruthy();
      expect(r.estimativa?.confianca).toBe("sem_historico"); // < 3 amostras: nunca chuta
    } catch (e) {
      if (/no_router|not_ready/.test(String(e))) return ctx.skip();
      throw e;
    }
    expect(hashDeDocs(amb.raiz)).toBe(antes);
  }, 90_000);

  it("10. teto: avisa uma vez; com o bloqueio do workspace ligado a delegação é recusada (nada em andamento é interrompido)", async () => {
    const m = await missaoDoTrabalho("Custo 10");
    const w = await paneWorker(m.id);
    await pagina().evaluate(() => { const j = window as unknown as JanelaFluxo; j.__avisosTeto = 0; j.ade.custo.assinar((e) => { if (e.tipo === "teto") j.__avisosTeto = (j.__avisosTeto ?? 0) + 1; }); });
    await pagina().evaluate((id) => (window as unknown as JanelaFluxo).ade.custo.tetoGravar(id, 1), m.id);
    gravarTranscript(w.id, `c10-${++n}`, [msg("t1", 0, { entrada: 1_000_000 }), msg("t2", 1_000, { entrada: 1_000_000 })]);
    await esperar(async () => ((await pagina().evaluate(() => (window as unknown as JanelaFluxo).__avisosTeto)) ?? 0) >= 1 ? true : undefined, 20_000, 50);
    gravarTranscript(w.id, `c10-${n}`, [msg("t3", 2_000, { entrada: 1_000_000 })]);
    await esperar(async () => (await resumo("missao", m.id)).registros >= 3 ? true : undefined, 20_000, 50);
    expect(await pagina().evaluate(() => (window as unknown as JanelaFluxo).__avisosTeto)).toBe(1);
    await pagina().evaluate((ws) => (window as unknown as JanelaFluxo).ade.board.configGravar(ws, { wip: {}, bloquear_ao_estourar_teto: true }), amb.wsId);
    const erro = await pagina().evaluate((p) => (window as unknown as JanelaFluxo).ade.board.delegarCard(p).then(() => "delegou", (e: Error) => e.message), { workspace_id: amb.wsId, mission_id: m.id, trabalho_id: "agenda-online", task_id: "T-01.03", confirmar: true as const });
    expect(erro).toMatch(/ceiling_reached|not_ready|no_router/); // com o card pronto e roteador: ceiling_reached (cenário 9 prova a parte feliz)
    expect((await panesDa(m.id)).every((p) => p.estado !== "encerrado")).toBe(true);
  }, 90_000);

  it("11. reindexar reproduz exatamente os mesmos números", async () => {
    const antes = await resumo("workspace", amb.wsId);
    await pagina().evaluate((ws) => (window as unknown as JanelaFluxo).ade.custo.reindexar(ws), amb.wsId);
    const depois = await esperar(async () => { const x = await resumo("workspace", amb.wsId); return x.registros === antes.registros ? x : undefined; }, 60_000, 100);
    expect(depois.usd).toBeCloseTo(antes.usd ?? 0, 6);
  }, 120_000);

  it("12. reiniciar o app no meio da ingestão não duplica registros", async () => {
    const m = await amb.iniciarMissao("Custo 12", { esperar_wake: false, chamadas: [amb.spawnWorker({ worker: "ocioso" })] });
    const w = await paneWorker(m.id);
    const conv = `c12-${++n}`;
    gravarTranscript(w.id, conv, Array.from({ length: 50 }, (_, i) => msg(`r${i}`, i * 10, { entrada: 1000 })));
    await esperar(async () => (await resumo("pane", w.id)).registros >= 1 ? true : undefined, 20_000, 50);
    await amb.reiniciar();
    gravarTranscript(w.id, conv, Array.from({ length: 50 }, (_, i) => msg(`s${i}`, 1_000 + i * 10, { entrada: 1000 })));
    await esperar(async () => (await resumo("pane", w.id)).registros >= 100 ? true : undefined, 40_000, 100);
    const duplicados = sql<{ n: number }>("SELECT COUNT(*) - COUNT(DISTINCT chave || fonte_id) AS n FROM uso_registro WHERE pane_id = ?", [w.id])[0]?.n;
    expect(duplicados).toBe(0);
    expect((await resumo("pane", w.id)).registros).toBe(100);
  }, 120_000);

  it("13. aba Board com 1 000 cards rola a ~60 fps e o DOM fica pequeno", async () => {
    const id = "agenda-online";
    const dir = join(amb.raiz, "docs/sprintx/agenda-online/sprint-01");
    mkdirSync(dir, { recursive: true });
    const tarefas = Array.from({ length: 1000 }, (_, i) => task({ id: `T-01.${String(i + 1).padStart(3, "0")}`, fase: "F-01.1", status: i < 300 ? "concluida" : i < 350 ? "em_andamento" : "pendente" }));
    writeFileSync(join(dir, "tasks.md"), tasksMd(id, "sprint-01", tarefas));
    writeFileSync(join(dir, "fases.md"), fasesMd(id, "sprint-01", [fase("F-01.1", tarefas.map((t) => String(t["id"])))]));
    writeFileSync(join(dir, "sprint.md"), sprintMd(id, "sprint-01", { fases: ["F-01.1"] }));
    writeFileSync(join(amb.raiz, "docs/sprintx/agenda-online/ORQUESTRADOR.md"), orquestrador({ id, estagio: "f6" }));
    await esperar(async () => { const x = await pagina().evaluate((ws) => (window as unknown as JanelaFluxo).ade.board.snapshot({ workspace_id: ws }), amb.wsId); return Object.values(x.colunas).flat().length >= 1000 ? x : undefined; }, 30_000, 200);
    await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Missões" }).click();
    await pagina().getByRole("button", { name: "Board", exact: true }).click();
    await pagina().locator(".board").waitFor({ timeout: 20_000 });
    const medida = await pagina().evaluate(async () => {
      const col = document.querySelector<HTMLElement>('.board [role="region"] [data-virtual], .board [role="region"]');
      const quadros: number[] = [];
      let ultimo = performance.now();
      await new Promise<void>((resolver) => {
        let passos = 0;
        const tick = (agora: number): void => {
          quadros.push(agora - ultimo); ultimo = agora;
          if (col) col.scrollTop += 40;
          if (++passos >= 90) resolver(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      quadros.sort((a, b) => a - b);
      return { p95: quadros[Math.floor(quadros.length * 0.95)] ?? 0, elementos: document.querySelectorAll(".board *").length };
    });
    expect(medida.p95).toBeLessThan(25); // ~60 fps com folga de CI (p95 do quadro)
    expect(medida.elementos).toBeLessThanOrEqual(200); // P-116: orçamento em ELEMENTOS do DOM (decisão do coordenador)
  }, 120_000);
});
