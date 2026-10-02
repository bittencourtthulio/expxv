// E2E do mapa lógico do código (Fase 17, T-17.45) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (e o `dist/` está em uso pelo
// `npm run dev` do dono). Os testes de núcleo, de main e de renderer (jsdom) cobrem a mesma lógica.
//   1) abrir Mapa pela navegação: tela lazy, UMA linha de controles, 7 visões; antes de analisar o vazio explica o próximo passo e NADA analisa sozinho (0 workers)
//   2) Analisar (progresso) -> estado pronto com arquivos e linguagens do projeto de fixture
//   3) Grafo: o canvas existe, a lista alternativa permite selecionar um arquivo e o painel mostra o raio SEMPRE com o selo "provisório"
//   4) Fluxo: uma rota da fixture abre o fluxograma com o handler e a tabela tocada
//   5) Exportar Mermaid pela pasta padrão (fora de docs/); destino em `docs/` é recusado pelo main
//   6) Método: `stackx-detectar` e `legadox-raio` digitados num Pane de CLI falsa, citando o pacote em `.expxv/mapa/<carimbo>/` (caminho RELATIVO); `docs/**` idêntico antes e depois
//   7) zero diálogo nativo e nenhum canal `mapa:*` aceita caminho absoluto, `..` nem workspace alheio
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, esperar, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface Resumo { estado: string; arquivos: number; analisando: boolean; linguagens: Array<{ linguagem: string }> }
interface JanelaMapa {
  ade: {
    mapa: {
      resumo(ws: string): Promise<Resumo>;
      analisar(ws: string, modo: "completo" | "incremental", historia?: boolean): Promise<{ execucao_id: number }>;
      analise(ws: string, tipo: string): Promise<{ dados: { itens?: Array<{ id: string; chave: string }> } }>;
      raio(ws: string, arquivos: string[]): Promise<{ faixa: string; nota: string }>;
      exportar(ws: string, formato: string, vista: unknown, destino?: string): Promise<{ caminho: string; bytes: number }>;
      disparar(ws: string, p: { acao: string; pane_id: string; trabalho_id?: string; arquivos?: string[] }): Promise<{ comando: string; carimbo: string; pacote: string }>;
    };
    missoes: { detalhe(id: string): Promise<{ panes: Array<{ id: string; tipo: string; estado: string }> } | null> };
  };
}

let amb: AmbienteOrq;
beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  const src = join(amb.raiz, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "repo.ts"), "export function lerUsuarios(db: { query(sql: string): unknown }) {\n  return db.query('SELECT * FROM usuarios');\n}\n");
  writeFileSync(join(src, "servico.ts"), "import { lerUsuarios } from './repo';\nexport function listar(db: { query(sql: string): unknown }) {\n  return lerUsuarios(db);\n}\n");
  writeFileSync(join(src, "rotas.ts"), "import { listar } from './servico';\ndeclare const app: { get(p: string, h: (...a: unknown[]) => unknown): void };\napp.get('/users', (_req, _res) => listar({ query: () => [] }));\n");
  mkdirSync(join(amb.raiz, "docs"), { recursive: true });
  writeFileSync(join(amb.raiz, "docs", "LEIA.md"), "documentação do usuário\n");
  await vigiarDialogos(amb.app);
}, 120_000);
afterAll(async () => { await amb?.fechar(); });

const pagina = () => amb.app.pagina;
const ev = <T, A>(fn: (w: JanelaMapa, a: A) => Promise<T>, a: A): Promise<T> => pagina().evaluate(`(${fn.toString()})(window, ${JSON.stringify(a)})`) as Promise<T>;

function arvoreDocs(): string {
  const h = createHash("sha1");
  const andar = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const c = join(d, n);
      if (statSync(c).isDirectory()) { h.update(`d:${n}\n`); andar(c); } else h.update(`f:${n}:${readFileSync(c).toString("base64")}\n`);
    }
  };
  andar(join(amb.raiz, "docs"));
  return h.digest("hex");
}

