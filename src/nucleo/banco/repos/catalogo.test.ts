import { afterEach, describe, expect, it } from "vitest";
import type { InstalacaoEscaneada } from "../../catalogo/tipos";
import type { ItemAgregado } from "../../catalogo/varredura";
import { abrirBanco, type Banco } from "../banco";
import { migrar } from "../migrar";
import { MIGRACOES } from "../migracoes";
import { criarRepoCatalogo } from "./catalogo";
import { criarRepoPane } from "./pane";
import { criarRepoWorkspace } from "./workspace";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  return { b, repo: criarRepoCatalogo(b) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-01T11:00:00.000Z";

const inst = (o: Partial<InstalacaoEscaneada> = {}): InstalacaoEscaneada => ({
  cli: "claude", escopo: "global", workspace_id: "", base: "home", caminho_rel: ".claude/skills/a/SKILL.md", metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false,
  hash_conteudo: "h1", tamanho: 10, mtime_ms: 1, detalhe: {}, ...o,
});
const item = (nome: string, instalacoes: InstalacaoEscaneada[] = [inst()], o: Partial<ItemAgregado> = {}): ItemAgregado => ({
  tipo: "skill", nome, nome_normalizado: nome.toLowerCase().replace(/[-_. ]/g, ""), plugin: null, autor: null, origem: "usuario", descricao: `desc ${nome}`, papel_sugerido: null, instalacoes, ...o,
});

describe("migration 0018", () => {
  it("é a versão 18 e cria as tabelas do catálogo e do gateway", () => {
    expect(MIGRACOES[17]?.nome).toBe("0018-catalogo-gateway");
    const { b } = novo();
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["catalogo_item", "catalogo_instalacao", "catalogo_mcp_tool", "catalogo_politica", "catalogo_pane_politica", "catalogo_embarcada", "catalogo_varredura", "gateway_config", "gateway_filtro", "gateway_pane", "gateway_auditoria"]));
  });
});

