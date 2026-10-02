// E2E dos terminais por workspace (D-570/D-571) no Electron real. ESCRITO e type-checado; roda com `npm run build` pronto (`npm run test:e2e`), nunca com o `npm run dev` do dono ativo.
//   1) dois workspaces com 2 e 1 terminais (shell) abertos pela API: a tela Terminais mostra só as abas do workspace atual
//   2) trocar de workspace (como o painel/seletor fazem) troca o conjunto na hora; voltar restaura; as sessões dos outros seguem vivas no daemon
//   3) a troca medida no app real fica registrada no log (P-570: ≤ 100 ms com 6 terminais; aqui, com os poucos do teste)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp, type AppAberto } from "./fixture";

let app: AppAberto;
let pastaA: string;
let pastaB: string;
let idA = "";
let idB = "";

type Ws = { id: string };
const ade = <T>(expr: string): Promise<T> => app.pagina.evaluate(expr) as Promise<T>;
const esperar = async (cond: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > fim) throw new Error("tempo esgotado"); await new Promise((r) => setTimeout(r, 100)); }
};
const abas = (): Promise<number> => app.pagina.getByRole("tab").count();

beforeAll(async () => {
  pastaA = mkdtempSync(join(tmpdir(), "term-ws-a-"));
  pastaB = mkdtempSync(join(tmpdir(), "term-ws-b-"));
  app = await abrirApp();
  idA = (await ade<Ws>(`window.ade.workspaces.abrir(${JSON.stringify(pastaA)})`)).id;
  idB = (await ade<Ws>(`window.ade.workspaces.abrir(${JSON.stringify(pastaB)})`)).id;
  const abrirShell = (ws: string): Promise<unknown> => ade(`(async () => {
    const fs = await window.ade.terminais.listarFerramentas(false);
    const sh = fs.find((f) => f.id === "terminal");
    return window.ade.terminais.abrir({ versao: 1, ferramenta_id: "terminal", executavel_id: sh.executavel_id, argumentos: [], colunas: 80, linhas: 24, workspace_id: ${JSON.stringify(ws)} });
  })()`);
  await abrirShell(idA); await abrirShell(idA); await abrirShell(idB);
  await ade(`window.ade.workspaces.definirAtual(${JSON.stringify(idA)})`);
  await app.pagina.getByRole("button", { name: /Terminais/ }).first().click();
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(pastaA, { recursive: true, force: true });
  rmSync(pastaB, { recursive: true, force: true });
});

describe("terminais por workspace (Electron real)", () => {
  it("o workspace atual mostra só os terminais dele; trocar mostra os do outro; voltar restaura; nada é encerrado", async () => {
    await esperar(async () => (await abas()) === 2);
    const t0 = Date.now();
    await ade(`window.ade.workspaces.definirAtual(${JSON.stringify(idB)})`);
    await esperar(async () => (await abas()) === 1);
    console.info(`[P-570] troca de workspace no app real (2→1 terminais): ${Date.now() - t0} ms (inclui o IPC do main)`);
    await ade(`window.ade.workspaces.definirAtual(${JSON.stringify(idA)})`);
    await esperar(async () => (await abas()) === 2);
    const vivas = await ade<Array<{ estado: string; workspace_id: string | null }>>("window.ade.terminais.listarSessoes()");
    expect(vivas.filter((s) => s.estado === "executando")).toHaveLength(3);
    expect(vivas.filter((s) => s.workspace_id === idA)).toHaveLength(2);
  });
});
