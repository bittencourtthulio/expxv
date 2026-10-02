import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../../../tests/fixtures/mapa/compilar";
import { RAIZ_FIXTURES_MAPA } from "../../../tests/fixtures/mapa/comparar";
import { hashConteudo } from "./hash";
import { detectarLinguagem } from "./linguagens";
import { extrairArquivo } from "./extratores/registro";
import { criarPool, type Pool } from "./pool";
import { validarExtracao } from "./validacao";
import { executarExtracao } from "./worker-extracao";

const pastas: string[] = [];
const pools: Pool[] = [];
afterAll(async () => {
  for (const p of pools) await p.encerrar();
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivos(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n)) acc.push(p);
  }
  return acc;
}

describe("worker de extração: função pura (sem thread)", () => {
  const ler = (texto: string | Buffer) => async () => (typeof texto === "string" ? Buffer.from(texto) : texto);

  it("lê, calcula o hash do conteúdo normalizado e extrai", async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("export function a() {}\r\n")]);
    const r = await executarExtracao({ id: 7, tipo: "extrair", caminho_abs: "/p/src/a.test.ts", caminho: "src/a.test.ts", linguagem: "typescript" }, {}, ler(buf));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe(7);
    expect(r.extracao.hash).toBe(hashConteudo(Buffer.from("export function a() {}\n")));
    expect(r.extracao.e_teste).toBe(true); // o caminho relativo informado é o que vale
    expect(r.extracao.simbolos.map((s) => s.qualificado)).toEqual(["a"]);
    expect(validarExtracao(r.extracao).hash).toBe(r.extracao.hash);
  });

  it("arquivo de ambiente/chave: recusa SEM ler", async () => {
    let leituras = 0;
    const espiao = async (): Promise<Buffer> => (leituras++, Buffer.from("X=1"));
    for (const c of ["/p/.env", "/p/.env.local", "/p/chave.pem", "/p/id_rsa", "/p/x.key"]) {
      const r = await executarExtracao({ id: 1, tipo: "extrair", caminho_abs: c, linguagem: "typescript" }, {}, espiao);
      expect(r).toMatchObject({ ok: false, codigo: "arquivo_sensivel" });
    }
    expect(leituras).toBe(0);
  });

  it("falhas viram resposta (nunca lança): ilegível, grande, linguagem sem gramática, mensagem inválida", async () => {
    const base = { id: 3, tipo: "extrair" as const, caminho_abs: "/p/a.ts", linguagem: "typescript" as const };
    expect(
      await executarExtracao(base, {}, async () => {
        throw new Error("EACCES");
      }),
    ).toMatchObject({ ok: false, codigo: "arquivo_ilegivel", erro: "EACCES" });
    expect(await executarExtracao({ ...base, tamanho_max: 4 }, {}, ler("export const x = 1;"))).toMatchObject({ ok: false, codigo: "arquivo_ilegivel" });
    expect(await executarExtracao({ ...base, caminho_abs: "/p/a.py", linguagem: "python" }, {}, ler("x = 1"))).toMatchObject({ ok: true });
    expect(await executarExtracao({ ...base, linguagem: "outra" }, {}, ler("x"))).toMatchObject({ ok: true });
    expect(await executarExtracao({ id: 9, tipo: "xyz" } as never, {})).toMatchObject({ id: 9, ok: false, codigo: "erro" });
    expect(await executarExtracao({ id: 10, tipo: "extrair", caminho_abs: "", linguagem: "typescript" }, {})).toMatchObject({ ok: false, erro: "caminho ausente" });
  });
});

describe("worker de extração: thread real (JS compilado)", () => {
  it("o resultado pela thread é idêntico ao da execução direta, e erros ficam isolados por arquivo", async () => {
    const dist = compilarMapaParaTeste();
    const pool = criarPool({ caminhoWorker: join(dist, "nucleo/mapa/worker-extracao.js"), tamanho: 2 });
    pools.push(pool);
    const arqs = arquivos(RAIZ_FIXTURES_MAPA);
    expect(arqs.length).toBeGreaterThan(15);
    const tarefas = arqs.map((a) => {
      const rel = relative(RAIZ_FIXTURES_MAPA, a).split("\\").join("/");
      return { caminho_abs: a, caminho: rel.replace(/^[^/]+\//, ""), linguagem: detectarLinguagem(rel, "")! };
    });
    const rs = await pool.executarLote([...tarefas, { caminho_abs: join(tmpdir(), "nao-existe-xyz.ts"), linguagem: "typescript" as const }]);
    expect(rs[rs.length - 1]).toMatchObject({ ok: false, codigo: "arquivo_ilegivel" });
    for (let i = 0; i < tarefas.length; i++) {
      const r = rs[i]!;
      const t = tarefas[i]!;
      expect(r.ok, t.caminho).toBe(true);
      if (!r.ok) continue;
      const buf = readFileSync(t.caminho_abs);
      const direto = await extrairArquivo(buf.toString("utf8"), t.linguagem, t.caminho, { hash: hashConteudo(buf) });
      expect(JSON.parse(JSON.stringify(r.extracao)), t.caminho).toEqual(JSON.parse(JSON.stringify(direto)));
    }
  });

  it("linguagem sem extrator volta como erro da tarefa, sem derrubar o worker", async () => {
    const dist = compilarMapaParaTeste();
    const dir = mkdtempSync(join(tmpdir(), "mapa-wk-"));
    pastas.push(dir);
    writeFileSync(join(dir, "a.py"), "x = 1\n");
    writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
    const pool = criarPool({ caminhoWorker: join(dist, "nucleo/mapa/worker-extracao.js"), tamanho: 1 });
    pools.push(pool);
    const [py, ts] = await pool.executarLote([
      { caminho_abs: join(dir, "a.py"), linguagem: "python" },
      { caminho_abs: join(dir, "b.ts"), linguagem: "typescript" },
    ]);
    expect(py!.ok).toBe(true);
    expect(ts!.ok).toBe(true);
  });
});
