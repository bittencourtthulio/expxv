import { describe, expect, it } from "vitest";
import { etapaDoPlano, MATRIZ } from "../../a11y/ade-falso-maestro";
import {
  acoesPermitidas, achadosPorEtapa, agruparPorSkill, contarTerminais, exigenciaDoErro, exigenciaPrevia, faixaDeConfianca, fraseValida, justificativaValida, linhaTravada, marcasDaEtapa, nivelPorTecla, planoTemCandidatas,
  podeDesligar, problemaDoTexto, rotuloDaCela, textoHumano, valorTexto,
  COMPARATIVO_PERFIS, duracaoDaEtapa, efeitoDoNivel, efeitoDoPlano, frasesDoEfeito, perfilLegivel, previaDoPerfilPronto, progressoDoPipeline, rigoresDaEtapa,
  descricaoDoHook, hooksDoNivel, infoDoParametro, valorDoParametro,
} from "./logica";

describe("seletor: valor e teclado", () => {
  it("aria-valuetext traz nome e nível", () => {
    expect(valorTexto(3)).toBe("Padrão, nível 3 de 5");
    expect(valorTexto(1)).toBe("Relâmpago, nível 1 de 5");
    expect(valorTexto(5, "Total")).toBe("Total, nível 5 de 5");
  });
  it("setas, Home e End; limites 1..5; outras teclas não são tratadas", () => {
    expect(nivelPorTecla("ArrowRight", 3)).toBe(4);
    expect(nivelPorTecla("ArrowLeft", 3)).toBe(2);
    expect(nivelPorTecla("ArrowUp", 5)).toBe(5);
    expect(nivelPorTecla("ArrowDown", 1)).toBe(1);
    expect(nivelPorTecla("Home", 4)).toBe(1);
    expect(nivelPorTecla("End", 2)).toBe(5);
    expect(nivelPorTecla("a", 2)).toBeNull();
  });
  it("justificativa precisa de 20 caracteres (sem contar espaços nas pontas); a frase é `baixar`", () => {
    expect(justificativaValida("x".repeat(19))).toBe(false);
    expect(justificativaValida(`  ${"x".repeat(20)}  `)).toBe(true);
    expect(justificativaValida(` ${"x".repeat(19)} `)).toBe(false);
    expect(fraseValida("baixar")).toBe(true);
    expect(fraseValida(" Baixar ")).toBe(true);
    expect(fraseValida("baixa")).toBe(false);
  });
  it("erros nominais do main viram a exigência certa; erro comum não", () => {
    expect(exigenciaDoErro(new Error("confirmacao_necessaria: digite baixar"))?.tipo).toBe("confirmacao");
    expect(exigenciaDoErro(new Error("abaixo_do_minimo: raio ALTO"))?.tipo).toBe("justificativa");
    expect(exigenciaDoErro(new Error("abaixo_do_minimo: raio ALTO"))?.mensagem).toBe("raio ALTO");
    expect(exigenciaDoErro(new Error("disco cheio"))).toBeNull();
  });
  it("descer abaixo do mínimo travado pede justificativa antes de chamar", () => {
    expect(exigenciaPrevia(2, 4, "Raio ALTO")?.tipo).toBe("justificativa");
    expect(exigenciaPrevia(4, 4, "Raio ALTO")).toBeNull();
  });
});

