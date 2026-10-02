import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { novoServico, T0 } from "../../../../tests/fixtures/conhecimento/util";
import type { MapaLeitura } from "../../mapa/contrato";
import { montarEvento } from "../../memoria/eventos-conhecimento";
import { lerCodigo } from "./codigo";
import { codigoIndexavel, criarDiscoNode } from "./disco";
import { lerDocs } from "./docs";
import { classificarDocumento, mapearEntrada, mapearEvento } from "./dominio";
import { lerCommits, type PortaGit } from "./git";
import { sincronizarMapa } from "./mapa";
import { HistoricoSemConsentimentoErro, lerTranscricao } from "./transcricoes";
import { parsearClaude } from "./transcricoes/claude";
import { parsearCodex } from "./transcricoes/codex";

const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const AMB = `.${"env"}`;

function repoTmp(): string {
  const p = mkdtempSync(join(tmpdir(), "ade-fonte-"));
  pastas.push(p);
  mkdirSync(join(p, "docs/relatorios"), { recursive: true });
  mkdirSync(join(p, "src"), { recursive: true });
  writeFileSync(join(p, "docs/relatorios/causa-raiz-oc1.md"), "# Causa raiz\n\n## Causa raiz\n\n- O cache não era invalidado ao salvar.\n");
  writeFileSync(join(p, "docs/plano.md"), "# Plano\n\nTexto do plano.");
  writeFileSync(join(p, "INDICE.md"), "# Índice\n\n- item");
  writeFileSync(join(p, "src/a.ts"), "export function alfa() { return 1; }\n");
  writeFileSync(join(p, "src/b.py"), "def beta():\n    return 2\n");
  writeFileSync(join(p, AMB), "conteudo-que-nunca-deve-ser-lido");
  writeFileSync(join(p, "src/chave.pem"), "conteudo de chave que nunca deve ser lido");
  writeFileSync(join(p, "src/bin.ts"), Buffer.from([0x61, 0x00, 0x62]));
  writeFileSync(join(p, "src/grande.ts"), "x".repeat(300 * 1024));
  writeFileSync(join(p, "package-lock.json"), "{}");
  return p;
}

describe("disco: denylist e limites", () => {
  it("nunca lê arquivo de ambiente/chave, binário nem acima do teto; não segue symlink", async () => {
    const raiz = repoTmp();
    symlinkSync("/etc/hosts", join(raiz, "docs/hosts.md"));
    const d = criarDiscoNode(raiz);
    expect(await d.ler(AMB)).toBeNull();
    expect(await d.ler("src/chave.pem")).toBeNull();
    expect(await d.ler("src/bin.ts")).toBeNull();
    expect(await d.ler("src/grande.ts")).toBeNull();
    expect(await d.ler("../fora.txt")).toBeNull();
    expect(await d.ler("src/a.ts")).toContain("alfa");
    const docs = (await d.listarDocs(["docs"])).map((x) => x.rel);
    expect(docs).toEqual(expect.arrayContaining(["docs/plano.md", "docs/relatorios/causa-raiz-oc1.md"]));
    expect(docs).not.toContain("docs/hosts.md");
    expect(codigoIndexavel("package-lock.json")).toBe(false);
    expect(codigoIndexavel("dist/x.js")).toBe(false);
    expect(codigoIndexavel("src/app.min.js")).toBe(false);
    expect(codigoIndexavel("src/app.ts")).toBe(true);
  });
  it("listarVersionados usa git ls-files (e devolve vazio fora de repositório)", async () => {
    const raiz = repoTmp();
    expect(await criarDiscoNode(raiz).listarVersionados()).toEqual([]);
    execFileSync("git", ["init", "-q"], { cwd: raiz });
    execFileSync("git", ["add", "src/a.ts", "src/b.py"], { cwd: raiz });
    expect((await criarDiscoNode(raiz).listarVersionados()).sort()).toEqual(["src/a.ts", "src/b.py"]);
  });
});

