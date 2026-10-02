// Auditoria estática de nucleo/squads (Fase 14, onda 6): este módulo só lê/escreve arquivos de configuração e compõe texto. Nada de
// rede, processo filho, avaliação dinâmica de código nem leitura em bloco do ambiente do processo. Se um teste aqui falhar, quem
// adicionou o uso precisa registrar a decisão em AUDITORIA-SQUADS.md (e, se for legítimo, ajustar este conjunto de propósito).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = __dirname;
function fontes(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) fontes(caminho, acc);
    else if (/\.ts$/.test(nome) && !/\.test\.ts$/.test(nome)) acc.push(caminho);
  }
  return acc;
}
const ARQUIVOS = fontes(RAIZ);
const semComentarios = (f: string): string => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const nome = (f: string): string => f.slice(RAIZ.length + 1);

describe("auditoria estática: src/nucleo/squads", () => {
  it("há fontes para varrer", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(10);
  });

  it("nenhum fetch, http(s), net, processo filho, eval ou new Function", () => {
    const proibidos: Array<[string, RegExp]> = [
      ["fetch(", /\bfetch\s*\(/],
      ["node:http/https/net/dgram/tls", /from\s+["'](?:node:)?(?:https?|net|dgram|tls)["']/],
      ["child_process", /(?:from\s+["'](?:node:)?child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\))/],
      ["eval", /\beval\s*\(/],
      ["new Function", /\bnew\s+Function\s*\(/],
      ["http.request/https.request", /\bhttps?\.request\s*\(/],
      ["XMLHttpRequest/WebSocket", /\b(?:XMLHttpRequest|WebSocket)\b/],
    ];
    const achados: string[] = [];
    for (const f of ARQUIVOS) {
      const texto = semComentarios(f);
      for (const [rotulo, re] of proibidos) if (re.test(texto)) achados.push(`${nome(f)}: ${rotulo}`);
    }
    expect(achados).toEqual([]);
  });

  it("nenhum módulo lê o ambiente do processo em bloco nem arquivo de ambiente do usuário", () => {
    const achados: string[] = [];
    for (const f of ARQUIVOS) {
      const texto = semComentarios(f);
      if (/process\.env\b(?!\s*\.\s*[A-Z_]+\b)/.test(texto)) achados.push(`${nome(f)}: process.env em bloco`);
      if (/["'`][^"'`\n]*\.env(?:\.[a-z]+)?["'`]/.test(texto)) achados.push(`${nome(f)}: arquivo de ambiente`);
    }
    expect(achados).toEqual([]);
  });
});
