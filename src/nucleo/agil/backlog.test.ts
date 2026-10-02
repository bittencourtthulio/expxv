import { describe, expect, it } from "vitest";
import { cfg, fato, itemAgil, novoAgil } from "../../../tests/fixtures/agil/ajudas";
import { apagarEpico, atualizarItem, criarItem, descartarItem, gravarEpico } from "./backlog/itens";
import { ordenarBacklog, quadranteValorEsforco, rankMoscow, reordenar, wsjf } from "./backlog/priorizar";
import { argumentoSeguro, comandoDePromocao, sugerirVinculos, vincularItem } from "./backlog/promover";
import { avaliarDoD, gravarDoD } from "./backlog/dod";
import { avaliarDoR, duplicadosProvaveis, filaDeRefino, precisaDeRefino, sugerirQuebra, type ContextoDoR } from "./backlog/refinar";
import { montarRefinamento } from "./cerimonias/refinamento";
import { FILTROS_BACKLOG_VAZIOS, listarBacklog, listarRetrabalho, metricaPorNome, METRICAS_NOMEADAS, statusDaSprint } from "./consultas";
import { gravarEstimativaHumana, proporClassificacao, proporEstimativa } from "./estimativa/revisao";
import { montarPainel, FILTROS_VAZIOS } from "./metricas/painel";
import { prng } from "./util";

const mundo = () => { const a = novoAgil(); a.config.gravar("ws1", {}); return { a, d: { banco: a.banco, relogio: a.relogio, id: a.id } }; };

describe("itens e épicos (T-18.09)", () => {
  it("criar item: título obrigatório, ordem crescente, campos para a Fase 19 com defaults seguros", () => {
    const { d } = mundo();
    expect(() => criarItem(d, { workspace_id: "ws1", titulo: "  " })).toThrow(/título/);
    const a = criarItem(d, { workspace_id: "ws1", titulo: "Cadastro", criterios: ["salva", "valida"] });
    const b = criarItem(d, { workspace_id: "ws1", titulo: "Relatório" });
    expect(b.ordem).toBeGreaterThan(a.ordem);
    expect(a).toMatchObject({ origem: "ade", estado_ade: "backlog", visibilidade_cliente: "auto", resumo_cliente: null, resumo_cliente_origem: null, changelog_tipo: null, orfao: false });
    expect(() => criarItem(d, { workspace_id: "ws1", titulo: "x", epico_id: "nope" })).toThrow(/épico/);
  });
  it("item espelho (origem metodo): SÓ campos ágeis são editáveis", () => {
    const { d } = mundo();
    d.banco.itens.set("m", itemAgil({ id: "m", origem: "metodo", trabalho_id: "tr1", task_ref: "T-01.01", titulo: "Do disco" }));
    expect(atualizarItem(d, "m", { valor: 7, moscow: "must", dono_membro_id: "m1", changelog_tipo: "added" })).toMatchObject({ valor: 7, moscow: "must" });
    for (const campo of [{ titulo: "novo" }, { descricao: "x" }, { criterios: ["a"] }]) expect(() => atualizarItem(d, "m", campo), JSON.stringify(campo)).toThrow(/espelho do método/);
    expect(d.banco.itens.get("m")?.titulo).toBe("Do disco");
    d.banco.itens.set("a", itemAgil({ id: "a" }));
    expect(atualizarItem(d, "a", { titulo: "Novo título", criterios: ["x"] }).titulo).toBe("Novo título");
  });
  it("validações: notas 1..10, moscow e changelog fechados, campo desconhecido, épico inexistente", () => {
    const { d } = mundo();
    d.banco.itens.set("a", itemAgil({ id: "a" }));
    expect(() => atualizarItem(d, "a", { valor: 11 })).toThrow(/1 a 10/);
    expect(() => atualizarItem(d, "a", { urgencia: 0 })).toThrow(/1 a 10/);
    expect(() => atualizarItem(d, "a", { moscow: "talvez" as never })).toThrow(/moscow/);
    expect(() => atualizarItem(d, "a", { changelog_tipo: "x" as never })).toThrow(/changelog/);
    expect(() => atualizarItem(d, "a", { estado_ade: "pronto" } as never)).toThrow(/campo desconhecido/);
    expect(() => atualizarItem(d, "a", { epico_id: "nope" })).toThrow(/épico/);
    expect(() => atualizarItem(d, "nope", {})).toThrow(/item/);
  });
  it("resumo_cliente é SEMPRE de origem humana; limpar zera a origem", () => {
    const { d } = mundo();
    d.banco.itens.set("a", itemAgil({ id: "a" }));
    expect(atualizarItem(d, "a", { resumo_cliente: "Agora você pode exportar o relatório." })).toMatchObject({ resumo_cliente_origem: "humano" });
    expect(atualizarItem(d, "a", { resumo_cliente: null })).toMatchObject({ resumo_cliente: null, resumo_cliente_origem: null });
  });
  it("descartar exige motivo; descartado não edita", () => {
    const { d } = mundo();
    d.banco.itens.set("a", itemAgil({ id: "a" }));
    expect(() => descartarItem(d, "a", " ")).toThrow(/motivo/);
    expect(descartarItem(d, "a", "duplicado")).toMatchObject({ estado_ade: "descartado", descartado_motivo: "duplicado" });
    expect(() => atualizarItem(d, "a", { valor: 1 })).toThrow(/descartado/);
  });
  it("épicos: CRUD e apagar solta os itens", () => {
    const { d } = mundo();
    const e = gravarEpico(d, { workspace_id: "ws1", titulo: "Checkout" });
    expect(gravarEpico(d, { id: e.id, workspace_id: "ws1", titulo: "Checkout v2", estado: "concluido" })).toMatchObject({ titulo: "Checkout v2", estado: "concluido", criado_em: e.criado_em });
    expect(() => gravarEpico(d, { workspace_id: "ws1", titulo: "" })).toThrow(/título/);
    expect(() => gravarEpico(d, { id: "nope", workspace_id: "ws1", titulo: "x" })).toThrow(/épico/);
    const it = criarItem(d, { workspace_id: "ws1", titulo: "x", epico_id: e.id });
    apagarEpico(d, e.id);
    expect(d.banco.itens.get(it.id)?.epico_id).toBeNull();
    expect(() => apagarEpico(d, e.id)).toThrow(/épico/);
  });
});

