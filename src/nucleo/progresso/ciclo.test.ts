// Máquina de ciclo de vida: abre ao iniciar, fecha 2 s após tudo concluído, NÃO fecha em falha/aguardando, fixar, dispensar, feature desligada, vários progressos, troca de workspace.
import { describe, expect, it } from "vitest";
import { ANIMACAO_FECHAR_MS, LEITURA_MS, RESUMO_MS, type EstadoItemProgresso, type Progresso, type ResultadoProgresso } from "../../compartilhado/progresso";
import { CICLO_INICIAL, indicadorDoWorkspace, proximoPrazo, reduzir, visiveis, type EstadoCiclo, type EventoCiclo, type EfeitoToast } from "./ciclo";
import { contagem, formatarDuracao, itemAtual, resumoDoProgresso } from "./formato";

function prog(id: string, resultado: ResultadoProgresso, estados: EstadoItemProgresso[], extra: Partial<Progresso> = {}): Progresso {
  return {
    id, origem: "maestro", titulo: "Pipeline: nova feature", workspace_id: "ws_1", resultado, concluido: resultado === "concluido", previsto: false, iniciado_em: 1_000, fim_em: resultado === "em_andamento" ? null : 241_000,
    itens: estados.map((estado, i) => ({ id: `e${i}`, rotulo: `Etapa ${i + 1}`, estado })), ...extra,
  };
}
const EM = prog("pl:a", "em_andamento", ["concluido", "em_andamento", "pendente"]);
const FIM = prog("pl:a", "concluido", ["concluido", "concluido", "concluido"]);

class Maq {
  estado: EstadoCiclo = { ...CICLO_INICIAL, workspace_id: "ws_1" };
  efeitos: EfeitoToast[] = [];
  d(ev: EventoCiclo): this {
    const r = reduzir(this.estado, ev);
    this.estado = r.estado;
    this.efeitos.push(...r.efeitos);
    return this;
  }
  estadoAgora(progressos: Progresso[], agora: number): this { return this.d({ tipo: "estado", progressos, agora }); }
  tick(agora: number): this { return this.d({ tipo: "tick", agora }); }
  fase(id = "pl:a"): string | undefined { return this.estado.itens[id]?.fase; }
  ids(): string[] { return visiveis(this.estado).map((c) => c.progresso.id); }
}

describe("abrir e acompanhar", () => {
  it("abre quando o progresso passa a em andamento e fica fixo enquanto executa", () => {
    const m = new Maq();
    expect(m.ids()).toEqual([]);
    m.estadoAgora([EM], 10);
    expect(m.fase()).toBe("ativo");
    expect(m.ids()).toEqual(["pl:a"]);
    m.estadoAgora([prog("pl:a", "em_andamento", ["concluido", "concluido", "em_andamento"])], 5_000).tick(60_000);
    expect(m.fase()).toBe("ativo");
    expect(proximoPrazo(m.estado)).toBeNull();
  });
  it("aguardando humano abre e fica; nunca fecha sozinho", () => {
    const m = new Maq().estadoAgora([prog("pl:a", "aguardando", ["concluido", "aguardando", "pendente"])], 10).tick(10 * 60_000);
    expect(m.fase()).toBe("ativo");
    expect(m.efeitos).toEqual([]);
  });
  it("progresso cancelado visto pela primeira vez não abre nada", () => {
    expect(new Maq().estadoAgora([prog("pl:a", "cancelado", ["concluido", "pendente"])], 10).ids()).toEqual([]);
  });
});

