// E2E da Fase 16 (UI do Maestro) no Electron real: seletor de rigidez em todas as telas, "Pedir ao Maestro" (paleta), plano mostrado
// ANTES de qualquer terminal, aba Etapas com linhas humanas travadas, aba Rigidez e zero diálogos nativos. As CLIs são as falsas de
// `tests/fixtures/mcp/cli-orq.mjs`; nada sai da máquina (decisor desligado por padrão: zero rede).
// ESCRITO e type-checado, NÃO executado aqui: rodar exige `npm run build` (não rodar com o `npm run dev` do dono ativo: ele usa `dist/`).
// A lógica está coberta por Vitest (src/nucleo/maestro, src/main, src/renderer).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface JanelaMaestro {
  ade: {
    maestro: {
      pedir(p: unknown): Promise<{ plano: { id: string; pipeline_id: string; etapas: Array<{ etapa_id: string }> }; recibo: { texto: string } }>;
      listarPipelines(p: unknown): Promise<Array<{ id: string; estado: string }>>;
      cancelar(id: string): Promise<{ ok: true }>;
    };
    rigidez: { ler(p: unknown): Promise<{ efetivo: number }> };
    workspaces: { estado(): Promise<{ atual: { id: string } | null }> };
  };
}

let amb: AmbienteOrq;
let pagina: Page;
let nativos = 0;
const avaliar = <T, A>(fn: (a: A) => Promise<T> | T, arg: A): Promise<T> => pagina.evaluate(fn as never, arg as never) as Promise<T>;
const ir = async (rotulo: string): Promise<void> => {
  await pagina.locator('nav[aria-label="Principal"] button', { hasText: rotulo }).click();
  await pagina.mouse.move(900, 500);
};

beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  pagina = amb.app.pagina;
  await vigiarDialogos(amb.app);
  pagina.on("dialog", (d) => { nativos += 1; void d.dismiss(); });
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

describe("UI do Maestro no Electron real", () => {
  it("o seletor de rigidez está no topo de todas as telas, com role=slider e nível Padrão", async () => {
    const slider = pagina.getByRole("slider", { name: "Rigidez do método" });
    await slider.waitFor({ timeout: 15_000 });
    expect(await slider.getAttribute("aria-valuetext")).toBe("Padrão, nível 3 de 5");
    for (const tela of ["Missões", "Terminais", "Método", "Pipelines", "Configurações"]) {
      await ir(tela);
      expect(await pagina.getByRole("slider", { name: "Rigidez do método" }).count()).toBe(1);
    }
  });

  it("a tela Pipelines abre (chunk lazy) com as cinco abas", async () => {
    await ir("Pipelines");
    await pagina.waitForSelector('section[aria-label="Pipelines do método"]', { timeout: 15_000 });
    expect(await pagina.getByRole("tab").allTextContents()).toEqual(expect.arrayContaining(["Pipeline", "Intenção", "Etapas", "Rigidez", "Provedores"]));
  });

  it("pedir pela aba Intenção mostra o PLANO e nenhum terminal abre sem confirmar", async () => {
    const antes = await avaliar(() => (window as unknown as { ade: { terminais: { listarSessoes(): Promise<unknown[]> } } }).ade.terminais.listarSessoes(), undefined);
    await pagina.getByRole("tab", { name: "Intenção" }).click();
    await pagina.getByLabel("O que você quer fazer?").fill("corrige o erro ao salvar o cadastro");
    await pagina.getByRole("button", { name: "Propor plano" }).click();
    const plano = pagina.getByRole("region", { name: "Plano proposto" });
    await plano.waitFor({ timeout: 15_000 });
    expect(await plano.textContent()).toContain("Recibo:");
    expect(await plano.getByRole("button", { name: "Executar" }).isEnabled()).toBe(true);
    const depois = await avaliar(() => (window as unknown as { ade: { terminais: { listarSessoes(): Promise<unknown[]> } } }).ade.terminais.listarSessoes(), undefined);
    expect(depois.length).toBe(antes.length);
    await plano.getByRole("button", { name: "Cancelar" }).click();
    await pagina.getByText("Nenhum plano proposto").waitFor();
  });

  it("'Pedir ao Maestro' pela paleta abre o campo compacto e leva ao plano", async () => {
    await pagina.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+Shift+P");
    await pagina.getByRole("dialog", { name: "Paleta de comandos" }).waitFor();
    await pagina.keyboard.type("Pedir ao Maestro");
    await pagina.keyboard.press("Enter");
    const campo = pagina.getByRole("textbox", { name: /O que você quer fazer/ });
    await campo.waitFor({ timeout: 10_000 });
    await campo.fill("quero um sistema de agenda do zero");
    await campo.press("Enter");
    await pagina.getByRole("region", { name: "Plano proposto" }).waitFor({ timeout: 15_000 });
    const ws = await avaliar(() => (window as unknown as JanelaMaestro).ade.workspaces.estado(), undefined);
    const ativos = await avaliar((id) => (window as unknown as JanelaMaestro).ade.maestro.listarPipelines({ workspace_id: id, so_ativos: true, limite: 20 }), ws.atual?.id ?? "");
    for (const a of ativos) await avaliar((id) => (window as unknown as JanelaMaestro).ade.maestro.cancelar(id), a.id);
  });

  it("aba Etapas: linhas humanas travadas; aba Rigidez: matriz acessível", async () => {
    await pagina.getByRole("tab", { name: "Etapas" }).click();
    const tabela = pagina.getByRole("table", { name: "Matriz de etapas por perfil" });
    await tabela.waitFor({ timeout: 15_000 });
    const humana = tabela.locator("tr[data-humana]").first();
    await humana.waitFor();
    expect(await humana.getByRole("combobox").count()).toBe(0);
    await pagina.getByRole("tab", { name: "Rigidez" }).click();
    await pagina.getByRole("table", { name: "Matriz de rigidez: etapas por nível" }).waitFor({ timeout: 15_000 });
    expect(await pagina.getByLabel("Legenda").textContent()).toContain("◐");
  });

  it("mudar o nível pelo teclado persiste no main (rigidez:ler) e nenhum diálogo nativo foi aberto", async () => {
    const slider = pagina.getByRole("slider", { name: "Rigidez do método" });
    await slider.focus();
    await slider.press("ArrowRight");
    const ws = await avaliar(() => (window as unknown as JanelaMaestro).ade.workspaces.estado(), undefined);
    await esperar(async () => ((await avaliar((id) => (window as unknown as JanelaMaestro).ade.rigidez.ler({ workspace_id: id, mission_id: null, plano_id: null }), ws.atual?.id ?? "")).efetivo === 4) || undefined, 10_000);
    await slider.press("ArrowLeft");
    await esperar(async () => ((await avaliar((id) => (window as unknown as JanelaMaestro).ade.rigidez.ler({ workspace_id: id, mission_id: null, plano_id: null }), ws.atual?.id ?? "")).efetivo === 3) || undefined, 10_000);
    expect(nativos).toBe(0);
    expect(await dialogosChamados(amb.app)).toBe(0);
  });
});
