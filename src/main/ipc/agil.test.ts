// Canais `agil:*`: contrato fechado (todo canal do contrato tem validador e manipulador), payload estrito, tradução de erro e ligação ao serviço.
import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { ErroAgil } from "../../nucleo/agil/erros";
import type { ServicoAgil } from "../agil";
import { VALIDADORES_AGIL, paraErroIpc, registrarIpcAgil } from "./agil";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_AAAAAAAAAAAA";
const IT = "it_0abcdefghi00000";
const SP = "spr_0abcdefghi00000";
const EP = "epi_0abcdefghi00000";
const MB = "mbr_0abcdefghi00000";
const CE = "cer_0abcdefghi00000";
const AC = "rta_0abcdefghi00000";
const RI = "rti_0abcdefghi00000";
const EV = "rtb_0abcdefghi00000";

const canaisAgil = CANAIS_INVOKE.filter((c) => c.startsWith("agil:"));

function montar(servico: Partial<Record<keyof ServicoAgil, unknown>> = {}) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
  const chamadas: { metodo: string; args: unknown[] }[] = [];
  const falso = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      const f = servico[nome as keyof ServicoAgil];
      return typeof f === "function" ? (f as (...a: unknown[]) => unknown)(...args) : { ok: true };
    },
  }) as unknown as ServicoAgil;
  const avisos: string[] = [];
  registrarIpcAgil({ registro, servico: () => falso, aviso: (m) => avisos.push(m) });
  const chamar = (canal: string, payload: unknown): unknown => (handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload);
  return { registro, handlers, chamar, chamadas, avisos };
}

