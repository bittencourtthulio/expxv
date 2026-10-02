// E2E do painel Gateway MCP (Fase 7C, UI) no Electron real: abrir a Loja, abrir o Gateway (diálogo), conferir que nasce DESLIGADO (opt-in) e
// que a auditoria só mostra metadados. NÃO liga o gateway nem grava configuração. ESCRITO e type-checado, NÃO executado aqui (exige `npm run
// build`; não rodar com o `npm run dev` do dono ativo). A lógica é coberta em jsdom (src/renderer/telas/loja-mcp/Gateway.test.tsx).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { criarAmbienteOrq, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

let amb: AmbienteOrq;
let pagina: Page;
let nativos = 0;

beforeAll(async () => {
  amb = await criarAmbienteOrq({});
  pagina = amb.app.pagina;
  await vigiarDialogos(amb.app);
  pagina.on("dialog", (d) => { nativos += 1; void d.dismiss(); });
}, 120_000);

afterAll(async () => {
  await amb?.fechar();
});

describe("Gateway MCP na Loja, no Electron real", () => {
  it("o botão Gateway abre o diálogo com o estado e a opção desligada por padrão", async () => {
    await pagina.locator('nav[aria-label="Principal"] button', { hasText: "Loja de MCPs" }).click();
    await pagina.waitForSelector('section[aria-label="Loja de MCPs"]', { timeout: 15_000 });
    await pagina.getByRole("button", { name: "Gateway" }).click();
    const dialogo = pagina.getByRole("dialog", { name: "Gateway MCP" });
    await dialogo.waitFor();
    await dialogo.getByText(/Desligado por padrão/).waitFor();
    const caixa = dialogo.getByLabel("Usar o Gateway neste workspace");
    if (await caixa.count() > 0) expect(await caixa.isChecked()).toBe(false);
  });

  it("a auditoria não carrega argumentos nem resultados de ferramentas", async () => {
    const dialogo = pagina.getByRole("dialog", { name: "Gateway MCP" });
    const texto = (await dialogo.textContent()) ?? "";
    expect(texto).not.toMatch(/"arguments"|"result"/);
    await pagina.keyboard.press("Escape");
  });

  it("zero diálogos nativos", async () => {
    expect(nativos).toBe(0);
    expect(await dialogosChamados(amb.app)).toBe(0);
  });
});
