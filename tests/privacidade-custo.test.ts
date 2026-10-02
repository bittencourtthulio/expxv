import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { abrirBanco, migrar } from "../src/nucleo/banco";
import { criarRepositorios } from "../src/nucleo/banco/repos";
import { criarServicoCusto } from "../src/nucleo/custo";
import { gerarRegistros } from "./fixtures/custo/gerar";

// T-10.28 (parte de núcleo): custo e board não fazem rede, não leem conteúdo e nunca aceitam custo "autorrelatado".
const RAIZ = resolve(__dirname, "..");
function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const c = join(dir, nome);
    if (statSync(c).isDirectory()) arquivos(c, acc);
    else if (c.endsWith(".ts") && !c.endsWith(".test.ts")) acc.push(c);
  }
  return acc;
}
const fonte = (rel: string): string => readFileSync(join(RAIZ, rel), "utf8");
const semComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("esta fase não faz rede, não spawna processo e não importa Electron", () => {
  const alvos = [...arquivos(join(RAIZ, "src/nucleo/custo")), ...arquivos(join(RAIZ, "src/nucleo/board")), join(RAIZ, "src/main/custo.ts"), join(RAIZ, "src/main/custo-board.ts"), join(RAIZ, "src/main/ipc/custo.ts")];
  it("varre os arquivos esperados", () => expect(alvos.length).toBeGreaterThanOrEqual(15));
  it("nenhum fetch/http/https/net/dgram/child_process/electron nem WebSocket", () => {
    const proibidos = /\b(fetch\s*\(|node:https?|node:net|node:dgram|node:tls|child_process|from "electron"|WebSocket|XMLHttpRequest|http\.request|net\.connect)/;
    const achados = alvos.filter((a) => proibidos.test(semComentarios(readFileSync(a, "utf8")))).map((a) => relative(RAIZ, a));
    expect(achados).toEqual([]);
  });
  it("o núcleo (custo e board) não importa do main nem do renderer", () => {
    const achados = alvos.filter((a) => a.includes("nucleo") && /from "(\.\.\/)+(main|renderer|preload)\//.test(readFileSync(a, "utf8"))).map((a) => relative(RAIZ, a));
    expect(achados).toEqual([]);
  });
  it("o núcleo do custo e do board não abre arquivos (só `arquivo.ts` conhece caminhos e recebe `realpath` por injeção); exceção: os leitores de transcript das CLIs (T-10.04..07)", () => {
    // fronteira da Fase 10: SÓ `leitores/` abre o conteúdo do arquivo da CLI; `fontes.ts` (valida/localiza) e `ingestao.ts` (stat/watch) só tocam metadados; `worker.ts` só os leitores
    const LEITORES = /nucleo\/custo\/(leitores\/[^/]+|fontes|ingestao|worker)\.ts$/;
    const achados = [...arquivos(join(RAIZ, "src/nucleo/custo")), ...arquivos(join(RAIZ, "src/nucleo/board"))].filter((a) => !LEITORES.test(a)).filter((a) => /node:fs|readFile|writeFile|createReadStream/.test(semComentarios(readFileSync(a, "utf8")))).map((a) => relative(RAIZ, a));
    expect(achados).toEqual([]);
  });
});

describe("fronteira dos leitores (T-10.04..07)", () => {
  it("só `leitores/` lê o CONTEÚDO do arquivo da CLI; fontes.ts e ingestao.ts nunca abrem/leem", () => {
    for (const rel of ["src/nucleo/custo/fontes.ts", "src/nucleo/custo/ingestao.ts", "src/nucleo/custo/worker.ts"]) expect(semComentarios(fonte(rel))).not.toMatch(/readFile|createReadStream|\bopen\(|fh\.read/);
  });
  it("os leitores devolvem só {chave, ts, modelo, tokens, usd_medido?}: nenhuma extração de texto de conversa", () => {
    for (const rel of ["src/nucleo/custo/leitores/claude.ts", "src/nucleo/custo/leitores/codex.ts", "src/nucleo/custo/leitores/opencode.ts"]) expect(semComentarios(fonte(rel))).not.toMatch(/\[\"(content|text|prompt|cwd|summary|output_text|display)\"\]/);
  });
});

describe("nunca autorrelato (D-104)", () => {
  it("nenhum código do MCP, do handoff ou da orquestração importa o núcleo do custo", () => {
    const candidatos = [...arquivos(join(RAIZ, "src/nucleo/mcp")), join(RAIZ, "src/main/orquestracao.ts"), join(RAIZ, "src/main/mcp-worker.ts"), join(RAIZ, "src/main/mcp-remoto.ts")];
    const achados = candidatos.filter((a) => /nucleo\/custo|\.\.\/custo"|\.\/custo"/.test(readFileSync(a, "utf8"))).map((a) => relative(RAIZ, a));
    expect(achados).toEqual([]);
  });
  it("handoff_submit não lê campo de custo, tokens nem USD: o que o agente escrever não entra na conta", () => {
    expect(semComentarios(fonte("src/nucleo/mcp/tools/handoff.ts"))).not.toMatch(/\b(cost|custo|tokens?|usd)\b/i);
  });
  it("a única porta de escrita do custo é ingerir/ingerirProxy (fonte + registro extraído); nenhum canal IPC aceita valores", () => {
    const ipc = fonte("src/main/ipc/custo.ts");
    expect(ipc).not.toMatch(/ingerir|usd_medido|tokens_in|tokens_entrada/);
  });
});

describe("conteúdo nunca atravessa (sentinelas)", () => {
  const SENTINELAS = ["SENTINELA_FRASE_DE_CONVERSA", "SENTINELA_TRECHO_DE_CODIGO()", "/Users/fulano/SENTINELA_CAMINHO/segredo.ts"];
  it("campos extras num registro extraído (conteúdo do transcript) não chegam ao banco, ao evento, ao relatório nem ao diagnóstico", () => {
    const banco = abrirBanco(":memory:");
    migrar(banco);
    const r = criarRepositorios(banco);
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    const mis = r.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "M", trabalho_id: "w1" });
    const pane = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", papel: "executor" });
    const eventos: unknown[] = [];
    const s = criarServicoCusto({ banco, relogio: () => new Date("2026-06-10T12:00:00Z"), publicar: (t, p) => void eventos.push({ t, p }) });
    s.iniciarPrecos();
    const f = s.registrarFonte({ cli: "claude", base: "claude_config", relativo: "projects/p/s.jsonl", pane_id: pane.id, mission_id: mis.id, workspace_id: ws.id });
    const sujos = gerarRegistros(40).map((x, i) => ({ ...x, message: { content: SENTINELAS[0] }, texto: SENTINELAS[1], cwd: SENTINELAS[2], tokens: { ...x.tokens, conteudo: SENTINELAS[i % 3] } }));
    s.ingerir(f.id, sujos as never);
    s.definirTeto(mis.id, 0.01);
    s.ingerir(f.id, sujos as never);
    const tabelas = ["uso_fonte", "uso_registro", "janela_task", "custo_agregado", "custo_teto", "custo_alerta", "preco_modelo"];
    const dump = JSON.stringify(tabelas.map((t) => banco.consultar(`SELECT * FROM ${t}`))) + JSON.stringify(eventos) + s.diagnostico() + JSON.stringify(s.relatorio({ agrupar: "modelo", desde: "2026-06-01", ate: "2026-06-30" })) + JSON.stringify(s.resumoMissao(mis.id));
    for (const sentinela of SENTINELAS) expect(dump, sentinela).not.toContain(sentinela);
    expect(dump).not.toContain("SENTINELA");
    expect(banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n).toBe(40);
    banco.fechar();
  });
  it("o contrato compartilhado não declara campo de conteúdo de conversa nem caminho absoluto", () => {
    const t = semComentarios(fonte("src/compartilhado/custo.ts"));
    expect(t).not.toMatch(/^\s*(conteudo|texto|prompt|conversa|mensagem_usuario|transcript|caminho_absoluto|cwd|path)\??:/m);
  });
  it("a tabela de uso_fonte guarda base+relativo, nunca caminho absoluto (D-109)", () => {
    const sql = fonte("src/nucleo/banco/migracoes/0012-custo.ts");
    expect(sql).toMatch(/base TEXT NOT NULL CHECK \(base IN \('claude_config','codex_home','proxy','nenhuma'\)\)/);
    expect(sql).not.toMatch(/caminho_absoluto|\bpath TEXT/);
  });
});
