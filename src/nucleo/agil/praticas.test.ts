import { describe, expect, it } from "vitest";
import { cfg, fato, itemM, novoAgil } from "../../../tests/fixtures/agil/ajudas";
import { metricasXp, type EntradaXp } from "./praticas/xp";
import { avaliarChecklist, CHECKLIST_LEAN, CHECKLIST_XP } from "./praticas/checklists";
import { desperdiciosLean, eficienciaDeFluxo, valorEntregue } from "./praticas/lean";
import { contarPorColuna, limitesWip, verificarWip } from "./praticas/kanban";
import { atualizarEpisodios, criarPublicador, detectarAtrasadas, eventosDeAtraso, jaPublicado, novoEvento, publicadorNulo } from "./eventos";
import { celulaCsv, COLUNAS_BACKLOG, csvDe, exportar, jsonDe, markdownDe, nomeSeguro } from "./exportar";
import { criarAgil } from "./agil";
import { portasIndisponiveis } from "./portas";
import { resumirRetrabalho } from "./retrabalho/agregar";

const H = 3_600_000;
const xp = (o: Partial<EntradaXp> = {}): EntradaXp => ({ fatos: [], itens: [], com_par: new Set(), ci_verde: new Map(), revisao_independente: new Map(), config: { commit_grande_linhas: 400 }, ...o });
const get = (m: ReturnType<typeof metricasXp>, c: string) => m.find((x) => x.codigo === c);

describe("práticas XP (T-18.35)", () => {
  it("sem rastro/VCS => indeterminado, NUNCA 0 %", () => {
    const m = metricasXp(xp({ fatos: [fato({ status_visto: "concluida" })] }));
    for (const c of ["tdd_primeiro", "vermelho_antes_do_verde", "commits_pequenos", "commit_por_task", "ci_verde", "revisao_independente", "refatoracao", "par"]) expect(get(m, c), c).toMatchObject({ estado: "indeterminado", valor: null });
  });
  it("proporções e faixas (ok >= 70 %, atenção >= 40 %, falha abaixo)", () => {
    const mk = (n: number, de: number) => Array.from({ length: de }, (_, i) => fato({ task_ref: `T${i}`, status_visto: "concluida", tdd_primeiro: i < n }));
    expect(get(metricasXp(xp({ fatos: mk(8, 10) })), "tdd_primeiro")).toMatchObject({ valor: 0.8, estado: "ok", amostra: 10 });
    expect(get(metricasXp(xp({ fatos: mk(5, 10) })), "tdd_primeiro")).toMatchObject({ valor: 0.5, estado: "atencao" });
    expect(get(metricasXp(xp({ fatos: mk(1, 10) })), "tdd_primeiro")).toMatchObject({ valor: 0.1, estado: "falha" });
    const mista = [...mk(2, 4), fato({ task_ref: "X", status_visto: "concluida", tdd_primeiro: null })];
    expect(get(metricasXp(xp({ fatos: mista })), "tdd_primeiro")).toMatchObject({ valor: 0.5, amostra: 4 }); // desconhecido fica fora do denominador
    expect(get(metricasXp(xp({ fatos: [fato({ status_visto: "em_andamento", tdd_primeiro: true })] })), "tdd_primeiro")?.estado).toBe("indeterminado"); // só concluídas
  });
  it("commits pequenos (mediana de linhas, alerta > limite), commit por task e CI/revisão pelas portas", () => {
    const c = (linhas: number | null) => ({ sha: "s", mensagem: "m", ts: null, linhas, labels: [] as string[] });
    expect(get(metricasXp(xp({ fatos: [fato({ status_visto: "concluida", commits: [c(100), c(200), c(900)] })] })), "commits_pequenos")).toMatchObject({ valor: 200, estado: "ok" });
    expect(get(metricasXp(xp({ fatos: [fato({ status_visto: "concluida", commits: [c(500), c(600)] })] })), "commits_pequenos")).toMatchObject({ valor: 550, estado: "atencao" });
    expect(get(metricasXp(xp({ fatos: [fato({ status_visto: "concluida", commits: [c(null)] })] })), "commits_pequenos")?.estado).toBe("indeterminado");
    const fs = [fato({ task_ref: "A", status_visto: "concluida", commits: [c(1)] }), fato({ task_ref: "B", status_visto: "concluida" })];
    expect(get(metricasXp(xp({ fatos: fs })), "commit_por_task")).toMatchObject({ valor: 0.5 });
    expect(get(metricasXp(xp({ fatos: fs, ci_verde: new Map([["tr1/A", true], ["tr1/B", false]]) })), "ci_verde")).toMatchObject({ valor: 0.5 });
    expect(get(metricasXp(xp({ fatos: fs, revisao_independente: new Map([["tr1/A", true], ["tr1/B", null]]) })), "revisao_independente")).toMatchObject({ valor: 1, amostra: 1 });
  });
  it("refatoração = pontos de refator/dívida ÷ total; par = % de itens com par", () => {
    const itens = [itemM({ item_id: "a", pontos: 3, categoria: "refator" }), itemM({ item_id: "b", pontos: 5, categoria: "feature" }), itemM({ item_id: "c", pontos: 2, categoria: "divida" }), itemM({ item_id: "d", pontos: null }), itemM({ item_id: "e", descartado: true, pontos: 8 })];
    const m = metricasXp(xp({ itens, com_par: new Set(["a"]) }));
    expect(get(m, "refatoracao")).toMatchObject({ valor: 0.5, detalhe: "5 de 10 pontos em refatoração" });
    expect(get(m, "par")).toMatchObject({ valor: 0.25, amostra: 4 });
    expect(get(metricasXp(xp()), "par")?.estado).toBe("indeterminado");
  });
  it("checklist: automáticos vêm das métricas, manuais ficam indeterminados, marca manual vence e persiste", () => {
    const m = metricasXp(xp({ fatos: Array.from({ length: 10 }, (_, i) => fato({ task_ref: `T${i}`, status_visto: "concluida", tdd_primeiro: true })) }));
    const cl = avaliarChecklist(CHECKLIST_XP, m);
    expect(cl.find((x) => x.codigo === "testes_primeiro")).toMatchObject({ estado: "ok", fonte: "auto", valor: 1 });
    expect(cl.find((x) => x.codigo === "integracao_continua")).toMatchObject({ estado: "indeterminado", fonte: "auto" });
    expect(cl.find((x) => x.codigo === "ritmo_sustentavel")).toMatchObject({ estado: "indeterminado", fonte: "manual" });
    const man = avaliarChecklist(CHECKLIST_XP, m, new Map([["testes_primeiro", { estado: "falha", nota: "na prática não" }], ["ritmo_sustentavel", { estado: "ok", nota: null }]]));
    expect(man.find((x) => x.codigo === "testes_primeiro")).toMatchObject({ estado: "falha", fonte: "manual", nota: "na prática não" });
    expect(man.find((x) => x.codigo === "ritmo_sustentavel")?.estado).toBe("ok");
    expect(avaliarChecklist(CHECKLIST_LEAN, []).every((x) => x.estado === "indeterminado")).toBe(true);
    expect(CHECKLIST_XP.map((x) => x.codigo)).toContain("propriedade_coletiva");
  });
});

