// Portas de IA da gestão ágil: consentimento por workspace, perfil via harness e CLI headless (argv separado, sem shell, saída e tempo limitados).
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chaveConsentimento, criarPortaConsentimento, criarPortaHeadless, criarPortaPerfil, pastaNeutraDoAgil } from "./agil-ia";

class FilhoFalso extends EventEmitter {
  stdout = new EventEmitter();
  stdin = { escrito: "", end(t?: string): void { this.escrito += t ?? ""; } };
  mortos: string[] = [];
  kill(sinal: string): boolean { this.mortos.push(sinal); return true; }
}
function spawnFalso(roteiro: (f: FilhoFalso) => void) {
  const chamadas: { exe: string; args: string[]; opcoes: Record<string, unknown> }[] = [];
  const filhos: FilhoFalso[] = [];
  const fn = ((exe: string, args: string[], opcoes: Record<string, unknown>) => {
    const f = new FilhoFalso();
    chamadas.push({ exe, args, opcoes });
    filhos.push(f);
    queueMicrotask(() => roteiro(f));
    return f;
  }) as never;
  return { fn, chamadas, filhos };
}
const linhaClaude = (texto: string): string => `${JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: texto } } })}\n`;
const pasta = (): string => join(mkdtempSync(join(tmpdir(), "agil-ia-")), "cwd");

describe("consentimento", () => {
  it("só existe com `true` explícito, por workspace, e é revogável", async () => {
    const mem = new Map<string, unknown>();
    const c = criarPortaConsentimento({ obter: <T,>(k: string) => mem.get(k) as T | undefined, definir: (k, v) => void mem.set(k, v) });
    expect(await c.estimativaPorIa("ws_a")).toBe(false);
    c.definir("ws_a", true);
    expect(await c.estimativaPorIa("ws_a")).toBe(true);
    expect(await c.estimativaPorIa("ws_b")).toBe(false);
    mem.set(chaveConsentimento("ws_b"), "sim");
    expect(await c.estimativaPorIa("ws_b")).toBe(false); // só `true` booleano vale
    c.definir("ws_a", false);
    expect(await c.estimativaPorIa("ws_a")).toBe(false);
  });
});

describe("perfil via harness", () => {
  const resolvedor = (r: unknown) => ({ resolverPerfilDeEtapa: async () => r }) as never;
  it("usa a rota do harness (CLI, modelo, faixa) e cai para null sem rota ou com CLI desconhecida", async () => {
    const ok = criarPortaPerfil({ resolvedor: () => resolvedor({ ok: true, executor: { cli: "claude", model: "haiku", faixa: "rapido" } }), faixa: () => "rapido" });
    expect(await ok.resolver("ws", "agil", "estimativa")).toEqual({ cli: "claude", modelo: "haiku", faixa: "rapido" });
    const semRota = criarPortaPerfil({ resolvedor: () => resolvedor({ ok: false, executor: null }), faixa: () => "rapido" });
    expect(await semRota.resolver("ws", "agil", "estimativa")).toBeNull();
    const cliEstranha = criarPortaPerfil({ resolvedor: () => resolvedor({ ok: true, executor: { cli: "qualquer; rm -rf /", model: null, faixa: null } }), faixa: () => "rapido" });
    expect(await cliEstranha.resolver("ws", "agil", "estimativa")).toBeNull();
    const semHarness = criarPortaPerfil({ resolvedor: () => null, faixa: () => "rapido" });
    expect(await semHarness.resolver("ws", "agil", "estimativa")).toBeNull();
    const quebra = criarPortaPerfil({ resolvedor: () => ({ resolverPerfilDeEtapa: async () => { throw new Error("x"); } }) as never, faixa: () => "rapido" });
    expect(await quebra.resolver("ws", "agil", "estimativa")).toBeNull();
  });
  it("faixa desconhecida da configuração vira `rapido`", async () => {
    let recebida: unknown = null;
    const p = criarPortaPerfil({ resolvedor: () => ({ resolverPerfilDeEtapa: async (_s: string, _e: string, _c: unknown, perfil: { faixa: string }) => { recebida = perfil.faixa; return { ok: false, executor: null }; } }) as never, faixa: () => "supremo" });
    await p.resolver("ws", "agil", "estimativa");
    expect(recebida).toBe("rapido");
  });
});

