import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { esperarAte } from "../../tests/fixtures/alertas/ajudas";
import { criarCard, montarMain, type MundoMain } from "../../tests/fixtures/alertas/mundo-main";
import { limpar } from "../../tests/fixtures/dominio/ambiente";
import { ID_CANAL_SO, ID_CANAL_TELEGRAM } from "../compartilhado/alertas";
import { CONFIG_ALERTAS_PADRAO } from "../compartilhado/alertas";
import { normalizarConfig } from "./alertas";

let m: MundoMain | null = null;
afterEach(() => {
  m?.l.encerrar();
  m = null;
  limpar();
});

/** espera a fila do entregador esvaziar (o `acordar` roda assíncrono). */
const drenado = async (mm: MundoMain): Promise<void> => {
  await esperarAte(() => mm.l.entregador.pendentes() === 0, 2000, 2);
  await new Promise((r) => setTimeout(r, 5));
};
const tipos = (mm: MundoMain): string[] => mm.l.listar({ depois_id: null, limite: 100 }).itens.map((a) => a.tipo);

describe("leveza e fronteira (P-143): nada de Telegram no boot", () => {
  it("o arquivo estático não importa o núcleo do Telegram nem o módulo lazy (só `import()` dinâmico e `import type`)", () => {
    const fonte = readFileSync(join(__dirname, "alertas.ts"), "utf8");
    const estaticos = [...fonte.matchAll(/^import\s+(?!type)[^;]*from\s+"([^"]+)"/gm)].map((x) => x[1] as string);
    expect(estaticos.filter((i) => /telegram/i.test(i) && !/repos\/telegram$/.test(i))).toEqual([]);
    expect(fonte).toMatch(/import\("\.\/alertas-telegram"\)/);
  });
  it("montar e iniciar não carrega o Telegram, não cria timer do agendador nem do entregador", async () => {
    m = montarMain();
    expect(m.l.telegramCarregado()).toBe(false);
    await m.l.iniciar();
    expect(m.l.telegramCarregado()).toBe(false);
    expect(m.l.entregador.timersVivos()).toBe(0);
  });
});

describe("canais e regras semeadas", () => {
  it("semeia o canal SO (ligado) e o Telegram (desligado, sem consentimento), com a regra padrão de notificação do sistema", async () => {
    m = montarMain();
    await m.l.iniciar();
    const canais = m.l.canaisListar();
    expect(canais.map((c) => c.id).sort()).toEqual([ID_CANAL_SO, ID_CANAL_TELEGRAM].sort());
    expect(canais.find((c) => c.id === ID_CANAL_SO)).toMatchObject({ estado: "ativo", saida_ligada: true });
    expect(canais.find((c) => c.id === ID_CANAL_TELEGRAM)).toMatchObject({ estado: "desligado", saida_ligada: false, entrada_ligada: false, consentimento: null });
    const regras = m.l.regrasListar();
    expect(regras).toHaveLength(1);
    expect(regras[0]).toMatchObject({ canal_id: ID_CANAL_SO, origem: "padrao" });
    // idempotente: reiniciar não duplica
    m.l.encerrar();
    const m2 = montarMain({ banco: m.banco, config: m.repos.config });
    await m2.l.iniciar();
    expect(m2.l.regrasListar()).toHaveLength(1);
    m2.l.encerrar();
  });
});

describe("sinaleira dos terminais livres -> alerta -> notificação do sistema (uma só fonte)", () => {
  it("aguardando/terminou viram alerta e notificação SO só sem foco; trabalhando não faz nada", async () => {
    m = montarMain();
    await m.l.iniciar();
    expect(m.l.aoAtividadeTerminal("claude", "Claude Code", "trabalhando")).toBe(false);
    expect(m.l.aoAtividadeTerminal("claude", "Claude Code", "aguardando")).toBe(true);
    expect(m.l.aoAtividadeTerminal("claude", "Claude Code", "ocioso")).toBe(true);
    await drenado(m);
    expect(tipos(m).sort()).toEqual(["pane_aguardando", "pane_terminou"]);
    expect(m.notificacoesSo).toHaveLength(2);
    expect(m.notificacoesSo[0]?.body).toMatch(/Claude Code/);
    // com a janela em foco só o alerta aparece
    m.foco.emFoco = true;
    m.l.aoAtividadeTerminal("claude", "Claude Code", "ocioso");
    await drenado(m);
    expect(m.notificacoesSo).toHaveLength(2);
    // "Pausar notificações" (preferência) vale também
    m.foco.emFoco = false;
    m.foco.notificacoes = false;
    m.l.aoAtividadeTerminal("claude", "Claude Code", "aguardando");
    await drenado(m);
    expect(m.notificacoesSo).toHaveLength(2);
  });
  it("com os alertas desligados a sinaleira não é tratada (o chamador usa o aviso de reserva)", async () => {
    m = montarMain();
    await m.l.iniciar();
    m.l.configGravar({ ligado: false });
    expect(m.l.aoAtividadeTerminal("claude", "Claude Code", "aguardando")).toBe(false);
    expect(tipos(m)).toEqual([]);
  });
});

