// Exportação (T-19.21): destino hostil, nunca sobrescreve, ZIP íntegro, escrita atômica e fora de .expxv. Armazenamento: symlink e travessia.
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portasFalsas, SPRINT_ID, T0, WS } from "../../../tests/fixtures/relatorios/gerar";
import { criarArmazenamento, refDePacoteValida } from "./exportar/armazenamento";
import { validarDestino, validarDestinoResolvido } from "./exportar/destino";
import { exportarPasta, exportarZip } from "./exportar/escrever";
import { crc32 } from "./formatos/zip";
import { criarRelatorios } from "./servico";

let raiz: string;
let dest: string;
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), "rel-ws-")); dest = await mkdtemp(join(tmpdir(), "rel-dest-")); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); await rm(dest, { recursive: true, force: true }); });

describe("destino de exportação", () => {
  const raizWs = "/home/ana/projeto";
  it.each([
    ["docs do projeto", "/home/ana/projeto/docs", /docs/],
    ["docs aninhado (maiúscula, volume sem diferença de caixa)", "/home/ana/projeto/Docs/sprintx/x", /docs/],
    ["git", "/home/ana/projeto/.git/hooks", /\.git/],
    ["node_modules", "/home/ana/projeto/node_modules/x", /node_modules/],
    ["pasta do método", "/home/ana/projeto/.expx/marketplace", /\.expx/],
    ["claude", "/home/ana/projeto/.claude", /\.claude/],
    ["sistema", "/etc/cron.d", /sistema/],
    ["sistema mac", "/System/Library", /sistema/],
    ["raiz do disco", "/", /raiz do disco/],
    ["relativo", "pasta/x", /diálogo/],
  ])("recusa %s", (_n, caminho, msg) => {
    expect(() => validarDestinoResolvido(caminho, raizWs)).toThrow(msg);
  });
  it("aceita pasta do usuário fora do projeto e pasta comum dentro dele", () => {
    expect(() => validarDestinoResolvido("/home/ana/Entregas", raizWs)).not.toThrow();
    expect(() => validarDestinoResolvido("/home/ana/projeto/entregas", raizWs)).not.toThrow();
  });
  it("symlink para docs/ é resolvido ANTES de comparar", async () => {
    await mkdir(join(raiz, "docs"), { recursive: true });
    await symlink(join(raiz, "docs"), join(dest, "atalho"));
    await expect(validarDestino(join(dest, "atalho"), raiz)).rejects.toThrow(/docs/);
    await expect(validarDestino(join(dest, "nao-existe"), raiz)).rejects.toThrow(/não existe/);
    expect(await validarDestino(dest, raiz)).toBeTruthy();
  });
});

describe("escrita da exportação", () => {
  const arq = [{ nome: "tecnico.md", conteudo: "# oi" }, { nome: "divulgacao/email.txt", conteudo: "olá" }];
  it("pasta: cria subpasta própria e NUNCA sobrescreve (sufixo -2, -3)", async () => {
    const a = await exportarPasta(dest, "relatorio-x-r1", arq);
    const b = await exportarPasta(dest, "relatorio-x-r1", arq);
    const c = await exportarPasta(dest, "relatorio-x-r1", arq);
    expect([a.nome, b.nome, c.nome]).toEqual(["relatorio-x-r1", "relatorio-x-r1-2", "relatorio-x-r1-3"]);
    expect(await readFile(join(dest, "relatorio-x-r1", "divulgacao", "email.txt"), "utf8")).toBe("olá");
  });
  it("ZIP: nome livre com sufixo, entradas dentro de uma pasta, CRC correto", async () => {
    const z1 = await exportarZip(dest, "relatorio-x-r1", arq, new Date(T0));
    const z2 = await exportarZip(dest, "relatorio-x-r1", arq, new Date(T0));
    expect([z1.nome, z2.nome]).toEqual(["relatorio-x-r1.zip", "relatorio-x-r1-2.zip"]);
    const buf = await readFile(join(dest, z1.nome));
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const nlen = dv.getUint16(26, true);
    expect(buf.subarray(30, 30 + nlen).toString()).toBe("relatorio-x-r1/tecnico.md");
    expect(dv.getUint32(14, true)).toBe(crc32(new TextEncoder().encode("# oi")));
  });
  it("nome de arquivo hostil é recusado antes de gravar", async () => {
    await expect(exportarPasta(dest, "x", [{ nome: "../fora.md", conteudo: "x" }])).rejects.toThrow();
    await expect(exportarZip(dest, "x", [{ nome: "/etc/passwd", conteudo: "x" }], new Date())).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
  });
});

