// E2E do "Assistente de execução com IA" (D-582…) no Electron real. ESCRITO e type-checado; NÃO executado nesta entrega: rodar exige `npm run build` (e o `dist/` está em uso
// pelo `npm run dev` do dono). Nenhuma CLI real é chamada: o teste vai até o CONSENTIMENTO e prova o que a fronteira garante sem IA.
//   1) projeto com várias partes (raiz sem package.json + desktop/ + motor/) e arquivos sensíveis plantados
//   2) ▶ → "Configurar com IA…" abre o consentimento com a prévia: arquivos, tokens, CLI, "nunca enviado"; nenhum segredo nem nome de arquivo de ambiente
//   3) Cancelar fecha sem enviar nada (o canal de proposta nunca é chamado)
//   4) o canal de proposta recusa sem consentimento e com hash que não é o do dossiê mostrado; nada é salvo no projeto
//   5) a detecção determinística do monorepo propõe "desktop · Rodar (dev)" como padrão
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ListaExecucao } from "../src/compartilhado/executar";
import type { PreviaAssistente } from "../src/compartilhado/executar-assistente";
import { PRODUTO } from "../src/nucleo/produto";
import { abrirApp, type AppAberto } from "./fixture";

let app: AppAberto;
let projeto: string;
const SEGREDO = `SEGREDO_E2E_${process.pid}`;

beforeAll(async () => {
  projeto = mkdtempSync(join(tmpdir(), "assistente-e2e-"));
  mkdirSync(join(projeto, "desktop"), { recursive: true });
  mkdirSync(join(projeto, "motor"), { recursive: true });
  writeFileSync(join(projeto, "README.md"), "# Projeto com várias partes\n");
  writeFileSync(join(projeto, "desktop", "package.json"), JSON.stringify({ name: "desktop", scripts: { dev: "node scripts/dev.mjs", test: "vitest run" }, devDependencies: { electron: "37.0.0" } }));
  writeFileSync(join(projeto, "motor", "pyproject.toml"), "[project]\nname = \"motor\"\n");
  writeFileSync(join(projeto, `.${"env"}`), `API_KEY=${SEGREDO}\n`);
  writeFileSync(join(projeto, "chave.pem"), SEGREDO);
  app = await abrirApp();
  await app.pagina.evaluate(`window.ade.workspaces.abrir(${JSON.stringify(projeto)})`);
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(projeto, { recursive: true, force: true });
});

const wsId = async (): Promise<string> => (await app.pagina.evaluate(`window.ade.workspaces.listar().then((l) => l.find((w) => w.raiz.endsWith(${JSON.stringify(projeto.split("/").pop())}))?.id)`)) as string;

describe("Assistente de execução com IA (Electron real, sem CLI)", () => {
  it("▶ → Configurar com IA… abre o consentimento com a prévia e sem nenhum segredo; Cancelar fecha sem enviar", async () => {
    const botao = app.pagina.getByRole("button", { name: "Configurações de execução" });
    await botao.waitFor({ timeout: 20_000 });
    await botao.click();
    await app.pagina.getByRole("menuitem", { name: /Configurar com IA/ }).click();
    const dialogo = app.pagina.getByRole("dialog", { name: /Configurar a execução com IA/ });
    await dialogo.waitFor({ timeout: 20_000 });
    const texto = (await dialogo.textContent()) ?? "";
    expect(texto).toContain("desktop/package.json");
    expect(texto).toContain("O que nunca é enviado");
    expect(texto).toMatch(/consome tokens da sua conta/);
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toMatch(/chave\.pem/);
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await dialogo.waitFor({ state: "detached" });
  });

  it("o canal de proposta recusa sem consentimento e com hash que não é o do dossiê mostrado; nada é salvo", async () => {
    const ws = await wsId();
    const previa = (await app.pagina.evaluate(`window.ade.executar.assistentePrevia(${JSON.stringify(ws)})`)) as PreviaAssistente;
    expect(previa.arquivos).toEqual(expect.arrayContaining(["desktop/package.json", "motor/pyproject.toml", "README.md"]));
    expect(previa.omitidos_sensiveis).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(previa)).not.toContain(SEGREDO);
    const semConsentimento = await app.pagina.evaluate(`window.ade.executar.assistentePropor(${JSON.stringify(ws)}, "claude", ${JSON.stringify(previa.dossie_hash)}, false).then(() => "aceitou", (e) => String(e.message))`);
    expect(semConsentimento).toMatch(/consentimento/);
    const hashErrado = await app.pagina.evaluate(`window.ade.executar.assistentePropor(${JSON.stringify(ws)}, "claude", ${JSON.stringify("0".repeat(40))}, true).then(() => "aceitou", (e) => String(e.message))`);
    expect(hashErrado).toMatch(/mudou/);
    expect(existsSync(join(projeto, PRODUTO.pastaNoProjeto, "executar.json"))).toBe(false);
  });

  it("a detecção do monorepo propõe 'desktop · Rodar (dev)' como padrão (sem IA)", async () => {
    const ws = await wsId();
    const lista = (await app.pagina.evaluate(`window.ade.executar.listar(${JSON.stringify(ws)})`)) as ListaExecucao;
    const padrao = lista.configuracoes.find((c) => c.padrao);
    expect(padrao).toMatchObject({ nome: "desktop · Rodar (dev)", cwd: "desktop", executavel: "npm", argumentos: ["run", "dev"] });
  });
});