describe("fontes de domínio: task.updated, pane.state_changed, mission.closed", () => {
  it("card reivindicado -> iniciada; entregue -> concluída com tempo de trabalho, tokens (sem fonte = nulo) e pontos nulos", async () => {
    m = montarMain();
    await m.l.iniciar();
    const c = criarCard(m);
    m.barramento.emitir("task.updated", { task_id: c.task_id, task_ref: c.task_ref, mission_id: c.mission_id, workspace_id: m.ws.id, estado: "reivindicada", pane_id: c.pane_id });
    m.barramento.emitir("pane.state_changed", { pane_id: c.pane_id, estado: "trabalhando" });
    m.relogio.avancar(5 * 60_000);
    m.barramento.emitir("task.updated", { task_id: c.task_id, task_ref: c.task_ref, mission_id: c.mission_id, workspace_id: m.ws.id, estado: "entregue", pane_id: c.pane_id });
    const lista = m.l.listar({ depois_id: null, limite: 10 }).itens;
    expect(lista.map((a) => a.tipo).sort()).toEqual(["tarefa_concluida", "tarefa_iniciada"]);
    const conc = lista.find((a) => a.tipo === "tarefa_concluida");
    expect(conc?.dados).toMatchObject({ task_id: "T-1.1", missao: "Corrigir o login", cli: "claude", tempo_trabalho_ms: 5 * 60_000, tokens: null, story_points: null });
    expect(conc?.workspace_id).toBe(m.ws.id);
  });
  it("tokens e pontos entram quando o custo (F10) e a gestão ágil (F18) têm dado", async () => {
    m = montarMain();
    await m.l.iniciar();
    const c = criarCard(m);
    const chave = `${m.ws.id}|OC-1|T-1.1`;
    m.banco.executar("INSERT INTO custo_agregado (escopo, chave, dia, modelo, atribuicao, registros, tokens_entrada, tokens_saida, usd_conhecido) VALUES ('card', ?, '2026-10-01', 'm', 'card', 3, 1000, 234, 0.5)", [chave]);
    m.barramento.emitir("task.updated", { task_id: c.task_id, task_ref: c.task_ref, mission_id: c.mission_id, workspace_id: m.ws.id, estado: "reivindicada", pane_id: c.pane_id });
    m.barramento.emitir("task.updated", { task_id: c.task_id, task_ref: c.task_ref, mission_id: c.mission_id, workspace_id: m.ws.id, estado: "entregue", pane_id: c.pane_id });
    const conc = m.l.listar({ depois_id: null, limite: 10 }).itens.find((a) => a.tipo === "tarefa_concluida");
    expect(conc?.dados).toMatchObject({ tokens: 1234, tokens_entrada: 1000, tokens_saida: 234 });
  });
  it("mission.closed concluída -> missao_concluida; abortada não alerta", async () => {
    m = montarMain();
    await m.l.iniciar();
    const c = criarCard(m);
    m.barramento.emitir("mission.closed", { mission_id: c.mission_id, workspace_id: m.ws.id, estado: "abortada" });
    expect(tipos(m)).toEqual([]);
    m.barramento.emitir("mission.closed", { mission_id: c.mission_id, workspace_id: m.ws.id, estado: "concluida" });
    expect(tipos(m)).toEqual(["missao_concluida"]);
  });
  it("cota (F9): limit.reached e account.switched viram alertas com o rótulo da conta", async () => {
    m = montarMain();
    await m.l.iniciar();
    const conta = m.repos.conta.criar({ provedor: "claude", rotulo: "pessoal" } as never);
    m.barramento.emitir("limit.reached", { conta_id: conta.id, janela: "five_hour", pane_id: null, fonte: "x" });
    const a = m.l.listar({ depois_id: null, limite: 10 }).itens.find((x) => x.tipo === "cota_atingida");
    expect(a?.dados).toMatchObject({ conta: "pessoal", provedor: "claude", pct: 100 });
  });
  it("sprint (F18): sprint.fechada vira sprint_fechada", async () => {
    m = montarMain();
    await m.l.iniciar();
    m.barramento.emitir("sprint.fechada", { tipo: "sprint.fechada", workspace_id: m.ws.id, sprint_id: null, trabalho_id: null, task_ref: null, pontos: 21, duracao_observada_ms: null, tokens: null, quando: "x", dados: { resumo_fechamento: { velocidade: 19 } } });
    const a = m.l.listar({ depois_id: null, limite: 10 }).itens.find((x) => x.tipo === "sprint_fechada");
    expect(a?.dados).toMatchObject({ entregues_pts: 21, velocidade: 19 });
  });
});

