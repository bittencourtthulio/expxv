import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../banco";
import { criarRepositorios } from "../banco/repos";
import { versaoAtual } from "../banco/migrar";
import { ValorInvalidoErro } from "../dominio";
import type { EventosDominioCusto, RegistroExtraido, TipoEventoDominioCusto } from "../../compartilhado/custo";
import { criarServicoCusto, deltasDoRegistro } from "./servico";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const AGORA = new Date("2026-06-10T12:00:00.000Z");
const tk = (entrada: number, saida: number, cache_leitura = 0) => ({ entrada, cache_escrita: 0, cache_leitura, saida });
const reg = (chave: string, ts: string, modelo: string | null, entrada = 1_000_000, saida = 0, usd_medido?: number | null): RegistroExtraido => ({ chave, ts, modelo, tokens: tk(entrada, saida), ...(usd_medido === undefined ? {} : { usd_medido }) });

function montar(relogio: () => Date = () => AGORA) {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const eventos: Array<{ tipo: string; payload: unknown }> = [];
  const s = criarServicoCusto({ banco: b, relogio, publicar: <T extends TipoEventoDominioCusto>(tipo: T, payload: EventosDominioCusto[T]) => void eventos.push({ tipo, payload }) });
  s.iniciarPrecos();
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c1" });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M1", trabalho_id: "T1" });
  const exec = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", conta_id: conta.id, papel: "executor" });
  const piloto = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", conta_id: conta.id, papel: "piloto" });
  const fonte = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "projects/p/s.jsonl", conta_id: conta.id, pane_id: exec.id, mission_id: mis.id, workspace_id: ws.id });
  return { b, r, s, ws, conta, mis, exec, piloto, fonte, eventos };
}
const tipos = (e: Array<{ tipo: string }>) => e.map((x) => x.tipo);

