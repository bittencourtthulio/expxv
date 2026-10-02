// E2E do conhecimento e do chat (Fase 15, onda 2) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). Os testes de núcleo, de main e de renderer (jsdom) cobrem a mesma lógica.
// As CLIs são as falsas de `fixtures/cli-agente.mjs` (cli-orq + registro do que cada Pane recebeu); nada sai da máquina.
//   1) Conhecimento abre lazy pelo menu: uma linha de controles com as 6 abas; projeto sem índice mostra o estado vazio com o próximo passo
//   2) "Indexar docs e commits agora" popula o índice; o grafo desenha os nós e o clique no canvas abre o detalhe do nó
//   3) a aba Lista é o equivalente acessível (mesmos nós, teclado) e abre o mesmo detalhe
//   4) o atalho do Chat abre a tela; no modo orquestrador, "preciso implementar X" devolve um plano com Aprovar/Editar/Cancelar
//      e as ações humanas (D-21) listadas; Cancelar não executa nada
//   5) zero diálogos nativos em todo o fluxo
import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface JanelaConhecimento {
  ade: {
    conhecimento: {
      estado(ws: string): Promise<{ documentos: number; chunks: number; ativo: boolean }>;
      purgar(ws: string, confirmacao: string): Promise<{ removidos: number }>;
    };
  };
}

let amb: AmbienteOrq;
beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  await vigiarDialogos(amb.app);
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

const pagina = () => amb.app.pagina;
const irPara = async (rotulo: string, seletor: string): Promise<void> => {
  await pagina().locator('nav[aria-label="Principal"] button', { hasText: rotulo }).click();
  await pagina().mouse.move(900, 500); // o menu lateral abre por cima com o mouse em cima dele
  await pagina().waitForSelector(seletor, { timeout: 15_000 });
};
const estado = () => pagina().evaluate((ws) => (window as unknown as JanelaConhecimento).ade.conhecimento.estado(ws), amb.wsId);
const nosNoCanvas = async (): Promise<number> => Number(await pagina().locator("section.conhecimento canvas").getAttribute("data-nos") ?? "0");

describe("conhecimento e chat no Electron real", () => {
  it("abre pela navegação com uma linha de controles e as 6 abas; sem índice mostra o estado vazio", async () => {
    await irPara("Conhecimento", "section.conhecimento");
    // projeto sem conhecimento: garante o estado vazio (o nome do workspace é a confirmação digitada)
    await pagina().evaluate(([ws, nome]) => (window as unknown as JanelaConhecimento).ade.conhecimento.purgar(ws as string, nome as string), [amb.wsId, basename(amb.raiz)]);
    await pagina().getByRole("button", { name: "Recarregar grafo" }).click();
    const abas = await pagina().locator('section.conhecimento [role="tablist"] [role="tab"]').allTextContents();
    expect(abas).toEqual(["Grafo", "Lista", "Fontes", "Aprendizados", "Backend", "Config"]);
    await pagina().getByText("Ainda não há conhecimento neste projeto").waitFor({ timeout: 10_000 });
    expect(await pagina().getByRole("button", { name: "Indexar docs e commits agora" }).isVisible()).toBe(true);
  });

  it("indexar docs e commits popula o índice; o grafo desenha os nós e o clique no canvas abre o detalhe", async () => {
    await pagina().getByRole("button", { name: "Indexar docs e commits agora" }).click();
    await esperar(async () => (await estado()).documentos > 0, 60_000, 250);
    await pagina().getByRole("button", { name: "Recarregar grafo" }).click();
    await esperar(async () => (await nosNoCanvas()) > 0, 30_000, 250);
    const caixa = await pagina().locator("section.conhecimento canvas").boundingBox();
    expect(caixa).not.toBeNull();
    const c = caixa as { x: number; y: number; width: number; height: number };
    // varre uma grade de pontos até acertar um nó (o grafo vem enquadrado no canvas)
    let abriu = false;
    for (let i = 1; i < 12 && !abriu; i++) {
      for (let j = 1; j < 12 && !abriu; j++) {
        await pagina().mouse.click(c.x + (c.width * i) / 12, c.y + (c.height * j) / 12);
        abriu = (await pagina().locator('aside[aria-label="Detalhe do nó"] h2').count()) > 0;
      }
    }
    expect(abriu).toBe(true);
    await pagina().getByText("Fontes", { exact: true }).first().waitFor({ timeout: 5_000 });
  });

  it("a aba Lista tem os mesmos nós e abre o detalhe pelo teclado", async () => {
    const nos = await nosNoCanvas();
    await pagina().getByRole("tab", { name: "Lista" }).click();
    const lista = pagina().getByRole("list", { name: "Nós do grafo de conhecimento" });
    await lista.waitFor({ timeout: 10_000 });
    expect(Number(await lista.getAttribute("data-total"))).toBe(nos);
    const primeiro = lista.getByRole("button").first();
    await primeiro.focus();
    await pagina().keyboard.press("Enter");
    await pagina().locator('aside[aria-label="Detalhe do nó"] h2').waitFor({ timeout: 10_000 });
  });

  it("o atalho abre o Chat; 'preciso implementar X' no modo orquestrador devolve o plano para aprovar; cancelar não executa nada", async () => {
    await pagina().keyboard.press("ControlOrMeta+Shift+K");
    await pagina().waitForSelector("section.chat", { timeout: 15_000 });
    await pagina().getByRole("radio", { name: "Pedir ao orquestrador" }).click();
    const composer = pagina().getByRole("textbox", { name: /Mensagem para/ });
    await composer.fill("preciso implementar X");
    await composer.press("Enter");
    const plano = pagina().getByRole("region", { name: /^Plano:/ });
    await plano.waitFor({ timeout: 60_000 });
    for (const b of ["Aprovar", "Editar", "Cancelar"]) expect(await plano.getByRole("button", { name: b }).isVisible()).toBe(true);
    expect(await plano.getByRole("heading", { name: "Ficam com você (D-21)" }).count()).toBe(1);
    await plano.getByRole("button", { name: "Cancelar" }).click();
    await plano.getByText("cancelado").waitFor({ timeout: 10_000 });
  });

  it("zero diálogos nativos em todo o fluxo", async () => {
    expect(await dialogosChamados(amb.app)).toBe(0);
  });
});
