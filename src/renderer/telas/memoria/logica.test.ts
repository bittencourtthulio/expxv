import { describe, expect, it } from "vitest";
import { MODELO_HASH } from "../../../nucleo/memoria/vetorial/embedding";
import type { EntradaMemoria, EstadoMemoriaApp } from "../../../compartilhado/memoria";
import { entrada } from "../../a11y/ade-falso-memoria";
import {
  MODELO_EMBEDDING_LOCAL, agruparMetricas, confirmacaoConfere, escopoDaAba, filtrarPorOrigem, formatarBytes, haQuanto, janelaVisivel, mesclarNovas, modoDaMissao, percentualTeto,
  semAprendizadoDoPiloto, textoDiagnosticoMemoria, textoMetricas, textoRestauracao, textoRetencao, textoTeto, validarOrcamento, validarPreferencia, validarRetencao, validarTeto, validarTexto, valorDoModoMissao,
} from "./logica";

describe("constantes espelhadas do núcleo", () => {
  it("o modelo de embedding local da UI é o do núcleo", () => { expect(MODELO_EMBEDDING_LOCAL).toBe(MODELO_HASH); });
});

describe("abas", () => {
  it("Preferências e Saúde não listam entradas; as demais mapeiam para o escopo", () => {
    expect(escopoDaAba("pane")).toBe("pane");
    expect(escopoDaAba("workspace")).toBe("workspace");
    expect(escopoDaAba("squad")).toBe("squad");
    expect(escopoDaAba("preferencias")).toBeNull();
    expect(escopoDaAba("saude")).toBeNull();
  });
});

describe("haQuanto", () => {
  const agora = new Date("2026-10-01T12:00:00.000Z");
  it.each([
    ["2026-10-01T11:59:50.000Z", "agora"], ["2026-10-01T11:57:00.000Z", "há 3 min"], ["2026-10-01T09:00:00.000Z", "há 3 h"], ["2026-09-29T12:00:00.000Z", "há 2 d"],
    ["2026-05-01T12:00:00.000Z", "há 5 meses"], ["2026-08-30T12:00:00.000Z", "há 32 d"], ["lixo", "—"], ["2026-10-02T12:00:00.000Z", "agora"],
  ])("%s -> %s", (iso, esperado) => { expect(haQuanto(iso, agora)).toBe(esperado); });
});

describe("formatarBytes, teto e retenção", () => {
  it("formata e calcula percentual com teto", () => {
    expect(formatarBytes(512)).toBe("512 B");
    expect(formatarBytes(2048)).toBe("2,0 KB");
    expect(formatarBytes(5 * 1024 * 1024)).toBe("5,0 MB");
    expect(formatarBytes(-1)).toBe("—");
    expect(percentualTeto(256 * 1024 * 1024, 512)).toBe(50);
    expect(percentualTeto(900 * 1024 * 1024, 512)).toBe(100);
    expect(percentualTeto(1, 0)).toBe(0);
    expect(textoTeto(256 * 1024 * 1024, 512)).toBe("256,0 MB de 512 MB (50%)");
    expect(textoRetencao(0)).toBe("sem limite");
    expect(textoRetencao(1)).toBe("1 dia");
    expect(textoRetencao(365)).toBe("365 dias");
  });
});

describe("janela virtualizada (P-40)", () => {
  it("5 000 entradas: poucas dezenas de linhas no DOM, nunca as 5 000", () => {
    for (const topo of [0, 24 * 1000, 24 * 4990]) {
      const j = janelaVisivel(topo, 1000, 5000, 24);
      expect(j.ultimo - j.primeiro).toBeLessThanOrEqual(80);
      expect(j.primeiro).toBeGreaterThanOrEqual(0);
      expect(j.ultimo).toBeLessThanOrEqual(5000);
    }
  });
  it("lista vazia, altura 0 e topo negativo não quebram", () => {
    expect(janelaVisivel(0, 500, 0, 24)).toEqual({ primeiro: 0, ultimo: 0 });
    expect(janelaVisivel(-50, 0, 10, 24)).toEqual({ primeiro: 0, ultimo: 4 });
    expect(janelaVisivel(0, 100, 3, 24)).toEqual({ primeiro: 0, ultimo: 3 });
  });
});

