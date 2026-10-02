// Gerenciador do mapa no main (T-17.33), portas das Fases 18/19 e porta `map_*` do MCP (T-17.32) sobre um projeto real analisado:
// sob demanda (0 serviços e nenhum arquivo criado antes do uso), disparo seguro nos Panes, ociosidade, opt-in de agentes.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../../tests/fixtures/mapa/compilar";
import { escrever, pastaTmp, removerPasta } from "../../tests/fixtures/vcs/repos";
import type { EventoMapaIpc } from "../compartilhado/mapa";
import { ErroMcp } from "../nucleo/mcp/erros";
import { criarGerenciadorMapa, type GerenciadorMapa, type PaneParaMapa } from "./mapa";
import { criarPortaMapaMcp } from "./mapa-mcp";

let dist = "";
const pastas: string[] = [];
const gerenciadores: GerenciadorMapa[] = [];
beforeAll(() => {
  dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);
});
afterEach(async () => {
  for (const g of gerenciadores.splice(0)) await g.encerrar();
});
afterAll(() => {
  for (const p of pastas) removerPasta(p);
});

const WS = "ws_AAAAAAAAAAAA";
const BASE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", main: "src/a.ts", scripts: { test: "vitest" }, dependencies: { express: "^4.0.0" } }),
  "docs/LEIA.md": "docs do projeto\n",
  "src/a.ts": 'import { b } from "./b";\nexport function a(x: number): number {\n  return b(x) + 1;\n}\n',
  "src/b.ts": 'import { c } from "./c";\nexport function b(x: number): number {\n  return c(x) * 2;\n}\n',
  "src/c.ts": 'import { a } from "./a";\nexport function c(x: number): number {\n  if (x > 10) return a(x - 1);\n  return x;\n}\n',
  "src/a.test.ts": 'import { a } from "./a";\nit("a", () => { a(1); });\n',
  "src/rotas.ts": 'import express from "express";\nimport { a } from "./a";\nconst app = express();\napp.get("/ping", (req, res) => res.send(String(a(1))));\n',
};

function montar(opcoes: { panes?: Record<string, PaneParaMapa>; ociosoMs?: number } = {}) {
  const raiz = pastaTmp("ade-mapa-main-");
  const dados = pastaTmp("ade-mapa-main-db-");
  pastas.push(raiz, dados);
  for (const [c, t] of Object.entries(BASE)) escrever(raiz, c, t);
  const eventos: EventoMapaIpc[] = [];
  const dominio: Array<{ tipo: string; payload: unknown }> = [];
  const digitados: Array<{ pane: string; texto: string }> = [];
  const panes: Record<string, PaneParaMapa> = opcoes.panes ?? { pane_ok: { id: "pane_ok", workspace_id: WS, cli: "claude", estado: "pronto", papel: "executor" } };
  const g = criarGerenciadorMapa({
    pastaDados: dados,
    workspaceRaiz: (id) => (id === WS ? raiz : null),
    pane: (id) => panes[id],
    enviarComando: async (pane, texto) => {
      digitados.push({ pane, texto });
    },
    escolherPasta: async () => null,
    emitir: (e) => eventos.push(e),
    barramento: { emitir: (tipo, payload) => dominio.push({ tipo, payload }) },
    caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"),
    caminhoWorkerDerivada: join(dist, "nucleo/mapa/worker-derivada.js"),
    atrasoVerificacaoMs: 10,
    ociosoMs: opcoes.ociosoMs ?? 5 * 60_000,
  });
  gerenciadores.push(g);
  return { g, raiz, dados, eventos, dominio, digitados };
}

async function analisado(m: ReturnType<typeof montar>): Promise<void> {
  const f = await m.g.fachada(WS);
  await f.analisar("completo", false);
  await f.servico.aguardar();
}

function arvore(raiz: string, sub: string): string[] {
  const base = join(raiz, sub);
  if (!existsSync(base)) return [];
  const saida: string[] = [];
  const andar = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else saida.push(`${relative(raiz, p)}:${readFileSync(p, "utf8").length}`);
    }
  };
  andar(base);
  return saida;
}

