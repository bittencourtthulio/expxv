import { describe, expect, it } from "vitest";
import { ev, tk, trab } from "../../../tests/fixtures/metodo/construtores";
import { cfg, itemAgil, itemM, novoAgil } from "../../../tests/fixtures/agil/ajudas";
import { adicionarItem, atualizarSprint, cancelarSprint, criarSprint, iniciarSprint, itensDaSprint, removerItem } from "./sprint/ciclo";
import { capacidadeMembro, capacidadeTotal } from "./sprint/capacidade";
import { avisosDoCompromisso, candidatosDoBacklog, sugerirCompromisso, type CandidatoPlanejamento } from "./sprint/planejamento";
import { deveFecharAutomaticamente, fecharSprint, sugerirFechar } from "./sprint/fechar";
import { proporEstimativa } from "./estimativa/revisao";
import { criarPublicador, publicadorNulo } from "./eventos";
import { sincronizar } from "./fatos/sincronizar";
import type { MembroAgil } from "../../compartilhado/agil";
import type { FonteTrabalho } from "./portas";

function mundo() {
  const a = novoAgil();
  a.config.gravar("ws1", {});
  const recebidos: string[] = [];
  const pub = criarPublicador(a.banco, { publicar: (e) => { recebidos.push(e.tipo); } });
  const d = { banco: a.banco, relogio: a.relogio, id: a.id, pub };
  const item = (id: string, pontos: number | null) => {
    a.banco.itens.set(id, itemAgil({ id }));
    if (pontos !== null) proporEstimativa({ banco: a.banco, relogio: a.relogio, id: a.id, config: a.config.ler("ws1") }, { item_id: id, pontos, origem: "ia", motor: "manual", confianca: 1, fatores: [], min_h: null, max_h: null, nota: null });
  };
  return { a, d, pub, recebidos, item };
}
const nova = (d: ReturnType<typeof mundo>["d"], o: object = {}) => criarSprint(d, { workspace_id: "ws1", nome: "S1", inicio: "2026-03-02", fim: "2026-03-13", ...o });

