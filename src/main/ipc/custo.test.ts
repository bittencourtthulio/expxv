import { describe, expect, it, vi } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import { CANAIS_CUSTO_E_BOARD, VALIDADORES_BOARD, VALIDADORES_CUSTO, criarManipuladoresCusto, registrarIpcCusto } from "./custo";
import { criarRegistroIpc, type IpcMainLike } from "./registro";
import type { LigacaoCusto } from "../custo";
import { ErroDeCustoIpc } from "../custo";
import { ErroBoard } from "../../nucleo/board";

const WS = "ws_FIXTURE00000001";
const MIS = "mis_FIXTURE00000001";
const PANE = "pane_FIXTURE0000001";
const CONTA = "conta_FIXTURE000001";
const V: Record<string, (v: unknown) => { ok: boolean }> = { ...VALIDADORES_CUSTO, ...VALIDADORES_BOARD } as never;
const ok = (c: string, v: unknown) => expect(V[c]?.(v), `${c} deveria aceitar ${JSON.stringify(v)}`).toMatchObject({ ok: true });
const ruim = (c: string, v: unknown) => expect(V[c]?.(v), `${c} deveria recusar ${JSON.stringify(v)}`).toMatchObject({ ok: false });

describe("contrato: todo canal custo:*/board:* tem validador e manipulador", () => {
  it("os canais declarados em ipc.ts são exatamente os validados", () => {
    const declarados = [...CANAIS_INVOKE].filter((c) => /^(custo|board):/.test(c)).sort();
    expect(CANAIS_CUSTO_E_BOARD.slice().sort()).toEqual(declarados);
    expect(declarados).toHaveLength(22);
    expect(CANAIS_EVENTO).toEqual(expect.arrayContaining(["custo:evento", "board:evento"]));
  });
  it("registrarIpcCusto registra todos (e só eles) sem tocar a ligação", () => {
    const handlers = new Map<string, unknown>();
    const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const ligacao = new Proxy({}, { get: () => { throw new Error("a ligação não pode ser tocada no registro"); } }) as LigacaoCusto;
    registrarIpcCusto({ registro, ligacao });
    expect(registro.registrados().sort()).toEqual(CANAIS_CUSTO_E_BOARD.slice().sort());
  });
});

