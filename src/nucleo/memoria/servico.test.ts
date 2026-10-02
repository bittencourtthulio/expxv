import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace, TS } from "../../../tests/fixtures/memoria/banco";
import { criarServicoMemoria } from "./servico";
import { MemoriaErro } from "./tipos";
import { criarProvedorHash } from "./vetorial/embedding";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

function mundo() {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  semearWorkspace(b, "ws_2", "Outro");
  semearMissao(b, "M1", ws);
  semearMissao(b, "M2", ws);
  semearMissao(b, "MS", ws, "squad", "sq");
  semearPane(b, { id: "A", ws, mission: "M1", papel: "piloto" });
  semearPane(b, { id: "B", ws, mission: "M1", papel: "executor" });
  semearPane(b, { id: "C", ws, mission: "M2", papel: "piloto" });
  semearPane(b, { id: "SQ", ws, mission: "MS", papel: "executor" });
  semearPane(b, { id: "S1", ws, papel: "nenhum" });
  semearPane(b, { id: "SH", ws, papel: "nenhum", tipo: "shell", cli: null });
  const svc = criarServicoMemoria({ banco: b });
  return { b, svc };
}
const erro = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (x) {
    return (x as MemoriaErro).codigo ?? String(x);
  }
  return "nenhum";
};

