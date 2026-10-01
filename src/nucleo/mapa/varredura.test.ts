import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";
import { PRODUTO } from "../produto";
import { hashConteudo } from "./hash";
import { fsReal, TAMANHO_LOTE, varrer, varrerTudo, type EntradaCacheVarredura, type FsVarredura, type MotivoIgnorado } from "./varredura";

const pastas: string[] = [];
beforeAll(isolarConfigGit);
afterEach(() => {
  for (const p of pastas.splice(0)) removerPasta(p);
});

function novaPasta(): string {
  const p = pastaTmp("mapa-var-");
  pastas.push(p);
  return p;
}

/** Projeto com um pouco de tudo que a varredura precisa decidir. */
function montar(raiz: string): void {
  escrever(raiz, ".gitignore", "*.log\nsaida/\n!manter.log\n");
  escrever(raiz, "src/a.ts", "export const a = 1;\n");
  escrever(raiz, "src/b.py", "x = 1\n");
  escrever(raiz, "src/c.tsx", "export const C = () => null;\n");
  escrever(raiz, "src/nota.md", "# nada\n");
  escrever(raiz, "src/Mod.kt", "class A\n");
  escrever(raiz, "src/pacote.log", "ignorado pelo gitignore\n");
  escrever(raiz, "src/manter.log", "log\n"); // negado no gitignore, mas .log não é linguagem
  escrever(raiz, "saida/gerado.ts", "export {};\n");
  escrever(raiz, "node_modules/lib/index.js", "module.exports = 1;\n");
  escrever(raiz, "vendor/x.php", "<?php\n");
  escrever(raiz, "dist/o.js", "var o;\n");
  escrever(raiz, `${PRODUTO.pastaNoProjeto}/mapa/x.json`, "{}");
  escrever(raiz, ".env", "SEGREDO=1\n");
  escrever(raiz, ".env.local", "SEGREDO=2\n");
  escrever(raiz, "chaves/servidor.pem", "-----BEGIN-----\n");
  escrever(raiz, "chaves/id_rsa", "x");
  escrever(raiz, "chaves/app.key", "x");
  escrever(raiz, "src/min.js", `${"a=1;".repeat(1000)}\n`); // 1 linha de 4 000 caracteres
  escrever(raiz, "src/binario.ts", Buffer.from([0x41, 0x00, 0x42, 0x43]));
  escrever(raiz, "src/grande.ts", `// ${"x".repeat(1_100_000)}\n`);
  escrever(raiz, "bin/run", "#!/usr/bin/env node\nconsole.log(1);\n");
  escrever(raiz, "App/App.csproj", "<Project/>");
  escrever(raiz, "App/bin/Debug/x.cs", "class X {}");
  escrever(raiz, "App/obj/y.cs", "class Y {}");
  escrever(raiz, "solto/bin/z.go", "package z\n");
  escrever(raiz, "package.json", '{"name":"x"}');
  escrever(raiz, "package-lock.json", '{"lockfileVersion":3}');
  escrever(raiz, ".github/workflows/ci.yml", "on: push\n");
}

const CAMINHOS_ACEITOS = [
  ".github/workflows/ci.yml",
  "App/App.csproj",
  "bin/run",
  "package-lock.json",
  "package.json",
  "solto/bin/z.go",
  "src/Mod.kt",
  "src/a.ts",
  "src/b.py",
  "src/c.tsx",
];

