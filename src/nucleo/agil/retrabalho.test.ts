import { describe, expect, it } from "vitest";
import { ev } from "../../../tests/fixtures/metodo/construtores";
import { cfg, fato, novoAgil } from "../../../tests/fixtures/agil/ajudas";
import { detectarCommitFix, detectarQaReprovado, detectarRegraRepetida, detectarRegressao, detectarTaskReaberta, detectarTudo } from "./retrabalho/detectores";
import { naturezaDeAchadoQa, naturezaDeCommit, naturezaDeOcorrencia } from "./retrabalho/natureza";
import { janelaRetrabalho } from "./retrabalho/janela";
import { marcaManualVigente, situacaoDaTask, type ContextoSituacao } from "./retrabalho/estado";
import { agruparRetrabalho, resumirRetrabalho, type LinhaRetrabalho } from "./retrabalho/agregar";
import { marcarRetrabalho, registrarDeteccoes } from "./retrabalho/marcar";
import { atribuirAchado } from "./retrabalho/atribuicao";
import type { EventoRetrabalho } from "../../compartilhado/agil";
import type { QaFonte } from "./portas";

const R = cfg().natureza;
const DIA = 86_400_000;

describe("natureza e ruído (T-18.20)", () => {
  it("commits: tabela (prefixo convencional, palavras, rótulos, ambíguo)", () => {
    const t: [string, string[], string][] = [
      ["feat(T-03.04): novo campo", [], "escopo"],
      ["docs: atualiza readme", [], "ruido"],
      ["chore: bump deps", [], "ruido"],
      ["fix(T-01.01): corrige validação", [], "defeito"],
      ["fix: typo no texto", [], "ruido"],
      ["Corrige o cálculo do total", [], "defeito"],
      ["revert: volta mudança", [], "defeito"],
      ["ajustes", [], "pendente"],
      ["mexe no serviço", [], "pendente"],
      ["ajustes", ["bug"], "defeito"],
      ["ajustes", ["enhancement"], "escopo"],
      ["corrige formatação do arquivo", [], "ruido"],
      ["Mudança de requisito: nova regra", [], "escopo"],
    ];
    for (const [msg, labels, esperado] of t) expect(naturezaDeCommit(msg, labels, R), msg).toBe(esperado);
  });
  it("regra configurável", () => {
    const regras = { ...R, prefixos_ruido: [...R.prefixos_ruido, "wip"], palavras_defeito: [...R.palavras_defeito, "arruma"] };
    expect(naturezaDeCommit("wip: algo", [], regras)).toBe("ruido");
    expect(naturezaDeCommit("arruma o botão", [], regras)).toBe("defeito");
    expect(naturezaDeCommit("arruma o botão", [], R)).toBe("pendente");
  });
  it("achado de QA e ocorrência", () => {
    expect(naturezaDeAchadoQa(null)).toBe("defeito");
    expect(naturezaDeAchadoQa("sugestão")).toBe("escopo");
    expect(naturezaDeAchadoQa("estilo")).toBe("ruido");
    expect(naturezaDeOcorrencia("bug")).toBe("defeito");
    expect(naturezaDeOcorrencia("melhoria")).toBe("escopo");
    expect(naturezaDeOcorrencia("outro")).toBe("pendente");
  });
});

