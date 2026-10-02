import { describe, expect, it } from "vitest";
import type { GestoMetodo } from "../../compartilhado/dominio";
import { SKILLS_SOMENTE_HUMANO, avaliarPaneDestino, comandoDeSkill, comandoSugerido, harnessDaCli, motivoRecusaDeEntrada, normalizarArgumento, type TrabalhoParaComando } from "./comandos";

const feature: TrabalhoParaComando = { id: "cobranca-pix", tipo: "feature" };
const ocorrencia: TrabalhoParaComando = { id: "OC-2026-0142-frete-errado", tipo: "ocorrencia" };
const projeto: TrabalhoParaComando = { id: "proj-loja", tipo: "projeto" };
const pedido: TrabalhoParaComando = { id: "PD-2026-0007", tipo: "pedido", prodx: { veredito: null, assinado: false } };

describe("prefixo por harness", () => {
  it("Claude Code usa /expx:, OpenCode não usa prefixo", () => {
    expect(comandoSugerido("nova_feature", null, "claude", "cobrar por pix").comando).toBe("/expx:sprintx cobrar por pix");
    expect(comandoSugerido("nova_feature", null, "opencode", "cobrar por pix").comando).toBe("/sprintx cobrar por pix");
  });

  it("CLI sem suporte devolve mensagem explicativa e nenhum comando", () => {
    for (const cli of ["codex", "gemini", "terminal", null]) {
      const r = comandoSugerido("nova_feature", null, cli, "x");
      expect(r.comando).toBe("");
      expect(r.somente_humano).toBe(false);
      expect(r.motivo_bloqueio).toMatch(/Claude Code e OpenCode/);
    }
  });

  it("harnessDaCli só conhece claude e opencode", () => {
    expect(harnessDaCli("claude")).toBe("claude");
    expect(harnessDaCli("opencode")).toBe("opencode");
    expect(harnessDaCli("codex")).toBeNull();
    expect(harnessDaCli(undefined)).toBeNull();
  });
});

describe("mapa gesto → comando (sempre com argumento)", () => {
  const casos: Array<[GestoMetodo, TrabalhoParaComando | null, string | null, string]> = [
    ["nova_feature", null, "exportar csv", "/expx:sprintx exportar csv"],
    ["nova_ocorrencia", null, "frete errado no checkout", "/expx:runx frete errado no checkout"],
    ["pedido_cru", null, "seria bom exportar pdf", "/expx:prodx-triar seria bom exportar pdf"],
    ["projeto", null, "sistema de pedidos", "/expx:buildx sistema de pedidos"],
    ["retomar", feature, null, "/expx:sprintx cobranca-pix"],
    ["retomar", ocorrencia, null, "/expx:runx OC-2026-0142"],
    ["retomar", projeto, null, "/expx:buildx-retomar proj-loja"],
    ["retomar", pedido, null, "/expx:prodx-avaliar PD-2026-0007"],
    ["auditar", feature, null, "/expx:sprintx-auditoria cobranca-pix"],
    ["qa", ocorrencia, null, "/expx:runx-qa OC-2026-0142"],
    ["entrega_check", feature, null, "/expx:mergex-check cobranca-pix"],
    ["entrega_atencao", feature, null, "/expx:mergex-atencao cobranca-pix"],
    ["entrega_qa", ocorrencia, null, "/expx:mergex-qa OC-2026-0142-frete-errado"],
    ["entrega_pr", feature, null, "/expx:mergex-pr cobranca-pix"],
  ];
  it.each(casos)("%s (%s)", (gesto, trabalho, arg, esperado) => {
    const r = comandoSugerido(gesto, trabalho, "claude", arg);
    expect(r.comando).toBe(esperado);
    expect(r.motivo_bloqueio).toBeNull();
    expect(r.somente_humano).toBe(false);
  });

  it("argumento é obrigatório: sem ele não há comando (a skill perguntaria e travaria o Pane)", () => {
    for (const g of ["nova_feature", "nova_ocorrencia", "pedido_cru", "projeto"] as GestoMetodo[]) {
      for (const arg of [null, "", "   \n\t "]) {
        const r = comandoSugerido(g, null, "claude", arg);
        expect(r.comando).toBe("");
        expect(r.motivo_bloqueio).toMatch(/argumento/i);
      }
    }
    for (const g of ["retomar", "auditar", "qa", "entrega_check", "entrega_atencao", "entrega_qa", "entrega_pr"] as GestoMetodo[]) {
      const r = comandoSugerido(g, null, "claude", null);
      expect(r.comando).toBe("");
      expect(r.motivo_bloqueio).toMatch(/trabalho/i);
    }
  });

  it("o argumento vira uma linha só, sem controle, e com tamanho limitado", () => {
    expect(normalizarArgumento("  linha 1\nlinha 2\t\tfim  ")).toBe("linha 1 linha 2 fim");
    expect(normalizarArgumento("a\u001b[31mb\u0000c")).toBe("a[31mbc");
    // C1 (CSI 0x9b), separadores de linha/parágrafo e bidi/invisíveis também saem (nenhum terminal os interpreta)
    expect(normalizarArgumento("a\u009b31mb\u0085c\u2028d\u2029e\u202ef\u2066g\u200bh\ufeffi")).toBe("a31mbcdefghi");
    expect(normalizarArgumento("x".repeat(5000))?.length).toBe(1_500);
    expect(normalizarArgumento("   ")).toBeNull();
    expect(normalizarArgumento(undefined)).toBeNull();
    const r = comandoSugerido("nova_feature", null, "claude", "a\nb");
    expect(r.comando).toBe("/expx:sprintx a b");
  });

  it("gesto que não se aplica ao tipo do trabalho é recusado com motivo", () => {
    expect(comandoSugerido("qa", feature, "claude").motivo_bloqueio).toMatch(/ocorrência/);
    expect(comandoSugerido("auditar", ocorrencia, "claude").motivo_bloqueio).toMatch(/feature/);
    expect(comandoSugerido("entrega_pr", pedido, "claude").comando).toBe("");
    expect(comandoSugerido("entrega_pr", projeto, "claude").comando).toBe("");
  });
});

