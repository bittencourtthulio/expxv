// Ligação do main da Fase 19: portas sobre a gestão ágil e o método, SQLite real em memória, diálogo de pasta injetado e gancho `sprint.fechada`.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoAgil } from "../compartilhado/agil";
import { SPRINT_ID, sprintBrutaFalsa, T0, WS } from "../../tests/fixtures/relatorios/gerar";
import { abrirBanco, type Banco } from "../nucleo/banco";
import { migrar } from "../nucleo/banco/migrar";
import type { Trabalho } from "../nucleo/metodo/tipos";
import { criarBarramento } from "./barramento";
import type { ServicoAgil } from "./agil";
import { criarPortaAgilMain, criarPortaCanaisMain, criarPortaCustoMain, criarPortaVersionamentoMain, criarServicoRelatorios } from "./relatorios";

let raiz: string;
let destino: string;
let banco: Banco;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "rel-main-"));
  destino = await mkdtemp(join(tmpdir(), "rel-dest-"));
  banco = abrirBanco(":memory:");
  migrar(banco);
  banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [WS, "w", raiz, "t", "t"]);
});
afterEach(async () => { banco.fechar(); await rm(raiz, { recursive: true, force: true }); await rm(destino, { recursive: true, force: true }); });

function agilFalso(estado: "fechada" | "ativa" = "fechada", bruta = sprintBrutaFalsa()): ServicoAgil {
  const sprint = { ...bruta.sprint, estado };
  return {
    sprintListar: () => [{ ...sprint, itens: bruta.itens.map((i) => ({ sprint_id: SPRINT_ID, item_id: i.item.id, adicionado_em: "t", removido_em: null, pontos_compromisso: null, no_compromisso_inicial: true, motivo: null, resultado: i.resultado })) }],
    itemLer: async (_ws: string, id: string) => { const i = bruta.itens.find((x) => x.item.id === id)!; return { item: i.item, resumo: i.resumo, fato: i.fato }; },
    painel: () => bruta.painel,
  } as unknown as ServicoAgil;
}
const trabalhoComPr = { id: "tr-login", entrega: { pr_url: "https://github.com/exemplo/app/pull/42", pr_estado: "merged" } } as unknown as Trabalho;

function montar(opcoes: { agil?: ServicoAgil; escolher?: () => Promise<string | null> } = {}) {
  const barramento = criarBarramento();
  const emitidos: { tipo: string; payload: unknown }[] = [];
  const emitir = barramento.emitir.bind(barramento);
  barramento.emitir = ((tipo: string, payload: unknown) => { emitidos.push({ tipo, payload }); emitir(tipo, payload); }) as typeof barramento.emitir;
  const coalescidos: { tipo: string; chave: string }[] = [];
  barramento.emitirCoalescido = ((tipo: string, chave: string) => void coalescidos.push({ tipo, chave })) as typeof barramento.emitirCoalescido;
  const perfil = vi.fn(async () => null);
  const s = criarServicoRelatorios({
    banco, workspaceRaiz: (id) => (id === WS ? raiz : null), agil: async () => opcoes.agil ?? agilFalso(), trabalhos: () => [trabalhoComPr], perfil: { resolver: perfil }, scrub: (t) => t, barramento,
    escolherPasta: opcoes.escolher ?? (async () => destino), relogio: () => T0,
  });
  return { s, emitidos, coalescidos, perfil };
}

describe("portas do main", () => {
  it("agil: só sprint FECHADA gera; itens em lotes; painel filtrado pela sprint", async () => {
    const p = criarPortaAgilMain(async () => agilFalso("ativa"));
    await expect(p.sprint(WS, SPRINT_ID)).rejects.toThrow(/ainda não foi fechada/);
    expect(await p.sprint(WS, "spr_inexistente0000")).toBeNull();
    const ok = await criarPortaAgilMain(async () => agilFalso()).sprint(WS, SPRINT_ID);
    expect(ok?.itens).toHaveLength(3);
    expect(ok?.painel).not.toBeNull();
    expect((await criarPortaAgilMain(async () => agilFalso()).sprintsFechadas(WS)).map((x) => x.id)).toEqual([SPRINT_ID]);
  });
  it("versionamento: PR vem do ENTREGA.md já lido pelo método (zero rede)", async () => {
    const v = criarPortaVersionamentoMain(() => [trabalhoComPr, { id: "outro", entrega: null } as unknown as Trabalho]);
    expect(await v.prs(WS, ["tr-login", "outro"])).toEqual([{ trabalho_id: "tr-login", url: "https://github.com/exemplo/app/pull/42", estado: "merged" }]);
  });
});

