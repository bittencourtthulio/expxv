// E2E da memória (Fase 8, T-08.32) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). Os testes de núcleo, de main e de renderer (jsdom) cobrem a mesma lógica.
// A CLI do piloto é a falsa de `fixtures/cli-agente.mjs` (cli-orq + registro do que cada Pane recebeu); nada sai da máquina.
//   1) Missão agêntica: o piloto grava `memory_checkpoint` + `memory_write` por MCP (loopback)
//   2) um worker entrega o handoff e o Pane dele é fechado; a tela Memória mostra as entradas
//   3) "Restaurar" disparado em duplicata (Promise.all) abre UM Pane e o prompt tem UM envelope `<memoria_restaurada`
//   4) memória desligada no projeto: o piloto recebe `memory_disabled` e a tabela não cresce
//   5) memox presente: o cartão mostra o estado e "Reindexar" só DIGITA o comando (memox.py nunca roda)
//   6) apagar o projeto remove tudo; zero diálogos nativos em todo o fluxo (a exportação abre o salvar, que aqui é espionado)
//   (Missão `squad` sem `memory_*` em `tools/list` é provada em `src/nucleo/mcp/tools-memoria.test.ts` e na aceitação AC-08.10.)
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface EntradaJanela { id: string; tipo: string; conteudo: string; fonte: string; escopo: string }
interface JanelaMemoria {
  ade: {
    memoria: {
      listar(p: unknown): Promise<{ itens: EntradaJanela[]; proximo: string | null }>;
      estado(ws: string): Promise<{ contagens: Record<string, number>; memox: { instalado: boolean }; metricas?: Record<string, number> }>;
      gravarConfig(p: unknown): Promise<{ ativa: boolean }>;
      restaurar(paneId: string, modo: "auto" | "retomar" | "brief"): Promise<{ pane_id: string; ja_existia: boolean; brief_injetado: boolean; modo: string }>;
      purgar(p: unknown): Promise<{ removidas: number }>;
    };
    missoes: { detalhe(id: string): Promise<{ panes: Array<{ id: string; respawn_de: string | null; estado: string; eh_piloto: boolean; sessao_pty_id: string | null }> } | null> };
  };
}

let amb: AmbienteOrq;
let marcaMemox: string;

beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  // memox falso no projeto: `estado` responde e QUALQUER outra chamada deixa uma marca (o ADE nunca deve rodar `indexar`)
  const pasta = join(amb.raiz, ".claude", "skills", "memox", "assets");
  mkdirSync(pasta, { recursive: true });
  marcaMemox = join(amb.raiz, "memox-rodou-indexar.txt");
  writeFileSync(join(pasta, "memox.py"), `import sys\nif sys.argv[1] == "estado":\n    print("indice com 3 arquivos")\nelse:\n    open(${JSON.stringify(marcaMemox)}, "w").write("rodou")\n`);
  chmodSync(join(pasta, "memox.py"), 0o755);
  await vigiarDialogos(amb.app);
}, 120_000);

afterAll(async () => { await amb?.fechar(); });

const pagina = () => amb.app.pagina;
const listar = (extra: Record<string, unknown> = {}) => pagina().evaluate((p) => (window as unknown as JanelaMemoria).ade.memoria.listar(p), { workspace_id: amb.wsId, escopo: null, mission_id: null, pane_id: null, tipos: null, busca: null, depois: null, limite: 200, ...extra });
const irParaMemoria = async (): Promise<void> => {
  await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Memória" }).click();
  await pagina().mouse.move(900, 500); // o menu lateral abre por cima com o mouse em cima dele
  await pagina().waitForSelector('[aria-label="Memória"][class~="memoria"], section.memoria', { timeout: 15_000 });
};