describe("priorização (T-18.10)", () => {
  it("WSJF = (valor+urgência+risco)/pontos; null sem pontos ou sem notas", () => {
    expect(wsjf({ valor: 8, urgencia: 5, reducao_risco: 2 }, 5)).toBe(3);
    expect(wsjf({ valor: 8, urgencia: null, reducao_risco: null }, 3)).toBe(2.667);
    expect(wsjf({ valor: 8, urgencia: 5, reducao_risco: 2 }, null)).toBeNull();
    expect(wsjf({ valor: null, urgencia: null, reducao_risco: null }, 3)).toBeNull();
    expect(wsjf({ valor: 8, urgencia: 5, reducao_risco: 2 }, 0)).toBeNull();
  });
  it("ordem manual vence qualquer cálculo; wsjf e valor×esforço ordenam por critério", () => {
    const mk = (id: string, ordem: number, valor: number | null, pontos: number | null) => ({ item: itemAgil({ id, ordem, valor }), pontos });
    const l = [mk("a", 3, 2, 8), mk("b", 1, 9, 1), mk("c", 2, 8, 13), mk("d", 4, null, 3)];
    expect(ordenarBacklog(l, "ordem").map((x) => x.item.id)).toEqual(["b", "c", "a", "d"]);
    expect(ordenarBacklog(l, "wsjf").map((x) => x.item.id)).toEqual(["b", "c", "a", "d"]); // b 9, c 0,615, a 0,25, d sem WSJF por último
    expect(ordenarBacklog(l, "valor_esforco").map((x) => x.item.id)).toEqual(["b", "c", "a", "d"]); // ganho rápido, grande aposta, evitar, sem dado
    expect(quadranteValorEsforco(9, 1)).toBe("ganho_rapido");
    expect(quadranteValorEsforco(8, 13)).toBe("grande_aposta");
    expect(quadranteValorEsforco(2, 2)).toBe("preencher");
    expect(quadranteValorEsforco(2, 8)).toBe("evitar");
    expect(quadranteValorEsforco(null, 3)).toBeNull();
    expect([rankMoscow("must"), rankMoscow("wont"), rankMoscow(null)]).toEqual([0, 3, 4]);
  });
  it("reordenar: 1 UPDATE (valor fracionário entre os vizinhos), pontas, e rebalanceia só quando a lacuna se esgota", () => {
    const base = [{ id: "a", ordem: 1024 }, { id: "b", ordem: 2048 }, { id: "c", ordem: 3072 }];
    expect(reordenar(base, "c", "b")).toEqual({ ordem: 1536, rebalanceados: null }); // entre a (1024) e b (2048)
    expect(reordenar(base, "c", "a").ordem).toBe(0); // antes do primeiro: 1024 - passo
    expect(reordenar(base, "a", null).ordem).toBe(3072 + 1024);
    expect(reordenar([], "a", null).ordem).toBe(1024);
    expect(() => reordenar(base, "a", "nope")).toThrow();
    const apertado = [{ id: "a", ordem: 1 }, { id: "b", ordem: 1 + 1e-10 }];
    const r = reordenar(apertado, "x", "b");
    expect(r.rebalanceados).not.toBeNull();
    expect([...(r.rebalanceados as Map<string, number>).entries()]).toEqual([["a", 1024], ["x", 2048], ["b", 3072]]);
  });
  it("5 000 reordenações seguidas: ordem total estável (propriedade) e sem degradar", () => {
    const rnd = prng(3);
    let lista = Array.from({ length: 50 }, (_, i) => ({ id: `i${i}`, ordem: (i + 1) * 1024 }));
    const t0 = performance.now();
    for (let k = 0; k < 5000; k++) {
      const item = lista[Math.floor(rnd() * lista.length)] as { id: string; ordem: number };
      const alvo = rnd() < 0.15 ? null : (lista[Math.floor(rnd() * lista.length)] as { id: string }).id;
      if (alvo === item.id) continue;
      const ord = [...lista].sort((x, y) => x.ordem - y.ordem);
      const r = reordenar(ord, item.id, alvo);
      lista = lista.map((x) => ({ id: x.id, ordem: r.rebalanceados ? (r.rebalanceados.get(x.id) as number) : x.id === item.id ? r.ordem : x.ordem }));
      const depois = [...lista].sort((x, y) => x.ordem - y.ordem).map((x) => x.id);
      const esperado = ord.map((x) => x.id).filter((x) => x !== item.id);
      const pos = alvo === null ? esperado.length : esperado.indexOf(alvo);
      esperado.splice(pos, 0, item.id);
      expect(depois).toEqual(esperado);
    }
    const ordens = lista.map((x) => x.ordem);
    expect(new Set(ordens).size).toBe(ordens.length); // ordem estrita, sem empate
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("promoção para o método (T-18.11)", () => {
  it("gera o comando certo e NUNCA dispara; argumento é saneado numa linha", () => {
    const i = { titulo: "Cadastro de clientes", descricao: "com `crase` e $VAR\nsegunda linha \\ fim", origem: "ade" as const };
    expect(comandoDePromocao({ ...i, descricao: null }, "prodx")).toBe("/expx:prodx-triar Cadastro de clientes");
    expect(comandoDePromocao({ ...i, descricao: null }, "sprintx")).toBe("/expx:sprintx Cadastro de clientes");
    expect(comandoDePromocao({ ...i, descricao: null }, "runx")).toBe("/expx:runx Cadastro de clientes");
    const c = comandoDePromocao(i, "sprintx");
    expect(c).not.toMatch(/[`$\\\n\r]/);
    expect(c).toBe("/expx:sprintx Cadastro de clientes: com crase e VAR segunda linha fim");
    expect(argumentoSeguro("a".repeat(900)).length).toBe(500);
    expect(() => comandoDePromocao(i, "x" as never)).toThrow(/destino/);
    expect(() => comandoDePromocao({ ...i, origem: "metodo" as never }, "prodx")).toThrow(/já vem do método/);
    expect(() => comandoDePromocao({ titulo: " ", descricao: null, origem: "ade" }, "prodx")).toThrow(/sem texto/);
  });
  it("sugere vínculo por similaridade de título (não vinculados), só >= limiar; vínculo é ação humana e desfaz sem perder histórico", () => {
    const item = { titulo: "Cadastro de clientes com validação", trabalho_id: null };
    const trabs = [{ id: "t1", titulo: "Cadastro de clientes com validação de CPF" }, { id: "t2", titulo: "Relatório fiscal" }, { id: "t3", titulo: "Cadastro de clientes com validação" }];
    expect(sugerirVinculos(item, trabs, new Set(["t3"])).map((s) => s.trabalho_id)).toEqual(["t1"]);
    expect(sugerirVinculos({ ...item, trabalho_id: "ja" }, trabs, new Set())).toEqual([]);
    expect(sugerirVinculos(item, trabs, new Set(), 0.99).map((s) => s.trabalho_id)).toEqual(["t3"]);
    const { a, d } = mundo();
    a.banco.itens.set("a", itemAgil({ id: "a" }));
    proporEstimativa({ ...d, config: cfg() }, { item_id: "a", pontos: 5, origem: "ia", motor: "manual", confianca: 1, fatores: [], min_h: null, max_h: null, nota: null });
    expect(vincularItem(d, "a", "t1", "T-01.01")).toMatchObject({ trabalho_id: "t1", task_ref: "T-01.01" });
    expect(vincularItem(d, "a", null)).toMatchObject({ trabalho_id: null, task_ref: null });
    expect(a.banco.estimativas.valores()).toHaveLength(1); // histórico intacto
    a.banco.itens.set("m", itemAgil({ id: "m", origem: "metodo" }));
    expect(() => vincularItem(d, "m", "t1")).toThrow(/espelho/);
  });
});

describe("DoD e DoR (T-18.12)", () => {
  const c = cfg();
  const f = (o = {}) => fato({ status_visto: "concluida", suite_final: "verde", commits: [{ sha: "a", mensagem: "m", ts: null, linhas: null, labels: [] }], ...o });
  const estado = (rs: ReturnType<typeof avaliarDoD>, codigo: string) => rs.find((r) => r.criterio === codigo);
  it("DoD automática por fatos (tabela)", () => {
    const base = { fato: f(), categoria: "feature", qa_aprovado: true, regras_violadas_abertas: 0 };
    const ok = avaliarDoD(base, c);
    expect(ok.filter((r) => r.estado === "ok").map((r) => r.criterio)).toEqual(["suite_verde", "testes_minimos", "qa_aprovado", "commit_por_task", "sem_regra_violada"]);
    expect(estado(ok, "sem_segredo")).toMatchObject({ estado: "indeterminado", fonte: "auto" }); // manual: aguardando humano
    expect(estado(avaliarDoD({ ...base, qa_aprovado: false }, c), "qa_aprovado")).toMatchObject({ estado: "falha", motivo: "task concluída sem QA aprovado" }); // item concluído sem QA aprovado
    expect(estado(avaliarDoD({ ...base, qa_aprovado: null }, c), "qa_aprovado")?.estado).toBe("indeterminado");
    expect(estado(avaliarDoD({ ...base, fato: f({ suite_final: "vermelha" }) }, c), "suite_verde")?.estado).toBe("falha");
    expect(estado(avaliarDoD({ ...base, fato: f({ suite_final: "nao_executada" }) }, c), "suite_verde")?.estado).toBe("falha");
    expect(estado(avaliarDoD({ ...base, fato: f({ status_visto: "em_andamento", suite_final: "parcial" }) }, c), "suite_verde")?.estado).toBe("indeterminado");
    expect(estado(avaliarDoD({ ...base, fato: f({ declarados: { integracao: true, funcional: false, regressao: false } }) }, c), "testes_minimos")?.estado).toBe("falha");
    expect(estado(avaliarDoD({ ...base, categoria: "bug" }, c), "testes_minimos")).toMatchObject({ estado: "falha", motivo: "bug sem teste de regressão" });
    expect(estado(avaliarDoD({ ...base, categoria: "bug", fato: f({ declarados: { integracao: true, funcional: true, regressao: true } }) }, c), "testes_minimos")?.estado).toBe("ok");
    expect(estado(avaliarDoD({ ...base, fato: f({ commits: [] }) }, c), "commit_por_task")?.estado).toBe("falha");
    expect(estado(avaliarDoD({ ...base, regras_violadas_abertas: 2 }, c), "sem_regra_violada")?.estado).toBe("falha");
    expect(estado(avaliarDoD({ ...base, regras_violadas_abertas: null }, c), "sem_regra_violada")?.estado).toBe("indeterminado");
  });
  it("sem fatos tudo indeterminado (nunca ok por omissão); marcação manual vence e é preservada ao reavaliar", () => {
    const rs = avaliarDoD({ fato: null, categoria: null, qa_aprovado: null, regras_violadas_abertas: null }, c);
    expect(rs.every((r) => r.estado === "indeterminado")).toBe(true);
    const { a, d } = mundo();
    gravarDoD(d, "i1", [{ criterio: "sem_segredo", estado: "ok", fonte: "manual", motivo: "" }]);
    gravarDoD(d, "i1", [{ criterio: "sem_segredo", estado: "indeterminado", fonte: "auto", motivo: "" }]);
    expect(a.banco.dodResultados.get("i1|sem_segredo")).toMatchObject({ estado: "ok", fonte: "manual" });
    const manuais = new Map([["sem_segredo", a.banco.dodResultados.get("i1|sem_segredo") as never]]);
    expect(estado(avaliarDoD({ fato: f(), categoria: null, qa_aprovado: true, regras_violadas_abertas: 0 }, c, manuais), "sem_segredo")).toMatchObject({ estado: "ok", fonte: "manual" });
  });
  const ctx = (o: Partial<ContextoDoR> = {}): ContextoDoR => ({ item: itemAgil(), pontos: 3, risco: "baixo", dependencias_ok: true, lacuna_aberta: false, ...o });
  it("DoR: critério, estimativa, risco, dependências, tamanho e lacuna (tabela)", () => {
    expect(precisaDeRefino(avaliarDoR(ctx(), c))).toBe(false);
    const falha = (o: Partial<ContextoDoR>, codigo: string) => avaliarDoR(ctx(o), c).find((r) => r.codigo === codigo)?.ok;
    expect(falha({ item: itemAgil({ criterios: [] }) }, "criterio_aceite")).toBe(false);
    expect(falha({ pontos: null }, "estimado")).toBe(false);
    expect(falha({ risco: null }, "risco_classificado")).toBe(false);
    expect(falha({ dependencias_ok: false }, "dependencias_ok")).toBe(false);
    expect(falha({ dependencias_ok: null }, "dependencias_ok")).toBeNull();
    expect(falha({ pontos: 21 }, "tamanho_ok")).toBe(false);
    expect(falha({ lacuna_aberta: true }, "sem_lacuna")).toBe(false);
    expect(falha({ lacuna_aberta: null }, "sem_lacuna")).toBeNull();
  });
  it("fila de refino: só itens do ADE, ordenados; quebra sugerida para > 13; refinamento como conteúdo", () => {
    const itens = [ctx({ item: itemAgil({ id: "b", ordem: 2, criterios: [] }) }), ctx({ item: itemAgil({ id: "a", ordem: 1 }), pontos: 21 }), ctx({ item: itemAgil({ id: "m", origem: "metodo", criterios: [] }) }), ctx({ item: itemAgil({ id: "ok", ordem: 3 }) })];
    expect(filaDeRefino(itens, c).map((x) => x.ctx.item.id)).toEqual(["a", "b"]);
    expect(sugerirQuebra(21)).toEqual([13, 8]);
    expect(sugerirQuebra(13)).toBeNull();
    expect(sugerirQuebra(null)).toBeNull();
    expect(montarRefinamento(itens, c).itens.map((x) => [x.item_id, x.quebra_sugerida])).toEqual([["a", [13, 8]], ["b", null]]);
  });
  it("duplicados prováveis: sem RAG vazio; usa similaridade; RAG que lança não derruba", async () => {
    const { a } = mundo();
    expect(await duplicadosProvaveis(a.portas.rag, "ws1", { id: "x", titulo: "Cadastro" })).toEqual([]);
    const rag = { buscar: async () => [{ ref: "x", titulo: "Cadastro", pontos: null, categoria: null, duracao_obs_ms: null, retrabalho: null, similaridade: 1 }, { ref: "y", titulo: "Cadastro de clientes", pontos: null, categoria: null, duracao_obs_ms: null, retrabalho: null, similaridade: 0.8 }, { ref: "z", titulo: "Outra coisa", pontos: null, categoria: null, duracao_obs_ms: null, retrabalho: null, similaridade: 0.2 }] };
    expect((await duplicadosProvaveis(rag, "ws1", { id: "x", titulo: "Cadastro" })).map((d) => d.ref)).toEqual(["y"]);
    expect(await duplicadosProvaveis({ buscar: async () => { throw new Error("x"); } }, "ws1", { id: "x", titulo: "a" })).toEqual([]);
  });
});

describe("consultas prontas (backlog, sprint_status, metrics_get)", () => {
  function com3() {
    const { a, d } = mundo();
    const dep = { ...d, config: a.config.ler("ws1") };
    for (const [id, ordem, titulo] of [["a", 1, "Cadastro de clientes"], ["b", 2, "Relatório fiscal"], ["c", 3, "Login"]] as const) a.banco.itens.set(id, itemAgil({ id, ordem, titulo, valor: id === "c" ? 9 : null }));
    gravarEstimativaHumana(dep, { item_id: "a", pontos: 3 });
    gravarEstimativaHumana(dep, { item_id: "c", pontos: 1 });
    proporClassificacao(dep, { item_id: "a", categoria: "feature", risco: "alto", criticidade: "alta", tipo_task: null, risco_fatores: [], motor: "manual", confianca: 1 });
    return a;
  }
  it("filtros, ordenação, paginação por cursor e contagens", () => {
    const a = com3();
    const todos = listarBacklog(a.banco, "ws1");
    expect(todos.itens.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(todos.total).toBe(3);
    expect(todos.contagens).toEqual({ backlog: 3 });
    expect(listarBacklog(a.banco, "ws1", { ...FILTROS_BACKLOG_VAZIOS, texto: "fiscal" }).itens.map((i) => i.id)).toEqual(["b"]);
    expect(listarBacklog(a.banco, "ws1", { ...FILTROS_BACKLOG_VAZIOS, sem_estimativa: true }).itens.map((i) => i.id)).toEqual(["b"]);
    expect(listarBacklog(a.banco, "ws1", { ...FILTROS_BACKLOG_VAZIOS, risco: "alto" }).itens.map((i) => i.id)).toEqual(["a"]);
    expect(listarBacklog(a.banco, "ws1", FILTROS_BACKLOG_VAZIOS, "wsjf").itens.map((i) => i.id)).toEqual(["c", "a", "b"]); // c: 9/1; os demais sem WSJF
    const p1 = listarBacklog(a.banco, "ws1", FILTROS_BACKLOG_VAZIOS, "ordem", null, 2);
    expect(p1).toMatchObject({ proximo: "2", total: 3 });
    expect(listarBacklog(a.banco, "ws1", FILTROS_BACKLOG_VAZIOS, "ordem", p1.proximo, 2)).toMatchObject({ proximo: null, itens: [{ id: "c" }] });
    expect(todos.itens[0]).toMatchObject({ pontos: 3, risco: "alto", estimativa_origem: "humano", wsjf: null });
    expect(listarBacklog(a.banco, "outro").total).toBe(0);
  });
  it("itens descartados não aparecem; metrics_get e sprint_status leem do painel", () => {
    const a = com3();
    a.banco.itens.set("b", { ...(a.banco.itens.get("b") as ReturnType<typeof itemAgil>), estado_ade: "descartado" });
    expect(listarBacklog(a.banco, "ws1").itens.map((i) => i.id)).toEqual(["a", "c"]);
    const p = montarPainel({ banco: a.banco, config: a.config.ler("ws1"), relogio: a.relogio }, "ws1", FILTROS_VAZIOS);
    for (const m of METRICAS_NOMEADAS) expect(() => metricaPorNome(p, m)).not.toThrow();
    expect(metricaPorNome(p, "velocity")).toEqual([]);
    expect(statusDaSprint(p, "S1", "s1", "ativa")).toEqual({ sprint_id: "s1", nome: "S1", estado: "ativa", committed: null, done: 0, remaining: null, health: [] });
  });
});

describe("origem de proposta e rework_list (leitura)", () => {
  it("backlog_propose de agente entra como item do ADE em backlog, marcado como proposto por agente", () => {
    const { d } = mundo();
    const i = criarItem(d, { workspace_id: "ws1", titulo: "Ideia do agente", origem_ref: { proposto_por: "agente" } });
    expect(i).toMatchObject({ origem: "ade", estado_ade: "backlog", origem_ref: { proposto_por: "agente" } });
    expect(criarItem(d, { workspace_id: "ws1", titulo: "x" }).origem_ref).toBeNull();
  });
  it("rework_list: eventos recentes primeiro, limite <= 100, só do workspace, sem campo de código", () => {
    const { a } = mundo();
    const mk = (id: string, ws: string, quando: string) => a.banco.eventosRetrabalho.set(id, { id, workspace_id: ws, trabalho_id: "tr1", task_ref: "T-01.01", item_id: null, fonte: "commit_fix", forca: "forte", natureza: "defeito", evidencia: { mensagem: "fix: x" }, chave_dedupe: id, ocorrido_em: quando, detectado_em: quando, confirmado_por: "automatico", motivo: "segredo interno", ativo: true });
    mk("e1", "ws1", "2026-03-01T00:00:00Z"); mk("e2", "ws1", "2026-03-05T00:00:00Z"); mk("e3", "outro", "2026-03-09T00:00:00Z");
    a.banco.retrabalhoTasks.set("ws1|tr1|T-01.01", { workspace_id: "ws1", trabalho_id: "tr1", task_ref: "T-01.01", situacao: "retrabalho", eventos_defeito: 2, eventos_pendentes: 0, janela_ate: null, calculado_em: "" });
    a.banco.retrabalhoTasks.set("ws1|tr1|T-01.02", { workspace_id: "ws1", trabalho_id: "tr1", task_ref: "T-01.02", situacao: null, eventos_defeito: 0, eventos_pendentes: 0, janela_ate: null, calculado_em: "" });
    const r = listarRetrabalho(a.banco, "ws1");
    expect(r.eventos.map((e) => e.ocorrido_em)).toEqual(["2026-03-05T00:00:00Z", "2026-03-01T00:00:00Z"]);
    expect(r.situacoes).toEqual([{ trabalho_id: "tr1", task_ref: "T-01.01", situacao: "retrabalho" }]);
    expect(JSON.stringify(r)).not.toMatch(/segredo interno/); // o motivo humano não sai pela leitura de agente
    expect(listarRetrabalho(a.banco, "ws1", 1).eventos).toHaveLength(1);
  });
});

