import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ev, tk, trab } from "../../../tests/fixtures/metodo/construtores";
import { novoAgil, cfg, T0 } from "../../../tests/fixtures/agil/ajudas";
import { extrairFatos } from "./fatos/extrair";
import { montarFonte, qaDeArtefato, commitsDeEntrega, versaoOrigem } from "./fatos/fonte";
import { sincronizar } from "./fatos/sincronizar";
import type { FonteTrabalho } from "./portas";
import type { Artefato } from "../metodo/tipos";
import { isoDe } from "./util";

const AGORA = Date.parse("2026-03-10T12:00:00Z");
const fonte = (tasks = [tk("T-01.01")], rastro: ReturnType<typeof ev>[] = [], o: Partial<FonteTrabalho> = {}): FonteTrabalho => ({ workspace_id: "ws1", trabalho: trab({ id: "tr1" }, tasks), rastro, commits: [], qa: null, versao_origem: "v1", ...o });
const opc = { agora: AGORA, padroesTeste: cfg().padroes_teste };
const e = (evento: string, ts: string, extra: Partial<ReturnType<typeof ev>> = {}) => ev({ trabalho_id: "tr1", task: "T-01.01", evento, ts, ...extra });

describe("extrator de fatos (T-18.06)", () => {
  it("sem rastro: tem_rastro=false e campos null (o disco vence)", () => {
    const [f] = extrairFatos(fonte([tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09", suite: "verde" })]), opc);
    expect(f).toMatchObject({ tem_rastro: false, duracao_obs_ms: null, iniciada_em: null, tdd_primeiro: null, vermelho_antes: null, bloqueada_ms: null, concluida_ts_precisa: false, concluida_em: "2026-03-09T23:59:59.999Z" });
  });
  it("duração observada só com task_iniciada anterior; com rastro completo calcula", () => {
    const tasks = [tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09", suite: "verde" })];
    const [com] = extrairFatos(fonte(tasks, [e("task_iniciada", "2026-03-09T08:00:00Z"), e("task_concluida", "2026-03-09T11:30:00Z")]), opc);
    expect(com?.duracao_obs_ms).toBe(3.5 * 3_600_000);
    expect(com?.concluida_ts_precisa).toBe(true);
    const [sem] = extrairFatos(fonte(tasks, [e("task_concluida", "2026-03-09T11:30:00Z")]), opc);
    expect(sem?.duracao_obs_ms).toBeNull();
    expect(sem?.concluida_em).toBe("2026-03-09T11:30:00.000Z");
  });
  it("disco vence o rastro em status: rastro diz concluída, disco diz em andamento", () => {
    const [f] = extrairFatos(fonte([tk("T-01.01", { status: "em_andamento" })], [e("task_iniciada", "2026-03-09T08:00:00Z"), e("task_concluida", "2026-03-09T11:00:00Z")]), opc);
    expect(f?.status_visto).toBe("em_andamento");
    expect(f?.concluida_em).toBeNull();
    expect(f?.duracao_obs_ms).toBeNull();
  });
  it("robusto: linhas incompletas, ts inválido, fora de ordem e lixo não lançam", () => {
    const lixo = [{ evento: "task_iniciada" }, null, { ts: "x", task: "T-01.01", evento: "task_iniciada" }, { ts: "2026-03-09T08:00:00Z", task: 5, evento: "task_iniciada" }] as unknown as ReturnType<typeof ev>[];
    const rastro = [e("task_concluida", "2026-03-09T11:00:00Z"), e("task_iniciada", "2026-03-09T08:00:00Z"), ...lixo];
    expect(() => extrairFatos(fonte([tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09" })], rastro), opc)).not.toThrow();
    const [f] = extrairFatos(fonte([tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09" })], rastro), opc);
    expect(f?.duracao_obs_ms).toBe(3 * 3_600_000); // ordenado por ts, não pela ordem do arquivo
    expect(() => extrairFatos({ ...fonte(), rastro: undefined } as unknown as FonteTrabalho, opc)).not.toThrow();
  });
  it("reabertura: task_iniciada depois de task_concluida; ciclo de retrabalho somado; autor original", () => {
    const rastro = [e("task_iniciada", "2026-03-02T08:00:00Z", { agente: "autor" }), e("task_concluida", "2026-03-02T10:00:00Z", { agente: "autor" }), e("task_iniciada", "2026-03-04T08:00:00Z", { agente: "outro" }), e("task_concluida", "2026-03-04T09:00:00Z", { agente: "outro" })];
    const [f] = extrairFatos(fonte([tk("T-01.01", { status: "concluida", concluida_em: "2026-03-04" })], rastro), opc);
    expect(f?.reaberturas).toBe(1);
    expect(f?.reabertas_em).toEqual(["2026-03-04T08:00:00.000Z"]);
    expect(f?.retrabalho_ms).toBe(3_600_000);
    expect(f?.agente).toBe("autor");
    expect(f?.duracao_obs_ms).toBe(3_600_000);
    expect(f?.intervalos).toEqual([["2026-03-02T08:00:00.000Z", "2026-03-02T10:00:00.000Z"], ["2026-03-04T08:00:00.000Z", "2026-03-04T09:00:00.000Z"]]);
  });
  it("transição observada concluida -> em_andamento conta como reabertura sem rastro", () => {
    const anterior = extrairFatos(fonte([tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09" })]), opc);
    const [f] = extrairFatos(fonte([tk("T-01.01", { status: "em_andamento" })]), { ...opc, anteriores: new Map(anterior.map((x) => [x.task_ref, x])) });
    expect(f?.reaberturas).toBe(1);
    expect(f?.reabertas_em).toEqual([isoDe(AGORA)]);
  });
  it("bloqueio: soma de task_bloqueada até a retomada; aberto conta até agora se a task está bloqueada", () => {
    const r1 = [e("task_iniciada", "2026-03-09T08:00:00Z"), e("task_bloqueada", "2026-03-09T09:00:00Z"), e("task_iniciada", "2026-03-09T11:00:00Z")];
    expect(extrairFatos(fonte([tk("T-01.01", { status: "em_andamento" })], r1), opc)[0]?.bloqueada_ms).toBe(2 * 3_600_000);
    const r2 = [e("task_iniciada", "2026-03-10T08:00:00Z"), e("task_bloqueada", "2026-03-10T09:00:00Z")];
    expect(extrairFatos(fonte([tk("T-01.01", { status: "bloqueada" })], r2), opc)[0]?.bloqueada_ms).toBe(3 * 3_600_000);
  });
  it("TDD primeiro e vermelho antes do verde (tabela)", () => {
    const arq = (...a: string[]) => e("arquivo_alterado", "2026-03-09T08:00:00Z", { arquivos: a });
    const tdd = (rastro: ReturnType<typeof ev>[]) => extrairFatos(fonte([tk("T-01.01")], rastro), opc)[0]?.tdd_primeiro;
    expect(tdd([arq("tests/a.test.ts", "src/a.ts")])).toBe(true);
    expect(tdd([arq("src/a.ts", "tests/a.test.ts")])).toBe(false);
    expect(tdd([arq("src/a.ts")])).toBe(false);
    expect(tdd([arq("tests/a.test.ts")])).toBe(true);
    expect(tdd([])).toBeNull();
    const v = (rs: string[]) => extrairFatos(fonte([tk("T-01.01")], rs.map((r, i) => e("suite_executada", `2026-03-09T0${i + 1}:00:00Z`, { resultado: r }))), opc)[0]?.vermelho_antes;
    expect(v(["falha", "ok"])).toBe(true);
    expect(v(["ok"])).toBe(false);
    expect(v(["falha"])).toBeNull();
    expect(v([])).toBeNull();
  });
  it("QA: achado alta/média por task citada > arquivos; baixa não conta; commits da ENTREGA e do rastro", () => {
    const tasks = [tk("T-01.01"), tk("T-01.02")];
    const rastro = [e("arquivo_alterado", "2026-03-09T08:00:00Z", { arquivos: ["src/a.ts"] }), ev({ trabalho_id: "tr1", task: "T-01.02", evento: "arquivo_alterado", ts: "2026-03-09T08:00:00Z", arquivos: ["src/b.ts"] }), e("commit_criado", "2026-03-09T09:00:00Z", { detalhe: "feat(T-01.01): x", ...{ sha: "abc" } })];
    const qa = { veredito: "reprovado" as const, emitido_em: "2026-03-09T12:00:00Z", achados: [
      { id: "1", severidade: "alta" as const, categoria: null, task: "T-01.02", arquivos: [], descricao: "d" },
      { id: "2", severidade: "media" as const, categoria: null, task: null, arquivos: ["src/a.ts"], descricao: "d" },
      { id: "3", severidade: "baixa" as const, categoria: null, task: "T-01.01", arquivos: [], descricao: "d" },
    ] };
    const fs = extrairFatos(fonte(tasks, rastro, { qa, commits: [{ sha: "e1", mensagem: "ajuste T-01.02", ts: null, linhas: 10, labels: [], task_ref: null }] }), opc);
    expect(fs.find((f) => f.task_ref === "T-01.01")?.qa_reprovacoes).toBe(1);
    expect(fs.find((f) => f.task_ref === "T-01.02")?.qa_reprovacoes).toBe(1);
    expect(fs.find((f) => f.task_ref === "T-01.01")?.commits.map((c) => c.sha)).toEqual(["abc"]);
    expect(fs.find((f) => f.task_ref === "T-01.02")?.commits.map((c) => c.sha)).toEqual(["e1"]);
  });
  it("rotação (.1.jsonl) = mesma lista concatenada fora de ordem: resultado idêntico", () => {
    const a = [e("task_iniciada", "2026-03-09T08:00:00Z"), e("task_concluida", "2026-03-09T10:00:00Z")];
    const t = [tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09" })];
    expect(extrairFatos(fonte(t, [...a].reverse()), opc)).toEqual(extrairFatos(fonte(t, a), opc));
  });
});

describe("adaptadores do modelo do método (somente leitura)", () => {
  const art = (dados: Record<string, unknown> | null): Artefato => ({ caminho: "docs/x/QA.md", nome: "QA.md", ferramenta: "runx", kind: "qa", trabalho_id: "tr1", dados, corpo: "", veredito: null, faixa: null, rejeicao: null, avisos: [] });
  it("QA.md tolerante: severidade desconhecida e campos faltando são descartados", () => {
    const q = qaDeArtefato(art({ achados: [{ id: "a", severidade: "alta", task: "T-01.01" }, { severidade: "gravissima" }, null, 5, { id: "c", severidade: "média", arquivos: ["a.ts", 3] }] }), { veredito_qa: "reprovado" }, "2026-03-09T00:00:00Z");
    expect(q?.achados.map((a) => [a.id, a.severidade])).toEqual([["a", "alta"], ["c", "media"]]);
    expect(q?.achados[1]?.arquivos).toEqual(["a.ts"]);
    expect(qaDeArtefato(null, { veredito_qa: null }, null)).toBeNull();
  });
  it("ENTREGA.md: commits tolerantes", () => {
    expect(commitsDeEntrega(art({ commits: [{ sha: "a", mensagem: "m", task: "T-01.01", linhas: 5 }, { sha: "b" }, 3] }))).toEqual([{ sha: "a", mensagem: "m", ts: null, linhas: 5, labels: [], task_ref: "T-01.01" }]);
    expect(commitsDeEntrega(null)).toEqual([]);
  });
  it("versao_origem muda quando algo muda e é estável quando nada muda", () => {
    const t = trab({ id: "tr1" }, [tk("T-01.01")]);
    const a = versaoOrigem(t, [], null);
    expect(versaoOrigem(t, [], null)).toBe(a);
    expect(versaoOrigem(trab({ id: "tr1" }, [tk("T-01.01", { status: "concluida" })]), [], null)).not.toBe(a);
    expect(montarFonte("ws1", t, [e("task_iniciada", "2026-03-09T08:00:00Z")]).versao_origem).not.toBe(a);
  });
});

describe("sincronizador incremental (T-18.07)", () => {
  async function ctx(fontes: () => FonteTrabalho[]) {
    const a = novoAgil();
    a.config.gravar("ws1", {});
    const portas = { ...a.portas, metodo: { ...a.portas.metodo, fontes: async () => fontes() } };
    const dep = () => ({ banco: a.banco, metodo: portas.metodo, relogio: a.relogio, id: a.id, config: a.config.ler("ws1") });
    return { a, sync: (o: { forcar?: boolean } = {}) => sincronizar(dep(), "ws1", o) };
  }
  it("cria item espelho (sem copiar estado de execução) e fato; segunda rodada pula o que não mudou", async () => {
    const c = await ctx(() => [fonte([tk("T-01.01", { status: "concluida", concluida_em: "2026-03-09" }), tk("T-01.02")])]);
    const r1 = await c.sync();
    expect(r1).toMatchObject({ itens_criados: 2, fatos_atualizados: 2, trabalhos_pulados: 0 });
    const it = c.a.banco.itens.valores().find((i) => i.task_ref === "T-01.01");
    expect(it).toMatchObject({ origem: "metodo", estado_ade: "backlog", orfao: false });
    const r2 = await c.sync();
    expect(r2).toMatchObject({ trabalhos_pulados: 1, itens_criados: 0, fatos_atualizados: 0 });
    const r3 = await c.sync({ forcar: true });
    expect(r3.fatos_atualizados).toBe(2);
    expect(c.a.banco.itens.valores()).toHaveLength(2); // sem duplicar
  });
  it("transição concluida -> outro status alimenta `reabertas`", async () => {
    let status: "concluida" | "em_andamento" = "concluida";
    let v = "v1";
    const c = await ctx(() => [fonte([tk("T-01.01", { status, concluida_em: status === "concluida" ? "2026-03-09" : null })], [], { versao_origem: v })]);
    await c.sync();
    status = "em_andamento"; v = "v2";
    const r = await c.sync();
    expect(r.reabertas).toEqual([{ trabalho_id: "tr1", task_ref: "T-01.01" }]);
    expect([...c.a.banco.fatos.valores()][0]?.reaberturas).toBe(1);
  });
  it("task que some do disco vira órfã SEM apagar o histórico; porta vazia não orfana tudo", async () => {
    let tasks = [tk("T-01.01"), tk("T-01.02")];
    let v = 1;
    const c = await ctx(() => (tasks.length ? [fonte(tasks, [], { versao_origem: `v${v}` })] : []));
    await c.sync();
    tasks = [tk("T-01.01")]; v = 2;
    const r = await c.sync();
    expect(r.orfaos).toBe(1);
    expect(c.a.banco.itens.valores().find((i) => i.task_ref === "T-01.02")?.orfao).toBe(true);
    expect(c.a.banco.fatos.valores()).toHaveLength(2); // fato antigo preservado
    tasks = []; v = 3;
    const r2 = await c.sync({ forcar: true });
    expect(r2.orfaos).toBe(0); // fonte vazia (porta indisponível) nunca apaga nem orfana
    tasks = [tk("T-01.01"), tk("T-01.02")]; v = 4;
    await c.sync();
    expect(c.a.banco.itens.valores().every((i) => !i.orfao)).toBe(true); // voltou: deixa de ser órfão
  });
  it("atribui membro pelo alias do agente; ambíguo vira sem dono com aviso", async () => {
    const c = await ctx(() => [fonte([tk("T-01.01"), tk("T-01.02")], [e("task_iniciada", "2026-03-09T08:00:00Z", { agente: "dev" }), ev({ trabalho_id: "tr1", task: "T-01.02", evento: "task_iniciada", ts: "2026-03-09T08:00:00Z", agente: "dupla" })])]);
    const mk = (id: string, valor: string) => c.a.banco.membros.set(id, { id, workspace_id: "ws1", tipo: "agente", rotulo: id, squad_id: null, horas_dia: null, fator_foco: 0.6, pontos_sprint_fixo: null, ativo: true, aliases: [{ tipo: "agente", valor }] });
    mk("m1", "dev"); mk("m2", "dupla"); mk("m3", "dupla");
    const r = await c.sync();
    const f = (ref: string) => c.a.banco.fatos.valores().find((x) => x.task_ref === ref);
    expect(f("T-01.01")?.membro_id).toBe("m1");
    expect(f("T-01.02")?.membro_id).toBeNull();
    expect(r.avisos.join("|")).toMatch(/sem dono/);
  });
  it("auditoria: nenhum arquivo do núcleo importa fs/rede/processo (zero escrita em docs/**)", () => {
    const raiz = resolve(__dirname);
    const lista: string[] = [];
    const varrer = (d: string): void => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) varrer(p); else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) lista.push(p); } };
    varrer(raiz);
    expect(lista.length).toBeGreaterThan(30);
    const proibidos = /from "(node:)?(fs|fs\/promises|child_process|net|http|https|dgram|worker_threads|electron)"|require\(["'](node:)?(fs|child_process)/;
    const achados = lista.filter((p) => proibidos.test(readFileSync(p, "utf8")));
    expect(achados).toEqual([]);
    const campoAutorrelato = lista.filter((p) => /autorrelato|self[_-]?report/i.test(readFileSync(p, "utf8").replace(/\/\/.*$/gm, "")));
    expect(campoAutorrelato).toEqual([]);
  });
  it("T0 de teste é fixo", () => { expect(T0).toBe(AGORA); });
});
