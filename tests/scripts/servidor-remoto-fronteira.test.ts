// Fase 13: a exceção da varredura de empacotamento para `src/nucleo/remoto/servidor.ts` é ESTREITA e justificada. O arquivo só ESCUTA (`createServer`), nunca abre conexão de saída;
// só ele importa `node:https`; o bind nunca é curinga; nada no boot importa o módulo (carregamento só por `import()` dinâmico sob demanda).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? arquivos(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));
const SERVIDOR = ler("src/nucleo/remoto/servidor.ts");

describe("servidor do controle remoto: fronteira de rede", () => {
  it("só escuta: nenhuma chamada de cliente (request/get/fetch/WebSocket/net.connect)", () => {
    expect(SERVIDOR).toMatch(/createServer as criarHttps/);
    expect(SERVIDOR).not.toMatch(/\b(fetch\(|https?\.(get|request)\(|net\.request|new WebSocket|XMLHttpRequest|\.connect\(|\.request\()/);
    const imports = [...SERVIDOR.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./politica-rede", "node:http", "node:https", "node:net"].sort());
  });
  it("só a camada de rede (saída) e o servidor (escuta) importam `node:https` em src/ (fora dos testes)", () => {
    const usam = arquivos(join(RAIZ, "src")).filter((f) => /from "node:https"/.test(readFileSync(f, "utf8")) && !/\.test\.tsx?$/.test(f)).map((f) => relative(RAIZ, f).split("\\").join("/"));
    expect(usam.sort()).toEqual(["src/nucleo/rede/cliente-http.ts", "src/nucleo/remoto/servidor.ts"]);
  });
  it("o bind exige o IP escolhido (host explícito e validado) e `exclusive`; nunca 0.0.0.0", () => {
    expect(SERVIDOR).toMatch(/ipDeBindPermitido\(o\.ip, o\.transporte/);
    expect(SERVIDOR).toMatch(/listen\(\{ host: o\.ip, port: o\.porta, exclusive: true \}/);
    const semComentarios = SERVIDOR.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n").replace(/\/\*\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/0\.0\.0\.0|listen\(\s*\d+\s*[,)]/);
  });
  it("nada de src/main/main.ts nem do boot importa o servidor estaticamente (só `import()` sob demanda)", () => {
    const estaticos = arquivos(join(RAIZ, "src")).filter((f) => !/\.test\.tsx?$/.test(f) && /^import (?!type)[^;]*from "(?:\.\.?\/)+(?:nucleo\/)?remoto(?:\/[a-z-]+)?";/m.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f).split("\\").join("/"));
    expect(estaticos).toEqual([]);
  });
  it("nenhum relay, app móvel, VPS nem serviço externo foi adicionado (D-05/G3): sem domínio, sem cliente de nuvem", () => {
    const fontes = arquivos(join(RAIZ, "src/nucleo/remoto")).concat(arquivos(join(RAIZ, "src/nucleo/jarvis"))).filter((f) => !/\.test\.tsx?$/.test(f));
    for (const f of fontes) expect(readFileSync(f, "utf8"), f).not.toMatch(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}|relay\.|wss?:\/\//i);
  });
  it("sem dependência nova para o remoto: package.json não cita bibliotecas de criptografia/servidor", () => {
    const pkg = ler("package.json");
    expect(pkg).not.toMatch(/"(?:node-forge|tweetnacl|ws|express|fastify|koa|selfsigned|jsonwebtoken)"/);
  });
});
