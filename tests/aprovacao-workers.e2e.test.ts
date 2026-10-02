// E2E da política de aprovações dos workers (D-640) no Electron real: canais `painel_livre:aprovacao*` pelo preload. Escrito para rodar com `npm run build` pronto
// (`npm run test:e2e`); NÃO rodar com o `npm run dev` do dono ativo. O comando de lançamento de cada CLI é provado nos testes de integração (`src/main/orquestracao-aprovacao.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarAmbienteOrq, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";

let amb: AmbienteOrq;
beforeAll(async () => { amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" }); }, 120_000);
afterAll(async () => { await amb?.fechar(); });

interface Pref { nivel: string; proprio: boolean; permitir_raiz: boolean; confiavel: boolean; padrao_global: string }
interface JanelaApr { ade: { painelLivre: { aprovacao(p: Record<string, unknown>): Promise<Pref>; aprovacaoDoPane(id: string): Promise<unknown> } } }
const noApp = <T, A>(fn: (w: JanelaApr, a: A) => Promise<T>, arg: A): Promise<T> => amb.app.pagina.evaluate(new Function("a", `return (${fn.toString()})(window, a)`) as never, arg) as Promise<T>;
const tenta = (p: Record<string, unknown>) => noApp(async (w, x) => { try { return { ok: true as const, v: await w.ade.painelLivre.aprovacao(x as Record<string, unknown>) }; } catch (e) { return { ok: false as const, erro: String((e as Error).message) }; } }, p);

describe("aprovações dos workers no Electron real", () => {
  it("o padrão é automático seguro e o projeto herda o padrão global", async () => {
    const g = await noApp((w) => w.ade.painelLivre.aprovacao({ workspace_id: null }), undefined);
    expect(g.nivel).toBe("automatico_seguro");
    const ws = await noApp((w, id) => w.ade.painelLivre.aprovacao({ workspace_id: id }), amb.wsId);
    expect(ws).toMatchObject({ nivel: "automatico_seguro", proprio: false, permitir_raiz: false, confiavel: true });
  });

  it("o Total só grava com a palavra digitada; o nível inventado e o campo extra são recusados pelo validador", async () => {
    expect((await tenta({ workspace_id: amb.wsId, nivel: "total" })).ok).toBe(false);
    expect((await tenta({ workspace_id: amb.wsId, nivel: "total", confirmacao: "liberar" })).ok).toBe(false);
    expect((await tenta({ workspace_id: amb.wsId, nivel: "bypass" })).ok).toBe(false);
    expect((await tenta({ workspace_id: amb.wsId, nivel: "perguntar", cwd: "/" })).ok).toBe(false);
    const ok = await tenta({ workspace_id: amb.wsId, nivel: "total", confirmacao: "liberar tudo" });
    expect(ok.ok).toBe(true);
    const volta = await tenta({ workspace_id: amb.wsId, herdar: true });
    expect(volta.ok && volta.v).toMatchObject({ nivel: "automatico_seguro", proprio: false });
  });

  it("raiz e confiança só existem por projeto; Pane sem política devolve null", async () => {
    expect((await tenta({ workspace_id: null, permitir_raiz: true })).ok).toBe(false);
    const p = await tenta({ workspace_id: amb.wsId, confiavel: false, permitir_raiz: true });
    expect(p.ok && p.v).toMatchObject({ confiavel: false, permitir_raiz: true });
    await tenta({ workspace_id: amb.wsId, confiavel: true, permitir_raiz: false });
    expect(await noApp((w) => w.ade.painelLivre.aprovacaoDoPane("pane_inexistente0001"), undefined)).toBeNull();
  });
});
