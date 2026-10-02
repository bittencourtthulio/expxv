import { afterEach, describe, expect, it } from "vitest";
import { montarEvento } from "../memoria/eventos-conhecimento";
import { doc, novoServico } from "../../../tests/fixtures/conhecimento/util";

const abertos: Array<() => void> = [];
afterEach(() => abertos.splice(0).forEach((f) => f()));
const criar = (...a: Parameters<typeof novoServico>) => {
  const r = novoServico(...a);
  abertos.push(r.fechar);
  return r.s;
};

describe("ServicoConhecimento: ingestão, busca e contexto", () => {
  it("ingere, acha por termo raro (lexical) e é idempotente", async () => {
    const s = criar();
    const texto = "# Exportar CSV\n\nImplementamos a rotina zanzibar para exportar relatórios em CSV.";
    const r1 = await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/exportar.md", texto }));
    expect(r1.estado).toBe("novo");
    const r2 = await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/exportar.md", texto }));
    expect(r2.estado).toBe("inalterado");
    const b = await s.buscar({ consulta: "zanzibar", modo: "lexical" });
    expect(b.estado).toBe("ok");
    expect(b.resultados[0]?.fonte.origem).toBe("docs/exportar.md");
    expect(s.estado().documentos).toBe(1);
  });

  it("conteúdo novo na mesma origem substitui a versão antiga (sem resíduo)", async () => {
    const s = criar();
    await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/a.md", texto: "versao antiga com palavra quimera" }));
    const r = await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/a.md", texto: "versao nova com palavra fenix" }));
    expect(r.estado).toBe("substituido");
    expect((await s.buscar({ consulta: "quimera", modo: "lexical" })).resultados).toHaveLength(0);
    expect((await s.buscar({ consulta: "fenix", modo: "lexical" })).resultados).toHaveLength(1);
    expect(s.estado().chunks).toBe(1);
  });

  it("redige segredo ANTES de indexar e recusa arquivo de ambiente", async () => {
    const s = criar();
    const segredo = ["sk", "ant", "api03", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("-");
    await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/x.md", texto: `A chave ${segredo} vazou na task` }));
    const todos = s.repos.banco.consultar<{ texto: string }>("SELECT texto FROM rag_chunk");
    expect(JSON.stringify(todos)).not.toContain("ABCDEFGHIJ");
    expect(JSON.stringify(s.repos.banco.consultar("SELECT * FROM rag_documento"))).not.toContain("ABCDEFGHIJ");
    const r = await s.pipeline.ingerir(s.colecaoId, doc({ origem: `.${"env"}.production`, texto: "TOKEN=abc", formato: "codigo", tipo: "codigo" }));
    expect(r.estado).toBe("proibido");
  });

  it("caminho absoluto no texto vira relativo (nenhum nome de usuário/raiz persiste)", async () => {
    const s = criar();
    await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/p.md", texto: "Editei /work/proj/src/a.ts e /Users/maria/outro/b.ts" }));
    const t = s.repos.banco
      .consultar<{ texto: string }>("SELECT texto FROM rag_chunk")
      .map((r) => r.texto)
      .join("\n");
    expect(t).not.toContain("/work/proj/");
    expect(t).not.toContain("maria");
  });

  it("contexto prévio: 'já existe' com fonte, envelope de dados e consulta registrada", async () => {
    const s = criar();
    await s.pipeline.ingerir(s.colecaoId, doc({ tipo: "task", origem: "task:T-03.02", titulo: "T-03.02 exportar CSV concluída", texto: "Exportar CSV de pedidos: implementado em src/exportar.ts com rotina exportarCsv.", task_ref: "T-03.02" }));
    const c = await s.contexto({ tarefa: "preciso implementar exportar CSV de pedidos", mission_id: "mis_1", task_ref: "T-09.01" });
    expect(c.sinais.ja_existe).toBe(true);
    expect(c.markdown).toContain("<conhecimento_previo");
    expect(c.markdown).toContain('tipo="dados"');
    expect(c.markdown.match(/<\/conhecimento_previo>/g)).toHaveLength(1);
    expect(c.sinais.fontes[0]?.origem).toBe("task:T-03.02");
    expect(s.consultouRecentemente("mis_1", "T-09.01")).toBe(true);
  });

  it("RAG vazio: registro gravado e nunca lança; desligado idem", async () => {
    let ligado = true;
    const s = criar({ ativo: () => ligado });
    const c = await s.contexto({ tarefa: "algo inexistente xyzzy", mission_id: "m", task_ref: "t" });
    expect(["vazio", "ok"]).toContain(c.estado);
    expect(s.consultouRecentemente("m", "t")).toBe(true);
    ligado = false;
    const d = await s.contexto({ tarefa: "x", mission_id: "m2", task_ref: "t2" });
    expect(d.estado).toBe("desligado");
    expect(s.consultouRecentemente("m2", "t2")).toBe(true);
  });

  it("registrar (porta da Fase 8) só enfileira e a fila é drenada em fatia", async () => {
    const s = criar();
    const ev = montarEvento({ tipo: "handoff.submitted", workspace_id: "ws_1", chave_natural: "h1", ocorrido_em: "2026-09-01T10:00:00.000Z", titulo: "Handoff T-01.01", texto: "Concluí a tela de login com validação ldap.", fonte: "agente", importancia: 3, mission_id: "mis_1", referencias: [{ tipo: "handoff", id: "h1" }] });
    s.registrar(ev);
    expect(s.estado().indexando.pendentes).toBe(1);
    expect(s.estado().documentos).toBe(0);
    const r = await s.processarFila(50);
    expect(r.processados).toBe(1);
    expect((await s.buscar({ consulta: "ldap", modo: "lexical" })).resultados.length).toBe(1);
  });

  it("esquecer remove tudo e impede reentrada (tombstone); purgar exige o nome", async () => {
    const s = criar();
    const d = doc({ origem: "docs/z.md", texto: "conteudo efemero gerânio" });
    const r = await s.pipeline.ingerir(s.colecaoId, d);
    expect(s.esquecer({ documento_id: r.documento_id as string }).removidos).toBe(1);
    expect((await s.pipeline.ingerir(s.colecaoId, d)).estado).toBe("recusado");
    await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/w.md", texto: "outro conteudo" }));
    expect(s.purgar("errado")).toBeNull();
    expect(s.purgar("meu-projeto")?.removidos).toBe(1);
  });

  it("sem FTS5 cai em LIKE e continua achando", async () => {
    const s = criar({ fts5: false }, { semFts: true });
    await s.pipeline.ingerir(s.colecaoId, doc({ origem: "docs/l.md", texto: "a palavra rarissima habita aqui" }));
    expect((await s.buscar({ consulta: "rarissima", modo: "lexical" })).resultados).toHaveLength(1);
  });
});
