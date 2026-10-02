import { describe, expect, it } from "vitest";
import { TASK_TYPES_EMBUTIDOS } from "./task-types";
import { CONFIANCA_SEM_ACERTO, PALAVRAS_CHAVE, classificar, classificarParaRoteador, normalizarTexto } from "./classificar";

// 30 frases-ouro (PT e EN): [frase, task_type esperado]
const OURO: ReadonlyArray<readonly [string, string]> = [
  ["Implementar o endpoint de listagem de pedidos conforme a task T-04.2", "implementar"],
  ["Construir a nova funcionalidade de exportação para CSV", "implementar"],
  ["Add feature: export the report as PDF", "implementar"],
  ["Corrigir o bug do botão salvar que não grava o formulário", "bug-fix"],
  ["O login quebrou depois do último deploy, conserta isso", "bug-fix"],
  ["Fix the crash when the config file is empty", "bug-fix"],
  ["Investigar a causa raiz do erro intermitente no upload de arquivos", "bug-profundo"],
  ["Tem uma race condition no worker que só acontece de vez em quando", "bug-profundo"],
  ["Find the root cause of the memory leak in the renderer", "bug-profundo"],
  ["Refatorar o módulo de contas para remover duplicação", "refatorar"],
  ["Refactor the router and rename the helper functions", "refatorar"],
  ["Ajustar o layout da tela de configurações, o CSS está quebrado no modal", "front"],
  ["Deixar o componente do botão responsivo no frontend", "front"],
  ["Auditar o plano da sprint com um olhar independente", "auditar"],
  ["Auditoria de conformidade da entrega", "auditar"],
  ["Rodar o QA da ocorrência com o roteiro de teste manual", "qa"],
  ["Homologar a entrega: validar a entrega contra o aceite", "qa"],
  ["Fazer o code review do pull request 128", "revisar-pr"],
  ["Revisar PR: olhar o diff e comentar", "revisar-pr"],
  ["Triar este pedido cru do cliente: vale a pena fazer?", "triar"],
  ["Fazer a triagem do chamado de suporte", "triar"],
  ["Planejar a feature de relatórios em fases e sprints", "planejar"],
  ["Desenhar a arquitetura e o roadmap do projeto", "planejar"],
  ["Levantar requisitos com uma entrevista de discovery", "descobrir"],
  ["Descobrir o que o usuário precisa antes de planejar", "descobrir"],
  ["Documentar a API e atualizar o README e o changelog", "docs"],
  ["Write the docs and a tutorial for the new CLI", "docs"],
  ["Fazer um pentest e procurar vulnerabilidade de XSS e injection", "seguranca-pentest"],
  ["Check OWASP top ten issues and the CVE list for dependencies", "seguranca-pentest"],
  ["Bom dia, tudo bem?", "geral"],
];

describe("classificar: 30 frases-ouro", () => {
  for (const [frase, esperado] of OURO) {
    const tipo = esperado === "seguranca-pentest" ? "pentest" : esperado;
    it(`${tipo}: ${frase.slice(0, 50)}`, () => {
      const r = classificar(frase);
      expect(r.task_type).toBe(tipo);
      if (tipo === "geral") expect(r.confianca).toBe(CONFIANCA_SEM_ACERTO);
      else expect(r.confianca).toBeGreaterThan(0.2);
      expect(r.confianca).toBeLessThanOrEqual(0.95);
    });
  }
  it("são exatamente 30 frases", () => expect(OURO).toHaveLength(30));
});

describe("classificar: contrato", () => {
  it("todo tipo das palavras-chave existe nos embutidos", () => {
    const slugs = new Set(TASK_TYPES_EMBUTIDOS.map((t) => t.slug));
    for (const t of Object.keys(PALAVRAS_CHAVE)) expect(slugs.has(t)).toBe(true);
  });
  it("sem acerto, vazio e entrada inválida viram geral 0,2 sem lançar", () => {
    for (const x of ["", "   ", "xyzzy plugh", "😀😀", undefined as unknown as string, null as unknown as string, 42 as unknown as string]) {
      expect(classificar(x)).toEqual({ task_type: "geral", confianca: 0.2 });
    }
  });
  it("ignora acento e caixa", () => {
    expect(classificar("REFATORAÇÃO do módulo").task_type).toBe("refatorar");
  });
  it("só olha os 2 000 primeiros caracteres", () => {
    const longo = `${"x ".repeat(1100)} refatorar tudo`;
    expect(classificar(longo).task_type).toBe("geral");
    expect(classificar(`refatorar tudo ${"x ".repeat(2000)}`).task_type).toBe("refatorar");
  });
  it("determinística e normalização estável", () => {
    expect(classificar(OURO[0]![0])).toEqual(classificar(OURO[0]![0]));
    expect(normalizarTexto("Ação, Rápida!")).toBe(" acao rapida ");
  });
  it("classificarParaRoteador devolve null no geral", () => {
    expect(classificarParaRoteador("oi")).toBeNull();
    expect(classificarParaRoteador("corrigir bug")?.task_type).toBe("bug-fix");
  });
});