describe("armazenamento em .expxv/relatorios", () => {
  it("referência só no formato <pasta do produto>/relatorios/<sprint>/r<N>", () => {
    expect(refDePacoteValida(".expxv/relatorios/spr_abc/r1")).toBe(true);
    for (const ruim of ["docs/x/r1", ".expxv/relatorios/../../docs/r1", "/abs/r1", ".expxv/relatorios/spr/r0", ".expxv/relatorios/spr/r1/extra", "C:/x/r1", ".expxv/relatorios/a b/r1"]) expect(refDePacoteValida(ruim)).toBe(false);
  });
  it("recusa referência hostil e pasta de relatórios que seja symlink para fora", async () => {
    const a = criarArmazenamento({ raizDe: () => raiz });
    await expect(a.gravarPacote(WS, "docs/x/r1", [{ nome: "a.md", conteudo: "x" }])).rejects.toThrow(/referência/);
    await mkdir(join(raiz, ".expxv"), { recursive: true });
    await symlink(dest, join(raiz, ".expxv", "relatorios"));
    await expect(a.gravarPacote(WS, ".expxv/relatorios/spr_a/r1", [{ nome: "a.md", conteudo: "x" }])).rejects.toThrow(/atalho/);
    expect(await readdir(dest)).toEqual([]);
  });
  it("grava, lê, substitui por arquivo (atômico) e recusa nome hostil", async () => {
    const a = criarArmazenamento({ raizDe: () => raiz });
    const ref = ".expxv/relatorios/spr_a/r1";
    await a.gravarPacote(WS, ref, [{ nome: "a.md", conteudo: "um" }, { nome: "divulgacao/b.txt", conteudo: "dois" }]);
    expect(await a.ler(WS, ref, "a.md")).toBe("um");
    expect(await a.ler(WS, ref, "nao.md")).toBeNull();
    await a.substituirArquivos(WS, ref, [{ nome: "a.md", conteudo: "tres" }]);
    expect(await a.ler(WS, ref, "a.md")).toBe("tres");
    expect(await a.existe(WS, ref)).toBe(true);
    expect(await a.existe(WS, ".expxv/relatorios/spr_a/r2")).toBe(false);
    await expect(a.gravarPacote(WS, ".expxv/relatorios/spr_a/r2", [{ nome: "../x.md", conteudo: "x" }])).rejects.toThrow(/nome/);
    await expect(a.ler(WS, ref, "../../../etc/passwd")).rejects.toThrow(/nome/);
    expect((await readdir(join(raiz, ".expxv/relatorios/spr_a"))).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
  it("sem raiz do workspace: erro nominal", async () => {
    await expect(criarArmazenamento({ raizDe: () => null }).gravarPacote(WS, ".expxv/relatorios/spr_a/r1", [])).rejects.toThrow(/workspace/);
  });
});

describe("Exportar para… (serviço)", () => {
  function montar() {
    const portas = portasFalsas({ workspace: { raiz: () => raiz } });
    return criarRelatorios({ portas, relogio: () => T0 });
  }
  it("pasta: copia o que foi escolhido, confere o hash e informa só o rótulo (nunca o caminho)", async () => {
    const r = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const res = await r.exportar(WS, pacote_id, ["tecnico.md", "tasks.csv"], "pasta", async () => dest);
    expect(res.cancelado).toBe(false);
    expect(res.arquivos).toEqual(["tecnico.md", "tasks.csv"]);
    expect(res.destino_rotulo).not.toContain(dest);
    expect(await readdir(join(dest, `relatorio-${SPRINT_ID}-r1`))).toEqual(["tasks.csv", "tecnico.md"]);
  });
  it("zip de todos os arquivos (inclui o manifesto) e cancelar o diálogo não grava nada", async () => {
    const r = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    expect((await r.exportar(WS, pacote_id, "todos", "zip", async () => null)).cancelado).toBe(true);
    expect(await readdir(dest)).toEqual([]);
    const res = await r.exportar(WS, pacote_id, "todos", "zip", async () => dest);
    expect(res.arquivos).toContain("manifesto.json");
    expect(await readdir(dest)).toEqual([`relatorio-${SPRINT_ID}-r1.zip`]);
  });
  it("destino em docs/ do projeto é recusado com mensagem; arquivo adulterado impede a exportação; nome fora do pacote é recusado", async () => {
    const r = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    await mkdir(join(raiz, "docs"), { recursive: true });
    await expect(r.exportar(WS, pacote_id, "todos", "pasta", async () => join(raiz, "docs"))).rejects.toThrow(/não escreve em docs/);
    expect(await readdir(join(raiz, "docs"))).toEqual([]);
    await expect(r.exportar(WS, pacote_id, ["../x.md"], "pasta", async () => dest)).rejects.toThrow(/não faz parte/);
    const p = await r.ler(WS, pacote_id);
    await writeFile(join(raiz, p.pasta_ref, "tasks.csv"), "adulterado");
    await expect(r.exportar(WS, pacote_id, ["tasks.csv"], "pasta", async () => dest)).rejects.toThrow(/alterado/);
  });
});