describe("memória no Electron real", () => {
  let missaoId = "";
  let workerPane = "";

  it("o piloto grava checkpoint e decisão por MCP; o worker entrega e o Pane dele fecha; a tela Memória lista tudo", async () => {
    const missao = await amb.iniciarMissao("Memória e2e", {
      esperar_wake: true,
      chamadas: [
        { tool: "memory_checkpoint", args: { summary: "Rota de login pronta; falta expiração.", next_steps: ["testar expiração"] } },
        { tool: "memory_write", args: { content: "Usar cookie httpOnly para a sessão", kind: "decision", importance: 4 } },
        amb.spawnWorker({ worker: "handoff", resumo: "rota entregue" }),
      ],
    });
    missaoId = missao.id;
    await esperar(async () => (await amb.eventos(missao.id)).find((l) => l.evento === "wake"), 40_000);
    const ev = await amb.chamadasDoPiloto(missao.id);
    expect(ev.filter((c) => c["tool"] === "memory_checkpoint" || c["tool"] === "memory_write").every((c) => c["ok"] === true)).toBe(true);
    const d = (await pagina().evaluate((id) => (window as unknown as JanelaMemoria).ade.missoes.detalhe(id), missao.id))!;
    workerPane = d.panes.find((p) => !p.eh_piloto)!.id;
    await esperar(async () => (await pagina().evaluate((id) => (window as unknown as JanelaMemoria).ade.missoes.detalhe(id), missao.id))?.panes.find((p) => p.id === workerPane)?.estado === "encerrado", 20_000);

    const entradas = await esperar(async () => { const l = await listar(); return l.itens.length >= 3 ? l.itens : undefined; }, 15_000);
    expect(entradas.map((e) => e.tipo)).toEqual(expect.arrayContaining(["checkpoint", "decisao", "handoff"]));
    expect(entradas.find((e) => e.tipo === "decisao")?.conteudo).toBe("Usar cookie httpOnly para a sessão");

    await irParaMemoria();
    const grade = pagina().locator('[role="grid"][aria-label="Entradas da memória"]');
    await grade.waitFor({ timeout: 15_000 });
    expect(Number(await grade.getAttribute("aria-rowcount"))).toBeGreaterThan(1);
    expect(await pagina().locator('[role="row"][data-i]').count()).toBeLessThanOrEqual(80);
  }, 120_000);

  it("Restaurar em duplicata (duplo clique) = UM Pane, com UM envelope de brief no prompt e nenhum brief antigo", async () => {
    const [a, b] = await Promise.all([
      pagina().evaluate((id) => (window as unknown as JanelaMemoria).ade.memoria.restaurar(id, "brief"), workerPane),
      pagina().evaluate((id) => (window as unknown as JanelaMemoria).ade.memoria.restaurar(id, "brief"), workerPane),
    ]);
    expect(a.pane_id).toBe(b.pane_id);
    expect([a.ja_existia, b.ja_existia].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const d = (await pagina().evaluate((id) => (window as unknown as JanelaMemoria).ade.missoes.detalhe(id), missaoId))!;
    expect(d.panes.filter((p) => p.respawn_de === workerPane)).toHaveLength(1); // ux_pane_respawn_vivo + lock por Pane
    const registro = await esperar(() => amb.registroDoPane(a.pane_id), 20_000);
    const prompt = registro.argv.join("\n");
    expect(prompt.split("<memoria_restaurada").length - 1).toBe(1);
    expect(prompt.split("</memoria_restaurada>").length - 1).toBe(1);
    expect(prompt).toContain('tipo="dados"');
    // o brief nunca vai no system prompt nem em arquivo de instruções
    expect(Object.values(registro.arquivos).some((t) => t.includes("<memoria_restaurada"))).toBe(false);
  }, 60_000);

  it("o cartão do memox mostra o estado e 'Reindexar' só DIGITA o comando (memox.py nunca roda indexar)", async () => {
    const estado = await pagina().evaluate((ws) => (window as unknown as JanelaMemoria).ade.memoria.estado(ws), amb.wsId);
    expect(estado.memox.instalado).toBe(true);
    await irParaMemoria();
    await pagina().getByRole("tab", { name: "Saúde" }).click();
    const cartao = pagina().getByRole("region", { name: "Memória do método" });
    await cartao.waitFor({ timeout: 10_000 });
    expect(await cartao.textContent()).toContain("indice com 3 arquivos");
    // o piloto desta Missão é uma sessão `claude` em execução: o botão fica habilitado e digita o comando nela
    const botao = cartao.getByRole("button", { name: "Reindexar" });
    await esperar(async () => (await botao.isEnabled()) || undefined, 15_000);
    await botao.click();
    const digitado = await esperar(async () => (await amb.eventos(missaoId)).find((l) => l.evento === "entrada" && String(l["texto"]).includes("/expx:memox-indexar")), 15_000);
    expect(digitado).toBeTruthy();
    await new Promise((r) => setTimeout(r, 500));
    expect(existsSync(marcaMemox)).toBe(false); // o ADE não executou `memox.py indexar`
  }, 60_000);

  it("memória desligada no projeto: nada novo na tabela e o piloto recebe memory_disabled", async () => {
    await pagina().evaluate((ws) => (window as unknown as JanelaMemoria).ade.memoria.gravarConfig({ workspace_id: ws, ativa: false }), amb.wsId);
    const antes = (await listar()).itens.length;
    const missao = await amb.iniciarMissao("Sem memória", { chamadas: [{ tool: "memory_write", args: { content: "isto não pode ser gravado", kind: "fact" } }] });
    const r = await esperar(async () => (await amb.chamadasDoPiloto(missao.id))[0], 30_000);
    expect(r["ok"]).toBe(false);
    expect(JSON.stringify(r["erro"])).toMatch(/memory_disabled|unknown_tool|not_found/);
    expect((await listar()).itens.filter((e) => e.conteudo.includes("não pode ser gravado"))).toHaveLength(0);
    expect((await listar()).itens.filter((e) => e.fonte === "agente").length).toBeLessThanOrEqual(antes);
    await pagina().evaluate((ws) => (window as unknown as JanelaMemoria).ade.memoria.gravarConfig({ workspace_id: ws, ativa: true }), amb.wsId);
  }, 60_000);

  it("apagar o projeto remove tudo (nome digitado na UI) e nenhum diálogo nativo foi aberto", async () => {
    await irParaMemoria();
    await pagina().getByRole("tab", { name: "Saúde" }).click();
    await pagina().getByRole("button", { name: "Apagar…" }).click();
    const dialogo = pagina().getByRole("dialog", { name: "Apagar a memória deste projeto?" });
    await dialogo.getByLabel("Digite o nome do projeto para confirmar").fill(basename(amb.raiz));
    await dialogo.getByRole("button", { name: "Apagar" }).click();
    await esperar(async () => (await listar()).itens.length === 0 || undefined, 15_000);
    const estado = await pagina().evaluate((ws) => (window as unknown as JanelaMemoria).ade.memoria.estado(ws), amb.wsId);
    expect(Object.entries(estado.contagens).filter(([k]) => k !== "usuario").every(([, v]) => v === 0)).toBe(true);
    expect(await dialogosChamados(amb.app)).toBe(0);
  }, 60_000);
});
