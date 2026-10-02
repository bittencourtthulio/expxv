import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace } from "../../../tests/fixtures/memoria/banco";
import { criarCiclo } from "./ciclo";
import { resolverContextoDoPane } from "./contexto";
import { criarEscritor, hashDoConteudo } from "./escrita";
import { criarPortaEnfileirada, type EventoConhecimento } from "./eventos-conhecimento";
import { criarRepoMemoria } from "./repo";
import type { LinhaEntrada } from "./tipos";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const AGORA = new Date("2026-10-20T12:00:00.000Z");

function mundo(modo: "agentico" | "squad" = "agentico") {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  semearMissao(b, "M1", ws, modo, modo === "squad" ? "sq" : undefined);
  semearPane(b, { id: "P1", ws, mission: "M1", papel: "piloto" });
  const repo = criarRepoMemoria(b);
  const linha = (o: Partial<LinhaEntrada> & { id: string; conteudo: string }): LinhaEntrada => ({
    workspace_id: "ws_1", mission_id: "M1", pane_id: "P1", linhagem_id: "P1", squad_slug: null, escopo: "pane", anel: 1, tipo: "evento", fonte: "sistema", autor_pane_id: null, importancia: 2,
    substitui_id: null, estado: "ativa", expira_em: null, redigido: 0, hash_conteudo: hashDoConteudo(o.conteudo + o.id), contagem: 1, criado_em: "2026-10-01T10:00:00.000Z", atualizado_em: "2026-10-01T10:00:00.000Z", ...o,
  });
  const ciclo = (porta?: ReturnType<typeof criarPortaEnfileirada>) => criarCiclo({ banco: b, agora: () => AGORA, ...(porta ? { porta } : {}) });
  return { b, ws, repo, linha, ciclo };
}

