import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLUNAS_BOARD, type CardBoard, type ColunaBoard, type InfoWip, type PedidoDelegarCard } from "../../compartilhado/custo";
import { task, WS } from "../../../tests/fixtures/custo/gerar";
import { resolverArquivoAbrivel, validarRelativoAbrivel } from "./arquivo";
import { contratoDoBriefing, delegarCard, type MissaoParaDelegar, type PortaDelegar } from "./delegar";
import { montarDetalhe, relativoSeguro, sanearTexto } from "./detalhe";
import { ErroBoard } from "./erros";
import { movimentosDoCard, validarMovimento } from "./movimento";

const wipLivre = (): Record<ColunaBoard, InfoWip> => Object.fromEntries(COLUNAS_BOARD.map((c) => [c, { total: 0, limite: null, excedido: false }])) as Record<ColunaBoard, InfoWip>;
const card = (p: Partial<CardBoard> = {}): CardBoard => ({
  chave: `${WS}|w1|T-01.01`, task_id: "T-01.01", trabalho_id: "w1", trabalho_titulo: "W", workspace_id: WS, fase: "F1", titulo: "t", coluna: "a_fazer", selos: ["pronta"], depende_de: [], suite: "nao_executada",
  mission_id: "mis_1", executor: null, handoff_status: null, duracao_observada_ms: null, custo: { usd: null, incompleto: false, aproximado: false }, ...p,
});

describe("movimentos derivados do método (nunca gravam)", () => {
  const ctx = (modo: "livre" | "squad" | "agentico" | null = "agentico", wip = wipLivre()) => ({ wip, modo_missao: modo, comandoDe: (g: string, c: CardBoard) => `/expx:${g} ${c.trabalho_id}` });
  it("a_fazer pronta em Missão squad/agêntico: delegar; em livre/sem Missão: copiar comando", () => {
    expect(movimentosDoCard(card(), ctx("agentico"))[0]).toMatchObject({ para: "em_andamento", permitido: true, acao: "delegar", comando: "/expx:executar w1", grava_no_metodo: false });
    expect(movimentosDoCard(card(), ctx("livre"))[0]).toMatchObject({ permitido: true, acao: "copiar_comando" });
    expect(movimentosDoCard(card({ mission_id: null }), ctx(null))[0]?.acao).toBe("copiar_comando");
  });
  it("WIP excedido bloqueia a sugestão de iniciar (só a sugestão: o quadro nunca grava)", () => {
    const wip = { ...wipLivre(), em_andamento: { total: 3, limite: 2, excedido: true } };
    expect(movimentosDoCard(card(), ctx("agentico", wip))[0]).toMatchObject({ permitido: false, acao: "nenhuma" });
    expect(movimentosDoCard(card(), ctx("agentico", wip))[0]?.motivo).toContain("3/2");
  });
  it("card já delegado manda abrir o Pane; backlog explica o bloqueio; validação é sempre humana", () => {
    expect(movimentosDoCard(card({ selos: ["pronta", "delegada"] }), ctx())[0]).toMatchObject({ acao: "abrir_pane", permitido: false });
    expect(movimentosDoCard(card({ coluna: "backlog", selos: ["bloqueada"] }), ctx())[0]?.motivo).toMatch(/bloqueada/);
    expect(movimentosDoCard(card({ coluna: "backlog", selos: [] }), ctx())[0]?.motivo).toMatch(/dependência/);
    expect(movimentosDoCard(card({ coluna: "em_revisao" }), ctx())[0]).toMatchObject({ para: "validado", acao: "humano", permitido: false });
    expect(movimentosDoCard(card({ coluna: "concluido" }), ctx()).map((m) => [m.para, m.acao])).toEqual([["validado", "humano"], ["em_andamento", "copiar_comando"]]);
    expect(movimentosDoCard(card({ coluna: "validado" }), ctx())).toEqual([]);
  });
  it("nenhum movimento grava no método e nenhum é feito pelo ADE sozinho (validar/mover)", () => {
    for (const c of COLUNAS_BOARD) for (const m of movimentosDoCard(card({ coluna: c, selos: [] }), ctx())) expect(m.grava_no_metodo).toBe(false);
    expect(validarMovimento(card({ coluna: "em_andamento" }), "validado", ctx())).toMatchObject({ permitido: false });
    expect(validarMovimento(card(), "validado", ctx()).motivo).toMatch(/não previsto/);
    expect(validarMovimento(card(), "xyz" as ColunaBoard, ctx()).permitido).toBe(false);
  });
});

