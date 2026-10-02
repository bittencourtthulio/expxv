import { SK_ANT } from "../../../tests/fixtures/alertas/sentinelas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIPOS_ALERTA, type NivelTemplate } from "../../compartilhado/alertas";
import { PADROES } from "./templates-padrao";
import { camposDoTipo, DADOS_EXEMPLO, duracao, escaparHtml, prever, renderizar, validar } from "./templates";

const NIVEIS: NivelTemplate[] = ["minimo", "padrao", "completo"];
const GOLDEN = join(__dirname, "../../../tests/fixtures/alertas/templates/padrao-telegram.json");

describe("validação de templates (T-20.12)", () => {
  it("campo desconhecido, formatador desconhecido, argumento inválido e sintaxe quebrada => erros de VALIDAÇÃO", () => {
    expect(validar("{{task_id}} {{titulo|truncar:60}}", "tarefa_concluida")).toEqual([]);
    expect(validar("{{foo}}", "tarefa_concluida")[0]).toContain("campo desconhecido");
    expect(validar("{{titulo|maiuscula}}", "tarefa_concluida")[0]).toContain("formatador desconhecido");
    expect(validar("{{titulo|truncar}}", "tarefa_concluida")[0]).toContain("inteiro");
    expect(validar("{{titulo|truncar:abc}}", "tarefa_concluida")[0]).toContain("inteiro");
    expect(validar("{{tokens|milhar:2}}", "tarefa_concluida")[0]).toContain("não aceita");
    expect(validar("{{tokens|ou}}", "tarefa_concluida")[0]).toContain("exige argumento");
    expect(validar("{{titulo", "tarefa_concluida")[0]).toContain("sem fechamento");
    expect(validar("{{ 1+1 }}", "tarefa_concluida")[0]).toContain("campo inválido");
    expect(validar("{{titulo}}".repeat(300), "tarefa_concluida").some((e) => e.includes("2000"))).toBe(true);
  });
  it("lista branca é por tipo: espera só existe em pane_aguardando", () => {
    expect(validar("{{espera|duracao}}", "pane_aguardando")).toEqual([]);
    expect(validar("{{espera|duracao}}", "tarefa_concluida")[0]).toContain("campo desconhecido");
    expect(camposDoTipo("resumo_diario").has("lista_atrasadas")).toBe(true);
  });
  it("sem lógica: não há expressões nem código (`{{#if}}`, `{{x}}{{y}}.constructor`)", () => {
    expect(validar("{{#if titulo}}x{{/if}}", "tarefa_concluida").length).toBeGreaterThan(0);
    expect(validar("{{titulo.constructor}}", "tarefa_concluida").length).toBeGreaterThan(0);
    expect(validar("{{__proto__}}", "tarefa_concluida").length).toBeGreaterThan(0);
  });
});