describe("contrato dos canais agil:*", () => {
  it("todo canal do contrato tem validador e manipulador (e nada além)", () => {
    const m = montar();
    expect(canaisAgil.length).toBeGreaterThanOrEqual(45);
    expect(Object.keys(VALIDADORES_AGIL).sort()).toEqual([...canaisAgil].sort());
    expect(m.registro.registrados().filter((c) => c.startsWith("agil:")).sort()).toEqual([...canaisAgil].sort());
  });

  const validos: [string, Record<string, unknown>, string][] = [
    ["agil:estado", { workspace_id: WS }, "estado"],
    ["agil:config_ler", { workspace_id: WS }, "configLer"],
    ["agil:config_gravar", { workspace_id: WS, config: { janela_retrabalho_dias: 7, feriados: ["2027-12-25"] } }, "configGravar"],
    ["agil:consentimento_ia", { workspace_id: WS, consentido: true }, "consentimentoIa"],
    ["agil:sincronizar", { workspace_id: WS }, "sincronizar"],
    ["agil:membro_listar", { workspace_id: WS }, "membroListar"],
    ["agil:membro_gravar", { workspace_id: WS, membro: { tipo: "agente", rotulo: "Impl", aliases: [{ tipo: "agente", valor: "impl-1" }] } }, "membroGravar"],
    ["agil:backlog_listar", { workspace_id: WS, filtros: { texto: "x", risco: "alto" }, ordenar: "wsjf", cursor: "200", limite: 50 }, "backlogListar"],
    ["agil:item_ler", { workspace_id: WS, item_id: IT }, "itemLer"],
    ["agil:item_criar", { workspace_id: WS, item: { titulo: "Novo", criterios: ["a"], epico_id: EP } }, "itemCriar"],
    ["agil:item_atualizar", { workspace_id: WS, item_id: IT, campos: { valor: 5, moscow: "must", resumo_cliente: null } }, "itemAtualizar"],
    ["agil:item_descartar", { workspace_id: WS, item_id: IT, motivo: "duplicado" }, "itemDescartar"],
    ["agil:item_reordenar", { workspace_id: WS, item_id: IT, antes_id: null }, "itemReordenar"],
    ["agil:item_promover", { workspace_id: WS, item_id: IT, destino: "runx" }, "itemPromover"],
    ["agil:item_vincular", { workspace_id: WS, item_id: IT, trabalho_id: "feat-01", task_ref: "T-01.01" }, "itemVincular"],
    ["agil:epico_listar", { workspace_id: WS }, "epicoListar"],
    ["agil:epico_gravar", { workspace_id: WS, titulo: "Épico" }, "epicoGravar"],
    ["agil:epico_apagar", { workspace_id: WS, epico_id: EP }, "epicoApagar"],
    ["agil:estimar", { workspace_id: WS, item_ids: "sem_estimativa" }, "estimar"],
    ["agil:estimativa_gravar", { workspace_id: WS, item_id: IT, pontos: 5, estado: "travada" }, "estimativaGravar"],
    ["agil:classificacao_gravar", { workspace_id: WS, item_id: IT, risco: "alto" }, "classificacaoGravar"],
    ["agil:estimativa_aceitar_lote", { workspace_id: WS, item_ids: [IT], confianca_min: 0.7 }, "estimativaAceitarLote"],
    ["agil:sprint_listar", { workspace_id: WS }, "sprintListar"],
    ["agil:sprint_criar", { workspace_id: WS, sprint: { nome: "S1", inicio: "2027-12-01", fim: "2027-12-12" } }, "sprintCriar"],
    ["agil:sprint_atualizar", { workspace_id: WS, sprint_id: SP, campos: { meta: "meta" } }, "sprintAtualizar"],
    ["agil:sprint_iniciar", { workspace_id: WS, sprint_id: SP }, "sprintIniciar"],
    ["agil:sprint_cancelar", { workspace_id: WS, sprint_id: SP }, "sprintCancelar"],
    ["agil:sprint_item_mover", { workspace_id: WS, sprint_id: SP, item_id: IT, acao: "remover", motivo: "mudou" }, "sprintItemMover"],
    ["agil:sprint_fechar", { workspace_id: WS, sprint_id: SP, destino_pendentes: "proxima", versao_lancamento: "1.0.0" }, "sprintFechar"],
    ["agil:capacidade_ler", { workspace_id: WS, sprint_id: SP }, "capacidadeLer"],
    ["agil:capacidade_gravar", { workspace_id: WS, sprint_id: SP, membro_id: MB, ausencias_dias: 2 }, "capacidadeGravar"],
    ["agil:planejamento_sugerir", { workspace_id: WS, sprint_id: SP, buffer: 0.2 }, "planejamentoSugerir"],
    ["agil:daily_gerar", { workspace_id: WS }, "dailyGerar"],
    ["agil:daily_salvar", { workspace_id: WS, cerimonia_id: CE, observacoes: [{ ref: "feat-01/T-01.01", observacao: "ok" }] }, "dailySalvar"],
    ["agil:review_ler", { workspace_id: WS, sprint_id: SP }, "reviewLer"],
    ["agil:review_gravar", { workspace_id: WS, sprint_id: SP, item_id: IT, resultado: "ajustar", devolver: true }, "reviewGravar"],
    ["agil:retro_ler", { workspace_id: WS, sprint_id: SP }, "retroLer"],
    ["agil:retro_item_gravar", { workspace_id: WS, cerimonia_id: CE, item_id: RI, voto: 1 }, "retroItemGravar"],
    ["agil:retro_acao_gravar", { workspace_id: WS, cerimonia_id: CE, texto: "Fazer", prazo: "2027-12-20" }, "retroAcaoGravar"],
    ["agil:retro_acao_para_item", { workspace_id: WS, acao_id: AC }, "retroAcaoParaItem"],
    ["agil:retrabalho_listar", { workspace_id: WS, limite: 20 }, "retrabalhoListar"],
    ["agil:retrabalho_marcar", { workspace_id: WS, trabalho_id: "feat-01", task_ref: "T-01.01", acao: "confirmar", evento_id: EV, motivo: "confirmado em revisão" }, "retrabalhoMarcar"],
    ["agil:painel", { workspace_id: WS, filtros: { sprint_id: SP, de: "2027-01-01" } }, "painel"],
    ["agil:previsao", { workspace_id: WS, iteracoes: 1000 }, "previsao"],
    ["agil:praticas", { workspace_id: WS, sprint_id: null }, "praticas"],
    ["agil:checklist_gravar", { workspace_id: WS, sprint_id: SP, codigo: "xp.par", estado: "ok" }, "checklistGravar"],
    ["agil:exportar", { workspace_id: WS, tipo: "backlog", formato: "csv" }, "exportar"],
  ];

  it("cada canal com payload válido chega ao método certo do serviço (tabela completa)", async () => {
    expect(validos.map((v) => v[0]).sort()).toEqual([...canaisAgil].sort());
    for (const [canal, payload, metodo] of validos) {
      const m = montar();
      await m.chamar(canal, payload);
      expect(m.chamadas.map((c) => c.metodo), canal).toEqual([metodo]);
      expect(m.chamadas[0]?.args[0], canal).toBe(WS);
    }
  });

  it("payload inválido é recusado antes do manipulador (campo extra, ausente, id malformado, workspace de outro formato)", async () => {
    for (const [canal, payload] of validos) {
      const v = VALIDADORES_AGIL[canal as keyof typeof VALIDADORES_AGIL];
      expect(v({ ...payload, extra: 1 }).ok, `${canal} campo extra`).toBe(false);
      expect(v({ ...payload, workspace_id: "../../etc" }).ok, `${canal} workspace inválido`).toBe(false);
      const { workspace_id: _w, ...semWs } = payload;
      void _w;
      expect(v(semWs).ok, `${canal} sem workspace`).toBe(false);
      expect(v(null).ok).toBe(false);
      expect(v([payload]).ok).toBe(false);
      expect(v("texto").ok).toBe(false);
      // `ator`, `caminho`, `userData` e afins nunca passam
      for (const k of ["ator", "caminho", "path", "cwd", "userData", "arquivo"]) expect(v({ ...payload, [k]: "x" }).ok, `${canal} ${k}`).toBe(false);
    }
  });

  it("valores fora da faixa e ids de outro tipo são recusados", () => {
    const V = VALIDADORES_AGIL;
    expect(V["agil:item_ler"]({ workspace_id: WS, item_id: SP }).ok).toBe(false); // id de sprint não é id de item
    expect(V["agil:item_ler"]({ workspace_id: WS, item_id: "../../x" }).ok).toBe(false);
    expect(V["agil:item_atualizar"]({ workspace_id: WS, item_id: IT, campos: { valor: 11 } }).ok).toBe(false);
    expect(V["agil:item_atualizar"]({ workspace_id: WS, item_id: IT, campos: { origem: "metodo" } }).ok).toBe(false);
    expect(V["agil:item_atualizar"]({ workspace_id: WS, item_id: IT, campos: { resumo_cliente_origem: "ia" } }).ok).toBe(false);
    expect(V["agil:item_criar"]({ workspace_id: WS, item: { titulo: "" } }).ok).toBe(false);
    expect(V["agil:item_criar"]({ workspace_id: WS, item: { titulo: "x".repeat(301) } }).ok).toBe(false);
    expect(V["agil:item_criar"]({ workspace_id: WS, item: { titulo: "x", origem: "metodo" } }).ok).toBe(false);
    expect(V["agil:estimar"]({ workspace_id: WS, item_ids: Array.from({ length: 501 }, () => IT) }).ok).toBe(false);
    expect(V["agil:estimativa_gravar"]({ workspace_id: WS, item_id: IT, pontos: -1 }).ok).toBe(false);
    expect(V["agil:estimativa_gravar"]({ workspace_id: WS, item_id: IT, pontos: Number.NaN }).ok).toBe(false);
    expect(V["agil:estimativa_gravar"]({ workspace_id: WS, item_id: IT, pontos: 5, estado: "sugerida" }).ok).toBe(false); // sugerida não é decisão humana
    expect(V["agil:sprint_criar"]({ workspace_id: WS, sprint: { nome: "S", inicio: "2027-13-40", fim: "2027-12-12" } }).ok).toBe(false);
    expect(V["agil:sprint_criar"]({ workspace_id: WS, sprint: { nome: "S", inicio: "01/12/2027", fim: "2027-12-12" } }).ok).toBe(false);
    expect(V["agil:retrabalho_marcar"]({ workspace_id: WS, trabalho_id: "feat-01", task_ref: "T-01.01", acao: "marcar_retrabalho", motivo: "curt" }).ok).toBe(false);
    expect(V["agil:retrabalho_marcar"]({ workspace_id: WS, trabalho_id: "../x", task_ref: "T-01.01", acao: "marcar_retrabalho", motivo: "motivo ok" }).ok).toBe(false);
    expect(V["agil:retrabalho_marcar"]({ workspace_id: WS, trabalho_id: "feat-01", task_ref: "T-01.01", acao: "apagar_tudo", motivo: "motivo ok" }).ok).toBe(false);
    expect(V["agil:previsao"]({ workspace_id: WS, iteracoes: 1_000_000 }).ok).toBe(false);
    expect(V["agil:painel"]({ workspace_id: WS, filtros: { de: "ontem" } }).ok).toBe(false);
    expect(V["agil:backlog_listar"]({ workspace_id: WS, limite: 201 }).ok).toBe(false);
    expect(V["agil:backlog_listar"]({ workspace_id: WS, cursor: "-1" }).ok).toBe(false);
    expect(V["agil:item_vincular"]({ workspace_id: WS, item_id: IT, trabalho_id: "/etc/passwd" }).ok).toBe(false);
    expect(V["agil:membro_gravar"]({ workspace_id: WS, membro: { tipo: "humano", rotulo: "A", fator_foco: 2 } }).ok).toBe(false);
    expect(V["agil:capacidade_gravar"]({ workspace_id: WS, sprint_id: SP, membro_id: MB, ausencias_dias: -1 }).ok).toBe(false);
    expect(V["agil:exportar"]({ workspace_id: WS, tipo: "tudo", formato: "csv" }).ok).toBe(false);
    expect(V["agil:exportar"]({ workspace_id: WS, tipo: "backlog", formato: "csv", caminho: "/tmp/x" }).ok).toBe(false);
    expect(V["agil:retro_item_gravar"]({ workspace_id: WS, cerimonia_id: CE, item_id: RI, voto: 5 }).ok).toBe(false);
  });

  it("a configuração nunca aceita caminho absoluto, URL, chave desconhecida nem objeto enorme", () => {
    const V = VALIDADORES_AGIL["agil:config_gravar"];
    expect(V({ workspace_id: WS, config: { padroes_teste: ["**/*.test.ts"] } }).ok).toBe(true);
    expect(V({ workspace_id: WS, config: { padroes_teste: ["/etc/passwd"] } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { padroes_teste: ["C:\\Users\\x"] } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { padroes_teste: ["~/segredo"] } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { categorias: ["https://evil.example/x"] } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { categorias: ["a\u0000b"] } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { propriedade_nova: 1 } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { __proto__: { x: 1 }, categorias: ["a"] } }).ok).toBe(true); // `__proto__` literal vira propriedade própria vazia: ignorado pelo JSON
    expect(V({ workspace_id: WS, config: { feriados: Array.from({ length: 5000 }, () => "2027-01-01") } }).ok).toBe(false);
    expect(V({ workspace_id: WS, config: { categorias: [] } , x: 1 } as never).ok).toBe(false);
  });
});

