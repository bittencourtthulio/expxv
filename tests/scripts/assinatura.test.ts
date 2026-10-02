// T-21.10 · assinatura e notarização preparadas (D-345, AU-08): só NOMES de variável, falha fechada no release,
// notarizar.cjs sem credencial não age nem toca a rede, entitlements revisados.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUTO } from "../../src/nucleo/produto";
import { avaliarAmbiente, capacidades, redigir } from "../../scripts/lib/assinatura.mjs";
import { DUPLES, RAIZ, ambienteLimpo, cli, escrever, tmp } from "./instaladores-ajuda";

const requireLocal = createRequire(join(RAIZ, "package.json"));
const notarizarMod = requireLocal("./scripts/notarizar.cjs") as { default: (c: unknown, d?: unknown) => Promise<{ acao: string; modo?: string }>; modoDeCredencial: (e: Record<string, string>) => string | null };

const SENT = {
  CSC_LINK: "SENTINELA-csc-link-8f3a",
  CSC_KEY_PASSWORD: "SENTINELA-csc-senha-77b1",
  APPLE_API_KEY: "SENTINELA-apple-key-02de",
  APPLE_API_KEY_ID: "SENTINELA-apple-keyid-19c4",
  APPLE_API_ISSUER: "SENTINELA-apple-issuer-55aa",
  APPLE_ID: "SENTINELA-apple-id-6e60",
  APPLE_APP_SPECIFIC_PASSWORD: "SENTINELA-apple-pwd-c3d9",
  APPLE_TEAM_ID: "SENTINELA-team-4b21",
  WIN_CSC_LINK: "SENTINELA-win-link-a0f7",
  WIN_CSC_KEY_PASSWORD: "SENTINELA-win-senha-93e2",
  AZURE_TENANT_ID: "SENTINELA-az-tenant-1d58",
  AZURE_CLIENT_ID: "SENTINELA-az-client-b7c0",
  AZURE_CLIENT_SECRET: "SENTINELA-az-segredo-2f9e",
  [`${PRODUTO.prefixoEnv}MANIFESTO_CHAVE_PRIVADA`]: "SENTINELA-manifesto-e8d3",
};
const TODAS = Object.values(SENT);

const prep = (args: string[], extra: Record<string, string> = {}) => cli("scripts/assinatura/preparar.mjs", args, {}, ambienteLimpo(extra));

