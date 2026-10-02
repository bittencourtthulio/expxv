import { describe, expect, it } from "vitest";
import { COLUNAS_BOARD, type CardBoard, type ColunaBoard, type FiltrosBoard } from "../../compartilhado/custo";
import { bancoTask, custoDe, gerarVolumeBoard, paneBoard, task, trabalho, WS } from "../../../tests/fixtures/custo/gerar";
import { colunaDoCard } from "./coluna";
import { montarBoard, progressoDe } from "./modelo";
import { compararNatural } from "./ordenar";
import type { EstadoTaskBanco, TaskDoMetodo, VereditoMetodo } from "./portas";

const F: FiltrosBoard = { workspace_id: null };
const AGORA = "2026-06-10T12:00:00.000Z";
const montar = (trabalhos: Parameters<typeof montarBoard>[0]["trabalhos"], extra: Partial<Parameters<typeof montarBoard>[0]> = {}) =>
  montarBoard({ trabalhos, tasksBanco: [], panes: new Map(), custos: new Map(), filtros: F, agora: AGORA, versao: 1, ...extra });

describe("colunaDoCard: as 8 regras (D-107), disco × banco", () => {
  type Caso = [string, TaskDoMetodo["status"], EstadoTaskBanco | null, VereditoMetodo, string[], string, number];
  const status = (deps: Record<string, TaskDoMetodo["status"]>) => new Map(Object.entries(deps));
  const casos: Caso[] = [
    // [nome, disco, banco, veredito QA, deps (status de cada), coluna, regra]
    ["descartada no banco some", "pendente", "descartada", null, [], "backlog", 1],
    ["descartada vence até disco concluído", "concluida", "descartada", "aprovado", [], "backlog", 1],
    ["banco validada", "concluida", "validada", null, [], "validado", 2],
    ["banco validada com disco em andamento (regra 2 precede)", "em_andamento", "validada", null, [], "validado", 2],
    ["concluída + QA aprovado", "concluida", null, "aprovado", [], "validado", 2],
    ["concluída + QA sim", "concluida", "reivindicada", "sim", [], "validado", 2],
    ["concluída + QA reprovado fica concluída", "concluida", null, "reprovado", [], "concluido", 4],
    ["concluída + QA nao fica concluída", "concluida", null, "nao", [], "concluido", 4],
    ["concluída + banco entregue sem revisor", "concluida", "entregue", null, [], "em_revisao", 3],
    ["concluída + banco entregue + QA aprovado = validado", "concluida", "entregue", "aprovado", [], "validado", 2],
    ["concluída sem banco", "concluida", null, null, [], "concluido", 4],
    ["concluída + banco reivindicada: o DISCO vence (CT-10.13)", "concluida", "reivindicada", null, [], "concluido", 4],
    ["concluída + banco aberta", "concluida", "aberta", null, [], "concluido", 4],
    ["em andamento no disco", "em_andamento", null, null, [], "em_andamento", 5],
    ["pendente + banco reivindicada", "pendente", "reivindicada", null, [], "em_andamento", 5],
    ["bloqueada + banco reivindicada vai para andamento (regra 5 precede 6)", "bloqueada", "reivindicada", null, [], "em_andamento", 5],
    ["bloqueada", "bloqueada", null, null, [], "backlog", 6],
    ["bloqueada + banco entregue", "bloqueada", "entregue", null, [], "backlog", 6],
    ["pendente sem dependência", "pendente", null, null, [], "a_fazer", 7],
    ["pendente com dependência fechada", "pendente", null, null, ["concluida"], "a_fazer", 7],
    ["pendente com várias dependências todas fechadas", "pendente", null, null, ["concluida", "concluida"], "a_fazer", 7],
    ["pendente com dependência aberta (pendente)", "pendente", null, null, ["pendente"], "backlog", 8],
    ["pendente com dependência em andamento", "pendente", null, null, ["em_andamento"], "backlog", 8],
    ["pendente com dependência bloqueada", "pendente", null, null, ["bloqueada"], "backlog", 8],
    ["pendente com uma fechada e uma aberta", "pendente", null, null, ["concluida", "pendente"], "backlog", 8],
    ["pendente + banco aberta (delegada) e pronta", "pendente", "aberta", null, [], "a_fazer", 7],
    ["pendente + banco entregue (disco pendente: disco vence)", "pendente", "entregue", null, [], "a_fazer", 7],
    ["pendente + banco entregue com dependência aberta", "pendente", "entregue", null, ["pendente"], "backlog", 8],
  ];
  it.each(casos)("%s", (_nome, disco, banco, qa, deps, coluna, regra) => {
    const ids = deps.map((_, i) => `D${i}`);
    const mapa = status(Object.fromEntries(ids.map((id, i) => [id, deps[i] as TaskDoMetodo["status"]])));
    const r = colunaDoCard({ task: task("X", { status: disco, depende_de: ids }), banco, statusPorTask: mapa, vereditoQa: qa, temViolacao: false });
    expect(r.coluna).toBe(coluna);
    expect(r.regra).toBe(regra);
    expect(r.oculta).toBe(regra === 1);
  });
  it("dependência inexistente conta como aberta (nunca libera por engano)", () => {
    expect(colunaDoCard({ task: task("X", { depende_de: ["FANTASMA"] }), banco: null, statusPorTask: new Map(), vereditoQa: null, temViolacao: false }).coluna).toBe("backlog");
  });
  it("selos: pronta, bloqueada, violacao, delegada, descartada", () => {
    const s = (t: Partial<TaskDoMetodo>, banco: EstadoTaskBanco | null, viol: boolean) => colunaDoCard({ task: task("X", t), banco, statusPorTask: new Map(), vereditoQa: null, temViolacao: viol }).selos;
    expect(s({}, null, false)).toEqual(["pronta"]);
    expect(s({ status: "bloqueada" }, null, true)).toEqual(["bloqueada", "violacao"]);
    expect(s({}, "aberta", false)).toEqual(["pronta", "delegada"]);
    expect(s({ status: "em_andamento" }, "reivindicada", true)).toEqual(["violacao", "delegada"]);
    expect(s({}, "descartada", false)).toEqual(["descartada"]);
  });
});