describe("tradução de erro e segurança do canal", () => {
  it("ErroAgil vira `[codigo/subcodigo] mensagem`; erro desconhecido vira texto genérico sem vazar detalhe", async () => {
    const m = montar({
      sprintIniciar: () => { throw new ErroAgil("rule_violation", "ação reservada a humano: sprint.iniciar", "human_only"); },
      estado: () => { throw new Error("SQLITE_ERROR: no such table agil_item at /Users/x/app.db token=sk-abc"); },
      configLer: () => { throw new ErroAgil("not_found", "workspace não encontrado"); },
    });
    await expect(m.chamar("agil:sprint_iniciar", { workspace_id: WS, sprint_id: SP })).rejects.toThrow("[rule_violation/human_only] ação reservada a humano: sprint.iniciar");
    await expect(m.chamar("agil:config_ler", { workspace_id: WS })).rejects.toThrow("[not_found] workspace não encontrado");
    await expect(m.chamar("agil:estado", { workspace_id: WS })).rejects.toThrow("[unavailable] Falha interna na gestão ágil.");
    expect(m.avisos.join(" ")).toContain("SQLITE_ERROR"); // o detalhe vai para o log do main, nunca para o renderer
    expect(paraErroIpc(new Error("x /Users/a/segredo")).message).not.toContain("/Users");
  });

  it("o serviço nasce na primeira chamada (nada no boot) e remetente não autorizado é recusado antes do manipulador", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    let autorizado = false;
    const registro = criarRegistroIpc({ ipcMain, autorizar: () => autorizado });
    const criar = vi.fn(() => ({ estado: async () => ({}) }) as unknown as ServicoAgil);
    registrarIpcAgil({ registro, servico: criar });
    expect(criar).not.toHaveBeenCalled();
    await expect((handlers.get("agil:estado") as (e: unknown, p: unknown) => unknown)({}, { workspace_id: WS })).rejects.toThrow(/não autorizado/);
    expect(criar).not.toHaveBeenCalled();
    autorizado = true;
    await (handlers.get("agil:estado") as (e: unknown, p: unknown) => unknown)({}, { workspace_id: WS });
    expect(criar).toHaveBeenCalledTimes(1);
  });
});
