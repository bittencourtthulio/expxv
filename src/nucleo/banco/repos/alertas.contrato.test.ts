// Contrato dos repositórios da Fase 20: a MESMA suíte roda contra a versão em memória (especificação executável) e contra o SQL real.
import { afterEach, describe, expect, it } from "vitest";
import type { AlertaVisao, CanalRegistro, EntregaRegistro, Regra } from "../../../compartilhado/alertas";
import { criarRepoAlertasMemoria, criarRepoCanaisMemoria, criarRepoEntregasMemoria, criarRepoRegrasMemoria } from "../../alertas/memoria";
import { criarRepoModelosMemoria } from "../../alertas/repo-modelos";
import type { RepoAlertas, RepoCanais, RepoEntregas, RepoRegras } from "../../alertas/portas";
import { criarRepoTempoMemoria, type RegistroTempo, type RepoTempo } from "../../alertas/tempo";
import { criarRepoTelegramMemoria, type AprovacaoRow, type EntradaRow, type RepoTelegram } from "../../telegram/repo";
import { abrirBanco, type Banco } from "../banco";
import { migrar } from "../migrar";
import { criarRepoAlertasSql, criarRepoCanaisSql, criarRepoEntregasSql, criarRepoModelosSql, criarRepoRegrasSql, criarRepoTempoSql } from "./alertas";
import { criarRepoTelegramSql } from "./telegram";

interface Mundo {
  alertas: RepoAlertas;
  entregas: RepoEntregas;
  regras: RepoRegras;
  canais: RepoCanais;
  tempo: RepoTempo;
  modelos: ReturnType<typeof criarRepoModelosMemoria>;
  tg: RepoTelegram;
  banco?: Banco;
}
const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));

const memoria = (): Mundo => ({ alertas: criarRepoAlertasMemoria(), entregas: criarRepoEntregasMemoria(), regras: criarRepoRegrasMemoria(), canais: criarRepoCanaisMemoria(), tempo: criarRepoTempoMemoria(), modelos: criarRepoModelosMemoria(), tg: criarRepoTelegramMemoria() });
const sql = (): Mundo => {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  return { alertas: criarRepoAlertasSql(b), entregas: criarRepoEntregasSql(b), regras: criarRepoRegrasSql(b), canais: criarRepoCanaisSql(b), tempo: criarRepoTempoSql(b), modelos: criarRepoModelosSql(b), tg: criarRepoTelegramSql(b), banco: b };
};

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const canal = (id = "c1", o: Partial<CanalRegistro> = {}): CanalRegistro => ({ id, tipo: "telegram", nome: "Telegram", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: null, silenciado_ate: null, erro_codigo: null, ...o });
const alerta = (id: string, min: number, o: Partial<AlertaVisao> = {}): AlertaVisao => ({
  id, tipo: "tarefa_concluida", severidade: "sucesso", fonte: "metodo", workspace_id: "ws1", mission_id: "m1", entidade_tipo: "task", entidade_id: id, titulo: `Titulo ${id}`, dados: { tempo_trabalho_ms: 1000, tokens: null },
  dedupe_chave: `k|${id}`, contagem: 1, criado_em: iso(min), atualizado_em: iso(min), lido_em: null, silenciado_ate: null, arquivado_em: null, ...o,
});
const entrega = (id: string, alerta_id: string, regra_id: string | null, o: Partial<EntregaRegistro> = {}): EntregaRegistro => ({
  id, alerta_id, canal_id: "c1", regra_id, estado: "pendente", tentativas: 0, proxima_tentativa_em: null, erro_codigo: null, lote_id: null, mensagem_externa_id: null, enviado_em: null, criado_em: iso(0), nivel: "minimo", chat_ref: null, ...o,
});
const regra = (id: string, o: Partial<Regra> = {}): Regra => ({ id, nome: id, ativa: true, tipos: ["*"], canal_id: "c1", filtros: { severidade_min: "aviso" }, silencio: { inicio: "22:00", fim: "07:00" }, agrupamento: { modo: "imediato" }, nivel: "padrao", efemera_ate: null, origem: "usuario", ...o });

const MUNDOS: Array<[string, () => Mundo]> = [["memória", memoria], ["SQL", sql]];