describe("Lean e Kanban (T-18.36)", () => {
  it("desperdícios medidos; sem fonte => null", () => {
    const itens = [itemM({ ref: "a", estado_fluxo: "em_andamento", membro_id: "ana", bloqueada_ms: 2 * H }), itemM({ ref: "b", estado_fluxo: "em_andamento", membro_id: "ana", bloqueada_ms: H }), itemM({ ref: "c", estado_fluxo: "em_andamento", membro_id: "bia" }), itemM({ ref: "d", descartado: true, iniciada_em: "2026-03-01T00:00:00Z" }), itemM({ ref: "e", descartado: true })];
    const r = resumirRetrabalho([]);
    const d = desperdiciosLean({ itens, retrabalho: { ...r, ir: 0.2 }, defeitos_escapados: 3 });
    expect(d).toEqual({ espera_ms: 3 * H, retrabalho_ir: 0.2, trabalho_parcial: 3, troca_de_contexto: { media: 1.5, por_membro: [{ membro_id: "ana", simultaneas: 2 }, { membro_id: "bia", simultaneas: 1 }] }, descartes_apos_inicio: 1, defeitos_escapados: 3 });
    const vazio = desperdiciosLean({ itens: [], retrabalho: r, defeitos_escapados: null });
    expect(vazio).toMatchObject({ espera_ms: null, retrabalho_ir: null, troca_de_contexto: { media: null }, defeitos_escapados: null });
  });
  it("eficiência de fluxo = atividade ÷ lead time; null sem PortaCusto ou sem fonte", () => {
    const i = (ref: string, lead: number) => itemM({ ref, origem: "ade", criado_em: "2026-03-01T00:00:00.000Z", concluida_em: new Date(Date.parse("2026-03-01T00:00:00Z") + lead).toISOString() });
    const itens = [i("a", 10 * H), i("b", 10 * H)];
    expect(eficienciaDeFluxo(itens, null)).toBeNull();
    expect(eficienciaDeFluxo(itens, new Map())).toBeNull();
    expect(eficienciaDeFluxo(itens, new Map([["a", 4 * H], ["b", 2 * H]]))).toBe(0.3);
    expect(eficienciaDeFluxo(itens, new Map([["a", 40 * H]]))).toBe(1); // atividade nunca passa do lead
    expect(novoAgil().portas.custo.janelas("ws1", "t", "r")).resolves.toBeNull();
  });
  it("valor entregue e por ponto", () => {
    const itens = [itemM({ ref: "a", valor: 8, pontos: 2, concluida_em: "2026-03-01T00:00:00Z" }), itemM({ ref: "b", valor: 4, pontos: null, concluida_em: "2026-03-01T00:00:00Z" }), itemM({ ref: "c", valor: 9, pontos: 3 })];
    expect(valorEntregue(itens)).toEqual({ valor_total: 12, por_ponto: 6 });
    expect(valorEntregue([itemM({ ref: "z" })])).toEqual({ valor_total: null, por_ponto: null });
  });
  it("wip.excedido UMA vez por episódio; fecha e reabre; sem limite não dispara", () => {
    const lim = { em_andamento: 3 };
    const w = (n: number, antes: Set<string>) => verificarWip("ws1", () => 0, { em_andamento: n }, lim, antes);
    const r1 = w(5, new Set());
    expect(r1.eventos).toHaveLength(1);
    expect(r1.eventos[0]).toMatchObject({ tipo: "wip.excedido", dados: { coluna: "em_andamento", atual: 5, limite: 3 } });
    const r2 = w(6, r1.abertos);
    expect(r2.eventos).toHaveLength(0); // mesmo episódio
    const r3 = w(2, r2.abertos);
    expect(r3).toMatchObject({ eventos: [], excedidas: [] });
    expect(w(4, r3.abertos).eventos).toHaveLength(1); // novo episódio
    expect(verificarWip("ws1", () => 0, { em_andamento: 99 }, {}, new Set()).eventos).toEqual([]);
    expect(contarPorColuna([itemM({ ref: "a", estado_fluxo: "em_andamento" }), itemM({ ref: "b", estado_fluxo: "em_andamento" }), itemM({ ref: "c", estado_fluxo: "pronto", orfao: true })])).toEqual({ em_andamento: 2 });
  });
  it("limites: a config vale; a PortaBoard (Fase 10) sobrescreve quando existe; porta que lança não derruba", async () => {
    const a = novoAgil();
    expect(await limitesWip("ws1", { wip: { em_andamento: 3 } }, a.portas.board)).toEqual({ em_andamento: 3 }); // sem Fase 10: só a config (indicador na Saúde)
    const board = { colunas: async () => ["em_andamento", "revisao"], limiteWip: async (_w: string, c: string) => (c === "revisao" ? 2 : null) };
    expect(await limitesWip("ws1", { wip: { em_andamento: 3 } }, board)).toEqual({ em_andamento: 3, revisao: 2 });
    expect(await limitesWip("ws1", { wip: { x: 1 } }, { colunas: async () => { throw new Error("x"); }, limiteWip: async () => null })).toEqual({ x: 1 });
  });
});