describe("validadores estritos", () => {
  it("custo:resumo: escopo desconhecido, campo extra, chave incompatível e caminho absoluto são recusados", () => {
    ok("custo:resumo", { escopo: "missao", chave: MIS });
    ok("custo:resumo", { escopo: "card", chave: `${WS}|feat-1|T-01.01` });
    ok("custo:resumo", { escopo: "trabalho", chave: `${WS}|feat-1` });
    ok("custo:resumo", { escopo: "pane", chave: PANE });
    ruim("custo:resumo", { escopo: "mundo", chave: MIS });
    ruim("custo:resumo", { escopo: "missao", chave: MIS, extra: 1 });
    ruim("custo:resumo", { escopo: "card", chave: MIS });
    ruim("custo:resumo", { escopo: "missao", chave: `${MIS}|x` });
    ruim("custo:resumo", { escopo: "pane", chave: "/Users/x/y" });
    ruim("custo:resumo", { escopo: "card", chave: `${WS}|../etc|T-01.01` });
    ruim("custo:resumo", { escopo: "missao" });
    ruim("custo:resumo", { escopo: 1, chave: MIS });
    ruim("custo:resumo", null);
  });
  it("custo:relatorio: limite > 200, agrupar desconhecido, datas inválidas e filtro estranho são recusados", () => {
    const base = { agrupar: "modelo", desde: "2026-06-01", ate: "2026-06-30" };
    ok("custo:relatorio", base);
    ok("custo:relatorio", { ...base, limite: 200, cursor: null, filtros: { workspace_id: WS, modelo: "gpt-5", conta_id: CONTA } });
    ruim("custo:relatorio", { ...base, limite: 201 });
    ruim("custo:relatorio", { ...base, limite: 0 });
    ruim("custo:relatorio", { ...base, agrupar: "sql" });
    ruim("custo:relatorio", { ...base, desde: "ontem" });
    ruim("custo:relatorio", { ...base, desde: "2026-13-45" });
    ruim("custo:relatorio", { ...base, desde: "2026-07-01" });
    ruim("custo:relatorio", { ...base, desde: "2000-01-01" });
    ruim("custo:relatorio", { ...base, filtros: { caminho: "/etc" } });
    ruim("custo:relatorio", { ...base, filtros: { workspace_id: "x" } });
    ruim("custo:relatorio", { ...base, extra: 1 });
  });
  it("custo:preco_gravar: negativo, NaN, Infinity, padrão com .. e campos extras são recusados; origem nunca vem do renderer", () => {
    ok("custo:preco_gravar", { padrao: "claude-*", entrada_por_mtok: 3, saida_por_mtok: 15 });
    ok("custo:preco_gravar", { padrao: "v/m", entrada_por_mtok: 0, saida_por_mtok: 0, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.3, familia: "anthropic" });
    ruim("custo:preco_gravar", { padrao: "m", entrada_por_mtok: -1, saida_por_mtok: 1 });
    ruim("custo:preco_gravar", { padrao: "m", entrada_por_mtok: Number.NaN, saida_por_mtok: 1 });
    ruim("custo:preco_gravar", { padrao: "m", entrada_por_mtok: Number.POSITIVE_INFINITY, saida_por_mtok: 1 });
    ruim("custo:preco_gravar", { padrao: "../m", entrada_por_mtok: 1, saida_por_mtok: 1 });
    ruim("custo:preco_gravar", { padrao: "m m", entrada_por_mtok: 1, saida_por_mtok: 1 });
    ruim("custo:preco_gravar", { padrao: "m", entrada_por_mtok: 1, saida_por_mtok: 1, origem: "embutido" });
    ruim("custo:preco_gravar", { padrao: "m", entrada_por_mtok: "1", saida_por_mtok: 1 });
    ruim("custo:preco_gravar", { entrada_por_mtok: 1, saida_por_mtok: 1 });
  });
  it("custo:teto_gravar: teto <= 0 recusado; null limpa; custo:config_gravar valida faixas", () => {
    ok("custo:teto_gravar", { mission_id: MIS, teto_usd: 10 });
    ok("custo:teto_gravar", { mission_id: MIS, teto_usd: null });
    ruim("custo:teto_gravar", { mission_id: MIS, teto_usd: 0 });
    ruim("custo:teto_gravar", { mission_id: MIS, teto_usd: -5 });
    ruim("custo:teto_gravar", { mission_id: MIS });
    ruim("custo:teto_gravar", { mission_id: "x", teto_usd: 1 });
    const cfg = { cambio_brl: null, alertar_preco_ausente: true, teto_padrao_missao_usd: null, ler_transcripts: true, retencao_bruta_dias: 90, aviso_teto_pct: 80 };
    ok("custo:config_gravar", cfg);
    ok("custo:config_gravar", { ...cfg, cambio_brl: 5.4, teto_padrao_missao_usd: 20, aviso_teto_pct: null });
    ruim("custo:config_gravar", { ...cfg, retencao_bruta_dias: 3 });
    ruim("custo:config_gravar", { ...cfg, cambio_brl: 0 });
    ruim("custo:config_gravar", { ...cfg, aviso_teto_pct: 150 });
    ruim("custo:config_gravar", { ...cfg, ler_transcripts: "sim" });
    ruim("custo:config_gravar", { ...cfg, extra: 1 });
  });
  it("canais sem entrada exigem objeto vazio; reprecificar/reindexar/estimativa aceitam só campos conhecidos", () => {
    for (const c of ["custo:precos_listar", "custo:config_ler", "custo:diagnostico"]) {
      ok(c, {});
      ruim(c, { x: 1 });
      ruim(c, undefined);
    }
    ok("custo:reprecificar", {});
    ok("custo:reprecificar", { desde: "2026-06-01", simular: true });
    ruim("custo:reprecificar", { desde: "x" });
    ok("custo:reindexar", {});
    ok("custo:reindexar", { workspace_id: WS });
    ruim("custo:reindexar", { workspace_id: "/w" });
    ok("custo:estimativa", { workspace_id: WS, trabalho_id: "feat-1", task_id: "T-01.01", task_type: "implementar" });
    ruim("custo:estimativa", { custo: 1 });
    ok("custo:fontes", {});
    ok("custo:previsao_periodo", { workspace_id: WS, inicio: "2026-06-01", fim: "2026-06-30" });
    ruim("custo:previsao_periodo", { workspace_id: WS, inicio: "2026-06-30", fim: "2026-06-01" });
    ok("custo:sprint", { workspace_id: WS, sprint_id: "asp_0001" });
    ruim("custo:sprint", { workspace_id: WS, sprint_id: "../x" });
    ruim("custo:preco_apagar", { id: "../x" });
  });
  it("board:snapshot: filtros estritos (workspace obrigatório, colunas/selos do vocabulário, sem caminho)", () => {
    ok("board:snapshot", { filtros: { workspace_id: WS } });
    ok("board:snapshot", { filtros: { workspace_id: WS, trabalho_ids: ["a", "b"], mission_id: MIS, colunas: ["backlog", "validado"], selos: ["pronta", "violacao"], modelo: "gpt-5", com_custo: true, busca: "login", agrupar: "fase", ordenar: "custo", mostrar_descartados: true } });
    ruim("board:snapshot", { filtros: { workspace_id: null } });
    ruim("board:snapshot", { filtros: {} });
    ruim("board:snapshot", { filtros: { workspace_id: WS, colunas: ["fazendo"] } });
    ruim("board:snapshot", { filtros: { workspace_id: WS, selos: ["x"] } });
    ruim("board:snapshot", { filtros: { workspace_id: WS, agrupar: "x" } });
    ruim("board:snapshot", { filtros: { workspace_id: WS, caminho: "/etc" } });
    ruim("board:snapshot", { filtros: { workspace_id: WS, busca: "a\u0000b" } });
    ruim("board:snapshot", { filtros: { workspace_id: WS, trabalho_ids: Array.from({ length: 51 }, () => "a") } });
    ruim("board:snapshot", { filtros: { workspace_id: WS }, extra: 1 });
  });
  it("board:card_detalhe/abrir_arquivo: só ids (nunca caminho); board:delegar_card exige confirmar:true", () => {
    const d = { workspace_id: WS, trabalho_id: "feat-1", task_id: "T-01.01" };
    ok("board:card_detalhe", d);
    ok("board:abrir_arquivo", d);
    ruim("board:abrir_arquivo", { ...d, task_id: "docs/x.md" });
    ruim("board:abrir_arquivo", { ...d, task_id: "../x" });
    ruim("board:abrir_arquivo", { ...d, arquivo: "docs/x.md" });
    ruim("board:card_detalhe", { workspace_id: WS, trabalho_id: "/abs", task_id: "T" });
    ok("board:delegar_card", { ...d, mission_id: MIS, confirmar: true });
    ruim("board:delegar_card", { ...d, mission_id: MIS });
    ruim("board:delegar_card", { ...d, mission_id: MIS, confirmar: false });
    ruim("board:delegar_card", { ...d, mission_id: MIS, confirmar: "true" });
    ruim("board:delegar_card", { ...d, confirmar: true });
  });
  it("board:config_gravar: coluna desconhecida, limite < 1 ou fracionado são recusados; null remove o limite", () => {
    ok("board:config_gravar", { workspace_id: WS, config: { wip: { em_andamento: 3, em_revisao: null } } });
    ok("board:config_gravar", { workspace_id: WS, config: { wip: {} } });
    ruim("board:config_gravar", { workspace_id: WS, config: { wip: { fazendo: 3 } } });
    ruim("board:config_gravar", { workspace_id: WS, config: { wip: { em_andamento: 0 } } });
    ruim("board:config_gravar", { workspace_id: WS, config: { wip: { em_andamento: 1.5 } } });
    ruim("board:config_gravar", { workspace_id: WS, config: {} });
    ruim("board:config_gravar", { workspace_id: WS, config: { wip: {}, extra: 1 } });
    ok("board:config_gravar", { workspace_id: WS, config: { wip: {}, bloquear_ao_estourar_teto: true } });
    ruim("board:config_gravar", { workspace_id: WS, config: { wip: {}, bloquear_ao_estourar_teto: "sim" } });
  });
  it("nenhum validador aceita campo de custo/tokens vindo do renderer (D-104: nunca autorrelato)", () => {
    for (const [canal, entrada] of [
      ["custo:teto_gravar", { mission_id: MIS, teto_usd: 1 }],
      ["custo:resumo", { escopo: "missao", chave: MIS }],
      ["board:delegar_card", { workspace_id: WS, trabalho_id: "a", task_id: "T-1", mission_id: MIS, confirmar: true }],
      ["board:card_detalhe", { workspace_id: WS, trabalho_id: "a", task_id: "T-1" }],
    ] as const) {
      for (const extra of [{ cost: { usd: 0.01 } }, { tokens: 10 }, { usd: 0 }, { custo: { usd: 0 } }]) ruim(canal, { ...entrada, ...extra });
    }
  });
});