describe("pedido e plano", () => {
  it("texto vazio e acima de 4000 são recusados no cliente", () => {
    expect(problemaDoTexto("  ")).not.toBeNull();
    expect(problemaDoTexto("a".repeat(4001))).toContain("4000");
    expect(problemaDoTexto("a".repeat(4000))).toBeNull();
  });
  it("faixas de confiança 0,70 / 0,45", () => {
    expect(faixaDeConfianca(0.7)).toBe("alta");
    expect(faixaDeConfianca(0.69)).toBe("media");
    expect(faixaDeConfianca(0.44)).toBe("baixa");
  });
  it("marcas da etapa: reduzida, reforço, pulada, humana, piso, agrupada", () => {
    expect(marcasDaEtapa(etapaDoPlano("runx.e1", { reduz: true }))).toEqual(["◐"]);
    expect(marcasDaEtapa(etapaDoPlano("runx.e1", { reforco: "x", piso: true }))).toEqual(["◆", "P"]);
    expect(marcasDaEtapa(etapaDoPlano("runx.e1", { estado_inicial: "pulada_nivel" }))).toEqual(["○"]);
    expect(marcasDaEtapa(etapaDoPlano("mergex.revisar", { estado_inicial: "humano" }))).toEqual(["H"]);
    expect(marcasDaEtapa(etapaDoPlano("runx.e3", { agrupa_com_anterior: true }))).toEqual(["⛓"]);
  });
  it("conta terminais: ignora humanas, puladas, agrupadas e sem comando", () => {
    expect(contarTerminais({ etapas: [etapaDoPlano("runx.e1"), etapaDoPlano("runx.e3", { agrupa_com_anterior: true }), etapaDoPlano("runx.e4", { estado_inicial: "pulada_nivel" }), etapaDoPlano("mergex.revisar", { estado_inicial: "humano", tipo: "humano", comando: null }), etapaDoPlano("consulta.rag", { tipo: "consulta", comando: null })] })).toBe(1);
  });
  it("candidatas só aparecem com confiança média/baixa e mais de uma", () => {
    const c = [{ intencao: "bug" as const, confianca: 0.5 }, { intencao: "feature" as const, confianca: 0.4 }];
    expect(planoTemCandidatas({ candidatas: c, confianca: 0.5 })).toBe(true);
    expect(planoTemCandidatas({ candidatas: c, confianca: 0.9 })).toBe(false);
    expect(planoTemCandidatas({ candidatas: [], confianca: 0.5 })).toBe(false);
  });
});

describe("acompanhamento: nunca há ação de assinar/aprovar/mergear", () => {
  it("nenhuma combinação oferece ação fora do conjunto permitido", () => {
    const estados = ["pendente", "executando", "aguardando_humano", "aguardando_confirmacao", "concluida", "reprovada", "falhou", "sem_progresso", "pulada_nivel"] as const;
    for (const p of ["executando", "pausado", "aguardando_humano", "bloqueado_piso"] as const) for (const e of estados) for (const a of acoesPermitidas(p, e)) expect(["pausar", "retomar", "pular_etapa", "reabrir_etapa", "confirmar_etapa", "abrir_arquivo"]).toContain(a);
  });
  it("pipeline terminado não tem ações; pausado oferece retomar", () => {
    expect(acoesPermitidas("concluido", "concluida")).toEqual([]);
    expect(acoesPermitidas("pausado", null)).toContain("retomar");
    expect(acoesPermitidas("executando", null)).toContain("pausar");
    expect(acoesPermitidas("aguardando_confirmacao", "aguardando_confirmacao")).toContain("confirmar_etapa");
  });
  it("texto das etapas humanas diz que a decisão é da pessoa", () => {
    expect(textoHumano("mergex.revisar")).toMatch(/merge é seu/i);
    expect(textoHumano("prodx.assinatura")).toMatch(/assinatura/i);
  });
});

describe("matriz", () => {
  it("agrupa por skill mantendo a ordem; humana é travada; piso não desliga", () => {
    const g = agruparPorSkill([{ id: "runx.e1", skill: "runx" }, { id: "prodx.p0", skill: "prodx" }, { id: "runx.e3", skill: "runx" }] as never);
    expect(g.map((x) => [x.skill, x.etapas.length])).toEqual([["runx", 2], ["prodx", 1]]);
    expect(linhaTravada({ humano: true })).toBe(true);
    expect(podeDesligar({ humano: false, piso: true })).toBe(false);
    expect(podeDesligar({ humano: false, piso: false })).toBe(true);
  });
  it("achados indexados também pelas etapas relacionadas (V1: par implementador/avaliador)", () => {
    const m = achadosPorEtapa([{ codigo: "V1", severidade: "erro", etapa_id: "runx.e4", mensagem: "igual", relacionadas: ["runx.e3"] }]);
    expect(m.get("runx.e4")?.length).toBe(1);
    expect(m.get("runx.e3")?.length).toBe(1);
  });
  it("rótulo da célula descreve nível, modo e extras (não depende de cor)", () => {
    const c = MATRIZ.celulas[0]?.por_nivel["2"];
    expect(rotuloDaCela(c as never, 2, "Causa raiz")).toBe("Causa raiz, nível 2: roda reduzida");
  });
});

