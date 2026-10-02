// E2E do Bench (Fase 12, T-12.25) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (e o `dist/` está em uso pelo `npm run dev` do dono).
// O app de produção NÃO tem gancho para trocar o executável da CLI (de propósito: seria um caminho para executar qualquer binário), então a Run completa com `cli-bench.mjs` (3 tarefas × 2 alvos,
// falha, timeout, cancelar com árvore de processos, escape do sandbox, re-run, conta sem limite) é provada no núcleo/serviço com a MESMA CLI falsa e o sandbox-exec real
// (`src/nucleo/bench/servico.test.ts` e `auditoria.test.ts`). Aqui fica o que só o Electron real prova:
//   1) a tela Bench abre pelo menu lateral e pelo atalho ⌘⇧B / Ctrl+Shift+B, sem nenhum processo ou arquivo criado só por abrir (sob demanda);
//   2) sem alvo cadastrado o estado vazio explica o próximo passo; salvar um alvo sem conta dedicada o deixa indisponível com o motivo;
//   3) `bench:rodar`, `bench:rerodar` e `bench:julgar` recusam token forjado/ausente ANTES do manipulador (validador) e o serviço recusa token bem formado mas inexistente;
//   4) `bench:estimar` devolve estimativa com custo desconhecido (nunca 0) e o diálogo de consentimento só habilita com a frase exata (sem `window.confirm`);
//   5) o canal nunca devolve caminho absoluto nem `mapa_cego`; `bench:artefato_ler` com `../x` é recusado; `bench:log_ler` nunca passa de 64 KiB;
//   6) ao fim, 0 processos de CLI do Bench vivos (`ps`).
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface JanelaBench {
  ade: {
    bench: {
      tarefasListar(a: string | null, e: string | null): Promise<Array<{ slug: string; estado: string }>>;
      alvosSalvar(a: unknown[]): Promise<Array<{ slug: string }>>;
      alvosListar(): Promise<Array<{ slug: string; disponivel: boolean; motivo: string | null }>>;
      estimar(p: { tarefas: string[]; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null }): Promise<{ estimativa_id: string; custo_min_usd: number | null; frase_exigida: string | null; avisos: string[] }>;
      consentir(id: string, frase: string, finalidade?: string): Promise<{ token?: string; erro?: string }>;
      rodar(id: string, token: string): Promise<{ run_id?: string; erro?: string }>;
      rerodar(run: string, tarefa: string, alvo: string, token: string): Promise<unknown>;
      julgar(run: string, tarefa: string | null, juiz: string, token: string): Promise<unknown>;
      artefatoLer(resultado: string, nome: string): Promise<unknown>;
      logLer(resultado: string, depois: number, max: number): Promise<unknown>;
      runsListar(depois: string | null): Promise<{ itens: unknown[] }>;
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
const api = <T,>(fn: (b: JanelaBench["ade"]["bench"]) => Promise<T>) => pagina().evaluate(`(${fn.toString()})(window.ade.bench)`) as Promise<T>;

describe("Bench no Electron real", () => {
  it("abre pelo menu lateral e pelo atalho; nada roda nem é criado só por abrir; sem alvo o estado vazio explica o próximo passo", async () => {
    await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Bench" }).click();
    await pagina().mouse.move(900, 500);
    await pagina().getByRole("toolbar", { name: "Controles do Bench" }).waitFor({ timeout: 15_000 });
    await pagina().getByText("Nenhum alvo disponível").waitFor();
    expect(await pagina().getByText(/conta dedicada em Provedores/).count()).toBeGreaterThan(0);
    await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Início" }).click();
    await pagina().keyboard.press(process.platform === "darwin" ? "Meta+Shift+B" : "Control+Shift+B");
    await pagina().getByRole("toolbar", { name: "Controles do Bench" }).waitFor({ timeout: 15_000 });
    expect((await api((b) => b.runsListar(null))).itens).toHaveLength(0);
  }, 90_000);

  it("a semente traz 9 tarefas (7 ativas); alvo sem conta dedicada fica indisponível com o motivo", async () => {
    const t = await api((b) => b.tarefasListar(null, null));
    expect(t).toHaveLength(9);
    expect(t.filter((x) => x.estado === "ativa")).toHaveLength(7);
    await api((b) => b.alvosSalvar([{ provedor: "claude", modelo: "modelo-e2e", esforco: null, cli: "claude", conta_id: null, rotulo: null }]));
    const alvos = await api((b) => b.alvosListar());
    expect(alvos[0]?.disponivel).toBe(false);
    expect(alvos[0]?.motivo).toMatch(/conta dedicada/);
  }, 60_000);

  it("rodar/rerodar/julgar recusam token forjado: o validador barra o formato e o serviço barra o token inexistente", async () => {
    const forjado = "a".repeat(48);
    await expect(api((b) => b.rodar("est_inexistente", "curto"))).rejects.toThrow();
    const r = await api((b) => b.rodar("est_aaaaaaaaaa", "a".repeat(48)));
    expect(r).toEqual({ erro: "consentimento_invalido" });
    await expect(api((b) => b.rerodar("brun_01M3V8236WR2S7C4WBR29CJ6ZA", "t", "a", "a".repeat(48)))).rejects.toThrow();
    await expect(api((b) => b.julgar("brun_01M3V8236WR2S7C4WBR29CJ6ZA", null, "j", "a".repeat(48)))).rejects.toThrow();
    expect(forjado).toHaveLength(48);
    expect((await api((b) => b.runsListar(null))).itens).toHaveLength(0);
  }, 60_000);

  it("estimativa sem preço é custo desconhecido (nunca 0); sem alvo disponível a frase de consentimento nem existe", async () => {
    const e = await api((b) => b.estimar({ tarefas: ["debug-find-and-fix"], alvos: ["claude-modelo-e2e-padrao"], max_paralelo: 3, teto_usd: null, juiz_alvo: null }));
    expect(e.custo_min_usd).toBeNull();
    expect(e.frase_exigida).toBeNull();
    expect(e.avisos.join(" ")).toMatch(/indisponível|Custo desconhecido/);
    const c = await api((b) => b.consentir(e.estimativa_id, "RODAR"));
    expect(c.erro).toBe("confirmacao_invalida");
  }, 60_000);

  it("os canais recusam caminho fora da pasta e nunca passam de 64 KiB por página de log", async () => {
    await expect(api((b) => b.artefatoLer("bres_01M3V8236WR2S7C4WBR29CJ6ZA", "../x"))).rejects.toThrow();
    await expect(api((b) => b.logLer("bres_01M3V8236WR2S7C4WBR29CJ6ZA", 0, 65_537))).rejects.toThrow();
  }, 60_000);

  it("nenhum diálogo nativo e 0 processos de CLI do Bench vivos ao fim", async () => {
    expect(await dialogosChamados(amb.app)).toBe(0);
    const ps = execFileSync("ps", ["-axo", "command"], { encoding: "utf8" });
    expect(ps.split("\n").filter((l) => /sandbox-exec .*bench\/perfis/.test(l))).toEqual([]);
  }, 30_000);
});
