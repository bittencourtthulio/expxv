import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace } from "../../../tests/fixtures/memoria/banco";
import { criarServicoMemoria } from "./servico";
import { MemoriaErro } from "./tipos";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

function mundo() {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b, "ws_1", "Projeto Azul");
  semearMissao(b, "M1", ws);
  semearPane(b, { id: "P1", ws, mission: "M1", papel: "piloto", estado: "encerrado" });
  semearPane(b, { id: "P2", ws, mission: "M1", papel: "executor", respawn_de: null });
  const eventos: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
  const svc = criarServicoMemoria({ banco: b, emitir: (tipo, payload) => void eventos.push({ tipo, payload }) });
  return { b, svc, eventos };
}
const cod = (f: () => unknown): string => {
  try {
    f();
  } catch (x) {
    return (x as MemoriaErro).codigo;
  }
  return "nenhum";
};

describe("privacidade (T-08.19)", () => {
  it("esquecer apaga a entrada (e o FTS); esquecerPane apaga a LINHAGEM inteira; eventos sem conteúdo", () => {
    const { b, svc, eventos } = mundo();
    const e1 = svc.memory_write("P1", { content: "segredo de negócio zebra", kind: "fact" });
    svc.memory_write("P1", { content: "outra entrada", kind: "decision" });
    svc.memory_write("P2", { content: "do outro painel", kind: "fact" });
    b.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,estado,respawn_de,criado_em,atualizado_em) VALUES ('P1b','ws_1',99,'cli','encerrado','P1','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')");
    expect(svc.esquecer(e1.entry_id)).toEqual({ ok: true });
    expect(svc.esquecer(e1.entry_id)).toEqual({ ok: false });
    expect(b.consultar("SELECT 1 FROM memoria_fts WHERE memoria_fts MATCH 'zebra'")).toHaveLength(0);
    expect(svc.esquecerPane("P1b")).toEqual({ removidas: 1 }); // a raiz da linhagem é P1
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE linhagem_id='P1'")).toHaveLength(0);
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE linhagem_id='P2'")).toHaveLength(1);
    expect(JSON.stringify(eventos)).not.toContain("zebra");
    expect(eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(["memory.forgotten"]));
  });
  it("purgar exige o NOME do workspace digitado; por escopo ou 'tudo'; não toca no anel 3", () => {
    const { b, svc, eventos } = mundo();
    svc.memory_write("P1", { content: "a", kind: "fact" });
    svc.memory_write("P1", { content: "b", kind: "decision", scope: "mission" });
    svc.preferencias.gravar({ id: null, conteudo: "pref global" });
    expect(cod(() => svc.purgar({ workspace_id: "ws_1", escopo: "tudo", confirmacao: "projeto azul" }))).toBe("invalid_argument");
    expect(cod(() => svc.purgar({ workspace_id: "ws_x", escopo: "tudo", confirmacao: "x" }))).toBe("not_found");
    expect(svc.purgar({ workspace_id: "ws_1", escopo: "missao", confirmacao: "Projeto Azul" })).toEqual({ removidas: 1 });
    expect(svc.purgar({ workspace_id: "ws_1", escopo: "tudo", confirmacao: "Projeto Azul" })).toEqual({ removidas: 1 });
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE escopo='usuario'")).toHaveLength(1);
    expect(eventos.filter((e) => e.tipo === "memory.purged")).toHaveLength(2);
  });
  it("exportar: JSON {versao, exportado_em, entradas[]}, redige DE NOVO e nunca inclui o esquecido", () => {
    const { b, svc } = mundo();
    const a = svc.memory_write("P1", { content: "ficará", kind: "fact" });
    const f = svc.memory_write("P1", { content: "será esquecida", kind: "fact" });
    b.executar("UPDATE memoria_entrada SET conteudo = 'vazou sk-abcdefghijklmnopqrstuvwxyz0123456789' WHERE id = ?", [a.entry_id]);
    svc.esquecer(f.entry_id);
    const x = svc.exportar({ workspace_id: "ws_1", escopo: "tudo" });
    expect(x.versao).toBe(1);
    expect(x.entradas.map((e) => e.id)).toEqual([a.entry_id]);
    expect(JSON.stringify(x)).not.toContain("sk-abc");
    expect(x.entradas[0]?.redigido).toBe(true);
    expect(svc.exportar({ workspace_id: "ws_1", escopo: "missao" }).entradas).toHaveLength(0);
  });
  it("modo off preserva os dados (só para de coletar); apagar o Pane ou o workspace leva as entradas (cascade)", () => {
    const { b, svc } = mundo();
    svc.memory_write("P1", { content: "fica", kind: "fact" });
    svc.gravarConfig("ws_1", { ativa: false });
    expect(b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(1);
    b.executar("DELETE FROM pane WHERE id = 'P1'");
    expect(b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
  });
});

describe("preferências do anel 3 (T-08.18/25, P-23: até 50)", () => {
  it("passam por redação, ≤ 300 chars, dedupe, edição e remoção; limite de 50", () => {
    const { svc } = mundo();
    const p = svc.preferencias.gravar({ id: null, conteudo: "Prefiro respostas curtas. token=abcdef123456", importancia: 4 });
    expect(p.conteudo).toBe("Prefiro respostas curtas. token=[REDACTED]");
    expect(p).toMatchObject({ escopo: "usuario", anel: 3, fonte: "usuario", redigido: true });
    expect(svc.preferencias.gravar({ id: null, conteudo: "Prefiro respostas curtas. token=abcdef123456" }).id).toBe(p.id); // dedupe
    expect(svc.preferencias.gravar({ id: p.id, conteudo: "Texto novo" }).conteudo).toBe("Texto novo");
    expect(cod(() => svc.preferencias.gravar({ id: null, conteudo: "x".repeat(301) }))).toBe("too_large");
    expect(cod(() => svc.preferencias.gravar({ id: null, conteudo: "  " }))).toBe("invalid_argument");
    expect(cod(() => svc.preferencias.gravar({ id: "mem_nada", conteudo: "y" }))).toBe("not_found");
    for (let i = 0; i < 49; i++) svc.preferencias.gravar({ id: null, conteudo: `preferência ${i}` });
    expect(svc.preferencias.listar()).toHaveLength(50);
    expect(cod(() => svc.preferencias.gravar({ id: null, conteudo: "a 51ª" }))).toBe("limit_reached");
    expect(svc.preferencias.remover(p.id)).toEqual({ ok: true });
    expect(svc.preferencias.listar()).toHaveLength(49);
  });
  it("agente NÃO grava anel 3: memory_write não tem escopo de usuário e 'preference' fica no escopo pane/mission", () => {
    const { b, svc } = mundo();
    const r = svc.memory_write("P1", { content: "agente tenta preferência", kind: "preference", scope: "mission" });
    expect(b.consultarUm("SELECT escopo, anel FROM memoria_entrada WHERE id = ?", [r.entry_id])).toEqual({ escopo: "missao", anel: 1 });
    expect(b.consultar("SELECT 1 FROM memoria_entrada WHERE escopo = 'usuario'")).toHaveLength(0);
  });
});