describe("concluir e fechar", () => {
  it("tudo concluído: resumo por 2 s, anima, fecha e deixa o toast 'Ver resumo'", () => {
    const m = new Maq().estadoAgora([EM], 0).estadoAgora([FIM], 1_000);
    expect(m.fase()).toBe("resumo");
    expect(proximoPrazo(m.estado)).toBe(1_000 + RESUMO_MS);
    m.tick(1_000 + RESUMO_MS - 1);
    expect(m.fase()).toBe("resumo");
    m.tick(1_000 + RESUMO_MS);
    expect(m.fase()).toBe("fechando");
    expect(m.ids()).toEqual(["pl:a"]); // ainda no ar durante a animação
    m.tick(1_000 + RESUMO_MS + ANIMACAO_FECHAR_MS);
    expect(m.fase()).toBe("oculto");
    expect(m.ids()).toEqual([]);
    expect(m.efeitos).toEqual([{ tipo: "toast", id: "pl:a", texto: "Pipeline: nova feature · Concluído: 3/3 em 4 min" }]);
    expect(proximoPrazo(m.estado)).toBeNull();
  });
  it("'Ver resumo' reabre em leitura por 10 s e fecha sem novo toast", () => {
    const m = new Maq().estadoAgora([EM], 0).estadoAgora([FIM], 1_000).tick(3_000).tick(3_200);
    m.efeitos = [];
    m.d({ tipo: "ver_resumo", id: "pl:a", agora: 4_000 });
    expect(m.fase()).toBe("leitura");
    expect(m.ids()).toEqual(["pl:a"]);
    m.tick(4_000 + LEITURA_MS).tick(4_000 + LEITURA_MS + ANIMACAO_FECHAR_MS);
    expect(m.fase()).toBe("oculto");
    expect(m.efeitos).toEqual([]);
  });
  it("falha NÃO fecha sozinha: fica até o dono dispensar, e volta a ativo se a etapa for reaberta", () => {
    const falho = prog("pl:a", "falhou", ["concluido", "falhou", "pendente"]);
    const m = new Maq().estadoAgora([EM], 0).estadoAgora([falho], 100).tick(600_000);
    expect(m.fase()).toBe("falha");
    expect(m.ids()).toEqual(["pl:a"]);
    m.estadoAgora([prog("pl:a", "em_andamento", ["concluido", "em_andamento", "pendente"])], 700_000);
    expect(m.fase()).toBe("ativo");
    m.estadoAgora([falho], 710_000).d({ tipo: "dispensar", id: "pl:a" });
    expect(m.fase()).toBe("oculto");
    expect(m.efeitos).toEqual([]);
  });
  it("cancelado ou sumido fecha em silêncio (sem toast)", () => {
    const a = new Maq().estadoAgora([EM], 0).estadoAgora([prog("pl:a", "cancelado", ["concluido", "pendente"])], 10).tick(10 + ANIMACAO_FECHAR_MS);
    expect(a.fase()).toBe("oculto");
    const b = new Maq().estadoAgora([EM], 0).estadoAgora([], 10).tick(10 + ANIMACAO_FECHAR_MS);
    expect(b.fase()).toBe("oculto");
    expect([...a.efeitos, ...b.efeitos]).toEqual([]);
  });
  it("progresso que apareceu já concluído (acabou entre duas leituras) mostra o resumo e fecha", () => {
    const m = new Maq().estadoAgora([FIM], 50);
    expect(m.fase()).toBe("resumo");
  });
});

describe("fixar, dispensar, recolher", () => {
  it("fixar aberto: o resumo fica até dispensar; desafixar reinicia os 2 s", () => {
    const m = new Maq().estadoAgora([EM], 0).d({ tipo: "fixar", id: "pl:a", fixado: true, agora: 10 }).estadoAgora([FIM], 1_000).tick(100_000);
    expect(m.fase()).toBe("resumo");
    expect(proximoPrazo(m.estado)).toBeNull();
    m.d({ tipo: "fixar", id: "pl:a", fixado: false, agora: 100_000 });
    expect(proximoPrazo(m.estado)).toBe(100_000 + RESUMO_MS);
    m.tick(102_000).tick(102_000 + ANIMACAO_FECHAR_MS);
    expect(m.fase()).toBe("oculto");
  });
  it("dispensar vale só para aquele progresso e não volta nas atualizações seguintes", () => {
    const outro = prog("pl:b", "em_andamento", ["em_andamento", "pendente"], { iniciado_em: 2_000 });
    const m = new Maq().estadoAgora([EM, outro], 0).d({ tipo: "dispensar", id: "pl:a" });
    expect(m.ids()).toEqual(["pl:b"]);
    m.estadoAgora([prog("pl:a", "em_andamento", ["concluido", "concluido", "em_andamento"]), outro], 50);
    expect(m.ids()).toEqual(["pl:b"]);
  });
  it("o main também pode dizer 'dispensado' (outra janela, reinício do renderer)", () => {
    expect(new Maq().estadoAgora([{ ...EM, dispensado: true }], 0).ids()).toEqual([]);
    expect(new Maq().estadoAgora([{ ...EM, fixado: true }], 0).estado.itens["pl:a"]!.fixado).toBe(true);
  });
  it("recolher é por progresso e não muda a fase", () => {
    const m = new Maq().estadoAgora([EM], 0).d({ tipo: "recolher", id: "pl:a", recolhido: true });
    expect(m.estado.itens["pl:a"]).toMatchObject({ recolhido: true, fase: "ativo" });
  });
});

