// E2E da Loja de MCPs (Fase 7B, UI) no Electron real: abrir a tela lazy, buscar sem IPC, ver o consentimento com o comando EXATO e o
// hash, cancelar sem instalar nada, e zero diálogos nativos. NENHUM pacote real é instalado: o teste nunca confirma o "Instalar".
// ESCRITO e type-checado, NÃO executado aqui: rodar exige `npm run build` (não rodar com o `npm run dev` do dono ativo: ele usa
// `dist/`). A lógica, o consentimento e as credenciais são cobertos em jsdom (src/renderer/telas/loja-mcp/Tela.test.tsx).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface JanelaLoja {
  ade: {
    lojaMcp: {
      listar(): Promise<{ entradas: Array<{ id: string; nome: string; instalado: unknown; instalavel: boolean }>; somente_leitura: boolean }>;
      planoInstalacao(ids: string[], ws: string | null): Promise<{ planos: Array<{ id: string; comando_instalacao: string[]; comando_hash: string }>; bloqueios: unknown[] }>;
    };
  };
}

let amb: AmbienteOrq;
let pagina: Page;
let nativos = 0;

const avaliar = <T, A>(fn: (a: A) => Promise<T> | T, arg: A): Promise<T> => pagina.evaluate(fn as never, arg as never) as Promise<T>;

beforeAll(async () => {
  amb = await criarAmbienteOrq({});
  pagina = amb.app.pagina;
  await vigiarDialogos(amb.app);
  pagina.on("dialog", (d) => { nativos += 1; void d.dismiss(); });
}, 120_000);

afterAll(async () => {
  await amb?.fechar();
});

describe("tela Loja de MCPs no Electron real", () => {
  it("abre em chunk lazy com o catálogo, poucos nós de cartão (virtualizada) e nada instalado de início", async () => {
    const t0 = Date.now();
    await pagina.locator('nav[aria-label="Principal"] button', { hasText: "Loja de MCPs" }).click();
    await pagina.mouse.move(900, 500);
    await pagina.waitForSelector('section[aria-label="Loja de MCPs"] .lm-linha', { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(await pagina.locator(".lm-linha").count()).toBeLessThan(60);
    const lista = await avaliar(() => (window as unknown as JanelaLoja).ade.lojaMcp.listar(), undefined);
    expect(lista.entradas.length).toBeGreaterThanOrEqual(40);
    expect(lista.entradas.every((e) => e.instalado === null)).toBe(true);
  });

  it("a busca filtra localmente e 'Limpar filtros' devolve o catálogo", async () => {
    const campo = pagina.getByLabel("Buscar servidores MCP");
    await campo.fill("context7");
    await esperar(async () => ((await pagina.locator(".lm-linha").count()) <= 3) || undefined, 5_000);
    await campo.fill("zzzz-nada");
    await pagina.getByText("Nada encontrado").waitFor();
    await pagina.getByRole("button", { name: "Limpar filtros" }).click();
    await esperar(async () => ((await pagina.locator(".lm-linha").count()) > 3) || undefined, 5_000);
  });

  it("Instalar mostra o consentimento com o comando exato e o hash; cancelar não instala nada", async () => {
    const alvo = await avaliar(async () => {
      const l = await (window as unknown as JanelaLoja).ade.lojaMcp.listar();
      return l.entradas.find((e) => e.instalavel)!.id;
    }, undefined);
    const plano = await avaliar((id) => (window as unknown as JanelaLoja).ade.lojaMcp.planoInstalacao([id], null), alvo);
    if (plano.planos.length === 0) return; // pré-requisito ausente nesta máquina: o bloqueio é exibido (coberto em jsdom)
    await pagina.getByLabel("Buscar servidores MCP").fill(alvo);
    await pagina.locator(`[data-mcp-id="${alvo}"] .lm-botao`).first().click();
    const dialogo = pagina.getByRole("dialog");
    await dialogo.waitFor();
    expect(await dialogo.getByText(plano.planos[0]!.comando_hash).count()).toBeGreaterThan(0);
    const botaoInstalar = dialogo.getByRole("button", { name: "Instalar", exact: true });
    expect(await botaoInstalar.isDisabled()).toBe(true); // sem "Entendi" nada acontece
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    const depois = await avaliar(() => (window as unknown as JanelaLoja).ade.lojaMcp.listar(), undefined);
    expect(depois.entradas.every((e) => e.instalado === null)).toBe(true);
  });

  it("zero diálogos nativos", async () => {
    expect(nativos).toBe(0);
    expect(await dialogosChamados(amb.app)).toBe(0);
  });
});
