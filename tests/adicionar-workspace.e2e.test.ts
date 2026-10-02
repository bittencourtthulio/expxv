// E2E do modal "Adicionar workspace" (D-600…) no Electron REAL. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). O núcleo, o main, o renderer (jsdom) e o contrato cobrem a mesma lógica sem Electron.
//   1) ⌘⇧O / Ctrl+Shift+O abre o modal (e a paleta ⌘K abre já na seção certa); Esc fecha
//   2) clonar um REPOSITÓRIO LOCAL de teste (caminho local habilitado só aqui, nenhuma rede): consentimento → progresso → "Pronto" → o workspace vira o atual
//   3) novo projeto cria a pasta, o git e troca para o workspace
//   4) o canal recusa destino que não seja token emitido pelo main
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DestinoPai, ResultadoIniciarClone } from "../src/compartilhado/workspaces-adicionar";
import { abrirApp, type AppAberto } from "./fixture";

interface JanelaAdicionar {
  ade: {
    workspaces: {
      estado(): Promise<{ atual: { nome: string; raiz: string } | null }>;
      adicionarDestinoPadrao(): Promise<DestinoPai>;
      adicionarClonar(p: unknown): Promise<ResultadoIniciarClone>;
    };
  };
}

let app: AppAberto;
let casa: string;
let remoto: string;
const EH_MAC = process.platform === "darwin";
const ev = <T, A = null>(fn: (w: JanelaAdicionar, a: A) => Promise<T>, a: A = null as A): Promise<T> => app.pagina.evaluate(`(${fn.toString()})(window, ${JSON.stringify(a)})`) as Promise<T>;

beforeAll(async () => {
  casa = realpathSync(mkdtempSync(join(tmpdir(), "adicionar-e2e-")));
  remoto = join(casa, "origem", "remoto");
  mkdirSync(remoto, { recursive: true });
  const git = (...a: string[]): void => void execFileSync("git", a, { cwd: remoto, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "T");
  writeFileSync(join(remoto, "a.txt"), "a");
  git("add", "-A");
  git("commit", "-q", "-m", "inicial");
  app = await abrirApp({ env: { HOME: casa, USERPROFILE: casa } });
  await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(casa, { recursive: true, force: true });
});

describe("Adicionar workspace (Electron real)", () => {
  it("o atalho abre o modal na seção Abrir pasta e Esc fecha", async () => {
    await app.pagina.keyboard.press(EH_MAC ? "Meta+Shift+O" : "Control+Shift+O");
    await app.pagina.waitForSelector('[role="dialog"][aria-label], [role="dialog"]', { timeout: 10_000 });
    expect(await app.pagina.getByRole("tab", { name: "Abrir pasta" }).getAttribute("aria-selected")).toBe("true");
    await app.pagina.keyboard.press("Escape");
    await app.pagina.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5_000 });
  });

  it("a paleta abre o modal já em 'Clonar repositório'", async () => {
    await app.pagina.keyboard.press(EH_MAC ? "Meta+K" : "Control+Shift+P");
    await app.pagina.keyboard.type("clonar repo");
    await app.pagina.keyboard.press("Enter");
    await app.pagina.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    expect(await app.pagina.getByRole("tab", { name: "Clonar repositório" }).getAttribute("aria-selected")).toBe("true");
    await app.pagina.keyboard.press("Escape");
  });

  it("o canal recusa destino que não seja um token emitido pelo main", async () => {
    const r = await ev<string>(async (w) => w.ade.workspaces.adicionarClonar({ entrada: "dono/repo", permitir_local: false, destino_token: "/etc", nome: "x", branch: null, raso: false, submodulos: false, consentimento: true }).then(() => "aceito", () => "recusado"));
    expect(r).toBe("recusado");
  });

  it("clona um repositório local: consentimento, progresso, Pronto e o workspace vira o atual", async () => {
    const d = await ev<DestinoPai>((w) => w.ade.workspaces.adicionarDestinoPadrao());
    expect(d.exibicao).toMatch(/^~/);
    await app.pagina.keyboard.press(EH_MAC ? "Meta+Shift+O" : "Control+Shift+O");
    await app.pagina.getByRole("tab", { name: "Clonar repositório" }).click();
    await app.pagina.getByText("Origem em pasta local do computador").click();
    await app.pagina.getByRole("checkbox", { name: /Permitir caminho local/ }).check();
    await app.pagina.getByRole("checkbox", { name: /Confirmo que esta pasta/ }).check();
    await app.pagina.getByLabel(/URL ou identificador/).fill(remoto);
    await app.pagina.getByLabel("Nome da pasta").fill("clonado-e2e");
    await app.pagina.getByRole("button", { name: "Revisar e clonar…" }).click();
    await app.pagina.getByRole("group", { name: /Isto baixa o repositório/ }).getByRole("button", { name: "Clonar" }).click();
    await app.pagina.getByRole("heading", { name: /Pronto/ }).waitFor({ timeout: 30_000 });
    const estado = await ev<{ atual: { nome: string; raiz: string } | null }>((w) => w.ade.workspaces.estado());
    expect(estado.atual?.nome).toBe("clonado-e2e");
    expect(existsSync(join(casa, estado.atual!.raiz.split("/").slice(-1)[0] as string)) || existsSync(estado.atual!.raiz)).toBe(true);
    await app.pagina.getByRole("button", { name: "Abrir" }).click();
    await app.pagina.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5_000 });
  });

  it("novo projeto cria pasta + git e troca para o workspace", async () => {
    await app.pagina.keyboard.press(EH_MAC ? "Meta+Shift+O" : "Control+Shift+O");
    await app.pagina.getByRole("tab", { name: "Novo projeto" }).click();
    await app.pagina.getByLabel("Nome do projeto").fill("meu-novo-e2e");
    await app.pagina.getByRole("button", { name: "Criar projeto" }).click();
    await app.pagina.getByRole("heading", { name: "Pronto" }).waitFor({ timeout: 20_000 });
    const estado = await ev<{ atual: { nome: string; raiz: string } | null }>((w) => w.ade.workspaces.estado());
    expect(estado.atual?.nome).toBe("meu-novo-e2e");
    expect(existsSync(join(estado.atual!.raiz, ".git"))).toBe(true);
  });
});
