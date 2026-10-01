// Ajudantes compartilhados pelo e2e de UI (terminais-ui.e2e.test.ts) e pelo perf (perf/terminal.perf.ts).
// Tudo passa pela UI de verdade (cliques/teclado); `window.ade` só entra no preparo (registrar a CLI falsa
// pelo gancho de teste, sem diálogo nativo) e nas leituras.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { variavelDeAmbiente } from "../src/nucleo/produto";
import { abrirApp, RAIZ } from "./fixture";
import type { AppAberto, OpcoesApp } from "./fixture";

export const MAC = process.platform === "darwin";
/** Modificador dos atalhos de terminal (04-UI-UX): Cmd no mac; Ctrl+Shift nos demais. */
export const MOD = MAC ? "Meta" : "Control+Shift";
export const atalho = (tecla: string, extra = ""): string => `${MOD}${extra === "" ? "" : `+${extra}`}+${tecla}`;

export interface Ambiente {
  pastaDados: string;
  raizWorkspace: string;
  env: Record<string, string>;
  limpar(): void;
}

/** Pastas temporárias + wrapper executável da CLI falsa (o PTY precisa de um arquivo executável). */
export function criarAmbiente(): Ambiente {
  const pastas: string[] = [];
  const temp = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); pastas.push(d); return d; };
  const pastaDados = temp("ade-ui-dados-");
  const raizWorkspace = temp("ade-ui-ws-");
  const bin = temp("ade-ui-bin-");
  // a UI só lista as CLIs do catálogo: o "Terminal" (shell) resolve para o primeiro `zsh` do PATH, que aqui é a CLI falsa
  const wrapper = join(bin, process.platform === "win32" ? "zsh.cmd" : "zsh");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${join(RAIZ, "tests", "fixtures", "cli-pty.mjs")}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return {
    pastaDados,
    raizWorkspace,
    env: {
      [variavelDeAmbiente("E2E_EXECUTAVEL")]: wrapper,
      [variavelDeAmbiente("E2E_RAIZ")]: raizWorkspace,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      SHELL: "/inexistente/shell", // força o PATH de fallback (sem consultar o shell de login real)
    },
    limpar: () => { for (const p of pastas) rmSync(p, { recursive: true, force: true }); },
  };
}

export const abrir = (amb: Ambiente, extra: OpcoesApp["env"] = {}): Promise<AppAberto> =>
  abrirApp({ pastaDados: amb.pastaDados, env: { ...amb.env, ...extra } });

/** Conta chamadas de diálogo nativo no main (não deve haver nenhuma). */
export async function vigiarDialogos(a: AppAberto): Promise<void> {
  await a.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __dialogos: number };
    g.__dialogos = 0;
    for (const nome of ["showOpenDialog", "showOpenDialogSync", "showSaveDialog", "showSaveDialogSync", "showMessageBox", "showMessageBoxSync", "showErrorBox"] as const) {
      (dialog as unknown as Record<string, unknown>)[nome] = () => { g.__dialogos += 1; return nome.endsWith("Sync") ? 0 : Promise.resolve({ response: 1, canceled: true, filePaths: [] }); };
    }
  });
}
export const dialogosChamados = (a: AppAberto): Promise<number> => a.app.evaluate(() => (globalThis as unknown as { __dialogos?: number }).__dialogos ?? 0);

/** Abre a tela Terminais pelo menu lateral. */
export async function irParaTerminais(p: Page): Promise<void> {
  await p.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
  await p.locator('nav[aria-label="Principal"] button', { hasText: "Terminais" }).click();
  await p.mouse.move(900, 500); // o menu lateral abre por cima com o mouse em cima dele
  await p.waitForSelector(".terminais-tela", { timeout: 15_000 });
}

/** "+ Nova sessão" → escolhe a CLI falsa no menu. Devolve o id da sessão nova (o painel que apareceu). */
export async function novaSessaoPelaUI(p: Page): Promise<string> {
  const antes = await idsDosPaineis(p);
  await p.getByRole("button", { name: /Nova sessão/ }).click();
  await p.getByRole("menuitem", { name: /^Terminal/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll("section.terminais-painel[data-sessao]").length > n, antes.length, { timeout: 15_000 });
  const depois = await idsDosPaineis(p);
  return depois.find((i) => !antes.includes(i)) as string;
}

/** Primeira sessão: vai à tela Terminais e abre a CLI falsa pelo menu "+ Nova sessão". */
export async function prepararPrimeiraSessao(p: Page): Promise<string> {
  await irParaTerminais(p);
  return novaSessaoPelaUI(p);
}

export const idsDosPaineis = (p: Page): Promise<string[]> =>
  p.$$eval("section.terminais-painel[data-sessao]", (els) => els.map((e) => (e as HTMLElement).dataset.sessao as string));

interface JanelaGancho { __ade_terminais?: Record<string, { texto(): string; selecao(): string; topo(): number }> }

export const buffer = (p: Page, id: string): Promise<string> =>
  p.evaluate((i) => (window as unknown as JanelaGancho).__ade_terminais?.[i]?.texto() ?? "", id);

export async function esperarBuffer(p: Page, id: string, trecho: string, timeout = 15_000): Promise<void> {
  await p.waitForFunction(([i, t]) => ((window as unknown as JanelaGancho).__ade_terminais?.[i as string]?.texto() ?? "").includes(t as string), [id, trecho] as const, { timeout });
}

export const ocorrencias = (texto: string, trecho: string): number => texto.split(trecho).length - 1;

export const focarPainel = (p: Page, id: string): Promise<void> => p.locator(`section[data-sessao="${id}"] textarea`).focus();

/** Digita no painel (teclado real) e dá Enter. */
export async function digitarLinha(p: Page, id: string, texto: string): Promise<void> {
  await focarPainel(p, id);
  await p.keyboard.type(texto);
  await p.keyboard.press("Enter");
}
