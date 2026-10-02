import { describe, expect, it } from "vitest";
import { ev } from "../../../tests/fixtures/metodo/construtores";
import { cfg, fato, itemAgil, itemM, novoAgil } from "../../../tests/fixtures/agil/ajudas";
import { gerarDaily } from "./cerimonias/daily";
import { devolverAoBacklog, montarReview, registrarDemo } from "./cerimonias/review";
import { calcularInsights } from "./cerimonias/insights";
import { acaoParaItem, adicionarItemRetro, atualizarAcao, COLUNAS, criarAcao, criarRetro, publicarAcoesVencidas, votarRetro } from "./cerimonias/retro";
import { criarPublicador } from "./eventos";
import { adicionarItem, criarSprint, iniciarSprint } from "./sprint/ciclo";
import type { MembroAgil } from "../../compartilhado/agil";

const H = 3_600_000;
const m = (id: string, rotulo: string): MembroAgil => ({ id, workspace_id: "ws1", tipo: "humano", rotulo, squad_id: null, horas_dia: 6, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [] });

describe("daily dos fatos (T-18.26)", () => {
  // terça 2026-03-10 12:00 UTC; último dia útil = segunda 09
  const agora = Date.parse("2026-03-10T12:00:00Z");
  const base = { membros: [m("ana", "Ana"), m("bia", "Bia")], bloqueios_abertos: [], agora, config: cfg() };
  it("sem rastro nem itens: 'sem atividade registrada' (nunca inventa)", () => {
    const d = gerarDaily({ ...base, itens: [], rastro: [] });
    expect(d).toMatchObject({ sem_atividade: true, data: "2026-03-10", desde: "2026-03-09", membros: [] });
    expect(d.texto_curto).toBe("Daily 2026-03-10: sem atividade registrada.");
    expect(d.markdown).toContain("Sem atividade registrada.");
  });
  it("ontem/hoje/bloqueios/atrasos por membro; texto curto e Markdown", () => {
    const itens = [
      itemM({ ref: "tr1/T-01.01", task_ref: "T-01.01", titulo: "Cadastro", membro_id: "ana", concluida_em: "2026-03-09T15:00:00.000Z", estado_fluxo: "concluida" }),
      itemM({ ref: "tr1/T-01.02", task_ref: "T-01.02", titulo: "Listagem", membro_id: "ana", estado_fluxo: "em_andamento", iniciada_em: "2026-03-10T08:00:00.000Z", intervalos: [["2026-03-10T08:00:00.000Z", null]], risco: "alto" }),
      itemM({ ref: "tr1/T-01.03", task_ref: "T-01.03", titulo: "Filtro", membro_id: "bia", estado_fluxo: "pronto", depende_de: ["T-01.01"] }),
      itemM({ ref: "tr1/T-01.04", task_ref: "T-01.04", titulo: "Export", membro_id: "bia", estado_fluxo: "pronto", depende_de: ["T-01.02"] }), // dependência não concluída: não vira "próxima"
      itemM({ ref: "tr1/T-01.00", task_ref: "T-01.00", titulo: "Antiga", membro_id: "bia", concluida_em: "2026-03-05T15:00:00.000Z", estado_fluxo: "concluida" }), // fora da janela
    ];
    const rastro = [
      ev({ trabalho_id: "tr1", task: "T-01.01", evento: "commit_criado", ts: "2026-03-09T14:00:00Z", detalhe: "feat: cadastro" }),
      ev({ trabalho_id: "tr1", task: "T-01.01", evento: "pr_aberto", ts: "2026-03-09T16:00:00Z", detalhe: "#12" }),
      ev({ trabalho_id: "tr1", task: null, evento: "veredito_emitido", ts: "2026-03-09T17:00:00Z", resultado: "aprovado" }),
      ev({ trabalho_id: "tr1", task: "T-01.00", evento: "commit_criado", ts: "2026-03-05T14:00:00Z", detalhe: "velho" }),
    ];
    const d = gerarDaily({ ...base, itens, rastro, bloqueios_abertos: [{ trabalho_id: "tr1", task: "T-01.02", descricao: "aguarda API" }] });
    const ana = d.membros.find((x) => x.membro_id === "ana");
    const bia = d.membros.find((x) => x.membro_id === "bia");
    const sem = d.membros.find((x) => x.membro_id === null);
    expect(ana?.ontem.map((l) => l.texto)).toEqual(["Concluída: Cadastro", "Commit: feat: cadastro", "PR aberto: #12"]);
    expect(ana?.hoje.map((l) => l.texto)).toEqual(["Em andamento: Listagem"]);
    expect(ana?.bloqueios.map((l) => l.texto)).toEqual(["Bloqueio: aguarda API"]);
    expect(ana?.riscos.map((l) => l.texto)).toEqual(["Risco alto: Listagem"]);
    expect(bia?.hoje.map((l) => l.texto)).toEqual(["Próxima: Filtro"]);
    expect(bia?.ontem).toEqual([]);
    expect(sem?.ontem.map((l) => l.texto)).toEqual(["Veredito emitido: aprovado"]);
    expect(d.membros.map((x) => x.rotulo)).toEqual(["Ana", "Bia", "Sem dono"]); // sem dono por último
    expect(d.texto_curto).toMatch(/^Daily 2026-03-10\nAna\n {2}Ontem: Concluída: Cadastro; Commit: feat: cadastro; PR aberto: #12\n {2}Hoje: Em andamento: Listagem/);
    expect(d.texto_curto).not.toMatch(/\*\*|^#|\n#|\n- /); // sem formatação Markdown, para chat
    expect(d.markdown).toMatch(/^# Daily 2026-03-10\n\n## Ana\n\*\*Ontem\*\*\n- Concluída: Cadastro/);
    expect(d.markdown).toContain("- sem atividade registrada"); // seção vazia dita isso, não some
  });
  it("segunda-feira olha a sexta; atrasos aparecem quando há base (>= 8 amostras) e a task passou do P85", () => {
    const seg = Date.parse("2026-03-09T09:00:00Z");
    expect(gerarDaily({ ...base, itens: [], rastro: [], agora: seg }).desde).toBe("2026-03-06");
    const hist = Array.from({ length: 8 }, (_, i) => itemM({ ref: `h${i}`, task_ref: `H${i}`, concluida_em: "2026-03-01T00:00:00.000Z", duracao_obs_ms: (i + 1) * H, categoria: "feature" }));
    const lenta = itemM({ ref: "tr1/L", task_ref: "L", titulo: "Lenta", membro_id: "ana", estado_fluxo: "em_andamento", categoria: "feature", intervalos: [["2026-03-09T08:00:00.000Z", null]] });
    const d = gerarDaily({ ...base, itens: [...hist, lenta], rastro: [] });
    expect(d.membros.find((x) => x.membro_id === "ana")?.atrasos[0]?.texto).toMatch(/^Atrasada \(28 h em andamento\): Lenta/);
    const sem = gerarDaily({ ...base, itens: [...hist.slice(0, 5), lenta], rastro: [] });
    expect(sem.membros.find((x) => x.membro_id === "ana")?.atrasos ?? []).toEqual([]); // sem base não dispara
  });
  it("P-188: daily de uma sprint de 200 tasks em <= 100 ms", () => {
    const itens = Array.from({ length: 200 }, (_, i) => itemM({ ref: `tr1/T${i}`, task_ref: `T${i}`, membro_id: i % 2 ? "ana" : "bia", estado_fluxo: i % 3 ? "em_andamento" : "pronto", concluida_em: i % 5 === 0 ? "2026-03-09T10:00:00.000Z" : null, intervalos: [["2026-03-09T08:00:00.000Z", null]] }));
    const t0 = performance.now();
    gerarDaily({ ...base, itens, rastro: [] });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("review (T-18.27)", () => {
  function pronto() {
    const a = novoAgil();
    a.config.gravar("ws1", {});
    const d = { banco: a.banco, relogio: a.relogio, id: a.id };
    a.banco.itens.set("a", itemAgil({ id: "a", criterios: ["salva"] }));
    a.banco.itens.set("b", itemAgil({ id: "b" }));
    const s = criarSprint(d, { workspace_id: "ws1", nome: "S1", inicio: "2026-03-02", fim: "2026-03-13" });
    adicionarItem(d, s.id, "a"); adicionarItem(d, s.id, "b");
    iniciarSprint(d, s.id);
    a.banco.fatos.set("ws1|tr1|T-01.01", fato({ status_visto: "concluida", suite_final: "verde" }));
    const itens = [itemM({ item_id: "a", ref: "a", titulo: "A", concluida_em: "2026-03-05T00:00:00.000Z", pontos: 3 }), itemM({ item_id: "b", ref: "b", titulo: "B", concluida_em: null })];
    return { a, d, s, itens };
  }
  it("só itens concluídos da sprint; DoD e resultado da demo aparecem", () => {
    const { a, d, s, itens } = pronto();
    const r = montarReview(a.banco, a.config.ler("ws1"), s.id, itens, () => ({ qa_aprovado: true, regras_violadas_abertas: 0 }));
    expect(r.map((x) => x.item_id)).toEqual(["a"]);
    expect(r[0]).toMatchObject({ criterios: ["salva"], demo: null, commits: 0 });
    expect(r[0]?.dod.find((c) => c.criterio === "qa_aprovado")?.estado).toBe("ok");
    registrarDemo(d, s.id, "a", "ajustar", "mudar o texto");
    expect(montarReview(a.banco, a.config.ler("ws1"), s.id, itens, () => ({ qa_aprovado: true, regras_violadas_abertas: 0 }))[0]?.demo).toMatchObject({ resultado: "ajustar", nota: "mudar o texto" });
    expect(() => montarReview(a.banco, a.config.ler("ws1"), "nope", itens, () => ({ qa_aprovado: null, regras_violadas_abertas: null }))).toThrow(/sprint/);
  });
  it("resultado da demo é decisão humana; item fora da sprint e resultado inválido recusados", () => {
    const { d, s } = pronto();
    expect(() => registrarDemo(d, s.id, "a", "aceito", null, "agente")).toThrowError(expect.objectContaining({ subcode: "human_only" }));
    expect(() => registrarDemo(d, s.id, "a", "talvez" as never, null)).toThrow(/inválido/);
    expect(() => registrarDemo(d, s.id, "zzz", "aceito", null)).toThrow(/não está na sprint/);
  });
  it("ajustar/rejeitado pode devolver ao backlog (novo item, original intacto); aceito não", () => {
    const { a, d, s } = pronto();
    registrarDemo(d, s.id, "a", "aceito", null);
    expect(() => devolverAoBacklog(d, s.id, "a")).toThrow(/ajustar/);
    registrarDemo(d, s.id, "a", "rejeitado", "não atende");
    const novo = devolverAoBacklog(d, s.id, "a");
    expect(a.banco.itens.get(novo)).toMatchObject({ titulo: "Ajustar: Item", origem: "ade", estado_ade: "backlog", trabalho_id: null });
    expect(a.banco.itens.get("a")?.titulo).toBe("Item");
    expect(() => devolverAoBacklog(d, s.id, "b")).toThrow(/ajustar/);
  });
});

describe("retrospectiva (T-18.28)", () => {
  const entrada = (o = {}) => ({
    itens: [itemM({ ref: "tr1/A", titulo: "A", qa_reprovacoes: 3 }), itemM({ ref: "tr1/B", titulo: "B", qa_reprovacoes: 1 }), itemM({ ref: "tr1/C", titulo: "C", qa_reprovacoes: 0 })],
    eventos_por_ref: new Map([["tr1/A", 2], ["tr1/B", 5], ["tr1/C", 0]]),
    erros: [{ item_id: "i1", estimativa_id: "e", pontos_previstos: 3, categoria: "a", observado_ms: 1, real_h: null, ref_ms_por_ponto: 1, razao: 2, registrado_em: "" }, { item_id: "i2", estimativa_id: "e", pontos_previstos: 3, categoria: "a", observado_ms: 1, real_h: null, ref_ms_por_ponto: 1, razao: 1.1, registrado_em: "" }, { item_id: "i3", estimativa_id: "e", pontos_previstos: 3, categoria: "a", observado_ms: 1, real_h: null, ref_ms_por_ponto: 1, razao: 0.4, registrado_em: "" }, { item_id: "i4", estimativa_id: "e", pontos_previstos: 3, categoria: "a", observado_ms: 1, real_h: null, ref_ms_por_ponto: 1, razao: null, registrado_em: "" }],
    titulos: new Map([["tr1/A", "A"], ["tr1/B", "B"], ["i1", "Item 1"]]),
    wip_medio: 4.5, wip_limite: 3, bloqueios: [{ ref: "tr1/A", dias: 2 }, { ref: "tr1/B", dias: 9 }],
    ftr_sprint: 0.7, ftr_media_movel: 0.85,
    acoes_anteriores: [{ id: "x1", cerimonia_id: "c", texto: "Escrever teste antes", dono_membro_id: null, prazo: "2026-03-01", estado: "aberta" as const, item_id: null, concluida_em: null, criado_em: "", vencida_notificada: false }, { id: "x2", cerimonia_id: "c", texto: "Feita", dono_membro_id: null, prazo: null, estado: "feita" as const, item_id: null, concluida_em: "x", criado_em: "", vencida_notificada: false }, { id: "x3", cerimonia_id: "c", texto: "Futura", dono_membro_id: null, prazo: "2026-04-01", estado: "aberta" as const, item_id: null, concluida_em: null, criado_em: "", vencida_notificada: false }],
    hoje: "2026-03-10", agora: Date.parse("2026-03-10T12:00:00Z"), ...o,
  });
  it("insights determinísticos: top retrabalho, QA, maiores erros, WIP, bloqueios, FTR e ações não cumpridas", () => {
    const i = calcularInsights(entrada());
    expect(i.top_retrabalho).toEqual([{ ref: "tr1/B", titulo: "B", eventos: 5 }, { ref: "tr1/A", titulo: "A", eventos: 2 }]);
    expect(i.qa_reprovado).toEqual([{ ref: "tr1/A", titulo: "A", reprovacoes: 3 }, { ref: "tr1/B", titulo: "B", reprovacoes: 1 }]);
    expect(i.maiores_erros.map((x) => [x.item_id, x.razao])).toEqual([["i1", 2], ["i3", 0.4], ["i2", 1.1]]); // |razão − 1| decrescente: 1, 0,6, 0,1
    expect(i.maiores_erros[0]?.titulo).toBe("Item 1");
    expect(i.wip).toEqual({ medio: 4.5, limite: 3, acima: true });
    expect(i.bloqueios_longos).toEqual([{ ref: "tr1/B", dias: 9 }, { ref: "tr1/A", dias: 2 }]);
    expect(i.ftr).toEqual({ sprint: 0.7, media_movel: 0.85, abaixo: true });
    expect(i.acoes_nao_cumpridas).toEqual([{ id: "x1", texto: "Escrever teste antes", prazo: "2026-03-01", vencida: true }, { id: "x3", texto: "Futura", prazo: "2026-04-01", vencida: false }]);
    expect(calcularInsights(entrada())).toEqual(i); // determinístico
  });
  it("sem dados: tudo vazio/null (não inventa)", () => {
    const i = calcularInsights(entrada({ itens: [], eventos_por_ref: new Map(), erros: [], bloqueios: [], wip_medio: null, wip_limite: null, ftr_sprint: null, ftr_media_movel: null, acoes_anteriores: [] }));
    expect(i).toMatchObject({ top_retrabalho: [], qa_reprovado: [], atrasos: [], maiores_erros: [], bloqueios_longos: [], acoes_nao_cumpridas: [], wip: { acima: null }, ftr: { abaixo: null } });
  });
  function retro() {
    const a = novoAgil();
    const recebidos: string[] = [];
    const pub = criarPublicador(a.banco, { publicar: (e) => { recebidos.push(`${e.tipo}:${e.dados["acao_id"] ?? ""}`); } });
    const d = { banco: a.banco, relogio: a.relogio, id: a.id, pub };
    const c = criarRetro(d, { workspace_id: "ws1", sprint_id: "s1", insights: null, data: "2026-03-13" });
    return { a, d, c, recebidos };
  }
  it("formatos começar/parar/continuar (padrão) e 4Ls; itens com votos e coluna validada", () => {
    expect(COLUNAS.comecar_parar_continuar).toEqual(["comecar", "parar", "continuar"]);
    expect(COLUNAS["4ls"]).toEqual(["gostei", "aprendi", "faltou", "desejei"]);
    const { a, d, c } = retro();
    expect((c.conteudo as { colunas: string[] }).colunas).toEqual(["comecar", "parar", "continuar"]);
    const quatro = criarRetro(d, { workspace_id: "ws1", sprint_id: null, formato: "4ls", insights: null, data: "2026-03-13" });
    expect((quatro.conteudo as { colunas: string[] }).colunas).toHaveLength(4);
    expect(() => criarRetro(d, { workspace_id: "ws1", sprint_id: null, formato: "x" as never, insights: null, data: "d" })).toThrow(/formato/);
    const it = adicionarItemRetro(d, c.id, "parar", "Reuniões longas");
    expect(votarRetro(d, it.id).votos).toBe(1);
    expect(votarRetro(d, it.id).votos).toBe(2);
    expect(votarRetro(d, it.id, -1).votos).toBe(1);
    expect(votarRetro(d, votarRetro(d, it.id, -1).id, -1).votos).toBe(0); // nunca negativo
    expect(() => adicionarItemRetro(d, c.id, "gostei", "x")).toThrow(/coluna/);
    expect(() => adicionarItemRetro(d, c.id, "parar", " ")).toThrow(/texto/);
    expect(() => adicionarItemRetro(d, "nope", "parar", "x")).toThrow(/retro/);
    expect(a.banco.cerimonias.get(c.id)?.editada).toBe(true);
  });
  it("ação: dono/prazo/estado; vira item origem 'retro' UMA vez", () => {
    const { a, d, c } = retro();
    const ac = criarAcao(d, c.id, "Escrever teste antes do código", "m1", "2026-03-20");
    expect(() => criarAcao(d, c.id, "x", null, "20/03")).toThrow(/prazo/);
    expect(() => criarAcao(d, c.id, " ", null, null)).toThrow(/texto/);
    const item = acaoParaItem(d, ac.id);
    expect(item).toMatchObject({ origem: "retro", titulo: "Escrever teste antes do código", workspace_id: "ws1", estado_ade: "backlog" });
    expect(a.banco.retroAcoes.get(ac.id)?.item_id).toBe(item.id);
    expect(() => acaoParaItem(d, ac.id)).toThrow(/já virou item/);
    expect(atualizarAcao(d, ac.id, "feita")).toMatchObject({ estado: "feita", concluida_em: expect.any(String) });
    expect(atualizarAcao(d, ac.id, "aberta").concluida_em).toBeNull();
  });
  it("acao_retro.vencida publicada UMA vez; feita/cancelada/sem prazo/no prazo não", () => {
    const { d, c, recebidos } = retro();
    const vencida = criarAcao(d, c.id, "vencida", null, "2026-03-01");
    criarAcao(d, c.id, "no prazo", null, "2026-03-30");
    criarAcao(d, c.id, "sem prazo", null, null);
    const feita = criarAcao(d, c.id, "feita", null, "2026-03-01");
    atualizarAcao(d, feita.id, "feita");
    expect(publicarAcoesVencidas(d, "ws1", "2026-03-10").map((x) => x.id)).toEqual([vencida.id]);
    expect(publicarAcoesVencidas(d, "ws1", "2026-03-11")).toEqual([]);
    expect(recebidos).toEqual([`acao_retro.vencida:${vencida.id}`]);
    expect(publicarAcoesVencidas(d, "outro", "2026-03-10")).toEqual([]);
  });
});