describe("detectores por fonte (T-18.19): verdadeiro, falso e ambíguo", () => {
  const f = fato({ task_ref: "T-01.02", status_visto: "concluida", concluida_em: "2026-03-05T12:00:00.000Z", arquivos: ["src/a.ts"] });
  const commit = (mensagem: string, ts: string | null, sha: string | null = "s1") => ({ sha, mensagem, ts, linhas: 1, labels: [] as string[] });

  it("QA reprovado: alta/média ligada à task = forte/defeito; baixa não conta; sem atribuição = pendente do trabalho", () => {
    const qa: QaFonte = { veredito: "reprovado", emitido_em: "2026-03-06T00:00:00Z", achados: [
      { id: "1", severidade: "alta", categoria: null, task: "T-01.02", arquivos: [], descricao: "x" },
      { id: "2", severidade: "baixa", categoria: null, task: "T-01.02", arquivos: [], descricao: "x" },
      { id: "3", severidade: "media", categoria: null, task: null, arquivos: ["src/a.ts"], descricao: "x" },
      { id: "4", severidade: "alta", categoria: null, task: null, arquivos: [], descricao: "sem pista" },
      { id: "5", severidade: "alta", categoria: "sugestão", task: "T-01.02", arquivos: [], descricao: "x" },
    ] };
    const e = detectarQaReprovado("ws1", "tr1", qa, [f]);
    expect(e.map((x) => [x.chave_dedupe, x.task_ref, x.natureza, x.forca])).toEqual([
      ["qa:tr1:T-01.02:1", "T-01.02", "defeito", "forte"],
      ["qa:tr1:T-01.02:3", "T-01.02", "defeito", "forte"],
      ["qa:tr1:-:4", null, "pendente", "forte"],
      ["qa:tr1:T-01.02:5", "T-01.02", "escopo", "forte"],
    ]);
    expect(detectarQaReprovado("ws1", "tr1", null, [f])).toEqual([]);
  });
  it("atribuição: citada > maior interseção de arquivos > só o trabalho; empate atribui às empatadas", () => {
    const tasks = [{ task_ref: "A", arquivos: ["x", "y"] }, { task_ref: "B", arquivos: ["y"] }, { task_ref: "C", arquivos: ["z"] }];
    const a = (task: string | null, arquivos: string[]) => ({ id: "1", severidade: "alta" as const, categoria: null, task, arquivos, descricao: "" });
    expect(atribuirAchado(a("c", []), tasks)).toEqual({ tasks: ["C"], metodo: "citada" });
    expect(atribuirAchado(a(null, ["x", "y"]), tasks)).toEqual({ tasks: ["A"], metodo: "arquivos" });
    expect(atribuirAchado(a(null, ["y"]), tasks)).toEqual({ tasks: ["A", "B"], metodo: "arquivos" });
    expect(atribuirAchado(a("Z", []), tasks)).toEqual({ tasks: [], metodo: "trabalho" });
  });
  it("task reaberta: uma por reabertura, chave estável; sem reabertura nada", () => {
    expect(detectarTaskReaberta(fato({ reabertas_em: ["2026-03-06T00:00:00.000Z", "2026-03-08T00:00:00.000Z"] })).map((x) => x.chave_dedupe)).toEqual(["reab:tr1:T-01.01:2026-03-06T00:00:00.000Z", "reab:tr1:T-01.01:2026-03-08T00:00:00.000Z"]);
    expect(detectarTaskReaberta(fato())).toEqual([]);
  });
  it("commit de correção: depois de concluida_em = evento; antes, sem ts, typo/doc e não-correção = não", () => {
    const c = (commits: ReturnType<typeof commit>[]) => detectarCommitFix({ ...f, commits }, { natureza: R });
    expect(c([commit("fix(T-01.02): corrige borda", "2026-03-06T10:00:00Z")]).map((e) => [e.natureza, e.chave_dedupe])).toEqual([["defeito", "fix:tr1:T-01.02:s1"]]);
    expect(c([commit("fix(T-01.02): corrige borda", "2026-03-04T10:00:00Z")])).toEqual([]); // antes de concluir
    expect(c([commit("fix(T-01.02): corrige borda", null)])).toEqual([]); // sem timestamp não dá para afirmar "depois"
    expect(c([commit("fix: typo no título", "2026-03-06T10:00:00Z")]).map((e) => e.natureza)).toEqual(["ruido"]);
    expect(c([commit("docs: atualiza guia", "2026-03-06T10:00:00Z")])).toEqual([]);
    expect(c([commit("feat(T-01.02): novo campo pedido", "2026-03-06T10:00:00Z")]).map((e) => e.natureza)).toEqual(["escopo"]);
    expect(c([commit("ajustes", "2026-03-06T10:00:00Z")])).toEqual([]);
    expect(c([{ sha: null, mensagem: "hotfix urgente", ts: "2026-03-06T10:00:00Z", linhas: 1, labels: [] }]).map((e) => e.chave_dedupe)[0]).toMatch(/^fix:tr1:T-01.02:[0-9a-f]{8}$/);
    expect(detectarCommitFix(fato({ commits: [commit("fix: x", "2026-03-06T10:00:00Z")] }), { natureza: R })).toEqual([]); // sem concluida_em
    expect(c([{ ...commit("ajustes", "2026-03-06T10:00:00Z"), labels: ["bug"] }]).map((e) => e.natureza)).toEqual(["defeito"]);
  });
  it("regressão: ocorrência bug com regressao_de = este trabalho; task citada, por arquivos ou só o trabalho; melhoria não", () => {
    const oc = (o: object) => ({ id: "o1", tipo: "bug", aberta_em: "2026-03-09T00:00:00Z", regressao_de: "tr1", categoria: null, task_ref: null, arquivos: [] as string[], ...o });
    expect(detectarRegressao("ws1", "tr1", [oc({ task_ref: "T-01.02" })], [f]).map((e) => [e.task_ref, e.natureza])).toEqual([["T-01.02", "defeito"]]);
    expect(detectarRegressao("ws1", "tr1", [oc({ arquivos: ["src/a.ts"] })], [f]).map((e) => e.task_ref)).toEqual(["T-01.02"]);
    expect(detectarRegressao("ws1", "tr1", [oc({})], [f]).map((e) => [e.task_ref, e.natureza])).toEqual([[null, "pendente"]]);
    expect(detectarRegressao("ws1", "tr1", [oc({ regressao_de: "outro" })], [f])).toEqual([]);
    expect(detectarRegressao("ws1", "tr1", [oc({ tipo: "melhoria", task_ref: "T-01.02" })], [f])).toEqual([]);
  });
  it("regra repetida: só >= 2 da MESMA regra na MESMA task; é FRACA (não entra no índice)", () => {
    const r = (task: string, regra: string, ts: string) => ev({ trabalho_id: "tr1", task, evento: "regra_violada", ts, detalhe: regra });
    const e = detectarRegraRepetida("ws1", "tr1", [r("T-01.01", "teste_ausente", "2026-03-01T00:00:00Z"), r("T-01.01", "teste_ausente", "2026-03-02T00:00:00Z"), r("T-01.01", "outra", "2026-03-02T00:00:00Z"), r("T-01.02", "teste_ausente", "2026-03-02T00:00:00Z")]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ task_ref: "T-01.01", forca: "fraca", fonte: "regra_repetida", evidencia: { vezes: 2 } });
  });
  it("detecção reprocessada não duplica (chave_dedupe estável)", () => {
    const a = novoAgil();
    const det = detectarTudo({ workspaceId: "ws1", trabalhoId: "tr1", fatos: [fato({ reabertas_em: ["2026-03-06T00:00:00.000Z"] })], qa: null, ocorrencias: [], rastro: [], config: cfg() });
    const d = { banco: a.banco, relogio: a.relogio, id: a.id };
    expect(registrarDeteccoes(d, det).novos).toHaveLength(1);
    expect(registrarDeteccoes(d, det)).toMatchObject({ novos: [], existentes: 1 });
    expect(a.banco.eventosRetrabalho.valores()).toHaveLength(1);
  });
});

