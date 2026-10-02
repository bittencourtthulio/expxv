// E2E de acessibilidade (T-05.05) sobre o Electron real: as 11 telas (as 7 do MVP + Squads, Versionamento, Harness e Consumo) só com teclado, foco sempre visível e sem armadilha,
// paleta (⌘K / Ctrl+Shift+P) devolvendo o foco, saída de teclado do terminal, zero diálogos nativos e prefers-reduced-motion.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { AppAberto } from "./fixture";
import { abrir, atalho, criarAmbiente, dialogosChamados, focarPainel, idsDosPaineis, prepararPrimeiraSessao, vigiarDialogos } from "./terminais-ui-ajuda";
import type { Ambiente } from "./terminais-ui-ajuda";

const MAC = process.platform === "darwin";
const TELAS = [
  { id: "inicio", rotulo: "Início" }, { id: "missoes", rotulo: "Missões" }, { id: "terminais", rotulo: "Terminais" }, { id: "metodo", rotulo: "Método" }, { id: "trabalhos", rotulo: "Trabalhos" },
  { id: "workspaces", rotulo: "Workspaces" }, { id: "provedores", rotulo: "Provedores" }, { id: "config", rotulo: "Configurações" },
  // telas das fases 6, 9 e 14 (sem <h1>: casca compacta); `pronta` = a raiz de cada uma (ou o estado vazio, sem workspace)
  { id: "squads", rotulo: "Squads", pronta: 'section[aria-label="Squads"], .estado-vazio' },
  { id: "versionamento", rotulo: "Versionamento", pronta: ".vc-tela, .estado-vazio" },
  { id: "harness", rotulo: "Harness", pronta: 'section[aria-label="Harness"], .estado-vazio' },
  { id: "consumo", rotulo: "Consumo", pronta: 'section[aria-label="Consumo"], .estado-vazio' },
] as ReadonlyArray<{ id: string; rotulo: string; pronta?: string }>;

let amb: Ambiente;
let app: AppAberto;
let nativos = 0;
const pagina = (): Page => app.pagina;

beforeAll(async () => {
  amb = criarAmbiente();
  app = await abrir(amb);
  await vigiarDialogos(app);
  app.pagina.on("dialog", (d) => { nativos += 1; void d.dismiss(); }); // alert/confirm/prompt do renderer
  await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
});
afterAll(async () => {
  await app?.fechar();
  amb.limpar();
});

interface Foco { desc: string; visivel: boolean; indicador: string; nav: boolean; xterm: boolean; corpo: boolean }