describe("ciclo de vida da sprint (T-18.24)", () => {
  it("valida datas e nome", () => {
    const { d } = mundo();
    expect(() => criarSprint(d, { workspace_id: "ws1", nome: " ", inicio: "2026-03-02", fim: "2026-03-13" })).toThrow(/nome/);
    expect(() => criarSprint(d, { workspace_id: "ws1", nome: "x", inicio: "2026-03-13", fim: "2026-03-02" })).toThrow(/datas/);
    expect(() => criarSprint(d, { workspace_id: "ws1", nome: "x", inicio: "03/02", fim: "2026-03-13" })).toThrow(/datas/);
  });
  it("iniciar CONGELA o compromisso inicial (soma dos pontos) e publica sprint.iniciada", () => {
    const { d, item, recebidos, a } = mundo();
    item("a", 5); item("b", 3); item("c", null);
    const s = nova(d);
    for (const i of ["a", "b", "c"]) adicionarItem(d, s.id, i);
    const ativa = iniciarSprint(d, s.id);
    expect(ativa).toMatchObject({ estado: "ativa", compromisso_pontos: 8 });
    expect(recebidos).toEqual(["sprint.iniciada"]);
    // adicionar depois NÃO muda o compromisso inicial e exige motivo
    item("d", 13);
    expect(() => adicionarItem(d, s.id, "d")).toThrow(/motivo/);
    const x = adicionarItem(d, s.id, "d", "cliente pediu");
    expect(x).toMatchObject({ no_compromisso_inicial: false, pontos_compromisso: 13 });
    expect(a.banco.sprints.get(s.id)?.compromisso_pontos).toBe(8);
    expect(itensDaSprint(a.banco, s.id).filter((i) => i.no_compromisso_inicial)).toHaveLength(3);
  });
  it("não inicia duas sprints ativas no workspace; só planejada inicia; agente não inicia", () => {
    const { d } = mundo();
    const s1 = nova(d); const s2 = nova(d, { nome: "S2", inicio: "2026-03-16", fim: "2026-03-27" });
    iniciarSprint(d, s1.id);
    expect(() => iniciarSprint(d, s2.id)).toThrow(/já existe uma sprint ativa/);
    expect(() => iniciarSprint(d, s1.id)).toThrow(/ativa não pode/);
    cancelarSprint(d, s1.id);
    expect(iniciarSprint(d, s2.id).estado).toBe("ativa");
    expect(() => iniciarSprint(d, s2.id, "agente")).toThrowError(expect.objectContaining({ subcode: "human_only" }));
    expect(() => cancelarSprint(d, s2.id, "agente")).toThrowError(expect.objectContaining({ subcode: "human_only" }));
  });
  it("remover mantém o histórico (removido_em) e exige motivo na ativa; item em duas sprints abertas é recusado", () => {
    const { d, item, a } = mundo();
    item("a", 5);
    const s1 = nova(d); const s2 = nova(d, { nome: "S2", inicio: "2026-03-16", fim: "2026-03-27" });
    adicionarItem(d, s1.id, "a");
    expect(() => adicionarItem(d, s2.id, "a")).toThrow(/já está na sprint/);
    iniciarSprint(d, s1.id);
    expect(() => removerItem(d, s1.id, "a")).toThrow(/motivo/);
    const r = removerItem(d, s1.id, "a", "bloqueado pelo cliente");
    expect(r.removido_em).not.toBeNull();
    expect(a.banco.sprintItens.valores()).toHaveLength(1); // histórico preservado
    expect(() => removerItem(d, s1.id, "a", "de novo")).toThrow(/não está na sprint/);
    expect(adicionarItem(d, s2.id, "a").sprint_id).toBe(s2.id); // saiu da s1: pode ir para a s2
  });
  it("sprint encerrada e item descartado não aceitam mudanças; início de ativa é imutável", () => {
    const { d, item } = mundo();
    item("a", 5);
    const s = nova(d);
    iniciarSprint(d, s.id);
    expect(() => atualizarSprint(d, s.id, { inicio: "2026-03-03" })).toThrow(/imutável/);
    expect(atualizarSprint(d, s.id, { fim: "2026-03-14" }).fim).toBe("2026-03-14");
    cancelarSprint(d, s.id);
    expect(() => atualizarSprint(d, s.id, { nome: "x" })).toThrow(/encerrada/);
    expect(() => adicionarItem(d, s.id, "a")).toThrow(/encerrada/);
    const s2 = nova(d, { nome: "S2" });
    d.banco.itens.set("z", itemAgil({ id: "z", estado_ade: "descartado" }));
    expect(() => adicionarItem(d, s2.id, "z")).toThrow(/descartado/);
    expect(() => adicionarItem(d, "nope", "a")).toThrow(/sprint/);
  });
});