describe("detalhe", () => {
  it("monta contrato, filtra o rastro da task, sanea caminhos absolutos e mantém o arquivo relativo", () => {
    const t = task("T-01.01", { arquivo: "docs/sprintx/f/T-01.01.md" });
    const d = montarDetalhe({
      card: card(), task: t, janela: null, violacoes: [{ alvo: "T-01.01", detalhe: "falta teste em /Users/fulano/proj/x.ts e C:\\dev\\y" }, { alvo: "OUTRA", detalhe: "n" }],
      custo: { usd: null, incompleto: false, aproximado: false, tokens: { entrada: 0, cache_escrita: 0, cache_leitura: 0, saida: 0 }, registros: 0, modelos: [], fontes_ausentes: [], atualizado_em: null },
      custo_por_modelo: [], panes: [], handoffs: [{ id: "h1", status: "ok", resumo: "feito em /home/x/y/z", criado_em: "t" }],
      rastro: [{ ts: "2026-06-02", evento: "b", detalhe: "ok /Users/a/b", task: "T-01.01" }, { ts: "2026-06-01", evento: "a", detalhe: "x", task: "T-01.01" }, { ts: "2026-06-03", evento: "c", detalhe: "y", task: "OUTRA" }],
      movimentos: [],
    });
    expect(d.rastro.map((r) => r.evento)).toEqual(["a", "b"]);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/\/Users\/|\/home\/|C:\\\\/);
    expect(d.violacoes).toHaveLength(1);
    expect(d.arquivo_task).toBe("docs/sprintx/f/T-01.01.md");
    expect(d.contrato.objetivo).toBe("Objetivo T-01.01");
  });
  it("arquivo_task absoluto, com .. ou de Windows vira null; sanearTexto limita o tamanho", () => {
    for (const r of ["/etc/passwd", "../x.md", "docs/../x", "C:\\x.md", "a\\b", "", null, undefined]) expect(relativoSeguro(r)).toBeNull();
    expect(sanearTexto("a".repeat(500)).length).toBeLessThanOrEqual(240);
    expect(sanearTexto("veja /tmp/x/y agora")).toBe("veja [caminho] agora");
  });
});

describe("abrir arquivo (CT-10.26)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  function worktree() {
    const raiz = mkdtempSync(join(tmpdir(), "expxv-board-"));
    dirs.push(raiz);
    mkdirSync(join(raiz, "docs", "sprintx"), { recursive: true });
    writeFileSync(join(raiz, "docs", "sprintx", "T.md"), "x");
    writeFileSync(join(raiz, "docs", "sprintx", "T.exe"), "x");
    writeFileSync(join(raiz, "segredo.md"), "s");
    return raiz;
  }
  it("aceita md/json/jsonl/yaml sob docs/; recusa fora de docs, extensão, .., absoluto, barra invertida", async () => {
    const r = worktree();
    expect(await resolverArquivoAbrivel(r, "docs/sprintx/T.md", realpath)).toBe(await realpath(join(r, "docs/sprintx/T.md")));
    for (const ruim of ["segredo.md", "docs/sprintx/T.exe", "docs/../segredo.md", "/etc/passwd", "docs\\x.md", "docs", "docs/", "docs/.md", "", "docs/a/./b.md"]) {
      await expect(resolverArquivoAbrivel(r, ruim, realpath), ruim).rejects.toMatchObject({ codigo: "forbidden" });
    }
    expect(() => validarRelativoAbrivel("docs/x/y.JSONL")).not.toThrow();
  });
  it("symlink para fora de docs/ é recusado; arquivo inexistente é not_found", async () => {
    const r = worktree();
    symlinkSync(join(r, "segredo.md"), join(r, "docs", "sprintx", "link.md"));
    await expect(resolverArquivoAbrivel(r, "docs/sprintx/link.md", realpath)).rejects.toMatchObject({ codigo: "forbidden", subcodigo: "path_not_allowed" });
    await expect(resolverArquivoAbrivel(r, "docs/sprintx/nao.md", realpath)).rejects.toMatchObject({ codigo: "not_found" });
  });
});

