// Casos de aceitação AC-08.01..12 (T-08.29) sobre o núcleo real (banco real em memória, sem Electron, sem rede).
// AC-08.01, 02 e 08 são GATE DE RELEASE (o brief foi o ponto que quebrou no produto original).
import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace, TS } from "../../../tests/fixtures/memoria/banco";
import { buildBrief } from "./brief";
import { criarCiclo } from "./ciclo";
import { criarAoEncerrar } from "./fechamento";
import { criarRestaurador, type PortasRestaurar } from "./restaurar";
import { envelope, TAG_ENVELOPE } from "./sanear-brief";
import { criarServicoMemoria } from "./servico";
import { criarRepoMemoria } from "./repo";
import { MemoriaErro } from "./tipos";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const conta = (s: string, sub: string): number => s.split(sub).length - 1;
const cod = async (f: () => unknown): Promise<string> => {
  try {
    await f();
  } catch (x) {
    return (x as MemoriaErro).codigo;
  }
  return "nenhum";
};

function mundo() {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  semearWorkspace(b, "ws_2", "Outro");
  semearMissao(b, "M1", ws);
  semearMissao(b, "M2", ws);
  semearMissao(b, "MS", ws, "squad", "sq");
  semearPane(b, { id: "A", ws, mission: "M1", papel: "piloto", display: 7 });
  semearPane(b, { id: "W", ws, mission: "M1", papel: "executor" });
  semearPane(b, { id: "C", ws, mission: "M2", papel: "piloto" });
  semearPane(b, { id: "SQ", ws, mission: "MS", papel: "piloto" });
  semearPane(b, { id: "S1", ws, papel: "nenhum" });
  semearPane(b, { id: "S2", ws, papel: "nenhum" });
  const svc = criarServicoMemoria({ banco: b });
  let n = 500;
  const prompts: Array<{ brief: string | null; prompt: string | null }> = [];
  const portas = (extra: Partial<PortasRestaurar> = {}): PortasRestaurar => ({
    banco: b,
    podeRetomar: () => false,
    async respawn(id, o) {
      prompts.push({ brief: o.contexto.brief, prompt: o.prompt_inicial });
      const novo = `F${++n}`;
      const p = b.consultarUm<{ mission_id: string | null; workspace_id: string; papel: string }>("SELECT mission_id, workspace_id, papel FROM pane WHERE id = ?", [id]);
      semearPane(b, { id: novo, ws: p!.workspace_id, mission: p!.mission_id, papel: p!.papel, respawn_de: id });
      return { pane_id: novo, sessao_id: `s_${novo}` };
    },
    ...extra,
  });
  return { b, ws, svc, prompts, portas, fechar: (id: string) => b.executar("UPDATE pane SET estado='encerrado', encerrado_motivo='usuario' WHERE id=?", [id]) };
}

