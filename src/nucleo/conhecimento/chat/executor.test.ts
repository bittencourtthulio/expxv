import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ambienteSeguro } from "../../terminais/ambiente";
import { criarExecutorHeadless, ExecucaoHeadlessErro, type OpcoesExecutor } from "./executor";
import { perguntar } from "./perguntar";
import type { PerfilChat } from "./tipos";

const FALSA = resolve(__dirname, "../../../../tests/fixtures/cli-headless/claude-falso.mjs");
const posix = process.platform !== "win32";
const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

const PERFIL: PerfilChat = { cli: "claude", modelo: "sonnet", esforco: "low", faixa: "rapido" };

function montar(extra: Partial<OpcoesExecutor> = {}, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "chat-exec-"));
  pastas.push(dir);
  const registro = join(dir, "registro.json");
  const executor = criarExecutorHeadless({
    perfil: () => PERFIL,
    resolverCli: async () => ({ caminho: FALSA, modo: "direto" }),
    ajuda: async (_cli, caminho) => (await import("node:child_process").then((c) => c.execFileSync(caminho, ["--help"], { encoding: "utf8" }))),
    ambiente: (caminho) => ({ ...ambienteSeguro({ caminho }, { origem: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "abc", CLI_FALSA_REGISTRO: registro, ...env } }) }),
    pastaNeutra: join(dir, "chat", "cwd"),
    ...extra,
  });
  return { executor, dir, registro };
}

async function juntar(it: AsyncIterable<string>): Promise<string> {
  let t = "";
  for await (const d of it) t += d;
  return t;
}

describe.skipIf(!posix)("executor headless do chat (CLI falsa)", () => {
  it("transmite o texto, passa o prompt por stdin e usa só flags seguras, cwd neutro e ambiente sem identidade de sessão", async () => {
    const m = montar();
    const texto = await juntar(m.executor.executar({ sistema: "SISTEMA", prompt: "pergunta secreta-do-prompt", sinal: new AbortController().signal }));
    expect(texto).toBe("Resposta simulada [1].");
    const reg = JSON.parse(readFileSync(m.registro, "utf8")) as { args: string[]; cwd: string; env: Record<string, string | null> };
    expect(reg.args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--system-prompt", "SISTEMA", "--model", "sonnet", "--effort", "low"]));
    expect(reg.args).not.toContain("--bare");
    expect(reg.args.join(" ")).not.toContain("secreto-do-prompt"); // prompt NUNCA no argv
    expect(reg.args.join(" ")).not.toContain("dangerously");
    expect(reg.cwd.replace("/private", "")).toContain(join("chat", "cwd"));
    expect(reg.env).toEqual({ CLAUDECODE: null, CLAUDE_CODE_SESSION_ID: null });
  });

  it("disponivel: ok com as flags; recusa sem perfil, CLI ausente, wrapper de Windows, Gemini e flags que faltam", async () => {
    expect(await montar().executor.disponivel()).toEqual({ ok: true });
    expect((await montar({ perfil: () => null }).executor.disponivel()).ok).toBe(false);
    expect((await montar({ resolverCli: async () => null }).executor.disponivel()).motivo).toContain("não está instalada");
    expect((await montar({ resolverCli: async () => ({ caminho: FALSA, modo: "cmd_wrapper" }) }).executor.disponivel()).motivo).toContain("wrapper");
    expect((await montar({ perfil: () => ({ ...PERFIL, cli: "gemini" }) }).executor.disponivel()).motivo).toContain("experimental");
    expect((await montar({ ajuda: async () => "Usage: claude --output-format" }).executor.disponivel()).motivo).toContain("não oferece");
    expect((await montar({ ajuda: async () => null }).executor.disponivel()).ok).toBe(false);
  });

  it("timeout mata o processo e falha; o cancelamento do usuário também", async () => {
    const m = montar({ timeoutMs: 300 });
    const t0 = Date.now();
    await expect(juntar(m.executor.executar({ sistema: "s", prompt: "MODO:PRESO", sinal: new AbortController().signal }))).rejects.toBeInstanceOf(ExecucaoHeadlessErro);
    expect(Date.now() - t0).toBeLessThan(5000);
    const ctl = new AbortController();
    const m2 = montar();
    const p = juntar(m2.executor.executar({ sistema: "s", prompt: "MODO:PRESO", sinal: ctl.signal }));
    setTimeout(() => ctl.abort(), 150);
    await expect(p).rejects.toBeInstanceOf(ExecucaoHeadlessErro);
  });

  it("teto de 1 MiB e saída com erro sem texto viram falha (e o modo busca assume no perguntar)", async () => {
    const m = montar({ maxBytes: 200_000 });
    await expect(juntar(m.executor.executar({ sistema: "s", prompt: "MODO:LONGO", sinal: new AbortController().signal }))).rejects.toThrow("teto");
    await expect(juntar(montar().executor.executar({ sistema: "s", prompt: "MODO:ERRO", sinal: new AbortController().signal }))).rejects.toBeInstanceOf(ExecucaoHeadlessErro);
    const r = await perguntar({ pergunta: "MODO:ERRO algo", busca: { buscar: async () => ({ hits: [], estado: "ok" }) }, llm: montar().executor });
    expect(r.modo).toBe("llm"); // sem hits: resposta honesta, sem chamar a CLI
    expect(r.texto).toContain("Não encontrei");
  });

  it("OpenCode com contexto longo usa arquivo na pasta neutra e o apaga ao fim", async () => {
    const m = montar({ perfil: () => ({ cli: "opencode", modelo: null, esforco: null, faixa: "medio" }), ajuda: async () => "--format --pure --dir" });
    const gen = m.executor.executar({ sistema: "s", prompt: "y".repeat(5000), sinal: new AbortController().signal });
    await juntar(gen).catch(() => undefined); // a CLI falsa não fala o formato do opencode: só importa o arquivo
    const pasta = join(m.dir, "chat", "cwd");
    expect(existsSync(pasta) ? readdirSync(pasta).filter((f) => f.startsWith("ctx-")) : []).toEqual([]);
  });
});
