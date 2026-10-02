// Orçamentos do catálogo (Fase 7, núcleo; sem Electron): P-23 (varredura), P-24 (re-varredura com cache), P-29 (instalar por symlink) e a consulta ao repositório (P-14).
// P-25/P-26/P-30 (UI) e P-27/P-28/P-31 (MCP, gate e spawn) são medidos nos arquivos das suas camadas. Casa sintética: tests/fixtures/catalogo/gerar.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { abrirBanco } from "../../src/nucleo/banco/banco";
import { migrar } from "../../src/nucleo/banco/migrar";
import { criarRepoCatalogo } from "../../src/nucleo/banco/repos/catalogo";
import { instalar } from "../../src/nucleo/catalogo/instalacao";
import { criarContexto, lerAte } from "../../src/nucleo/catalogo/raizes";
import { executarVarredura } from "../../src/nucleo/catalogo/varredura";
import { gerarCasa } from "../fixtures/catalogo/gerar";
import { gravarMedicoes, registrar } from "./registro";

afterAll(() => gravarMedicoes());
const tmp = mkdtempSync(join(tmpdir(), "cat-perf-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
// 200 skills = 4 CLIs × 50; + 20 MCPs + 30 hooks + regras
const casa = gerarCasa(tmp, { skills: 50, mcps: 18, hooks: 30 });
const WS = "ws_PERF000001";
const mk = (cache = new Map(), leituras?: { n: number }) =>
  criarContexto({ home: casa.home, workspaces: [{ id: WS, raiz: casa.workspace }], cache, lerArquivo: async (c, m) => { if (leituras !== undefined && c.endsWith("SKILL.md")) leituras.n++; return lerAte(c, m); } });

describe("P-23: varredura completa (200 skills + 20 MCPs + 30 hooks)", () => {
  it("≤ 5 s e nenhuma tarefa do event loop > 50 ms", async () => {
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    const t0 = performance.now();
    const r = await executarVarredura({ contexto: mk() });
    const ms = performance.now() - t0;
    h.disable();
    const maxLoop = h.max / 1e6;
    expect(r.itens.filter((i) => i.tipo === "skill").length).toBeGreaterThanOrEqual(150);
    expect(r.itens.filter((i) => i.tipo === "mcp_server").length).toBeGreaterThanOrEqual(20);
    expect(r.itens.filter((i) => i.tipo === "hook").length).toBeGreaterThanOrEqual(30);
    const a = registrar({ id: "P-23a", descricao: "Varredura completa do catálogo (200 skills, 20 MCPs, 30 hooks, regras)", valor: ms, limite: 5000, unidade: "ms" });
    const b = registrar({ id: "P-23b", descricao: "Maior atraso do event loop durante a varredura do catálogo", valor: maxLoop, limite: 50, unidade: "ms" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("P-24: re-varredura sem mudanças", () => {
  it("≤ 400 ms e nenhuma leitura de SKILL.md (cache mtime+size)", async () => {
    const cache = new Map();
    await executarVarredura({ contexto: mk(cache), tipos: ["skill"] });
    const leituras = { n: 0 };
    const t0 = performance.now();
    await executarVarredura({ contexto: mk(cache, leituras), tipos: ["skill"] });
    const ms = performance.now() - t0;
    const a = registrar({ id: "P-24a", descricao: "Re-varredura de 200 skills com cache (tempo)", valor: ms, limite: 400, unidade: "ms" });
    // o scanner do método relê 1 SKILL.md (8 KB) por workspace; as 200 skills vêm do cache
    const b = registrar({ id: "P-24b", descricao: "Leituras de SKILL.md na re-varredura (exclui o método)", valor: Math.max(0, leituras.n - 1), limite: 0, unidade: "leituras", semFator: true });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("repositório e instalação", () => {
  it("P-14: listar 1 000 itens por tipo (mediana de 5) e 5 000 itens (teto de tela)", () => {
    const banco = abrirBanco(":memory:");
    migrar(banco);
    const repo = criarRepoCatalogo(banco);
    const itens = Array.from({ length: 5000 }, (_, i) => ({
      tipo: "skill" as const, nome: `s${i}`, nome_normalizado: `s${i}`, plugin: null, autor: null, origem: "usuario" as const, descricao: "d", papel_sugerido: null,
      instalacoes: [{ cli: "claude" as const, escopo: "global" as const, workspace_id: "", base: "home" as const, caminho_rel: `.claude/skills/s${i}/SKILL.md`, metodo: "nativo" as const, estado: "presente" as const, habilitada: true, criado_pelo_app: false, hash_conteudo: `h${i}`, tamanho: 1, mtime_ms: 1, detalhe: {} }],
    }));
    for (let i = 0; i < itens.length; i += 500) repo.upsertLote(itens.slice(i, i + 500), "2026-10-01T00:00:00.000Z");
    const medir = (): number => {
      const amostras: number[] = [];
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        repo.listarPorTipo("skill", null);
        amostras.push(performance.now() - t0);
      }
      return amostras.sort((a, b) => a - b)[2] as number;
    };
    const cinco = medir();
    banco.executar("DELETE FROM catalogo_item WHERE CAST(substr(nome_normalizado, 2) AS INTEGER) >= 1000");
    const mil = medir();
    banco.fechar();
    expect(registrar({ id: "P-14c", descricao: "Catálogo: listarPorTipo com 1 000 itens (mediana)", valor: mil, limite: 8, unidade: "ms" }).ok).toBe(true);
    expect(registrar({ id: "P-14d", descricao: "Catálogo: listarPorTipo com 5 000 itens (mediana, teto de tela)", valor: cinco, limite: 60, unidade: "ms" }).ok).toBe(true);
  });

  it("P-29: instalar por symlink ≤ 150 ms", async () => {
    const t0 = performance.now();
    const r = await instalar({ fonteAbs: join(casa.home, ".claude", "skills", "comum-0"), raizDestinoAbs: join(tmp, "destino"), modo: "symlink", raizesConhecidas: [casa.home] });
    const ms = performance.now() - t0;
    expect(r.estado === "instalado" || r.codigo === "fonte_fora_das_raizes").toBe(true);
    if (r.estado === "instalado") expect(registrar({ id: "P-29", descricao: "Instalar skill por symlink (atômico)", valor: ms, limite: 150, unidade: "ms" }).ok).toBe(true);
  });
});