describe("leitura humana do plano", () => {
  it("perfil: separa CLI, modelo e esforço com rótulos legíveis", () => {
    expect(perfilLegivel("claude·padrão·alto")).toEqual({ cli: "Claude Code", modelo: "padrão da faixa", esforco: "alto" });
    expect(perfilLegivel("opencode·gpt-x·medio")).toEqual({ cli: "OpenCode", modelo: "gpt-x", esforco: "médio" });
    expect(perfilLegivel("auto·padrão·padrão")?.cli).toBe("automática");
    expect(perfilLegivel(null)).toBeNull();
    expect(perfilLegivel("  ")).toBeNull();
  });
  it("rigor em palavras: humana, reduzida, reforço, piso, agrupada e avaliações", () => {
    const base = { estado_inicial: "pendente" as const, reduz: false, reforco: null, piso: false, agrupa_com_anterior: false };
    expect(rigoresDaEtapa(base)).toEqual([]);
    expect(rigoresDaEtapa({ ...base, reduz: true, piso: true }).map((r) => r.tipo)).toEqual(["reduz", "piso"]);
    expect(rigoresDaEtapa({ ...base, reforco: "dupla checagem", agrupa_com_anterior: true, avaliacoes: 2 }).map((r) => r.texto)).toEqual(["com reforço: dupla checagem", "no terminal anterior", "2 avaliações independentes"]);
    expect(rigoresDaEtapa({ ...base, estado_inicial: "humano" })[0]?.tipo).toBe("humano");
    expect(rigoresDaEtapa({ ...base, estado_inicial: "pulada_nivel" })[0]?.texto).toBe("fora deste nível");
  });
  it("duração: segundos, minutos, horas; sem início é nula; sem fim conta até agora", () => {
    expect(duracaoDaEtapa(null, null)).toBeNull();
    expect(duracaoDaEtapa("2026-10-01T12:00:00Z", "2026-10-01T12:00:42Z")).toBe("42 s");
    expect(duracaoDaEtapa("2026-10-01T12:00:00Z", "2026-10-01T12:03:12Z")).toBe("3 min 12 s");
    expect(duracaoDaEtapa("2026-10-01T12:00:00Z", "2026-10-01T14:05:00Z")).toBe("2 h 5 min");
    expect(duracaoDaEtapa("2026-10-01T12:00:00Z", null, Date.parse("2026-10-01T12:10:00Z"))).toBe("10 min");
    expect(duracaoDaEtapa("lixo", null)).toBeNull();
  });
  it("progresso ignora as etapas puladas", () => {
    expect(progressoDoPipeline([{ estado: "concluida" }, { estado: "executando" }, { estado: "pulada_nivel" }, { estado: "pendente" }])).toEqual({ feitas: 1, total: 3 });
  });
});

describe("escala de rigidez: efeito de cada nível", () => {
  it("conta o que o nível faz com as etapas da matriz", () => {
    const e1 = efeitoDoNivel(MATRIZ.celulas, 1);
    expect(e1).toMatchObject({ total: 2, fora: 1, humanas: 1 });
    const e2 = efeitoDoNivel(MATRIZ.celulas, 2);
    expect(e2).toMatchObject({ reduzidas: 1, humanas: 1 });
    expect(efeitoDoNivel(MATRIZ.celulas, 4).reforcadas).toBe(1);
    expect(efeitoDoNivel(MATRIZ.celulas, 3, new Set(["runx.e1"])).total).toBe(1);
  });
  it("frase cita só o que existe", () => {
    expect(frasesDoEfeito(efeitoDoNivel(MATRIZ.celulas, 1))).toBe("0 etapas rodam, 1 fora, 1 pausa para você");
    expect(frasesDoEfeito(efeitoDoNivel(MATRIZ.celulas, 3))).toBe("1 etapa roda, 1 pausa para você");
  });
  it("efeito do plano proposto considera puladas, humanas e reforços", () => {
    const e = efeitoDoPlano([etapaDoPlano("runx.e1"), etapaDoPlano("runx.e3", { reduz: true }), etapaDoPlano("runx.e4", { estado_inicial: "pulada_nivel" }), etapaDoPlano("mergex.revisar", { estado_inicial: "humano" }), etapaDoPlano("mergex.qa", { reforco: "x", avaliacoes: 2 })]);
    expect(e).toMatchObject({ total: 5, completas: 1, reduzidas: 1, fora: 1, humanas: 1, reforcadas: 1, avaliacoesExtras: 1 });
  });
});

