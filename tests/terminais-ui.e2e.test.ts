// E2E da UI de terminais sobre o Electron real (T-01.09): cliques e teclado de verdade, CLI falsa
// (tests/fixtures/cli-pty.mjs) registrada pelo gancho de teste do main, buffer do xterm lido pelo gancho
// `window.__ade_terminais` (só existe com a variável E2E do produto), nenhum diálogo nativo.
import { variavelDeAmbiente } from "../src/nucleo/produto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppAberto } from "./fixture";
import {
  abrir, atalho, buffer, criarAmbiente, dialogosChamados, digitarLinha, esperarBuffer, focarPainel, idsDosPaineis, irParaTerminais,
  ocorrencias, prepararPrimeiraSessao, vigiarDialogos,
} from "./terminais-ui-ajuda";
import type { Ambiente } from "./terminais-ui-ajuda";

const MODIFICADOR_DE_LINK = process.platform === "darwin" ? "Meta" : "Control";
let amb: Ambiente;
let app: AppAberto | null = null;
let primeira = "";
const pagina = (): AppAberto["pagina"] => (app as AppAberto).pagina;

beforeAll(() => { amb = criarAmbiente(); });
afterAll(async () => {
  await app?.fechar();
  amb.limpar();
});

const esperarPaineis = (n: number): Promise<unknown> =>
  pagina().waitForFunction((k) => document.querySelectorAll("section.terminais-painel[data-sessao]").length === k, n, { timeout: 15_000 });

