import { mkdtempSync, rmSync, writeFileSync, truncateSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gerarCasa, gerarSymlinksPerigosos, SEGREDOS, skillMd, type CasaGerada } from "../../../tests/fixtures/catalogo/gerar";
import { criarContexto } from "./raizes";
import { executarVarredura, type ResultadoVarredura } from "./varredura";

let raiz: string;
let casa: CasaGerada;
let r: ResultadoVarredura;
const WS = "ws_TESTE";

const achar = (tipo: string, nome: string) => r.itens.find((i) => i.tipo === tipo && i.nome_normalizado === nome.toLowerCase().replace(/[-_.\s]+/g, ""));

beforeAll(async () => {
  raiz = mkdtempSync(join(tmpdir(), "cat-var-"));
  casa = gerarCasa(raiz, { skills: 10 });
  gerarSymlinksPerigosos(casa.home, join(raiz, "fora"));
  r = await executarVarredura({ contexto: criarContexto({ home: casa.home, workspaces: [{ id: WS, raiz: casa.workspace }] }) });
});
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe("varredura do catálogo", () => {
  it("a mesma skill em várias CLIs vira 1 linha com N instalações", () => {
    const it = achar("skill", "comum-0");
    expect(it).toBeDefined();
    expect(it?.instalacoes.map((i) => i.cli).sort()).toEqual(["claude", "codex", "opencode", "portatil"]);
  });

  it("skill do projeto, agente, comando e regra são vistos; skill de plugin é presente (não 'ausente falso')", () => {
    expect(achar("skill", "do-projeto")?.instalacoes[0]?.escopo).toBe("projeto");
    expect(achar("agent", "auditor-x")).toBeDefined();
    expect(achar("agent", "scout-y")?.instalacoes[0]?.cli).toBe("opencode");
    expect(achar("command", "deploy")).toBeDefined();
    const fd = achar("skill", "frontend-design");
    expect(fd?.origem).toBe("terceiro");
    expect(fd?.plugin).toBe("frontend-design");
    expect(fd?.instalacoes.every((i) => i.estado === "presente")).toBe(true);
    expect(achar("rule", "AGENTS.md")?.instalacoes.map((i) => `${i.cli}:${i.escopo}`).sort()).toEqual(["codex:global", "codex:projeto", "opencode:projeto"]);
    expect(achar("rule", "CLAUDE.md")?.instalacoes.length).toBe(1);
  });

  it("plugin desabilitado no projeto: instalação com habilitada=false; no usuário, true", () => {
    const p = achar("plugin", "frontend-design");
    const user = p?.instalacoes.find((i) => i.escopo === "global");
    const proj = p?.instalacoes.find((i) => i.escopo === "projeto");
    expect(user?.habilitada).toBe(true);
    expect(proj?.habilitada).toBe(false);
    // scope 'local' é ignorado
    expect(p?.instalacoes).toHaveLength(2);
  });

  it("skills nativas do Codex (.system) e do método têm a origem certa", () => {
    expect(achar("skill", "nativa-x")?.origem).toBe("nativa");
    expect(achar("skill", "sprintx")?.origem).toBe("metodo");
    expect(achar("hook", "expx:task-so-fecha-verde")?.origem).toBe("metodo");
    expect(achar("hook", "expx:task-so-fecha-verde")?.instalacoes[0]?.detalhe["modo"]).toBe("bloqueio");
  });

  it("symlink para fora da casa vira 'quebrado' sem leitura; alvo ausente vira quebrado; ciclo termina", () => {
    const e = achar("skill", "escape");
    expect(e?.instalacoes[0]?.estado).toBe("quebrado");
    expect(e?.instalacoes[0]?.detalhe["motivo"]).toBe("fora_das_raizes");
    expect(achar("skill", "vazada")).toBeUndefined();
    expect(achar("skill", "quebrada")?.instalacoes[0]?.detalhe["motivo"]).toBe("alvo_ausente");
  });

  it("descrição com instrução, bidi e ANSI sai só como texto saneado", () => {
    const d = achar("skill", "malvada")?.descricao ?? "";
    expect(d).toContain("Ignore as instruções anteriores");
    expect(d).not.toMatch(/[‪-‮\u001b]/);
  });

  it("MCPs: nenhum byte de segredo em nenhum campo do resultado", () => {
    const todo = JSON.stringify(r);
    for (const s of SEGREDOS) expect(todo).not.toContain(s.replace(/^Bearer /, ""));
    const gh = achar("mcp_server", "github");
    expect(gh?.instalacoes[0]?.detalhe).toMatchObject({ transporte: "http", origem_url: "https://api.github.com", tem_segredo: true });
    const local = achar("mcp_server", "local");
    expect(local?.instalacoes[0]?.detalhe).toMatchObject({ transporte: "stdio", executavel_base: "meu-mcp", n_args: 2, chaves_env: "API_KEY,MODO", tem_segredo: true });
    expect(achar("mcp_server", "fetch")?.instalacoes[0]?.detalhe["chaves_env"]).toBe("API_KEY");
    expect(achar("mcp_server", "remoto")?.instalacoes[0]?.detalhe).toMatchObject({ transporte: "http", tem_segredo: true });
    expect(achar("mcp_server", "proj")?.instalacoes[0]?.escopo).toBe("projeto");
    expect(achar("mcp_server", "plug-mcp")?.plugin).toBe("frontend-design");
    expect(achar("mcp_server", "oc")).toBeDefined();
    expect(achar("mcp_server", "gem")).toBeDefined();
  });

  it("hooks: nome por executável, método marcado, texto do comando nunca guardado", () => {
    const g = achar("hook", "PreToolUse:guard.sh");
    expect(g).toBeDefined();
    expect(g?.instalacoes[0]?.detalhe["n_args"]).toBe(2);
    const lem = achar("hook", "SessionStart:expx-lembrete.sh");
    expect(lem?.origem).toBe("metodo");
    expect(achar("hook", "Stop:meu-stop.js")?.origem).toBe("usuario");
    expect(achar("hook", "oc-plugin:meu-plugin.js")?.instalacoes[0]?.cli).toBe("opencode");
  });

  it("regras guardam só tamanho e linhas", () => {
    const a = achar("rule", "AGENTS.md");
    expect(a?.instalacoes.find((i) => i.cli === "codex" && i.escopo === "global")?.detalhe).toEqual({ tamanho: 26, linhas: 5 });
  });

  it("filtro por tipo e por CLI", async () => {
    const so = await executarVarredura({ contexto: criarContexto({ home: casa.home, workspaces: [] }), tipos: ["skill"], clis: ["codex"] });
    expect(so.itens.every((i) => i.tipo === "skill" && i.instalacoes.every((x) => x.cli === "codex"))).toBe(true);
    expect(so.cobertura.clis).toEqual(["codex"]);
  });

  it("raiz ausente não é erro; JSON inválido vira erro nominal sem derrubar as outras CLIs", async () => {
    const r2 = mkdtempSync(join(tmpdir(), "cat-var2-"));
    try {
      mkdirSync(join(r2, "h"), { recursive: true });
      const sem = await executarVarredura({ contexto: criarContexto({ home: join(r2, "h"), workspaces: [] }) });
      expect(sem.itens).toEqual([]);
      expect(sem.erros).toEqual([]);
      writeFileSync(join(r2, "h", ".claude.json"), "{ quebrado");
      mkdirSync(join(r2, "h", ".codex", "skills", "ok"), { recursive: true });
      writeFileSync(join(r2, "h", ".codex", "skills", "ok", "SKILL.md"), skillMd("ok", "d"));
      const q = await executarVarredura({ contexto: criarContexto({ home: join(r2, "h"), workspaces: [] }) });
      expect(q.erros.some((e) => e.cli === "claude" && e.codigo === "json_invalido")).toBe(true);
      expect(q.itens.some((i) => i.nome === "ok")).toBe(true);
    } finally {
      rmSync(r2, { recursive: true, force: true });
    }
  });

  it("SKILL.md de 5 MB: lê só 8 KB e não calcula hash", async () => {
    const r2 = mkdtempSync(join(tmpdir(), "cat-var3-"));
    try {
      const dir = join(r2, "h", ".claude", "skills", "enorme");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), skillMd("enorme", "grande"));
      truncateSync(join(dir, "SKILL.md"), 5 * 1024 * 1024);
      const lidos: number[] = [];
      const ctx = criarContexto({ home: join(r2, "h"), workspaces: [], lerArquivo: async (c, max) => { lidos.push(max); const { lerAte } = await import("./raizes"); return lerAte(c, max); } });
      const res = await executarVarredura({ contexto: ctx, tipos: ["skill"], clis: ["claude"] });
      expect(lidos).toEqual([8 * 1024]);
      expect(res.itens[0]?.instalacoes[0]?.hash_conteudo).toBeNull();
      expect(res.itens[0]?.instalacoes[0]?.detalhe["motivo"]).toBe("arquivo_grande");
    } finally {
      rmSync(r2, { recursive: true, force: true });
    }
  });

  it("P-24: re-varredura sem mudanças não relê nenhum SKILL.md (cache mtime+size)", async () => {
    const cache = new Map();
    let leituras = 0;
    const { lerAte } = await import("./raizes");
    const mk = () => criarContexto({ home: casa.home, workspaces: [{ id: WS, raiz: casa.workspace }], cache, lerArquivo: async (c, m) => { if (c.endsWith("SKILL.md")) leituras++; return lerAte(c, m); } });
    await executarVarredura({ contexto: mk(), tipos: ["skill"], clis: ["claude", "codex", "opencode", "portatil"] });
    const primeira = leituras;
    expect(primeira).toBeGreaterThan(30);
    leituras = 0;
    const t0 = performance.now();
    await executarVarredura({ contexto: mk(), tipos: ["skill"], clis: ["claude", "codex", "opencode", "portatil"] });
    expect(leituras).toBeLessThanOrEqual(2); // só o método (lê 8 KB do SKILL.md do lock)
    expect(performance.now() - t0).toBeLessThan(400 * Number(process.env["EXPXV_PERF_FATOR"] ?? 3));
  });

  it("cancelar pelo AbortSignal devolve cancelada e para cedo", async () => {
    const ac = new AbortController();
    ac.abort();
    const c = await executarVarredura({ contexto: criarContexto({ home: casa.home, workspaces: [], abort: ac.signal }) });
    expect(c.cancelada).toBe(true);
    expect(c.itens).toEqual([]);
  });
});