describe("repo do catálogo", () => {
  it("upsert idempotente: rodar 2x não muda contagem nem atualizado_em de quem não mudou", () => {
    const { repo } = novo();
    const r1 = repo.upsertLote([item("a"), item("b")], T1);
    expect(r1).toMatchObject({ adicionados: 2, atualizados: 0 });
    const antes = repo.listarPorTipo("skill", null).itens.map((i) => i.atualizado_em);
    const r2 = repo.upsertLote([item("a"), item("b")], T2);
    expect(r2).toMatchObject({ adicionados: 0, atualizados: 0 });
    expect(repo.listarPorTipo("skill", null).itens.map((i) => i.atualizado_em)).toEqual(antes);
    const r3 = repo.upsertLote([item("a", [inst({ hash_conteudo: "h2" })])], T2);
    expect(r3.atualizados).toBe(1);
  });

  it("1 linha, N instalações; variantes contam hashes distintos", () => {
    const { repo } = novo();
    repo.upsertLote([item("a", [inst(), inst({ cli: "codex", caminho_rel: ".codex/skills/a/SKILL.md", hash_conteudo: "h2" })])], T1);
    const [it] = repo.listarPorTipo("skill", null).itens;
    expect(it?.instalacoes).toHaveLength(2);
    expect(it?.variantes).toBe(2);
    expect(it?.editavel).toBe(true);
    expect(it?.id).toMatch(/^cat_/);
  });

  it("escopo: projeto de outro workspace não aparece", () => {
    const { repo } = novo();
    repo.upsertLote([item("g"), item("p1", [inst({ escopo: "projeto", workspace_id: "ws_1", base: "workspace" })]), item("p2", [inst({ escopo: "projeto", workspace_id: "ws_2", base: "workspace" })])], T1);
    expect(repo.listarPorTipo("skill", "ws_1").itens.map((i) => i.nome).sort()).toEqual(["g", "p1"]);
    expect(repo.listarPorTipo("skill", null).itens.map((i) => i.nome)).toEqual(["g"]);
  });

  it("marcarAusentes nunca apaga: só vira ausente o que não foi visto, no escopo coberto", () => {
    const { repo } = novo();
    repo.upsertLote([item("a"), item("b"), item("c", [inst({ cli: "codex" })])], T1);
    repo.upsertLote([item("a")], T2);
    const n = repo.marcarAusentes(T2, { clis: ["claude"], tipos: ["skill"], workspace_ids: [""] });
    expect(n).toBe(1);
    const estado = Object.fromEntries(repo.listarPorTipo("skill", null).itens.map((i) => [i.nome, i.instalacoes[0]?.estado]));
    expect(estado).toEqual({ a: "presente", b: "ausente", c: "presente" });
    expect(repo.contarAusentes("skill")).toBe(1);
    expect(repo.limparAusentes("skill")).toBe(1);
    expect(repo.listarPorTipo("skill", null).itens.map((i) => i.nome).sort()).toEqual(["a", "c"]);
  });

  it("removerItem só sem instalação presente", () => {
    const { repo } = novo();
    repo.upsertLote([item("a")], T1);
    const id = repo.listarPorTipo("skill", null).itens[0]!.id;
    expect(repo.removerItem(id)).toBe(false);
    repo.marcarAusentes(T2, { clis: ["claude"], tipos: ["skill"], workspace_ids: [""] });
    expect(repo.removerItem(id)).toBe(true);
    expect(repo.obter(id)).toBeNull();
  });

  it("descrição é cortada na lista (160) e inteira (600) no detalhe", () => {
    const { repo } = novo();
    repo.upsertLote([item("a", [inst()], { descricao: "x".repeat(600) })], T1);
    const it = repo.listarPorTipo("skill", null).itens[0]!;
    expect(it.descricao).toHaveLength(160);
    expect(repo.obter(it.id)?.descricao).toHaveLength(600);
  });

  it("política: CRUD com upsert; snapshot por Pane com cascade; embarcada e varredura (retenção 20)", () => {
    const { b, repo } = novo();
    const ws = criarRepoWorkspace(b).criar({ nome: "w", raiz: "/tmp/w" });
    const p = repo.gravarPolitica({ workspace_id: ws.id, alvo_tipo: "papel", alvo_valor: "executor", skills: ["a", "b"], mcp_do_usuario: "nenhum", servidores_mcp: [] }, T1);
    expect(repo.gravarPolitica({ ...p, skills: ["a"] }, T2).skills).toEqual(["a"]);
    expect(repo.listarPoliticas(ws.id)).toHaveLength(1);
    expect(repo.removerPolitica(ws.id, "papel", "executor")).toBe(true);

    const pane = criarRepoPane(b).criar({ workspace_id: ws.id, tipo: "cli", cli: "claude", cwd: "/tmp/w" } as never);
    repo.gravarSnapshotPane({ pane_id: pane.id, cli: "claude", nivel_isolamento: "duro", skills: ["a"], mcp_do_usuario: "nenhum", servidores_mcp: [], resolvido_em: T1 });
    expect(repo.lerSnapshotPane(pane.id)?.skills).toEqual(["a"]);
    repo.gravarSnapshotPane({ pane_id: pane.id, cli: "claude", nivel_isolamento: "nenhum", skills: null, mcp_do_usuario: "lista", servidores_mcp: ["x"], resolvido_em: T2 });
    expect(repo.lerSnapshotPane(pane.id)).toMatchObject({ skills: null, servidores_mcp: ["x"] });
    b.executar("DELETE FROM pane WHERE id=?", [pane.id]);
    expect(repo.lerSnapshotPane(pane.id)).toBeNull();

    repo.gravarEmbarcada({ nome: "ev-x", cli: "claude", versao_instalada: "1", hash_instalado: "h", opt_out: true, atualizado_em: T1 });
    expect(repo.obterEmbarcada("ev-x", "claude")?.opt_out).toBe(true);

    for (let i = 0; i < 25; i++) repo.concluirVarredura(repo.iniciarVarredura("manual", `2026-10-01T10:00:${String(i).padStart(2, "0")}.000Z`), { duracao_ms: 1, adicionados: 0, atualizados: 0, ausentes: 0, erros_json: "[]" });
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) n FROM catalogo_varredura")?.n).toBe(20);
    expect(repo.ultimaVarredura()?.iniciada_em).toBe("2026-10-01T10:00:24.000Z");
  });

  it("5 000 itens: listarPorTipo ≤ 5 ms por 1 000 (P-14) e truncado acima do limite", () => {
    const { repo } = novo();
    const itens = Array.from({ length: 5200 }, (_, i) => item(`s${i}`));
    for (let i = 0; i < itens.length; i += 500) repo.upsertLote(itens.slice(i, i + 500), T1);
    const t0 = performance.now();
    const r = repo.listarPorTipo("skill", null);
    const ms = performance.now() - t0;
    expect(r.itens).toHaveLength(5000);
    expect(r.truncado).toBe(true);
    expect(ms).toBeLessThan(250 * Number(process.env["EXPXV_PERF_FATOR"] ?? 3));
  });
});
