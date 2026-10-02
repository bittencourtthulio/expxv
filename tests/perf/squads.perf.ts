// Orçamentos de squads do núcleo (Fase 14; P-201, P-203, P-207) — Node puro, disco real em os.tmpdir, sem Electron e sem rede.
//  - P-200.lista: abrir a lista com 100 squads (índice em memória, sem tocar o disco) p95 ≤ 50 ms.
//  - P-201.carga: carregar fábrica (17) + 50 do usuário em ocioso (≈ 400 arquivos .md) mediana ≤ 80 ms (fora do main).
//  - P-201.validar: `validarSquad` de 12 membros p95 ≤ 1 ms (limite do plano; o do dono é 5 ms).
//  - P-203: renderizar o prompt do membro (16 KB + RAG 4 KB + 50 arquivos) mediana ≤ 2 ms.
//  - P-207: exportar + prévia + importar 50 squads ≤ 300 ms; prévia de uma squad p95 ≤ 50 ms.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gravarSquadNoDiretorio } from "../../src/nucleo/squads/formato";
import { criarLoja } from "../../src/nucleo/squads/loja";
import { renderizarPromptDoMembro } from "../../src/nucleo/squads/prompt";
import type { Membro, Squad } from "../../src/nucleo/squads/tipos";
import { validarSquad } from "../../src/nucleo/squads/validar";
import { gravarMedicoes, percentil, registrar } from "./registro";