describe("janela e situação por task (T-18.21)", () => {
  const agora = Date.parse("2026-03-10T12:00:00Z");
  const base = fato({ status_visto: "concluida", concluida_em: "2026-03-09T12:00:00.000Z", tem_rastro: true });
  const ctx = (o: Partial<ContextoSituacao> = {}): ContextoSituacao => ({ agora, janela_dias: 14, sprint_fechada_em: null, qa_emitido_em: null, tem_qa: false, ...o });
  const evento = (o: Partial<EventoRetrabalho>): EventoRetrabalho => ({ id: "e", workspace_id: "ws1", trabalho_id: "tr1", task_ref: "T-01.01", item_id: null, fonte: "task_reaberta", forca: "forte", natureza: "defeito", evidencia: {}, chave_dedupe: "k", ocorrido_em: null, detectado_em: "2026-03-09T00:00:00.000Z", confirmado_por: "automatico", motivo: null, ativo: true, ...o });

  it("janela: do concluída até o maior entre fechamento da sprint e QA, com teto de 14 dias", () => {
    const c = "2026-03-01T00:00:00.000Z";
    expect(janelaRetrabalho(c, { sprint_fechada_em: null, qa_emitido_em: null }, 14)?.fim).toBe("2026-03-15T00:00:00.000Z"); // só o teto
    expect(janelaRetrabalho(c, { sprint_fechada_em: "2026-03-05T00:00:00Z", qa_emitido_em: "2026-03-08T00:00:00Z" }, 14)?.fim).toBe("2026-03-08T00:00:00.000Z"); // o maior
    expect(janelaRetrabalho(c, { sprint_fechada_em: "2026-04-30T00:00:00Z", qa_emitido_em: null }, 14)?.fim).toBe("2026-03-15T00:00:00.000Z"); // teto
    expect(janelaRetrabalho(c, { sprint_fechada_em: "2026-02-20T00:00:00Z", qa_emitido_em: null }, 14)?.fim).toBe("2026-03-15T00:00:00.000Z"); // anterior à conclusão não observa nada
    expect(janelaRetrabalho("lixo", { sprint_fechada_em: null, qa_emitido_em: null }, 14)).toBeNull();
  });
  it("tabela de cenários", () => {
    const sit = (f = base, evs: EventoRetrabalho[] = [], c = ctx()) => situacaoDaTask(f, evs, c);
    expect(sit().situacao).toBe("em_observacao"); // concluída ontem
    expect(sit(base, [], ctx({ agora: agora + 20 * DIA })).situacao).toBe("primeira"); // passou a janela sem evento
    expect(sit(fato({ ...base, tem_rastro: false })).situacao).toBe("indeterminado"); // sem rastro e sem QA
    expect(sit(fato({ ...base, tem_rastro: false }), [], ctx({ tem_qa: true })).situacao).toBe("em_observacao"); // com QA há fonte
    expect(sit(base, [evento({})]).situacao).toBe("retrabalho"); // forte defeito, mesmo dentro da janela
    expect(sit(base, [evento({ natureza: "escopo" })], ctx({ agora: agora + 20 * DIA })).situacao).toBe("primeira"); // escopo não derruba
    expect(sit(base, [evento({ natureza: "ruido" })], ctx({ agora: agora + 20 * DIA })).situacao).toBe("primeira");
    expect(sit(base, [evento({ forca: "fraca", natureza: "pendente", fonte: "regra_repetida" })], ctx({ agora: agora + 20 * DIA })).situacao).toBe("primeira"); // fraco só sinaliza
    expect(sit(base, [evento({ ativo: false })], ctx({ agora: agora + 20 * DIA })).situacao).toBe("primeira"); // descartado
    expect(sit(fato({ ...base, status_visto: "em_andamento", concluida_em: null })).situacao).toBeNull(); // ainda não concluída
    expect(sit(fato({ ...base, status_visto: "em_andamento", concluida_em: null }), [evento({})]).situacao).toBe("retrabalho"); // reaberta
    const p = sit(base, [evento({ natureza: "pendente", id: "p" })], ctx({ agora: agora + 20 * DIA }));
    expect(p).toMatchObject({ situacao: "primeira", eventos_pendentes: 1, eventos_defeito: 0 });
    expect(sit(base, [evento({ task_ref: "T-99" })]).situacao).toBe("em_observacao"); // evento de outra task
  });
  it("marcação manual mais recente vence a automática (e a anterior)", () => {
    const man = (situacao: string, detectado_em: string, id: string) => evento({ id, fonte: "manual", evidencia: { situacao }, detectado_em });
    const c = ctx({ agora: agora + 20 * DIA });
    expect(situacaoDaTask(base, [evento({}), man("primeira", "2026-03-09T01:00:00.000Z", "m1")], c).situacao).toBe("primeira");
    expect(situacaoDaTask(base, [man("primeira", "2026-03-09T01:00:00.000Z", "m1"), man("retrabalho", "2026-03-09T02:00:00.000Z", "m2")], c).situacao).toBe("retrabalho");
    expect(marcaManualVigente([man("retrabalho", "2026-03-09T01:00:00.000Z", "m1"), man("primeira", "2026-03-09T01:00:00.000Z", "m2")])).toBe("primeira"); // empate: o último id
    expect(marcaManualVigente([])).toBeNull();
    expect(situacaoDaTask(base, [man("retrabalho", "2026-03-09T01:00:00.000Z", "m1")], c).situacao).toBe("retrabalho");
  });
});

