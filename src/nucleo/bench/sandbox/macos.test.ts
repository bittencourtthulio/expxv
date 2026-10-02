import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { criarSandboxMacos, gerarPerfil, negadosPadrao } from "./macos";
import { criarSandboxNativo, criarSandboxNenhum } from "./sandbox";
import { montarAmbiente, nomeSensivel } from "./ambiente";

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "bench-sbx-")));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));
const macos = process.platform === "darwin";

describe("perfil do sandbox", () => {
  it("nega escrita por padrão, libera só o workdir/tmp e nega leitura das credenciais", () => {
    const p = gerarPerfil({ workdir: "/w/run/t/a", escrita: ["/w/home"], leitura_negada: ["/h/.ssh"] }, "/tmp-real");
    expect(p).toContain("(deny file-write*)");
    expect(p).toContain('(subpath "/w/run/t/a")');
    expect(p).toContain('(subpath "/w/home")');
    expect(p).toContain('(deny file-read* (subpath "/h/.ssh"))');
    expect(p.indexOf("(deny file-write*)")).toBeLessThan(p.indexOf("(allow file-write*"));
    expect(p.indexOf("(allow file-write*")).toBeLessThan(p.indexOf("(deny file-read*"));
  });
  it("modo somente leitura (juiz) não libera o workdir para escrita", () => {
    const p = gerarPerfil({ workdir: "/w/pacote", escrita: [], leitura_negada: [], somente_leitura: true }, "/tmp-real");
    expect(p).not.toMatch(/file-write\*[^\n]*\/w\/pacote/);
  });
  it("modo somente leitura reabre o workdir para LEITURA dentro de pasta negada (sem ler o cwd a CLI aborta: achado D-12)", () => {
    const p = gerarPerfil({ workdir: "/dados/bench/exec/r/_juiz/j", escrita: [], leitura_negada: ["/dados"], somente_leitura: true }, "/tmp-real");
    expect(p).toContain('(allow file-read* (subpath "/dados/bench/exec/r/_juiz/j"))');
    expect(p).not.toMatch(/allow file-write\*[^\n]*\/dados\/bench\/exec/);
  });
  it("recusa caminho com aspas/relativo (injeção no perfil)", () => {
    expect(() => gerarPerfil({ workdir: '/w"; (allow default)', escrita: [], leitura_negada: [] })).toThrow();
    expect(() => gerarPerfil({ workdir: "relativo", escrita: [], leitura_negada: [] })).toThrow();
  });
  it("lista padrão de credenciais cobre ssh, aws, gnupg, gh, docker, keychains e navegadores", () => {
    const n = negadosPadrao("/Users/x").join("\n");
    for (const t of [".ssh", ".aws", ".gnupg", ".config/gh", ".docker", "Library/Keychains", "Google/Chrome", "Firefox"]) expect(n).toContain(t);
  });
});

describe("modos sem sandbox externo", () => {
  it("nativo e nenhum não envolvem o comando", async () => {
    for (const s of [criarSandboxNativo(), criarSandboxNenhum()]) {
      expect(await s.disponivel()).toBe(true);
      const c = s.envolver("codex", ["exec"], { workdir: "/w", escrita: [], leitura_negada: [] });
      expect(c.executavel).toBe("codex");
      expect(c.args).toEqual(["exec"]);
    }
  });
  it("fora do macOS o sandbox externo é indisponível", async () => {
    expect(await criarSandboxMacos({ pastaPerfis: join(raiz, "perfis"), plataforma: "linux" }).disponivel()).toBe(false);
    expect(criarSandboxMacos({ pastaPerfis: join(raiz, "perfis"), plataforma: "linux" }).modo).toBe("indisponivel");
  });
});