describe("capacidade (T-18.25)", () => {
  const m = (o: Partial<MembroAgil> = {}): MembroAgil => ({ id: "m", workspace_id: "ws1", tipo: "humano", rotulo: "Ana", squad_id: null, horas_dia: 6, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [], ...o });
  const p = (o: object = {}) => ({ dias_uteis: 10, ausencias_dias: 0, horas_por_ponto: 4, ultimas_velocidades: [] as number[], config: cfg(), ...o });
  it("humano: horas_dia × (dias − ausências) × foco ÷ horas por ponto", () => {
    expect(capacidadeMembro(m(), p())).toMatchObject({ pontos: 9, base: "horas" }); // 6×10×0,6/4
    expect(capacidadeMembro(m(), p({ ausencias_dias: 2 }))).toMatchObject({ pontos: 7.2 }); // 6×8×0,6/4
    expect(capacidadeMembro(m({ horas_dia: null }), p())).toMatchObject({ pontos: 9 }); // padrão da config (6 h)
  });
  it("sem calibração => sem_base, null e aviso (nunca 0)", () => {
    expect(capacidadeMembro(m(), p({ horas_por_ponto: null }))).toMatchObject({ pontos: null, base: "sem_base", aviso: expect.stringMatching(/sem calibração/) });
  });
  it("agente: fixo, ou mediana das 3 últimas velocidades, ou sem base", () => {
    const ag = m({ tipo: "agente", rotulo: "Agente" });
    expect(capacidadeMembro(ag, p({ ultimas_velocidades: [99, 10, 20, 12] }))).toMatchObject({ pontos: 12, base: "mediana_3" }); // [10,20,12] => 12
    expect(capacidadeMembro(ag, p({ ultimas_velocidades: [10, 20, 12], ausencias_dias: 5 }))).toMatchObject({ pontos: 6 });
    expect(capacidadeMembro({ ...ag, pontos_sprint_fixo: 15 }, p())).toMatchObject({ pontos: 15, base: "fixo" });
    expect(capacidadeMembro(ag, p())).toMatchObject({ pontos: null, base: "sem_base" });
  });
  it("total ignora os sem base e os lista", () => {
    const cs = [capacidadeMembro(m(), p()), capacidadeMembro(m({ id: "x" }), p({ horas_por_ponto: null }))];
    expect(capacidadeTotal(cs)).toEqual({ pontos: 9, sem_base: ["x"] });
    expect(capacidadeTotal([])).toEqual({ pontos: null, sem_base: [] });
  });
});

