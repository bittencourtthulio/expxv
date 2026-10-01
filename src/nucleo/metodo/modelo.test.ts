import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarTmp, limparTmps } from "../../../tests/fixtures/metodo/util";
import { escreverFeatureSimples, gerarProjetoExpx, HOJE_FIXTURE } from "../../../tests/fixtures/metodo/gerar";
import { ev } from "../../../tests/fixtures/metodo/construtores";
import { descobrir } from "./descoberta";
import { montarTrabalhos } from "./modelo";
import { lerArtefato } from "./parser/leitores";
import { lerRastroDoTrabalho } from "./parser/jsonl";
import type { Artefato, EventoRastro, Trabalho } from "./tipos";
import { join } from "node:path";

const AGORA = Date.parse(HOJE_FIXTURE);

async function montarDoDisco(raiz: string, extras: Record<string, EventoRastro[]> = {}): Promise<Trabalho[]> {
  const descoberta = await descobrir(raiz);
  const caminhos = [
    ...descoberta.trabalhos.flatMap((t) => t.arquivos),
    ...descoberta.projeto,
    ...descoberta.entregas.flatMap((e) => e.arquivos),
    ...descoberta.camadas,
    ...descoberta.relatorios,
  ];
  const artefatos = new Map<string, Artefato>();
  for (const c of caminhos) artefatos.set(c, await lerArtefato(raiz, c));
  const eventos = new Map<string, EventoRastro[]>();
  for (const id of ["cobranca-pix"]) eventos.set(id, (await lerRastroDoTrabalho(join(raiz, "docs/eventos"), id)).eventos);
  for (const [k, v] of Object.entries(extras)) eventos.set(k, v);
  return montarTrabalhos({ descoberta, artefatos, eventos, agora: AGORA });
}