describe("mesclarNovas", () => {
  const a = entrada("a"), b = entrada("b"), c = entrada("c");
  it("entra o novo na frente, atualiza o existente no lugar e não duplica", () => {
    const b2: EntradaMemoria = { ...b, conteudo: "novo texto" };
    const r = mesclarNovas([a, b], [c, b2]);
    expect(r.map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(r[2]?.conteudo).toBe("novo texto");
  });
  it("sem novidade devolve o mesmo conteúdo", () => { expect(mesclarNovas([a], [a]).map((e) => e.id)).toEqual(["a"]); });
});

describe("filtro de origem", () => {
  it("filtra pelo lado do cliente", () => {
    const l = [entrada("a", { fonte: "agente" }), entrada("b", { fonte: "sistema" })];
    expect(filtrarPorOrigem(l, null)).toHaveLength(2);
    expect(filtrarPorOrigem(l, "sistema").map((e) => e.id)).toEqual(["b"]);
  });
});

describe("validações de formulário", () => {
  it("texto: vazio, controle e tamanho (em pontos de código)", () => {
    expect(validarTexto("  ", 10).ok).toBe(false);
    expect(validarTexto("a\u0007b", 10).ok).toBe(false);
    expect(validarTexto("a".repeat(11), 10)).toMatchObject({ ok: false, erro: expect.stringContaining("passa de 10") });
    expect(validarTexto("😀".repeat(10), 10).ok).toBe(true);
    expect(validarTexto("  ok ", 10)).toEqual({ ok: true, valor: "ok" });
  });
  it("preferência: 300 caracteres e limite de 50 (editar não conta como novo)", () => {
    expect(validarPreferencia("x".repeat(301), 0, false).ok).toBe(false);
    expect(validarPreferencia("x".repeat(300), 0, false).ok).toBe(true);
    expect(validarPreferencia("x", 50, false)).toMatchObject({ ok: false, erro: expect.stringContaining("50") });
    expect(validarPreferencia("x", 50, true).ok).toBe(true);
  });
  it("orçamento do brief 1500..20000, retenção 0|7..3650, teto 16..100000", () => {
    expect(validarOrcamento("1499").ok).toBe(false);
    expect(validarOrcamento("1500")).toEqual({ ok: true, valor: 1500 });
    expect(validarOrcamento("20001").ok).toBe(false);
    expect(validarOrcamento("abc").ok).toBe(false);
    expect(validarOrcamento("2500.5").ok).toBe(false);
    expect(validarRetencao("0")).toEqual({ ok: true, valor: 0 });
    expect(validarRetencao("6").ok).toBe(false);
    expect(validarRetencao("7").ok).toBe(true);
    expect(validarRetencao("3651").ok).toBe(false);
    expect(validarRetencao("").ok).toBe(false);
    expect(validarTeto("15").ok).toBe(false);
    expect(validarTeto("512")).toEqual({ ok: true, valor: 512 });
  });
  it("confirmação exige o nome exato do projeto", () => {
    expect(confirmacaoConfere("Meu Projeto", "Meu Projeto")).toBe(true);
    expect(confirmacaoConfere("meu projeto", "Meu Projeto")).toBe(false);
    expect(confirmacaoConfere("", "")).toBe(false);
  });
});

describe("métricas e diagnóstico (só números)", () => {
  it("agrupa por prefixo, ordena e descarta nome fora do padrão e valor não numérico", () => {
    const g = agruparMetricas({ "ciclo.fatias": 7, "memoria.dedupe": 2, "ciclo.lentas": 1, solto: 3, "Nome Ruim": 9, "x.y": Number.NaN, "texto livre com segredo": 1 } as never);
    expect(g.map((x) => x.grupo)).toEqual(["ciclo", "geral", "memoria"]);
    expect(g[0]?.itens).toEqual([{ nome: "fatias", valor: 7 }, { nome: "lentas", valor: 1 }]);
    expect(agruparMetricas(undefined)).toEqual([]);
  });
  it("textoMetricas e o bloco de diagnóstico não carregam conteúdo, nome nem caminho", () => {
    expect(textoMetricas({ "ciclo.fatias": 7, solto: 1 })).toBe("Memória (métricas, só números):\nciclo.fatias=7\nsolto=1");
    expect(textoMetricas({})).toBe("");
    const estado: EstadoMemoriaApp = {
      config: { workspace_id: "w1", ativa: true, solo: false, squad: true, orcamento_brief_chars: 6000, retencao_dias: 365, teto_mb: 512, pacote_workers: true, embedding_modelo: null, global_ativa: true },
      contagens: { pane: 2, missao: 1, squad: 0, workspace: 1, usuario: 0 }, tamanho_bytes: 4096, aviso_teto: false, fts5: true, memox: { instalado: true, texto: "SEGREDO-no-texto-do-memox /Users/x/projeto" }, metricas: { "restore.total": 1 },
    };
    const t = textoDiagnosticoMemoria(estado);
    expect(t).toContain("entradas.pane=2");
    expect(t).toContain("fts5=sim");
    expect(t).toContain("restore.total=1");
    expect(t).not.toContain("SEGREDO");
    expect(t).not.toContain("/Users");
    expect(textoDiagnosticoMemoria(null)).toBe("");
  });
});

describe("Missão e restauração", () => {
  it("no_learning_recorded: Missão terminal sem aprendizado de agente", () => {
    expect(semAprendizadoDoPiloto(true, [])).toBe(true);
    expect(semAprendizadoDoPiloto(true, [{ tipo: "aprendizado", fonte: "sistema" }])).toBe(true);
    expect(semAprendizadoDoPiloto(true, [{ tipo: "aprendizado", fonte: "agente" }])).toBe(false);
    expect(semAprendizadoDoPiloto(false, [])).toBe(false);
  });
  it("modo da Missão ⇄ valor da chave (null herda)", () => {
    expect(modoDaMissao(undefined)).toBe("herdar");
    expect(modoDaMissao(true)).toBe("ligada");
    expect(modoDaMissao(false)).toBe("desligada");
    expect(valorDoModoMissao("herdar")).toBeNull();
    expect(valorDoModoMissao("desligada")).toBe(false);
  });
  it("texto do restore não promete o que não houve", () => {
    expect(textoRestauracao({ modo: "brief", brief_injetado: true, truncado: false, ja_existia: true })).toMatch(/nada foi duplicado/);
    expect(textoRestauracao({ modo: "retomada", brief_injetado: false, truncado: false, ja_existia: false })).toMatch(/retomando/);
    expect(textoRestauracao({ modo: "sem_memoria", brief_injetado: false, truncado: false, ja_existia: false })).toMatch(/desligada/);
    expect(textoRestauracao({ modo: "brief", brief_injetado: true, truncado: true, ja_existia: false })).toMatch(/resumido/);
    expect(textoRestauracao({ modo: "brief", brief_injetado: false, truncado: false, ja_existia: false })).toMatch(/sem brief/);
  });
});