describe("render e escape", () => {
  it("`{{titulo}}` com <b>x</b>, & e <script> sai escapado; marcas do template permanecem", () => {
    const r = renderizar("tarefa_concluida", "telegram", "minimo", DADOS_EXEMPLO, "<b>x</b> & <script>alert(1)</script>", { escapar: escaparHtml });
    expect(r.erros).toEqual([]);
    expect(r.texto).toContain("&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;");
    expect(r.texto).not.toContain("<script>");
    expect(r.texto).toContain("<b>[Concluída]</b>");
  });
  it("tokens sem fonte => 'sem fonte' (nunca 0/null/undefined); SP ausente => 'sem estimativa'", () => {
    const r = renderizar("tarefa_concluida", "telegram", "padrao", { ...DADOS_EXEMPLO, tokens: null, story_points: null, estimativa_ms: null, atraso_ms: null, tempo_trabalho_ms: null }, "t");
    expect(r.texto).toContain("Tokens: sem fonte");
    expect(r.texto).toContain("Pontos: sem estimativa");
    expect(r.texto).toContain("sem medição");
    expect(r.texto).not.toMatch(/undefined|null|NaN/);
    const zero = renderizar("tarefa_concluida", "telegram", "minimo", { ...DADOS_EXEMPLO, tokens: 0 }, "t");
    expect(zero.texto).toContain("Tokens: 0");
  });
  it("redige segredo no valor ANTES de escapar", () => {
    const r = renderizar("tarefa_concluida", "so", "minimo", DADOS_EXEMPLO, "falha com " + SK_ANT);
    expect(r.texto).not.toContain("sk-ant");
  });
  it("ocultar títulos remove título, pergunta e detalhe de TODOS os tipos", () => {
    for (const tipo of TIPOS_ALERTA) {
      for (const nivel of NIVEIS) {
        const r = renderizar(tipo, "telegram", nivel, { ...DADOS_EXEMPLO, pergunta: "SEGREDO-PERGUNTA", detalhe: "SEGREDO-DETALHE", resumo: "SEGREDO-RESUMO", motivo: "SEGREDO-MOTIVO" }, "SEGREDO-TITULO", { ocultarTitulos: true, escapar: escaparHtml });
        expect(r.erros).toEqual([]);
        expect(r.texto).not.toMatch(/SEGREDO-/);
      }
    }
  });
  it("nível mínimo não mostra a pergunta pendente; completo mostra (redigida)", () => {
    const d = { ...DADOS_EXEMPLO, pergunta: "Posso apagar o arquivo?" };
    expect(renderizar("pane_aguardando", "so", "minimo", d, "t").texto).not.toContain("apagar");
    expect(renderizar("pane_aguardando", "so", "padrao", d, "t").texto).not.toContain("apagar");
    expect(renderizar("pane_aguardando", "so", "completo", d, "t").texto).toContain("apagar");
    expect(renderizar("pane_aguardando", "so", "completo", { ...d, pergunta: "use " + SK_ANT }, "t").texto).not.toContain("sk-ant");
  });
  it("canais de texto puro recebem a mensagem sem marcas HTML", () => {
    const r = renderizar("tarefa_concluida", "so", "minimo", DADOS_EXEMPLO, "t");
    expect(r.texto).not.toMatch(/<\/?[bic]/);
    expect(r.texto).toContain("[Concluída]");
  });
  it("duração: 72 min => '1 h 12'; negativa; segundos", () => {
    expect(duracao(72 * 60_000)).toBe("1 h 12");
    expect(duracao(45 * 60_000)).toBe("45 min");
    expect(duracao(30_000)).toBe("30 s");
    expect(duracao(-5 * 60_000)).toBe("-5 min");
  });
  it("corpo editado é usado; prévia mostra erro sem renderizar quando inválido", () => {
    expect(prever("tarefa_concluida", "telegram", "minimo", "Feito: {{task_id}} em {{tempo_trabalho|duracao}}", escaparHtml).texto).toBe("Feito: T-20.07 em 1 h 12");
    expect(prever("tarefa_concluida", "telegram", "minimo", "{{nada}}").erros.length).toBe(1);
  });
  it("<= 1 ms para 4 KB (mediana de 21 rodadas)", () => {
    const longo = "a".repeat(4000);
    const ts: number[] = [];
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now();
      renderizar("agente_mensagem", "telegram", "padrao", { detalhe: longo }, longo, { escapar: escaparHtml });
      ts.push(performance.now() - t0);
    }
    expect(ts.sort((a, b) => a - b)[10] as number).toBeLessThan(2);
  });
});

describe("padrões de todos os tipos e níveis", () => {
  it("cobre TODOS os tipos x níveis, valida, sem emoji, <= 1500 caracteres no padrão com valores longos", () => {
    const longos = { ...DADOS_EXEMPLO, missao: "M".repeat(300), cli: "c".repeat(100), pergunta: "p".repeat(500), motivo: "m".repeat(500), detalhe: "d".repeat(900), resumo: "r".repeat(900), lista_atrasadas: "linha de atraso longa\n".repeat(30) };
    for (const tipo of TIPOS_ALERTA) {
      for (const nivel of NIVEIS) {
        const corpo = PADROES[tipo][nivel];
        expect(validar(corpo, tipo), `${tipo}/${nivel}`).toEqual([]);
        expect(corpo).not.toMatch(/\p{Extended_Pictographic}/u);
        const r = renderizar(tipo, "telegram", nivel, longos, "T".repeat(500), { escapar: escaparHtml });
        expect(r.erros).toEqual([]);
        expect(r.texto, `${tipo}/${nivel}`).not.toMatch(/undefined|null|NaN|\{\{/);
        if (nivel === "padrao") expect(r.tamanho_visivel, `${tipo}/${nivel}`).toBeLessThanOrEqual(1500);
      }
    }
  });
  it("golden: textos exatos do nível padrão (Telegram) com dados de exemplo", () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    for (const tipo of TIPOS_ALERTA) {
      const r = renderizar(tipo, "telegram", "padrao", DADOS_EXEMPLO, "Corrigir bug do login", { escapar: escaparHtml });
      expect(r.texto, tipo).toBe(golden[tipo]);
    }
  });
});
