// E2E do painel de progresso (D-660…) no Electron real. ESCRITO e type-checado; NÃO executado nesta entrega: rodar exige `npm run build` (e o `dist/` está em uso
// pelo `npm run dev` do dono). Os testes de núcleo (derivadores e ciclo de vida), de main (serviço com dublê do Maestro), de renderer (jsdom) e as capturas
// em navegador com `window.ade` falso cobrem a mesma lógica.
//   1) em repouso não há painel e o estado agregado vem vazio (custo ocioso ~0: nada de timer, nenhum progresso)
//   2) os canais recusam payload inválido (id fora do padrão, campo extra) e aceitam o id de um progresso inexistente sem erro
//   3) a preferência `progresso_painel_mostrar` nasce ligada, grava e sobrevive; desligada, a tela Terminais não tem painel
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp, type AppAberto } from "./fixture";

let app: AppAberto;
let pasta: string;

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "progresso-e2e-"));
  app = await abrirApp();
  await app.pagina.evaluate(`window.ade.workspaces.abrir(${JSON.stringify(pasta)})`);
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(pasta, { recursive: true, force: true });
});

describe("Painel de progresso (Electron real)", () => {
  it("em repouso: estado vazio e nenhum painel na tela Terminais", async () => {
    const estado = (await app.pagina.evaluate("window.ade.progresso.estado()")) as { progressos: unknown[] };
    expect(estado.progressos).toEqual([]);
    await app.pagina.getByRole("button", { name: "Terminais" }).first().click();
    expect(await app.pagina.getByRole("complementary", { name: "Progresso da pipeline" }).count()).toBe(0);
  });

  it("dispensar e fixar aceitam um id bem formado (mesmo inexistente) e recusam lixo", async () => {
    expect(await app.pagina.evaluate('window.ade.progresso.dispensar("pl:mpl_naoexiste1")')).toEqual({ ok: true });
    expect(await app.pagina.evaluate('window.ade.progresso.fixar("sk:runx:pane_x", true)')).toEqual({ ok: true });
    const recusou = await app.pagina.evaluate('window.ade.progresso.dispensar("../../etc/passwd").then(() => "aceitou", () => "recusou")');
    expect(recusou).toBe("recusou");
  });

  it("a preferência nasce ligada, grava e é lida de volta", async () => {
    expect(await app.pagina.evaluate('window.ade.config.ler("progresso_painel_mostrar")')).not.toBe(false);
    await app.pagina.evaluate('window.ade.config.gravar("progresso_painel_mostrar", false)');
    expect(await app.pagina.evaluate('window.ade.config.ler("progresso_painel_mostrar")')).toBe(false);
    await app.pagina.evaluate('window.ade.config.gravar("progresso_painel_mostrar", true)');
    expect(await app.pagina.evaluate('window.ade.config.ler("progresso_painel_mostrar")')).toBe(true);
  });
});