describe("serviço do main", () => {
  it("gera o pacote em .expxv do workspace, com PR, persiste no SQLite e avisa a UI (coalescido) e o barramento", async () => {
    const { s, emitidos, coalescidos } = montar();
    const { pacote_id } = await s.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const d = await s.ler(WS, pacote_id);
    expect(d.estado).toBe("pronto");
    expect(await readFile(join(raiz, d.pasta_ref, "tecnico.md"), "utf8")).toContain("https://github.com/exemplo/app/pull/42");
    expect(banco.consultarUm("SELECT COUNT(*) AS n FROM relatorio_pacote")?.["n"]).toBe(1);
    expect(emitidos.map((e) => e.tipo)).toEqual(expect.arrayContaining(["relatorio.gerando", "relatorio.pronto"]));
    expect(coalescidos.every((c) => c.tipo === "relatorios:evento")).toBe(true);
    expect(coalescidos.length).toBeGreaterThan(0);
  });

  it("workspace desconhecido: not_found em TODO método; nada é criado", async () => {
    const { s } = montar();
    const f = [() => s.configLer("ws_desconhecido00"), () => s.sprints("ws_desconhecido00"), () => s.listar("ws_desconhecido00"), () => s.gerar("ws_desconhecido00", { tipo: "sprint", sprint_id: SPRINT_ID }), () => s.exportar("ws_desconhecido00", "rel_x", "todos", "pasta"), () => s.divulgacaoEstado("ws_desconhecido00")];
    for (const fn of f) expect(() => fn()).toThrow(/não encontrado/);
    expect(banco.consultarUm("SELECT COUNT(*) AS n FROM relatorio_pacote")?.["n"]).toBe(0);
  });

  it("exportar: o diálogo é injetado (o renderer nunca manda caminho); cancelar não grava; destino em docs/ é recusado", async () => {
    let escolhida: string | null = null;
    const { s } = montar({ escolher: async () => escolhida });
    const { pacote_id } = await s.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect((await s.exportar(WS, pacote_id, ["usuario.md"], "pasta")).cancelado).toBe(true);
    escolhida = destino;
    const r = await s.exportar(WS, pacote_id, ["usuario.md", "tasks.csv"], "zip");
    expect(r.cancelado).toBe(false);
    expect(r.destino_rotulo).not.toContain(destino);
    expect((await readdir(destino)).length).toBe(1);
    escolhida = join(raiz, "docs");
    await expect(s.exportar(WS, pacote_id, "todos", "pasta")).rejects.toThrow();
  });

  it("gancho sprint.fechada: gera sozinho em modo template; workspace inexistente é ignorado; erro não vaza", async () => {
    const { s, perfil } = montar();
    const ev = (extra: Partial<EventoAgil> = {}): EventoAgil => ({ tipo: "sprint.fechada", workspace_id: WS, sprint_id: SPRINT_ID, trabalho_id: null, task_ref: null, pontos: 8, duracao_observada_ms: null, tokens: null, quando: "t", dados: {}, ...extra });
    await s.aoFecharSprint(ev({ workspace_id: "ws_desconhecido00" }));
    await s.aoFecharSprint(ev({ sprint_id: "spr_inexistente0000" }));
    expect(s.listar(WS)).toHaveLength(0);
    await s.aoFecharSprint(ev());
    expect(s.listar(WS)).toHaveLength(1);
    expect(s.listar(WS)[0]?.modo_redacao).toBe("template");
    expect(perfil).not.toHaveBeenCalled(); // sem consentimento, a IA nem é consultada
  });

  it("a IA só roda com consentimento: com perfil e headless prontos, nada é chamado antes do consentimento", async () => {
    const executar = vi.fn(async () => ({ texto: "{}", tokens: null }));
    const barramento = criarBarramento();
    const s = criarServicoRelatorios({
      banco, workspaceRaiz: () => raiz, agil: async () => agilFalso(), trabalhos: () => [], perfil: { resolver: async () => ({ cli: "claude", modelo: null, faixa: "rapido" }) }, headless: { executar }, scrub: (t) => t, barramento,
      escolherPasta: async () => null, relogio: () => T0,
    });
    s.configGravar(WS, { redacao_modo: "llm" });
    await s.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect(executar).not.toHaveBeenCalled();
    s.consentimentoLlm(WS, true);
    await s.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect(executar).toHaveBeenCalled();
    expect(executar.mock.calls.every((c) => (c as unknown as [{ tools: unknown[] }])[0].tools.length === 0)).toBe(true);
  });
});

