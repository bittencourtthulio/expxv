// E2E de custo e board (Fase 10, T-10.31, parte de UI) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). Os testes de núcleo, de main e de renderer (jsdom) cobrem a mesma lógica.
// Cobre o que dá para provar pela UI com o ambiente do piloto falso e uma feature do método sintética:
//   1) aba Board sem plano do método: estado vazio com o próximo passo (/expx:sprintx)
//   2) com o plano no disco: seis colunas (região + contagem), cards com custo "desconhecido" (nunca "0"), disco vence (concluido/em andamento/a fazer)
//   3) detalhe lateral (complementary) abre, mostra o contrato, Esc fecha; nenhum caminho absoluto nem diálogo nativo
//   4) `custo:resumo` de uma Missão sem uso observado é `usd: null` com `registros: 0` e a UI nunca mostra "US$ 0,00"
//   5) Consumo › Detalhe por uso sem dado explica o próximo passo; Fontes e preços lista a configuração e o diagnóstico não tem conteúdo
//   6) nenhum arquivo do método foi modificado pela leitura do board (hash antes/depois)
// Os cenários de transcript/rollout/proxy (CLIs falsas gravando uso, dois cards sequenciais, teto, reindexar, delegar, 1 000 cards a 60 fps) dependem das CLIs falsas
// da Fase 10 e do perf (`tests/perf/custo.perf.test.ts`) e ficam para o fechamento do coordenador.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { escreverFeatureSimples } from "./fixtures/metodo/gerar";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface JanelaCusto {
  ade: {
    custo: { resumo(p: { escopo: string; chave: string }): Promise<{ usd: number | null; registros: number; incompleto: boolean }>; diagnostico(): Promise<{ texto: string }> };
    board: { snapshot(f: { workspace_id: string }): Promise<{ colunas: Record<string, Array<{ task_id: string; custo: { usd: number | null } }>> }> };
  };
}

let amb: AmbienteOrq;
beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  await vigiarDialogos(amb.app);
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

const pagina = () => amb.app.pagina;
const irPara = async (rotulo: string): Promise<void> => {
  await pagina().locator('nav[aria-label="Principal"] button', { hasText: rotulo }).click();
  await pagina().mouse.move(900, 500); // o menu lateral abre por cima com o mouse em cima dele
};
const abrirBoard = async (): Promise<void> => {
  await irPara("Missões");
  await pagina().getByRole("button", { name: "Board", exact: true }).click();
};
function hashDeDocs(raiz: string): string {
  const h = createHash("sha256");
  const ler = (dir: string): void => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) ler(p); else h.update(n).update(readFileSync(p));
    }
  };
  try { ler(join(raiz, "docs")); } catch { /* sem docs */ }
  return h.digest("hex");
}

describe("custo e board no Electron real", () => {
  it("sem plano do método o Board explica o próximo passo", async () => {
    await abrirBoard();
    await pagina().getByText(/Nenhum plano do método neste workspace/).waitFor({ timeout: 15_000 });
    expect(await pagina().getByText(/\/expx:sprintx/).count()).toBeGreaterThan(0);
  }, 60_000);

  let hashAntes = "";
  it("com o plano no disco: seis colunas, custo desconhecido (nunca 0) e o disco manda na coluna", async () => {
    escreverFeatureSimples(amb.raiz, "docs/sprintx/agenda-online", "agenda-online");
    hashAntes = hashDeDocs(amb.raiz);
    const b = await esperar(async () => {
      const m = await pagina().evaluate((ws) => (window as unknown as JanelaCusto).ade.board.snapshot({ workspace_id: ws }), amb.wsId);
      return Object.values(m.colunas).flat().length >= 3 ? m : undefined;
    }, 20_000);
    expect(b.colunas["concluido"]?.map((c) => c.task_id)).toContain("T-01.01");
    expect(b.colunas["em_andamento"]?.map((c) => c.task_id)).toContain("T-01.02");
    expect(Object.values(b.colunas).flat().every((c) => c.custo.usd === null)).toBe(true);
    await irPara("Início");
    await abrirBoard();
    await pagina().getByRole("region", { name: /^Concluído, 1 card/ }).waitFor({ timeout: 20_000 });
    for (const nome of [/^Backlog,/, /^A fazer,/, /^Em andamento,/, /^Em revisão,/, /^Concluído,/, /^Validado,/]) expect(await pagina().getByRole("region", { name: nome }).count()).toBe(1);
    const card = pagina().getByRole("article", { name: /^T-01.02, em andamento.*custo desconhecido/ });
    await card.waitFor();
    expect(await pagina().locator(".board").innerText()).not.toMatch(/US\$ 0,00/);
  }, 90_000);

  it("detalhe lateral abre, mostra o contrato e fecha com Esc; sem caminho absoluto nem diálogo nativo", async () => {
    await pagina().getByRole("article", { name: /^T-01.02/ }).click();
    const det = pagina().getByRole("complementary", { name: "Detalhe de T-01.02" });
    await det.waitFor({ timeout: 10_000 });
    await det.getByText("Objetivo de T-01.02").waitFor({ timeout: 10_000 });
    expect(await pagina().locator(".board").innerText()).not.toContain(amb.raiz);
    await pagina().keyboard.press("Escape");
    await det.waitFor({ state: "detached", timeout: 5_000 });
    expect(await dialogosChamados(amb.app)).toBe(0);
  }, 60_000);

  it("custo:resumo de Missão sem uso é usd null (registros 0), e nunca aparece 'US$ 0,00'", async () => {
    const missao = await amb.iniciarMissao("Custo e2e", { chamadas: [] });
    const r = await pagina().evaluate((id) => (window as unknown as JanelaCusto).ade.custo.resumo({ escopo: "missao", chave: id }), missao.id);
    expect(r.usd).toBeNull();
    expect(r.registros).toBe(0);
    expect(await pagina().locator("body").innerText()).not.toMatch(/US\$ 0,00/);
  }, 60_000);

  it("Consumo: Detalhe por uso sem dado explica o próximo passo; Fontes e preços e o diagnóstico sem conteúdo", async () => {
    await irPara("Consumo");
    await pagina().getByRole("tab", { name: "Detalhe por uso" }).click();
    await pagina().getByText(/Nenhum uso observado neste período|sem fonte de uso/).first().waitFor({ timeout: 15_000 });
    await pagina().getByRole("tab", { name: "Fontes e preços" }).click();
    await pagina().getByRole("region", { name: "Fontes de uso" }).waitFor({ timeout: 10_000 });
    const d = await pagina().evaluate(() => (window as unknown as JanelaCusto).ade.custo.diagnostico());
    expect(d.texto).not.toContain(amb.raiz);
    expect(d.texto).not.toMatch(/\/Users\/|[A-Z]:\\\\/);
  }, 60_000);

  it("ler o board não modificou nenhum arquivo do método", () => {
    expect(hashDeDocs(amb.raiz)).toBe(hashAntes);
  });
});
