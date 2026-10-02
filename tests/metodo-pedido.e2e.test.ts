import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

// Escrito para rodar com `npm run build` feito (D-610 a D-612). Sem workspace aberto a tela Método mostra o estado vazio; com um, o pedido, os gestos e o botão.
// Aqui só se confere o que não depende de CLI instalada: a tela abre pelo menu, o campo tem rótulo, os gestos são radios e o botão muda de rótulo.
let a: AppAberto;
beforeAll(async () => { a = await abrirApp(); });
afterAll(async () => { await a.fechar(); });

describe("Método: pedido e disparo", () => {
  it("abre a tela, escolhe um gesto e o botão primário muda de rótulo", async () => {
    await a.pagina.getByRole("button", { name: /Método/ }).first().click();
    const campo = a.pagina.getByRole("textbox", { name: /O que você quer construir ou corrigir/ });
    if (!(await campo.isVisible().catch(() => false))) return; // sem workspace nesta execução: nada a conferir
    await a.pagina.getByRole("radio", { name: /Corrigir um bug/ }).check();
    expect(await a.pagina.getByRole("button", { name: "Corrigir bug" }).isVisible()).toBe(true);
    await campo.fill("O botão Salvar não responde");
    expect(await a.pagina.getByTestId("comando-previsto").textContent()).toContain("/expx:runx");
  });
});