describe("perfis prontos: comparação", () => {
  it("Econômico desce uma faixa e Máxima qualidade sobe uma, com o esforço da nova faixa; limites respeitados", () => {
    expect(previaDoPerfilPronto("economico", "alto")).toEqual({ faixa: "medio", esforco: "baixo" });
    expect(previaDoPerfilPronto("economico", "rapido")).toEqual({ faixa: "rapido", esforco: "minimo" });
    expect(previaDoPerfilPronto("maxima-qualidade", "alto")).toEqual({ faixa: "topo", esforco: "maximo" });
    expect(previaDoPerfilPronto("maxima-qualidade", "topo")).toEqual({ faixa: "topo", esforco: "maximo" });
    expect(previaDoPerfilPronto("equilibrado", "alto")).toBeNull();
    expect(previaDoPerfilPronto("economico", "inventada")).toBeNull();
  });
  it("quadro comparativo traz as quatro faixas por perfil", () => {
    for (const id of ["economico", "equilibrado", "maxima-qualidade"]) expect(COMPARATIVO_PERFIS[id]?.esforcos.map((x) => x.faixa)).toEqual(["topo", "alto", "médio", "rápido"]);
    expect(COMPARATIVO_PERFIS["economico"]?.esforcos[1]).toEqual({ faixa: "alto", esforco: "baixo" });
  });
});

describe("parâmetros e hooks por nível: leitura humana", () => {
  it("valores técnicos viram português corrido, sem sublinhado", () => {
    expect(valorDoParametro("testes", "revisor_em_segundo_provedor")).toBe("revisor em outro provedor");
    expect(valorDoParametro("portao_mergex", "estrito_segunda_opiniao")).toBe("estrito com segunda opinião");
    expect(valorDoParametro("hooks_de_metodo", "quase_todos_bloqueio")).toBe("quase todos em bloqueio");
    expect(valorDoParametro("agrupa_etapas", true)).toBe("sim");
    expect(valorDoParametro("densidade", null)).toBe("não se aplica");
    expect(valorDoParametro("subagentes_de_veredito", [])).toBe("nenhum");
    expect(valorDoParametro("subagentes_de_veredito", ["auditor-plano", "qa"])).toBe("auditor-plano, qa");
    expect(valorDoParametro("chave_nova", "valor_novo_longo")).toBe("valor novo longo");
    expect(valorDoParametro("max_terminais", 4)).toBe("4");
  });
  it("todo parâmetro conhecido tem rótulo e descrição; o desconhecido ganha rótulo legível", () => {
    for (const k of ["pipeline_bug_feature", "testes", "portao_mergex", "max_terminais", "reaproveita_terminal"]) { expect(infoDoParametro(k).rotulo).not.toMatch(/_/); expect(infoDoParametro(k).descricao.length).toBeGreaterThan(5); }
    expect(infoDoParametro("coisa_nova")).toEqual({ rotulo: "Coisa nova", descricao: "" });
  });
  it("hooks do nível: bloqueio primeiro, depois aviso e desligado, com descrição; nível sem entrada fica vazio", () => {
    const por = { "1": { "b-hook": "desligado", "task-so-fecha-verde": "aviso" }, "4": { "z-hook": "aviso", "task-so-fecha-verde": "bloqueio" } };
    expect(hooksDoNivel(por, 1).map((h) => h.nome)).toEqual(["task-so-fecha-verde", "b-hook"]);
    expect(hooksDoNivel(por, 4)[0]).toEqual({ nome: "task-so-fecha-verde", modo: "bloqueio", descricao: "A task só fecha com a suíte verde." });
    expect(hooksDoNivel(por, 3)).toEqual([]);
    expect(descricaoDoHook("inexistente")).toBe("");
  });
});
