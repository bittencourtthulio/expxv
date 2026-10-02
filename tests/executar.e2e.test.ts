// E2E de "Executar projeto" (D-430…) no Electron real. ESCRITO e type-checado; NÃO executado nesta entrega: rodar exige `npm run build` (e o `dist/` está em uso
// pelo `npm run dev` do dono). Os testes de núcleo, de main (processos reais) e de renderer (jsdom) cobrem a mesma lógica.
//   1) o botão ▶ aparece no grupo ESQUERDO do cabeçalho (antes do campo de busca) e o topo continua com 40 px
//   2) sem configuração detectada: clicar abre o assistente "Configurar execução do projeto"
//   3) projeto com `.expxv/executar.json` (script próprio): clicar pede confiança com o comando exato; "Confiar neste projeto e executar" roda
//   4) vira ■ Parar, mostra a porta detectada no chip e abre a aba "Execução" na tela Terminais
//   5) F5 para (alterna) e o processo morre (sem órfão); fechar o app não deixa processo vivo
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUTO } from "../src/nucleo/produto";
import { abrirApp, type AppAberto } from "./fixture";

let app: AppAberto;
let projeto: string;
let semConfig: string;
const MARCA = `e2e-executar-${process.pid}`;

const vivos = (): number => execFileSync("ps", ["-axww", "-o", "command"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n").filter((l) => l.includes(MARCA) && !l.includes("grep")).length;
const esperar = async (cond: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > fim) throw new Error("tempo esgotado"); await new Promise((r) => setTimeout(r, 100)); }
};

beforeAll(async () => {
  projeto = mkdtempSync(join(tmpdir(), "executar-e2e-"));
  semConfig = mkdtempSync(join(tmpdir(), "executar-e2e-vazio-"));
  writeFileSync(join(projeto, "servir.sh"), `#!/bin/sh\necho "ready on http://localhost:4455/"\nsleep 300\n`);
  chmodSync(join(projeto, "servir.sh"), 0o755);
  mkdirSync(join(projeto, PRODUTO.pastaNoProjeto), { recursive: true });
  writeFileSync(join(projeto, PRODUTO.pastaNoProjeto, "executar.json"), JSON.stringify({
    versao: 1, padrao: "servir",
    configuracoes: [{ id: "servir", nome: "Servir (e2e)", tipo: "rodar", executavel: "./servir.sh", argumentos: [MARCA], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null, abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null }],
  }));
  app = await abrirApp();
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(projeto, { recursive: true, force: true });
  rmSync(semConfig, { recursive: true, force: true });
});

const abrirWorkspace = (caminho: string): Promise<unknown> => app.pagina.evaluate(`window.ade.workspaces.abrir(${JSON.stringify(caminho)})`);

describe("Executar projeto (Electron real)", () => {
  it("o botão ▶ fica no grupo esquerdo do cabeçalho, antes da busca, sem aumentar o topo", async () => {
    await abrirWorkspace(semConfig);
    const botao = app.pagina.getByRole("button", { name: /^Executar projeto/ });
    await botao.waitFor({ timeout: 20_000 });
    const caixaBotao = (await botao.boundingBox())!;
    const caixaBusca = (await app.pagina.getByRole("button", { name: "Buscar comandos" }).boundingBox())!;
    expect(caixaBotao.x + caixaBotao.width).toBeLessThan(caixaBusca.x);
    const topo = (await app.pagina.locator("header.casca-topo").boundingBox())!;
    expect(Math.round(topo.height)).toBe(40);
  });

  it("sem nada detectado, clicar abre o assistente Configurar", async () => {
    await app.pagina.getByRole("button", { name: /^Executar projeto/ }).click();
    await app.pagina.getByRole("dialog").getByRole("heading", { name: "Configurar execução do projeto" }).waitFor();
    await app.pagina.keyboard.press("Escape");
  });

  it("confiança, execução, porta no chip, aba Execução, F5 para e nada fica vivo", async () => {
    await abrirWorkspace(projeto);
    const botao = app.pagina.getByRole("button", { name: /^Executar Servir \(e2e\)|^Executar projeto/ });
    await botao.waitFor({ timeout: 20_000 });
    await botao.click();
    const dialogo = app.pagina.getByRole("dialog");
    await dialogo.getByLabel("Comando exato").waitFor();
    expect(await dialogo.getByLabel("Comando exato").textContent()).toBe(`$ ./servir.sh ${MARCA}`);
    expect(vivos()).toBe(0); // nada rodou antes de confiar
    await dialogo.getByRole("button", { name: "Confiar neste projeto e executar" }).click();

    await app.pagina.getByRole("button", { name: /^Parar / }).waitFor({ timeout: 20_000 });
    await app.pagina.getByText(/porta 4455/).waitFor({ timeout: 20_000 });
    await app.pagina.getByRole("tab", { name: /Execução/ }).waitFor({ timeout: 20_000 });
    await esperar(() => vivos() >= 1);

    await app.pagina.keyboard.press("F5");
    await app.pagina.getByRole("button", { name: /^Executar / }).waitFor({ timeout: 20_000 });
    await esperar(() => vivos() === 0, 15_000);
  });

  it("fechar o app para a execução (padrão): nenhum processo da marca sobra", async () => {
    await app.pagina.getByRole("button", { name: /^Executar / }).click();
    await app.pagina.getByRole("button", { name: /^Parar / }).waitFor({ timeout: 20_000 });
    await esperar(() => vivos() >= 1);
    await app.fechar();
    await esperar(() => vivos() === 0, 15_000);
  });
});