describe("planejamento sugerido (T-18.25)", () => {
  const c = (item_id: string, ordem: number, pontos: number | null, o: Partial<CandidatoPlanejamento> = {}): CandidatoPlanejamento => ({ item_id, titulo: item_id, ordem, pontos, risco: null, depende_de: [], concluido: false, ...o });
  const conf = { buffer_planejamento: 0.2, limiares_saude: cfg().limiares_saude };
  it("guloso pela ordem até capacidade × (1 − buffer); pula o que não cabe e segue", () => {
    const r = sugerirCompromisso({ candidatos: [c("a", 1, 5), c("b", 2, 8), c("c", 3, 3), c("d", 4, 2)], concluidos: new Set(), capacidade: 15, config: conf });
    expect(r).toMatchObject({ itens: ["a", "c", "d"], pontos: 10, limite: 12 }); // 5; 5+8=13>12 pula; 5+3=8; 8+2=10
    expect(r.avisos).toEqual([]);
  });
  it("respeita depende_de (puxa depois da dependência, mesmo fora de ordem) e avisa dependência fora da sprint", () => {
    const r = sugerirCompromisso({ candidatos: [c("b", 1, 3, { depende_de: ["a"] }), c("a", 2, 3)], concluidos: new Set(), capacidade: 20, config: conf });
    expect(r.itens).toEqual(["b", "a"]);
    const sem = sugerirCompromisso({ candidatos: [c("b", 1, 3, { depende_de: ["a"] })], concluidos: new Set(), capacidade: 20, config: conf });
    expect(sem.itens).toEqual([]);
    const ok = sugerirCompromisso({ candidatos: [c("b", 1, 3, { depende_de: ["a"] })], concluidos: new Set(["a"]), capacidade: 20, config: conf });
    expect(ok.itens).toEqual(["b"]);
    const apertado = sugerirCompromisso({ candidatos: [c("a", 1, 8), c("b", 2, 3, { depende_de: ["a"] })], concluidos: new Set(), capacidade: 10, config: conf }); // limite 8: só cabe a
    expect(apertado.itens).toEqual(["a"]);
  });
  it("avisa (não bloqueia): sem estimativa, capacidade sem base, risco crítico demais", () => {
    expect(sugerirCompromisso({ candidatos: [c("a", 1, null), c("b", 2, 3)], concluidos: new Set(), capacidade: 10, config: conf }).avisos).toEqual([{ tipo: "sem_estimativa", itens: ["a"] }]);
    const sb = sugerirCompromisso({ candidatos: [c("a", 1, 3)], concluidos: new Set(), capacidade: null, config: conf });
    expect(sb).toMatchObject({ itens: [], capacidade: null });
    expect(sb.avisos).toContainEqual({ tipo: "capacidade_sem_base" });
    const crit = sugerirCompromisso({ candidatos: [c("a", 1, 1, { risco: "critico" }), c("b", 2, 1, { risco: "critico" }), c("c", 3, 1, { risco: "critico" })], concluidos: new Set(), capacidade: 100, config: conf });
    expect(crit.avisos).toContainEqual({ tipo: "risco_critico_demais", n: 3, limite: 2 });
  });
  it("compromisso manual: excede capacidade avisa e NÃO impede", () => {
    const cs = [c("a", 1, 8), c("b", 2, 8, { depende_de: ["z"] })];
    const av = avisosDoCompromisso(cs, new Set(["a", "b"]), new Set(), 10, conf);
    expect(av).toContainEqual({ tipo: "excede_capacidade", pontos: 16, capacidade: 10 });
    expect(av).toContainEqual({ tipo: "dependencia_fora", item_id: "b", depende_de: "z" });
    expect(avisosDoCompromisso(cs, new Set(["a"]), new Set(), null, conf)).toContainEqual({ tipo: "capacidade_sem_base" });
  });
  it("candidatos do backlog: resolve depende_de em item_id e exclui concluídos/descartados/órfãos", () => {
    const itens = [itemM({ item_id: "1", ref: "tr1/T-01.01", task_ref: "T-01.01", estado_fluxo: "pronto" }), itemM({ item_id: "2", ref: "tr1/T-01.02", task_ref: "T-01.02", depende_de: ["T-01.01"], estado_fluxo: "backlog" }), itemM({ item_id: "3", ref: "x", task_ref: "T-09.03", estado_fluxo: "concluida" }), itemM({ item_id: "4", ref: "y", task_ref: "T-09.04", descartado: true }), itemM({ item_id: "5", ref: "z", task_ref: "T-09.05", orfao: true })];
    expect(candidatosDoBacklog(itens).map((x) => [x.item_id, x.depende_de])).toEqual([["1", []], ["2", ["1"]]]);
  });
  it("P-188: sugestão de 200 itens em <= 100 ms", () => {
    const cs = Array.from({ length: 200 }, (_, i) => c(`i${i}`, i, 1 + (i % 8), { depende_de: i % 3 === 0 && i > 0 ? [`i${i - 1}`] : [] }));
    const t0 = performance.now();
    sugerirCompromisso({ candidatos: cs, concluidos: new Set(), capacidade: 400, config: conf });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("fechar sprint (T-18.29)", () => {
  // trabalho com 3 tasks: T1 e T2 concluídas, T3 pendente
  async function cenario(destino: "backlog" | "proxima" | "descartar" = "backlog") {
    const w = mundo();
    const fonte = (): FonteTrabalho => ({ workspace_id: "ws1", trabalho: trab({ id: "tr1" }, [tk("T-01.01", { status: "concluida", concluida_em: "2026-03-04", suite: "verde" }), tk("T-01.02", { status: "concluida", concluida_em: "2026-03-05", suite: "verde" }), tk("T-01.03")]), rastro: [ev({ trabalho_id: "tr1", task: "T-01.01", evento: "task_iniciada", ts: "2026-03-04T08:00:00Z" }), ev({ trabalho_id: "tr1", task: "T-01.01", evento: "task_concluida", ts: "2026-03-04T10:00:00Z" })], commits: [], qa: null, versao_origem: "v" });
    await sincronizar({ banco: w.a.banco, metodo: w.a.portas.metodo, relogio: w.a.relogio, id: w.a.id, config: w.a.config.ler("ws1") }, "ws1", { fontes: [fonte()] });
    const ids = w.a.banco.itens.valores().sort((x, y) => (x.task_ref ?? "").localeCompare(y.task_ref ?? "")).map((i) => i.id);
    ids.forEach((id, i) => proporEstimativa({ banco: w.a.banco, relogio: w.a.relogio, id: w.a.id, config: w.a.config.ler("ws1") }, { item_id: id, pontos: [3, 5, 8][i] as number, origem: "ia", motor: "manual", confianca: 1, fatores: [], min_h: null, max_h: null, nota: null }));
    const s = nova(w.d);
    ids.forEach((id) => adicionarItem(w.d, s.id, id));
    iniciarSprint(w.d, s.id);
    const dep = { banco: w.a.banco, relogio: w.a.relogio, config: w.a.config.ler("ws1"), pub: w.pub };
    return { ...w, ids, s, dep, fechar: () => fecharSprint(dep, { sprint_id: s.id, destino_pendentes: destino, ator: "humano", versao_lancamento: "1.2.0" }) };
  }
  it("fecha: resultado por item, resumo, snapshot final, versão de lançamento e UM evento sprint.fechada", async () => {
    const c = await cenario();
    expect(sugerirFechar(c.a.banco, c.s.id)).toBe(false); // T3 ainda pendente
    const r = c.fechar();
    expect(r.ja_fechada).toBe(false);
    expect(r.resumo).toMatchObject({ compromisso_inicial: 16, concluido_pontos: 8, concluidos: 2, carregados: 0, devolvidos: 1, descartados: 0, sem_estimativa: 0, destino_pendentes: "backlog" });
    expect(c.a.banco.sprints.get(c.s.id)).toMatchObject({ estado: "fechada", versao_lancamento: "1.2.0" });
    expect(itensDaSprint(c.a.banco, c.s.id).map((x) => x.resultado).sort()).toEqual(["concluido", "concluido", "devolvido"]);
    expect(c.a.banco.snapshots.valores().filter((x) => x.escopo === "sprint" && x.chave === c.s.id).map((x) => x.metrica)).toContain("concluido");
    expect(c.recebidos.filter((t) => t === "sprint.fechada")).toHaveLength(1);
    const ev = c.a.banco.eventos.valores().find((e) => e.tipo === "sprint.fechada");
    expect(ev?.dados).toMatchObject({ versao_lancamento: "1.2.0" });
    expect(ev?.tokens).toBeNull();
    expect(ev?.pontos).toBe(8);
  });
  it("idempotente: fechar duas vezes não duplica evento nem refaz", async () => {
    const c = await cenario();
    const a = c.fechar();
    const b = c.fechar();
    expect(b.ja_fechada).toBe(true);
    expect(b.resumo).toEqual(a.resumo);
    expect(c.recebidos.filter((t) => t === "sprint.fechada")).toHaveLength(1);
  });
  it("destino próxima: pendentes carregados para a próxima sprint; sem próxima, recusa ANTES de mexer em qualquer coisa", async () => {
    const c = await cenario("proxima");
    const antes = JSON.stringify([c.a.banco.sprints.valores(), c.a.banco.sprintItens.valores()]);
    expect(() => c.fechar()).toThrow(/próxima sprint/);
    expect(JSON.stringify([c.a.banco.sprints.valores(), c.a.banco.sprintItens.valores()])).toBe(antes); // atômico
    const prox = criarSprint(c.d, { workspace_id: "ws1", nome: "S2", inicio: "2026-03-16", fim: "2026-03-27" });
    const r = c.fechar();
    expect(r.resumo).toMatchObject({ carregados: 1, devolvidos: 0 });
    const carregado = itensDaSprint(c.a.banco, prox.id);
    expect(carregado).toHaveLength(1);
    expect(carregado[0]).toMatchObject({ no_compromisso_inicial: true, pontos_compromisso: 8 });
  });
  it("destino descartar: pendentes viram descartados (motivo registrado)", async () => {
    const c = await cenario("descartar");
    const r = c.fechar();
    expect(r.resumo.descartados).toBe(1);
    const d = c.a.banco.itens.valores().find((i) => i.task_ref === "T-01.03");
    expect(d).toMatchObject({ estado_ade: "descartado" });
    expect(d?.descartado_motivo).toMatch(/descartado no fechamento/);
  });
  it("atomicidade: falha no meio não deixa metade (rollback completo)", async () => {
    const c = await cenario();
    const original = c.a.banco.sprintItens.set.bind(c.a.banco.sprintItens);
    let n = 0;
    c.a.banco.sprintItens.set = (k, v) => { if (++n === 2) throw new Error("disco cheio"); original(k, v); };
    const antes = JSON.stringify([c.a.banco.sprints.valores(), c.a.banco.sprintItens.valores(), c.a.banco.snapshots.valores()]);
    expect(() => c.fechar()).toThrow(/disco cheio/);
    c.a.banco.sprintItens.set = original;
    expect(JSON.stringify([c.a.banco.sprints.valores(), c.a.banco.sprintItens.valores(), c.a.banco.snapshots.valores()])).toBe(antes);
    expect(c.recebidos.filter((t) => t === "sprint.fechada")).toHaveLength(0);
    expect(c.fechar().ja_fechada).toBe(false); // e dá para tentar de novo
  });
  it("ação humana: agente recebe human_only; só sprint ativa fecha; destino inválido recusado", async () => {
    const c = await cenario();
    expect(() => fecharSprint(c.dep, { sprint_id: c.s.id, destino_pendentes: "backlog", ator: "agente" })).toThrowError(expect.objectContaining({ subcode: "human_only" }));
    expect(() => fecharSprint(c.dep, { sprint_id: c.s.id, destino_pendentes: "x" as never, ator: "humano" })).toThrow(/destino/);
    const outra = nova(c.d, { nome: "Planejada", inicio: "2026-04-06", fim: "2026-04-17" });
    expect(() => fecharSprint(c.dep, { sprint_id: outra.id, destino_pendentes: "backlog", ator: "humano" })).toThrow(/não pode ser fechada/);
    expect(() => fecharSprint(c.dep, { sprint_id: "nope", destino_pendentes: "backlog", ator: "humano" })).toThrow(/sprint/);
  });
  it("sugere fechar quando tudo está concluído; automático só com opt-in e QA aprovado (validada)", async () => {
    const w = mundo();
    const fonte = (qa: "aprovado" | null): FonteTrabalho => ({ workspace_id: "ws1", trabalho: trab({ id: "tr1", veredito_qa: qa }, [tk("T-01.01", { status: "concluida", concluida_em: "2026-03-04", suite: "verde" })]), rastro: [], commits: [], qa: null, versao_origem: `v${qa}` });
    const sync = (f: FonteTrabalho) => sincronizar({ banco: w.a.banco, metodo: w.a.portas.metodo, relogio: w.a.relogio, id: w.a.id, config: w.a.config.ler("ws1") }, "ws1", { fontes: [f] });
    await sync(fonte(null));
    const id = [...w.a.banco.itens.valores()][0]?.id as string;
    const s = nova(w.d);
    adicionarItem(w.d, s.id, id);
    iniciarSprint(w.d, s.id);
    expect(sugerirFechar(w.a.banco, s.id)).toBe(true);
    expect(deveFecharAutomaticamente(w.a.banco, { fechar_automatico: false }, s.id)).toBe(false); // desligado por padrão
    expect(deveFecharAutomaticamente(w.a.banco, { fechar_automatico: true }, s.id)).toBe(false); // sem QA aprovado
    await sync({ ...fonte("aprovado"), trabalho: trab({ id: "tr1", veredito_qa: "aprovado", ultima_atividade: "2026-03-05T00:00:00Z" }, [tk("T-01.01", { status: "concluida", concluida_em: "2026-03-04", suite: "verde" })]) });
    expect(deveFecharAutomaticamente(w.a.banco, { fechar_automatico: true }, s.id)).toBe(true);
    expect(publicadorNulo.publicar).toBeTypeOf("function");
  });
});
