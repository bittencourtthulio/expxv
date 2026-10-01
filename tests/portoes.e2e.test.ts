// E2E dos portões de intake no Electron real: o piloto (CLI falsa) tenta abrir um worker, recebe
// `gate_pending`, a PESSOA libera o portão pela UI (botão "Liberar" + confirmação pelo Dialogo) e o spawn passa.
// Nenhum diálogo nativo pode aparecer e nenhuma tool MCP libera portão.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, processosDeWorker, type AmbienteOrq, type JanelaOrq } from "./fixtures/mcp/ambiente-orq";

let amb: AmbienteOrq;

beforeAll(async () => {
  amb = await criarAmbienteOrq();
}, 120_000);

afterAll(async () => {
  await amb?.fechar();
});

type JanelaPortoes = JanelaOrq & {
  ade: JanelaOrq["ade"] & { missoes: JanelaOrq["ade"]["missoes"] & { portoes(id: string): Promise<{ liberados: string[]; pendentes: string[] } | null> } };
};

describe("portões de intake pela UI", () => {
  it("gate_pending → a pessoa libera 'Construção' pela UI → o spawn do worker passa; zero diálogos nativos", async () => {
    const a = amb.app;
    const nativos: string[] = [];
    a.pagina.on("dialog", (d) => { nativos.push(d.message()); void d.dismiss(); });

    const titulo = "Portão pela UI";
    const missao = await amb.iniciarMissao(titulo, { chamadas: [{ ...amb.spawnWorker({ worker: "ocioso" }), ate_ok: true }] }, []);

    // 1) sem o portão, o piloto é barrado e nenhum worker nasce
    const primeira = await esperar(async () => (await amb.chamadasDoPiloto(missao.id))[0], 30_000);
    expect(primeira).toMatchObject({ ok: false, erro: { code: "rule_violation", subcode: "gate_pending" } });
    expect((await amb.detalhe(missao.id))?.tasks).toHaveLength(0);
    expect(processosDeWorker()).toBe(0);

    // 2) a pessoa abre a Missão na UI e vê o aviso e os quatro portões pendentes
    await a.pagina.locator('nav[aria-label="Principal"] button[title="Missões"]').click();
    await a.pagina.mouse.move(900, 500); // tira o ponteiro do menu lateral (aberto por hover ele cobre a lista de Missões)
    await a.pagina.getByRole("button", { name: new RegExp(titulo) }).first().click();
    const painel = a.pagina.getByRole("region", { name: "Portões" });
    await painel.waitFor({ timeout: 10_000 });
    expect(await painel.getByRole("status").innerText()).toMatch(/gate_pending/);
    expect(await painel.locator('[data-estado="pendente"]').count()).toBe(4);
    expect(await painel.locator('[data-estado="liberado"]').count()).toBe(0);

    // 3) Liberar Construção: o botão só abre o diálogo; nada é liberado antes de confirmar
    await painel.getByRole("button", { name: "Liberar Construção" }).click();
    const dialogo = a.pagina.getByRole("dialog", { name: "Liberar o portão Construção?" });
    await dialogo.waitFor();
    expect(await a.pagina.evaluate((id) => (window as unknown as JanelaPortoes).ade.missoes.portoes(id), missao.id)).toMatchObject({ liberados: [] });
    await dialogo.getByRole("button", { name: "Liberar portão" }).click();
    await dialogo.waitFor({ state: "detached" });
    await painel.locator('[data-portao="build"][data-estado="liberado"]').waitFor({ timeout: 10_000 });
    expect(await painel.locator('[data-portao="build"]').innerText()).toMatch(/liberado/);

    // 4) o piloto tenta de novo e o spawn passa: worker vivo, card criado
    const ok = await esperar(async () => (await amb.chamadasDoPiloto(missao.id)).find((c) => c["ok"] === true), 30_000);
    expect(ok).toMatchObject({ tool: "pane_spawn", ok: true });
    const d = (await amb.detalhe(missao.id))!;
    expect(d.tasks.filter((t) => t.estado !== "descartada")).toHaveLength(1);
    expect(d.panes.filter((p) => !p.eh_piloto && p.estado !== "encerrado")).toHaveLength(1);
    await esperar(() => processosDeWorker() === 1, 15_000);

    // a decisão ficou no banco/estado e só um portão foi liberado
    expect(await a.pagina.evaluate((id) => (window as unknown as JanelaPortoes).ade.missoes.portoes(id), missao.id)).toEqual({ mission_id: missao.id, liberados: ["build"], pendentes: ["direction", "content", "qa"] });
    expect(nativos).toEqual([]);

    await amb.abortarCriadas();
    await esperar(() => processosDeWorker() === 0, 15_000);
  }, 120_000);
});