describe("CLI headless", () => {
  it("argv separado, sem shell, pasta neutra, sem ferramentas, prompt por stdin e texto extraído da saída", async () => {
    const sp = spawnFalso((f) => { f.stdout.emit("data", Buffer.from(linhaClaude("[{\"ref\":\"a\"}]"))); f.emit("close", 0); });
    const cwd = pasta();
    const porta = criarPortaHeadless({ pastaNeutra: cwd, spawn: sp.fn, ambiente: () => ({ PATH: "/usr/bin" }) });
    const r = await porta.executar({ perfil: { cli: "claude", modelo: "haiku", faixa: "rapido" }, entrada: "estime isto; $(rm -rf /) `x`", tools: [], timeoutMs: 5000 });
    expect(r.texto).toBe('[{"ref":"a"}]');
    expect(sp.chamadas).toHaveLength(1);
    const c = sp.chamadas[0] as (typeof sp.chamadas)[number];
    expect(c.exe).toBe("claude");
    expect(c.args).toContain("--tools");
    expect(c.args[c.args.indexOf("--tools") + 1]).toBe("");
    expect(c.args).not.toContain("--dangerously-skip-permissions");
    expect(c.args.join(" ")).not.toContain("estime isto"); // o prompt não vai no argv
    expect(c.opcoes).toMatchObject({ shell: false, cwd });
    expect((sp.filhos[0] as FilhoFalso).stdin.escrito).toContain("estime isto");
    expect(c.opcoes["env"]).toEqual({ PATH: "/usr/bin" });
  });

  it("prompt de sistema próprio (Fase 19) vai à CLI no lugar do do estimador; o padrão continua o do estimador", async () => {
    const vistos: string[] = [];
    for (const sistema of [undefined, "Você redige relatórios de entrega."]) {
      const sp = spawnFalso((f) => { f.stdout.emit("data", Buffer.from(linhaClaude("{}"))); f.emit("close", 0); });
      const porta = criarPortaHeadless({ pastaNeutra: pasta(), spawn: sp.fn, ambiente: () => ({ PATH: "/usr/bin" }), ...(sistema === undefined ? {} : { sistema }) });
      await porta.executar({ perfil: { cli: "claude", modelo: null, faixa: "rapido" }, entrada: "x", tools: [], timeoutMs: 5000 });
      const c = sp.chamadas[0] as (typeof sp.chamadas)[number];
      vistos.push(`${c.args.join(" ")} ${(sp.filhos[0] as FilhoFalso).stdin.escrito}`);
    }
    expect(vistos[0]).toContain("estima tarefas");
    expect(vistos[1]).toContain("redige relatórios");
    expect(vistos[1]).not.toContain("estima tarefas");
  });

  it("CLI desconhecida, ferramentas pedidas, timeout, saída gigante e CLI sem resposta são recusados", async () => {
    const cwd = pasta();
    const perfil = { cli: "claude", modelo: null, faixa: "rapido" };
    const mudo = criarPortaHeadless({ pastaNeutra: cwd, spawn: spawnFalso(() => undefined).fn, ambiente: () => ({}) });
    await expect(mudo.executar({ perfil: { ...perfil, cli: "bash" }, entrada: "x", tools: [], timeoutMs: 1000 })).rejects.toThrow(/CLI/);
    await expect(mudo.executar({ perfil, entrada: "x", tools: ["rm"] as never, timeoutMs: 1000 })).rejects.toThrow(/ferramentas/);
    await expect(mudo.executar({ perfil, entrada: "x", tools: [], timeoutMs: 1000 })).rejects.toThrow(/timeout/);
    const gigante = spawnFalso((f) => { f.stdout.emit("data", Buffer.alloc(1024 * 1024 + 10, 97)); });
    await expect(criarPortaHeadless({ pastaNeutra: cwd, spawn: gigante.fn, ambiente: () => ({}) }).executar({ perfil, entrada: "x", tools: [], timeoutMs: 5000 })).rejects.toThrow(/grande demais/);
    expect((gigante.filhos[0] as FilhoFalso).mortos).toContain("SIGKILL");
    const vazio = spawnFalso((f) => f.emit("close", 0));
    await expect(criarPortaHeadless({ pastaNeutra: cwd, spawn: vazio.fn, ambiente: () => ({}) }).executar({ perfil, entrada: "x", tools: [], timeoutMs: 5000 })).rejects.toThrow(/sem resposta/);
    const erro = spawnFalso((f) => f.emit("error", new Error("ENOENT")));
    await expect(criarPortaHeadless({ pastaNeutra: cwd, spawn: erro.fn, ambiente: () => ({}) }).executar({ perfil, entrada: "x", tools: [], timeoutMs: 5000 })).rejects.toThrow(/ENOENT/);
  }, 20_000);

  it("a pasta neutra fica em <userData>/agil/cwd", () => {
    expect(pastaNeutraDoAgil("/dados")).toBe(join("/dados", "agil", "cwd"));
  });
});