describe("manipuladores", () => {
  const ligacao = (sobras: Partial<Record<keyof LigacaoCusto, unknown>> = {}) => ({ ...sobras }) as unknown as LigacaoCusto;
  it("delegam à ligação e sanizam o erro: nominal passa, estranho vira genérico sem caminho", async () => {
    const resumo = vi.fn(() => ({ usd: null }));
    const m = criarManipuladoresCusto(ligacao({ resumo, precosListar: () => { throw new Error("falha em /Users/x/segredo"); } }));
    expect(await m["custo:resumo"]({ escopo: "missao", chave: MIS })).toEqual({ usd: null });
    expect(resumo).toHaveBeenCalledWith({ escopo: "missao", chave: MIS });
    await expect(m["custo:precos_listar"]()).rejects.toThrow("unavailable: falha ao executar a operação de custo");
  });
  it("erros do board atravessam como <codigo.subcodigo>: mensagem", async () => {
    const board = () => ({ snapshot: async () => { throw new ErroBoard("rule_violation", "wip", "wip_exceeded"); } });
    const m = criarManipuladoresCusto(ligacao({ board }));
    const e = await m["board:snapshot"]({ filtros: { workspace_id: WS } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroDeCustoIpc);
    expect((e as Error).message).toBe("rule_violation.wip_exceeded: wip");
  });
  it("custo:teto_gravar e custo:reindexar repassam os argumentos certos", async () => {
    const tetoGravar = vi.fn(() => ({ ok: true }));
    const reindexar = vi.fn(async () => ({ iniciado: true, registros: 0 }));
    const m = criarManipuladoresCusto(ligacao({ tetoGravar, reindexar }));
    await m["custo:teto_gravar"]({ mission_id: MIS, teto_usd: null });
    await m["custo:reindexar"]({ workspace_id: WS });
    expect(tetoGravar).toHaveBeenCalledWith(MIS, null);
    expect(reindexar).toHaveBeenCalledWith(WS);
  });
});