describe("gerenciador do mapa no main", () => {
  it("sob demanda: 0 serviços e nenhum arquivo criado antes do uso; resumo vazio não abre banco", async () => {
    const m = montar();
    expect(m.g.vivos()).toBe(0);
    const r = await m.g.resumo(WS);
    expect(r.estado).toBe("vazio");
    expect(r.arquivos).toBe(0);
    expect(r.configuracao.expor_agentes).toBe(false);
    expect(r.configuracao.auto_atualizar).toBe(false);
    expect(m.g.vivos()).toBe(0);
    expect(existsSync(join(m.dados, "mapas"))).toBe(false);
    await expect(m.g.resumo("ws_inexistente0")).rejects.toThrow(/workspace não encontrado/);
  });

  it("analisa e emite eventos para o renderer e para o barramento de domínio", async () => {
    const m = montar();
    await analisado(m);
    expect(m.g.vivos()).toBe(1);
    const r = await m.g.resumo(WS);
    expect(r.estado).toBe("pronto");
    expect(r.arquivos).toBe(5);
    expect(m.eventos.some((e) => e.tipo === "mudou")).toBe(true);
    const tipos = m.dominio.map((d) => d.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["map.analysis_progress", "map.updated", "map.analysis_finished"]));
  }, 60_000);

  it("o VCS avisa de mudança: conta o que mudou de fato (banner) e só atualiza sozinho com opt-in", async () => {
    const m = montar();
    await analisado(m);
    const f = await m.g.fachada(WS);
    writeFileSync(join(m.raiz, "src/c.ts"), "export function c(x: number): number {\n  return x;\n}\n");
    m.g.aoMudar(WS, []);
    await new Promise((r) => setTimeout(r, 400));
    let r = f.resumo();
    expect(r.desatualizado).toBe(true);
    expect(r.alterados_n).toBe(1);
    expect(r.versao_mapa).toBeGreaterThan(0);
    // sem opt-in nada foi reanalisado
    expect(f.analise("ciclos").dados.total).toBe(1);
    // com opt-in: atualiza em ocioso
    f.configGravar({ auto_atualizar: true });
    m.g.aoMudar(WS, []);
    await new Promise((res) => setTimeout(res, 400));
    await f.servico.aguardar();
    r = f.resumo();
    expect(r.alterados_n).toBe(0);
    expect(f.analise("ciclos").dados.total).toBe(0);
  }, 60_000);

  it("disparo: digita o comando com o caminho RELATIVO do pacote, grava só em .expxv/mapa e deixa docs/ idêntico", async () => {
    const m = montar();
    await analisado(m);
    const antes = arvore(m.raiz, "docs");
    const r = await m.g.disparar(WS, { acao: "stackx_detectar", pane_id: "pane_ok" });
    expect(r.comando.startsWith("/expx:stackx-detectar ")).toBe(true);
    expect(r.comando).toContain(r.pacote);
    expect(r.pacote).toMatch(/^\.[^/]+\/mapa\/\d{8}T\d{6}Z\/?$/);
    expect(r.comando).not.toContain(m.raiz);
    expect(r.comando).not.toMatch(/[\r\n]/);
    expect(m.digitados).toEqual([{ pane: "pane_ok", texto: r.comando }]);
    expect(existsSync(join(m.raiz, r.pacote, "RESUMO.md"))).toBe(true);
    expect(arvore(m.raiz, "docs")).toEqual(antes);
    // legadox_raio exige trabalho e arquivos; e grava o raio no pacote
    await expect(m.g.disparar(WS, { acao: "legadox_raio", pane_id: "pane_ok" })).rejects.toThrow();
    const rr = await m.g.disparar(WS, { acao: "legadox_raio", pane_id: "pane_ok", trabalho_id: "OC-7", arquivos: ["src/a.ts"] });
    expect(rr.comando.startsWith("/expx:legadox-raio OC-7")).toBe(true);
    expect(existsSync(join(m.raiz, rr.pacote, "raio-OC-7.json"))).toBe(true);
  }, 60_000);

  it("disparo recusado: Pane de outro workspace, ocupado, sem CLI compatível, ação humana; nada é gravado nem digitado", async () => {
    const panes: Record<string, PaneParaMapa> = {
      outro: { id: "outro", workspace_id: "ws_BBBBBBBBBBBB", cli: "claude", estado: "pronto", papel: "executor" },
      ocupado: { id: "ocupado", workspace_id: WS, cli: "claude", estado: "trabalhando", papel: "executor" },
      codex: { id: "codex", workspace_id: WS, cli: "codex", estado: "pronto", papel: "executor" },
      revisor: { id: "revisor", workspace_id: WS, cli: "claude", estado: "pronto", papel: "revisor" },
    };
    const m = montar({ panes });
    await analisado(m);
    for (const id of ["outro", "ocupado", "codex", "revisor", "inexistente"]) {
      await expect(m.g.disparar(WS, { acao: "stackx_detectar", pane_id: id }), id).rejects.toThrow();
    }
    expect(m.digitados).toEqual([]);
    expect(existsSync(join(m.raiz, ".expxv"))).toBe(false);
  }, 60_000);

  it("ociosidade: o serviço ocioso é encerrado (0 handles); com análise em curso não", async () => {
    const m = montar({ ociosoMs: 1 });
    await analisado(m);
    expect(m.g.vivos()).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await m.g.varrerOciosos()).toBe(1);
    expect(m.g.vivos()).toBe(0);
    // reabre sob demanda e continua pronto (o banco ficou em disco)
    expect((await m.g.resumo(WS)).estado).toBe("pronto");
    expect(m.g.vivos()).toBe(1);
  }, 60_000);

  it("portas das Fases 18 e 19: raio e alterações sobre o mapa real; sem mapa devolvem null (nunca zero)", async () => {
    const m = montar();
    expect(await m.g.portaAgil().raio(WS, ["src/a.ts"])).toBeNull();
    expect(await m.g.portaRelatorios().alteracoes(WS, ["src/a.ts"])).toBeNull();
    await analisado(m);
    const r = await m.g.portaAgil().raio(WS, ["src/a.ts"]);
    expect(r).not.toBeNull();
    expect(["baixo", "medio", "alto"]).toContain(r?.faixa);
    expect(typeof r?.sem_cobertura).toBe("boolean");
    expect(await m.g.portaAgil().raio(WS, ["src/nao-existe.ts"])).toBeNull();
    const alt = await m.g.portaRelatorios().alteracoes(WS, ["src/a.ts", "src/b.ts", "package.json"]);
    expect(alt?.modulos).toEqual(expect.arrayContaining([{ nome: "src", arquivos: 2 }]));
    expect(alt?.ciclos).toBe(1);
  }, 60_000);
});