describe("relatório (F19): relatorio.pronto do barramento vira relatorio_pronto", () => {
  it("uma vez por pacote/versão, sem caminho de arquivo no alerta; falhou/gerando não alertam; o tipo deixa de ser `sem fonte`", async () => {
    m = montarMain();
    await m.l.iniciar();
    const evento = { workspace_id: m.ws.id, sprint_id: "sp_x", pacote_id: "pac_1", versao: 1, pontos_entregues: 21, itens: 5, avisos_qtd: 0 };
    m.barramento.emitir("relatorio.gerando", evento);
    m.barramento.emitir("relatorio.falhou", { ...evento, motivo: "x" });
    m.barramento.emitir("relatorio.pronto", evento);
    m.barramento.emitir("relatorio.pronto", evento); // reentrega do mesmo pacote/versão: deduplicada
    const itens = m.l.listar({ depois_id: null, limite: 20 }).itens.filter((x) => x.tipo === "relatorio_pronto");
    expect(itens).toHaveLength(1);
    expect(itens[0]?.dados).toMatchObject({ tipo_relatorio: "sprint" });
    expect(JSON.stringify(itens[0])).not.toContain("/Users");
    expect(m.l.catalogo().find((c) => c.tipo === "relatorio_pronto")?.fonte_indisponivel).toBe(false);
  });
});

describe("Maestro: a notificação do pipeline vira alerta no Centro (sem notificação do sistema duplicada)", () => {
  it("maestro.notification -> missao_aguardando_aprovacao; o canal SO padrão não a entrega", async () => {
    m = montarMain();
    await m.l.iniciar();
    m.barramento.emitir("maestro.notification", { pipeline_id: "mpl_1", motivo: "etapa_humana", etapa_id: "mergex.revisar" });
    await new Promise((r) => setTimeout(r, 20));
    expect(tipos(m)).toEqual(["missao_aguardando_aprovacao"]);
    expect(m.notificacoesSo).toHaveLength(0);
  });
});

describe("QA (método): veredito de QA.md no índice", () => {
  it("a 1ª leitura é só linha de base; mudança para aprovado/reprovado alerta uma vez", async () => {
    const indice = { trabalhos: [{ id: "OC-1", veredito_qa: null as string | null }] };
    m = montarMain({ indiceMetodo: () => indice as never });
    await m.l.iniciar();
    m.barramento.emitir("method.changed", { workspace_id: m.ws.id });
    expect(tipos(m)).toEqual([]);
    indice.trabalhos[0]!.veredito_qa = "aprovado";
    m.barramento.emitir("method.changed", { workspace_id: m.ws.id });
    m.barramento.emitir("method.changed", { workspace_id: m.ws.id });
    expect(tipos(m)).toEqual(["qa_aprovado"]);
    indice.trabalhos[0]!.veredito_qa = "reprovado";
    m.barramento.emitir("method.changed", { workspace_id: m.ws.id });
    expect(tipos(m).sort()).toEqual(["qa_aprovado", "qa_reprovado"]);
  });
  it("veredito que JÁ existia ao abrir o app não alerta", async () => {
    const indice = { trabalhos: [{ id: "OC-2", veredito_qa: "aprovado" }] };
    m = montarMain({ indiceMetodo: () => indice as never });
    await m.l.iniciar();
    m.barramento.emitir("method.changed", { workspace_id: m.ws.id });
    expect(tipos(m)).toEqual([]);
  });
});

describe("renderer: eventos e contagem", () => {
  it("alerta novo -> `alertas:novo` imediato e contagem coalescida (100 ms)", async () => {
    m = montarMain();
    await m.l.iniciar();
    m.l.emitir({ tipo: "erro_sistema", titulo: "falha", dados: { componente: "x", codigo: "y" }, estado: "a" });
    expect(m.renderer.some((e) => e.canal === "alertas:novo")).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(m.renderer.find((e) => e.canal === "alertas:contagem")?.payload).toEqual({ nao_lidos: 1, criticos: 1 });
  });
});

