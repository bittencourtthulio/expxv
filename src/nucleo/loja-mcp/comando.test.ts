import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carregarCatalogo } from "./catalogo";
import { ErroComando, hostsDeRede, montarComando, montarPermissoes, pastaDoServidor, type ContextoComando } from "./comando";
import type { EntradaMcp } from "./esquema";

const cat = carregarCatalogo(join(__dirname, "..", "..", "..", "resources", "mcp", "catalogo-mcps.json"));
const E = (id: string): EntradaMcp => JSON.parse(JSON.stringify(cat.porId.get(id)!.entrada)) as EntradaMcp;
const WS = mkdtempSync(join(tmpdir(), "ws-"));
const ctx: ContextoComando = { userData: "/dados/app", workspace: WS, plataforma: "darwin", node: "/usr/bin/node" };

describe("montarComando: forma por método", () => {
  it("npm com comando node: Node + shim do .bin, args resolvidos e pasta isolada", () => {
    const c = montarComando(E("filesystem"), ctx);
    expect(c.tipo).toBe("stdio");
    expect(c.executavel).toBe("/usr/bin/node");
    expect(c.args).toEqual(["/dados/app/mcp/filesystem/node_modules/.bin/mcp-server-filesystem", WS]);
    expect(c.pasta).toBe("/dados/app/mcp/filesystem");
    expect(c.texto).toBe(`/usr/bin/node /dados/app/mcp/filesystem/node_modules/.bin/mcp-server-filesystem ${WS}`);
    expect(c.env_fixas).toEqual({});
  });

  it("npm com Electron como Node pede ELECTRON_RUN_AS_NODE=1", () => {
    const c = montarComando(E("context7"), { ...ctx, nodeEhElectron: true });
    expect(c.env_fixas).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("uvx: venv/bin/<bin>; Windows: venv\\Scripts\\<bin>.exe", () => {
    const e = E("fetch");
    expect(montarComando(e, ctx).executavel).toBe(`/dados/app/mcp/fetch/venv/bin/${e.bin}`);
    const win = montarComando(e, { ...ctx, plataforma: "win32", userData: "C:\\Dados" });
    expect(win.executavel).toBe(`C:\\Dados\\mcp\\fetch\\venv\\Scripts\\${e.bin}.exe`);
  });

  it("binário: bin/<bin> (e .exe no Windows)", () => {
    const e = E("github");
    expect(montarComando(e, { ...ctx, variaveis: {} }).executavel).toBe("/dados/app/mcp/github/bin/github-mcp-server");
    expect(montarComando(e, { ...ctx, plataforma: "win32", userData: "C:\\D" }).executavel).toBe("C:\\D\\mcp\\github\\bin\\github-mcp-server.exe");
    expect(montarComando(e, ctx).args).toEqual(["stdio", "--read-only"]);
  });

  it("remoto: só a URL, sem executável e sem pasta", () => {
    const c = montarComando(E("deepwiki"), ctx);
    expect(c).toMatchObject({ tipo: "remoto", executavel: null, args: [], pasta: null, url: "https://mcp.deepwiki.com/mcp" });
    expect(c.hosts_rede.execucao).toEqual(["mcp.deepwiki.com"]);
    expect(c.hosts_rede.instalacao).toEqual([]);
  });

  it("docker: run --rm -i --pull never com a imagem por digest; só roda imagem já baixada", () => {
    const e = E("context7");
    e.instalacao = { metodo: "docker", pacote: `mcp/x@sha256:${"a".repeat(64)}`, versao: null, integridade: null, data_versao: null };
    e.comando = "docker"; e.bin = null; e.args = ["--raiz", "{{WORKSPACE}}"];
    const c = montarComando(e, ctx);
    expect(c.executavel).toBe("docker");
    expect(c.args.slice(0, 5)).toEqual(["run", "--rm", "-i", "--pull", "never"]);
    expect(c.args).toContain(`mcp/x@sha256:${"a".repeat(64)}`);
    expect(c.args).toContain(WS);
  });

  it("docker recusa --privileged, -v /, --network host e docker.sock", () => {
    const base = E("context7");
    base.instalacao = { metodo: "docker", pacote: `mcp/x@sha256:${"a".repeat(64)}`, versao: null, integridade: null, data_versao: null };
    base.bin = null;
    const ruins: string[][] = [
      ["--privileged"], ["-v", "/:/host"], ["--volume=/etc:/etc"], ["--network", "host"], ["--network=host"], ["--net=host"], ["--pid=host"],
      ["--cap-add", "SYS_ADMIN"], ["--device", "/dev/sda"], ["-v", "/var/run/docker.sock:/var/run/docker.sock"], ["--mount", "type=bind,source=/,target=/h"],
    ];
    for (const args of ruins) {
      const e = { ...base, args };
      expect(() => montarComando(e, ctx), args.join(" ")).toThrow(ErroComando);
    }
    const bom = { ...base, args: ["-v", `${WS}:/ws`] };
    expect(() => montarComando(bom, ctx)).not.toThrow();
  });
});

describe("montarComando: placeholders", () => {
  it("desconhecido lança; segredo não declarado lança", () => {
    const a = E("filesystem"); a.args = ["{{HOME}}"];
    expect(() => montarComando(a, ctx)).toThrow(/desconhecido/);
    const b = E("filesystem"); b.args = ["{{SEGREDO:NAO_EXISTE}}"];
    expect(() => montarComando(b, ctx)).toThrow(ErroComando);
    const c = E("filesystem"); c.args = ["{{VAR:NAO_EXISTE}}"];
    expect(() => montarComando(c, ctx)).toThrow(ErroComando);
  });

  it("{{SERVIDOR_DIR}} vira a pasta isolada", () => {
    const e = E("filesystem"); e.args = ["--dados={{SERVIDOR_DIR}}/dados"];
    expect(montarComando(e, ctx).args[1]).toBe("--dados=/dados/app/mcp/filesystem/dados");
  });

  it("{{WORKSPACE}} exige caminho absoluto, existente, sem '..'", () => {
    const e = E("filesystem");
    for (const ws of [undefined, "relativo/pasta", "/nao/existe/mesmo", `${WS}/../x`, "", "/a\0b"]) {
      expect(() => montarComando(e, { ...ctx, workspace: ws }), String(ws)).toThrow(/workspace/);
    }
    expect(() => montarComando(e, { ...ctx, workspace: "/qualquer", ehDiretorio: () => true })).not.toThrow();
    // modo exibição sem workspace mostra marcador em vez de lançar
    expect(montarComando(e, { ...ctx, workspace: undefined, modo: "exibicao" }).texto).toContain("<workspace>");
  });

  it("segredo: em exibição aparece só o NOME; em execução fica literal para o lançador, ou resolvido quando fornecido", () => {
    const e = E("redis-mcp");
    const exib = montarComando(e, { ...ctx, modo: "exibicao" });
    expect(exib.texto).toContain("<segredo:REDIS_URL>");
    const lit = montarComando(e, ctx);
    expect(lit.args).toContain("{{SEGREDO:REDIS_URL}}");
    const real = montarComando(e, { ...ctx, segredos: { REDIS_URL: "redis://falso:falso@h:6379" } });
    expect(real.args).toContain("redis://falso:falso@h:6379");
    expect(real.texto).not.toContain("redis://falso");
    expect(real.env_cofre).toEqual({ REDIS_URL: "mcp/redis-mcp/REDIS_URL", REDIS_PWD: "mcp/redis-mcp/REDIS_PWD" });
  });

  it("variável não secreta opcional ausente descarta o argumento; obrigatória ausente lança em execução", () => {
    const e = E("sentry-stdio");
    const sem = montarComando(e, ctx);
    expect(sem.args.some((a) => a.startsWith("--host="))).toBe(false);
    const com = montarComando(e, { ...ctx, variaveis: { SENTRY_HOST: "sentry.exemplo.com" } });
    expect(com.args).toContain("--host=sentry.exemplo.com");
    const sup = E("supabase-mcp");
    expect(() => montarComando(sup, ctx)).toThrow(/SUPABASE_PROJECT_REF/);
    expect(montarComando(sup, { ...ctx, variaveis: { SUPABASE_PROJECT_REF: "abc" } }).url).toContain("project_ref=abc");
    expect(montarComando(sup, { ...ctx, modo: "exibicao" }).texto).toContain("project_ref=<SUPABASE_PROJECT_REF>");
  });

  it("id fora do padrão (escape de pasta) é recusado", () => {
    for (const id of ["../x", "a/b", "A", "", "x".repeat(60), "a\\b"]) expect(() => pastaDoServidor("/d", id)).toThrow(ErroComando);
  });
});

describe("montarComando: tabela do seed e fuzz", () => {
  it("todas as entradas instaláveis do seed geram comando sem lançar (modo exibição)", () => {
    let n = 0;
    for (const x of cat.entradas) {
      if (!x.instalavel) continue;
      const c = montarComando(x.entrada as EntradaMcp, { ...ctx, modo: "exibicao" });
      expect(c.texto.length, x.entrada.id).toBeGreaterThan(0);
      if (c.tipo === "stdio") expect(c.executavel!.length).toBeGreaterThan(0);
      for (const v of x.entrada.variaveis) expect(c.env_nomes).toContain(v.nome);
      expect(c.texto).not.toMatch(/\{\{/);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(40);
  });

  it("segredo nunca aparece no texto e o cofre só guarda chaves, não valores", () => {
    for (const x of cat.entradas) {
      if (!x.instalavel || x.entrada.instalacao.metodo === "docker") continue;
      const segredos = Object.fromEntries(x.entrada.variaveis.filter((v) => v.secreta).map((v) => [v.nome, `VALOR-${v.nome}-falso`]));
      const c = montarComando(x.entrada as EntradaMcp, { ...ctx, segredos, variaveis: { SUPABASE_PROJECT_REF: "ref", SENTRY_HOST: "h.exemplo.com" } });
      expect(c.texto).not.toContain("VALOR-");
      expect(JSON.stringify(c.env_cofre)).not.toContain("VALOR-");
    }
  });

  it("fuzz de args: nenhuma combinação lança erro que não seja ErroComando, e nunca deixa placeholder residual", () => {
    let semente = 7;
    const rnd = (n: number): number => { semente = (semente * 1103515245 + 12345) >>> 0; return semente % n; };
    const pecas = ["{{WORKSPACE}}", "{{SERVIDOR_DIR}}", "{{VAR:SENTRY_HOST}}", "{{SEGREDO:SENTRY_ACCESS_TOKEN}}", "{{X}}", "{{", "}}", "--flag", "a b", "'", "\"", "$(x)", ";", "ç", "", "{{SEGREDO:", "{{VAR:SENTRY_HOST}"];
    for (let i = 0; i < 400; i++) {
      const e = E("sentry-stdio");
      e.args = Array.from({ length: 1 + rnd(4) }, () => Array.from({ length: 1 + rnd(3) }, () => pecas[rnd(pecas.length)]).join(""));
      try {
        const c = montarComando(e, { ...ctx, modo: "exibicao" });
        expect(c.texto).not.toMatch(/\{\{[A-Z_]+(:[A-Z_]+)?\}\}/);
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroComando);
      }
    }
  });
});

describe("permissões e hosts", () => {
  it("npm: versão pinada, pasta, registro npm, variáveis só pelo nome, nível e riscos", () => {
    const p = montarPermissoes(E("context7"), ctx);
    expect(p.versao_pinada).toBe("4.1.1");
    expect(p.pasta).toBe("/dados/app/mcp/context7");
    expect(p.escrita_em_disco).toEqual(["/dados/app/mcp/context7"]);
    expect(p.hosts_rede.instalacao).toEqual(["registry.npmjs.org"]);
    expect(p.nivel_verificacao).toBe("padrao");
    expect(p.riscos).toContain("rede_saida");
    expect(p.variaveis).toEqual([expect.objectContaining({ nome: "CONTEXT7_API_KEY", secreta: true, obrigatoria: false })]);
    expect(JSON.stringify(p)).not.toMatch(/valor|senha/i);
    expect(p.comando_exato).toContain("/dados/app/mcp/context7/node_modules/.bin/");
  });

  it("remoto: nível remoto, sem escrita em disco, host do serviço", () => {
    const p = montarPermissoes(E("deepwiki"), ctx);
    expect(p).toMatchObject({ nivel_verificacao: "remoto", pasta: null, escrita_em_disco: [], versao_pinada: null });
    expect(p.hosts_rede.execucao).toEqual(["mcp.deepwiki.com"]);
    expect(p.comando_exato).toBe("https://mcp.deepwiki.com/mcp");
  });

  it("hosts: PyPI, GitHub releases e rede livre quando o servidor declara rede_saida sem host fixo", () => {
    expect(hostsDeRede(E("fetch")).instalacao).toEqual(["files.pythonhosted.org", "pypi.org"]);
    expect(hostsDeRede(E("github")).instalacao).toContain("github.com");
    const h = hostsDeRede(E("fetch"));
    expect(h.execucao_livre).toBe(true);
    expect(hostsDeRede(E("sequential-thinking")).execucao_livre).toBe(false);
  });
});
