// Fase 22 (D-365/D-366): as duas exceções EXPLÍCITAS da varredura de empacotamento e a fronteira de rede do relay.
//  - `src/nucleo/relay/servidor.ts` é o ÚNICO módulo do relay que escuta (roda na VPS do dono, fora do pacote do app);
//  - `src/nucleo/remoto-estendido/ws-cliente.ts` é o ÚNICO lugar do app com `new WebSocket` (saída para o relay do dono).
// Nada mais abre porta nem cliente de rede, e nada do relay depende de pacote externo (AX-32/AX-33).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const fontes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? fontes(c) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [c] : [];
  });
const rel = (f: string): string => relative(RAIZ, f).split("\\").join("/");
const semComentarios = (t: string): string => t.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
const RELAY = fontes(join(RAIZ, "src/nucleo/relay"));
const ESTENDIDO = fontes(join(RAIZ, "src/nucleo/remoto-estendido"));
const TODOS = fontes(join(RAIZ, "src"));

describe("fronteira de sockets do relay (T-22.25)", () => {
  it("só `relay/servidor.ts` escuta (createServer/listen) no relay e no cliente do host", () => {
    const ouvem = [...RELAY, ...ESTENDIDO].filter((f) => /\bcreateServer\b|\.listen\(/.test(semComentarios(readFileSync(f, "utf8")))).map(rel);
    expect(ouvem).toEqual(["src/nucleo/relay/servidor.ts"]);
  });
  it("só `remoto-estendido/ws-cliente.ts` abre `new WebSocket` em todo src/ (fora dos testes)", () => {
    const abrem = TODOS.filter((f) => /\bnew WebSocket\b/.test(semComentarios(readFileSync(f, "utf8")))).map(rel);
    expect(abrem).toEqual(["src/nucleo/remoto-estendido/ws-cliente.ts"]);
    expect(ler("tests/scripts/empacotamento.test.ts")).toContain('"src/nucleo/remoto-estendido/ws-cliente.ts", // Fase 22 (D-366)');
  });
  it("o relay NUNCA é cliente de rede (AX-32): sem fetch, request/get, connect, WebSocket, https, dns, tls, udp, processo filho", () => {
    expect(RELAY.length).toBeGreaterThanOrEqual(7);
    for (const f of RELAY) {
      const t = semComentarios(readFileSync(f, "utf8"));
      expect(t, rel(f)).not.toMatch(/\bfetch\s*\(|\b(?:https?|net|tls)\.(?:get|request|connect)\s*\(|\bconnect\s*\(|\bnew WebSocket\b|XMLHttpRequest|from "node:(?:https|dns|dgram|tls|child_process|net)"|require\("(?:node:)?(?:https|dns|dgram|tls|child_process|net)"\)/);
    }
  });
  it("o cliente do host (remoto-estendido) não importa módulos de rede do Node: a saída é só pelo ws-cliente (WebSocket global)", () => {
    for (const f of ESTENDIDO) {
      const t = semComentarios(readFileSync(f, "utf8"));
      expect(t, rel(f)).not.toMatch(/from "node:(?:http|https|net|tls|dns|dgram|child_process)"/);
    }
  });
  it("ax33_dependencias_do_relay_minimas: o relay só importa `node:*` e arquivos próprios; package.json não ganhou `ws` nem biblioteca de servidor", () => {
    const permitidos = /^(?:node:(?:crypto|http|stream)|\.\/[a-z-]+|\.\.\/\.\.\/compartilhado\/relay|\.\.\/nucleo\/produto|\.\.\/\.\.\/nucleo\/produto)$/;
    for (const f of RELAY) {
      const fonte = readFileSync(f, "utf8");
      // `import x from "y"`, `export … from "y"`, `import "y"` (efeito colateral), `import("y")` e `require("y")`: todos entram na conta
      const alvos = [...fonte.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"/gm), ...fonte.matchAll(/^import\s*"([^"]+)"/gm), ...fonte.matchAll(/\b(?:import|require)\(\s*"([^"]+)"\s*\)/g)];
      for (const m of alvos) expect(m[1], `${rel(f)} -> ${m[1]}`).toMatch(permitidos);
    }
    const pkg = JSON.parse(ler("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const todas = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const proibida of ["ws", "uWebSockets.js", "socket.io", "express", "fastify", "koa", "hono"]) {
      if (proibida === "hono") continue; // `hono` já existe por causa do SDK do MCP, fora do relay (nenhum arquivo do relay o importa: checado acima)
      expect(Object.keys(todas), proibida).not.toContain(proibida);
    }
  });
  it("o bind do relay vem da configuração (nunca curinga fixo) e usa `exclusive`; o /healthz só responde a interface interna", () => {
    const s = semComentarios(ler("src/nucleo/relay/servidor.ts"));
    expect(s).toMatch(/listen\(\{ host: o\.bind, port: o\.porta, exclusive: true \}/);
    expect(s).not.toMatch(/0\.0\.0\.0|"::"|listen\(\s*\d+/);
    expect(s).toMatch(/INTERNO\.test\(p\.remoto/); // `healthzPermitido`: interface interna, sem X-Forwarded-For
    expect(semComentarios(ler("src/nucleo/relay/main.ts"))).toMatch(/"127\.0\.0\.1"/); // padrão seguro: loopback
  });
  it("a Origin nunca é lida pelo relay (AX-31): a autenticação é só por chave", () => {
    for (const f of RELAY) expect(semComentarios(readFileSync(f, "utf8")), rel(f)).not.toMatch(/headers(?:\[|\.)\s*["']?origin/i);
  });
  it("o relay só existe fora do pacote do app: o electron-builder exclui os módulos de servidor, e nada do boot os importa", () => {
    const yml = ler("electron-builder.yml");
    expect(yml).toContain('"!dist/nucleo/relay/{servidor,ws-servidor,roteador,limites,log,main}.js"');
    const servidor = ["servidor", "ws-servidor", "roteador", "limites", "log", "main"];
    const importadores = TODOS.filter((f) => !f.includes("/nucleo/relay/")).filter((f) => new RegExp(`from "[^"]*nucleo/relay/(?:${servidor.join("|")})"|from "\\./relay/(?:${servidor.join("|")})"`).test(readFileSync(f, "utf8"))).map(rel);
    expect(importadores).toEqual([]);
    // o cliente do host importa só `protocolo` do relay (o que continua no pacote)
    for (const f of ESTENDIDO) for (const m of readFileSync(f, "utf8").matchAll(/from "\.\.\/relay\/([a-z-]+)"/g)) expect(m[1], rel(f)).toBe("protocolo");
  });
  it("a Fase 13 segue intacta: o servidor LAN continua o único ouvinte do controle remoto e o tratador não importa rede", () => {
    expect(readdirSync(join(RAIZ, "src/nucleo/remoto")).filter((n) => /servidor\.ts$/.test(n))).toEqual(["servidor.ts"]);
    expect(semComentarios(ler("src/nucleo/remoto/tratador.ts"))).not.toMatch(/node:(?:http|https|net|tls)/);
  });
  it("ax18_chave_de_ip_no_servidor: o servidor do relay passa TODO IP de origem (direto e via X-Forwarded-For) por `chaveDeIp` antes das cotas", () => {
    const f = ler("src/nucleo/relay/servidor.ts");
    expect(f).toMatch(/return chaveDeIp\(ultimo\);/);
    expect(f).toMatch(/return chaveDeIp\(req\.socket\.remoteAddress \?\? "desconhecido"\);/);
  });
});