describe("config, regras, modelos, silêncio", () => {
  it("config: valores fora da faixa nunca propagam; patch parcial mescla", () => {
    expect(normalizarConfig({ atraso: { fator: 99, folga_min: -5 }, retencao_dias: 1, digest: { diario: { hora: "25:99" } } })).toMatchObject({ retencao_dias: 7, atraso: { fator: 10, folga_min: 0 }, digest: { diario: { hora: CONFIG_ALERTAS_PADRAO.digest.diario.hora } } });
    m = montarMain();
    const c = m.l.configGravar({ digest: { diario: { ligado: true, hora: "09:30" }, sprint: { ligado: false } } });
    expect(c.digest).toEqual({ diario: { ligado: true, hora: "09:30" }, sprint: { ligado: false } });
    expect(m.l.configLer().atraso.fator).toBe(1.5);
  });
  it("regra do renderer nunca define origem pedido_remoto, efemeridade nem destino; regra de pedido remoto não é editável", async () => {
    m = montarMain();
    await m.l.iniciar();
    const r = m.l.regraGravar({ nome: "x", ativa: true, tipos: ["tarefa_concluida"], canal_id: ID_CANAL_SO, filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: "2099-01-01T00:00:00.000Z", origem: "pedido_remoto", chat_ref: "chat:1" });
    expect(r).toMatchObject({ origem: "usuario", efemera_ate: null, chat_ref: null });
    expect(() => m!.l.regraGravar({ ...r, canal_id: "canal_inexistente" })).toThrow(/not_found/);
    m.deps.banco.executar("UPDATE alerta_regra SET origem = 'pedido_remoto', chat_ref = 'chat:9' WHERE id = ?", [r.id]);
    expect(() => m!.l.regraGravar({ ...r })).toThrow(/não é editável/);
    expect(m.l.regraApagar(r.id).ok).toBe(true);
  });
  it("modelos: valida campos ao salvar, grava, prévia e restaura o padrão", async () => {
    m = montarMain();
    const ruim = m.l.modeloGravar({ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "{{inexistente}}" });
    expect("erros" in ruim && ruim.erros.length).toBeGreaterThan(0);
    const bom = m.l.modeloGravar({ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "<b>Feito</b> {{task_id}}" });
    expect(bom).toMatchObject({ editado: true, corpo: "<b>Feito</b> {{task_id}}" });
    expect(m.l.modeloPrever({ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "<b>Feito</b> {{task_id}}" }).texto).toBe("<b>Feito</b> T-20.07");
    expect(m.l.modelosListar().find((x) => x.tipo === "tarefa_concluida" && x.canal_tipo === "telegram" && x.nivel === "minimo")?.editado).toBe(true);
    expect(m.l.modeloRestaurar({ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo" }).editado).toBe(false);
  });
  it("silêncio global: grava, lê e a janela vale (alerta fica agrupado até o fim do silêncio)", async () => {
    m = montarMain();
    await m.l.iniciar();
    m.l.silencioGravar({ janela: {}, temporario_ate: new Date(m.relogio.agora() + 3_600_000).toISOString(), temporario_incluir_criticos: false });
    expect(m.l.silencioLer().temporario_ate).not.toBeNull();
    m.l.aoAtividadeTerminal("claude", "Claude Code", "aguardando");
    await new Promise((r) => setTimeout(r, 30));
    expect(m.notificacoesSo).toHaveLength(0);
    expect(m.l.entregador.pendentes()).toBe(1); // agrupada até o fim do silêncio (nada se perde)
    expect(tipos(m)).toEqual(["pane_aguardando"]);
  });
  it("abrirEntidade devolve o destino (terminal e task) sem caminho", async () => {
    m = montarMain();
    await m.l.iniciar();
    const a = m.l.emitir({ tipo: "pane_aguardando", entidade_tipo: "terminal", entidade_id: "claude", titulo: "x", dados: { cli: "c" }, estado: "u" });
    expect(m.l.abrirEntidade(a?.id as string)).toEqual({ ok: true, destino: { tipo: "pane", workspace_id: null, entidade_id: "claude" } });
    expect(m.l.abrirEntidade("alt_inexistente")).toEqual({ ok: false, destino: null });
  });
});