describe("AC-08 (T-08.29)", () => {
  it("AC-08.01 [GATE] Pane com checkpoint e 2 decisões, fechado e restaurado: brief com checkpoint, decisões e eventos, sem brief antigo duplicado", async () => {
    const m = mundo();
    m.svc.memory_checkpoint("A", { summary: "Parei na T-08.29" });
    m.svc.memory_write("A", { content: "Decisão um", kind: "decision" });
    m.svc.memory_write("A", { content: "Decisão dois", kind: "decision" });
    m.b.executar("INSERT INTO memoria_entrada (id,workspace_id,mission_id,pane_id,linhagem_id,escopo,anel,tipo,conteudo,fonte,importancia,hash_conteudo,criado_em,atualizado_em) VALUES ('mem_ev','ws_1','M1','A','A','pane',1,'evento','Painel #7 encerrado (usuario)','sistema',2,?,?,?)", ["e".repeat(64), TS, TS]);
    m.fechar("A");
    const velho = envelope({ display_id: 7, geradaEm: "2026-09-01T00:00:00Z", corpo: "- brief ANTIGO", ponteiroMemox: false });
    const r = await criarRestaurador(m.portas({ promptAnterior: () => `Tarefa original\n${velho}` })).restaurarPane("A");
    expect(r.brief_injetado).toBe(true);
    const p = m.prompts[0]!.prompt as string;
    for (const t of ["Parei na T-08.29", "Decisão um", "Decisão dois", "Painel #7 encerrado"]) expect(p).toContain(t);
    expect(p).not.toContain("ANTIGO");
    expect(conta(p, `<${TAG_ENVELOPE}`)).toBe(1);
  });
  it("AC-08.02 [GATE] prompt reaproveitado com brief velho: o novo SUBSTITUI (bug central)", async () => {
    const m = mundo();
    m.svc.memory_checkpoint("A", { summary: "estado novo" });
    m.fechar("A");
    const velho = envelope({ display_id: 7, geradaEm: "2026-09-01T00:00:00Z", corpo: "- checkpoint VELHO", ponteiroMemox: true });
    await criarRestaurador(m.portas({ promptAnterior: () => `${velho}\n\n${velho}` })).restaurarPane("A");
    const p = m.prompts[0]!.prompt as string;
    expect(p).toContain("estado novo");
    expect(p).not.toContain("VELHO");
    expect(conta(p, `<${TAG_ENVELOPE}`)).toBe(1);
    expect(conta(p, `</${TAG_ENVELOPE}>`)).toBe(1);
  });
  it("AC-08.03 log com sk-abc… e API_KEY=xyz: o brief mostra [REDACTED]", () => {
    const m = mundo();
    m.svc.memory_write("A", { content: "log: sk-abcdefghijklmnopqrstuvwxyz0123456789 e API_KEY=xyz", kind: "decision" });
    const b = m.svc.memory_brief("A", {});
    expect(b.markdown).toContain("[REDACTED]");
    expect(b.markdown).not.toContain("sk-abc");
    expect(b.markdown).not.toContain("API_KEY=xyz");
    // mesmo que a entrada antiga tenha escapado da redação na escrita, o brief redige de novo
    m.b.executar("UPDATE memoria_entrada SET conteudo = 'vazou sk-abcdefghijklmnopqrstuvwxyz0123456789'");
    expect(m.svc.memory_brief("A", {}).markdown).not.toContain("sk-abc");
  });
  it("AC-08.04 brief acima do orçamento: trunca eventos primeiro, mantém o checkpoint, truncated=true", () => {
    const itens = Array.from({ length: 10 }, (_, i) => ({ tipo: "evento" as const, fonte: "sistema" as const, conteudo: `evento ${i} ${"x".repeat(250)}`, importancia: 2, atualizado_em: `2026-09-30T10:00:0${i}.000Z`, criado_em: TS }));
    const b = buildBrief({ display_id: 1, agora: TS, checkpoint: { tipo: "checkpoint", fonte: "agente", conteudo: "CHECKPOINT PRESENTE", importancia: 3, atualizado_em: TS, criado_em: TS }, decisoes: [], riscos: [], eventos: itens, orcamento_chars: 2200, memox_instalado: false });
    expect(b.truncado).toBe(true);
    expect(b.markdown).toContain("CHECKPOINT PRESENTE");
    expect(b.caracteres).toBeLessThanOrEqual(2200);
    expect(conta(b.markdown, "] evento ")).toBeLessThan(10);
  });
  it("AC-08.05 Panes A e B solo: B sem pane_id não vê A; com pane_id=A vê", async () => {
    const m = mundo();
    m.svc.memory_write("S1", { content: "nota exclusiva do painel S1 sobre kafka", kind: "fact" });
    expect((await m.svc.memory_search("S2", { query: "kafka" })).entries).toHaveLength(0);
    expect((await m.svc.memory_search("S2", { query: "kafka", pane_id: "S1" })).entries).toHaveLength(1);
  });
  it("AC-08.06 modo off: memory_write/search/brief → memory_disabled, restore sem brief, nada gravado", async () => {
    const m = mundo();
    m.svc.gravarConfig("ws_1", { ativa: false });
    const antes = m.b.consultar("SELECT 1 FROM memoria_entrada").length;
    expect(await cod(() => m.svc.memory_write("A", { content: "x", kind: "fact" }))).toBe("memory_disabled");
    expect(await cod(() => m.svc.memory_search("A", {}))).toBe("memory_disabled");
    m.fechar("A");
    const r = await criarRestaurador(m.portas()).restaurarPane("A");
    expect(r).toMatchObject({ modo: "sem_memoria", brief_injetado: false });
    expect(m.prompts[0]).toEqual({ brief: null, prompt: null });
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(antes);
  });
  it("AC-08.07 falha entre as escritas do close_pane: rollback completo e auditoria íntegra", () => {
    const m = mundo();
    const aoEncerrar = criarAoEncerrar({});
    const encerrar = (falhar: boolean): void =>
      m.b.transacao((tx) => {
        tx.executar("UPDATE pane SET estado='encerrado', encerrado_motivo='usuario' WHERE id='A'");
        aoEncerrar(tx, { id: "A" }, "usuario");
        tx.executar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES ('evt_1','pane.closed','{}',?)", [TS]);
        if (falhar) throw new Error("falha injetada depois do insert da memória");
      });
    expect(() => encerrar(true)).toThrow("falha injetada");
    expect(m.b.consultarUm("SELECT estado FROM pane WHERE id='A'")).toEqual({ estado: "pronto" });
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada")).toHaveLength(0);
    expect(m.b.consultar("SELECT 1 FROM evento_dominio")).toHaveLength(0);
    encerrar(false);
    expect(m.b.consultarUm("SELECT estado FROM pane WHERE id='A'")).toEqual({ estado: "encerrado" });
    expect(m.b.consultar("SELECT conteudo FROM memoria_entrada")).toEqual([{ conteudo: "Painel #7 encerrado (usuario)" }]);
    expect(m.b.consultar("SELECT 1 FROM evento_dominio")).toHaveLength(1);
  });
  it("AC-08.08 [GATE] duplo clique em Restaurar = exatamente 1 Pane", async () => {
    const m = mundo();
    m.svc.memory_checkpoint("A", { summary: "cp" });
    m.fechar("A");
    const rest = criarRestaurador(m.portas());
    const [a, b2, c] = await Promise.all([rest.restaurarPane("A"), rest.restaurarPane("A"), rest.restaurarPane("A")]);
    expect(new Set([a.pane_id, b2.pane_id, c.pane_id]).size).toBe(1);
    expect(m.b.consultar("SELECT 1 FROM pane WHERE respawn_de='A'")).toHaveLength(1);
    expect(m.prompts).toHaveLength(1);
  });
  it("AC-08.09 Missão fechada: existe aprendizado; anel 1 expira; nova Missão recebe pacote (≤ orçamento), não histórico", () => {
    const m = mundo();
    m.svc.memory_write("A", { content: "Aprendizado da missão: validar entrada antes de gravar", kind: "learning", importance: 4, scope: "mission" });
    m.svc.memory_write("A", { content: "histórico bruto que NÃO deve ir ao pacote", kind: "fact" });
    m.svc.preferencias.gravar({ id: null, conteudo: "Prefiro commits pequenos" });
    criarCiclo({ banco: m.b }).aoFecharMissao("M1");
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada WHERE mission_id='M1' AND tipo='aprendizado'")).toHaveLength(1);
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada WHERE mission_id='M1' AND anel=1 AND expira_em IS NULL AND estado='ativa'")).toHaveLength(0);
    const pacote = m.svc.pacoteDaMissao("C", "piloto");
    expect(pacote.caracteres).toBeLessThanOrEqual(2500);
    expect(pacote.markdown).toContain("validar entrada antes de gravar");
    expect(pacote.markdown).toContain("Prefiro commits pequenos");
    expect(pacote.markdown).not.toContain("histórico bruto");
    // outro workspace não recebe o anel 2
    semearMissao(m.b, "MX", "ws_2");
    semearPane(m.b, { id: "X", ws: "ws_2", mission: "MX", papel: "piloto" });
    expect(m.svc.pacoteDaMissao("X", "piloto").markdown).not.toContain("validar entrada");
  });
  it("AC-08.10 squad não é mais 'sem memória' (P-24 substitui RF-06.42): tem memória PRÓPRIA, isolada de outras squads e do projeto", async () => {
    const m = mundo();
    m.svc.memory_write("SQ", { content: "squad sq decidiu usar fila", kind: "decision", importance: 5, scope: "mission" });
    m.b.executar("UPDATE memoria_entrada SET expira_em = NULL");
    criarCiclo({ banco: m.b }).aoFecharMissao("MS");
    const anel2 = m.b.consultar<{ escopo: string; squad_slug: string }>("SELECT escopo, squad_slug FROM memoria_entrada WHERE anel = 2");
    expect(anel2).toEqual([{ escopo: "squad", squad_slug: "sq" }]);
    // outra squad não vê; o projeto (pane agêntico) também não
    semearMissao(m.b, "MS2", "ws_1", "squad", "outra");
    semearPane(m.b, { id: "SQ2", ws: "ws_1", mission: "MS2", papel: "piloto" });
    expect((await m.svc.memory_search("SQ2", { scope: "all_rings", query: "fila" })).entries).toHaveLength(0);
    expect((await m.svc.memory_search("A", { scope: "all_rings", query: "fila" })).entries).toHaveLength(0);
    expect((await m.svc.memory_search("SQ", { scope: "workspace", query: "fila" })).entries).toHaveLength(1);
  });
  it("AC-08.11 250 eventos antigos: compactação gera resumo(s); decisões importantes permanecem", () => {
    const m = mundo();
    const r = criarRepoMemoria(m.b);
    const base = { workspace_id: "ws_1", mission_id: "M1", pane_id: "A", linhagem_id: "A", squad_slug: null, escopo: "pane" as const, anel: 1 as const, fonte: "sistema" as const, autor_pane_id: null, substitui_id: null, estado: "ativa" as const, expira_em: null, redigido: 0, contagem: 1 };
    m.b.transacao(() => {
      for (let i = 0; i < 250; i++) r.inserir({ ...base, id: `mem_e${String(i).padStart(4, "0")}`, tipo: "evento", conteudo: `evento ${i}`, importancia: 2, hash_conteudo: String(i).padStart(64, "0"), criado_em: "2026-09-01T10:00:00.000Z", atualizado_em: "2026-09-01T10:00:00.000Z" });
      r.inserir({ ...base, id: "mem_dec", tipo: "decisao", conteudo: "decisão importante", importancia: 5, hash_conteudo: "d".repeat(64), criado_em: "2026-09-01T10:00:00.000Z", atualizado_em: "2026-09-01T10:00:00.000Z" });
    });
    const c = criarCiclo({ banco: m.b, agora: () => new Date("2026-10-20T00:00:00.000Z") });
    while (c.compactar() > 0);
    expect(m.b.consultar("SELECT 1 FROM memoria_entrada WHERE tipo='resumo'").length).toBeGreaterThanOrEqual(1);
    expect(r.obter("mem_dec")?.estado).toBe("ativa");
  });
  it("AC-08.12 worker com token da Missão M: all_rings devolve anel 1 de M, anel 2 do projeto e anel 3 do usuário, nunca anel 1 de outra Missão", async () => {
    const m = mundo();
    m.svc.memory_write("A", { content: "anel um da missão M1 sobre auditoria", kind: "decision", scope: "mission" });
    m.svc.memory_write("C", { content: "anel um da missão M2 sobre auditoria", kind: "decision", scope: "mission" });
    m.svc.memory_write("A", { content: "Aprendizado do projeto sobre auditoria", kind: "learning", importance: 4, scope: "mission" });
    criarCiclo({ banco: m.b }).aoFecharMissao("M1"); // destila o aprendizado para o anel 2
    m.svc.preferencias.gravar({ id: null, conteudo: "preferência do usuário sobre auditoria" });
    const r = (await m.svc.memory_search("W", { scope: "all_rings", query: "auditoria", limit: 50 })).entries.map((e) => e.content);
    expect(r).toEqual(expect.arrayContaining(["anel um da missão M1 sobre auditoria", "Aprendizado do projeto sobre auditoria", "preferência do usuário sobre auditoria"]));
    expect(r).not.toContain("anel um da missão M2 sobre auditoria");
  });
});
