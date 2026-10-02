import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { extrairArquivo } from "./extratores/registro";
import { liberarGramaticas } from "./gramaticas";
import { hashConteudo } from "./hash";
import type { Extracao } from "./tipos";
import { varrerTudo, type ArquivoVarrido } from "./varredura";

// T-17.03/06/07 contra um projeto REAL: o próprio repositório (usa o compilador TypeScript só como oráculo de teste).
// A resolução de imports contra o compilador (≥ 95%) e o raio são da T-17.43; aqui medimos o que as tasks 17.03–17.07 já
// entregam: varredura, extração sem exceção e concordância dos imports e dos símbolos exportados com o oráculo.

const RAIZ = resolve(__dirname, "../../..");

describe("o próprio repositório como projeto real", () => {
  it("varre ≥ 500 arquivos, extrai tudo sem exceção e concorda com o compilador TypeScript", async () => {
    const { arquivos, resumo } = await varrerTudo(RAIZ);
    console.log(`varredura do repositório: ${arquivos.length} arquivos (origem ${resumo.origem}), ignorados: ${JSON.stringify(resumo.ignorados_por_motivo)}`);
    expect(arquivos.length).toBeGreaterThanOrEqual(500);
    expect(resumo.truncado).toBe(false);
    // nada de dependências, saídas de build nem arquivos de ambiente
    for (const a of arquivos) {
      expect(a.caminho, a.caminho).not.toMatch(/(^|\/)(node_modules|dist|dist-app|\.git)\//);
      expect(a.caminho, a.caminho).not.toMatch(/(^|\/)\.env/);
    }

    const codigo = arquivos.filter((a): a is ArquivoVarrido => (a.linguagem === "typescript" || a.linguagem === "tsx" || a.linguagem === "javascript") && a.categoria === "codigo");
    expect(codigo.length).toBeGreaterThanOrEqual(400);

    let comErroParse = 0;
    let importsOraculo = 0;
    let importsAchados = 0;
    let arquivosIguais = 0;
    let exportsOraculo = 0;
    let exportsAchados = 0;
    let simbolos = 0;
    const divergentes: string[] = [];
    const faltaram: string[] = [];
    const t0 = performance.now();
    for (const a of codigo) {
      const buf = readFileSync(join(RAIZ, a.caminho));
      const texto = buf.toString("utf8");
      const e: Extracao = await extrairArquivo(texto, a.linguagem, a.caminho, { hash: hashConteudo(buf) });
      expect(e.hash).toBe(a.hash);
      if (e.erros_parse > 0) comErroParse++;
      simbolos += e.simbolos.length;

      // oráculo de imports: o pré-processador do compilador TypeScript
      const oraculo = new Set(ts.preProcessFile(texto, true, true).importedFiles.map((f) => f.fileName));
      const nosso = new Set(e.imports.map((i) => i.especificador));
      importsOraculo += oraculo.size;
      for (const o of oraculo) if (nosso.has(o)) importsAchados++;
      if (oraculo.size === nosso.size && [...oraculo].every((o) => nosso.has(o))) arquivosIguais++;
      else if (divergentes.length < 8) divergentes.push(`${a.caminho}: faltam [${[...oraculo].filter((o) => !nosso.has(o)).join(", ")}] sobram [${[...nosso].filter((o) => !oraculo.has(o)).join(", ")}]`);

      // oráculo de símbolos exportados: declarações `export …` no início da linha
      for (const m of texto.matchAll(/^export\s+(?!declare\b)(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
        exportsOraculo++;
        if (e.simbolos.some((s) => s.nome === m[1] && s.exportado)) exportsAchados++;
        else if (faltaram.length < 8) faltaram.push(`${a.caminho}: ${m[1]}`);
      }
    }
    const ms = performance.now() - t0;
    liberarGramaticas();
    const recallImports = importsAchados / importsOraculo;
    const recallExports = exportsAchados / exportsOraculo;
    console.log(
      `extração de ${codigo.length} arquivos TS/JS: ${ms.toFixed(0)} ms (${(ms / codigo.length).toFixed(1)} ms/arquivo), ${simbolos} símbolos; ` +
        `imports ${importsAchados}/${importsOraculo} (${(recallImports * 100).toFixed(2)}%), arquivos idênticos ${arquivosIguais}/${codigo.length}; ` +
        `exports ${exportsAchados}/${exportsOraculo} (${(recallExports * 100).toFixed(2)}%); com erro de parse ${comErroParse}`,
    );
    if (divergentes.length > 0) console.log(`divergências de imports (amostra):\n${divergentes.join("\n")}`);
    if (faltaram.length > 0) console.log(`exports não achados (amostra):\n${faltaram.join("\n")}`);
    expect(comErroParse / codigo.length).toBeLessThan(0.01);
    expect(recallImports).toBeGreaterThanOrEqual(0.99);
    expect(arquivosIguais / codigo.length).toBeGreaterThanOrEqual(0.98);
    expect(recallExports).toBeGreaterThanOrEqual(0.98);
  }, 180_000);
});

describe("o mapa nunca escreve fora do próprio armazém (D-04: nada em docs/**)", () => {
  it("só o armazém (e o pool/worker, que não escrevem) tocam em APIs de escrita; o resto do módulo é leitura", () => {
    const pasta = __dirname;
    const proibidas = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|rmdir|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|truncate|symlink)\s*\(/;
    // Escritores legítimos (todos com teste próprio de confinamento): o armazém (mapa.db), o pacote de contexto (só `<pasta do produto>/mapa/`,
    // gravação atômica, recusa symlink), o destino das exportações (recusa `<raiz>/docs/**`) e o serviço (só apaga a pasta de pacotes, em `apagar`).
    const permitidos = new Set(["armazem.ts", "pacote-contexto.ts", "destino.ts", "servico.ts"]);
    const achados: string[] = [];
    const andar = (dir: string): void => {
      for (const n of readdirSync(dir, { withFileTypes: true })) {
        const c = join(dir, n.name);
        if (n.isDirectory()) andar(c);
        else if (n.name.endsWith(".ts") && !n.name.endsWith(".test.ts") && !permitidos.has(n.name)) {
          const linhas = readFileSync(c, "utf8").split("\n");
          linhas.forEach((l, i) => {
            if (!l.trim().startsWith("//") && !l.trim().startsWith("*") && proibidas.test(l)) achados.push(`${n.name}:${i + 1}: ${l.trim()}`);
          });
        }
      }
    };
    andar(pasta);
    expect(achados).toEqual([]);
  });

  it("o serviço só remove a pasta de pacotes do mapa; o pacote só escreve sob `<pasta do produto>/mapa/`; a exportação passa pela guarda de docs/", () => {
    const servico = readFileSync(join(__dirname, "servico.ts"), "utf8");
    const remocoes = [...servico.matchAll(/\brmSync\(([^)]*)\)/g)].map((m) => m[1] as string);
    expect(remocoes.length).toBeGreaterThan(0);
    for (const r of remocoes) expect(r).toMatch(/PASTA_PRODUTO, "mapa"/);
    const pacote = readFileSync(join(__dirname, "pacote-contexto.ts"), "utf8");
    for (const m of pacote.matchAll(/\b(mkdirSync|writeFileSync|renameSync|rmSync)\(([^)]*)\)/g)) expect(m[2] as string, m[0]).toMatch(/baseMapa|pastaProduto|gi\b|tmp|destino|join\(baseMapa/);
    const destino = readFileSync(join(__dirname, "exportar", "destino.ts"), "utf8");
    expect(destino).toMatch(/destinoPermitido\(p\.raiz, p\.pasta\)/);
    expect(destino).toMatch(/MENSAGEM_DESTINO_DOCS/);
  });

  it("o armazém só escreve no caminho do mapa.db informado (mkdir da pasta pai, renomear para .corrompido, apagar)", () => {
    const t = readFileSync(join(__dirname, "armazem.ts"), "utf8");
    for (const m of t.matchAll(/\b(mkdirSync|renameSync|rmSync)\(([^)]*)\)/g)) {
      expect(m[2], m[0]).toMatch(/dirname\(caminho\)|caminho|destino|sufixo/);
    }
  });
});