describe("eventos de domínio (T-18.38)", () => {
  it("publicador persiste e avisa; PortaAlertas que lança ou rejeita nunca quebra; sem porta nada quebra", async () => {
    const a = novoAgil();
    const vistos: string[] = [];
    const pub = criarPublicador(a.banco, { publicar: (e) => { vistos.push(e.tipo); } });
    pub.publicar(novoEvento("sprint.fechada", "ws1", a.relogio, { sprint_id: "s1", pontos: 8 }));
    expect(vistos).toEqual(["sprint.fechada"]);
    expect(a.banco.eventos.valores()[0]).toMatchObject({ tipo: "sprint.fechada", sprint_id: "s1", pontos: 8, duracao_observada_ms: null, tokens: null, seq: 1 });
    expect(jaPublicado(a.banco, "sprint.fechada", "s1")).toBe(true);
    expect(jaPublicado(a.banco, "sprint.fechada", "s2")).toBe(false);
    expect(() => criarPublicador(a.banco, { publicar: () => { throw new Error("x"); } }).publicar(novoEvento("sprint.iniciada", "ws1", a.relogio))).not.toThrow();
    expect(() => criarPublicador(a.banco, { publicar: async () => { throw new Error("x"); } }).publicar(novoEvento("sprint.iniciada", "ws1", a.relogio))).not.toThrow();
    await new Promise((r) => setTimeout(r, 5)); // rejeição não vira unhandledRejection
    expect(() => publicadorNulo.publicar(novoEvento("sprint.iniciada", "ws1", a.relogio))).not.toThrow();
    expect(() => criarAgil().sprint("ws1").criar({ nome: "s", inicio: "2026-03-02", fim: "2026-03-06" })).not.toThrow();
  });
  it("episódios: novos e fechados", () => {
    expect(atualizarEpisodios(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual({ novos: ["c"], fechados: ["a"] });
  });
  it("tarefa.atrasada: P85 do ciclo de comparáveis com >= 8 amostras; senão sem base e NÃO dispara; uma vez por episódio; payload completo", () => {
    const agora = Date.parse("2026-03-10T12:00:00Z");
    const hist = (n: number, cat = "feature") => Array.from({ length: n }, (_, i) => itemM({ ref: `h${cat}${i}`, task_ref: `H${i}`, categoria: cat, concluida_em: "2026-03-01T00:00:00.000Z", duracao_obs_ms: (i + 1) * H }));
    const aberta = itemM({ ref: "tr1/L", task_ref: "L", pontos: 5, categoria: "feature", estado_fluxo: "em_andamento", intervalos: [["2026-03-09T08:00:00.000Z", null]] }); // 28 h
    const r = detectarAtrasadas([...hist(8), aberta], agora);
    expect(r).toMatchObject({ sem_base: false, limite_ms: 6.95 * H });
    expect(r.atrasadas.map((x) => x.item.ref)).toEqual(["tr1/L"]);
    const e1 = eventosDeAtraso("ws1", () => agora, r, new Set());
    expect(e1.eventos).toHaveLength(1);
    expect(e1.eventos[0]).toMatchObject({ tipo: "tarefa.atrasada", trabalho_id: "tr1", task_ref: "L", pontos: 5, duracao_observada_ms: 28 * H, tokens: null });
    expect(eventosDeAtraso("ws1", () => agora, r, e1.abertos).eventos).toHaveLength(0); // mesmo episódio
    const sem = detectarAtrasadas([...hist(7), aberta], agora);
    expect(sem).toMatchObject({ sem_base: true, atrasadas: [] });
    const cat = detectarAtrasadas([...hist(8, "bug"), aberta], agora); // 8 amostras, mas de OUTRA categoria: usa o workspace (mesmas 8)
    expect(cat.atrasadas).toHaveLength(1);
    const noPrazo = itemM({ ref: "tr1/N", task_ref: "N", categoria: "feature", estado_fluxo: "em_andamento", intervalos: [["2026-03-10T10:00:00.000Z", null]] });
    expect(detectarAtrasadas([...hist(8), noPrazo], agora).atrasadas).toEqual([]);
  });
});

describe("exportação (T-18.39)", () => {
  it("CSV RFC 4180: aspas, vírgula, quebra de linha, acentos; CRLF; BOM opcional", () => {
    const csv = csvDe(["a", "b"], [{ a: 'diz "oi", ok', b: "linha1\nlinha2" }, { a: "ação", b: null }], { bom: true });
    expect(csv).toBe('﻿a,b\r\n"diz ""oi"", ok","linha1\nlinha2"\r\nação,\r\n');
    expect(csvDe(["a"], [], {})).toBe("a\r\n");
  });
  it("proteção contra injeção de fórmula: = + - @ (e tab/CR) recebem apóstrofo; números negativos legítimos passam", () => {
    for (const perigoso of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(celulaCsv(perigoso).replace(/^"|"$/g, "").startsWith("'"), perigoso).toBe(true);
    expect(celulaCsv(-5)).toBe("-5");
    expect(celulaCsv("normal")).toBe("normal");
    expect(celulaCsv("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(celulaCsv({ a: 1 })).toBe('"{""a"":1}"');
    expect(celulaCsv(undefined)).toBe("");
    expect(celulaCsv(true)).toBe("true");
  });
  it("Markdown escapa pipes e quebras; JSON legível", () => {
    expect(markdownDe("Backlog", ["a", "b"], [{ a: "x|y", b: "l1\nl2" }])).toBe("# Backlog\n\n| a | b |\n| --- | --- |\n| x\\|y | l1 l2 |\n");
    expect(jsonDe({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
  it("nome seguro (sem barras, sem ..) e escrita só pelo gravador injetado; formato inválido recusado", async () => {
    const quando = new Date("2026-03-10T12:34:56.789Z");
    expect(nomeSeguro("backlog", "csv", quando)).toBe("backlog-20260310T123456.csv");
    const n = nomeSeguro("metricas", "json", quando, "../../docs/ade/x y");
    expect(n).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(n).not.toMatch(/\.\.|\//);
    const escritos: [string, string][] = [];
    const r = await exportar({ escrever: async (nome, c) => { escritos.push([nome, c]); return `exportacoes/${nome}`; } }, { tipo: "backlog", formato: "csv", colunas: ["id"], linhas: [{ id: "=x" }], quando });
    expect(r.caminho_ref).toBe("exportacoes/backlog-20260310T123456.csv");
    expect(escritos[0]?.[1]).toBe("id\r\n'=x\r\n");
    await expect(exportar({ escrever: async () => "" }, { tipo: "backlog", formato: "xlsx" as never, colunas: [], linhas: [], quando })).rejects.toThrow(/formato/);
    expect(COLUNAS_BACKLOG).toContain("situacao_retrabalho");
  });
});

describe("fábrica e portas (T-18.03)", () => {
  it("criarAgil funciona só com Indisponivel*; porta ausente nunca lança, devolve null/vazio", async () => {
    const p = portasIndisponiveis();
    expect(await p.metodo.fontes("ws")).toEqual([]);
    expect(await p.metodo.ocorrencias("ws")).toEqual([]);
    expect(await p.metodo.historicoSprintx("ws")).toBeNull();
    expect(await p.custo.janelas("ws", "t", "r")).toBeNull();
    expect(await p.board.colunas("ws")).toBeNull();
    expect(await p.board.limiteWip("ws", "c")).toBeNull();
    expect(await p.rag.buscar("ws", "x", { tipos: [], limite: 1 })).toEqual([]);
    expect(await p.mapa.raio("ws", [])).toBeNull();
    expect(await p.perfil.resolver("ws", "agil", "estimativa")).toBeNull();
    expect(await p.consentimento.estimativaPorIa("ws")).toBe(false);
    expect(await p.vcs.numstat("ws", "sha")).toBeNull();
    expect(await p.forge.checksVerdes("ws", "t")).toBeNull();
    expect(await p.forge.reviews("ws", "t")).toBeNull();
    expect(p.alertas.publicar({} as never)).toBeUndefined();
    await expect(p.headless.executar({ perfil: { cli: "x", modelo: null, faixa: "rapido" }, entrada: "", tools: [], timeoutMs: 1 })).rejects.toThrow(/indisponível/);
    const a = criarAgil();
    const r = await a.sincronizar("ws1");
    expect(r).toMatchObject({ trabalhos_lidos: 0, itens_criados: 0 });
    expect(a.painel("ws1").base).toMatchObject({ tasks: 0, itens: 0 });
  });
  it("config por workspace: gravar mescla e valida; inválida recusada com a lista; relógio injetado em toda a lógica", () => {
    const a = criarAgil({ relogio: () => Date.parse("2026-03-10T00:00:00Z") });
    expect(a.config.ler("ws1").janela_retrabalho_dias).toBe(14);
    expect(a.config.gravar("ws1", { janela_retrabalho_dias: 7 }).janela_retrabalho_dias).toBe(7);
    expect(a.config.gravar("ws1", { buffer_planejamento: 0.1 })).toMatchObject({ janela_retrabalho_dias: 7, buffer_planejamento: 0.1 }); // não perde o que já era do usuário
    expect(() => a.config.gravar("ws1", { janela_retrabalho_dias: 0 })).toThrow(/janela_retrabalho_dias/);
    expect(a.config.ler("ws1").janela_retrabalho_dias).toBe(7);
    const i = a.backlog("ws1").criar({ titulo: "x" });
    expect(i.criado_em).toBe("2026-03-10T00:00:00.000Z"); // nenhum Date.now escondido
    expect(cfg().estimativa_modo).toBe("ia_sugere");
  });
});