describe("delegar card", () => {
  const missao = (p: Partial<MissaoParaDelegar> = {}): MissaoParaDelegar => ({ id: "mis_1", workspace_id: WS, modo: "agentico", estado: "executando", trabalho_id: "w1", tem_worktree: true, ...p });
  function portas(p: Partial<PortaDelegar> = {}, m: MissaoParaDelegar | null = missao()) {
    const chamadas: string[] = [];
    const base: PortaDelegar = {
      missao: () => m,
      gravarBriefing: vi.fn(async (d) => (chamadas.push("briefing"), `.expxv/missoes/${d.mission_id}/briefing-${d.task_ref}.md`)),
      criarTask: vi.fn(() => (chamadas.push("task"), { id: "task_1" })),
      abrirWorker: vi.fn(async () => (chamadas.push("worker"), { pane_id: "pane_9", recibo: "rota: claude · conta c1" })),
      descartarTask: vi.fn(() => void chamadas.push("descartar")),
    };
    return { port: { ...base, ...p }, chamadas };
  }
  const pedido: PedidoDelegarCard = { workspace_id: WS, trabalho_id: "w1", task_id: "T-01.01", mission_id: "mis_1", confirmar: true };
  const entrada = (c: CardBoard | null = card(), wip = wipLivre(), p: PedidoDelegarCard = pedido) => ({ pedido: p, card: c, task: c ? task("T-01.01", { objetivo: "Fazer X", criterio_aceite: "Y" }) : null, wip });
  const falha = async (fn: () => Promise<unknown>) => fn().then(() => null, (e: unknown) => e as ErroBoard);

  it("caminho feliz: briefing → task → worker, nessa ordem, com contrato da task", async () => {
    const { port, chamadas } = portas();
    const r = await delegarCard(entrada(), port);
    expect(r).toEqual({ pane_id: "pane_9", task_ref: "T-01.01", recibo: "rota: claude · conta c1" });
    expect(chamadas).toEqual(["briefing", "task", "worker"]);
    const md = (port.gravarBriefing as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].markdown as string;
    expect(md).toContain("## Contrato");
    expect(md).toContain("Fazer X");
    expect(md).toContain("Y");
  });
  it("sem confirmar:true não há efeito algum", async () => {
    const { port, chamadas } = portas();
    const e = await falha(() => delegarCard(entrada(card(), wipLivre(), { ...pedido, confirmar: false as unknown as true }), port));
    expect(e).toMatchObject({ codigo: "invalid", subcodigo: "confirm_required" });
    expect(chamadas).toEqual([]);
  });
  it("card inexistente, Missão inexistente, fora da Missão, livre, sem worktree, terminada", async () => {
    expect(await falha(() => delegarCard(entrada(null), portas().port))).toMatchObject({ codigo: "not_found" });
    expect(await falha(() => delegarCard(entrada(), portas({}, null).port))).toMatchObject({ codigo: "not_found", subcodigo: "mission_not_found" });
    for (const m of [missao({ trabalho_id: "outro" }), missao({ modo: "livre" }), missao({ tem_worktree: false }), missao({ workspace_id: "ws_x" })]) {
      expect(await falha(() => delegarCard(entrada(), portas({}, m).port))).toMatchObject({ codigo: "rule_violation", subcodigo: "not_in_mission" });
    }
    expect(await falha(() => delegarCard(entrada(), portas({}, missao({ estado: "concluida" })).port))).toMatchObject({ subcodigo: "mission_closed" });
  });
  it("card não pronto (backlog/bloqueado/em andamento) é recusado com o motivo e nada é criado", async () => {
    const { port, chamadas } = portas();
    expect(await falha(() => delegarCard(entrada(card({ coluna: "backlog", selos: ["bloqueada"] })), port))).toMatchObject({ codigo: "rule_violation", subcodigo: "not_ready", message: expect.stringContaining("bloqueada") });
    expect(await falha(() => delegarCard(entrada(card({ coluna: "em_andamento", selos: [] })), port))).toMatchObject({ subcodigo: "not_ready" });
    expect(chamadas).toEqual([]);
  });
  it("card já delegado ⇒ conflict, nada criado (CT-10.16); duplicado do banco também vira conflict e não abre Pane", async () => {
    const a = portas();
    expect(await falha(() => delegarCard(entrada(card({ selos: ["pronta", "delegada"] })), a.port))).toMatchObject({ codigo: "conflict" });
    expect(a.chamadas).toEqual([]);
    const dup = Object.assign(new Error("dup"), { name: "DuplicadoErro" });
    const b = portas({ criarTask: () => { throw dup; } });
    expect(await falha(() => delegarCard(entrada(), b.port))).toMatchObject({ codigo: "conflict" });
    expect(b.chamadas).toEqual(["briefing"]);
  });
  it("WIP excedido recusa a delegação", async () => {
    const wip = { ...wipLivre(), em_andamento: { total: 5, limite: 5 - 1, excedido: true } };
    expect(await falha(() => delegarCard(entrada(card(), wip), portas().port))).toMatchObject({ codigo: "rule_violation", subcodigo: "wip_exceeded" });
  });
  it("P-80: teto estourado só bloqueia com a opção ligada (padrão: só alerta) e nunca antes do efeito", async () => {
    const est = { mediana_usd: null, p25_usd: null, p75_usd: null, amostras: 1, confianca: "sem_historico" as const };
    const a = portas();
    expect(await falha(() => delegarCard({ ...entrada(), teto: { bloquear: true, estourado: true } }, a.port))).toMatchObject({ codigo: "rule_violation", subcodigo: "ceiling_reached" });
    expect(a.chamadas).toEqual([]);
    for (const teto of [{ bloquear: false, estourado: true }, { bloquear: true, estourado: false }, undefined]) {
      const r = await delegarCard({ ...entrada(), ...(teto === undefined ? {} : { teto }), estimativa: est }, portas().port);
      expect(r.estimativa).toEqual(est); // a estimativa vai no recibo, separada do custo
    }
  });
  it("se o Pane não abre, a task criada é descartada e o erro vira unavailable (sem card delegado fantasma)", async () => {
    const p = portas({ abrirWorker: async () => { throw new Error("falhou /Users/x/segredo"); } });
    const e = await falha(() => delegarCard(entrada(), p.port));
    expect(e).toMatchObject({ codigo: "unavailable", subcodigo: "spawn_failed" });
    expect(e?.message).not.toContain("/Users");
    expect(p.chamadas).toEqual(["briefing", "task", "descartar"]);
  });
  it("o contrato do briefing só usa campos da task e avisa que o estado é do método", () => {
    const c = contratoDoBriefing(task("T-09.01", { objetivo: null, criterio_aceite: "ok", teste_integracao: null }));
    expect(c).toContain("Critério de aceite");
    expect(c).not.toContain("Objetivo");
    expect(c).toContain("estado da task é do método");
  });
});

describe("WIP no limite (auditoria Fase 10): um card A MAIS estoura", () => {
  it("wipAtingido: total >= limite; sem limite nunca", async () => {
    const { wipAtingido } = await import("./movimento");
    expect(wipAtingido({ total: 2, limite: 2, excedido: false })).toBe(true);
    expect(wipAtingido({ total: 1, limite: 2, excedido: false })).toBe(false);
    expect(wipAtingido({ total: 99, limite: null, excedido: false })).toBe(false);
  });
  it("o movimento a_fazer → em_andamento é recusado no limite exato (total === limite, excedido false)", () => {
    const wip = { ...wipLivre(), em_andamento: { total: 2, limite: 2, excedido: false } };
    const r = movimentosDoCard(card(), { wip, modo_missao: "agentico" });
    expect(r[0]).toMatchObject({ permitido: false, acao: "nenhuma" });
  });
});
