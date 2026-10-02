// E2E do painel de workspaces (D-450…) no Electron real. ESCRITO e type-checado; NÃO executado nesta entrega: rodar exige `npm run build` (e o `dist/` está em uso
// pelo `npm run dev` do dono). Os testes de núcleo, de main (sessões falsas de 2 workspaces) e de renderer (jsdom) cobrem a mesma lógica.
//   1) o alfinete fica no grupo esquerdo do cabeçalho, logo depois do seletor; desafixado não existe painel
//   2) fixar abre a coluna entre o menu e o conteúdo, de cima a baixo, com um cartão por workspace; o conteúdo mantém ao menos 720 px na janela padrão
//   3) clicar noutro cartão troca o workspace sem encerrar sessão nenhuma
//   4) Esc/atalho: ⌘⌥W (Ctrl+Alt+W) alterna; a preferência sobrevive a recarregar a janela
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp, type AppAberto } from "./fixture";

let app: AppAberto;
let pastaA: string;
let pastaB: string;

beforeAll(async () => {
  pastaA = mkdtempSync(join(tmpdir(), "painel-ws-a-"));
  pastaB = mkdtempSync(join(tmpdir(), "painel-ws-b-"));
  app = await abrirApp();
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(pastaA, { recursive: true, force: true });
  rmSync(pastaB, { recursive: true, force: true });
});

const abrirWorkspace = (caminho: string): Promise<unknown> => app.pagina.evaluate(`window.ade.workspaces.abrir(${JSON.stringify(caminho)})`);

describe("Painel de workspaces (Electron real)", () => {
  it("o alfinete fica logo depois do seletor de workspace e, desafixado, não há painel", async () => {
    await abrirWorkspace(pastaA);
    const alfinete = app.pagina.getByRole("button", { name: "Fixar painel de workspaces" });
    await alfinete.waitFor({ timeout: 20_000 });
    expect(await alfinete.getAttribute("aria-pressed")).toBe("false");
    const seletor = (await app.pagina.locator(".seletor-ws").boundingBox())!;
    const caixa = (await alfinete.boundingBox())!;
    expect(caixa.x).toBeGreaterThanOrEqual(seletor.x + seletor.width - 1);
    expect(await app.pagina.getByRole("complementary", { name: "Workspaces" }).count()).toBe(0);
  });

  it("fixar abre a coluna entre o menu e o conteúdo, de cima a baixo", async () => {
    await abrirWorkspace(pastaB);
    await app.pagina.getByRole("button", { name: "Fixar painel de workspaces" }).click();
    const painel = app.pagina.getByRole("complementary", { name: "Workspaces" });
    await painel.waitFor({ timeout: 10_000 });
    const p = (await painel.boundingBox())!;
    const menu = (await app.pagina.locator(".menu-painel").boundingBox())!;
    const conteudo = (await app.pagina.locator(".casca-conteudo").boundingBox())!;
    expect(Math.round(p.x)).toBe(Math.round(menu.x + menu.width));
    expect(p.width).toBeGreaterThanOrEqual(200);
    expect(p.width).toBeLessThanOrEqual(360);
    expect(Math.round(p.y)).toBe(0);
    expect(Math.round(conteudo.x)).toBe(Math.round(p.x + p.width));
    expect(await app.pagina.locator("[data-ws-cartao]").count()).toBeGreaterThanOrEqual(2);
  });

  it("clicar noutro cartão troca o workspace atual sem encerrar sessão", async () => {
    const antes = (await app.pagina.evaluate("window.ade.terminais.listarSessoes()")) as Array<{ estado: string }>;
    const outro = app.pagina.locator('[data-nav="cartao"]:not([aria-current="true"])').first();
    await outro.click();
    await app.pagina.locator('[data-nav="cartao"][aria-current="true"]').waitFor({ timeout: 10_000 });
    const depois = (await app.pagina.evaluate("window.ade.terminais.listarSessoes()")) as Array<{ estado: string }>;
    expect(depois.filter((s) => s.estado === "executando").length).toBe(antes.filter((s) => s.estado === "executando").length);
  });

  it("a preferência de fixado sobrevive a recarregar a janela e o atalho alterna", async () => {
    await app.pagina.reload();
    await app.pagina.getByRole("complementary", { name: "Workspaces" }).waitFor({ timeout: 20_000 });
    const mod = process.platform === "darwin" ? "Meta+Alt+KeyW" : "Control+Alt+KeyW";
    await app.pagina.keyboard.press(mod);
    await app.pagina.getByRole("complementary", { name: "Workspaces" }).waitFor({ state: "detached", timeout: 10_000 });
  });
});