describe.skipIf(!macos)("sandbox-exec real (macOS)", () => {
  const work = join(raiz, "run", "t", "a");
  const fora = join(raiz, "fora");
  const segredo = join(raiz, "ssh-falso");
  mkdirSync(work, { recursive: true });
  mkdirSync(fora, { recursive: true });
  mkdirSync(segredo, { recursive: true });
  writeFileSync(join(segredo, "id_falso"), "CHAVE-FALSA");
  mkdirSync(join(raiz, "tmp-sbx"), { recursive: true });
  const sbx = criarSandboxMacos({ pastaPerfis: join(raiz, "perfis"), tmp: join(raiz, "tmp-sbx") });
  const rodar = (script: string) => {
    const c = sbx.envolver(process.execPath, ["-e", script], { workdir: work, escrita: [], leitura_negada: [segredo] });
    try { return spawnSync(c.executavel, c.args, { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }); } finally { c.limpar(); }
  };
  it("a sanidade passa", async () => { expect(await sbx.disponivel()).toBe(true); });
  it("escreve no workdir, mas NÃO fora dele", () => {
    const r = rodar(`const fs=require("fs");fs.writeFileSync(${JSON.stringify(join(work, "ok.txt"))},"x");let fora="ESCREVEU";try{fs.writeFileSync(${JSON.stringify(join(fora, "x.txt"))},"x")}catch(e){fora="NEGADO"}console.log(fora)`);
    expect(r.stdout.trim()).toBe("NEGADO");
    expect(existsSync(join(work, "ok.txt"))).toBe(true);
    expect(existsSync(join(fora, "x.txt"))).toBe(false);
  });
  it("NÃO lê a credencial falsa (leitura negada)", () => {
    const r = rodar(`let l="LEU";try{require("fs").readFileSync(${JSON.stringify(join(segredo, "id_falso"))},"utf8")}catch(e){l="NEGADO"}console.log(l)`);
    expect(r.stdout.trim()).toBe("NEGADO");
    expect(readFileSync(join(segredo, "id_falso"), "utf8")).toBe("CHAVE-FALSA");
  });
});

describe("ambiente por allowlist", () => {
  it("só passa a allowlist e nunca herda segredo, token do app nem SSH_AUTH_SOCK", () => {
    const pai = { PATH: "/usr/bin", LANG: "pt_BR.UTF-8", HOME: "/Users/dono", ANTHROPIC_API_KEY: "sk-segredo", OPENAI_API_KEY: "sk-x", GITHUB_TOKEN: "ghp_x", SSH_AUTH_SOCK: "/tmp/agent", EXPXV_MCP_TOKEN: "tok", ELECTRON_RUN_AS_NODE: "1", CLAUDECODE: "1", AWS_SECRET_ACCESS_KEY: "aws", MINHA_SENHA_PASSWORD: "p", QUALQUER: "coisa" };
    const e = montarAmbiente({ pai, home: "/dados/bench/home" });
    expect(Object.keys(e).sort()).toEqual(["HOME", "LANG", "PATH", "USERPROFILE"]);
    expect(e["HOME"]).toBe("/dados/bench/home");
    expect(JSON.stringify(e)).not.toMatch(/sk-|ghp_|agent|tok|aws/);
  });
  it("config da CLI só pelas chaves conhecidas e extras passam pelo filtro de nome", () => {
    const e = montarAmbiente({ pai: { PATH: "/usr/bin" }, home: "/h", configCli: { CLAUDE_CONFIG_DIR: "/dados/conta", OUTRA: "x" }, extra: { BENCH_FALSA_REGISTRO: "/r.json", MEU_TOKEN: "t" } });
    expect(e["CLAUDE_CONFIG_DIR"]).toBe("/dados/conta");
    expect(e["OUTRA"]).toBeUndefined();
    expect(e["BENCH_FALSA_REGISTRO"]).toBe("/r.json");
    expect(e["MEU_TOKEN"]).toBeUndefined();
  });
  it("valor que o scrubber do cofre reconhece é descartado", () => {
    const e = montarAmbiente({ pai: { PATH: "/usr/bin", LANG: "SEGREDO-DO-COFRE" }, home: "/h", scrub: (t) => t.replace("SEGREDO-DO-COFRE", "***") });
    expect(e["LANG"]).toBeUndefined();
    expect(e["PATH"]).toBe("/usr/bin");
  });
  it("nomeSensivel", () => { expect(nomeSensivel("GITHUB_TOKEN")).toBe(true); expect(nomeSensivel("PATH")).toBe(false); });
});