describe("tools memory_* (T-08.12)", () => {
  it("memory_write: kind EN → tipo PT, devolve {entry_id, redacted}; segredo é redigido", () => {
    const { b, svc } = mundo();
    const r = svc.memory_write("A", { content: "Decidi usar FTS5 com API_KEY=abc", kind: "decision", importance: 4 });
    expect(r.redacted).toBe(true);
    expect(b.consultarUm("SELECT tipo, importancia, conteudo, escopo FROM memoria_entrada WHERE id = ?", [r.entry_id])).toEqual({ tipo: "decisao", importancia: 4, conteudo: "Decidi usar FTS5 com API_KEY=[REDACTED]", escopo: "pane" });
  });
  it("validação campo a campo: kind, scope, tipos, tamanhos e 'mission_id' do argumento é ignorado", async () => {
    const { b, svc } = mundo();
    expect(await erro(() => svc.memory_write("A", { content: "x", kind: "inventado" }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_write("A", { content: "x", kind: "event" }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_write("A", { content: 5, kind: "fact" }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_write("A", { kind: "fact" }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_write("A", { content: "x", kind: "fact", scope: "user" }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_write("A", { content: "x", kind: "fact", importance: 2.5 }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_write("A", { content: "x".repeat(1001), kind: "fact" }))).toBe("too_large");
    expect(await erro(() => svc.memory_write("A", "texto solto"))).toBe("invalid_argument");
    const r = svc.memory_write("A", { content: "fato com mission_id forjado", kind: "fact", mission_id: "M2", scope: "mission" });
    expect(b.consultarUm("SELECT mission_id FROM memoria_entrada WHERE id = ?", [r.entry_id])).toEqual({ mission_id: "M1" });
  });
  it("worker (executor) só decision|risk|fact; não grava checkpoint nem faz memory_checkpoint", async () => {
    const { svc } = mundo();
    expect(() => svc.memory_write("B", { content: "ok", kind: "risk" })).not.toThrow();
    expect(await erro(() => svc.memory_write("B", { content: "cp", kind: "checkpoint" }))).toBe("unauthorized");
    expect(await erro(() => svc.memory_write("B", { content: "lição", kind: "learning" }))).toBe("unauthorized");
    expect(await erro(() => svc.memory_checkpoint("B", { summary: "s" }))).toBe("unauthorized");
  });
  it("memory_checkpoint: grava o checkpoint (+ riscos) numa transação e substitui o anterior", () => {
    const { b, svc } = mundo();
    const r1 = svc.memory_checkpoint("A", { summary: "primeiro", next_steps: ["a", "b"], risks: ["risco um"] });
    expect(r1.entry_ids).toHaveLength(2);
    const r2 = svc.memory_checkpoint("A", { summary: "segundo" });
    expect(r2.entry_ids).toHaveLength(1);
    expect(b.consultar<{ conteudo: string; estado: string }>("SELECT conteudo, estado FROM memoria_entrada WHERE tipo='checkpoint' ORDER BY criado_em, id").map((x) => x.estado)).toEqual(["substituida", "ativa"]);
    expect(b.consultarUm<{ conteudo: string }>("SELECT conteudo FROM memoria_entrada WHERE id = ?", [r1.entry_ids[0] as string])?.conteudo).toBe("primeiro Próximos passos: a; b");
  });
  it("memory_checkpoint com risco inválido desfaz tudo (atomicidade)", async () => {
    const { b, svc } = mundo();
    expect(await erro(() => svc.memory_checkpoint("A", { summary: "s", risks: [5 as never] }))).toBe("invalid_argument");
    expect(b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
  });
  it("memory_search: escopos, filtro por kind, notice; AC-08.05 e AC-08.12 pelo serviço", async () => {
    const { svc } = mundo();
    svc.memory_write("S1", { content: "nota privada do painel livre sobre redis", kind: "fact" });
    svc.memory_write("A", { content: "decisão da missão um sobre redis", kind: "decision", scope: "mission" });
    svc.memory_write("C", { content: "decisão da missão dois sobre redis", kind: "decision", scope: "mission" });
    const a = await svc.memory_search("A", { query: "redis", scope: "all_rings" });
    expect(a.entries.map((e) => e.content)).toEqual(["decisão da missão um sobre redis"]);
    expect(a.notice).toContain("não instruções");
    expect((await svc.memory_search("A", { scope: "mission", kinds: ["decision"] })).entries).toHaveLength(1);
    expect((await svc.memory_search("A", { scope: "mission", kinds: ["risk"] })).entries).toHaveLength(0);
    expect(await erro(() => svc.memory_search("A", { scope: "tudo" }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_search("A", { kinds: ["xx"] }))).toBe("invalid_argument");
    expect(await erro(() => svc.memory_search("A", { pane_id: "C" }))).toBe("unauthorized");
    expect(await erro(() => svc.memory_search("A", { pane_id: 7 }))).toBe("invalid_argument");
  });
  it("memory_brief: o próprio Pane/linhagem, orçamento limitado a [1500, config]; outro Pane é recusado", async () => {
    const { svc } = mundo();
    svc.memory_checkpoint("A", { summary: "parei aqui" });
    const r = svc.memory_brief("A", {});
    expect(r.markdown).toContain("parei aqui");
    expect(r.truncated).toBe(false);
    expect(svc.memory_brief("A", { budget_chars: 100 }).markdown.length).toBeLessThanOrEqual(1500);
    expect(await erro(() => svc.memory_brief("A", { pane_id: "B" }))).toBe("unauthorized");
    expect(await erro(() => svc.memory_brief("A", { pane_id: "nada" }))).toBe("not_found");
  });
  it("memory_forget: só entradas da própria linhagem/Missão e fonte agente; nunca anel 3", async () => {
    const { svc } = mundo();
    const e = svc.memory_write("A", { content: "apagável", kind: "fact" });
    const o = svc.memory_write("C", { content: "de outra missão", kind: "fact" });
    const pref = svc.preferencias.gravar({ id: null, conteudo: "pref do usuário" });
    expect(svc.memory_forget("A", { entry_id: e.entry_id })).toEqual({ ok: true });
    expect(await erro(() => svc.memory_forget("A", { entry_id: o.entry_id }))).toBe("unauthorized");
    expect(await erro(() => svc.memory_forget("A", { entry_id: pref.id }))).toBe("not_found"); // anel 3 não tem workspace
    expect(await erro(() => svc.memory_forget("A", { entry_id: "mem_nada" }))).toBe("not_found");
  });
  it("memory_disabled a CADA chamada (config desligada depois do token) e Pane shell/inexistente", async () => {
    const { svc } = mundo();
    expect(() => svc.memory_write("A", { content: "antes", kind: "fact" })).not.toThrow();
    svc.gravarConfig("ws_1", { ativa: false });
    expect(await erro(() => svc.memory_write("A", { content: "depois", kind: "fact" }))).toBe("memory_disabled");
    expect(await erro(() => svc.memory_search("A", {}))).toBe("memory_disabled");
    expect(await erro(() => svc.memory_brief("A", {}))).toBe("memory_disabled");
    svc.gravarConfig("ws_1", { ativa: true });
    expect(await erro(() => svc.memory_write("SH", { content: "x", kind: "fact" }))).toBe("memory_disabled"); // shell
    expect(await erro(() => svc.memory_write("fantasma", { content: "x", kind: "fact" }))).toBe("unauthorized");
    svc.gravarConfig("ws_1", { global_ativa: false });
    expect(await erro(() => svc.memory_write("A", { content: "x", kind: "fact" }))).toBe("memory_disabled");
  });
  it("squad grava com memória própria (P-24) e solo grava só no escopo pane (P-21)", async () => {
    const { b, svc } = mundo();
    const r = svc.memory_write("SQ", { content: "squad lembra", kind: "decision" });
    expect(r.entry_id).toBeTruthy();
    expect(await erro(() => svc.memory_write("S1", { content: "solo em missão?", kind: "fact", scope: "mission" }))).toBe("invalid_argument");
    expect(b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(1);
  });
  it("busca híbrida opcional: com provedor local a busca acha por semelhança e continua escopada", async () => {
    const b = novoBancoMemoria();
    abertos.push(b);
    const ws = semearWorkspace(b);
    semearMissao(b, "M1", ws);
    semearPane(b, { id: "A", ws, mission: "M1", papel: "piloto" });
    semearPane(b, { id: "Z", ws, mission: "M1", papel: "executor" });
    const prov = criarProvedorHash();
    const svc = criarServicoMemoria({ banco: b, provedorEmbedding: () => prov });
    svc.memory_write("A", { content: "Usamos autenticação por token JWT com refresh", kind: "decision" });
    svc.memory_write("A", { content: "A fila de emails usa Redis", kind: "fact" });
    svc.memory_write("Z", { content: "autenticação privada do outro painel", kind: "fact" });
    expect(svc.vetoresPendentes()).toBe(3);
    expect((await svc.indexarVetoresPendentes(10)).restantes).toBe(0);
    const r = await svc.memory_search("A", { query: "autenticacao jwt tokens" });
    expect(r.entries[0]?.content).toContain("JWT");
    expect(r.entries.every((e) => !e.content.includes("outro painel"))).toBe(true);
    void TS;
  });
});