describe("fonte docs e código (incremental)", () => {
  it("indexa docs/ + INDICE; segunda varredura não relê; alteração reindexa; classifica por caminho", async () => {
    const raiz = repoTmp();
    const { s, fechar } = novoServico({ raiz });
    const disco = criarDiscoNode(raiz);
    const run = async () => {
      const lista = [];
      for await (const d of lerDocs({ disco, repos: s.repos, colecao_id: s.colecaoId, agora: () => T0 })) lista.push(d);
      return lista;
    };
    const a = await run();
    expect(a.map((d) => [d.origem, d.tipo]).sort()).toEqual([["INDICE.md", "relatorio"], ["docs/plano.md", "doc"], ["docs/relatorios/causa-raiz-oc1.md", "causa_raiz"]]);
    for (const d of a) await s.pipeline.ingerir(s.colecaoId, d);
    expect(await run()).toHaveLength(0);
    writeFileSync(join(raiz, "docs/plano.md"), "# Plano\n\nTexto novo do plano, bem maior que antes para mudar o tamanho.");
    expect((await run()).map((d) => d.origem)).toEqual(["docs/plano.md"]);
    // aprendizado extraído da seção Causa raiz do relatório
    expect(s.estado().aprendizados.ativo).toBe(1);
    fechar();
  });
  it("código: só versionados, sem proibidos/binário/lock/gigante; símbolos por arquivo", async () => {
    const raiz = repoTmp();
    const { s, fechar } = novoServico({ raiz });
    const lista = [];
    for await (const d of lerCodigo({ disco: criarDiscoNode(raiz), repos: s.repos, colecao_id: s.colecaoId, versionados: ["src/a.ts", "src/b.py", AMB, "src/chave.pem", "src/bin.ts", "src/grande.ts", "package-lock.json", "docs/plano.md"] })) lista.push(d);
    expect(lista.map((d) => d.origem).sort()).toEqual(["src/a.ts", "src/b.py"]);
    for (const d of lista) expect((await s.pipeline.ingerir(s.colecaoId, d)).estado).toBe("novo");
    expect((await s.buscar({ consulta: "alfa", modo: "lexical" })).resultados[0]?.fonte.origem).toBe("src/a.ts");
    fechar();
  });
});

describe("fonte git (incremental por sha)", () => {
  it("emite só commits novos e guarda o cursor", async () => {
    const { s, fechar } = novoServico();
    const todos = ["c1", "c2", "c3"].map((sha) => ({ sha, mensagem: `fix: corrige ${sha}`, autor: "a", em: T0, arquivos: [{ caminho: "src/a.ts", status: "M" }] }));
    const git: PortaGit = { head: async () => "c3", commitsDesde: async (ult) => (ult === null ? todos : todos.slice(todos.findIndex((c) => c.sha === ult) + 1)) };
    const ler = async () => {
      const r = [];
      for await (const e of lerCommits({ git, repos: s.repos, colecao_id: s.colecaoId, workspace_id: "ws_1" })) r.push(e);
      return r;
    };
    expect((await ler()).length).toBe(3);
    expect((await ler()).length).toBe(0);
    fechar();
  });
});