describe("varredura de arquivos (T-17.03)", () => {
  for (const modo of ["git", "caminhada"] as const) {
    it(`[${modo}] aceita só o que deve e explica cada ignorado`, async () => {
      const raiz = novaPasta();
      montar(raiz);
      if (modo === "git") initRepo(raiz, false);
      const { arquivos, ignorados, resumo } = await varrerTudo(raiz, { usarGit: modo === "git" });
      expect(resumo.origem).toBe(modo);
      expect(arquivos.map((a) => a.caminho).sort()).toEqual(CAMINHOS_ACEITOS);
      const motivo = (c: string): MotivoIgnorado | undefined => ignorados.find((i) => i.caminho === c)?.motivo;
      expect(motivo("src/min.js")).toBe("minificado");
      expect(motivo("src/binario.ts")).toBe("binario");
      expect(motivo("src/grande.ts")).toBe("grande");
      expect(motivo("src/nota.md")).toBe("linguagem_desconhecida");
      expect(motivo(".env")).toBe("sensivel");
      expect(motivo(".env.local")).toBe("sensivel");
      expect(motivo("chaves/servidor.pem")).toBe("sensivel");
      expect(motivo("chaves/id_rsa")).toBe("sensivel");
      expect(motivo("chaves/app.key")).toBe("sensivel");
      expect(motivo("App/bin/Debug/x.cs")).toBe("padrao");
      expect(motivo("App/obj/y.cs")).toBe("padrao");
      if (modo === "git") {
        // o git já tira o que o .gitignore cobre e nós tiramos as pastas de dependência/saída
        expect(motivo("node_modules/lib/index.js")).toBe("padrao");
        expect(motivo("dist/o.js")).toBe("padrao");
        expect(motivo("vendor/x.php")).toBe("padrao");
        expect(motivo(`${PRODUTO.pastaNoProjeto}/mapa/x.json`)).toBe("padrao");
      }
      const linguagens = Object.fromEntries(arquivos.map((a) => [a.caminho, a.linguagem]));
      expect(linguagens["src/a.ts"]).toBe("typescript");
      expect(linguagens["src/c.tsx"]).toBe("tsx");
      expect(linguagens["src/b.py"]).toBe("python");
      expect(linguagens["src/Mod.kt"]).toBe("outra");
      expect(linguagens["bin/run"]).toBe("javascript"); // shebang
      const por = Object.fromEntries(arquivos.map((a) => [a.caminho, a.categoria]));
      expect(por["package.json"]).toBe("manifesto");
      expect(por["package-lock.json"]).toBe("lock");
      expect(por[".github/workflows/ci.yml"]).toBe("manifesto");
      expect(por["src/a.ts"]).toBe("codigo");
    });
  }

  it("respeita .gitignore (inclusive negação) e globs extras do mapa", async () => {
    const raiz = novaPasta();
    montar(raiz);
    const r = await varrerTudo(raiz, { usarGit: false, ignorar: ["src/b.py", "**/*.tsx"] });
    const aceitos = r.arquivos.map((a) => a.caminho);
    expect(aceitos).not.toContain("src/b.py");
    expect(aceitos).not.toContain("src/c.tsx");
    expect(aceitos).toContain("src/a.ts");
    expect(r.ignorados.find((i) => i.caminho === "src/b.py")?.motivo).toBe("gitignore");
    expect(aceitos).not.toContain("saida/gerado.ts");
  });

  it("arquivo de ambiente e chaves NUNCA são abertos (espião em readFile, lstat e stat)", async () => {
    const raiz = novaPasta();
    montar(raiz);
    initRepo(raiz, false);
    const tocados: string[] = [];
    const espiao: FsVarredura = {
      lstat: (p) => (tocados.push(p), fsReal.lstat(p)),
      stat: (p) => (tocados.push(p), fsReal.stat(p)),
      realpath: fsReal.realpath,
      readdir: fsReal.readdir,
      readFile: (p) => (tocados.push(p), fsReal.readFile(p)),
    };
    for (const usarGit of [true, false]) {
      tocados.length = 0;
      await varrerTudo(raiz, { fs: espiao, usarGit });
      expect(tocados.length).toBeGreaterThan(0);
      for (const t of tocados) expect(t, t).not.toMatch(/(\.env|\.env\.local|\.pem|id_rsa|\.key)$/);
    }
  });

  it("symlink que sai da raiz é ignorado (nunca lido); symlink interno é seguido; symlink para pasta não", async () => {
    const raiz = novaPasta();
    const fora = novaPasta();
    escrever(fora, "externo.ts", "export const segredo = 1;\n");
    escrever(raiz, "real/dentro.ts", "export const d = 1;\n");
    symlinkSync(join(fora, "externo.ts"), join(raiz, "link-fora.ts"));
    symlinkSync(fora, join(raiz, "pasta-fora"));
    symlinkSync(join(raiz, "real", "dentro.ts"), join(raiz, "link-dentro.ts"));
    symlinkSync(join(raiz, "real"), join(raiz, "link-pasta"));
    const lidos: string[] = [];
    const fs: FsVarredura = { ...fsReal, readFile: (p) => (lidos.push(p), fsReal.readFile(p)) };
    for (const usarGit of [false, true]) {
      if (usarGit) initRepo(raiz, false);
      lidos.length = 0;
      const { arquivos, ignorados } = await varrerTudo(raiz, { fs, usarGit });
      const aceitos = arquivos.map((a) => a.caminho);
      expect(aceitos, `usarGit=${usarGit}`).toContain("real/dentro.ts");
      expect(aceitos).toContain("link-dentro.ts");
      expect(aceitos).not.toContain("link-fora.ts");
      expect(ignorados.find((i) => i.caminho === "link-fora.ts")?.motivo).toBe("symlink_fora");
      expect(ignorados.find((i) => i.caminho === "link-pasta")?.motivo).toBe("symlink_dir");
      expect(ignorados.find((i) => i.caminho === "pasta-fora")?.motivo).toBe("symlink_fora");
      expect(lidos.some((l) => l.includes("externo.ts"))).toBe(false);
    }
  });

  it("submódulo (pasta com .git) é pulado na caminhada; gitlink é pulado no modo git", async () => {
    const raiz = novaPasta();
    escrever(raiz, "a.ts", "export {};\n");
    escrever(raiz, "sub/.git", "gitdir: x\n");
    escrever(raiz, "sub/interno.ts", "export {};\n");
    const r = await varrerTudo(raiz, { usarGit: false });
    expect(r.arquivos.map((a) => a.caminho)).toEqual(["a.ts"]);
    expect(r.ignorados.find((i) => i.caminho === "sub")?.motivo).toBe("submodulo");
    // gitlink real: repositório aninhado registrado como submódulo no índice
    const sub = novaPasta();
    initRepo(sub, true);
    const raiz2 = novaPasta();
    escrever(raiz2, "a.ts", "export {};\n");
    initRepo(raiz2, false);
    git(raiz2, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "ext");
    const g = await varrerTudo(raiz2, { usarGit: true });
    expect(g.arquivos.map((a) => a.caminho)).toContain("a.ts");
    expect(g.arquivos.map((a) => a.caminho).some((c) => c.startsWith("ext/"))).toBe(false);
  });

  it("CRLF e BOM não alteram o hash; conteúdo diferente altera", async () => {
    const raiz = novaPasta();
    escrever(raiz, "lf.ts", "const a = 1;\nconst b = 2;\n");
    escrever(raiz, "crlf.ts", "const a = 1;\r\nconst b = 2;\r\n");
    escrever(raiz, "bom.ts", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("const a = 1;\nconst b = 2;\n")]));
    escrever(raiz, "outro.ts", "const a = 1;\nconst b = 3;\n");
    const { arquivos } = await varrerTudo(raiz, { usarGit: false });
    const h = Object.fromEntries(arquivos.map((a) => [a.caminho, a.hash]));
    expect(h["crlf.ts"]).toBe(h["lf.ts"]);
    expect(h["bom.ts"]).toBe(h["lf.ts"]);
    expect(h["outro.ts"]).not.toBe(h["lf.ts"]);
    expect(h["lf.ts"]).toBe(hashConteudo(Buffer.from("const a = 1;\nconst b = 2;\n")));
  });

  it("cache por mtime+tamanho: reanálise sem mudança não lê nenhum arquivo; mudança relê só o alterado", async () => {
    const raiz = novaPasta();
    montar(raiz);
    const cache = new Map<string, EntradaCacheVarredura>();
    const lidos: string[] = [];
    const fs: FsVarredura = { ...fsReal, readFile: (p) => (lidos.push(p), fsReal.readFile(p)) };
    const primeira = await varrerTudo(raiz, { cache, fs, usarGit: false });
    expect(primeira.resumo.cache.acertos).toBe(0);
    lidos.length = 0;
    const segunda = await varrerTudo(raiz, { cache, fs, usarGit: false });
    expect(segunda.arquivos.map((a) => [a.caminho, a.hash])).toEqual(primeira.arquivos.map((a) => [a.caminho, a.hash]));
    // só o .gitignore (lido para as regras) e o `bin/run` sem extensão (releitura para o shebang) voltam a abrir
    expect(lidos.filter((l) => !l.endsWith(".gitignore") && !l.endsWith("bin/run"))).toEqual([]);
    expect(segunda.resumo.cache.acertos).toBeGreaterThan(5);
    // alterar um arquivo (mtime + tamanho)
    writeFileSync(join(raiz, "src/a.ts"), "export const a = 2222;\n");
    lidos.length = 0;
    const terceira = await varrerTudo(raiz, { cache, fs, usarGit: false });
    expect(lidos.filter((l) => l.endsWith(".ts") || l.endsWith(".py"))).toEqual([join(raiz, "src/a.ts")]);
    const antes = primeira.arquivos.find((a) => a.caminho === "src/a.ts")!;
    expect(terceira.arquivos.find((a) => a.caminho === "src/a.ts")!.hash).not.toBe(antes.hash);
    expect(cache.get("src/binario.ts")?.ignorado).toBe("binario");
  });

  it("mesmo tamanho e mtime diferente invalida o cache", async () => {
    const raiz = novaPasta();
    escrever(raiz, "a.ts", "const x = 1;\n");
    const cache = new Map<string, EntradaCacheVarredura>();
    const a = await varrerTudo(raiz, { cache, usarGit: false });
    writeFileSync(join(raiz, "a.ts"), "const x = 2;\n"); // mesmo tamanho
    const t = new Date(Date.now() + 5000);
    utimesSync(join(raiz, "a.ts"), t, t);
    const b = await varrerTudo(raiz, { cache, usarGit: false });
    expect(b.arquivos[0]!.hash).not.toBe(a.arquivos[0]!.hash);
  });

  it("teto de arquivos: trunca com aviso; aviso a partir de N; sem limite com null (P-274)", async () => {
    const raiz = novaPasta();
    for (let i = 0; i < 30; i++) escrever(raiz, `src/f${String(i).padStart(2, "0")}.ts`, `export const v${i} = ${i};\n`);
    const t = await varrerTudo(raiz, { usarGit: false, totalMax: 10 });
    expect(t.arquivos).toHaveLength(10);
    expect(t.resumo.truncado).toBe(true);
    expect(t.resumo.avisos.join(" ")).toMatch(/Teto de 10 arquivos/);
    expect(t.resumo.ignorados_por_motivo.fora_do_limite).toBe(20);
    const aviso = await varrerTudo(raiz, { usarGit: false, avisoEm: 20 });
    expect(aviso.resumo.truncado).toBe(false);
    expect(aviso.resumo.avisos.join(" ")).toMatch(/Mais de 20 arquivos/);
    const livre = await varrerTudo(raiz, { usarGit: false, totalMax: null });
    expect(livre.arquivos).toHaveLength(30);
    expect(livre.resumo.avisos).toEqual([]);
  });

  it("limite de tamanho por arquivo é configurável, com teto de 5 MB", async () => {
    const raiz = novaPasta();
    const linhas = (n: number): string => "// linha de comentario\n".repeat(n);
    escrever(raiz, "medio.ts", linhas(65_000)); // ≈ 1,5 MB
    escrever(raiz, "enorme.ts", linhas(240_000)); // ≈ 5,5 MB
    const a = await varrerTudo(raiz, { usarGit: false });
    expect(a.arquivos).toEqual([]);
    expect(a.ignorados.map((i) => [i.caminho, i.motivo]).sort()).toEqual([["enorme.ts", "grande"], ["medio.ts", "grande"]]);
    const b = await varrerTudo(raiz, { usarGit: false, tamanhoMaxBytes: 2_000_000 });
    expect(b.arquivos.map((x) => x.caminho)).toEqual(["medio.ts"]);
    const c = await varrerTudo(raiz, { usarGit: false, tamanhoMaxBytes: 50_000_000 }); // cai no teto de 5 MB
    expect(c.arquivos.map((x) => x.caminho)).toEqual(["medio.ts"]);
  });

  it("lotes de 500 caminhos", async () => {
    const raiz = novaPasta();
    for (let i = 0; i < 1100; i++) escrever(raiz, `d${i % 10}/f${i}.ts`, `export const v${i} = ${i};\n`);
    const tamanhos: number[] = [];
    const gen = varrer(raiz, { usarGit: false });
    for (;;) {
      const r = await gen.next();
      if (r.done === true) {
        expect(r.value.total).toBe(1100);
        break;
      }
      tamanhos.push(r.value.arquivos.length);
    }
    expect(TAMANHO_LOTE).toBe(500);
    expect(tamanhos).toEqual([500, 500, 100]);
  });

  it("cancelamento por AbortSignal interrompe a varredura", async () => {
    const raiz = novaPasta();
    for (let i = 0; i < 1200; i++) escrever(raiz, `f${i}.ts`, `export const v${i} = ${i};\n`);
    const ctl = new AbortController();
    const gen = varrer(raiz, { usarGit: false, sinal: ctl.signal });
    const primeiro = await gen.next();
    expect(primeiro.done).toBe(false);
    ctl.abort();
    let total = (primeiro.value as { arquivos: unknown[] }).arquivos.length;
    for (;;) {
      const r = await gen.next();
      if (r.done === true) break;
      total += r.value.arquivos.length;
    }
    expect(total).toBeLessThan(1200);
  });

  it("20 000 arquivos são listados sem bloquear o event loop", async () => {
    const raiz = novaPasta();
    for (let d = 0; d < 40; d++) {
      mkdirSync(join(raiz, `p${d}`), { recursive: true });
      for (let i = 0; i < 500; i++) writeFileSync(join(raiz, `p${d}`, `f${i}.ts`), `export const v = ${i};\n`);
    }
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    const t0 = performance.now();
    const r = await varrerTudo(raiz, { usarGit: false });
    const ms = performance.now() - t0;
    h.disable();
    expect(r.arquivos).toHaveLength(20_000);
    const maxMs = h.max / 1e6;
    console.log(`20 000 arquivos (caminhada, sem cache): ${ms.toFixed(0)} ms, pior atraso do event loop ${maxMs.toFixed(1)} ms`);
    expect(maxMs).toBeLessThan(250);
  }, 120_000);

  it("P-250: reanálise sem mudanças de 5 000 arquivos (git + cache) em até 2 s", async () => {
    const raiz = novaPasta();
    initRepo(raiz, false);
    for (let d = 0; d < 20; d++) {
      mkdirSync(join(raiz, `p${d}`), { recursive: true });
      for (let i = 0; i < 250; i++) writeFileSync(join(raiz, `p${d}`, `f${i}.ts`), `export const v = ${i};\n`);
    }
    const cache = new Map<string, EntradaCacheVarredura>();
    const a = await varrerTudo(raiz, { cache });
    expect(a.resumo.origem).toBe("git");
    expect(a.arquivos).toHaveLength(5000);
    const t0 = performance.now();
    const b = await varrerTudo(raiz, { cache });
    const ms = performance.now() - t0;
    console.log(`P-250 reanálise sem mudanças (5 000 arquivos): ${ms.toFixed(0)} ms`);
    expect(b.arquivos).toHaveLength(5000);
    expect(b.resumo.cache.acertos).toBe(5000);
    expect(ms).toBeLessThan(2000);
  }, 120_000);
});