describe("feature, vários progressos e workspaces", () => {
  it("feature desligada esconde tudo (e religar mostra de novo, sem perder o estado)", () => {
    const m = new Maq().estadoAgora([EM], 0).d({ tipo: "ligar", ligado: false });
    expect(m.ids()).toEqual([]);
    expect(indicadorDoWorkspace(m.estado, "ws_1")).toBeNull();
    m.d({ tipo: "ligar", ligado: true });
    expect(m.ids()).toEqual(["pl:a"]);
  });
  it("vários progressos no mesmo workspace: ordem de chegada; cada um com o próprio ciclo", () => {
    const b = prog("pl:b", "em_andamento", ["em_andamento"], { iniciado_em: 2_000 });
    const c = prog("sk:runx:p", "em_andamento", ["em_andamento"], { iniciado_em: 3_000, origem: "skill" });
    const m = new Maq().estadoAgora([c, EM, b], 0);
    expect(m.ids()).toEqual(["pl:a", "pl:b", "sk:runx:p"]);
    m.estadoAgora([FIM, b, c], 1_000).tick(3_000).tick(3_200);
    expect(m.ids()).toEqual(["pl:b", "sk:runx:p"]);
  });
  it("troca de workspace troca o painel; o outro segue sendo acompanhado em segundo plano", () => {
    const fora = prog("pl:x", "em_andamento", ["concluido", "concluido", "concluido", "em_andamento", "pendente"], { workspace_id: "ws_2" });
    const m = new Maq().estadoAgora([EM, fora], 0);
    expect(m.ids()).toEqual(["pl:a"]);
    expect(indicadorDoWorkspace(m.estado, "ws_2")).toEqual({ feitos: 3, total: 5, aguardando: false, falhou: false });
    m.d({ tipo: "workspace", id: "ws_2" });
    expect(m.ids()).toEqual(["pl:x"]);
    m.d({ tipo: "workspace", id: null });
    expect(m.ids()).toEqual([]);
  });
  it("conclusão em segundo plano fecha sem toast (o dono não está olhando aquele workspace)", () => {
    const fora = prog("pl:x", "em_andamento", ["em_andamento"], { workspace_id: "ws_2" });
    const m = new Maq().estadoAgora([fora], 0).estadoAgora([{ ...fora, resultado: "concluido", concluido: true }], 10).tick(10 + RESUMO_MS).tick(10 + RESUMO_MS + ANIMACAO_FECHAR_MS);
    expect(m.fase("pl:x")).toBe("oculto");
    expect(m.efeitos).toEqual([]);
  });
  it("indicador do card: aguardando e falha aparecem; concluído some", () => {
    const aguard = new Maq().estadoAgora([prog("pl:a", "aguardando", ["concluido", "aguardando"])], 0);
    expect(indicadorDoWorkspace(aguard.estado, "ws_1")).toMatchObject({ feitos: 1, total: 2, aguardando: true });
    const falha = new Maq().estadoAgora([prog("pl:a", "falhou", ["concluido", "falhou"])], 0);
    expect(indicadorDoWorkspace(falha.estado, "ws_1")).toMatchObject({ falhou: true });
    const fim = new Maq().estadoAgora([FIM], 0);
    expect(indicadorDoWorkspace(fim.estado, "ws_1")).toBeNull();
  });
  it("progressos finalizados e invisíveis saem do mapa na leitura seguinte (sem vazamento)", () => {
    const m = new Maq().estadoAgora([EM], 0).d({ tipo: "dispensar", id: "pl:a" }).estadoAgora([], 10);
    expect(Object.keys(m.estado.itens)).toEqual([]);
  });
});

describe("formato", () => {
  it("duração curta", () => {
    expect([0, 42_000, 240_000, 3_900_000].map(formatarDuracao)).toEqual(["0 s", "42 s", "4 min", "1 h 05 min"]);
  });
  it("resumos", () => {
    expect(resumoDoProgresso(FIM)).toBe("Concluído: 3/3 em 4 min");
    expect(resumoDoProgresso({ ...FIM, fim_em: null })).toBe("Concluído: 3/3");
    expect(resumoDoProgresso(prog("a", "falhou", ["concluido", "falhou"]))).toBe("Parou na etapa Etapa 2: falhou");
    expect(resumoDoProgresso(prog("a", "aguardando", ["concluido", "aguardando"]))).toBe("Aguardando você: Etapa 2");
  });
  it("etapa atual e contagem sem as puladas", () => {
    const p = prog("a", "em_andamento", ["concluido", "pulado", "em_andamento", "pendente"]);
    expect(itemAtual(p)?.id).toBe("e2");
    expect(itemAtual(prog("b", "falhou", ["concluido", "falhou", "pendente"]))?.id).toBe("e1"); // falha: o destaque fica na etapa que falhou
    expect(itemAtual(prog("c", "concluido", ["concluido", "concluido"]))).toBeNull();
    expect(contagem(p)).toEqual({ feitos: 1, total: 3 });
  });
});