describe("agregação e índice (T-18.22)", () => {
  const l = (chave: string, situacao: LinhaRetrabalho["situacao"], o: Partial<LinhaRetrabalho> = {}): LinhaRetrabalho => ({ chave, situacao, eventos_pendentes: 0, pontos: 3, categoria: "feature", sprint_id: "s1", membro_id: "m1", agente: "a", squad_id: null, retrabalho_ms: null, ...o });
  it("ir, ir_max, FTR; denominador exclui em_observacao e indeterminado (mostrados à parte)", () => {
    const r = resumirRetrabalho([l("1", "primeira"), l("2", "primeira"), l("3", "primeira", { eventos_pendentes: 1 }), l("4", "retrabalho", { pontos: 5, retrabalho_ms: 7_200_000 }), l("5", "em_observacao"), l("6", "indeterminado"), l("7", null)], 2);
    expect(r).toMatchObject({ avaliaveis: 4, ir: 0.25, ir_max: 0.5, first_time_right: 0.75, em_observacao: 1, indeterminado: 1, escopo_eventos: 2, pontos_retrabalhados: 5, horas_obs_retrabalho_min: 2 });
  });
  it("sem avaliáveis => null (nunca 0)", () => {
    expect(resumirRetrabalho([l("1", "em_observacao"), l("2", "indeterminado")])).toMatchObject({ ir: null, ir_max: null, first_time_right: null, avaliaveis: 0, pontos_retrabalhados: 0 });
    expect(resumirRetrabalho([])).toMatchObject({ ir: null, horas_obs_retrabalho_min: null });
    expect(resumirRetrabalho([l("1", "retrabalho", { pontos: null })]).pontos_retrabalhados).toBeNull();
  });
  it("agrupa por categoria/agente/sprint com 'sem_dono' para ausente", () => {
    const g = agruparRetrabalho([l("1", "primeira", { agente: "x" }), l("2", "retrabalho", { agente: "x" }), l("3", "primeira", { agente: null })], "agente");
    expect(g.map((x) => [x.chave, x.resumo.avaliaveis, x.resumo.ir])).toEqual([["sem_dono", 1, 0], ["x", 2, 0.5]]);
  });
});

