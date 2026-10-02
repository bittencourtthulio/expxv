import { describe, expect, it } from "vitest";
import { hashDeConfianca, linhasDoComando } from "./hash";
import { lerArquivoConfig, validarConfig, urlLoopbackSegura, caminhoRelativoSeguro, executavelSeguro, ambienteSeguroConfig } from "./validacao";
import type { ConfigExecucao } from "./modelo";

const base = (o: Partial<ConfigExecucao> = {}): Record<string, unknown> => ({
  id: "dev", nome: "Rodar (dev)", tipo: "rodar", executavel: "npm", argumentos: ["run", "dev"], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null,
  abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null, ...o,
});

describe("validação estrita da configuração", () => {
  it("aceita a configuração mínima válida", () => {
    const r = validarConfig(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toMatchObject({ id: "dev", origem: "usuario", cwd: "." });
  });

  it.each([
    ["campo extra", { ...base(), extra: 1 }],
    ["campo ausente", (() => { const b = base(); delete b["porta"]; return b; })()],
    ["id com maiúscula", base({ id: "Dev" })],
    ["nome vazio", base({ nome: "  " })],
    ["tipo fora do conjunto", base({ tipo: "x" as never })],
    ["executável com espaço (argumento no campo errado)", base({ executavel: "npm run dev" })],
    ["executável começando com '-'", base({ executavel: "--eval" })],
    ["executável absoluto", base({ executavel: "/usr/bin/node" })],
    ["executável com metacaractere de shell", base({ executavel: "npm;rm" })],
    ["executável relativo com ..", base({ executavel: "../x/run.sh" })],
    ["cwd absoluto", base({ cwd: "/etc" })],
    ["cwd com ..", base({ cwd: "a/../../b" })],
    ["cwd com barra invertida", base({ cwd: "a\\b" })],
    ["cwd de unidade do Windows", base({ cwd: "C:/x" })],
    ["cwd com ~", base({ cwd: "~/x" })],
    ["argumento com NUL", base({ argumentos: ["a\0b"] })],
    ["argumentos demais", base({ argumentos: Array.from({ length: 65 }, () => "a") })],
    ["porta fora da faixa", base({ porta: 70_000 })],
    ["url externa", base({ url: "http://exemplo.com:3000" })],
    ["url com credenciais", base({ url: "http://u:p@localhost:3000" })],
    ["url file:", base({ url: "file:///etc/passwd" })],
    ["ambiente com PATH", base({ ambiente: { PATH: "/x" } })],
    ["ambiente com LD_PRELOAD", base({ ambiente: { LD_PRELOAD: "/x.so" } })],
    ["ambiente com ORCA_", base({ ambiente: { ORCA_TOKEN: "{{vault:A}}" } })],
    ["ambiente sensível sem cofre", base({ ambiente: { API_KEY: "abc123" } })],
    ["ambiente com cara de segredo em nome neutro", base({ ambiente: { OUTRA: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } })],
    ["ambiente com URL com senha", base({ ambiente: { DATABASE: "postgres://u:senha@host/db" } })],
    ["ambiente com referência de cofre malformada", base({ ambiente: { X: "a {{vault:Y}} b" } })],
    ["shell com argumentos", base({ shell: "make && make run", argumentos: ["x"] })],
    ["grupo inválido", base({ grupo: "Grupo 1" })],
    ["pré-passo com campo extra", base({ pre_passos: [{ executavel: "npm", argumentos: [], x: 1 } as never] })],
    ["pré-passos demais", base({ pre_passos: Array.from({ length: 9 }, () => ({ executavel: "npm", argumentos: [] })) })],
  ] as Array<[string, unknown]>)("recusa: %s", (_n, entrada) => {
    expect(validarConfig(entrada).ok).toBe(false);
  });

  it("aceita referência do cofre, porta, url loopback e shell com rótulo vazio", () => {
    expect(validarConfig(base({ ambiente: { API_KEY: "{{vault:MINHA_CHAVE}}", NODE_ENV: "development" } })).ok).toBe(true);
    expect(validarConfig(base({ porta: 5173, url: "http://localhost:5173/" })).ok).toBe(true);
    const sh = validarConfig(base({ shell: "make build && ./app", executavel: "", argumentos: [] }));
    expect(sh.ok).toBe(true);
  });

  it("urlLoopbackSegura normaliza 0.0.0.0 e recusa host externo", () => {
    expect(urlLoopbackSegura("http://0.0.0.0:3000/x")).toEqual({ ok: true, valor: "http://localhost:3000/x" });
    expect(urlLoopbackSegura("https://[::1]:8443")).toMatchObject({ ok: true });
    expect(urlLoopbackSegura("http://localhost.evil.com:80").ok).toBe(false);
    expect(urlLoopbackSegura("javascript:alert(1)").ok).toBe(false);
  });

  it("caminhoRelativoSeguro e executavelSeguro normalizam", () => {
    expect(caminhoRelativoSeguro("./a//b/./c/")).toEqual({ ok: true, valor: "a/b/c" });
    expect(caminhoRelativoSeguro("")).toEqual({ ok: true, valor: "." });
    expect(executavelSeguro("./gradlew")).toEqual({ ok: true, valor: "./gradlew" });
    expect(executavelSeguro("scripts/run.sh")).toEqual({ ok: true, valor: "scripts/run.sh" });
    expect(ambienteSeguroConfig({ "1X": "a" }).ok).toBe(false);
  });
});

describe("arquivo .expxv/executar.json", () => {
  it("lê o que é válido, descarta o inválido com aviso e ignora `origem` do arquivo", () => {
    const { arquivo, avisos } = lerArquivoConfig({
      versao: 1, padrao: "dev",
      configuracoes: [{ ...base(), origem: "detectada" }, { ...base({ id: "ruim", executavel: "/bin/sh" }) }, base(), { lixo: 1 }],
    });
    expect(arquivo.configuracoes.map((c) => c.id)).toEqual(["dev"]);
    expect(arquivo.configuracoes[0]!.origem).toBe("usuario");
    expect(arquivo.padrao).toBe("dev");
    expect(avisos.length).toBe(3);
  });
  it("versão desconhecida ou formato errado vira vazio com aviso", () => {
    expect(lerArquivoConfig({ versao: 2 }).arquivo.configuracoes).toEqual([]);
    expect(lerArquivoConfig([1]).avisos.length).toBe(1);
    expect(lerArquivoConfig(null).avisos.length).toBe(1);
  });
});

describe("hash de confiança", () => {
  const c = validarConfig(base()) as { ok: true; valor: ConfigExecucao };
  const h = (o: Partial<ConfigExecucao>, corpo: string | null = null) => hashDeConfianca({ ...c.valor, ...o }, corpo);
  it("é estável e muda com QUALQUER coisa que determine o que roda", () => {
    const ref = h({});
    expect(h({})).toBe(ref);
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
    for (const mudanca of [
      { executavel: "pnpm" }, { argumentos: ["run", "build"] }, { cwd: "api" }, { ambiente: { A: "1" } },
      { pre_passos: [{ executavel: "npm", argumentos: ["ci"] }] }, { shell: "npm run dev" },
    ] as Array<Partial<ConfigExecucao>>) expect(h(mudanca)).not.toBe(ref);
    expect(h({}, "vite")).not.toBe(ref);
    expect(h({}, "vite --host")).not.toBe(h({}, "vite"));
  });
  it("não muda com o que não afeta a execução (nome, porta, abrir navegador)", () => {
    const ref = h({});
    expect(h({ nome: "Outro", porta: 3000, abrir_navegador: true, url: "http://localhost:3000/" })).toBe(ref);
  });
  it("a ordem das chaves do ambiente não importa", () => {
    expect(h({ ambiente: { A: "1", B: "2" } })).toBe(h({ ambiente: { B: "2", A: "1" } }));
  });
  it("linhasDoComando mostra o comando exato (com aspas quando preciso) e marca o shell", () => {
    expect(linhasDoComando({ executavel: "npm", argumentos: ["run", "dev"], pre_passos: [{ executavel: "npm", argumentos: ["ci"] }], shell: null })).toEqual(["npm ci", "npm run dev"]);
    expect(linhasDoComando({ executavel: "x", argumentos: ["a b", "it's"], pre_passos: [], shell: null })).toEqual(["x 'a b' 'it'\\''s'"]);
    expect(linhasDoComando({ executavel: "", argumentos: [], pre_passos: [], shell: "make && ./app" })).toEqual(["[shell] make && ./app"]);
  });
});
