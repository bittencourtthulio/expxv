// E2E da instalação da suíte ExpxDev (D-470…) no Electron real. ESCRITO e type-checado; NÃO executado nesta entrega: rodar exige `npm run build` (e o `dist/` está em uso
// pelo `npm run dev` do dono). Usa o `npm` e o `expxdev` FALSOS de tests/fixtures/suite (nenhuma rede, nada instalado de verdade; o proxy de mentira faz o app pular a
// sondagem do registro). Os testes de núcleo, de main (processos reais) e de renderer (jsdom) cobrem a mesma lógica.
//   1) projeto sem a suíte: o botão "Instalar suíte ExpxDev" aparece no grupo DIREITO do cabeçalho, antes da cota, e o topo continua com 40 px
//   2) clicar abre o modal com o comando exato e os requisitos (✓), sem instalar nada
//   3) "Instalar agora" mostra as etapas e termina em "Pronto" com o resumo (versão e nove skills)
//   4) o botão some do cabeçalho e o lock fica gravado no projeto
//   5) Esc durante uma instalação pede confirmação; cancelar deixa o projeto como estava
//   6) módulos: ao fim da instalação o `.expxv/modulos.json` nasce com o legadox desligado; Método › Instalação mostra os nove interruptores; ligar o legadox grava no arquivo
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp, RAIZ, type AppAberto } from "./fixture";

let app: AppAberto;
let base: string;
let projeto: string;
let travado: string;

const FIX = join(RAIZ, "tests", "fixtures", "suite");
const esperar = async (cond: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > fim) throw new Error("tempo esgotado"); await new Promise((r) => setTimeout(r, 100)); }
};

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "suite-e2e-"));
  projeto = join(base, "projeto");
  travado = join(base, "projeto-travado");
  cpSync(join(FIX, "projetos", "ausente"), projeto, { recursive: true });
  cpSync(join(FIX, "projetos", "ausente"), travado, { recursive: true });
  mkdirSync(join(base, "dados"), { recursive: true });
  app = await abrirApp({
    env: {
      PATH: [join(FIX, "npm-falso"), dirname(process.execPath), process.env["PATH"] ?? ""].join(delimiter),
      FAKE_LOG: join(base, "chamadas.jsonl"), FAKE_NPM_MODO: "ok", FAKE_INIT_MODO: "ok",
      HTTPS_PROXY: "http://127.0.0.1:9",
    },
  });
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(base, { recursive: true, force: true });
});

const abrirWorkspace = (caminho: string): Promise<unknown> => app.pagina.evaluate(`window.ade.workspaces.abrir(${JSON.stringify(caminho)})`);

describe("Instalar suíte ExpxDev (Electron real, com npm falso)", () => {
  it("o botão aparece à direita, antes da cota, sem aumentar o topo", async () => {
    await abrirWorkspace(projeto);
    const botao = app.pagina.getByRole("button", { name: "Instalar suíte ExpxDev" });
    await botao.waitFor({ timeout: 30_000 });
    const caixa = (await botao.boundingBox())!;
    const busca = (await app.pagina.getByRole("button", { name: "Buscar comandos" }).boundingBox())!;
    expect(caixa.x).toBeGreaterThan(busca.x + busca.width);
    const topo = (await app.pagina.locator("header.casca-topo").boundingBox())!;
    expect(Math.round(topo.height)).toBe(40);
  });

  it("o modal mostra o comando exato e os requisitos e não instala nada sozinho", async () => {
    await app.pagina.getByRole("button", { name: "Instalar suíte ExpxDev" }).click();
    const d = app.pagina.getByRole("dialog", { name: "Instalar a suíte ExpxDev" });
    await d.waitFor();
    expect(await d.textContent()).toMatch(/expxdev@0\.9\.0/);
    expect(await d.getByRole("list", { name: "Requisitos verificados" }).textContent()).toMatch(/✓.*Node\.js/);
    expect(existsSync(join(projeto, ".expx", "expx-lock.json"))).toBe(false);
  });

  it("instala: etapas, 'Pronto', resumo e o botão some", async () => {
    await app.pagina.getByRole("button", { name: "Instalar agora" }).click();
    await app.pagina.getByRole("progressbar").waitFor();
    await app.pagina.getByRole("button", { name: "Abrir o Método" }).waitFor({ timeout: 60_000 });
    expect(await app.pagina.getByRole("dialog").textContent()).toMatch(/Versão 0\.9\.0.*instalada/);
    expect(JSON.parse(readFileSync(join(projeto, ".expx", "expx-lock.json"), "utf8")).cli_version).toBe("0.9.0");
    await app.pagina.getByRole("button", { name: "Fechar" }).click();
    await esperar(async () => (await app.pagina.getByRole("button", { name: /suíte ExpxDev/ }).count()) === 0);
  });

  it("o fim da instalação semeou .expxv/modulos.json (legadox desligado) e Método › Instalação mostra os nove módulos", async () => {
    const arquivo = join(projeto, ".expxv", "modulos.json");
    await esperar(() => existsSync(arquivo));
    const j = JSON.parse(readFileSync(arquivo, "utf8")) as { versao: number; modulos: Record<string, boolean> };
    expect(j.versao).toBe(1);
    expect(Object.keys(j.modulos)).toHaveLength(9);
    expect(j.modulos["legadox"]).toBe(false);
    expect(j.modulos["sprintx"]).toBe(true);
    await app.pagina.getByRole("button", { name: /^Método/ }).first().click().catch(() => undefined);
    await app.pagina.getByRole("tab", { name: "Instalação" }).click();
    const lista = app.pagina.getByRole("list", { name: "Módulos" });
    await lista.waitFor();
    expect(await lista.getByRole("switch").count()).toBe(9);
    const legadox = app.pagina.getByRole("switch", { name: "legadox" });
    expect(await legadox.getAttribute("aria-checked")).toBe("false");
    await legadox.click();
    await esperar(() => (JSON.parse(readFileSync(arquivo, "utf8")) as { modulos: Record<string, boolean> }).modulos["legadox"] === true);
  });

  it("Esc durante a instalação pede confirmação; cancelar deixa o projeto como estava", async () => {
    await app.fechar().catch(() => undefined);
    app = await abrirApp({
      env: {
        PATH: [join(FIX, "npm-falso"), dirname(process.execPath), process.env["PATH"] ?? ""].join(delimiter),
        FAKE_LOG: join(base, "chamadas2.jsonl"), FAKE_NPM_MODO: "ok", FAKE_INIT_MODO: "trava", HTTPS_PROXY: "http://127.0.0.1:9",
      },
    });
    await abrirWorkspace(travado);
    await app.pagina.getByRole("button", { name: "Instalar suíte ExpxDev" }).click();
    await app.pagina.getByRole("button", { name: "Instalar agora" }).click();
    await app.pagina.getByRole("progressbar").waitFor();
    await esperar(async () => existsSync(join(travado, ".claude", "skills")));
    await app.pagina.keyboard.press("Escape");
    await app.pagina.getByRole("alertdialog", { name: "Cancelar a instalação?" }).waitFor();
    await app.pagina.getByRole("button", { name: "Cancelar instalação" }).click();
    await app.pagina.getByText(/Instalação cancelada\./).first().waitFor({ timeout: 30_000 });
    expect(existsSync(join(travado, ".expx"))).toBe(false);
    expect(existsSync(join(travado, ".claude"))).toBe(false);
  });
});