/** Descreve o elemento focado e se o foco é VISÍVEL: contorno ≥ 2 px (ou o elemento é o terminal), opacidade efetiva > 0 e dentro da janela. */
const foco = (p: Page): Promise<Foco> => p.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (el === null || el === document.body) return { desc: "body", visivel: false, indicador: "", nav: false, xterm: false, corpo: true };
  const cs = getComputedStyle(el);
  const largura = parseFloat(cs.outlineWidth);
  const contorno = cs.outlineStyle !== "none" && largura >= 2;
  let opacidade = 1;
  for (let a: HTMLElement | null = el; a !== null; a = a.parentElement) opacidade *= Number(getComputedStyle(a).opacity);
  const r = el.getBoundingClientRect();
  const dentro = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  const xterm = el.closest(".xterm") !== null;
  const nome = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
  return {
    desc: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} "${nome}"`,
    visivel: (contorno || xterm) && opacidade > 0.5 && dentro,
    indicador: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    nav: el.closest("nav") !== null, xterm, corpo: false,
  };
});

async function tabAte(p: Page, alvo: (f: Foco) => boolean, max = 40, tecla = "Tab"): Promise<Foco> {
  for (let i = 0; i < max; i++) {
    await p.keyboard.press(tecla);
    const f = await foco(p);
    if (alvo(f)) return f;
  }
  throw new Error(`o foco não chegou ao alvo em ${max} ${tecla}s: ${(await foco(p)).desc}`);
}

/** Do começo da página: Tab até o item do menu e Enter. Só teclado. */
async function irPorTeclado(p: Page, rotulo: string): Promise<void> {
  await p.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await tabAte(p, (f) => f.nav && f.desc.includes(`"${rotulo}"`), 20);
  await p.keyboard.press("Enter");
}

describe("acessibilidade, Electron real", () => {
  it("o primeiro Tab leva ao 'Pular para o conteúdo', visível, e Enter põe o foco no <main>", async () => {
    await pagina().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pagina().keyboard.press("Tab");
    const f = await foco(pagina());
    expect(f.desc).toContain("Pular para o conteúdo");
    expect(f.visivel, f.indicador).toBe(true);
    await pagina().keyboard.press("Enter");
    expect(await pagina().evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe("main");
  });

  for (const tela of TELAS) {
    it(`${tela.rotulo}: só Tab/Shift+Tab/Enter, foco sempre visível, sem armadilha e com a ordem voltando ao menu`, async () => {
      const p = pagina();
      await irPorTeclado(p, tela.rotulo);
      const base = `[data-tela="${tela.id}"]:not([hidden])`;
      const seletor = tela.pronta === undefined ? `${base} h1, ${base} .terminais-tela` : tela.pronta.split(",").map((x) => `${base} ${x.trim()}`).join(", ");
      await p.waitForSelector(seletor, { timeout: 15_000 });
      expect(await p.locator(`nav button[aria-current="page"]`).innerText()).toContain(tela.rotulo);
      // percorre toda a sequência de Tab da tela até voltar ao menu (ciclo completo = nenhuma armadilha)
      const vistos: string[] = [];
      let repetidos = 0;
      let ultimo = "";
      let voltou = false;
      for (let i = 0; i < 160 && !voltou; i++) {
        await p.keyboard.press("Tab");
        const f = await foco(p);
        if (f.corpo) { voltou = true; break; } // saiu do documento (volta pela interface do navegador)
        expect(f.visivel, `foco invisível em ${tela.rotulo}: ${f.desc} (${f.indicador})`).toBe(true);
        repetidos = f.desc === ultimo ? repetidos + 1 : 0;
        ultimo = f.desc;
        expect(repetidos, `armadilha de foco em ${tela.rotulo}: ${f.desc}`).toBeLessThan(3);
        if (f.nav || f.desc.includes("Pular para o conteúdo")) voltou = true;
        else vistos.push(f.desc);
      }
      expect(voltou, `o Tab nunca voltou ao menu em ${tela.rotulo}; passou por: ${vistos.slice(-5).join(" | ")}`).toBe(true);
      // e para trás
      for (let i = 0; i < 4; i++) {
        await p.keyboard.press("Shift+Tab");
        const f = await foco(p);
        if (!f.corpo) expect(f.visivel, `Shift+Tab sem foco visível em ${tela.rotulo}: ${f.desc} (${f.indicador})`).toBe(true);
      }
    });
  }

  it("a paleta abre pelo atalho, leva o foco ao campo e devolve o foco a quem estava antes ao fechar com Esc", async () => {
    const p = pagina();
    await irPorTeclado(p, "Início");
    const botao = p.locator(".topo-botao-busca");
    await botao.focus();
    const atalhoPaleta = MAC ? "Meta+k" : "Control+Shift+P";
    await p.keyboard.press(atalhoPaleta);
    const dialogo = p.getByRole("dialog", { name: "Paleta de comandos" });
    await dialogo.waitFor({ timeout: 10_000 });
    expect(await dialogo.getAttribute("aria-modal")).toBe("true");
    expect(await p.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("combobox");
    await p.keyboard.type("tema");
    await p.keyboard.press("ArrowDown");
    expect(await dialogo.locator('[role="option"][aria-selected="true"]').count()).toBe(1);
    await p.keyboard.press("Tab"); // foco preso: o campo é o único foco
    expect(await p.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("combobox");
    await p.keyboard.press("Escape");
    await dialogo.waitFor({ state: "detached", timeout: 5000 });
    expect(await p.evaluate(() => document.activeElement?.className)).toContain("topo-botao-busca");
    // pelo botão do topo (Enter) e de novo Esc
    await p.keyboard.press("Enter");
    await dialogo.waitFor({ timeout: 5000 });
    await p.keyboard.press("Escape");
    await dialogo.waitFor({ state: "detached", timeout: 5000 });
    expect(await p.evaluate(() => document.activeElement?.className)).toContain("topo-botao-busca");
  });

  it("seletor de workspace: Enter abre, setas navegam, Esc fecha e devolve o foco ao botão", async () => {
    const p = pagina();
    const botao = p.locator(".topo-workspace");
    await botao.focus();
    await p.keyboard.press("Enter");
    await p.getByRole("menu", { name: "Workspaces" }).waitFor({ timeout: 5000 });
    expect(await p.evaluate(() => document.activeElement?.getAttribute("role"))).toMatch(/^menuitem/);
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Escape");
    await p.getByRole("menu", { name: "Workspaces" }).waitFor({ state: "detached", timeout: 5000 });
    expect(await p.evaluate(() => document.activeElement?.className)).toContain("topo-workspace");
  });

  it("terminais por teclado: dividir, trocar de aba, fechar e SAIR do terminal (que engole o Tab)", async () => {
    const p = pagina();
    const primeira = await prepararPrimeiraSessao(p);
    await p.waitForSelector(`section[data-sessao="${primeira}"] .xterm-screen`, { timeout: 15_000 });
    await focarPainel(p, primeira);
    await p.keyboard.press("Tab"); // o xterm manda o Tab ao processo: o foco continua no terminal
    expect(await p.evaluate(() => document.activeElement?.closest(".xterm") !== null)).toBe(true);
    await p.keyboard.press(MAC ? "Meta+Shift+M" : "Control+Shift+M"); // saída de teclado
    const f = await foco(p);
    expect(f.desc).toContain("[tab]");
    expect(f.visivel, f.indicador).toBe(true);
    await p.keyboard.press("Tab"); // agora o Tab anda pela interface
    expect((await foco(p)).xterm).toBe(false);
    // dividir (⌘D / Ctrl+Shift+D), nova aba, trocar de aba pelo número, fechar painel
    await focarPainel(p, primeira);
    await p.keyboard.press(atalho("D"));
    await p.waitForFunction(() => document.querySelectorAll("section.terminais-painel[data-sessao]").length === 2, undefined, { timeout: 15_000 });
    expect(await p.locator('[role="separator"]').first().getAttribute("tabindex")).toBe("0");
    await p.keyboard.press(atalho("N"));
    await p.waitForFunction(() => document.querySelectorAll('.terminais-barra [role="tab"]').length === 2, undefined, { timeout: 15_000 });
    await p.keyboard.press(MAC ? "Meta+1" : "Control+1");
    await p.waitForFunction(() => document.querySelectorAll("section.terminais-painel[data-sessao]").length === 2, undefined, { timeout: 5000 });
    expect(await p.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
    await focarPainel(p, (await idsDosPaineis(p))[0] as string);
    await p.keyboard.press(atalho("W"));
    await p.waitForFunction(() => document.querySelectorAll("section.terminais-painel[data-sessao]").length === 1, undefined, { timeout: 10_000 });
    // as setas movem o foco entre as abas
    await p.locator('[role="tab"][aria-selected="true"]').focus();
    await p.keyboard.press("ArrowRight");
    const aposSeta = await foco(p);
    expect(aposSeta.desc).toContain("[tab]"); // a seta move só o foco; o terminal não o rouba
  });

  it("zero diálogos nativos em toda a navegação", async () => {
    expect(await dialogosChamados(app)).toBe(0);
    expect(nativos).toBe(0);
  });

  it("prefers-reduced-motion: reduce zera pulsos, giros e transições (e sem a preferência elas existem)", async () => {
    const p = pagina();
    const medir = (): Promise<{ pulso: string; gira: string; menu: string; semMovimento: string[] }> => p.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = '<section class="terminais-painel" data-atividade="aguardando"></section><span class="terminais-sinal" data-forma="anel"></span>';
      document.body.append(host);
      const pulso = getComputedStyle(host.querySelector(".terminais-painel") as Element).animationName;
      const gira = getComputedStyle(host.querySelector(".terminais-sinal") as Element).animationName;
      host.remove();
      const menu = getComputedStyle(document.querySelector(".menu-painel") as Element).transitionDuration;
      const comMovimento = [...document.querySelectorAll("*")].filter((e) => {
        const cs = getComputedStyle(e);
        return cs.animationName !== "none" || cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
      }).map((e) => e.className?.toString() ?? e.tagName);
      return { pulso, gira, menu, semMovimento: comMovimento };
    });
    await p.emulateMedia({ reducedMotion: "no-preference" });
    const normal = await medir();
    expect(normal.pulso).not.toBe("none");
    expect(normal.gira).not.toBe("none");
    expect(parseFloat(normal.menu)).toBeGreaterThan(0);
    await p.emulateMedia({ reducedMotion: "reduce" });
    const reduzido = await medir();
    expect(reduzido.pulso).toBe("none");
    expect(reduzido.gira).toBe("none");
    expect(parseFloat(reduzido.menu)).toBe(0);
    expect(reduzido.semMovimento).toEqual([]);
    await p.emulateMedia({ reducedMotion: null });
  });
});