describe("porta map_* do MCP (opt-in: nomes, caminhos e linhas chegam ao modelo)", () => {
  async function com() {
    const m = montar();
    const porta = criarPortaMapaMcp({ gerenciador: m.g, existeBanco: (ws) => existsSync(join(m.dados, "mapas", ws, "mapa.db")) });
    return { m, porta };
  }

  it("sem banco ou sem opt-in: indisponível, e consultar não cria nada", async () => {
    const { m, porta } = await com();
    expect(await porta.disponivel(WS)).toBe(false);
    expect(existsSync(join(m.dados, "mapas"))).toBe(false);
    await analisado(m);
    expect(await porta.disponivel(WS)).toBe(false); // padrão: agentes NÃO enxergam o mapa
    await expect(porta.status(WS)).rejects.toMatchObject({ subcode: "map_not_ready" });
    (await m.g.fachada(WS)).configGravar({ expor_agentes: true });
    expect(await porta.disponivel(WS)).toBe(true);
    (await m.g.fachada(WS)).configGravar({ habilitado: false });
    expect(await porta.disponivel(WS)).toBe(false);
  }, 60_000);

  it("status, query (callers, callees, cycles, entrypoints, tables, hotspots, layers, unused, externals), impact e evidence", async () => {
    const { m, porta } = await com();
    await analisado(m);
    (await m.g.fachada(WS)).configGravar({ expor_agentes: true });
    const st = await porta.status(WS);
    expect(st.state).toBe("ready");
    expect(st.files).toBe(5);
    expect(st.history).toBe("unavailable");
    const q = (kind: Parameters<typeof porta.query>[1]["kind"], target: string | null = null) => porta.query(WS, { kind, target, depth: 1, limit: 20, min_confidence: "heuristic" });
    const callers = await q("callers", "src/b.ts");
    expect(callers.items.map((i) => i.path)).toContain("src/a.ts");
    const callees = await q("callees", "src/a.ts");
    expect(callees.items.map((i) => i.path)).toContain("src/b.ts");
    expect((await q("cycles")).items[0]?.kind).toBe("cycle");
    expect((await q("entrypoints")).items.some((i) => i.label === "GET /ping")).toBe(true);
    expect((await q("tables")).items).toBeInstanceOf(Array);
    expect((await q("layers")).items.length).toBeGreaterThan(0);
    expect((await q("externals")).items.some((i) => i.label === "express")).toBe(true);
    expect((await q("unused")).items).toBeInstanceOf(Array);
    expect((await q("hotspots")).items).toEqual([]); // sem história git
    expect((await q("search", "rotas")).items.length).toBeGreaterThan(0);
    const imp = await porta.impact(WS, { files: ["src/a.ts"], symbols: [] });
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(imp.band);
    expect(imp.callers).toContain("src/rotas.ts");
    expect(imp.note).toMatch(/provisório/);
    expect(imp.signals).toHaveLength(8);
    const ev = await porta.evidence(WS, { topic: "tests", scope: null, limit: 10 });
    expect(ev.facts.length).toBeGreaterThan(0);
    expect(ev.facts[0]?.evidence.every((e) => /^[^:]+:\d+$/.test(e))).toBe(true);
    expect((await porta.evidence(WS, { topic: "entrypoints", scope: null, limit: 10 })).facts.length).toBeGreaterThan(0);
    // nenhuma resposta traz código-fonte nem caminho absoluto
    const tudo = JSON.stringify([callers, callees, imp, ev]);
    expect(tudo).not.toContain(m.raiz);
    expect(tudo).not.toContain("return b(x) + 1");
  }, 60_000);

  it("argumentos inválidos viram erro MCP tipado", async () => {
    const { m, porta } = await com();
    await analisado(m);
    (await m.g.fachada(WS)).configGravar({ expor_agentes: true });
    await expect(porta.impact(WS, { files: ["../fora.ts"], symbols: [] })).rejects.toBeInstanceOf(ErroMcp);
    await expect(porta.impact(WS, { files: ["src/nao-existe.ts"], symbols: [] })).rejects.toBeInstanceOf(ErroMcp);
    await expect(porta.query(WS, { kind: "callers", target: null, depth: 1, limit: 5, min_confidence: "exact" })).rejects.toBeInstanceOf(ErroMcp);
    await expect(porta.query(WS, { kind: "callers", target: "/etc/passwd", depth: 1, limit: 5, min_confidence: "exact" })).rejects.toBeInstanceOf(ErroMcp);
  }, 60_000);
});