describe("compactação (AC-08.11, P-38)", () => {
  it("250 eventos antigos viram resumo(s); decisões importantes e eventos recentes permanecem", () => {
    const m = mundo();
    const dias = (i: number): string => `2026-10-${String(1 + (i % 5)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00.000Z`;
    m.b.transacao(() => {
      for (let i = 0; i < 250; i++) m.repo.inserir(m.linha({ id: `mem_e${String(i).padStart(4, "0")}`, conteudo: `evento antigo ${i}`, atualizado_em: dias(i) }));
      m.repo.inserir(m.linha({ id: "mem_dec", tipo: "decisao", importancia: 5, conteudo: "decisão importante", atualizado_em: "2026-10-01T09:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_rec", conteudo: "evento recente", atualizado_em: "2026-10-19T09:00:00.000Z" }));
    });
    const c = m.ciclo();
    let guarda = 0;
    while (c.compactar() > 0 && guarda++ < 50);
    const ativas = Number(m.b.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE estado='ativa'")?.n);
    const resumos = m.b.consultar<{ conteudo: string; contagem: number }>("SELECT conteudo, contagem FROM memoria_entrada WHERE tipo='resumo'");
    const resumidas = Number(m.b.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE estado='resumida'")?.n);
    expect(resumos.length).toBeGreaterThanOrEqual(2); // um grupo por dia, até a linhagem voltar a ≤ 200 ativas
    expect(resumos.reduce((s, r) => s + r.contagem, 0)).toBe(resumidas);
    expect(ativas).toBeLessThanOrEqual(200);
    expect(resumos[0]?.conteudo.length).toBeLessThanOrEqual(1000);
    expect(m.repo.obter("mem_dec")?.estado).toBe("ativa");
    expect(m.repo.obter("mem_rec")?.estado).toBe("ativa");
    expect(250 - resumidas + resumos.length + 2).toBe(ativas);
  });
  it("não compacta linhagem com ≤ 200 ativas e é determinística (mesma entrada, mesmo resumo)", () => {
    const a = mundo();
    const b2 = mundo();
    for (const m of [a, b2]) m.b.transacao(() => { for (let i = 0; i < 150; i++) m.repo.inserir(m.linha({ id: `mem_e${i}`, conteudo: `ev ${i}`, atualizado_em: "2026-10-02T10:00:00.000Z" })); });
    expect(a.ciclo().compactar()).toBe(0);
    for (const m of [a, b2]) m.b.transacao(() => { for (let i = 150; i < 260; i++) m.repo.inserir(m.linha({ id: `mem_e${i}`, conteudo: `ev ${i}`, atualizado_em: "2026-10-02T10:00:00.000Z" })); });
    a.ciclo().compactar();
    b2.ciclo().compactar();
    const t = (m: ReturnType<typeof mundo>) => m.b.consultarUm<{ conteudo: string }>("SELECT conteudo FROM memoria_entrada WHERE tipo='resumo'")?.conteudo;
    expect(t(a)).toBe(t(b2));
    expect(t(a)).toContain("Resumo de 2026-10-02: 200 eventos."); // lote de 200 por fatia
  });
});

describe("expiração, retenção e purga", () => {
  it("expira vencidas (expira_em), aplica retenção por workspace (365 d padrão; 0 = sem limite) e purga em lotes", () => {
    const m = mundo();
    m.b.transacao(() => {
      m.repo.inserir(m.linha({ id: "mem_v", conteudo: "vencida", expira_em: "2026-10-10T00:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_n", conteudo: "no prazo", expira_em: "2026-12-10T00:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_velha", conteudo: "de um ano atrás", atualizado_em: "2025-09-01T00:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_ok", conteudo: "de 6 meses", atualizado_em: "2026-04-20T00:00:00.000Z" }));
    });
    const c = m.ciclo();
    expect(c.expirar()).toBe(1);
    expect(m.repo.obter("mem_v")?.estado).toBe("expirada");
    expect(c.retencao()).toBe(1);
    expect(m.repo.obter("mem_velha")?.estado).toBe("expirada");
    expect(m.repo.obter("mem_ok")?.estado).toBe("ativa");
    // sem limite
    m.repo.gravarConfig("ws_1", { retencao_dias: 0 }, AGORA.toISOString());
    m.b.executar("UPDATE memoria_entrada SET estado='ativa' WHERE id='mem_velha'");
    const c2 = m.ciclo();
    expect(c2.retencao()).toBe(0);
    expect(m.repo.obter("mem_velha")?.estado).toBe("ativa");
  });
  it("purga resumida/expirada com mais de 7 dias e substituída com mais de 30, em lote de 200; mantém as recentes", () => {
    const m = mundo();
    m.b.transacao(() => {
      for (let i = 0; i < 450; i++) m.repo.inserir(m.linha({ id: `mem_x${String(i).padStart(3, "0")}`, conteudo: `x${i}`, estado: "expirada", atualizado_em: "2026-10-01T00:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_novo", conteudo: "expirou ontem", estado: "expirada", atualizado_em: "2026-10-19T00:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_sub", conteudo: "substituida velha", estado: "substituida", atualizado_em: "2026-08-01T00:00:00.000Z" }));
    });
    const c = m.ciclo();
    expect([c.purgar(), c.purgar(), c.purgar(), c.purgar()]).toEqual([200, 200, 50, 1]);
    expect(m.repo.obter("mem_novo")).toBeDefined();
    expect(m.repo.obter("mem_sub")).toBeUndefined();
  });
  it("fatia(): rodízio de etapas; cada fatia ≤ 20 ms; executarEmOcioso pausa quando não está ocioso e para sem trabalho", async () => {
    const m = mundo();
    m.b.transacao(() => { for (let i = 0; i < 1000; i++) m.repo.inserir(m.linha({ id: `mem_p${String(i).padStart(4, "0")}`, conteudo: `p${i}`, estado: "resumida", atualizado_em: "2026-09-01T00:00:00.000Z" })); });
    const c = m.ciclo();
    const ms: number[] = [];
    expect(await c.executarEmOcioso({ ocioso: () => true, aoFatiar: (r) => ms.push(r.ms) })).toBe("sem_trabalho");
    expect(Math.max(...ms)).toBeLessThan(20 * 5); // folga para máquina carregada; o orçamento medido fica no perf
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
    let ocioso = true;
    m.repo.inserir(m.linha({ id: "mem_q", conteudo: "q", estado: "resumida", atualizado_em: "2026-09-01T00:00:00.000Z" }));
    expect(await m.ciclo().executarEmOcioso({ ocioso: () => (ocioso = false) })).toBe("pausado");
    expect(ocioso).toBe(false);
    expect(m.repo.obter("mem_q")).toBeDefined(); // pausou antes de trabalhar
  });
});

describe("anéis, destilação e fechamento de Missão (T-08.18, AC-08.09)", () => {
  function comMissao(m: ReturnType<typeof mundo>) {
    const e = criarEscritor({ banco: m.b, agora: () => new Date("2026-10-20T11:00:00.000Z") });
    const ctx = resolverContextoDoPane(m.b, "P1");
    e.gravar({ ctx, tipo: "aprendizado", conteudo: "Aprendi que o FTS5 precisa de fallback", importancia: 4, origem: "agente", escopo: "missao" });
    e.gravar({ ctx, tipo: "decisao", conteudo: "Decisão crítica A", importancia: 5, origem: "agente", escopo: "missao" });
    e.gravar({ ctx, tipo: "decisao", conteudo: "Decisão menor B", importancia: 2, origem: "agente", escopo: "missao" });
    e.gravar({ ctx, tipo: "fato", conteudo: "fato qualquer", origem: "agente" });
    return { ctx, e };
  }
  it("destila aprendizado e decisão ≥ 4 para o anel 2 (workspace), expira o anel 1 em 24 h e é idempotente", () => {
    const m = mundo();
    comMissao(m);
    const c = m.ciclo();
    const r = c.aoFecharMissao("M1");
    expect(r).toMatchObject({ destiladas: 2, ja_fechada: false });
    const anel2 = m.b.consultar<{ conteudo: string; escopo: string; anel: number; mission_id: string | null }>("SELECT conteudo, escopo, anel, mission_id FROM memoria_entrada WHERE anel = 2");
    expect(anel2.map((a) => a.conteudo).sort()).toEqual(["Aprendi que o FTS5 precisa de fallback", "Decisão crítica A"]);
    expect(anel2.every((a) => a.escopo === "workspace" && a.mission_id === null)).toBe(true);
    const exp = m.b.consultar<{ expira_em: string }>("SELECT DISTINCT expira_em FROM memoria_entrada WHERE anel = 1");
    expect(exp).toEqual([{ expira_em: "2026-10-21T12:00:00.000Z" }]);
    expect(c.aoFecharMissao("M1")).toMatchObject({ ja_fechada: true, destiladas: 0 });
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada WHERE anel = 2")).toHaveLength(2);
  });
  it("sem aprendizado do piloto: grava aprendizado de SISTEMA com os resumos de handoff ok (≤ 1 000), sem LLM", () => {
    const m = mundo();
    const ctx = resolverContextoDoPane(m.b, "P1");
    const e = criarEscritor({ banco: m.b, agora: () => new Date("2026-10-20T11:00:00.000Z") });
    e.gravar({ ctx, tipo: "handoff", conteudo: "T-1 · ok · implementei a escrita", importancia: 3, origem: "coletor", escopo: "missao", fonte: "sistema" });
    e.gravar({ ctx, tipo: "handoff", conteudo: "T-2 · falhou · quebrou", importancia: 4, origem: "coletor", escopo: "missao", fonte: "sistema" });
    const r = m.ciclo().aoFecharMissao("M1");
    expect(r.aprendizado_sistema).toBe(true);
    const l = m.b.consultarUm<{ conteudo: string; fonte: string; importancia: number }>("SELECT conteudo, fonte, importancia FROM memoria_entrada WHERE tipo='aprendizado'");
    expect(l?.fonte).toBe("sistema");
    expect(l?.conteudo).toContain("implementei a escrita");
    expect(l?.conteudo).not.toContain("quebrou");
  });
  it("anel 2 aparece só no mesmo workspace; teto ANEL2_MAX = 50 (sai a de menor importância/mais antiga); squad tem anel próprio", () => {
    const m = mundo();
    semearWorkspace(m.b, "ws_2", "Outro");
    const c = m.ciclo();
    const ins = (id: string, ws: string, imp: number, escopo: "workspace" | "squad" = "workspace", slug: string | null = null) =>
      m.repo.inserir(m.linha({ id, workspace_id: ws, mission_id: null, pane_id: null, linhagem_id: null, escopo, squad_slug: slug, anel: 2, tipo: "aprendizado", importancia: imp as 1, conteudo: `apr ${id}` }));
    m.b.transacao(() => { for (let i = 0; i < 50; i++) ins(`mem_a${String(i).padStart(2, "0")}`, "ws_1", 3); ins("mem_outro", "ws_2", 1); });
    comMissao(m);
    c.aoFecharMissao("M1");
    expect(Number(m.b.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE workspace_id='ws_1' AND escopo='workspace' AND estado='ativa'")?.n)).toBe(50);
    expect(m.repo.obter("mem_outro")?.estado).toBe("ativa");
    // as duas novas (importância 4 e 5) entraram; saíram as mais fracas/antigas entre as de importância 3
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada WHERE conteudo='Decisão crítica A' AND estado='ativa' AND anel = 2")).toHaveLength(1);
  });
  it("Missão squad destila para o anel da squad (escopo squad), isolado do projeto", () => {
    const m = mundo("squad");
    comMissao(m);
    m.ciclo().aoFecharMissao("M1");
    const r = m.b.consultar<{ escopo: string; squad_slug: string | null }>("SELECT DISTINCT escopo, squad_slug FROM memoria_entrada WHERE anel = 2");
    expect(r).toEqual([{ escopo: "squad", squad_slug: "sq" }]);
  });
  it("emite UM evento mission.closed com aprendizado e decisões, id determinístico (reentrega não duplica)", async () => {
    const m = mundo();
    comMissao(m);
    const vistos: EventoConhecimento[] = [];
    const porta = criarPortaEnfileirada((e) => void vistos.push(e));
    const c = m.ciclo(porta);
    c.aoFecharMissao("M1");
    c.aoFecharMissao("M1");
    await porta.drenar();
    const fechados = vistos.filter((v) => v.tipo === "mission.closed");
    expect(fechados).toHaveLength(2);
    expect(new Set(fechados.map((f) => f.id)).size).toBe(1);
    expect(fechados[0]?.texto).toContain("FTS5");
    expect(fechados[0]?.texto).toContain("Decisão crítica A");
  });
});