describe("terminais pela UI (Electron real, CLI falsa, daemon)", () => {
  it("abrir pela UI mostra o xterm e o prompt da CLI; digitar ecoa no buffer", async () => {
    app = await abrir(amb);
    await vigiarDialogos(app);
    primeira = await prepararPrimeiraSessao(pagina());
    await pagina().waitForSelector(`section[data-sessao="${primeira}"] .xterm-screen`, { timeout: 15_000 });
    await esperarBuffer(pagina(), primeira, "pty> ");
    await digitarLinha(pagina(), primeira, "ola");
    await esperarBuffer(pagina(), primeira, "eco:ola");
    expect(ocorrencias(await buffer(pagina(), primeira), "eco:ola")).toBe(1);
  });

  it("Cmd/Ctrl+clique num link http abre externo pelo canal; clique simples não abre", async () => {
    const p = pagina();
    await app!.app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __externos: string[] };
      g.__externos = [];
      (shell as unknown as { openExternal: (u: string) => Promise<void> }).openExternal = (u) => { g.__externos.push(u); return Promise.resolve(); };
    });
    const url = "https://exemplo.test/pagina";
    await digitarLinha(p, primeira, url);
    await esperarBuffer(p, primeira, `eco:${url}`);
    // posição (px) do link na tela, calculada pelo buffer e pela geometria do xterm
    const alvo = await p.evaluate(([id, u]) => {
      const leitor = (window as unknown as { __ade_terminais: Record<string, { texto(): string; colunas(): number; linhas(): number; topo(): number }> }).__ade_terminais[id as string]!;
      const linhas = leitor.texto().split("\n");
      let y = -1;
      linhas.forEach((l, i) => { if (l.includes(`eco:${u}`)) y = i; });
      const col = (linhas[y] as string).indexOf(u as string) + 8;
      const r = document.querySelector(`section[data-sessao="${id}"] .xterm-screen`)!.getBoundingClientRect();
      return { x: r.left + (col + 0.5) * (r.width / leitor.colunas()), y: r.top + (y - leitor.topo() + 0.5) * (r.height / leitor.linhas()) };
    }, [primeira, url] as const);
    await p.mouse.click(alvo.x, alvo.y);
    await p.waitForTimeout(400);
    expect(await app!.app.evaluate(() => (globalThis as unknown as { __externos: string[] }).__externos)).toEqual([]);
    await p.keyboard.down(MODIFICADOR_DE_LINK);
    await p.mouse.click(alvo.x, alvo.y);
    await p.keyboard.up(MODIFICADOR_DE_LINK);
    await expect.poll(() => app!.app.evaluate(() => (globalThis as unknown as { __externos: string[] }).__externos), { timeout: 5_000 }).toEqual([url]);
  });

  it("busca (Cmd+F / Ctrl+Shift+F) acha texto no buffer e Esc fecha sem mandar nada ao processo", async () => {
    const p = pagina();
    await focarPainel(p, primeira);
    await p.keyboard.press(atalho("f"));
    const busca = p.getByRole("search", { name: "Buscar no terminal" });
    await busca.waitFor({ timeout: 5_000 });
    await busca.getByRole("searchbox").fill("eco:ola");
    await expect.poll(() => p.evaluate((id) => (window as unknown as { __ade_terminais: Record<string, { selecao(): string }> }).__ade_terminais[id]!.selecao(), primeira), { timeout: 5_000 }).toBe("eco:ola");
    await p.keyboard.press("Escape");
    await busca.waitFor({ state: "detached", timeout: 5_000 });
    expect(await buffer(p, primeira)).not.toContain("\x06");
  });

  it("colar mais de 20 000 caracteres pede confirmação na UI; Esc cancela e nada chega ao processo", async () => {
    const p = pagina();
    await focarPainel(p, primeira);
    await p.evaluate((id) => {
      const alvo = document.querySelector(`section[data-sessao="${id}"] textarea`) as HTMLTextAreaElement;
      const dt = new DataTransfer();
      dt.setData("text/plain", "Z".repeat(25_000));
      alvo.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, primeira);
    const dialogo = p.getByRole("dialog", { name: "Colar texto grande" });
    await dialogo.waitFor({ timeout: 5_000 });
    expect(await dialogo.innerText()).toContain("25.000");
    await p.keyboard.press("Escape");
    await dialogo.waitFor({ state: "detached", timeout: 5_000 });
    await digitarLinha(p, primeira, "depois");
    await esperarBuffer(p, primeira, "eco:depois");
    expect(await buffer(p, primeira)).not.toContain("ZZZZZZZZZZ");
    expect(await dialogosChamados(app!)).toBe(0);
  });

  it("dividir (Cmd+D / Ctrl+Shift+D) abre o segundo painel e fechar (Cmd+W / Ctrl+Shift+W) o remove", async () => {
    const p = pagina();
    await focarPainel(p, primeira);
    await p.keyboard.press(atalho("d"));
    await esperarPaineis(2);
    const [a, b] = await idsDosPaineis(p);
    expect(a).toBe(primeira);
    await esperarBuffer(p, b as string, "pty> ");
    await p.keyboard.press(atalho("w")); // fecha o painel em foco (o novo)
    await esperarPaineis(1);
    expect(await idsDosPaineis(p)).toEqual([primeira]);
  });

  it("recarregar o renderer traz o painel de volta sem duplicar a saída", async () => {
    const p = pagina();
    await p.reload();
    await p.waitForLoadState("domcontentloaded");
    await irParaTerminais(p);
    await esperarPaineis(1);
    expect(await idsDosPaineis(p)).toEqual([primeira]);
    await esperarBuffer(p, primeira, "eco:depois");
    const texto = await buffer(p, primeira);
    expect(ocorrencias(texto, "eco:ola")).toBe(1);
    expect(ocorrencias(texto, "eco:depois")).toBe(1);
    expect(ocorrencias(texto, "pty> ")).toBeGreaterThanOrEqual(1);
    await digitarLinha(p, primeira, "pos-reload");
    await esperarBuffer(p, primeira, "eco:pos-reload");
    expect(ocorrencias(await buffer(p, primeira), "eco:ola")).toBe(1);
  });

  it("fechar o app e reabrir com a mesma pasta restaura layout e sessões (daemon)", async () => {
    const p = pagina();
    await focarPainel(p, primeira);
    await p.keyboard.press(atalho("d"));
    await esperarPaineis(2);
    const [, segunda] = await idsDosPaineis(p);
    await esperarBuffer(p, segunda as string, "pty> ");
    await digitarLinha(p, segunda as string, "segunda");
    await esperarBuffer(p, segunda as string, "eco:segunda");
    await p.waitForTimeout(1_000); // o layout é gravado com atraso (debounce)
    await app!.fechar(); // pasta de dados informada: não é apagada
    app = await abrir(amb);
    await vigiarDialogos(app);
    await irParaTerminais(pagina());
    await esperarPaineis(2);
    expect(await idsDosPaineis(pagina())).toEqual([primeira, segunda]);
    await esperarBuffer(pagina(), primeira, "eco:pos-reload");
    await esperarBuffer(pagina(), segunda as string, "eco:segunda");
    expect(ocorrencias(await buffer(pagina(), primeira), "eco:ola")).toBe(1);
    expect(ocorrencias(await buffer(pagina(), segunda as string), "eco:segunda")).toBe(1);
    await digitarLinha(pagina(), segunda as string, "de-novo");
    await esperarBuffer(pagina(), segunda as string, "eco:de-novo");
    expect(await dialogosChamados(app)).toBe(0);
  });

  it("fecha os painéis pela UI e o daemon não guarda nada", async () => {
    const p = pagina();
    for (let n = (await idsDosPaineis(p)).length; n > 0; n--) await p.locator('section.terminais-painel button[title="Fechar painel"]').first().click();
    await esperarPaineis(0);
    const vivas = await p.evaluate(() => (window as unknown as { ade: { terminais: { listarSessoes(): Promise<unknown[]> } } }).ade.terminais.listarSessoes());
    expect(vivas).toEqual([]);
  });

  it("sem a variável E2E o gancho do buffer não existe", async () => {
    await app!.fechar();
    // a fixture define a variável `E2E` do produto como 1; aqui a desligamos
    app = await abrir(amb, { [variavelDeAmbiente("E2E")]: "0" });
    await irParaTerminais(pagina());
    await pagina().waitForTimeout(500);
    expect(await pagina().evaluate(() => ({ marca: (window as unknown as { __ade_e2e?: unknown }).__ade_e2e, mapa: (window as unknown as { __ade_terminais?: unknown }).__ade_terminais }))).toEqual({ marca: undefined, mapa: undefined });
  });
});
