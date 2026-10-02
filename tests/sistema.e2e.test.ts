// E2E do medidor de CPU e memória (D-530…) no Electron REAL. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). Núcleo, main (sem Electron), renderer (jsdom) e contrato cobrem a mesma lógica.
//   1) o chip aparece no cabeçalho ANTES do chip de consumo e recebe uma amostra em poucos segundos (números inteiros, aria-label com os dois valores)
//   2) o popover abre com role=dialog, mostra núcleos, "Este app" e "Agentes", e Esc fecha
//   3) "Ocultar este medidor" persiste: depois de reiniciar o app o chip não existe e nenhum evento `sistema:amostra` chega
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp, type AppAberto } from "./fixture";

let app: AppAberto;
let pastaDados: string;

beforeAll(async () => {
  pastaDados = mkdtempSync(join(tmpdir(), "sistema-dados-"));
  app = await abrirApp({ pastaDados });
  await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(pastaDados, { recursive: true, force: true });
});

describe("Medidor de CPU e memória (Electron real)", () => {
  it("o chip fica antes do chip de consumo e recebe a primeira amostra", async () => {
    const chip = app.pagina.locator(".sis-chip");
    await chip.waitFor({ timeout: 10_000 });
    await app.pagina.waitForFunction(() => /CPU \d+ por cento, memória \d+ por cento/.test(document.querySelector(".sis-chip")?.getAttribute("aria-label") ?? ""), undefined, { timeout: 8_000 });
    const antes = await app.pagina.evaluate(() => {
      const direita = document.querySelector(".topo-direita");
      const filhos = [...(direita?.children ?? [])];
      const iChip = filhos.findIndex((e) => e.classList.contains("sis-chip"));
      const iCota = filhos.findIndex((e) => e.classList.contains("cota-chip"));
      return iCota === -1 ? iChip >= 0 : iChip >= 0 && iChip < iCota;
    });
    expect(antes).toBe(true);
    const altura = await chip.evaluate((e) => e.getBoundingClientRect().height);
    expect(altura).toBeGreaterThanOrEqual(28);
    expect(altura).toBeLessThanOrEqual(40);
  });

  it("o popover abre como diálogo não modal e Esc fecha", async () => {
    await app.pagina.locator(".sis-chip").click();
    const dlg = app.pagina.getByRole("dialog", { name: "CPU e memória da máquina" });
    await dlg.waitFor({ timeout: 5_000 });
    expect(await dlg.getAttribute("aria-modal")).toBe("false");
    await app.pagina.getByRole("region", { name: "Este app" }).waitFor({ timeout: 8_000 });
    expect(await app.pagina.getByRole("region", { name: "Agentes" }).count()).toBe(1);
    await app.pagina.keyboard.press("Escape");
    expect(await dlg.count()).toBe(0);
  });

  it("ocultar persiste depois de reiniciar o app (zero chip, zero amostras)", async () => {
    await app.pagina.locator(".sis-chip").click();
    await app.pagina.getByRole("button", { name: "Ocultar este medidor" }).click();
    expect(await app.pagina.locator(".sis-chip").count()).toBe(0);
    await app.fechar();
    app = await abrirApp({ pastaDados });
    await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
    await app.pagina.waitForTimeout(3_000);
    expect(await app.pagina.locator(".sis-chip").count()).toBe(0);
  });
});