describe("modelo derivado (fixture completa)", () => {
  let trabalhos: Trabalho[];
  let ids: ReturnType<typeof gerarProjetoExpx>["ids"];
  const por = (id: string): Trabalho => {
    const t = trabalhos.find((x) => x.id === id);
    if (!t) throw new Error(`trabalho ${id} ausente`);
    return t;
  };
  const tiposDe = (id: string): string[] => [...new Set(por(id).violacoes.map((v) => v.tipo))].sort();

  beforeAll(async () => {
    const raiz = criarTmp();
    ids = gerarProjetoExpx(raiz).ids;
    trabalhos = await montarDoDisco(raiz);
  });
  afterAll(limparTmps);

  it("descobre todos os trabalhos e nada de node_modules/dist", () => {
    expect(trabalhos).toHaveLength(15);
    expect(trabalhos.some((t) => t.id.startsWith("deve-ser-ignorado"))).toBe(false);
    expect(new Set(trabalhos.map((t) => t.tipo))).toEqual(new Set(["feature", "ocorrencia", "pedido", "projeto"]));
  });

  it("sprintx em execução: Trabalho -> Sprint -> Fase -> Task, estágio por disco", () => {
    const t = por(ids.emExecucao!);
    expect(t).toMatchObject({ ferramenta: "sprintx", tipo: "feature", layout: "sprintx_features", estagio: "f6", estagio_declarado: "f6", status: "em_andamento", worktree: "../repo--cobranca-pix", veredito_auditoria: "sim" });
    expect(t.sprints.map((s) => s.id)).toEqual(["sprint-01", "sprint-02"]);
    const s1 = t.sprints[0]!;
    expect(s1.fases.map((f) => [f.id, f.status, f.tasks.map((x) => x.id)])).toEqual([
      ["F-01.1", "concluido", ["T-01.01", "T-01.02"]],
      ["F-01.2", "em_andamento", ["T-01.03", "T-01.04"]],
    ]);
    // sprint-02 é condensada (kind: plano)
    expect(t.sprints[1]!.fases.map((f) => f.id)).toEqual(["F-02.1", "F-02.2"]);
    const t04 = s1.fases[1]!.tasks[1]!;
    expect(t04).toMatchObject({ id: "T-01.04", status: "em_andamento", depende_de: ["T-01.03"], suite: "nao_executada", paralelizavel: false });
    expect(s1.fases[0]!.tasks[1]).toMatchObject({ suite: "parcial", status: "concluida" });
    expect(t.caminho_critico_declarado).toEqual(["F-01.1", "F-01.2"]);
    expect(t.violacoes).toEqual([]);
  });

  it("caminho crítico é CALCULADO e atravessa sprints", () => {
    expect(por(ids.emExecucao!).grafo.caminho_critico).toEqual(["T-01.01", "T-01.03", "T-01.04", "T-02.01", "T-02.02"]);
    expect(por(ids.emExecucao!).grafo.prontas).toEqual([]);
  });

  it("rastro: última atividade, total e duração observada (inclui arquivo rotacionado)", () => {
    const t = por(ids.emExecucao!);
    expect(t.eventos_total).toBe(6);
    expect(t.ultima_atividade).toBe("2026-09-29T11:00:00Z");
    const tasks = t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks));
    expect(tasks.find((x) => x.id === "T-01.03")?.duracao_observada_ms).toBe(30 * 60_000);
    expect(tasks.find((x) => x.id === "T-01.01")?.duracao_observada_ms).toBe(30 * 60_000);
    expect(tasks.find((x) => x.id === "T-01.04")?.duracao_observada_ms).toBeNull();
    expect(t.sinaleira.cor).toBe("verde");
  });

  it("sprintx F5 com auditoria NÃO e F2/F3 com decisão pendente e raio ALTO", () => {
    expect(por(ids.auditoriaNao!)).toMatchObject({ estagio: "f5", veredito_auditoria: "nao" });
    expect(por(ids.auditoriaNao!).sinaleira.cor).toBe("amarelo");
    const ec = por(ids.decisaoPendente!);
    expect(ec).toMatchObject({ estagio: "f3", decisoes_pendentes: 1, raio: { faixa: "alto", aprovado: false } });
    expect(ec.sinaleira.cor).toBe("amarelo");
    expect(por("cobranca-pix").raio).toEqual({ faixa: "baixo", aprovado: true });
  });

  it("estágios iniciais: so-base em f2; feature com ORQUESTRADOR e sem auditoria em f5", () => {
    expect(por(ids.soBase!).estagio).toBe("f2");
    expect(por(ids.truncada!).estagio).toBe("f5");
  });

  it("YAML truncado e kind desconhecido não derrubam o trabalho; BOM é tolerado", () => {
    const t = por(ids.truncada!);
    expect(t.sprints).toHaveLength(1); // sprint.md legível, tasks.md truncado
    expect(t.sprints[0]!.fases).toEqual([]);
    expect(t.estagio_declarado).toBe("f4");
    expect(t.titulo).toBe("Trabalho feature-truncada");
    expect(t.decisoes_pendentes).toBe(0);
  });

  it("plano quebrado: uma violação de cada tipo de plano, sinaleira vermelha", () => {
    expect(tiposDe(ids.planoQuebrado!)).toEqual(
      ["bloqueio_antigo", "ciclo_dependencia", "concluida_sem_verde", "dependencia_inexistente", "estagio_incoerente", "paralela_com_dependencia", "sem_criterio_saida", "teste_ausente"].sort(),
    );
    const t = por(ids.planoQuebrado!);
    expect(t.sinaleira.cor).toBe("vermelho");
    expect(t.sinaleira.motivo.length).toBeGreaterThan(0);
    expect(t.bloqueios.filter((b) => b.aberto).map((b) => b.id)).toEqual(["B-01"]);
    expect(t.grafo.ciclos).toEqual([["T-01.02", "T-01.03"]]);
    expect(t.grafo.dependencias_inexistentes).toEqual([{ de: "T-01.05", ate: "T-99.99" }]);
  });

  it("sprintx sob buildx carrega origem_buildx e feature_id", () => {
    expect(por(ids.sobBuildx!)).toMatchObject({ origem_buildx: "loja-demo", feature_id: "FT-01", estagio: "f6" });
  });

  it("runx entregue: e5, QA aprovado, entrega registrada, verde e concluído", () => {
    const t = por(ids.runxEntregue!);
    expect(t).toMatchObject({ ferramenta: "runx", tipo: "ocorrencia", tipo_ocorrencia: "bug", estagio: "e5", status: "concluido", veredito_qa: "aprovado" });
    expect(t.entrega).toMatchObject({ estado: "entregue", branch: "fix/OC-2026-0142-frete-errado", portao: "pronto", pr_estado: "merged", commits: 2 });
    expect(t.violacoes).toEqual([]);
    expect(t.sinaleira.cor).toBe("verde");
  });

  it("runx: QA reprovado volta ao e3 e fica vermelho; bug sem regressão viola; ocorrência nova é e1", () => {
    expect(por(ids.runxReprovado!)).toMatchObject({ estagio: "e3", veredito_qa: "reprovado" });
    expect(por(ids.runxReprovado!).sinaleira.cor).toBe("vermelho");
    expect(tiposDe(ids.runxSemRegressao!)).toEqual(["regressao_ausente"]);
    expect(por(ids.runxSemRegressao!).estagio).toBe("e3");
    expect(por(ids.runxRecente!)).toMatchObject({ estagio: "e1", ferramenta: "runx" });
  });

  it("prodx: veredito sem assinatura é amarelo; assinado com briefing é concluído", () => {
    const p = por(ids.prodxPendente!);
    expect(p).toMatchObject({ tipo: "pedido", ferramenta: "prodx", estagio: "p5", prodx: { veredito: "fazer", assinado: false, briefing: false } });
    expect(p.sinaleira.cor).toBe("amarelo");
    expect(p.sinaleira.motivo).toMatch(/assinatura/);
    const q = por(ids.prodxAssinado!);
    expect(q).toMatchObject({ status: "concluido", prodx: { assinado: true, briefing: true } });
    expect(q.sinaleira.cor).toBe("verde");
  });

  it("buildx: features do MAPA, estágio b4, grafo das features", () => {
    const b = por(ids.projeto!);
    expect(b).toMatchObject({ tipo: "projeto", ferramenta: "buildx", estagio: "b4", estagio_declarado: "b4" });
    expect(b.features.map((f) => [f.id, f.status, f.depende_de])).toEqual([
      ["FT-01", "entregue", []],
      ["FT-02", "em_andamento", ["FT-01"]],
      ["FT-03", "pendente", ["FT-01", "FT-02"]],
    ]);
    expect(b.features[0]).toMatchObject({ slug: "fundacao-autenticacao", titulo: "Fundacao e autenticacao" });
    expect(b.grafo.caminho_critico).toEqual(["FT-01", "FT-02", "FT-03"]);
    expect(b.violacoes).toEqual([]);
  });

  it("o disco vence o rastro: divergência é registrada e o status do disco permanece", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const ts = "2026-09-29T11:50:00Z";
    const ts2 = await montarDoDisco(raiz, {
      "cobranca-pix": [ev({ ts, trabalho_id: "cobranca-pix", evento: "task_concluida", task: "T-01.04" }), ev({ ts, trabalho_id: "cobranca-pix", evento: "task_iniciada", task: "T-02.01" })],
    });
    const t = ts2.find((x) => x.id === "cobranca-pix")!;
    const t04 = t.sprints[0]!.fases[1]!.tasks[1]!;
    expect(t04.status).toBe("em_andamento");
    expect(t.divergencias).toEqual([
      { task: "T-01.04", disco: "em_andamento", rastro: "concluida" },
      { task: "T-02.01", disco: "pendente", rastro: "em_andamento" },
    ]);
  });
});

describe("modelo idêntico para a pasta legada e para a nova", () => {
  afterAll(limparTmps);

  it("docs/<slug>/ e docs/sprintx/features/<slug>/ geram o mesmo modelo (salvo caminhos e layout)", async () => {
    const a = criarTmp();
    const b = criarTmp();
    escreverFeatureSimples(a, "docs/agenda-online");
    escreverFeatureSimples(b, "docs/sprintx/features/agenda-online");
    const [ta] = await montarDoDisco(a);
    const [tb] = await montarDoDisco(b);
    expect(ta).toBeDefined();
    expect(ta!.layout).toBe("legado");
    expect(tb!.layout).toBe("sprintx_features");
    const neutro = (t: Trabalho): unknown => JSON.parse(JSON.stringify({ ...t, layout: "x", pasta: "x" }).replace(/docs\/(sprintx\/features\/)?agenda-online/g, "docs/X"));
    expect(neutro(ta!)).toEqual(neutro(tb!));
    expect(ta!.estagio).toBe("f6");
    expect(ta!.sprints[0]!.fases).toHaveLength(2);
  });

  it("nunca lança para projeto sem nada", async () => {
    expect(await montarDoDisco(criarTmp())).toEqual([]);
  });
});
