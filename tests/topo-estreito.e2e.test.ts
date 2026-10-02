import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

let a: AppAberto;

beforeAll(async () => {
  a = await abrirApp();
  // um workspace real (com git) liga o botão "Instalar suíte", a cota e o seletor de rigidez —
  // é o estado em que o cabeçalho fica mais cheio e o vazamento aparece
  const dir = mkdtempSync(join(tmpdir(), "topo-estreito-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"name":"demo","version":"1.0.0"}');
  writeFileSync(join(dir, "src", "app.ts"), "export const x = 1;\n");
  try {
    execSync("git init -q -b main && git add -A && git -c user.email=t@t -c user.name=t commit -qm demo", { cwd: dir });
  } catch {
    /* sem git, o teste segue: menos itens no topo */
  }
  await a.pagina.waitForSelector("header.casca-topo");
  await a.pagina.evaluate(async (caminho: string) => {
    await (window as unknown as { ade: { workspaces: { abrir(c: string): Promise<unknown> } } }).ade.workspaces.abrir(caminho);
  }, dir);
  await a.pagina.waitForTimeout(800);
});
afterAll(async () => {
  await a.fechar();
});

/** Em janela estreita (900 e a mínima 720) e nas intermediárias (1100 e 1280, faixa em que o nome do
 *  seletor de rigidez está visível), nada do cabeçalho pode ultrapassar a borda direita nem SOBREPOR
 *  um vizinho: os chips da direita (rigidez, cota, medidor, instalar suíte) recuam por container query
 *  e o texto cede com reticências (04-UI-UX.md, "Cabeçalho em janela estreita"). A busca continua no
 *  centro e nunca é coberta. */
describe("cabeçalho estreito (responsividade da casca)", () => {
  for (const [largura, altura] of [
    [1280, 800],
    [1100, 700],
    [900, 640],
    [720, 560],
  ] as const) {
    for (const tela of ["inicio", "terminais"] as const) {
      it(`nada do topo ultrapassa a viewport nem sobrepõe vizinho em ${largura}x${altura} (${tela})`, async () => {
        await a.app.evaluate(({ BrowserWindow }, { largura, altura }) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(largura, altura);
        }, { largura, altura });
        await a.pagina.locator(`[data-nav="item:${tela}"]`).first().click({ force: true });
        await a.pagina.waitForSelector(`[data-tela="${tela}"]:not([hidden])`);
        await a.pagina.waitForTimeout(400);
      const fora = await a.pagina.evaluate(() => {
        const innerW = window.innerWidth;
        const infração: string[] = [];
        for (const el of document.querySelectorAll(".casca-topo, .casca-topo *")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          if (r.right > innerW + 1 || r.left < -1) {
            infração.push(
              `${el.tagName.toLowerCase()}.${String(el.className).toString().split(" ")[0]} right=${Math.round(r.right)} innerW=${innerW}`,
            );
          }
        }
        // sobreposição no grupo direito: as caixas dos irmãos nunca se cruzam e o grupo não invade a busca
        const grupo = document.querySelector(".topo-direita");
        const busca = document.querySelector(".topo-busca");
        if (grupo !== null && busca !== null) {
          const rg = grupo.getBoundingClientRect();
          const rb = busca.getBoundingClientRect();
          if (rg.left < rb.right - 1) infração.push("grupo direito invade a busca central");
        }
        if (grupo !== null) {
          const visivel = (el: Element): boolean => {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") return false;
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1;
          };
          const irmaos = [...grupo.children].filter(visivel);
          for (let i = 0; i < irmaos.length; i++) {
            for (let j = i + 1; j < irmaos.length; j++) {
              const ra = irmaos[i]!.getBoundingClientRect();
              const rb2 = irmaos[j]!.getBoundingClientRect();
              if (ra.left < rb2.right - 1 && rb2.left < ra.right - 1) {
                infração.push(`sobreposição: ${String(irmaos[i]!.className)} × ${String(irmaos[j]!.className)}`);
              }
            }
          }
          // conteúdo interno nunca desenha fora da própria caixa (exceto quem elide por design ou é posicionado)
          for (const el of [...grupo.querySelectorAll("*")]) {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "absolute" || cs.position === "fixed") continue;
            if (cs.textOverflow === "ellipsis" || cs.overflowX === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (el.scrollWidth > el.clientWidth + 1) infração.push(`transbordo: ${String(el.className)}`);
          }
        }
        return { infração, overflowX: (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth };
      });
        expect(fora.infração, JSON.stringify(fora.infração)).toEqual([]);
        expect(fora.overflowX).toBe(0);
      });
    }
  }
});