describe.each(MUNDOS)("contrato dos repositórios de alertas (%s)", (_n, criar) => {
  it("alertas: inserir/obter/atualizar com dados JSON, contar, marcar lido e silenciar", () => {
    const m = criar();
    m.alertas.inserir(alerta("a1", 1));
    m.alertas.inserir(alerta("a2", 2, { severidade: "critico", tipo: "erro_sistema", entidade_tipo: "componente", entidade_id: "daemon" }));
    expect(m.alertas.obter("a1")?.dados).toEqual({ tempo_trabalho_ms: 1000, tokens: null });
    expect(m.alertas.obter("nao")).toBeNull();
    m.alertas.atualizar("a1", { contagem: 3, titulo: "novo", dados: { x: 1 }, atualizado_em: iso(5) });
    expect(m.alertas.obter("a1")).toMatchObject({ contagem: 3, titulo: "novo", dados: { x: 1 }, atualizado_em: iso(5) });
    expect(m.alertas.contar()).toEqual({ nao_lidos: 2, criticos: 1 });
    expect(m.alertas.marcarLido(["a1", "a1", "zzz"], iso(9))).toBe(1);
    expect(m.alertas.contar()).toEqual({ nao_lidos: 1, criticos: 1 });
    expect(m.alertas.silenciar({ tipo: "erro_sistema" }, iso(60))).toBe(1);
    expect(m.alertas.silenciar({ entidade_tipo: "task", entidade_id: "a1" }, iso(30))).toBe(1);
    expect(m.alertas.obter("a2")?.silenciado_ate).toBe(iso(60));
  });

  it("recentePorDedupe: só NÃO lido, dentro da janela, o mais recente", () => {
    const m = criar();
    m.alertas.inserir(alerta("a1", 1, { dedupe_chave: "K", atualizado_em: iso(1) }));
    m.alertas.inserir(alerta("a2", 2, { dedupe_chave: "K", atualizado_em: iso(8) }));
    expect(m.alertas.recentePorDedupe("K", iso(0))?.id).toBe("a2");
    expect(m.alertas.recentePorDedupe("K", iso(9))).toBeNull();
    m.alertas.marcarLido(["a2"], iso(10));
    expect(m.alertas.recentePorDedupe("K", iso(0))?.id).toBe("a1");
    expect(m.alertas.recentePorDedupe("outra", iso(0))).toBeNull();
  });

  it("listar: ordem (criado_em, id) desc, cursor, filtros e limite", () => {
    const m = criar();
    for (let i = 1; i <= 7; i++) m.alertas.inserir(alerta(`a${i}`, i, { severidade: i % 2 === 0 ? "aviso" : "info", workspace_id: i > 5 ? "ws2" : "ws1", tipo: i === 3 ? "qa_aprovado" : "tarefa_concluida" }));
    m.alertas.inserir(alerta("a8", 7)); // mesmo instante de a7: desempata por id desc
    const p1 = m.alertas.listar({ limite: 3 });
    expect(p1.itens.map((a) => a.id)).toEqual(["a8", "a7", "a6"]);
    expect(p1.proximo).toBe("a6");
    const p2 = m.alertas.listar({ limite: 3, depois_id: p1.proximo });
    expect(p2.itens.map((a) => a.id)).toEqual(["a5", "a4", "a3"]);
    const fim = m.alertas.listar({ limite: 10, depois_id: "a3" });
    expect(fim.itens.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(fim.proximo).toBeNull();
    expect(m.alertas.listar({ depois_id: "inexistente" }).itens).toEqual([]);
    expect(m.alertas.listar({ severidade_min: "aviso" }).itens.map((a) => a.id)).toEqual(["a6", "a4", "a2"]);
    expect(m.alertas.listar({ workspace_id: "ws2" }).itens.map((a) => a.id)).toEqual(["a7", "a6"]);
    expect(m.alertas.listar({ tipos: ["qa_aprovado"] }).itens.map((a) => a.id)).toEqual(["a3"]);
    expect(m.alertas.listar({ busca: "TITULO A5" }).itens.map((a) => a.id)).toEqual(["a5"]);
    m.alertas.marcarLido(["a8", "a7"], iso(20));
    expect(m.alertas.listar({ estado: "nao_lidos", limite: 1 }).itens[0]?.id).toBe("a6");
    m.alertas.silenciar({ tipo: "qa_aprovado" }, iso(60));
    expect(m.alertas.listar({ estado: "silenciados" }).itens.map((a) => a.id)).toEqual(["a3"]);
    m.alertas.atualizar("a1", { arquivado_em: iso(30) });
    expect(m.alertas.listar({ limite: 100 }).itens.map((a) => a.id)).not.toContain("a1");
    expect(m.alertas.contar().nao_lidos).toBe(5);
  });

  it("apagarAntesDe remove só os antigos (e as entregas em cascata no SQL)", () => {
    const m = criar();
    m.canais.gravar(canal());
    m.alertas.inserir(alerta("a1", 1));
    m.alertas.inserir(alerta("a2", 100));
    expect(m.alertas.apagarAntesDe(iso(50))).toBe(1);
    expect(m.alertas.obter("a1")).toBeNull();
    expect(m.alertas.obter("a2")).not.toBeNull();
  });

  it("entregas: idempotentes por (alerta, canal, regra) inclusive com regra NULL; atualizar; porEstado; apagarAntesDe", () => {
    const m = criar();
    m.canais.gravar(canal());
    m.regras.gravar(regra("r1"));
    m.alertas.inserir(alerta("a1", 1));
    expect(m.entregas.inserir(entrega("e1", "a1", "r1"))).toBe(true);
    expect(m.entregas.inserir(entrega("e2", "a1", "r1"))).toBe(false);
    expect(m.entregas.inserir(entrega("e3", "a1", null))).toBe(true);
    expect(m.entregas.inserir(entrega("e4", "a1", null))).toBe(false);
    m.entregas.atualizar("e1", { estado: "enviado", tentativas: 1, enviado_em: iso(2), mensagem_externa_id: "42", proxima_tentativa_em: null });
    expect(m.entregas.obter("e1")).toMatchObject({ estado: "enviado", tentativas: 1, mensagem_externa_id: "42" });
    expect(m.entregas.porEstado("pendente", 10).map((e) => e.id)).toEqual(["e3"]);
    expect(m.entregas.porEstado("enviado", 10).map((e) => e.id)).toEqual(["e1"]);
    expect(m.entregas.apagarAntesDe(iso(1))).toBe(2);
    expect(m.entregas.obter("e1")).toBeNull();
  });

  it("regras: gravar (criar/atualizar), listar em ordem, apagar", () => {
    const m = criar();
    m.canais.gravar(canal());
    m.regras.gravar(regra("r1"));
    m.regras.gravar(regra("r2", { ativa: false, chat_ref: "chat:9", origem: "pedido_remoto", efemera_ate: iso(30), tipos: ["tarefa_atrasada"] }));
    m.regras.gravar(regra("r1", { nome: "mudou", agrupamento: { modo: "digest", hora_digest: "18:00" } }));
    const l = m.regras.listar();
    expect(l.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(l[0]).toMatchObject({ nome: "mudou", agrupamento: { modo: "digest", hora_digest: "18:00" }, filtros: { severidade_min: "aviso" } });
    expect(l[1]).toMatchObject({ ativa: false, chat_ref: "chat:9", origem: "pedido_remoto", tipos: ["tarefa_atrasada"] });
    expect(m.regras.apagar("r1")).toBe(true);
    expect(m.regras.apagar("r1")).toBe(false);
  });

  it("canais: gravar/obter/listar com consentimento", () => {
    const m = criar();
    const cons = { versao_texto: "tg-1", hash_texto: "h", aceito_em: iso(0), host: "api.telegram.org", itens_enviados: ["tarefa_concluida"] };
    m.canais.gravar(canal("c1", { consentimento: cons, entrada_ligada: true }));
    m.canais.gravar(canal("c2", { tipo: "so", nome: "SO", estado: "desligado", saida_ligada: false }));
    m.canais.gravar(canal("c1", { consentimento: cons, estado: "erro", erro_codigo: "token_invalido" }));
    expect(m.canais.listar().map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(m.canais.obter("c1")).toMatchObject({ estado: "erro", consentimento: cons, erro_codigo: "token_invalido", saida_ligada: true, entrada_ligada: false });
    expect(m.canais.obter("zz")).toBeNull();
  });

  it("tempo: gravar é upsert por janela; abertas e concluídas", () => {
    const m = criar();
    const r = (task: string, fim: string | null, ativo: number): RegistroTempo => ({ workspace_id: "ws1", trabalho_id: "t1", task_id: task, inicio: iso(0), fim, ativo_ms: ativo, aguardando_ms: 5, estado_atual: "trabalhando", estado_desde: iso(0), pane_id: "pane_1", alertou_atraso: 0 });
    m.tempo.gravar(r("T1", null, 10));
    m.tempo.gravar(r("T1", null, 20));
    m.tempo.gravar(r("T2", iso(10), 30));
    m.tempo.gravar({ ...r("T3", iso(20), 40), alertou_atraso: 2 });
    expect(m.tempo.abertas()).toEqual([r("T1", null, 20)]);
    expect(m.tempo.concluidas("ws1", 10).map((x) => x.task_id)).toEqual(["T2", "T3"]);
    expect(m.tempo.concluidas("ws1", 1).map((x) => [x.task_id, x.alertou_atraso])).toEqual([["T3", 2]]);
    expect(m.tempo.concluidas("outro", 10)).toEqual([]);
  });

  it("modelos: gravar, listar, corpos, restaurar", () => {
    const m = criar();
    m.modelos.gravar({ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "A {{titulo}}" });
    m.modelos.gravar({ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "B {{titulo}}" });
    m.modelos.gravar({ tipo: "erro_sistema", canal_tipo: "so", nivel: "padrao", corpo: "C" });
    expect(m.modelos.listar().map((x) => x.corpo)).toEqual(["C", "B {{titulo}}"]);
    expect(m.modelos.listar().every((x) => x.editado)).toBe(true);
    expect(m.modelos.corpos().get("tarefa_concluida|telegram|minimo")).toBe("B {{titulo}}");
    m.modelos.restaurar("tarefa_concluida", "telegram", "minimo");
    expect([...m.modelos.corpos().keys()]).toEqual(["erro_sistema|so|padrao"]);
  });
});

// ---------------------------------------------------------------------------------------------------- Telegram
const ent = (id: string, update_id: number, o: Partial<EntradaRow> = {}): EntradaRow => ({
  id, canal_id: "c1", autorizado_id: "aut1", update_id, texto_redigido: "oi", tamanho_original: 2, comando: null, intencao: null, plano_id: null, workspace_id: null, estado: "recebida", motivo: null,
  args_hash: null, mission_id: null, resultado_resumo: null, aprovado_em: null, aprovado_por: null, criado_em: iso(0), atualizado_em: iso(0), ...o,
});
const apr = (nonce: string, o: Partial<AprovacaoRow> = {}): AprovacaoRow => ({ nonce_hash: nonce, mensagem_entrada_id: "me1", acao: "aprovar", plano_id: "pl1", args_hash: "h", chat_id: 7, message_id: null, user_id: 7, estado: "pendente", expira_em: iso(10), usado_em: null, ...o });
const aut = (id: string, user: number, o: Record<string, unknown> = {}) => ({ id, canal_id: "c1", user_id: user, chat_id: user, nome_exibicao: `n${user}`, modo_padrao: "aprovar" as const, texto_livre: true, pin_hash: null, criado_em: iso(0), ultimo_uso_em: iso(0), expira_em: iso(1000), revogado_em: null, ...o });

describe.each(MUNDOS)("contrato do repositório do Telegram (%s)", (_n, criar) => {
  function base(): Mundo {
    const m = criar();
    m.canais.gravar(canal());
    m.tg.inserirEntrada(ent("me1", 1, { plano_id: "pl1" }));
    return m;
  }

  it("estado: vazio por padrão, patch parcial, booleano", () => {
    const m = base();
    expect(m.tg.estado("c1")).toMatchObject({ proximo_offset: null, conflitos_seguidos: 0, descarte_inicial_feito: false });
    m.tg.salvarEstado("c1", { proximo_offset: 10, bot_username: "meu_bot" });
    m.tg.salvarEstado("c1", { descarte_inicial_feito: true, conflitos_seguidos: 2 });
    expect(m.tg.estado("c1")).toMatchObject({ proximo_offset: 10, bot_username: "meu_bot", descarte_inicial_feito: true, conflitos_seguidos: 2 });
  });

  it("updates vistos: marcar, consultar e retenção", () => {
    const m = base();
    expect(m.tg.updateVisto(5)).toBe(false);
    m.tg.marcarVisto(5, iso(0));
    m.tg.marcarVisto(6, iso(100));
    expect(m.tg.updateVisto(5)).toBe(true);
    expect(m.tg.apagarVistosAntesDe(iso(50))).toBe(1);
    expect(m.tg.updateVisto(5)).toBe(false);
  });

  it("autorizados: UNIQUE(canal,user) substitui; revogação; workspaces", () => {
    const m = base();
    m.tg.gravarAutorizado(aut("aut1", 7));
    m.tg.gravarAutorizado(aut("aut9", 7, { nome_exibicao: "novo" }));
    expect(m.tg.listarAutorizados("c1").map((a) => a.id)).toEqual(["aut9"]);
    expect(m.tg.autorizadoPorUser("c1", 7)?.nome_exibicao).toBe("novo");
    expect(m.tg.autorizadoPorId("aut9")?.texto_livre).toBe(true);
    m.tg.gravarAutorizado(aut("aut2", 8, { pin_hash: "scrypt$1$s$h" }));
    m.tg.gravarWorkspaces("aut2", [{ autorizado_id: "x", workspace_id: "ws1", modo: "aprovar", padrao: true }, { autorizado_id: "x", workspace_id: "ws2", modo: "consulta", padrao: false }]);
    m.tg.gravarWorkspaces("aut2", [{ autorizado_id: "x", workspace_id: "ws1", modo: "direto", padrao: true }]);
    expect(m.tg.workspaces("aut2")).toEqual([{ autorizado_id: "aut2", workspace_id: "ws1", modo: "direto", padrao: true }]);
    expect(m.tg.revogarAutorizado("aut2", iso(1))).toBe(true);
    expect(m.tg.revogarAutorizado("aut2", iso(2))).toBe(false);
    expect(m.tg.autorizadoPorId("aut2")?.revogado_em).toBe(iso(1));
    expect(m.tg.revogarTodos("c1", iso(3))).toBe(1);
  });

  it("não autorizados: upsert, bloqueio e teto de 500 (descarta os mais antigos não bloqueados)", () => {
    const m = base();
    m.tg.gravarNaoAutorizado({ user_id: 1, primeiro_em: iso(0), ultimo_em: iso(0), contagem: 1, bloqueado: true });
    for (let i = 2; i <= 502; i++) m.tg.gravarNaoAutorizado({ user_id: i, primeiro_em: iso(0), ultimo_em: iso(i), contagem: 1, bloqueado: false });
    const l = m.tg.listarNaoAutorizados();
    expect(l).toHaveLength(500);
    expect(m.tg.naoAutorizado(1)?.bloqueado).toBe(true);
    expect(m.tg.naoAutorizado(2)).toBeNull();
    expect(m.tg.naoAutorizado(3)).toBeNull();
    expect(m.tg.naoAutorizado(502)).not.toBeNull();
    m.tg.gravarNaoAutorizado({ user_id: 502, primeiro_em: iso(0), ultimo_em: iso(999), contagem: 4, bloqueado: false });
    expect(m.tg.naoAutorizado(502)?.contagem).toBe(4);
  });

  it("entradas: UNIQUE(canal, update_id), atualizar, consultas por estado/plano/hash", () => {
    const m = base();
    expect(m.tg.inserirEntrada(ent("me2", 1))).toBe(false);
    expect(m.tg.inserirEntrada(ent("me2", 2, { texto_hash: "H", edicoes: 1, estado: "plano_enviado", plano_id: "pl2" }))).toBe(true);
    expect(m.tg.entradaPorUpdate("c1", 2)?.id).toBe("me2");
    expect(m.tg.entrada("me2")).toMatchObject({ texto_hash: "H", edicoes: 1 });
    m.tg.atualizarEntrada("me2", { estado: "aprovada", aprovado_por: "telegram:7", aprovado_em: iso(2), edicoes: 2 });
    expect(m.tg.entrada("me2")).toMatchObject({ estado: "aprovada", aprovado_por: "telegram:7", edicoes: 2 });
    expect(m.tg.entradasDoAutorizado("aut1", ["aprovada"]).map((e) => e.id)).toEqual(["me2"]);
    expect(m.tg.entradasDoAutorizado("aut1", ["recebida", "aprovada"]).map((e) => e.id).sort()).toEqual(["me1", "me2"]);
    expect(m.tg.entradaPorPlano("pl2")?.id).toBe("me2");
    expect(m.tg.entradaPorPlano("nenhum")).toBeNull();
    expect(m.tg.entradaRecentePorHash("aut1", "H", iso(-1))?.id).toBe("me2");
    expect(m.tg.entradaRecentePorHash("aut1", "H", iso(5))).toBeNull();
  });

  it("retenção de entradas (30 d): apaga mensagem_entrada antiga + nonces em cascata e desconhecidos antigos não bloqueados (auditoria B4)", () => {
    const m = base();
    expect(m.tg.inserirEntrada(ent("me_velha", 90, { criado_em: iso(-100) }))).toBe(true);
    m.tg.inserirAprovacao({ nonce_hash: "nh_velho", mensagem_entrada_id: "me_velha", acao: "aprovar", plano_id: "plv", args_hash: "h", chat_id: 5, message_id: null, user_id: 5, estado: "pendente", expira_em: iso(1000), usado_em: null });
    m.tg.gravarNaoAutorizado({ user_id: 901, primeiro_em: iso(-100), ultimo_em: iso(-100), contagem: 3, bloqueado: false });
    m.tg.gravarNaoAutorizado({ user_id: 902, primeiro_em: iso(-100), ultimo_em: iso(-100), contagem: 3, bloqueado: true });
    const n = m.tg.apagarEntradasAntesDe(iso(-50));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(m.tg.entrada("me_velha")).toBeNull();
    expect(m.tg.aprovacao("nh_velho")).toBeNull();
    expect(m.tg.naoAutorizado(901)).toBeNull();
    expect(m.tg.naoAutorizado(902)).not.toBeNull(); // bloqueado fica
    expect(m.tg.entrada("me1")).not.toBeNull(); // recente fica
  });

  it("aprovação: uso único, expirada vira 'expirado', anulações e message_id", () => {
    const m = base();
    m.tg.inserirAprovacao(apr("n1"));
    m.tg.inserirAprovacao(apr("n2", { acao: "cancelar" }));
    m.tg.inserirAprovacao(apr("n3", { expira_em: iso(-1) }));
    m.tg.definirMessageIdAprovacoes("me1", 99);
    expect(m.tg.aprovacao("n1")?.message_id).toBe(99);
    expect(m.tg.consumirAprovacao("n1", iso(1))).toMatchObject({ nonce_hash: "n1", estado: "usado", usado_em: iso(1) });
    expect(m.tg.consumirAprovacao("n1", iso(1))).toBeNull();
    expect(m.tg.consumirAprovacao("n3", iso(1))).toBeNull();
    expect(m.tg.aprovacao("n3")?.estado).toBe("expirado");
    expect(m.tg.consumirAprovacaoPorPlano("pl1", "cancelar", iso(1))?.nonce_hash).toBe("n2");
    expect(m.tg.consumirAprovacaoPorPlano("pl1", "cancelar", iso(1))).toBeNull();
    m.tg.inserirAprovacao(apr("n4", { acao: "ws", extra: "ws1" }));
    m.tg.inserirAprovacao(apr("n5", { acao: "gate_aprovar", plano_id: "pl9", user_id: 8 }));
    expect(m.tg.aprovacao("n4")?.extra).toBe("ws1");
    expect(m.tg.anularAprovacoesPorPlano("pl9")).toBe(1);
    expect(m.tg.anularAprovacoesDoUsuario(7)).toBe(1);
    expect(m.tg.consumirAprovacao("n4", iso(1))).toBeNull();
    m.tg.inserirAprovacao(apr("n6"));
    expect(m.tg.anularTodasAprovacoes("c1")).toBe(1);
  });

  it("50 consumos concorrentes do mesmo nonce => 1 vencedor", async () => {
    const m = base();
    m.tg.inserirAprovacao(apr("nx"));
    m.tg.inserirAprovacao(apr("ny", { acao: "editar" }));
    const r = await Promise.all(Array.from({ length: 50 }, async (_, i) => (i % 2 === 0 ? m.tg.consumirAprovacao("nx", iso(1)) : m.tg.consumirAprovacaoPorPlano("pl1", "editar", iso(1)))));
    expect(r.filter((x) => x !== null && x.nonce_hash === "nx")).toHaveLength(1);
    expect(r.filter((x) => x !== null && x.nonce_hash === "ny")).toHaveLength(1);
  });

  it("auditoria: ordem desc, cursor por ts, detalhe JSON e retenção", () => {
    const m = base();
    for (let i = 1; i <= 4; i++) m.tg.inserirAuditoria({ id: `au${i}`, ts: iso(i), canal_id: "c1", evento: "pedido_recebido", user_id: 7, workspace_id: null, plano_id: null, mensagem_entrada_id: null, args_hash: null, resultado: "ok", detalhe: { n: i } });
    expect(m.tg.listarAuditoria("c1", null, 2).map((a) => a.id)).toEqual(["au4", "au3"]);
    expect(m.tg.listarAuditoria("c1", iso(3), 10).map((a) => a.id)).toEqual(["au2", "au1"]);
    expect(m.tg.listarAuditoria("c1", null, 1)[0]?.detalhe).toEqual({ n: 4 });
    expect(m.tg.apagarAuditoriaAntesDe(iso(3))).toBe(2);
  });

  it("transacao devolve o valor de fn", () => {
    const m = base();
    expect(m.tg.transacao(() => 42)).toBe(42);
  });
});

describe("transação SQL de verdade", () => {
  it("erro dentro de transacao desfaz a escrita do offset e do update visto", () => {
    const m = sql();
    m.canais.gravar(canal());
    expect(() =>
      m.tg.transacao(() => {
        m.tg.salvarEstado("c1", { proximo_offset: 99 });
        m.tg.marcarVisto(1, iso(0));
        throw new Error("queda");
      }),
    ).toThrow("queda");
    expect(m.tg.estado("c1").proximo_offset).toBeNull();
    expect(m.tg.updateVisto(1)).toBe(false);
  });

  it("apagar uma regra preserva o histórico de entregas sem colidir com a idempotência", () => {
    const m = sql();
    m.canais.gravar(canal());
    m.regras.gravar(regra("r1"));
    m.alertas.inserir(alerta("a1", 1));
    m.entregas.inserir(entrega("e1", "a1", "r1"));
    m.entregas.inserir(entrega("e2", "a1", null));
    expect(m.regras.apagar("r1")).toBe(true);
    expect(m.entregas.obter("e1")).toBeNull();
    expect(m.entregas.obter("e2")).not.toBeNull();
    m.regras.gravar(regra("r2"));
    m.entregas.inserir(entrega("e3", "a1", "r2"));
    expect(m.regras.apagar("r2")).toBe(true);
    expect(m.entregas.obter("e3")?.regra_id ?? null).toBeNull();
  });

  it("nenhuma coluna guarda token nem PIN em claro; config do canal é JSON sem segredo", () => {
    const m = sql();
    const cols = (m.banco as Banco).consultar<{ t: string; name: string }>("SELECT m.name AS t, p.name FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table' AND (m.name LIKE 'telegram_%' OR m.name IN ('canal','alerta','alerta_regra','alerta_entrega','alerta_template','mensagem_entrada','tarefa_tempo'))");
    const suspeitas = cols.filter((c) => /token|pin|senha|secret|segredo|^chave$/i.test(c.name)).map((c) => `${c.t}.${c.name}`);
    expect(suspeitas).toEqual(["telegram_autorizado.pin_hash"]);
    const c = criarRepoCanaisSql(m.banco as Banco);
    c.gravar(canal());
    c.gravarConfig("c1", { rajada_msg: 5 });
    expect(c.config("c1")).toEqual({ rajada_msg: 5 });
    expect(c.config("nenhum")).toEqual({});
    expect(c.remover("c1")).toBe(true);
  });

  it("P-147: página de 100 000 alertas em <= 5 ms (mediana)", () => {
    const m = sql();
    const b = m.banco as Banco;
    b.transacao((x) => {
      const st = x.preparar("INSERT INTO alerta (id,tipo,severidade,fonte,titulo,dados_json,dedupe_chave,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)");
      for (let i = 0; i < 100_000; i++) st.executar([`alt_${String(i).padStart(7, "0")}`, "tarefa_concluida", "info", "metodo", `t${i}`, "{}", `k${i}`, new Date(T0 + i * 1000).toISOString(), new Date(T0 + i * 1000).toISOString()]);
    });
    const tempos: number[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 25; i++) {
      const t0 = performance.now();
      const p = m.alertas.listar({ limite: 50, depois_id: cursor });
      tempos.push(performance.now() - t0);
      cursor = p.proximo;
    }
    const t1 = performance.now();
    m.alertas.contar();
    m.alertas.listar({ estado: "nao_lidos", limite: 50 });
    const nl = performance.now() - t1;
    tempos.sort((a, c) => a - c);
    const fator = Number(process.env["EXPXV_PERF_FATOR"] ?? "1");
    expect(tempos[Math.floor(tempos.length / 2)] as number).toBeLessThan(5 * fator);
    expect(nl).toBeLessThan(50 * fator + 100);
  });
});
