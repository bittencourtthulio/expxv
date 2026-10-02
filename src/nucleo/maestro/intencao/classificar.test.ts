import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classificarIntencao } from "./classificar";
import { LEXICO } from "./lexico";
import { normalizar } from "./normalizar";

interface Linha { t: string; i: string; adv: boolean }
const CORPUS: Linha[] = readFileSync(resolve(__dirname, "../../../../tests/fixtures/maestro/corpus.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Linha);

describe("normalizar", () => {
  it("é idempotente e equivale caixa e acento", () => {
    for (const t of ["Correção", "CORRIGE", "corrige", "Não é  bug!", "a  b\n\nc"]) expect(normalizar(normalizar(t))).toBe(normalizar(t));
    expect(normalizar("Correção")).toBe(normalizar("CORREÇÃO"));
    expect(normalizar("Correção")).toBe("correcao");
  });
  it("remove blocos de código, código em linha e citações", () => {
    expect(normalizar("antes ```bug erro``` depois")).toBe("antes depois");
    expect(normalizar("use `bug` aqui")).toBe("use aqui");
    expect(normalizar("> bug citado\nok")).toBe("ok");
  });
  it("entrada patológica de 100 KB é rápida", () => {
    const t = "```" + "a".repeat(100_000);
    const a = performance.now();
    normalizar(t);
    normalizar("x ".repeat(50_000));
    normalizar("`".repeat(100_000));
    expect(performance.now() - a).toBeLessThan(100);
  });
});

describe("léxico", () => {
  it("ids únicos, termos já normalizados, pesos positivos", () => {
    const ids = new Set<string>();
    for (const e of LEXICO) {
      expect(ids.has(e.id), e.id).toBe(false);
      ids.add(e.id);
      expect(e.peso).toBeGreaterThan(0);
      if (e.tipo !== "regex") expect(normalizar(e.termo), e.id).toBe(e.termo);
    }
    expect(LEXICO.length).toBeGreaterThan(300);
  });
});

describe("classificarIntencao: casos do dono e regras B1..B10", () => {
  it("o exemplo literal do dono é bug com confiança alta", () => {
    const r = classificarIntencao("corrige, estou com um problema em tal lugar");
    expect(r.intencao).toBe("bug");
    expect(r.faixa).toBe("alta");
    expect(r.fonte).toBe("regra");
    expect(r.sinais.length).toBeGreaterThan(0);
  });
  it.each([
    ["vale a pena fazer um app para isso?", "pedido"],
    ["refatora o módulo legado de frete", "refatoracao"],
    ["abre o PR", "entrega"],
    ["o que já fizemos sobre exportação?", "historico"],
    ["quero um sistema de gestão do zero", "projeto"],
    ["como funciona o login?", "duvida"],
  ])("%s ⇒ %s", (texto, esperado) => {
    const r = classificarIntencao(texto);
    expect(r.intencao).toBe(esperado);
    expect(["alta", "media"]).toContain(r.faixa);
  });
  it("B1: slash command do método vai direto (fonte comando, confiança 1)", () => {
    for (const [t, i] of [["/expx:runx-causa o botão quebrou", "bug"], ["/sprintx nova feature", "feature"], ["/expx:prodx-triar algo", "pedido"], ["/mergex-pr OC-2026-0001", "entrega"]] as const) {
      const r = classificarIntencao(t);
      expect(r).toMatchObject({ intencao: i, fonte: "comando", confianca: 1, faixa: "alta" });
    }
  });
  it("B2: rótulo explícito soma 10 e marca a fonte", () => {
    const r = classificarIntencao("[feature] algo qualquer sobre a tela");
    expect(r.intencao).toBe("feature");
    expect(r.fonte).toBe("explicito");
    expect(classificarIntencao("bug: lista não carrega").fonte).toBe("explicito");
    expect(classificarIntencao("#projeto agenda online").intencao).toBe("projeto");
  });
  it("B3: interrogativa sem verbo imperativo vira dúvida; com defeito continua bug", () => {
    expect(classificarIntencao("onde fica a regra do frete?").intencao).toBe("duvida");
    expect(classificarIntencao("por que o login dá erro 500?").intencao).toBe("bug");
  });
  it("B4: referência a trabalho vira retomada sem mudar a intenção", () => {
    expect(classificarIntencao("continua o OC-2026-0142, o QA reprovou").retomar).toEqual({ tipo: "OC", id: "OC-2026-0142" });
    expect(classificarIntencao("segue com PD-2026-0007 e fecha o briefing").retomar).toEqual({ tipo: "PD", id: "PD-2026-0007" });
    expect(classificarIntencao("retoma a FT-03").retomar).toEqual({ tipo: "FT", id: "FT-03" });
    expect(classificarIntencao("continua o export-csv, corrige o erro", { slugs_abertos: ["export-csv"] }).retomar).toEqual({ tipo: "slug", id: "export-csv" });
    expect(classificarIntencao("corrige o erro do login").retomar).toBeNull();
  });
  it("B5: bug e feature na mesma frase: sinal de defeito decide o empate", () => {
    expect(classificarIntencao("adiciona validação e corrige o erro do cadastro").intencao).toBe("bug");
    expect(classificarIntencao("implementa o filtro e arruma a tela").intencao).toBe("feature");
  });
  it("B6: negação local zera o termo", () => {
    expect(classificarIntencao("não é bug, é comportamento esperado").intencao).toBe("desconhecida");
    expect(classificarIntencao("isso não é um problema").intencao).toBe("desconhecida");
    expect(classificarIntencao("sem erro nenhum").intencao).toBe("desconhecida");
  });
  it("B7: stack trace colado soma ao bug mesmo dentro de bloco de código", () => {
    const r = classificarIntencao("olha isso:\n```\nTypeError: x is undefined\n  at foo (a.js:10:5)\n```");
    expect(r.intencao).toBe("bug");
    expect(r.sinais).toContain("B7");
  });
  it("B8: refator + legado reforça refatoração", () => {
    const r = classificarIntencao("refatorar o módulo legado de cobrança");
    expect(r.intencao).toBe("refatoracao");
    expect(r.sinais).toContain("B8");
  });
  it("B9: vale a pena / já existe soma pedido e historico", () => {
    const r = classificarIntencao("já existe isso no sistema? vale a pena?");
    expect(r.intencao).toBe("pedido");
    expect(r.pontos.historico).toBeGreaterThan(0);
  });
  it("B10: revisar/mergear o PR é só humano; abrir o PR não", () => {
    expect(classificarIntencao("quero revisar o PR e fazer o merge").so_humano).toBe(true);
    expect(classificarIntencao("abre o PR e depois faz o merge").so_humano).toBeUndefined();
  });
  it("texto em bloco de código ou citação não pontua", () => {
    expect(classificarIntencao("```\ncorrige o bug e dá erro\n```").intencao).toBe("desconhecida");
    expect(classificarIntencao("> o cliente pediu e deu erro\nok").intencao).toBe("desconhecida");
  });
  it("sugestão de nível nunca é aplicada, só sugerida", () => {
    expect(classificarIntencao("corrige rápido a cor do botão").sugestao_nivel).toBe(2);
    expect(classificarIntencao("corrige só um ajuste pontual no erro de texto").sugestao_nivel).toBe(1);
    expect(classificarIntencao("corrige o erro de pagamento com cuidado").sugestao_nivel).toBe(4);
    expect(classificarIntencao("corrige o erro").sugestao_nivel).toBeNull();
  });
  it("ambígua não passa de média e entrega candidatas", () => {
    const r = classificarIntencao("melhora o carregamento da tela");
    expect(r.faixa).not.toBe("alta");
    expect(r.intencao === "desconhecida" || r.faixa === "media").toBe(true);
  });
  it("vazio e lixo nunca lançam", () => {
    for (const t of ["", "   ", "?", "\u0000\u0001", "😀😀😀", null as unknown as string, 42 as unknown as string]) {
      expect(() => classificarIntencao(t)).not.toThrow();
      expect(classificarIntencao(t).intencao).toBe("desconhecida");
    }
  });
  it("é determinístico (mesma entrada, mesma saída exceto o tempo)", () => {
    const a = { ...classificarIntencao("corrige o erro do login"), tempo_ms: 0 };
    const b = { ...classificarIntencao("corrige o erro do login"), tempo_ms: 0 };
    expect(a).toEqual(b);
  });
});

describe("corpus de aceite (CT-16.02)", () => {
  it("tem ao menos 200 frases e 40 adversariais", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(200);
    expect(CORPUS.filter((l) => l.adv).length).toBeGreaterThanOrEqual(40);
  });
  it("acurácia top-1 ≥ 90% nas frases rotuladas e 0 falso 'alta' em qualquer frase", () => {
    const normais = CORPUS.filter((l) => !l.adv);
    const erros: string[] = [];
    let acertos = 0;
    for (const l of normais) {
      const r = classificarIntencao(l.t);
      if (r.intencao === l.i) acertos++;
      else erros.push(`${l.i} ← ${r.intencao} (${r.confianca}) "${l.t.slice(0, 70)}"`);
    }
    const acuracia = acertos / normais.length;
    const falsosAlta = CORPUS.filter((l) => {
      const r = classificarIntencao(l.t);
      return r.faixa === "alta" && r.intencao !== l.i;
    }).map((l) => `${l.i} ≠ alta "${l.t.slice(0, 70)}"`);
    if (acuracia < 0.9 || falsosAlta.length > 0) console.log(erros.join("\n"), "\n", falsosAlta.join("\n"));
    expect(falsosAlta).toEqual([]);
    expect(acuracia).toBeGreaterThanOrEqual(0.9);
  });
  it("adversariais: nenhuma executável errada em 'alta' e injeção só vira rótulo", () => {
    for (const l of CORPUS.filter((x) => x.adv)) {
      const r = classificarIntencao(l.t);
      if (r.faixa === "alta") expect(r.intencao, l.t).toBe(l.i);
    }
  });
  it("p95 ≤ 5 ms com texto de 1 000 caracteres", () => {
    const base = "corrige o erro do login depois da atualização, o botão de entrar não funciona e a tela fica carregando ";
    const texto = base.repeat(10).slice(0, 1000);
    for (let i = 0; i < 200; i++) classificarIntencao(texto);
    const t: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const a = performance.now();
      classificarIntencao(texto);
      t.push(performance.now() - a);
    }
    t.sort((a, b) => a - b);
    expect(t[Math.floor(t.length * 0.95)] as number).toBeLessThan(5);
  });
});