const FABRICA = join(__dirname, "..", "..", "resources", "squads");
const pastas: string[] = [];
afterAll(() => {
  gravarMedicoes();
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

const membro = (slug: string, papel: Membro["papel"]): Membro => ({
  slug, papel, rotulo: slug, descricao: "descrição curta do membro", prompt: `membros/${slug}.md`,
  perfil: { cli: "claude", modelo: papel === "reviewer" ? "opus" : "sonnet", esforco: "medio", faixa: "medio" },
  skills_permitidas: ["ev-builder", "ev-evidence-before-done"], mcps_permitidos: [], hooks: [], max_instancias: 1,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null,
});
function squad(slug: string, executores = 3): Squad {
  const membros = [membro("orq", "orchestrator"), membro("rev", "reviewer"), ...Array.from({ length: executores }, (_, i) => membro(`ex${i}`, "executor"))];
  return { slug, nome: `Squad ${slug}`, descricao: "d", escopo: "desenvolvimento", rigidez_padrao: null, max_instancias_paralelas: 4, orcamento: { tempo_min: null, tokens: null, modo: "soft" }, portoes: null, fabrica: null, origem: "usuario", membros };
}
const prompts = (s: Squad): Record<string, string> => Object.fromEntries(s.membros.map((m) => [m.slug, `# ${m.rotulo}\n${"Instrução do membro com texto comum.\n".repeat(60)}{{objetivo}}`]));
async function popular(pasta: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const s = squad(`s${i}`);
    await gravarSquadNoDiretorio(join(pasta, s.slug), s, prompts(s));
  }
}
const novaPasta = (): string => {
  const p = mkdtempSync(join(tmpdir(), "perf-squads-"));
  pastas.push(p);
  return p;
};

describe("orçamentos de squads (Fase 14)", () => {
  it("P-200.lista: listar 100 squads (índice em memória) p95 ≤ 50 ms", async () => {
    const usuario = novaPasta();
    await popular(usuario, 100);
    const loja = criarLoja({ pastaUsuario: usuario, pastaFabrica: null });
    await loja.carregar();
    const t: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const l = loja.listar();
      t.push(performance.now() - t0);
      expect(l).toHaveLength(100);
    }
    const m = registrar({ id: "P-200.lista", descricao: "listar 100 squads (índice, p95)", valor: percentil(t, 95), limite: 50, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `p95 ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-201.carga: fábrica (17) + 50 do usuário em ocioso, mediana ≤ 80 ms", async () => {
    const usuario = novaPasta();
    await popular(usuario, 50);
    const t: number[] = [];
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const loja = criarLoja({ pastaUsuario: usuario, pastaFabrica: FABRICA });
      const t0 = performance.now();
      await loja.carregar();
      t.push(performance.now() - t0);
      total = loja.listar().length;
      expect(loja.listar().every((s) => s.valida)).toBe(true);
    }
    expect(total).toBe(67);
    const m = registrar({ id: "P-201.carga", descricao: "carregar 17 de fábrica + 50 do usuário (mediana)", valor: percentil(t, 50), limite: 80, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `mediana ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-201.validar: validarSquad de 12 membros p95 ≤ 1 ms", () => {
    const s = squad("grande", 10);
    const ctx = { skillsConhecidas: new Set(["ev-builder", "ev-evidence-before-done"]), mcpsConhecidos: new Set(["context7"]), clisInstaladas: ["claude"] };
    for (let i = 0; i < 50; i++) validarSquad(s, ctx);
    const t: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t0 = performance.now();
      validarSquad(s, ctx);
      t.push(performance.now() - t0);
    }
    const m = registrar({ id: "P-201.validar", descricao: "validarSquad 12 membros (p95)", valor: percentil(t, 95), limite: 1, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `p95 ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-203: renderizar prompt (16 KB + RAG 4 KB + 50 arquivos) mediana ≤ 2 ms", () => {
    const texto = `${"Linha de instrução do membro com {{rotulo}} e texto comum.\n".repeat(270)}{{objetivo}}{{contexto_rag}}{{arquivos}}`;
    const vars = { objetivo: "obj ".repeat(200), contexto_rag: "rag ".repeat(1000), arquivos: Array.from({ length: 50 }, (_, i) => `src/modulo/arquivo-${i}.ts`), rotulo: "R", squad: "S" };
    for (let i = 0; i < 30; i++) renderizarPromptDoMembro(texto, vars);
    const t: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      renderizarPromptDoMembro(texto, vars);
      t.push(performance.now() - t0);
    }
    const m = registrar({ id: "P-203", descricao: "renderizar prompt do membro 16 KB + RAG 4 KB + 50 arquivos (mediana)", valor: percentil(t, 50), limite: 2, unidade: "ms", pior: Math.max(...t) });
    expect(m.ok, `mediana ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });

  it("P-207: exportar + prévia + importar 50 squads ≤ 300 ms (mediana de 3); prévia p95 ≤ 50 ms", async () => {
    const origem = novaPasta();
    await popular(origem, 50);
    const lojaOrigem = criarLoja({ pastaUsuario: origem, pastaFabrica: null });
    await lojaOrigem.carregar();
    const previas: number[] = [];
    const totais: number[] = [];
    for (let rodada = 0; rodada < 3; rodada++) {
      const destino = novaPasta();
      const lojaDestino = criarLoja({ pastaUsuario: destino, pastaFabrica: null });
      await lojaDestino.carregar();
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        const json = await lojaOrigem.exportarJson(`s${i}`);
        const p0 = performance.now();
        const previa = lojaDestino.importarPrevia(json);
        previas.push(performance.now() - p0);
        await lojaDestino.importarConfirmar(previa);
      }
      totais.push(performance.now() - t0);
      expect(lojaDestino.listar()).toHaveLength(50);
    }
    const a = registrar({ id: "P-207", descricao: "exportar + importar 50 squads (mediana de 3)", valor: percentil(totais, 50), limite: 300, unidade: "ms", pior: Math.max(...totais) });
    const b = registrar({ id: "P-207.previa", descricao: "prévia de importação de uma squad (p95)", valor: percentil(previas, 95), limite: 50, unidade: "ms" });
    expect(a.ok, `mediana ${a.valor} ms > ${a.limite} ms`).toBe(true);
    expect(b.ok, `prévia p95 ${b.valor} ms > ${b.limite} ms`).toBe(true);
  });
});