describe("montarBoard", () => {
  it("missão com 4 cards (2 concluídos, 1 validado, 1 a fazer): 50% verde / 25% azul sobre o total não descartado (CT-10.14)", () => {
    const t = trabalho("w1", [task("A", { status: "concluida" }), task("B", { status: "concluida" }), task("C", { status: "concluida" }), task("D")]);
    const b = montar([t], { tasksBanco: [bancoTask("w1", "C", { estado: "validada" })] });
    expect(b.progresso).toMatchObject({ total: 4, concluido: 2, validado: 1, pct_concluido: 50, pct_validado: 25, descartado: 0 });
    expect(b.colunas.a_fazer.map((c) => c.task_id)).toEqual(["D"]);
    expect(b.colunas.validado.map((c) => c.task_id)).toEqual(["C"]);
  });
  it("descartado sai das colunas e do total, mas o custo continua no total (CT-10.11)", () => {
    const t = trabalho("w1", [task("A"), task("B")]);
    const b = montar([t], { tasksBanco: [bancoTask("w1", "B", { estado: "descartada" })], custos: new Map([[`${WS}|w1|B`, custoDe(2)], [`${WS}|w1|A`, custoDe(1)]]) });
    expect(b.progresso).toMatchObject({ total: 1, descartado: 1 });
    expect(COLUNAS_BOARD.flatMap((c) => b.colunas[c]).map((c) => c.task_id)).toEqual(["A"]);
    expect(b.descartados).toEqual([]);
    expect(b.custo.usd).toBe(3);
    expect(montar([t], { tasksBanco: [bancoTask("w1", "B", { estado: "descartada" })], filtros: { workspace_id: null, mostrar_descartados: true } }).descartados.map((c) => c.task_id)).toEqual(["B"]);
  });
  it("sem tasks: progresso 0% (sem divisão por zero) e custo null", () => {
    const b = montar([]);
    expect(b.progresso).toEqual({ total: 0, descartado: 0, concluido: 0, validado: 0, pct_concluido: 0, pct_validado: 0 });
    expect(b.custo).toMatchObject({ usd: null, registros: 0 });
    expect(Object.keys(b.colunas)).toEqual([...COLUNAS_BOARD]);
  });
  it("card traz executor (Pane do banco), handoff e custo leve; sem uso = usd null sem incompleto", () => {
    const t = trabalho("w1", [task("A", { status: "em_andamento" }), task("B")], { mission_id: "mis_1" });
    const b = montar([t], { tasksBanco: [bancoTask("w1", "A", { estado: "reivindicada", pane_id: "pane_1", handoff_status: "parcial" })], panes: new Map([["pane_1", paneBoard()]]), custos: new Map([[`${WS}|w1|A`, custoDe(0.42, { incompleto: true })]]) });
    const a = b.colunas.em_andamento[0] as CardBoard;
    expect(a).toMatchObject({ executor: { pane_id: "pane_1", cli: "claude", modelo: "claude-sonnet-4-5", conta_rotulo: "c1" }, handoff_status: "parcial", mission_id: "mis_1", selos: ["delegada"], custo: { usd: 0.42, incompleto: true } });
    expect((b.colunas.a_fazer[0] as CardBoard).custo).toEqual({ usd: null, incompleto: false, aproximado: false });
  });
  it("violação aparece como selo; texto do método não vaza para o card", () => {
    const t = trabalho("w1", [task("A", { status: "concluida" })], { violacoes: [{ alvo: "A", detalhe: "sem teste em /Users/fulano/x" }] });
    expect((montar([t]).colunas.concluido[0] as CardBoard).selos).toEqual(["violacao"]);
  });
  it("filtros de escopo (workspace, trabalho, Missão) mudam o progresso; filtros de visão não", () => {
    const a = trabalho("a", [task("1", { status: "concluida" }), task("2")], { mission_id: "m1" });
    const b = trabalho("b", [task("1")], { workspace_id: "ws_outro", mission_id: "m2" });
    expect(montar([a, b], { filtros: { workspace_id: WS } }).progresso.total).toBe(2);
    expect(montar([a, b], { filtros: { workspace_id: null, trabalho_ids: ["b"] } }).progresso.total).toBe(1);
    expect(montar([a, b], { filtros: { workspace_id: null, trabalho_ids: ["a", "b"] } }).progresso.total).toBe(3); // união
    expect(montar([a, b], { filtros: { workspace_id: null, mission_id: "m1" } }).progresso.total).toBe(2);
    const visao = montar([a, b], { filtros: { workspace_id: null, colunas: ["concluido"] } });
    expect(visao.progresso.total).toBe(3);
    expect(visao.colunas.a_fazer).toEqual([]);
    expect(visao.colunas.concluido).toHaveLength(1);
  });
  it("filtros de visão: selo, modelo, com_custo, busca por id e título", () => {
    const t = trabalho("w1", [task("T-01.01", { titulo: "Criar login" }), task("T-01.02", { titulo: "Relatório", status: "bloqueada" }), task("T-01.03")]);
    const custos = new Map([[`${WS}|w1|T-01.01`, custoDe(1, { modelos: ["gpt-5"] })], [`${WS}|w1|T-01.03`, custoDe(2, { modelos: ["claude-sonnet-4-5"] })]]);
    const ids = (f: Partial<FiltrosBoard>) => COLUNAS_BOARD.flatMap((c) => montar([t], { custos, filtros: { workspace_id: null, ...f } }).colunas[c]).map((c) => c.task_id).sort();
    expect(ids({ selos: ["bloqueada"] })).toEqual(["T-01.02"]);
    expect(ids({ modelo: "gpt-5" })).toEqual(["T-01.01"]);
    expect(ids({ com_custo: true })).toEqual(["T-01.01", "T-01.03"]);
    expect(ids({ com_custo: false })).toEqual(["T-01.02"]);
    expect(ids({ busca: "LOGIN" })).toEqual(["T-01.01"]);
    expect(ids({ busca: "01.03" })).toEqual(["T-01.03"]);
    expect(ids({ busca: "  " })).toHaveLength(3);
  });
  it("WIP: informa total, limite e excedido por coluna (só informa)", () => {
    const t = trabalho("w1", [task("A", { status: "em_andamento" }), task("B", { status: "em_andamento" }), task("C", { status: "em_andamento" }), task("D")]);
    const b = montar([t], { config: { wip: { em_andamento: 2, em_revisao: null } } });
    expect(b.wip.em_andamento).toEqual({ total: 3, limite: 2, excedido: true });
    expect(b.wip.a_fazer).toEqual({ total: 1, limite: null, excedido: false });
    expect(montar([t], { config: { wip: { em_andamento: 3 } } }).wip.em_andamento.excedido).toBe(false);
  });
  it("ordenação: natural por plano, por custo e por recente; permutar a entrada não muda a saída", () => {
    const tasks = ["T-01.10", "T-01.2", "T-01.1", "T-02.1"].map((id, i) => task(id, { fase: id.startsWith("T-02") ? "F2" : "F1", concluida_em: `2026-06-0${i + 1}T00:00:00.000Z`, status: "concluida" }));
    const custos = new Map([[`${WS}|w1|T-01.2`, custoDe(5)], [`${WS}|w1|T-01.10`, custoDe(9)]]);
    const ordem = (o: FiltrosBoard["ordenar"], ts = tasks) => montar([trabalho("w1", ts)], { custos, filtros: { workspace_id: null, ...(o ? { ordenar: o } : {}) } }).colunas.concluido.map((c) => c.task_id);
    expect(ordem(undefined)).toEqual(["T-01.1", "T-01.2", "T-01.10", "T-02.1"]);
    expect(ordem("custo")).toEqual(["T-01.10", "T-01.2", "T-01.1", "T-02.1"]);
    expect(ordem("recente")).toEqual(["T-02.1", "T-01.1", "T-01.2", "T-01.10"]);
    expect(ordem(undefined, [...tasks].reverse())).toEqual(ordem(undefined));
    expect(ordem("custo", [...tasks].reverse())).toEqual(ordem("custo"));
  });
  it("agrupar por fase põe a fase na frente da ordem", () => {
    const t = trabalho("w1", [task("T-01.1", { fase: "F2", status: "concluida" }), task("T-02.1", { fase: "F1", status: "concluida" })]);
    expect(montar([t], { filtros: { workspace_id: null, agrupar: "fase" } }).colunas.concluido.map((c) => c.fase)).toEqual(["F1", "F2"]);
  });
  it("resultado é cópia pura: não muda a entrada e é estável entre chamadas", () => {
    const { trabalhos, tasksBanco, custos } = gerarVolumeBoard(5, 20);
    const antes = JSON.stringify(trabalhos);
    const a = montar(trabalhos, { tasksBanco, custos });
    const b = montar(trabalhos, { tasksBanco, custos });
    expect(a).toEqual(b);
    expect(JSON.stringify(trabalhos)).toBe(antes);
  });
  it("coluna de cada card bate com colunaDoCard para um volume grande (consistência)", () => {
    const { trabalhos, tasksBanco, custos } = gerarVolumeBoard(30, 25);
    const b = montar(trabalhos, { tasksBanco, custos });
    const total = COLUNAS_BOARD.reduce((n, c) => n + b.colunas[c].length, 0) + b.progresso.descartado;
    expect(total).toBe(30 * 25);
    for (const c of COLUNAS_BOARD) for (const card of b.colunas[c as ColunaBoard]) expect(card.coluna).toBe(c);
  });
  it("trabalhos por Missão trazem progresso e custo próprios", () => {
    const a = trabalho("a", [task("1", { status: "concluida" })]);
    const b = trabalho("b", [task("1")]);
    const r = montar([b, a], { custos: new Map([[`${WS}|a|1`, custoDe(3)]]) });
    expect(r.trabalhos.map((t) => t.trabalho_id)).toEqual(["a", "b"]);
    expect(r.trabalhos[0]).toMatchObject({ progresso: { pct_concluido: 100 }, custo: { usd: 3 } });
    expect(r.trabalhos[1]?.custo.usd).toBeNull();
  });
});

describe("progressoDe e compararNatural", () => {
  it("arredonda em 1 casa", () => {
    expect(progressoDe([{ coluna: "concluido", oculta: false }, { coluna: "a_fazer", oculta: false }, { coluna: "a_fazer", oculta: false }]).pct_concluido).toBe(33.3);
  });
  it("compararNatural", () => {
    expect(["T-1.10", "T-1.2", "T-01.1", "A"].sort(compararNatural)).toEqual(["A", "T-01.1", "T-1.2", "T-1.10"]);
  });
});