describe("Pane separado para avaliadores (D-21)", () => {
  it("auditar, qa e entrega_atencao pedem Pane separado; os demais não", () => {
    expect(comandoSugerido("auditar", feature, "claude").pane_separado).toBe(true);
    expect(comandoSugerido("qa", ocorrencia, "claude").pane_separado).toBe(true);
    expect(comandoSugerido("entrega_atencao", feature, "claude").pane_separado).toBe(true);
    for (const g of ["nova_feature", "retomar", "entrega_check", "entrega_qa", "entrega_pr"] as GestoMetodo[]) {
      expect(comandoSugerido(g, feature, "claude", "x").pane_separado).toBe(false);
    }
  });

  it("avaliador não entra no Pane do implementador; implementador não entra no Pane do revisor", () => {
    expect(avaliarPaneDestino("auditar", { estado: "pronto", papel: "executor" })).toMatchObject({ ok: false });
    expect(avaliarPaneDestino("auditar", { estado: "pronto", papel: "piloto" })).toMatchObject({ ok: false });
    expect(avaliarPaneDestino("auditar", { estado: "pronto", papel: "revisor" })).toEqual({ ok: true });
    expect(avaliarPaneDestino("auditar", null)).toEqual({ ok: true });
    expect(avaliarPaneDestino("retomar", { estado: "pronto", papel: "revisor" })).toMatchObject({ ok: false });
    expect(avaliarPaneDestino("retomar", { estado: "pronto", papel: "executor" })).toEqual({ ok: true });
  });
});

describe("ações sempre humanas nunca disparam", () => {
  it("mergex-revisar é bloqueada com motivo, em qualquer harness", () => {
    expect(SKILLS_SOMENTE_HUMANO).toContain("mergex-revisar");
    for (const h of ["claude", "opencode"]) {
      const r = comandoDeSkill("mergex-revisar", "cobranca-pix", h);
      expect(r).toMatchObject({ comando: "", somente_humano: true });
      expect(r.motivo_bloqueio).toMatch(/humana/);
    }
  });

  it("assinatura do prodx pendente: retomar o pedido leva ao arquivo, não dispara", () => {
    const assinar: TrabalhoParaComando = { id: "PD-2026-0007", tipo: "pedido", prodx: { veredito: "fazer", assinado: false } };
    const r = comandoSugerido("retomar", assinar, "claude");
    expect(r).toMatchObject({ comando: "", somente_humano: true });
    expect(r.motivo_bloqueio).toMatch(/assinatura/i);
    const assinado: TrabalhoParaComando = { ...assinar, prodx: { veredito: "fazer", assinado: true } };
    expect(comandoSugerido("retomar", assinado, "claude").somente_humano).toBe(false);
  });

  it("aprovação de raio ALTO pendente bloqueia retomar e a entrega", () => {
    const alto: TrabalhoParaComando = { id: "exportar-csv", tipo: "feature", raio: { faixa: "alto", aprovado: false } };
    for (const g of ["retomar", "entrega_check", "entrega_pr"] as GestoMetodo[]) {
      const r = comandoSugerido(g, alto, "claude");
      expect(r).toMatchObject({ comando: "", somente_humano: true });
      expect(r.motivo_bloqueio).toMatch(/raio ALTO/);
    }
    expect(comandoSugerido("retomar", { ...alto, raio: { faixa: "alto", aprovado: true } }, "claude").comando).toBe("/expx:sprintx exportar-csv");
    expect(comandoSugerido("retomar", { ...alto, raio: { faixa: "baixo", aprovado: false } }, "claude").comando).toBe("/expx:sprintx exportar-csv");
  });

  it("comandoDeSkill de uma skill comum segue a mesma regra de prefixo e argumento", () => {
    expect(comandoDeSkill("sprintx", "x", "opencode").comando).toBe("/sprintx x");
    expect(comandoDeSkill("sprintx", "", "claude").motivo_bloqueio).toMatch(/argumento/i);
    expect(comandoDeSkill("skill; rm -rf", "x", "claude").comando).toBe("");
  });
});

describe("Pane que não deve receber entrada", () => {
  it("aguardando, trabalhando, iniciando, bloqueado e encerrado recusam; pronto aceita", () => {
    expect(motivoRecusaDeEntrada("aguardando")).toBe("aguardando");
    expect(motivoRecusaDeEntrada("trabalhando")).toBe("trabalhando");
    expect(motivoRecusaDeEntrada("iniciando")).toBe("iniciando");
    expect(motivoRecusaDeEntrada("bloqueado")).toBe("bloqueado");
    expect(motivoRecusaDeEntrada("encerrado")).toBe("encerrado");
    expect(motivoRecusaDeEntrada("pronto")).toBeNull();
  });

  it("o reenvio a um Pane aguardando é negado com mensagem para a UI", () => {
    const r = avaliarPaneDestino("retomar", { estado: "aguardando", papel: "executor" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { motivo: string }).motivo).toMatch(/aguardando/);
  });
});