describe("mapa do código no Electron real", () => {
  const docsAntes = (): string => arvoreDocs();
  let hashDocs = "";

  it("abre pela navegação com uma linha de controles e 7 visões; antes de analisar nada roda sozinho", async () => {
    hashDocs = docsAntes();
    await pagina().locator('nav[aria-label="Principal"] button', { hasText: "Mapa" }).click();
    await pagina().mouse.move(900, 500);
    await pagina().waitForSelector("[data-tela-mapa]", { timeout: 15_000 });
    expect(await pagina().locator('[data-tela-mapa] [role="tab"]').allTextContents()).toEqual(["Grafo", "Camadas", "Fluxo", "Hotspots", "Entradas", "Dados", "Dívida"]);
    expect(await pagina().locator('[data-tela-mapa] [role="toolbar"]').count()).toBe(1);
    await pagina().getByRole("button", { name: "Analisar este projeto" }).waitFor();
    expect((await ev((w, ws: string) => w.ade.mapa.resumo(ws), amb.wsId)).estado).toBe("vazio");
  });

  it("Analisar leva ao estado pronto com as linguagens do projeto", async () => {
    await pagina().getByRole("button", { name: "Analisar este projeto" }).click();
    const r = await esperar(async () => {
      const x = await ev((w, ws: string) => w.ade.mapa.resumo(ws), amb.wsId);
      return x.estado === "pronto" && !x.analisando ? x : null;
    }, 60_000, 200);
    expect(r.arquivos).toBeGreaterThanOrEqual(3);
    expect(r.linguagens.map((l) => l.linguagem)).toContain("typescript");
    await pagina().waitForSelector('[data-tela-mapa] canvas[role="application"]', { timeout: 15_000 });
  });

  it("selecionar um arquivo pela lista alternativa mostra o raio com o selo 'provisório'", async () => {
    await pagina().getByRole("button", { name: "Ver como lista" }).click();
    await pagina().getByRole("combobox", { name: "Agrupar por" }).selectOption("arquivo");
    await pagina().getByRole("list", { name: "Nós do grafo" }).getByRole("button", { name: /repo\.ts/ }).click();
    const raio = pagina().getByRole("region", { name: "Raio de impacto provisório" });
    await raio.waitFor({ timeout: 15_000 });
    expect((await raio.allTextContents()).join(" ")).toContain("provisório");
    const r = await ev((w, x: { ws: string }) => w.ade.mapa.raio(x.ws, ["src/repo.ts"]), { ws: amb.wsId });
    expect(r.nota).toMatch(/provisório/);
    expect(["BAIXO", "MEDIO", "ALTO"]).toContain(r.faixa);
  });

  it("uma rota da fixture abre o fluxograma até a tabela", async () => {
    await pagina().getByRole("tab", { name: "Entradas" }).click();
    await pagina().getByRole("button", { name: /GET \/users/ }).click();
    await pagina().getByRole("group", { name: "Fluxograma da entrada" }).waitFor({ timeout: 15_000 });
    expect(await pagina().getByRole("tab", { name: "Fluxo", selected: true }).count()).toBe(1);
    expect(await pagina().locator("[data-tela-mapa] .mp-fl-no").count()).toBeGreaterThanOrEqual(2);
  });

  it("exporta Mermaid na pasta padrão; destino dentro de docs/ nunca é aceito", async () => {
    const r = await ev((w, ws: string) => w.ade.mapa.exportar(ws, "mermaid", { tipo: "grafo", nivel: "arquivo" }, "padrao"), amb.wsId);
    expect(existsSync(r.caminho)).toBe(true);
    expect(r.caminho.startsWith(join(amb.raiz, "docs"))).toBe(false);
    expect(readFileSync(r.caminho, "utf8")).toMatch(/flowchart|graph/);
    const recusa = await pagina().evaluate(([ws]) => (window as unknown as JanelaMapa).ade.mapa.exportar(ws as string, "json", { tipo: "relatorio" }, "../docs" as never).then(() => "aceitou", (e: Error) => e.message), [amb.wsId]);
    expect(recusa).not.toBe("aceitou");
  });

  it("Método: stackx-detectar e legadox-raio digitados num Pane de CLI, com o caminho RELATIVO do pacote; docs/ idêntico", async () => {
    const missao = await amb.iniciarMissao("Mapa e2e", {});
    const pane = await esperar(async () => {
      const d = await ev((w, id: string) => w.ade.missoes.detalhe(id), missao.id);
      return d?.panes.find((p) => p.tipo === "cli" && p.estado !== "encerrado") ?? null;
    }, 30_000, 200);
    const a = await ev((w, x: { ws: string; pane: string }) => w.ade.mapa.disparar(x.ws, { acao: "stackx_detectar", pane_id: x.pane }), { ws: amb.wsId, pane: pane.id });
    expect(a.comando).toMatch(/^\/expx:stackx-detectar /);
    expect(a.comando).toContain(".expxv/mapa/");
    expect(a.comando).not.toContain(amb.raiz);
    expect(a.comando).not.toMatch(/[\r\n]/);
    expect(existsSync(join(amb.raiz, a.pacote, "RESUMO.md"))).toBe(true);
    const b = await ev((w, x: { ws: string; pane: string }) => w.ade.mapa.disparar(x.ws, { acao: "legadox_raio", pane_id: x.pane, trabalho_id: "mapa-e2e", arquivos: ["src/repo.ts"] }), { ws: amb.wsId, pane: pane.id });
    expect(b.comando).toMatch(/^\/expx:legadox-raio mapa-e2e /);
    expect(b.comando).toContain("src/repo.ts");
    expect(arvoreDocs()).toBe(hashDocs);
  });

  it("nenhum canal mapa:* aceita caminho absoluto, '..' nem workspace alheio; zero diálogo nativo", async () => {
    const erros = await pagina().evaluate(async ([ws]) => {
      const m = (window as unknown as JanelaMapa).ade.mapa;
      const tenta = (p: Promise<unknown>) => p.then(() => "aceitou", (e: Error) => String(e.message));
      return [
        await tenta(m.raio(ws as string, ["/etc/passwd"])),
        await tenta(m.raio(ws as string, ["../fora.ts"])),
        await tenta(m.resumo("ws_inexistente0")),
      ];
    }, [amb.wsId]);
    for (const e of erros) expect(e).not.toBe("aceitou");
    expect(await dialogosChamados(amb.app)).toEqual([]);
  });
});
