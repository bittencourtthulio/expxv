// Fase 7C (D-370): o gateway MCP NÃO cria listener nem faz rede por conta própria. O endpoint `POST /gateway` é UMA rota do servidor loopback que já existe
// (`src/nucleo/mcp/servidor.ts`, 127.0.0.1, token HMAC por Pane, Host/Origin loopback); a varredura de empacotamento (empacotamento.test.ts) continua SEM exceção nova.
// Este teste prova a fronteira: sem `createServer`/`listen`/`fetch`/`http(s)`/`net`; processo só pelo cliente stdio do SDK (shell:false); SDK só no conector; sob demanda.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? arquivos(join(dir, n)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [join(dir, n)] : []));
const semComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const GATEWAY = [...arquivos(join(RAIZ, "src/nucleo/gateway-mcp")), join(RAIZ, "src/main/gateway.ts"), join(RAIZ, "src/main/ipc/gateway.ts")];

describe("gateway MCP: fronteira de rede e de processo (D-370)", () => {
  it("há fontes para varrer", () => { expect(GATEWAY.length).toBeGreaterThan(8); });

  it("nenhum fonte do gateway escuta porta ou abre socket/HTTP/WebSocket por conta própria", () => {
    for (const f of GATEWAY) {
      const c = semComentarios(readFileSync(f, "utf8"));
      expect(c, f).not.toMatch(/\b(createServer|\.listen\(|fetch\(|https?\.(get|request)\(|net\.request|new WebSocket|XMLHttpRequest|\.connect\(\s*\d)/);
      expect(c, f).not.toMatch(/from "node:(https?|net|dgram|tls|http2|dns)"/);
    }
  });

  it("nenhum fonte do gateway usa shell, exec* nem spawn próprio (o processo é do cliente stdio do SDK, que usa shell:false)", () => {
    for (const f of GATEWAY) {
      const c = semComentarios(readFileSync(f, "utf8"));
      expect(c, f).not.toMatch(/shell\s*:\s*true|\b(execSync|execFileSync|execFile)\b|(?<![.\w])exec\s*\(|\bspawn(Sync)?\s*\(|child_process|\beval\s*\(|new Function\s*\(/);
    }
    const sdk = readFileSync(resolve(RAIZ, "node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js"), "utf8");
    expect(sdk).toMatch(/shell:\s*false/);
  });

  it("só o conector importa o SDK de cliente; o SDK de servidor não entra no gateway", () => {
    const comSdk = GATEWAY.filter((f) => /@modelcontextprotocol\/sdk/.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f).split("\\").join("/"));
    expect(comSdk).toEqual(["src/nucleo/gateway-mcp/conector.ts"]);
    const conector = ler("src/nucleo/gateway-mcp/conector.ts");
    expect(conector).not.toMatch(/sdk\/server\//);
  });

  it("o único listener do MCP segue sendo o servidor loopback (127.0.0.1) e a rota /gateway exige audiência `gateway`", () => {
    const srv = ler("src/nucleo/mcp/servidor.ts");
    expect(srv.match(/createServer\(/g)).toHaveLength(1);
    expect(srv).toMatch(/listen\(porta, "127\.0\.0\.1"/);
    expect(srv).toMatch(/caminho === "\/gateway"/);
    expect(srv).toMatch(/ehLoja \? "loja-launcher" : ehGateway \? "gateway"/);
    const ouvem = arquivos(join(RAIZ, "src/nucleo/mcp")).filter((f) => /\bcreateServer\(/.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f).split("\\").join("/"));
    expect(ouvem).toEqual(["src/nucleo/mcp/servidor.ts"]);
  });

  it("sob demanda: nada do gateway é importado estaticamente pelo boot (só import() dinâmico ou import type)", () => {
    const main = ler("src/main/main.ts");
    expect(main).not.toMatch(/^import (?!type)[^;]*from "\.\/(?:ipc\/)?gateway";/m);
    expect(main).toMatch(/import\("\.\/gateway"\)/);
    const estaticos = arquivos(join(RAIZ, "src")).filter((f) => !/\/gateway\.ts$/.test(f) && /^import (?!type)[^;]*gateway-mcp\/(agregador|conector|persistencia|superficie)"/m.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f).split("\\").join("/"));
    expect(estaticos).toEqual([]);
  });

  it("o gateway não guarda nem registra argumento/resultado de tool (auditoria só com tamanhos)", () => {
    for (const f of GATEWAY.filter((x) => /(agregador|gateway)\.ts$/.test(x))) {
      const c = semComentarios(readFileSync(f, "utf8"));
      expect(c, f).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
    const repo = semComentarios(ler("src/nucleo/banco/repos/gateway.ts"));
    expect(repo).not.toMatch(/INSERT INTO gateway_auditoria \([^)]*(args|resultado|payload|token|segredo)/i);
  });

  it("empacotamento: a lista de módulos com rede em src/ NÃO ganhou nenhum arquivo do gateway", () => {
    const emp = ler("tests/scripts/empacotamento.test.ts");
    expect(emp).not.toMatch(/gateway/i);
  });
});
