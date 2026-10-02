import { describe, expect, it } from "vitest";
import { doc, novoServico } from "../../../../tests/fixtures/conhecimento/util";
import { proximoTrabalho } from "./agendador";
import { executarBackfill } from "./backfill";
import { drenar, enfileirar, PRIORIDADE } from "./fila";

describe("pipeline: aprendizado integrado (AC-15.10)", () => {
  it("fim de Missão gera aprendizado com proveniência e é buscável; reprocessar não duplica", async () => {
    const { s, fechar } = novoServico();
    const d = doc({ tipo: "relatorio", origem: "docs/relatorios/r.md", titulo: "R", texto: "# R\n\n## Decisões\n\n- Adotar invalidação de cache por evento de domínio.\n", mission_id: "mis_1", task_ref: "T-05.01" });
    const a = await s.pipeline.ingerir(s.colecaoId, d);
    expect(a).toMatchObject({ estado: "novo", aprendizados: 1 });
    expect(s.estado().aprendizados.ativo).toBe(1);
    const r = await s.buscar({ consulta: "invalidação de cache", modo: "lexical", tipos: ["aprendizado"] });
    expect(r.resultados[0]?.aprendizado_id).toBeTruthy();
    const b = await s.pipeline.ingerir(s.colecaoId, { ...d, texto: `${d.texto}\n## Notas\n\nObservação extra no relatório.` });
    expect(b.estado).toBe("substituido");
    const lista = s.repos.aprendizado.listar(s.colecaoId);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.vezes_visto).toBe(2);
    fechar();
  });
  it("rag_learn de agente nasce candidato e entra na busca com fator 0,7; de usuário nasce ativo", async () => {
    const { s, fechar } = novoServico();
    const a = await s.aprender({ tipo: "armadilha", titulo: "Cuidado com fuso", texto: "O servidor roda em UTC; converta datas na borda.", fonte: "agente", pane_id: "pane_1" });
    expect(a.status).toBe("candidate");
    const u = await s.aprender({ tipo: "decisao", titulo: "Datas em UTC", texto: "Todas as datas persistem em UTC ISO com milissegundos.", fonte: "usuario" });
    expect(u.status).toBe("active");
    const m = await s.aprender({ tipo: "armadilha", titulo: "Cuidado com fuso", texto: "O servidor roda em UTC; converta datas na borda.", fonte: "agente", pane_id: "pane_2" });
    expect(m).toMatchObject({ status: "merged", id: a.id });
    const r = await s.buscar({ consulta: "datas UTC", modo: "lexical" });
    expect(r.resultados.length).toBeGreaterThanOrEqual(2);
    expect(s.feedback({ alvo_tipo: "aprendizado", alvo_id: a.id, valor: "util", por: "agente", pane_id: "pane_3" }).ok).toBe(true);
    expect(s.atualizarAprendizado(a.id, "arquivar")?.estado).toBe("arquivado");
    fechar();
  });
  it("grande demais / vazio / sem conteúdo não quebram", async () => {
    const { s, fechar } = novoServico();
    expect((await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/v.md", texto: "   \n  " }))).estado).toBe("vazio");
    expect((await s.pipeline.ingerir(s.colecaoId, doc({ tipo: "codigo", formato: "codigo", origem: "src/g.ts", texto: "x".repeat(300 * 1024) }))).estado).toBe("grande_demais");
    expect((await s.pipeline.ingerir("col_inexistente", doc({ origem: "docs/z.md", texto: "z" }))).estado).toBe("recusado");
    fechar();
  });
});

describe("fila persistente", () => {
  it("prioridade, at-least-once e descarte após 3 falhas sem travar a fila", async () => {
    const { s, fechar } = novoServico();
    enfileirar(s.repos, { tipo: "user.note", workspace_id: "w", id: "n2", titulo: "baixa", texto: "nota de baixa prioridade", ocorrido_em: "2026-09-01T00:00:00.000Z" }, PRIORIDADE.backfill, s.colecaoId);
    enfileirar(s.repos, { tipo: "user.note", workspace_id: "w", id: "n1", titulo: "alta", texto: "nota de alta prioridade", ocorrido_em: "2026-09-01T00:00:00.000Z" }, PRIORIDADE.usuario, s.colecaoId);
    s.repos.fila.enfileirar("{isto não é json", 1, 5000, s.colecaoId);
    expect(s.repos.fila.pendentes()).toBe(3);
    for (let i = 0; i < 4; i++) await drenar({ repos: s.repos, pipeline: s.pipeline, colecao_id: s.colecaoId, orcamentoMs: 1000 });
    expect(s.repos.fila.pendentes()).toBe(0);
    expect(s.estado().documentos).toBe(2);
    fechar();
  });
  it("respeita o orçamento de tempo da fatia", async () => {
    const { s, fechar } = novoServico();
    for (let i = 0; i < 5; i++) enfileirar(s.repos, { tipo: "user.note", workspace_id: "w", id: `n${i}`, titulo: `t${i}`, texto: `texto ${i}`, ocorrido_em: "2026-09-01T00:00:00.000Z" }, undefined, s.colecaoId);
    let t = 0;
    const r = await drenar({ repos: s.repos, pipeline: s.pipeline, colecao_id: s.colecaoId, orcamentoMs: 10, agora: () => (t += 6) });
    expect(r.processados).toBeLessThan(5);
    expect(r.restantes).toBeGreaterThan(0);
    fechar();
  });
});

describe("backfill em fatias (P-73)", () => {
  async function* docs(n: number, prefixo: string) {
    for (let i = 0; i < n; i++) yield doc({ origem: `docs/${prefixo}${i}.md`, texto: `# ${prefixo}${i}\n\nconteúdo número ${i} do ${prefixo}` });
  }
  it("ordem docs → commits → código → transcrições, cedendo o laço entre fatias, com progresso", async () => {
    const { s, fechar } = novoServico();
    const fases: string[] = [];
    let cedidas = 0;
    let t = 0;
    const r = await executarBackfill({
      pipeline: s.pipeline,
      colecao_id: s.colecaoId,
      fontes: {
        codigo: () => docs(5, "cod"),
        docs: () => docs(6, "doc"),
        commits: async function* () {
          yield { tipo: "vcs.commit" as const, workspace_id: "w", sha: "abc1234", mensagem: "feat: algo", autor: null, arquivos: [], ocorrido_em: "2026-09-01T00:00:00.000Z", mission_id: null };
        },
      },
      fatiaMs: 5,
      agora: () => (t += 2),
      ceder: async () => void cedidas++,
      progresso: (p) => void (fases[fases.length - 1] !== p.fase && fases.push(p.fase)),
    });
    expect(fases).toEqual(["docs", "commits", "codigo"]);
    expect(r.feitos).toBe(12);
    expect(r.novos).toBe(12);
    expect(cedidas).toBeGreaterThan(2);
    expect(r.porFase).toMatchObject({ docs: 6, commits: 1, codigo: 5, transcricoes: 0 });
    // retomável: repetir não duplica (hash igual → inalterado)
    const r2 = await executarBackfill({ pipeline: s.pipeline, colecao_id: s.colecaoId, fontes: { docs: () => docs(6, "doc") } });
    expect(r2.novos).toBe(0);
    expect(s.estado().documentos).toBe(12);
    fechar();
  });
  it("pausa sob pressão (flood de PTY) e aborta por sinal", async () => {
    const { s, fechar } = novoServico();
    let pressoes = 3;
    let cedeu = 0;
    const ctl = new AbortController();
    const r = await executarBackfill({
      pipeline: s.pipeline,
      colecao_id: s.colecaoId,
      fontes: { docs: () => docs(10, "p") },
      fatiaMs: 0,
      pressao: () => pressoes-- > 0,
      ceder: async () => {
        if (++cedeu === 6) ctl.abort();
      },
      sinal: ctl.signal,
    });
    expect(r.abortado).toBe(true);
    expect(cedeu).toBeGreaterThan(3);
    expect(r.feitos).toBeLessThan(10);
    fechar();
  });
});

describe("agendador", () => {
  const e = { filaPendente: 0, indiceCompleto: true, reembutindo: false, ultimaConsolidacaoMs: 1_000_000, agoraMs: 1_000_000 + 60_000, ocioso: true, missaoFechada: false };
  it.each([
    [{ ...e, filaPendente: 3, ocioso: false }, "fila"],
    [{ ...e, ocioso: false }, null],
    [{ ...e, indiceCompleto: false }, "aquecer"],
    [{ ...e, missaoFechada: true }, "consolidar"],
    [{ ...e, ultimaConsolidacaoMs: null }, "consolidar"],
    [{ ...e, agoraMs: 1_000_000 + 7 * 3600_000 }, "consolidar"],
    [{ ...e, reembutindo: true }, "reembutir"],
    [e, null],
  ] as const)("%j → %s", (est, esperado) => expect(proximoTrabalho(est)).toBe(esperado));
});