describe("migration 0012", () => {
  it("aplica em banco vazio (versão 12) e cria as tabelas da fase", () => {
    const { b } = montar();
    expect(versaoAtual(b)).toBeGreaterThanOrEqual(12);
    for (const t of ["preco_modelo", "uso_fonte", "uso_registro", "janela_task", "custo_agregado", "custo_teto", "custo_alerta"]) {
      expect(b.consultarUm("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [t])).toBeTruthy();
    }
  });
  it("a transição de task grava reivindicada_em/entregue_em (e a reivindicação nova limpa a entrega)", () => {
    const { r, mis, exec, b } = montar();
    const t = r.task.criar({ mission_id: mis.id, task_ref: "T-01.01", titulo: "x", papel: "executor" });
    expect(b.consultarUm<{ a: string | null }>("SELECT reivindicada_em AS a FROM task WHERE id = ?", [t.id])?.a).toBeNull();
    r.task.mudarEstado(t.id, "reivindicada", { pane_id: exec.id });
    const a = b.consultarUm<{ a: string; e: string | null }>("SELECT reivindicada_em AS a, entregue_em AS e FROM task WHERE id = ?", [t.id]);
    expect(a?.a).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(a?.e).toBeNull();
    r.task.mudarEstado(t.id, "entregue");
    expect(b.consultarUm<{ e: string }>("SELECT entregue_em AS e FROM task WHERE id = ?", [t.id])?.e).toMatch(/Z$/);
    r.task.mudarEstado(t.id, "reivindicada");
    expect(b.consultarUm<{ e: string | null }>("SELECT entregue_em AS e FROM task WHERE id = ?", [t.id])?.e).toBeNull();
  });
});

describe("preços", () => {
  it("semeia os embutidos (idempotente) e o usuário vence; apagar só vale para o usuário", () => {
    const { s } = montar();
    const n = s.listarPrecos().length;
    s.iniciarPrecos();
    expect(s.listarPrecos()).toHaveLength(n);
    expect(s.listarPrecos().every((p) => p.origem === "embutido" && !p.confirmado && p.fonte !== null)).toBe(true);
    const u = s.gravarPreco({ padrao: "claude-sonnet-4*", entrada_por_mtok: 9, saida_por_mtok: 9 });
    expect(u).toMatchObject({ origem: "usuario", confirmado: true });
    expect(s.tabelaPrecos().find((p) => p.id === u.id)).toBeTruthy();
    expect(s.apagarPreco(s.listarPrecos().find((p) => p.origem === "embutido")?.id as string)).toBe(false);
    expect(s.apagarPreco(u.id)).toBe(true);
  });
  it("recusa preço inválido (negativo, NaN, padrão vazio)", () => {
    const { s } = montar();
    expect(() => s.gravarPreco({ padrao: "", entrada_por_mtok: 1, saida_por_mtok: 1 })).toThrow(ValorInvalidoErro);
    expect(() => s.gravarPreco({ padrao: "x", entrada_por_mtok: -1, saida_por_mtok: 1 })).toThrow(ValorInvalidoErro);
    expect(() => s.gravarPreco({ padrao: "x", entrada_por_mtok: 1, saida_por_mtok: Number.NaN })).toThrow(ValorInvalidoErro);
  });
  it("edição do usuário vira nova versão (valido_desde = agora) sem apagar a primeira", () => {
    const { s } = montar();
    s.gravarPreco({ padrao: "meu-modelo", entrada_por_mtok: 1, saida_por_mtok: 2 });
    s.gravarPreco({ padrao: "meu-modelo", entrada_por_mtok: 3, saida_por_mtok: 4 });
    expect(s.listarPrecos().filter((p) => p.padrao === "meu-modelo")).toHaveLength(2);
  });
  it("preços do OpenRouter (Fase 9) entram como openrouter/confirmado e saem quando o modelo perde o preço", () => {
    const { s, b } = montar();
    b.executar("INSERT INTO openrouter_modelo (id,nome,preco_entrada_por_mtok,preco_saida_por_mtok,visto_em,atualizado_em) VALUES ('v/a','A',2,6,'x','x'),('v/b','B',NULL,NULL,'x','x')");
    s.iniciarPrecos();
    expect(s.listarPrecos().filter((p) => p.origem === "openrouter").map((p) => [p.padrao, p.entrada_por_mtok, p.confirmado])).toEqual([["v/a", 2, true]]);
    b.executar("UPDATE openrouter_modelo SET preco_entrada_por_mtok = NULL WHERE id = 'v/a'");
    s.iniciarPrecos();
    expect(s.listarPrecos().filter((p) => p.origem === "openrouter")).toEqual([]);
  });
});

describe("ingestão e agregados", () => {
  it("2x o mesmo lote = 1 registro (idempotente) e o agregado não dobra", () => {
    const { s, fonte, exec } = montar();
    const lote = [reg("m1", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5"), reg("m2", "2026-06-10T10:01:00.000Z", "claude-sonnet-4-5")];
    expect(s.ingerir(fonte.id, lote)).toEqual({ novos: 2, duplicados: 0 });
    expect(s.ingerir(fonte.id, lote)).toEqual({ novos: 0, duplicados: 2 });
    const r = s.resumo("pane", exec.id);
    expect(r).toMatchObject({ registros: 2, usd: 6, aproximado: true });
  });
  it("custo congelado: preço novo não muda o que já foi registrado; só reprecificar (e só por pedido)", () => {
    const { s, fonte, exec } = montar();
    s.ingerir(fonte.id, [reg("m1", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5")]);
    s.gravarPreco({ padrao: "claude-sonnet-4*", entrada_por_mtok: 30, saida_por_mtok: 30 });
    expect(s.resumo("pane", exec.id).usd).toBe(3);
    expect(s.reprecificar({ simular: true })).toEqual({ registros_reprecificados: 1 });
    expect(s.resumo("pane", exec.id).usd).toBe(3);
    expect(s.reprecificar()).toEqual({ registros_reprecificados: 1 });
    expect(s.resumo("pane", exec.id).usd).toBe(30);
    expect(s.reprecificar()).toEqual({ registros_reprecificados: 0 });
  });
  it("valor medido pela CLI vence a tabela e não é reprecificado", () => {
    const { s, fonte, exec } = montar();
    s.ingerir(fonte.id, [reg("m1", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5", 1_000_000, 0, 0.5)]);
    s.gravarPreco({ padrao: "claude-sonnet-4*", entrada_por_mtok: 30, saida_por_mtok: 30 });
    s.reprecificar();
    expect(s.resumo("pane", exec.id)).toMatchObject({ usd: 0.5, aproximado: false });
  });
  it("modelo sem preço: usd null no registro, ≥ no resumo, alerta UMA vez; cadastrar o preço resolve", () => {
    const { s, fonte, exec, eventos } = montar();
    s.ingerir(fonte.id, [reg("m1", "2026-06-10T10:00:00.000Z", "modelo-novo")]);
    expect(s.resumo("pane", exec.id)).toMatchObject({ usd: null, incompleto: true, registros: 1 });
    s.ingerir(fonte.id, [reg("m2", "2026-06-10T10:01:00.000Z", "modelo-novo")]);
    expect(tipos(eventos).filter((t) => t === "cost.price_missing")).toHaveLength(1);
    s.ingerir(fonte.id, [reg("m3", "2026-06-10T10:02:00.000Z", "claude-sonnet-4-5")]);
    expect(s.resumo("pane", exec.id)).toMatchObject({ usd: 3, incompleto: true });
    s.gravarPreco({ padrao: "modelo-novo", entrada_por_mtok: 1, saida_por_mtok: 1 });
    expect(s.reprecificar().registros_reprecificados).toBe(2);
    expect(s.resumo("pane", exec.id)).toMatchObject({ usd: 5, incompleto: false });
  });
  it("sem modelo no registro: usd null (nunca chute) e nenhum alerta de modelo", () => {
    const { s, fonte, exec, eventos } = montar();
    s.ingerir(fonte.id, [reg("m1", "2026-06-10T10:00:00.000Z", null)]);
    expect(s.resumo("pane", exec.id)).toMatchObject({ usd: null, incompleto: true });
    expect(tipos(eventos)).not.toContain("cost.price_missing");
  });
  it("descarta registro inválido (chave vazia, ts inválido, token negativo) sem lançar", () => {
    const { s, fonte } = montar();
    const r = s.ingerir(fonte.id, [reg("", "2026-06-10T10:00:00.000Z", "m"), reg("a", "lixo", "m"), { chave: "b", ts: "2026-06-10T10:00:00.000Z", modelo: "m", tokens: tk(-1, 0) }]);
    expect(r).toEqual({ novos: 0, duplicados: 0 });
  });
  it("evento cost.updated sai com os escopos tocados; sem registro novo, sem evento", () => {
    const { s, fonte, eventos, exec, mis, ws } = montar();
    s.ingerir(fonte.id, [reg("m1", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5")]);
    const ev = eventos.find((e) => e.tipo === "cost.updated")?.payload as EventosDominioCusto["cost.updated"];
    expect(ev.escopos).toEqual(expect.arrayContaining([{ escopo: "pane", chave: exec.id }, { escopo: "missao", chave: mis.id }, { escopo: "workspace", chave: ws.id }]));
    const n = eventos.length;
    s.ingerir(fonte.id, [reg("m1", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5")]);
    expect(eventos).toHaveLength(n);
  });
  it("fonte inexistente lança NaoEncontrado", () => {
    const { s } = montar();
    expect(() => s.ingerir("uf_nao_existe", [])).toThrow(/não encontrad|FonteUso/i);
  });
});

describe("atribuição (cards, piloto, ambíguo)", () => {
  function comTask(m: ReturnType<typeof montar>, ref: string, claim: string, entrega: string | null) {
    const t = m.r.task.criar({ mission_id: m.mis.id, task_ref: ref, titulo: ref, papel: "executor" });
    m.r.task.mudarEstado(t.id, "reivindicada", { pane_id: m.exec.id });
    m.b.executar("UPDATE task SET reivindicada_em = ?, entregue_em = ? WHERE id = ?", [claim, entrega, t.id]);
  }
  it("dois cards sequenciais no mesmo Pane: cada um só a sua janela; Σ = total do Pane (CT-10.06)", () => {
    const m = montar();
    comTask(m, "T-01.01", "2026-06-10T10:00:00.000Z", "2026-06-10T11:00:00.000Z");
    comTask(m, "T-01.02", "2026-06-10T11:10:00.000Z", "2026-06-10T12:00:00.000Z");
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T10:30:00.000Z", "claude-sonnet-4-5"), reg("b", "2026-06-10T11:30:00.000Z", "claude-sonnet-4-5", 2_000_000), reg("c", "2026-06-10T11:05:00.000Z", "claude-sonnet-4-5")]);
    expect(m.s.resumoCard(m.ws.id, "T1", "T-01.01").usd).toBe(3);
    expect(m.s.resumoCard(m.ws.id, "T1", "T-01.02").usd).toBe(6);
    const miss = m.s.resumoMissao(m.mis.id);
    expect(miss.sem_card.usd).toBe(3);
    expect(miss.usd).toBe(12);
    expect((miss.cards.usd ?? 0) + (miss.sem_card.usd ?? 0)).toBe(12);
    expect(m.s.resumo("pane", m.exec.id).usd).toBe(12);
    expect(m.s.resumo("trabalho", `${m.ws.id}|T1`).usd).toBe(9);
  });
  it("piloto vai para orquestração e nunca soma em card, mesmo dentro da janela", () => {
    const m = montar();
    comTask(m, "T-01.01", "2026-06-10T10:00:00.000Z", null);
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    const fp = m.s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "p.jsonl", pane_id: m.piloto.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.s.ingerir(fp.id, [reg("p1", "2026-06-10T10:30:00.000Z", "claude-sonnet-4-5")]);
    expect(m.s.resumoMissao(m.mis.id).orquestracao.usd).toBe(3);
    expect(m.s.resumoCard(m.ws.id, "T1", "T-01.01")).toMatchObject({ usd: null, registros: 0 });
  });
  it("janelas sobrepostas ⇒ ambígua: aparece na Missão, não em card (CT-10.07)", () => {
    const m = montar();
    comTask(m, "A", "2026-06-10T10:00:00.000Z", null);
    comTask(m, "B", "2026-06-10T10:10:00.000Z", null);
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    m.s.ingerir(m.fonte.id, [reg("x", "2026-06-10T10:30:00.000Z", "claude-sonnet-4-5")]);
    expect(m.s.resumoMissao(m.mis.id).ambiguo.usd).toBe(3);
    expect(m.s.resumoCard(m.ws.id, "T1", "A").registros).toBe(0);
  });
  it("task_concluida chega depois do uso: reatribuir move sem_card para o card; duas vezes não muda nada (CT-10.12)", () => {
    const m = montar();
    m.s.ingerir(m.fonte.id, [reg("x", "2026-06-10T10:30:00.000Z", "claude-sonnet-4-5")]);
    expect(m.s.resumoMissao(m.mis.id).sem_card.usd).toBe(3);
    const n = m.s.sincronizarJanelasDoRastro(m.ws.id, "T1", [{ ts: "2026-06-10T10:00:00.000Z", evento: "task_iniciada", task: "T-09.09" }, { ts: "2026-06-10T11:00:00.000Z", evento: "task_concluida", task: "T-09.09" }]);
    expect(n).toBe(1);
    expect(m.s.resumoCard(m.ws.id, "T1", "T-09.09").usd).toBe(3);
    expect(m.s.resumoMissao(m.mis.id)).toMatchObject({ usd: 3 });
    expect(m.s.resumoMissao(m.mis.id).sem_card.usd).toBeNull();
    expect(m.s.sincronizarJanelasDoRastro(m.ws.id, "T1", [{ ts: "2026-06-10T10:00:00.000Z", evento: "task_iniciada", task: "T-09.09" }, { ts: "2026-06-10T11:00:00.000Z", evento: "task_concluida", task: "T-09.09" }])).toBe(0);
  });
  it("card descartado preserva o custo (o agregado não depende do estado da task)", () => {
    const m = montar();
    comTask(m, "T-01.01", "2026-06-10T10:00:00.000Z", null);
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T10:30:00.000Z", "claude-sonnet-4-5")]);
    m.b.executar("UPDATE task SET estado = 'descartada'");
    expect(m.s.resumoCard(m.ws.id, "T1", "T-01.01").usd).toBe(3);
  });
});

describe("reindexar, retenção, teto, fontes, proxy", () => {
  it("reindexar produz agregados idênticos aos incrementais (CT-10.19)", () => {
    const m = montar();
    m.r.task.criar({ mission_id: m.mis.id, task_ref: "T-01.01", titulo: "x", papel: "executor" });
    m.b.executar("UPDATE task SET reivindicada_em = '2026-06-10T10:00:00.000Z', pane_id = ?", [m.exec.id]);
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    const lote = Array.from({ length: 40 }, (_, i) => reg(`k${i}`, `2026-06-0${1 + (i % 9)}T${String(10 + (i % 5)).padStart(2, "0")}:00:00.000Z`, i % 7 === 0 ? "modelo-x" : "claude-sonnet-4-5", 100_000 + i, 1000 * i));
    m.s.ingerir(m.fonte.id, lote);
    const foto = () => m.b.consultar("SELECT escopo,chave,dia,modelo,atribuicao,registros,registros_sem_preco,registros_aproximados,tokens_entrada,tokens_saida,round(usd_conhecido,6) AS usd FROM custo_agregado WHERE registros > 0 ORDER BY 1,2,3,4,5");
    const antes = foto();
    expect(antes.length).toBeGreaterThan(10);
    expect(m.s.reindexar().registros).toBe(40);
    expect(foto()).toEqual(antes);
  });
  it("retenção apaga só o bruto antigo e é idempotente; o agregado fica", () => {
    const m = montar();
    m.s.ingerir(m.fonte.id, [reg("velho", "2026-01-01T10:00:00.000Z", "claude-sonnet-4-5"), reg("novo", "2026-06-09T10:00:00.000Z", "claude-sonnet-4-5")]);
    expect(m.s.aplicarRetencao()).toEqual({ apagados: 1 });
    expect(m.s.aplicarRetencao()).toEqual({ apagados: 0 });
    expect(m.s.resumo("pane", m.exec.id)).toMatchObject({ registros: 2, usd: 6 });
    m.s.reindexar(); // reindexar não destrói o agregado dos dias fora da retenção
    expect(m.s.resumo("pane", m.exec.id)).toMatchObject({ registros: 2, usd: 6 });
  });
  it("teto: aviso em 80% e estouro avisam UMA vez cada, nada é interrompido, e não repetem ao recarregar (CT-10.18)", () => {
    const m = montar();
    m.s.definirTeto(m.mis.id, 10);
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5", 2_000_000)]); // 6
    expect(tipos(m.eventos)).not.toContain("cost.ceiling_warning");
    m.s.ingerir(m.fonte.id, [reg("b", "2026-06-10T10:01:00.000Z", "claude-sonnet-4-5", 700_000)]); // 8,1
    m.s.ingerir(m.fonte.id, [reg("c", "2026-06-10T10:02:00.000Z", "claude-sonnet-4-5", 100_000)]);
    expect(tipos(m.eventos).filter((t) => t === "cost.ceiling_warning")).toHaveLength(1);
    m.s.ingerir(m.fonte.id, [reg("d", "2026-06-10T10:03:00.000Z", "claude-sonnet-4-5", 1_000_000)]); // 11,4
    m.s.ingerir(m.fonte.id, [reg("e", "2026-06-10T10:04:00.000Z", "claude-sonnet-4-5", 1_000_000)]);
    expect(m.eventos.filter((e) => e.tipo === "cost.ceiling_reached")).toHaveLength(1);
    expect(m.eventos.find((e) => e.tipo === "cost.ceiling_reached")?.payload).toMatchObject({ mission_id: m.mis.id, teto_usd: 10 });
    // "recarregar": novo serviço sobre o mesmo banco não repete
    const s2 = criarServicoCusto({ banco: m.b, relogio: () => AGORA, publicar: (t) => void m.eventos.push({ tipo: t, payload: null }) });
    const n = m.eventos.length;
    s2.verificarTeto(m.mis.id);
    expect(m.eventos).toHaveLength(n);
    // mudar o teto reabilita o aviso
    m.s.definirTeto(m.mis.id, 12); // gasto 14,4 já passa do teto novo: avisa de novo
    m.s.definirTeto(m.mis.id, 12);
    expect(m.eventos.filter((e) => e.tipo === "cost.ceiling_reached")).toHaveLength(2);
    m.s.definirTeto(m.mis.id, 1);
    expect(m.eventos.filter((e) => e.tipo === "cost.ceiling_reached")).toHaveLength(3);
  });
  it("teto padrão da configuração vale para Missão sem teto próprio; teto inválido é recusado", () => {
    const m = montar();
    m.s.config.gravar({ ...m.s.config.ler(), teto_padrao_missao_usd: 1 });
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5")]);
    expect(tipos(m.eventos)).toContain("cost.ceiling_reached");
    expect(() => m.s.definirTeto(m.mis.id, 0)).toThrow(ValorInvalidoErro);
    expect(() => m.s.definirTeto("mis_inexistente", 5)).toThrow();
  });
  it("CLI sem leitor: sem_fonte visível, fontes_ausentes, custo NUNCA 0 e alerta uma vez (CT-10.09)", () => {
    const m = montar();
    const gem = m.r.pane.criar({ workspace_id: m.ws.id, mission_id: m.mis.id, tipo: "cli", cli: "gemini", papel: "executor" });
    m.s.marcarSemFonte({ cli: "gemini", pane_id: gem.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.s.marcarSemFonte({ cli: "gemini", pane_id: gem.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    expect(tipos(m.eventos).filter((t) => t === "usage.source_missing")).toHaveLength(1);
    expect(m.s.resumo("pane", gem.id)).toMatchObject({ usd: null, incompleto: true, fontes_ausentes: ["sem_fonte:gemini"], registros: 0 });
    expect(m.s.resumoMissao(m.mis.id)).toMatchObject({ incompleto: true, fontes_ausentes: ["sem_fonte:gemini"] });
    expect(m.s.fontesEstado(m.ws.id).find((f) => f.cli === "gemini")).toMatchObject({ estado: "sem_fonte", atraso_s: null });
  });
  it("uso do proxy OpenRouter é medido (usd_origem proxy) e idempotente por id (CT-10.23)", () => {
    const m = montar();
    const pane = m.r.pane.criar({ workspace_id: m.ws.id, mission_id: m.mis.id, tipo: "cli", cli: "opencode", papel: "executor" });
    const uso = { pane_id: pane.id, modelo: "vendor/modelo-x", tokens_in: 1000, tokens_out: 500, usd: 0.0123, ts: "2026-06-10T10:00:00.000Z", id: "gen-1" };
    expect(m.s.ingerirProxy(uso).novos).toBe(1);
    expect(m.s.ingerirProxy(uso).novos).toBe(0);
    expect(m.s.resumo("pane", pane.id)).toMatchObject({ usd: 0.0123, aproximado: false, incompleto: false });
    expect(m.b.consultarUm<{ o: string }>("SELECT usd_origem AS o FROM uso_registro WHERE pane_id = ?", [pane.id])?.o).toBe("proxy");
    expect(() => m.s.ingerirProxy({ ...uso, pane_id: "pane_nao" })).toThrow();
  });
  it("diagnóstico não contém conteúdo nem caminho: só contagens e estados", () => {
    const m = montar();
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5")]);
    const d = m.s.diagnostico();
    expect(d).toContain("1 registros brutos");
    expect(d).not.toContain("projects/p/s.jsonl");
    expect(d).not.toContain("/w");
  });
  it("custo por modelo do card traz a origem do valor e marca sem preço", () => {
    const m = montar();
    m.r.task.criar({ mission_id: m.mis.id, task_ref: "C1", titulo: "x", papel: "executor" });
    m.b.executar("UPDATE task SET reivindicada_em = '2026-06-10T09:00:00.000Z', pane_id = ?", [m.exec.id]);
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5"), reg("b", "2026-06-10T10:01:00.000Z", "claude-sonnet-4-5", 1, 1, 0.01), reg("c", "2026-06-10T10:02:00.000Z", "novo")]);
    const por = m.s.custoPorModelo(m.ws.id, "T1", "C1");
    expect(por.find((p) => p.modelo === "novo")).toMatchObject({ usd: null, origem: "desconhecido" });
    expect(por.map((p) => p.origem).sort()).toEqual(["cli", "desconhecido", "tabela"]);
  });
  it("porta da Fase 18: tokens (entrada+saída) e tempo ativo da task; null sem dado", () => {
    const m = montar();
    m.r.task.criar({ mission_id: m.mis.id, task_ref: "C1", titulo: "x", papel: "executor" });
    m.b.executar("UPDATE task SET reivindicada_em = '2026-06-10T09:00:00.000Z', entregue_em = '2026-06-10T10:00:00.000Z', pane_id = ?", [m.exec.id]);
    m.s.sincronizarJanelasDoBanco(m.ws.id, "T1");
    expect(m.s.janelasParaAgil(m.ws.id, "T1", "ZZ")).toBeNull();
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-10T09:30:00.000Z", "claude-sonnet-4-5", 1000, 200)]);
    expect(m.s.janelasParaAgil(m.ws.id, "T1", "C1")).toEqual({ ativo_ms: 3_600_000, tokens: 1200 });
  });
});

describe("relatório agrupado", () => {
  function popular() {
    const m = montar();
    const b = m.r.pane.criar({ workspace_id: m.ws.id, mission_id: m.mis.id, tipo: "cli", cli: "codex", papel: "executor" });
    const fb = m.s.registrarFonte({ cli: "codex", base: "codex_home", relativo: "s.jsonl", pane_id: b.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.s.ingerir(m.fonte.id, [reg("a", "2026-06-09T10:00:00.000Z", "claude-sonnet-4-5"), reg("a2", "2026-06-10T10:00:00.000Z", "claude-sonnet-4-5"), reg("n", "2026-06-10T10:00:00.000Z", "x-novo")]);
    m.s.ingerir(fb.id, [reg("g", "2026-06-10T11:00:00.000Z", "gpt-5", 1_000_000, 100_000)]);
    return { ...m, b };
  }
  const P = { desde: "2026-06-01", ate: "2026-06-30" };
  it("por modelo: Σ das linhas = total; modelo desconhecido listado à parte (não soma 0)", () => {
    const m = popular();
    const r = m.s.relatorio({ agrupar: "modelo", ...P });
    expect(r.linhas.find((l) => l.chave === "x-novo")?.custo).toMatchObject({ usd: null, incompleto: true });
    const soma = r.linhas.reduce((a, l) => a + (l.custo.usd ?? 0), 0);
    expect(soma).toBeCloseTo(r.total.usd ?? 0, 6);
    expect(r.linhas[0]?.chave).toBe("claude-sonnet-4-5");
  });
  it("por dia, por conta, por Pane e por Missão usam o agregado; com filtro cruzado cai no bruto e dá o mesmo total", () => {
    const m = popular();
    expect(m.s.relatorio({ agrupar: "dia", ...P }).linhas.map((l) => l.chave).sort()).toEqual(["2026-06-09", "2026-06-10"]);
    expect(m.s.relatorio({ agrupar: "pane", ...P }).linhas).toHaveLength(2);
    expect(m.s.relatorio({ agrupar: "missao", ...P }).linhas[0]?.rotulo).toBe("M1");
    const cruz = m.s.relatorio({ agrupar: "pane", ...P, filtros: { mission_id: m.mis.id } });
    expect(cruz.total.usd).toBeCloseTo(m.s.relatorio({ agrupar: "pane", ...P }).total.usd ?? 0, 6);
    expect(m.s.relatorio({ agrupar: "modelo", ...P, filtros: { mission_id: m.mis.id } }).linhas).toHaveLength(3);
    expect(m.s.relatorio({ agrupar: "modelo", ...P, filtros: { modelo: "gpt-5" } }).linhas.map((l) => l.chave)).toEqual(["gpt-5"]);
  });
  it("período fora do dado devolve vazio e paginação por cursor percorre tudo sem repetir", () => {
    const m = popular();
    expect(m.s.relatorio({ agrupar: "modelo", desde: "2025-01-01", ate: "2025-01-31" })).toMatchObject({ linhas: [], proximo: null, total: { usd: null, registros: 0 } });
    const a = m.s.relatorio({ agrupar: "modelo", ...P, limite: 2 });
    expect(a.linhas).toHaveLength(2);
    const b = m.s.relatorio({ agrupar: "modelo", ...P, limite: 2, cursor: a.proximo });
    expect([...a.linhas, ...b.linhas].map((l) => l.chave)).toHaveLength(3);
    expect(b.proximo).toBeNull();
  });
});

describe("deltasDoRegistro", () => {
  it("só card tem escopo card/trabalho; sinal −1 inverte tudo", () => {
    const base = { ts: "2026-06-10T10:00:00.000Z", modelo: "m", tokens_entrada: 10, tokens_cache_escrita: 1, tokens_cache_leitura: 2, tokens_saida: 3, usd: 0.5, aproximado: 1, pane_id: "p", mission_id: "m1", workspace_id: "w", conta_id: "c", trabalho_id: "T", task_id: "A" } as const;
    const card = deltasDoRegistro({ ...base, atribuicao: "card" }, 1);
    expect(card.map((d) => d.escopo).sort()).toEqual(["card", "conta", "missao", "pane", "trabalho", "workspace"]);
    const sem = deltasDoRegistro({ ...base, atribuicao: "sem_card", trabalho_id: null, task_id: null }, -1);
    expect(sem.map((d) => d.escopo).sort()).toEqual(["conta", "missao", "pane", "workspace"]);
    expect(sem[0]).toMatchObject({ registros: -1, tokens_entrada: -10, usd_conhecido: -0.5, registros_aproximados: -1 });
  });
});