describe("transcrições", () => {
  const linha = (o: unknown) => `${JSON.stringify(o)}\n`;
  const claude =
    linha({ type: "user", message: { role: "user", content: "corrige o bug do login" } }) +
    linha({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "RACIOCINIO SECRETO" }, { type: "tool_use", name: "Edit", input: { file_path: "src/login.ts" } }] } }) +
    linha({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "SAIDA DE FERRAMENTA CONFIDENCIAL" }] } }) +
    linha({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Corrigi o login em src/login.ts." }] } }) +
    linha({ type: "user", message: { role: "user", content: "<system-reminder>ruído</system-reminder>" } }) +
    linha({ type: "user", message: { role: "user", content: "agora o logout" } }) +
    linha({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Feito o logout." }] } });
  it("Claude: usuário + resposta final + tools; sem saída de ferramenta nem raciocínio", () => {
    const r = parsearClaude(claude);
    expect(r.trocas).toHaveLength(2);
    expect(r.trocas[0]).toMatchObject({ usuario: "corrige o bug do login", resposta: "Corrigi o login em src/login.ts.", ferramentas: ["Edit"], arquivos: ["src/login.ts"] });
    const json = JSON.stringify(r);
    expect(json).not.toContain("RACIOCINIO SECRETO");
    expect(json).not.toContain("SAIDA DE FERRAMENTA");
    expect(json).not.toContain("system-reminder");
  });
  it("offset: só linhas completas; reler não duplica; linha parcial espera", () => {
    const parcial = `${claude}{"type":"user","message":{"role":"user","content":"incomple`;
    const a = parsearClaude(parcial);
    expect(a.trocas).toHaveLength(2);
    expect(a.offset).toBe(Buffer.byteLength(claude));
    expect(parsearClaude(parcial, a.offset).trocas).toHaveLength(0);
    const completo = `${claude}${linha({ type: "user", message: { role: "user", content: "terceira" } })}${linha({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok terceira" }] } })}`;
    expect(parsearClaude(completo, a.offset).trocas.map((t) => t.usuario)).toEqual(["terceira"]);
  });
  it("Codex: mensagens e function_call; ignora o resto e linhas ilegíveis", () => {
    const j =
      linha({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "faz o teste" }] } }) +
      "lixo não json\n" +
      linha({ type: "response_item", payload: { type: "function_call", name: "shell" } }) +
      linha({ type: "response_item", payload: { type: "function_call_output", output: "SAIDA" } }) +
      linha({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Teste escrito." }] } });
    const r = parsearCodex(j);
    expect(r.trocas).toEqual([{ usuario: "faz o teste", resposta: "Teste escrito.", ferramentas: ["shell"], arquivos: [] }]);
    expect(JSON.stringify(r)).not.toContain("SAIDA");
  });
  it("histórico antigo exige consentimento (AC-15.23); sessão do app passa; offset evita reler", () => {
    const { s, fechar } = novoServico();
    const base = { repos: s.repos, colecao_id: s.colecaoId, workspace_id: "ws_1" };
    const sess = { sessao_id: "s1", cli: "claude" as const, modelo: "opus", mission_id: "mis_1", pane_id: "pane_1", jsonl: claude, ocorrido_em: T0 };
    expect(() => lerTranscricao({ ...base, sessao: { ...sess, iniciadaPeloApp: false } })).toThrow(HistoricoSemConsentimentoErro);
    expect(lerTranscricao({ ...base, sessao: { ...sess, iniciadaPeloApp: false }, consentimentoHistorico: true })).toHaveLength(2);
    expect(lerTranscricao({ ...base, sessao: { ...sess, iniciadaPeloApp: false }, consentimentoHistorico: true })).toHaveLength(0);
    fechar();
  });
  it("turno de sessão vira chunk de transcrição, agente no grafo, sem saída de ferramenta", async () => {
    const { s, fechar } = novoServico();
    const evs = lerTranscricao({ repos: s.repos, colecao_id: s.colecaoId, workspace_id: "ws_1", sessao: { sessao_id: "s2", cli: "claude", modelo: "opus", mission_id: "mis_1", pane_id: "pane_1", jsonl: claude, ocorrido_em: T0, iniciadaPeloApp: true } });
    for (const e of evs) await s.pipeline.ingerirEntrada(s.colecaoId, e);
    const r = await s.buscar({ consulta: "logout", modo: "lexical", tipos: ["transcricao"] });
    expect(r.resultados[0]?.fonte.origem).toBe("sessao:s2#1");
    expect(s.subgrafo({ tipos: ["agente"] }).nos[0]?.rotulo).toBe("claude·opus");
    expect((await s.buscar({ consulta: "CONFIDENCIAL", modo: "lexical" })).resultados).toHaveLength(0);
    fechar();
  });
});

describe("mapeamento do domínio e do mapa", () => {
  const base = { workspace_id: "ws_1", ocorrido_em: T0, fonte: "agente" as const, importancia: 3, titulo: "Título T-04.01", texto: "corpo do evento" };
  it("cada evento da Fase 8 vira o tipo certo com chave natural estável", () => {
    const ev = (tipo: Parameters<typeof montarEvento>[0]["tipo"], extra: Partial<Parameters<typeof montarEvento>[0]> = {}) => mapearEvento(montarEvento({ ...base, tipo, chave_natural: "k1", ...extra }));
    expect(ev("handoff.submitted", { referencias: [{ tipo: "handoff", id: "h9" }] }).docs[0]).toMatchObject({ tipo: "handoff", origem: "handoff:h9", task_ref: "T-04.01" });
    expect(ev("task.updated").docs[0]).toMatchObject({ tipo: "task", origem: "task:T-04.01" });
    expect(ev("mission.closed", { mission_id: "mis_7" }).docs[0]).toMatchObject({ tipo: "missao", origem: "mission:mis_7" });
    expect(ev("memory.decision", { referencias: [{ tipo: "entrada_memoria", id: "e1" }] })).toMatchObject({ memoria: "decision", docs: [{ tipo: "decisao", origem: "memoria:e1" }] });
    expect(ev("memory.learning").memoria).toBe("learning");
    expect(ev("method.changed", { referencias: [{ tipo: "arquivo_rel", id: "docs/qa/qa-final.md" }] }).docs[0]).toMatchObject({ tipo: "qa", origem: "docs/qa/qa-final.md" });
    expect(ev("method.changed", { referencias: [{ tipo: "arquivo_rel", id: AMB }] }).docs).toHaveLength(0);
    expect(ev("method.changed").docs).toHaveLength(0);
    expect(ev("handoff.submitted", { referencias: [{ tipo: "handoff", id: "h9" }] }).docs[0]).toEqual(ev("handoff.submitted", { referencias: [{ tipo: "handoff", id: "h9" }] }).docs[0]);
  });
  it("entradas internas: arquivo proibido some; nota é do usuário; chat tem índice", () => {
    expect(mapearEntrada({ tipo: "file.changed", workspace_id: "w", caminho: AMB, texto: "x", ocorrido_em: T0 }).docs).toHaveLength(0);
    expect(mapearEntrada({ tipo: "file.changed", workspace_id: "w", caminho: "docs/a.md", texto: "x", ocorrido_em: T0 }).docs[0]?.formato).toBe("markdown");
    expect(mapearEntrada({ tipo: "file.changed", workspace_id: "w", caminho: "src/a.ts", texto: "x", ocorrido_em: T0 }).docs[0]).toMatchObject({ tipo: "codigo", formato: "codigo" });
    expect(mapearEntrada({ tipo: "user.note", workspace_id: "w", id: "n1", titulo: "t", texto: "x", ocorrido_em: T0 }).docs[0]).toMatchObject({ fonte: "usuario", importancia: 4 });
    expect(mapearEntrada({ tipo: "chat.exchange", workspace_id: "w", conversa_id: "c", indice: 3, pergunta: "p", resposta: "r", ocorrido_em: T0 }).docs[0]?.origem).toBe("chat:c#3");
    expect(classificarDocumento("docs/sprintx/x/ORQUESTRADOR.md")).toBe("relatorio");
    expect(classificarDocumento("docs/decisoes.md")).toBe("decisao");
    expect(classificarDocumento("docs/arquitetura.md")).toBe("doc");
  });
  it("mapa (Fase 17): arestas `depende` entre arquivos e símbolos, só pela interface de leitura", () => {
    const no = (id: string, tipo: string) => ({ id, tipo, subtipo: null, rotulo: id, arquivo_id: null, linha_ini: null, linha_fim: null, exportado: null, atributos: null }) as never;
    const mapa: MapaLeitura = {
      resumo: () => ({ estado: "pronto", versao_mapa: 1, analisado_em: T0, arquivos: 2, linguagens: [], arestas: { exata: 1, heuristica: 0 }, historia: "ok", desatualizado: false }),
      no: (id) => (id.startsWith("arq:") ? no(id, "arquivo") : undefined),
      vizinhos: (id) => (id === "arq:src/a.ts" ? [{ aresta: { tipo: "importa", de: id, para: "arq:src/b.ts", confianca: "exata", peso: 1, candidatos: null, fonte: "extracao", arquivo_id: null, linha: 1, evidencias: null }, no: no("arq:src/b.ts", "arquivo") }] : []),
      buscar: () => [no("sim:src/a.ts#alfa", "simbolo")],
    };
    const { s, fechar } = novoServico();
    const r = sincronizarMapa({ mapa, repos: s.repos, colecao_id: s.colecaoId, arquivos: ["src/a.ts"], quando: T0 });
    expect(r.arestas).toBeGreaterThanOrEqual(2);
    const sg = s.subgrafo({});
    expect(sg.arestas.some((a) => a.tipo === "depende")).toBe(true);
    expect(sg.nos.map((n) => n.rotulo)).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts", "alfa"]));
    sincronizarMapa({ mapa, repos: s.repos, colecao_id: s.colecaoId, arquivos: ["src/a.ts"], quando: T0 });
    expect(s.subgrafo({}).arestas.length).toBe(sg.arestas.length);
    expect(sincronizarMapa({ mapa: { ...mapa, resumo: () => ({ ...mapa.resumo(), estado: "vazio" }) }, repos: s.repos, colecao_id: s.colecaoId, arquivos: ["src/a.ts"], quando: T0 })).toEqual({ nos: 0, arestas: 0 });
    fechar();
  });
});
