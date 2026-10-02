import { describe, expect, it } from "vitest";
import { indice, tk, trabalho } from "../metodo/fabrica";
import { chipDoTrabalho, estadoPortfolio, estagioPortfolio, filtrarTrabalhos, formatarRelativo, miniRastro, progressoTasks, raioDoTrabalho, resumoPortfolio, tipoPortfolio } from "./portfolio";

const t = (o: Parameters<typeof trabalho>[1], tasks = [tk("T-1")]) => trabalho(tasks, o);

describe("estagioPortfolio: colunas derivadas só do que o índice já tem", () => {
  it("concluído é Entregue; pedido do prodx é Ideia; planejamento é Planejado", () => {
    expect(estagioPortfolio(t({ status: "concluido" }))).toBe("entregue");
    expect(estagioPortfolio(t({ ferramenta: "prodx", tipo: "pedido", estagio: "p2" }))).toBe("ideia");
    expect(estagioPortfolio(t({ estagio: "f3" }))).toBe("planejado");
    expect(estagioPortfolio(t({ estagio: "e2" }))).toBe("planejado");
  });
  it("execução e validação seguem o estágio; f6 com todas as tasks feitas já valida", () => {
    expect(estagioPortfolio(t({ estagio: "f6" }, [tk("T-1", { status: "concluida" }), tk("T-2")]))).toBe("execucao");
    expect(estagioPortfolio(t({ estagio: "e3" }))).toBe("execucao");
    expect(estagioPortfolio(t({ estagio: "e4" }))).toBe("validando");
    expect(estagioPortfolio(t({ estagio: "f6" }, [tk("T-1", { status: "concluida" }), tk("T-2", { status: "concluida" })]))).toBe("validando");
  });
});

describe("estadoPortfolio e resumo (batem com o índice)", () => {
  const lote = [
    t({ id: "a", status: "em_andamento" }),
    t({ id: "b", status: "em_andamento", decisoes_pendentes: 1 }),
    t({ id: "c", status: "bloqueado" }),
    t({ id: "d", status: "concluido" }),
    t({ id: "e", status: "concluido" }),
    t({ id: "f", status: "nao_iniciado" }),
  ];
  it("cada trabalho cai em exatamente um estado", () => {
    expect(lote.map(estadoPortfolio)).toEqual(["andamento", "aguardando", "bloqueado", "entregue", "entregue", "nao_iniciado"]);
  });
  it("resumo soma o que está no índice", () => {
    const r = resumoPortfolio(indice(lote).trabalhos);
    expect(r).toEqual({ total: 6, andamento: 1, aguardando: 1, bloqueado: 1, entregue: 2, nao_iniciado: 1 });
  });
});

describe("filtros, progresso e tempo", () => {
  const lote = [
    t({ id: "a", titulo: "Exportar PDF", tipo: "feature", status: "em_andamento" }),
    t({ id: "b", titulo: "Botão Salvar", tipo: "ocorrencia", status: "concluido" }),
    t({ id: "c", titulo: "Sistema novo", tipo: "projeto", status: "bloqueado" }),
  ];
  it("filtra por estado, tipo e busca (sem acento, sem caixa)", () => {
    expect(filtrarTrabalhos(lote, { estado: "todos", tipo: "todos", busca: "" })).toHaveLength(3);
    expect(filtrarTrabalhos(lote, { estado: "entregue", tipo: "todos", busca: "" }).map((x) => x.id)).toEqual(["b"]);
    expect(filtrarTrabalhos(lote, { estado: "todos", tipo: "projeto", busca: "" }).map((x) => x.id)).toEqual(["c"]);
    expect(filtrarTrabalhos(lote, { estado: "todos", tipo: "todos", busca: "botao" }).map((x) => x.id)).toEqual(["b"]);
    expect(filtrarTrabalhos(lote, { estado: "bloqueado", tipo: "feature", busca: "" })).toEqual([]);
  });
  it("tipo legível e progresso", () => {
    expect(tipoPortfolio(lote[1]!)).toEqual({ id: "ocorrencia", rotulo: "Bug", gesto: "nova_ocorrencia" });
    expect(progressoTasks(t({}, [tk("A", { status: "concluida" }), tk("B"), tk("C")]))).toEqual({ feitas: 1, total: 3, pct: 33 });
    expect(progressoTasks(t({}, []))).toEqual({ feitas: 0, total: 0, pct: 0 });
  });
  it("tempo relativo curto e honesto", () => {
    const agora = Date.parse("2026-10-01T12:00:00Z");
    expect(formatarRelativo(null, agora)).toBe("sem atividade");
    expect(formatarRelativo("2026-10-01T11:59:40Z", agora)).toBe("agora");
    expect(formatarRelativo("2026-10-01T11:10:00Z", agora)).toBe("há 50 min");
    expect(formatarRelativo("2026-10-01T07:00:00Z", agora)).toBe("há 5 h");
    expect(formatarRelativo("2026-09-28T12:00:00Z", agora)).toBe("há 3 d");
    expect(formatarRelativo("lixo", agora)).toBe("sem atividade");
  });
});

describe("chip, raio e mini-rastro", () => {
  it("bloqueado tem rótulo próprio; o resto segue a fase legível", () => {
    expect(chipDoTrabalho(t({ status: "bloqueado" }))).toEqual({ rotulo: "Bloqueado", fase: "bloqueado" });
    expect(chipDoTrabalho(t({ estagio: "f6", status: "em_andamento" }))).toEqual({ rotulo: "Executando", fase: "executando" });
    expect(chipDoTrabalho(t({ status: "concluido" })).fase).toBe("concluido");
  });
  it("raio só aparece quando existe; ALTO sem aprovação é alerta", () => {
    expect(raioDoTrabalho(t({}))).toBeNull();
    expect(raioDoTrabalho(t({ raio: { faixa: "alto", aprovado: false } }))).toEqual({ rotulo: "Raio ALTO", alerta: true });
    expect(raioDoTrabalho(t({ raio: { faixa: "alto", aprovado: true } }))).toEqual({ rotulo: "Raio ALTO aprovado", alerta: false });
  });
  it("mini-rastro: um segmento por task e contagem; agrupa acima de 24", () => {
    const m = miniRastro(t({}, [tk("A", { status: "concluida" }), tk("B", { status: "em_andamento" }), tk("C", { status: "bloqueada" }), tk("D")]));
    expect(m.segmentos).toEqual(["concluida", "em_andamento", "bloqueada", "pendente"]);
    expect(m.contagem).toEqual({ concluida: 1, em_andamento: 1, bloqueada: 1, pendente: 1 });
    const muitas = Array.from({ length: 100 }, (_, i) => tk(`T-${i}`, { status: i < 50 ? "concluida" : "pendente" }));
    const g = miniRastro(t({}, muitas));
    expect(g.segmentos.length).toBeLessThanOrEqual(24);
    expect(g.total).toBe(100);
    expect(g.segmentos[0]).toBe("concluida");
    expect(g.segmentos.at(-1)).toBe("pendente");
  });
});
