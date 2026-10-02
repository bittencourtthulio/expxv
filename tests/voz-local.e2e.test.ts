// E2E da voz local embutida (Fase 11, D-540 a D-549) no Electron real. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build` (o `dist/` está em uso pelo `npm run dev` do dono).
// Nenhum modelo é baixado (a rede real nunca é tocada): o e2e prova a fronteira e o estado inicial.
//   1) catálogo: o recomendado é o Parakeet TDT v3 com PT-BR, todos os checksums confirmados, nenhum caminho absoluto no renderer
//   2) fronteira: payload com URL/caminho/id fora do formato é recusado; baixar sem o aceite da versão vigente é recusado e NADA é criado em <userData>/voz
//   3) estado inicial: motor local sem modelo = não pronto; ditado não começa (modelo_ausente); nenhum processo de reconhecimento nasce
//   4) UI: Configurações › Voz e captura: "Local neste computador (recomendado)" é a primeira opção e abre o assistente com o recomendado marcado
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirApp } from "./fixture";
import type { AppAberto } from "./fixture";

const temporarias: string[] = [];
let app: AppAberto;
let pastaDados = "";

interface ModeloLista { id: string; recomendado: boolean; pt_br: boolean; baixavel: boolean; instalado: boolean }
interface Ade {
  voz: {
    modelosListar(): Promise<{ modelos: ModeloLista[]; versao_consentimento: string; runtime_disponivel: boolean; pasta_exibicao: string; carregado: boolean }>;
    modeloBaixar(p: unknown): Promise<unknown>;
    modeloApagar(id: string): Promise<unknown>;
    configGravar(p: unknown): Promise<{ motor_pronto: boolean }>;
    iniciar(sessao: string, disparo: string): Promise<{ ok: boolean; codigo: string | null }>;
  };
}
interface Janela { ade: Ade }

beforeAll(async () => {
  pastaDados = mkdtempSync(join(tmpdir(), "ade-e2e-voz-local-"));
  temporarias.push(pastaDados);
  app = await abrirApp({ pastaDados, env: {} });
  await app.pagina.waitForSelector("nav", { timeout: 15_000 });
}, 120_000);
afterAll(async () => {
  await app?.fechar();
  for (const d of temporarias) rmSync(d, { recursive: true, force: true });
});

const chamar = <T>(fn: string, ...args: unknown[]): Promise<T> => app.pagina.evaluate(([f, a]) => ((window as unknown as Janela).ade.voz as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[f as string]!(...(a as unknown[])), [fn, args] as const) as Promise<T>;

describe("voz local embutida (Electron real)", () => {
  it("catálogo: Parakeet TDT v3 recomendado com PT-BR; nenhum caminho absoluto vai ao renderer", async () => {
    const l = await chamar<Awaited<ReturnType<Ade["voz"]["modelosListar"]>>>("modelosListar");
    expect(l.modelos.filter((m) => m.recomendado).map((m) => m.id)).toEqual(["parakeet-tdt-0.6b-v3-int8"]);
    expect(l.modelos.every((m) => m.baixavel && !m.instalado)).toBe(true);
    expect(l.modelos.find((m) => m.recomendado)?.pt_br).toBe(true);
    expect(JSON.stringify(l)).not.toContain(pastaDados);
    expect(l.carregado).toBe(false);
  });

  it("fronteira: URL/caminho/id inválido e aceite de versão antiga são recusados; nada é criado em userData/voz", async () => {
    const recusa = async (p: unknown): Promise<string> => app.pagina.evaluate(async (x) => { try { await (window as unknown as Janela).ade.voz.modeloBaixar(x); return "NAO_FALHOU"; } catch (e) { return String((e as Error).message); } }, p);
    expect(await recusa({ modelo_id: "parakeet-tdt-0.6b-v3-int8", aceite_versao: "x", ativar: true, url: "https://evil.example/m.onnx" })).toMatch(/recusado/);
    expect(await recusa({ modelo_id: "../../etc/passwd", aceite_versao: "x", ativar: true })).toMatch(/recusado/);
    expect(await recusa({ modelo_id: "parakeet-tdt-0.6b-v3-int8", aceite_versao: "versao-antiga", ativar: true })).toMatch(/consentimento/i);
    expect(existsSync(join(pastaDados, "voz", "modelos", "parakeet-tdt-0.6b-v3-int8"))).toBe(false);
    expect(existsSync(join(pastaDados, "voz", "modelos", ".parcial"))).toBe(false);
  });

  it("motor local sem modelo: não pronto e o ditado não começa", async () => {
    const e = await chamar<{ motor_pronto: boolean }>("configGravar", { motor: "local_embutido" });
    expect(e.motor_pronto).toBe(false);
    const r = await app.pagina.evaluate(() => (window as unknown as Janela).ade.voz.iniciar("sessao-inexistente", "segurar"));
    expect(r.ok).toBe(false);
    await chamar("configGravar", { motor: "nenhum" });
  });

  it("UI: Local é a primeira opção e abre o assistente com o recomendado marcado", async () => {
    await app.pagina.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await app.pagina.getByRole("combobox", { name: "Motor de voz" }).waitFor({ timeout: 15_000 });
    const primeira = await app.pagina.getByRole("combobox", { name: "Motor de voz" }).evaluate((s) => (s as HTMLSelectElement).options[0]?.textContent);
    expect(primeira).toBe("Local neste computador (recomendado)");
    await app.pagina.getByRole("button", { name: "Configurar voz local (recomendado)" }).click();
    const marcado = await app.pagina.getByRole("radio", { name: /Parakeet/ }).isChecked();
    expect(marcado).toBe(true);
  });
});
