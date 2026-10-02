import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace } from "../../../tests/fixtures/memoria/banco";
import { resolverContextoDoPane } from "./contexto";
import { criarEscritor, criarLimitador, hashDoConteudo, type DepsEscrita } from "./escrita";
import { criarPortaEnfileirada, type EventoConhecimento } from "./eventos-conhecimento";
import { criarRepoMemoria } from "./repo";
import { MemoriaErro, type ContextoMemoria } from "./tipos";

const abertos: Banco[] = [];
function cenario(op: { modo?: "livre" | "squad" | "agentico"; papel?: string } = {}) {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  const mis = op.modo === "livre" ? null : semearMissao(b, "mis_1", ws, op.modo ?? "agentico", op.modo === "squad" ? "squad-a" : undefined);
  semearPane(b, { id: "pane_1", ws, mission: mis, papel: op.papel ?? "piloto" });
  return { b, ws, mis, ctx: (id = "pane_1"): ContextoMemoria => resolverContextoDoPane(b, id) };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const t0 = new Date("2026-10-01T12:00:00.000Z");
const relogio = (inicio = t0) => {
  let t = inicio.getTime();
  return { agora: () => new Date(t), avancarMin: (m: number) => void (t += m * 60_000) };
};

describe("gravarMemoria (T-08.07)", () => {
  it("grava, redige API_KEY e sk-…, marca redigido e nunca persiste o segredo", () => {
    const { b, ctx } = cenario();
    const e = criarEscritor({ banco: b });
    const r = e.gravar({ ctx: ctx(), tipo: "decisao", conteudo: "usei API_KEY=xyz e sk-abcdefghijklmnopqrstuvwxyz0123456789", origem: "agente" });
    expect(r).toMatchObject({ redacted: true, duplicada: false });
    const l = criarRepoMemoria(b).obter(r!.entry_id)!;
    expect(l.conteudo).toBe("usei API_KEY=[REDACTED] e [REDACTED]");
    expect(l.redigido).toBe(1);
    expect(l.escopo).toBe("pane");
    expect(l.linhagem_id).toBe("pane_1");
    expect(l.hash_conteudo).toBe(hashDoConteudo("usei API_KEY=[REDACTED] e [REDACTED]"));
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE conteudo LIKE '%xyz%' OR conteudo LIKE '%sk-abc%'")).toHaveLength(0);
  });

  it("dedupe em 24 h: mesmo texto não cria linha nova e incrementa a contagem; depois de 24 h cria", () => {
    const { b, ctx } = cenario();
    const rel = relogio();
    const e = criarEscritor({ banco: b, agora: rel.agora });
    const a = e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "Usamos SQLite", origem: "agente" })!;
    rel.avancarMin(60);
    const dup = e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "  usamos   sqlite ", origem: "agente" })!;
    expect(dup).toMatchObject({ entry_id: a.entry_id, duplicada: true });
    expect(criarRepoMemoria(b).obter(a.entry_id)?.contagem).toBe(2);
    rel.avancarMin(25 * 60);
    const novo = e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "Usamos SQLite", origem: "agente" })!;
    expect(novo.duplicada).toBe(false);
    expect(novo.entry_id).not.toBe(a.entry_id);
  });

  it("checkpoint novo marca o anterior como substituído (e encadeia substitui_id) na mesma transação", () => {
    const { b, ctx } = cenario();
    const e = criarEscritor({ banco: b });
    const c1 = e.gravar({ ctx: ctx(), tipo: "checkpoint", conteudo: "primeiro", origem: "agente" })!;
    const c2 = e.gravar({ ctx: ctx(), tipo: "checkpoint", conteudo: "segundo", origem: "agente" })!;
    const r = criarRepoMemoria(b);
    expect(r.obter(c1.entry_id)?.estado).toBe("substituida");
    expect(r.obter(c2.entry_id)).toMatchObject({ estado: "ativa", substitui_id: c1.entry_id });
  });

  it("falha injetada depois do insert desfaz TUDO, inclusive o 'substituida' (atomicidade)", () => {
    const { b, ctx } = cenario();
    const e = criarEscritor({ banco: b });
    const c1 = e.gravar({ ctx: ctx(), tipo: "checkpoint", conteudo: "primeiro", origem: "agente" })!;
    expect(() =>
      e.gravar({ ctx: ctx(), tipo: "checkpoint", conteudo: "segundo", origem: "agente", aposInserir: () => { throw new Error("falha injetada"); } }),
    ).toThrow("falha injetada");
    const r = criarRepoMemoria(b);
    expect(r.obter(c1.entry_id)?.estado).toBe("ativa");
    expect(b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(1);
  });

  it("validação: tipo, vazio, controle, importância, tamanho e ordem do too_large (antes de redigir)", () => {
    const { b, ctx } = cenario();
    const e = criarEscritor({ banco: b });
    const erro = (p: Partial<Parameters<typeof e.gravar>[0]>): string => {
      try {
        e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "ok", origem: "agente", ...p });
      } catch (x) {
        return (x as MemoriaErro).codigo;
      }
      return "nenhum";
    };
    expect(erro({ tipo: "x" as never })).toBe("invalid_argument");
    expect(erro({ conteudo: "   " })).toBe("invalid_argument");
    expect(erro({ conteudo: "a\u001b[31mb" })).toBe("invalid_argument");
    expect(erro({ importancia: 6 })).toBe("invalid_argument");
    expect(erro({ importancia: 0 })).toBe("invalid_argument");
    expect(erro({ conteudo: "x".repeat(1001) })).toBe("too_large");
    expect(erro({ conteudo: "x".repeat(5_000_000) })).toBe("too_large");
    expect(erro({ escopo: "missao", ctx: { ...ctx(), mission_id: null } })).toBe("invalid_argument");
    expect(erro({ conteudo: "😀".repeat(1000) })).toBe("nenhum"); // 1000 code points = limite exato
  });

  it("modo off e papel sem permissão: memory_disabled / unauthorized; worker não grava checkpoint", () => {
    const off = cenario();
    expect(() => criarEscritor({ banco: off.b }).gravar({ ctx: { ...off.ctx(), modo: "off" }, tipo: "fato", conteudo: "x", origem: "agente" })).toThrow(/desligada/);
    const w = cenario({ papel: "executor" });
    const e = criarEscritor({ banco: w.b });
    expect(() => e.gravar({ ctx: w.ctx(), tipo: "checkpoint", conteudo: "x", origem: "agente" })).toThrow(/papel/);
    expect(() => e.gravar({ ctx: w.ctx(), tipo: "decisao", conteudo: "x", origem: "agente" })).not.toThrow();
  });

  it("limite de taxa por Pane (30/min) responde rate_limited e libera depois de 1 minuto", () => {
    const { b, ctx } = cenario();
    let t = 1_000_000;
    const e = criarEscritor({ banco: b, limitador: criarLimitador({ agora: () => t }) });
    for (let i = 0; i < 30; i++) e.gravar({ ctx: ctx(), tipo: "fato", conteudo: `fato ${i}`, origem: "agente" });
    expect(() => e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "31", origem: "agente" })).toThrow(/limite de gravações/);
    t += 61_000;
    expect(() => e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "32", origem: "agente" })).not.toThrow();
  });

  it("filtro do coletor: importância < 2 é descartada; memory_write explícito aceita 1", () => {
    const { b, ctx } = cenario();
    const e = criarEscritor({ banco: b });
    expect(e.gravar({ ctx: ctx(), tipo: "evento", conteudo: "ruído", importancia: 1, origem: "coletor", fonte: "sistema" })).toBeNull();
    expect(e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "ruído mínimo", importancia: 1, origem: "agente" })?.duplicada).toBe(false);
    expect(() => e.gravar({ ctx: ctx(), tipo: "evento", conteudo: "agente não grava evento", origem: "agente" })).toThrow(/papel/);
  });

  it("teto por linhagem: expira o evento mais fraco; sem evento, limit_reached", () => {
    const { b, ctx } = cenario();
    const e = criarEscritor({ banco: b });
    const lin = ctx().linhagem_id as string;
    // enche com 500 entradas ativas direto no banco (rápido): 1 evento fraco + 499 fatos
    const r = criarRepoMemoria(b);
    const base = { workspace_id: "ws_1", mission_id: "mis_1", pane_id: "pane_1", linhagem_id: lin, squad_slug: null, escopo: "pane" as const, anel: 1 as const, fonte: "agente" as const, autor_pane_id: null, substitui_id: null, estado: "ativa" as const, expira_em: null, redigido: 0, contagem: 1, criado_em: "2026-10-01T00:00:00.000Z", atualizado_em: "2026-10-01T00:00:00.000Z" };
    b.transacao(() => {
      for (let i = 0; i < 500; i++) r.inserir({ ...base, id: `mem_t${String(i).padStart(4, "0")}`, tipo: i === 0 ? "evento" : "fato", conteudo: `c${i}`, importancia: i === 0 ? 1 : 3, hash_conteudo: hashDoConteudo(`c${i}`) });
    });
    expect(e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "novo", origem: "agente" })?.duplicada).toBe(false);
    expect(r.obter("mem_t0000")?.estado).toBe("expirada");
    expect(() => e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "outro", origem: "agente" })).toThrow(/limite de entradas/);
  });

  it("emite ao conhecimento DEPOIS de gravar: decision/checkpoint/learning; sem segredo; porta que lança não afeta", async () => {
    const { b, ctx } = cenario();
    const vistos: EventoConhecimento[] = [];
    const porta = criarPortaEnfileirada((ev) => void vistos.push(ev));
    const e = criarEscritor({ banco: b, porta, raizDoWorkspace: () => "/work/ws_1" });
    e.gravar({ ctx: ctx(), tipo: "decisao", conteudo: "Decidi X com API_KEY=zzz em /work/ws_1/src/a.ts", origem: "agente" });
    e.gravar({ ctx: ctx(), tipo: "checkpoint", conteudo: "cp", origem: "agente" });
    e.gravar({ ctx: ctx(), tipo: "fato", conteudo: "sem evento", origem: "agente" });
    await porta.drenar();
    expect(vistos.map((v) => v.tipo)).toEqual(["memory.decision", "memory.checkpoint"]);
    expect(JSON.stringify(vistos)).not.toContain("zzz");
    expect(JSON.stringify(vistos)).not.toContain("/work/ws_1");
    const quebra: DepsEscrita = { banco: b, porta: { registrar: () => { throw new Error("porta com defeito"); } } };
    expect(() => criarEscritor(quebra).gravar({ ctx: ctx(), tipo: "decisao", conteudo: "outra", origem: "agente" })).not.toThrow();
  });
});