describe("portas reais de custo (Fase 10) e canais (Fase 20)", () => {
  const resumo = (o: Record<string, unknown> = {}) => ({ usd: 1.25, incompleto: false, aproximado: false, tokens: { entrada: 1000, cache_escrita: 5, cache_leitura: 9, saida: 500 }, registros: 3, modelos: [], fontes_ausentes: [], atualizado_em: null, ...o });
  const custoDe = (r: ReturnType<typeof resumo>) => () => ({ custoDeCards: () => ({ sprint_id: "", custo: r, itens: 1, itens_sem_custo: 0 }) });
  it("custo medido ⇒ exato; incompleto/aproximado ⇒ mínimo; nada medido ou sem preço ⇒ nunca 0 inventado; Fase 10 ausente ⇒ null", async () => {
    const tasks = [{ trabalho_id: "w1", task_ref: "T-1" }];
    expect(await criarPortaCustoMain(custoDe(resumo())).sprint(WS, tasks)).toEqual({ tokens: 1500, usd: 1.25, estado: "exato" });
    expect((await criarPortaCustoMain(custoDe(resumo({ incompleto: true }))).sprint(WS, tasks))?.estado).toBe("minimo");
    expect((await criarPortaCustoMain(custoDe(resumo({ aproximado: true }))).sprint(WS, tasks))?.estado).toBe("minimo");
    expect(await criarPortaCustoMain(custoDe(resumo({ registros: 0, usd: null }))).sprint(WS, tasks)).toBeNull();
    expect(await criarPortaCustoMain(custoDe(resumo({ usd: null }))).sprint(WS, tasks)).toEqual({ tokens: 1500, usd: null, estado: "desconhecido" });
    expect(await criarPortaCustoMain(() => null).sprint(WS, tasks)).toBeNull();
    expect(await criarPortaCustoMain(custoDe(resumo())).sprint(WS, [])).toBeNull();
  });
  it("canais: só aparece o que está pronto (ligado + consentido); enviar recusa sem a Fase 20 e repassa o resultado do emissor", async () => {
    const enviados: unknown[][] = [];
    const alertas = (pronto: boolean) => () => ({ canalSaidaPronta: () => pronto, canalEnviarTexto: async (...a: unknown[]) => (enviados.push(a), { ok: true, erro: null }) });
    expect(await criarPortaCanaisMain(alertas(true)).disponiveis(WS)).toEqual(["telegram"]);
    expect(await criarPortaCanaisMain(alertas(false)).disponiveis(WS)).toEqual([]);
    expect(await criarPortaCanaisMain(() => null).disponiveis(WS)).toEqual([]);
    expect(await criarPortaCanaisMain(() => null).enviar(WS, "telegram", "x")).toEqual({ ok: false, erro: "canal indisponível" });
    expect(await criarPortaCanaisMain(alertas(true)).enviar(WS, "telegram", "texto")).toEqual({ ok: true, erro: null });
    expect(enviados[0]?.[0]).toBe("canal_telegram");
    expect(enviados[0]?.[2]).toBe("texto");
  });
});