describe("preparar.mjs: capacidades × variável × presente?", () => {
  it("as capacidades citam as variáveis documentadas e a chave do manifesto derivada de PRODUTO", () => {
    const nomes = capacidades(PRODUTO.prefixoEnv).flatMap((c: { alternativas: string[][] }) => c.alternativas.flat());
    for (const n of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", `${PRODUTO.prefixoEnv}MANIFESTO_CHAVE_PRIVADA`]) expect(nomes).toContain(n);
    expect(nomes.some((n: string) => n.startsWith("AZURE_"))).toBe(true);
  });

  it("perfil local sem variáveis: exit 0 dizendo 'build sem assinatura real (R1)' e tabela com não/sim", () => {
    const r = prep(["--verificar"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("build sem assinatura real (R1)");
    expect(r.stdout).toMatch(/CSC_LINK\s+não/);
    expect(r.stdout).toContain("presente?");
  });

  it("perfil release sem variáveis: exit ≠ 0 citando só os NOMES que faltam", () => {
    const r = prep(["--perfil=release", "--verificar"]);
    expect(r.status).not.toBe(0);
    const texto = r.stdout + r.stderr;
    for (const n of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "WIN_CSC_LINK", `${PRODUTO.prefixoEnv}MANIFESTO_CHAVE_PRIVADA`]) expect(texto).toContain(n);
  });

  it("release com tudo presente (alternativa Apple ID e Azure) passa; presença vira 'sim' sem mostrar valor", () => {
    const env = { CSC_LINK: SENT.CSC_LINK, CSC_KEY_PASSWORD: SENT.CSC_KEY_PASSWORD, APPLE_ID: SENT.APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD: SENT.APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID: SENT.APPLE_TEAM_ID, AZURE_TENANT_ID: SENT.AZURE_TENANT_ID, AZURE_CLIENT_ID: SENT.AZURE_CLIENT_ID, AZURE_CLIENT_SECRET: SENT.AZURE_CLIENT_SECRET, [`${PRODUTO.prefixoEnv}MANIFESTO_CHAVE_PRIVADA`]: SENT[`${PRODUTO.prefixoEnv}MANIFESTO_CHAVE_PRIVADA`] };
    const r = prep(["--perfil=release", "--verificar"], env as Record<string, string>);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/CSC_LINK\s+sim/);
    expect(avaliarAmbiente(env, PRODUTO.prefixoEnv).satisfeito).toBe(true);
  });

  it("variável vazia conta como ausente; perfil desconhecido sai com 2", () => {
    expect(avaliarAmbiente({ CSC_LINK: "  ", CSC_KEY_PASSWORD: "x" }, PRODUTO.prefixoEnv).linhas.find((l: { variavel: string }) => l.variavel === "CSC_LINK")?.presente).toBe(false);
    expect(prep(["--perfil=banana"]).status).toBe(2);
  });

  it("AU-08: sentinelas plantadas jamais aparecem em stdout, stderr nem no arquivo de --saida (local, release e simulado)", () => {
    for (const args of [["--verificar"], ["--perfil=release"], ["--perfil=release", "--simulado"], ["--simulado"]]) {
      const saida = join(tmp(), "preparar.txt");
      const r = prep([...args, `--saida=${saida}`], SENT);
      const arquivo = readFileSync(saida, "utf8");
      for (const s of TODAS) {
        expect(r.stdout, args.join(" ")).not.toContain(s);
        expect(r.stderr, args.join(" ")).not.toContain(s);
        expect(arquivo, args.join(" ")).not.toContain(s);
      }
    }
  });

  it("redigir troca o valor de variável sensível por ***", () => {
    expect(redigir(`erro com ${SENT.CSC_KEY_PASSWORD} no meio`, SENT)).toBe("erro com *** no meio");
    expect(redigir(`x ${SENT.AZURE_CLIENT_SECRET} y`, SENT)).toBe("x *** y");
  });
});

describe("preparar.mjs --simulado (dublês)", () => {
  it("roda codesign/notarytool/signtool falsos, sem credencial e sem rede, mesmo no perfil release", () => {
    const log = join(tmp(), "log");
    escrever(log, "");
    const r = prep(["--perfil=release", "--simulado"], { FALSO_LOG: log });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("[simulado] codesign: ok");
    expect(r.stdout).toContain("[simulado] xcrun: ok");
    expect(r.stdout).toContain("[simulado] signtool: ok");
    const chamadas = readFileSync(log, "utf8");
    expect(chamadas).toContain("codesign --sign SIMULADO");
    expect(chamadas).toContain("xcrun notarytool submit");
    expect(chamadas).toContain("signtool sign");
  });

  it("dublê ausente falha", () => {
    const r = prep(["--simulado", `--duples=${tmp()}`]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("dublê ausente");
  });
});

describe("notarizar.cjs (afterSign)", () => {
  const contexto = { electronPlatformName: "darwin", appOutDir: "/tmp/saida", packager: { appInfo: { productFilename: PRODUTO.nome } } };

  it("sem credencial: não executa NADA (nem ditto, nem xcrun) e avisa R1", async () => {
    const chamadas: string[] = [];
    const logs: string[] = [];
    const r = await notarizarMod.default(contexto, { env: {}, executar: (e: string) => (chamadas.push(e), { status: 0 }), log: (m: string) => logs.push(m) });
    expect(r.acao).toBe("ignorada");
    expect(chamadas).toEqual([]);
    expect(logs.join(" ")).toContain("R1");
  });

  it("credencial parcial (falta uma) também não faz nada", async () => {
    const chamadas: string[] = [];
    const r = await notarizarMod.default(contexto, { env: { APPLE_API_KEY: "k", APPLE_API_KEY_ID: "i" }, executar: (e: string) => (chamadas.push(e), { status: 0 }), log: () => undefined });
    expect(r.acao).toBe("ignorada");
    expect(chamadas).toEqual([]);
  });

  it("fora do macOS não faz nada, mesmo com credencial", async () => {
    const chamadas: string[] = [];
    const r = await notarizarMod.default({ ...contexto, electronPlatformName: "win32" }, { env: { ...SENT }, executar: (e: string) => (chamadas.push(e), { status: 0 }), log: () => undefined });
    expect(r.acao).toBe("ignorada");
    expect(chamadas).toEqual([]);
  });

  it("com credencial completa (dublê): compacta, submete e carimba; o log só cita nomes", async () => {
    const chamadas: string[][] = [];
    const logs: string[] = [];
    const r = await notarizarMod.default(contexto, { env: { ...SENT }, executar: (e: string, a: string[]) => (chamadas.push([e, ...a]), { status: 0 }), log: (m: string) => logs.push(m) });
    expect(r).toEqual({ acao: "notarizada", modo: "api" });
    expect(chamadas.map((c) => c.slice(0, 2).join(" "))).toEqual(["ditto -c", "xcrun notarytool", "xcrun stapler"]);
    for (const s of TODAS) expect(logs.join("\n")).not.toContain(s);
  });

  it("falha do notarytool lança erro sem vazar o valor da credencial", async () => {
    const falha = { status: 1, stdout: "", stderr: `erro de autenticação com ${SENT.APPLE_API_KEY_ID}` };
    let erro = "";
    try {
      await notarizarMod.default(contexto, { env: { ...SENT }, executar: (e: string, a: string[]) => (e === "xcrun" && a[0] === "notarytool" ? falha : { status: 0 }), log: () => undefined });
    } catch (e) {
      erro = (e as Error).message;
    }
    expect(erro).toContain("notarytool falhou");
    for (const s of TODAS) expect(erro).not.toContain(s);
  });

  it("o módulo não importa nenhum módulo de rede (sem credencial nada sai da máquina)", () => {
    const src = readFileSync(join(RAIZ, "scripts", "notarizar.cjs"), "utf8");
    expect(src).not.toMatch(/require\(["'](node:)?(http|https|net|tls|dgram|dns|undici)["']\)|fetch\(|XMLHttpRequest|WebSocket/);
  });
});

describe("entitlements do macOS (revisão)", () => {
  const plist = readFileSync(join(RAIZ, "build", "entitlements.mac.plist"), "utf8");
  const semComentarios = plist.replace(/<!--[\s\S]*?-->/g, "");
  const chaves = [...semComentarios.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1] as string);

  it("só microfone, JIT e memória executável, e a validação de bibliotecas desligada COM justificativa", () => {
    expect(chaves.sort()).toEqual(["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.cs.disable-library-validation", "com.apple.security.device.audio-input"]);
  });

  it("cada chave cs.* tem comentário 'Justificativa' citando a própria chave; disable-library-validation cita P-57/sqlite-vec e D-NN", () => {
    for (const c of chaves.filter((k): k is string => k !== undefined && k.includes(".cs."))) {
      const curta = c.split(".").pop();
      expect(plist, c).toMatch(new RegExp(`Justificativa ${curta}:`));
    }
    expect(plist).toMatch(/Justificativa disable-library-validation:[\s\S]*sqlite-vec[\s\S]*D-NN/);
  });

  it("o plist é XML bem-formado: comentários sem '--' interno (parsers estritos recusam)", () => {
    for (const m of plist.matchAll(/<!--([\s\S]*?)-->/g)) expect(m[1]).not.toContain("--");
  });
});

describe("package.json", () => {
  it("os scripts npm das tasks apontam para arquivos que existem", () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).scripts as Record<string, string>;
    for (const k of ["verificar:instaladores", "assinatura:preparar", "verificar:assinatura", "verificar:nativos"]) {
      const arquivo = /node (\S+)/.exec(pkg[k] ?? "")?.[1];
      expect(arquivo, k).toBeTruthy();
      expect(readdirSync(join(RAIZ, arquivo!, "..")), k).toContain(arquivo!.split("/").pop());
    }
    expect(DUPLES).toContain("fixtures/assinatura");
  });
});
