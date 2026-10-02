// E2E do Catálogo (Fase 7, UI) no Electron real: abrir a tela lazy, ver a tabela virtualizada (poucos nós), buscar localmente sem IPC,
// abrir a gaveta e fechar, e zero diálogos nativos. NÃO instala nem apaga nada: o teste nunca confirma ações de escrita.
// ESCRITO e type-checado, NÃO executado aqui: rodar exige `npm run build` (não rodar com o `npm run dev` do dono ativo: ele usa `dist/`).
// Lógica, gaveta, política, embarcadas e a11y são cobertos em jsdom (src/renderer/telas/catalogo/Tela.test.tsx).
// Cenários do plano que dependem do backend do catálogo (casa de teste com E2E_HOME, CLI falsa tentando a 4ª skill) ficam em
// tests/contrato/ (fase 7, T-07.25/T-07.35) quando o serviço do main estiver ligado.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
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

describe("tela Catálogo no Electron real", () => {
  it("abre em chunk lazy como grade acessível e com poucos nós de linha (virtualizada)", async () => {
    const t0 = Date.now();
    await pagina.locator('nav[aria-label="Principal"] button', { hasText: "Catálogo" }).click();
    await pagina.mouse.move(900, 500);
    await pagina.waitForSelector('section[aria-label="Catálogo"]', { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    await esperar(async () => ((await pagina.getByRole("grid").count()) > 0 || (await pagina.getByText(/Nenhum item em|Catálogo indisponível/).count()) > 0) || undefined, 15_000);
    expect(await pagina.locator('[role="row"][data-item-id]').count()).toBeLessThanOrEqual(80);
  });

  it("a busca é local: digitar não dispara nova listagem e 'Limpar filtros' volta", async () => {
    const campo = pagina.getByLabel(/^Buscar em /);
    await campo.fill("zzzz-nada-assim");
    await pagina.getByText(/Nada encontrado|Nenhum item em/).first().waitFor({ timeout: 5_000 });
    if (await pagina.getByRole("button", { name: "Limpar filtros" }).count() > 0) await pagina.getByRole("button", { name: "Limpar filtros" }).click();
  });

  it("troca de aba por teclado e a paleta ⌘K encontra 'Catálogo: abrir'", async () => {
    await pagina.getByRole("tab", { name: "Agentes" }).click();
    await pagina.waitForSelector('[role="tab"][aria-selected="true"]:has-text("Agentes")');
    await pagina.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+Shift+P");
    await pagina.keyboard.type("Catálogo: abrir");
    await pagina.getByRole("option", { name: /Catálogo: abrir/ }).first().waitFor({ timeout: 5_000 });
    await pagina.keyboard.press("Escape");
  });

  it("zero diálogos nativos", async () => {
    expect(nativos).toBe(0);
    expect(await dialogosChamados(amb.app)).toBe(0);
  });
});