describe("marcação manual, confirmação e auditoria (T-18.23)", () => {
  function pronto() {
    const a = novoAgil();
    const d = { banco: a.banco, relogio: a.relogio, id: a.id };
    registrarDeteccoes(d, detectarTudo({ workspaceId: "ws1", trabalhoId: "tr1", fatos: [fato({ reabertas_em: ["2026-03-06T00:00:00.000Z"] })], qa: null, ocorrencias: [], rastro: [], config: cfg() }));
    const evento = a.banco.eventosRetrabalho.valores()[0] as EventoRetrabalho;
    return { a, d, evento };
  }
  const p = (o: object) => ({ workspace_id: "ws1", trabalho_id: "tr1", task_ref: "T-01.01", acao: "marcar_retrabalho" as const, motivo: "defeito achado no QA", ator: "humano" as const, ...o });
  it("agente recebe human_only em toda ação; motivo >= 5 caracteres", () => {
    const { d, evento } = pronto();
    for (const acao of ["marcar_retrabalho", "marcar_primeira", "confirmar", "descartar", "natureza"] as const) {
      expect(() => marcarRetrabalho(d, p({ acao, ator: "agente", evento_id: evento.id }))).toThrowError(expect.objectContaining({ subcode: "human_only" }));
    }
    expect(() => marcarRetrabalho(d, p({ motivo: "ok" }))).toThrow(/motivo/);
    expect(() => marcarRetrabalho(d, p({ motivo: "     " }))).toThrow(/motivo/);
  });
  it("marcar retrabalho/primeira cria evento manual auditado, sem segredo", () => {
    const { a, d } = pronto();
    const e = marcarRetrabalho(d, p({ acao: "marcar_primeira", motivo: "foi só um ajuste visual token=abcdef123456" }));
    expect(e).toMatchObject({ fonte: "manual", confirmado_por: "humano", evidencia: { situacao: "primeira" } });
    expect(e.motivo).not.toMatch(/abcdef123456/);
    const aud = a.banco.auditoria.valores();
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ acao: "retrabalho.marcar_primeira", ator: "humano" });
    expect(aud[0]?.motivo).not.toMatch(/abcdef123456/);
  });
  it("override humano persiste ao reprocessar; descartar não reabre; natureza muda e fica", () => {
    const { a, d, evento } = pronto();
    marcarRetrabalho(d, p({ acao: "descartar", evento_id: evento.id }));
    const det = detectarTudo({ workspaceId: "ws1", trabalhoId: "tr1", fatos: [fato({ reabertas_em: ["2026-03-06T00:00:00.000Z"] })], qa: null, ocorrencias: [], rastro: [], config: cfg() });
    registrarDeteccoes(d, det);
    registrarDeteccoes(d, det);
    const depois = a.banco.eventosRetrabalho.get(evento.id);
    expect(depois).toMatchObject({ ativo: false, confirmado_por: "humano" });
    expect(a.banco.eventosRetrabalho.valores()).toHaveLength(1);
    marcarRetrabalho(d, p({ acao: "natureza", evento_id: evento.id, natureza: "escopo" }));
    registrarDeteccoes(d, det);
    expect(a.banco.eventosRetrabalho.get(evento.id)?.natureza).toBe("escopo");
    expect(() => marcarRetrabalho(d, p({ acao: "natureza", evento_id: evento.id }))).toThrow(/natureza/);
    expect(() => marcarRetrabalho(d, p({ acao: "confirmar", evento_id: "nope" }))).toThrow(/evento/);
    expect(a.banco.auditoria.valores()).toHaveLength(2);
  });
  it("confirmar evento pendente o promove a defeito (ou à natureza escolhida)", () => {
    const a = novoAgil();
    const d = { banco: a.banco, relogio: a.relogio, id: a.id };
    registrarDeteccoes(d, [{ workspace_id: "ws1", trabalho_id: "tr1", task_ref: "T-01.01", fonte: "commit_fix", forca: "forte", natureza: "pendente", evidencia: {}, chave_dedupe: "k1", ocorrido_em: null }]);
    const e = a.banco.eventosRetrabalho.valores()[0] as EventoRetrabalho;
    expect(e.confirmado_por).toBeNull();
    expect(marcarRetrabalho(d, p({ acao: "confirmar", evento_id: e.id })).natureza).toBe("defeito");
  });
});
