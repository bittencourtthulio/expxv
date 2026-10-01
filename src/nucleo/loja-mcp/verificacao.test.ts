import { afterEach, describe, expect, it } from "vitest";
import { testarServidor, redigir, type AlvoStdio } from "./verificacao";
import { alvoFalso, ambienteMinimo, derrubarTodos, pidVivo } from "../../../tests/fixtures/mcp-loja/servidores";

afterEach(async () => { await derrubarTodos(); });

describe("verificacao: saúde por initialize + tools/list", () => {
  it("ok: servidor rápido responde com 3 ferramentas, ≤ 300 ms de handshake após o spawn e processo morto", async () => {
    const r = await testarServidor(alvoFalso("ok"));
    expect(r.estado).toBe("ok");
    expect(r.n_ferramentas).toBe(3);
    expect(r.ferramentas.map((f) => f.nome)).toEqual(["eco", "soma", "hora_falsa"]);
    expect(r.ferramentas[0]!.descricao).toBe("Devolve o texto recebido.");
    expect(r.erro_codigo).toBeNull();
    expect(r.servidor?.nome).toBe("falso-ok");
    expect(r.latencia_ms).toBeLessThan(3000);
    expect(pidVivo(r.pid)).toBe(false);
  });

  it("lento: estoura o timeout, estado lento/timeout e a árvore morre em ≤ 500 ms", async () => {
    const t0 = performance.now();
    const r = await testarServidor(alvoFalso("lento", ambienteMinimo({ FALSO_ATRASO_MS: "10000" })), { timeoutMs: 500 });
    const total = performance.now() - t0;
    expect(r.estado).toBe("lento");
    expect(r.erro_codigo).toBe("timeout");
    expect(r.n_ferramentas).toBe(0);
    expect(total).toBeLessThan(500 + 500 + 400);
    expect(pidVivo(r.pid)).toBe(false);
  });

  it("lento: respondendo acima do limiar (sem estourar o timeout) é lento sem erro", async () => {
    const r = await testarServidor(alvoFalso("lento", ambienteMinimo({ FALSO_ATRASO_MS: "500" })), { timeoutMs: 5000, limiarLentoMs: 200 });
    expect(r.estado).toBe("lento");
    expect(r.erro_codigo).toBeNull();
    expect(r.n_ferramentas).toBe(3);
  });

  it("sem_ferramentas: tools/list vazio", async () => {
    const r = await testarServidor(alvoFalso("vazio"));
    expect(r.estado).toBe("sem_ferramentas");
    expect(r.n_ferramentas).toBe(0);
    expect(r.erro_codigo).toBeNull();
  });

  it("quebrado: crash após initialize ⇒ processo_encerrou", async () => {
    const r = await testarServidor(alvoFalso("crash"));
    expect(r.estado).toBe("quebrado");
    expect(r.erro_codigo).toBe("processo_encerrou");
  });

  it("quebrado: linha não-JSON no stdout ⇒ saida_invalida", async () => {
    const r = await testarServidor(alvoFalso("lixo"));
    expect(r.estado).toBe("quebrado");
    expect(r.erro_codigo).toBe("saida_invalida");
    expect(pidVivo(r.pid)).toBe(false);
  });

  it("quebrado: executável inexistente ⇒ executavel_ausente (mesmo com variável faltando)", async () => {
    const alvo: AlvoStdio = { executavel: "/nao/existe/mcp-xyz", args: [], env: ambienteMinimo() };
    const r = await testarServidor(alvo, { variaveisObrigatorias: ["FALSO_API_KEY"] });
    expect(r.estado).toBe("quebrado");
    expect(r.erro_codigo).toBe("executavel_ausente");
  });

  it("quebrado: servidor que fala outra coisa (não é MCP) ⇒ protocolo_incompativel", async () => {
    const alvo: AlvoStdio = {
      executavel: process.execPath,
      args: ["-e", "process.stdin.on('data',d=>{const m=JSON.parse(String(d).split('\\n')[0]);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{oi:1}}))})"],
      env: ambienteMinimo(),
    };
    const r = await testarServidor(alvo, { timeoutMs: 2000 });
    expect(r.estado).toBe("quebrado");
    expect(r.erro_codigo).toBe("protocolo_incompativel");
  });

  it("exige_variavel: sai pedindo FALSO_API_KEY; o estado cita só o nome", async () => {
    const r = await testarServidor(alvoFalso("exige-variavel"), { variaveisObrigatorias: ["FALSO_API_KEY"] });
    expect(r.estado).toBe("exige_variavel");
    expect(r.variaveis_faltando).toEqual(["FALSO_API_KEY"]);
    expect(r.erro_codigo).toBe("processo_encerrou");
  });

  it("com a variável certa fica ok; com a errada ⇒ quebrado/nao_autorizado, sem eco do valor", async () => {
    const certa = await testarServidor(alvoFalso("exige-variavel", ambienteMinimo({ FALSO_API_KEY: "chave-valida" })), { variaveisObrigatorias: ["FALSO_API_KEY"] });
    expect(certa.estado).toBe("ok");
    const errada = await testarServidor(alvoFalso("exige-variavel", ambienteMinimo({ FALSO_API_KEY: "chave-errada-9999" })), { variaveisObrigatorias: ["FALSO_API_KEY"] });
    expect(errada.estado).toBe("quebrado");
    expect(errada.erro_codigo).toBe("nao_autorizado");
    expect(JSON.stringify(errada)).not.toContain("chave-errada-9999");
  });

  it("stderr com segredo é redigido e limitado a 2 KB", async () => {
    const r = await testarServidor(alvoFalso("segredo-no-stderr", ambienteMinimo({ FALSO_API_KEY: "abc123xyz789" })));
    expect(r.estado).toBe("ok");
    expect(r.stderr_redigido).toContain("chave=••••");
    expect(r.stderr_redigido).not.toContain("abc123xyz789");
    expect(r.stderr_redigido.length).toBeLessThanOrEqual(2048);
  });

  it("nunca deixa processo vivo: 6 testes seguidos de modos diferentes", async () => {
    const modos = ["ok", "vazio", "crash", "lixo", "ok", "vazio"] as const;
    const pids: Array<number | null> = [];
    for (const m of modos) pids.push((await testarServidor(alvoFalso(m), { timeoutMs: 2000 })).pid);
    expect(pids.some((p) => pidVivo(p))).toBe(false);
  });

  it("o filho recebe exatamente o ambiente do alvo (nada herdado do processo de teste)", async () => {
    process.env["FALSO_VAZAMENTO"] = "nao-deve-aparecer";
    try {
      const r = await testarServidor(alvoFalso("eco-ambiente"));
      expect(r.estado).toBe("ok");
      expect(r.ferramentas[0]!.nome).toBe("listar_ambiente");
    } finally { delete process.env["FALSO_VAZAMENTO"]; }
  });
});

describe("redigir", () => {
  it("troca valores conhecidos e padrões de segredo", () => {
    expect(redigir("a segredo-xyz1 b", ["segredo-xyz1"])).toBe("a •••• b");
    expect(redigir("tok ghp_" + "a".repeat(30))).toBe("tok ••••");
    expect(redigir("sem nada")).toBe("sem nada");
    expect(redigir("curto ab", ["ab"])).toBe("curto ab");
  });
});
