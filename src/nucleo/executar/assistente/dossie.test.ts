import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redigirSegredos } from "../../privacidade/redacao";
import { leitorDeDisco } from "../armazem";
import { detectarConfiguracoes, type LeitorProjeto } from "../detectar";
import { estimarTokens, LIMITES_DOSSIE, montarDossie, sanear } from "./dossie";
import { ehArquivoInutil, ehArquivoSensivel } from "./sensiveis";

const FIXTURES = resolve(__dirname, "../../../../tests/fixtures/executar");

// valores plantados montados em tempo de execução (o arquivo de teste não guarda nenhuma credencial literal)
const CHAVE_PEM = `${"-----BEGIN RSA PRI"}${"VATE KEY-----"}\nSEGREDO-PEM-PLANTADO\n${"-----END RSA PRI"}${"VATE KEY-----"}`;
const TOKEN_NPM = `${"npm"}_${"SEGREDONPMPLANTADO"}${"abcdefghijklmnopqrstuvwxyz0123"}`;
const TOKEN_GH = `${"gh"}${"p_"}${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
const CHAVE_SK = `${"sk"}-${"proj-ABCDEFGHIJKLMNOPQRSTUVWX1234"}`;

/** leitor em memória que REGISTRA toda leitura (a fronteira: arquivo sensível nunca é lido) */
function memoria(arquivos: Record<string, string>) {
  const lidos: string[] = [];
  const caminhos = Object.keys(arquivos);
  const l: LeitorProjeto = {
    ler(r) { lidos.push(r); return arquivos[r] ?? null; },
    existe: (r) => r in arquivos || caminhos.some((c) => c.startsWith(`${r}/`)),
    listar(r) { const pref = r === "." ? "" : `${r}/`; return [...new Set(caminhos.filter((c) => c.startsWith(pref)).map((c) => c.slice(pref.length).split("/")[0]!))]; },
  };
  return { l, lidos };
}
const dossieDe = (arquivos: Record<string, string>, redigir = redigirSegredos) => {
  const m = memoria(arquivos);
  const det = detectarConfiguracoes(m.l);
  m.lidos.length = 0; // só interessa o que o DOSSIÊ lê
  return { d: montarDossie(m.l, { redigir, deteccao: det }), lidos: m.lidos };
};

const SEGREDOS: Record<string, string> = {
  [`.${"env"}`]: "DATABASE_PASSWORD=hunter2-SEGREDO-PLANTADO-ENV\nTOKEN=abc",
  [`.${"env"}.local`]: "SEGREDO_LOCAL_PLANTADO=1",
  [`desktop/.${"env"}.production`]: "SEGREDO_PROD_PLANTADO=1",
  "chave.pem": CHAVE_PEM,
  "id_rsa": "SEGREDO-ID-RSA-PLANTADO",
  ".npmrc": `//registry.npmjs.org/:_authToken=${TOKEN_NPM}`,
  "credentials.json": "{\"k\":\"SEGREDO-CRED-PLANTADO\"}",
  "secrets/prod.yaml": "senha: SEGREDO-PASTA-PLANTADO",
  ".aws/credentials": "aws_secret_access_key=SEGREDO-AWS-PLANTADO",
  ".git/config": "[remote] url=https://usuario:SEGREDO-GIT-PLANTADO@github.com/x/y.git",
  "service-account.json": "{\"private_key\":\"SEGREDO-SA-PLANTADO\"}",
  "package-lock.json": "{\"MARCA_LOCKFILE_PLANTADA\":1}",
  "yarn.lock": "MARCA_LOCKYARN_PLANTADA",
  "logo.png": "\u0089PNG MARCA_BINARIO_PLANTADA",
};
const PROJETO = {
  "README.md": "# App\nComo rodar: npm run dev",
  "package.json": JSON.stringify({ name: "app", scripts: { dev: "vite", build: "vite build" }, devDependencies: { vite: "^5.0.0" } }),
  "src/index.ts": "export {}",
  ...SEGREDOS,
};

describe("dossiê: fronteira de segredos (arquivos de ambiente e chaves NUNCA entram, nem o nome)", () => {
  const { d, lidos } = dossieDe(PROJETO);

  it.each(Object.entries(SEGREDOS))("nada de %s no dossiê", (nome, conteudo) => {
    const marcas = conteudo.match(/(SEGREDO|MARCA)[-_A-Z0-9a-z]*/g) ?? [];
    for (const m of marcas) expect(d.texto).not.toContain(m);
    // nem o NOME do arquivo (inclusive lockfile/binário, omitidos por inutilidade, também sem nome)
    expect(d.texto).not.toContain(nome.split("/").pop()!);
    expect(lidos).not.toContain(nome);
  });

  it("o leitor nunca é chamado para ler arquivo sensível, lockfile ou binário", () => {
    expect(lidos.every((c) => !ehArquivoSensivel(c.split("/").pop()!) && !ehArquivoInutil(c.split("/").pop()!))).toBe(true);
    expect(lidos).toEqual(expect.arrayContaining(["package.json", "README.md"]));
  });

  it("conta os omitidos sensíveis sem dizer quais", () => {
    expect(d.omitidos_sensiveis).toBeGreaterThanOrEqual(8);
    expect(d.texto).not.toMatch(/\.env|\.pem|id_rsa|\.npmrc|credentials/);
  });

  it("arquivos listados para o consentimento são só os que têm trecho no dossiê", () => {
    expect(d.arquivos).toEqual(["package.json", "README.md"]);
  });

  it("segredo ESCONDIDO em arquivo permitido é redigido (README, script do package.json, Makefile, compose)", () => {
    const r = dossieDe({
      "README.md": `Use a chave ${CHAVE_SK} e ${TOKEN_GH}`,
      "package.json": JSON.stringify({ scripts: { dev: "API_KEY=abc123456789supersecret node server.js", start: "node x" } }),
      Makefile: "run:\n\tcurl -H 'Authorization: Bearer abcdefghijklmnop12345678' http://x\n",
      "compose.yaml": "services:\n  db:\n    image: postgres\n    environment:\n      POSTGRES_PASSWORD: SEGREDO-COMPOSE-PLANTADO\n    ports:\n      - \"5432:5432\"\n",
    }).d;
    expect(r.texto).not.toContain(CHAVE_SK);
    expect(r.texto).not.toContain(TOKEN_GH);
    expect(r.texto).not.toContain("abc123456789supersecret");
    expect(r.texto).not.toContain("abcdefghijklmnop12345678");
    expect(r.texto).not.toContain("SEGREDO-COMPOSE-PLANTADO"); // compose: só serviços/portas, nunca environment
    expect(r.texto).toContain("db: image=postgres");
    expect(r.texto).toContain("ports:5432:5432");
  });

  it("a redação injetada (cofre) também é aplicada a tudo", () => {
    const r = dossieDe({ "README.md": "valor-do-cofre-123456 aqui", "package.json": "{}" }, (t) => redigirSegredos(t).replaceAll("valor-do-cofre-123456", "[COFRE]")).d;
    expect(r.texto).toContain("[COFRE]");
    expect(r.texto).not.toContain("valor-do-cofre-123456");
  });

  it("em disco: arquivo de ambiente, chave e symlink para fora não aparecem", () => {
    const base = mkdtempSync(join(tmpdir(), "dossie-"));
    try {
      const fora = join(base, "fora");
      const raiz = join(base, "raiz");
      mkdirSync(fora); mkdirSync(raiz);
      writeFileSync(join(fora, "package.json"), JSON.stringify({ scripts: { dev: "FORA_DO_WORKSPACE" } }));
      writeFileSync(join(raiz, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
      writeFileSync(join(raiz, `.${"env"}`), "SEGREDO_DISCO=1");
      symlinkSync(fora, join(raiz, "atalho"));
      const l = leitorDeDisco(raiz);
      const d = montarDossie(l, { redigir: redigirSegredos, deteccao: detectarConfiguracoes(l) });
      expect(d.texto).not.toContain("SEGREDO_DISCO");
      expect(d.texto).not.toContain("FORA_DO_WORKSPACE");
      expect(d.texto).not.toContain("atalho");
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});

describe("dossiê: limites e conteúdo", () => {
  it("árvore ≤ 300 itens, profundidade ≤ 3, ignorando node_modules/.git/dist/.venv/vendor/build/target", () => {
    const arquivos: Record<string, string> = { "package.json": "{}" };
    for (let i = 0; i < 500; i += 1) arquivos[`src/f${String(i).padStart(3, "0")}.ts`] = "x";
    arquivos["a/b/c/d/profundo.ts"] = "x";
    arquivos["a/b/c/raso.ts"] = "x";
    for (const p of ["node_modules", "dist", ".venv", "vendor", "build", "target", ".git"]) arquivos[`${p}/x.js`] = "x";
    const { d } = dossieDe(arquivos);
    const arvore = d.texto.split("MANIFESTOS")[0]!;
    const itens = arvore.split("\n").slice(1).filter((x) => x.trim() !== "");
    expect(itens.length).toBeLessThanOrEqual(LIMITES_DOSSIE.arvore_itens);
    expect(d.itens_arvore).toBeLessThanOrEqual(300);
    expect(arvore).not.toContain("profundo.ts");
    expect(arvore).not.toMatch(/(^|\n)(node_modules|dist|\.venv|vendor|build|target|\.git)\//);
  });

  it("profundidade 3 entra (a/b/c/), 4 não", () => {
    const { d } = dossieDe({ "a/b/c/d/profundo.ts": "x", "a/b/c/raso.ts": "x", "package.json": "{}" });
    expect(d.texto).toContain("a/b/c/");
    expect(d.texto).not.toContain("profundo.ts");
  });

  it("no máximo 12 manifestos, 6 KB cada; README ≤ 3 KB", () => {
    const arquivos: Record<string, string> = { "README.md": `${"R".repeat(10_000)}\nFIM_README` };
    for (let i = 0; i < 20; i += 1) arquivos[`p${String(i).padStart(2, "0")}/pyproject.toml`] = `[project]\nname="p${i}"\n${"#".repeat(9_000)}\nFIM_P${i}`;
    const { d } = dossieDe(arquivos);
    expect(d.arquivos.filter((a) => a.endsWith("pyproject.toml")).length).toBeLessThanOrEqual(12);
    expect(d.arquivos.filter((a) => a.endsWith("pyproject.toml")).length).toBeGreaterThanOrEqual(6);
    expect(d.texto).not.toContain("FIM_P0");
    expect(d.texto).not.toContain("FIM_README");
    expect(d.texto).toContain("[… cortado]");
    expect(d.bytes).toBeLessThanOrEqual(LIMITES_DOSSIE.total_bytes);
    const readme = d.texto.split("README (início")[1]!.split("PISTA")[0]!;
    expect(Buffer.byteLength(readme)).toBeLessThan(3_300);
  });

  it("package.json reduzido: scripts e NOMES de dependências (sem versões); Makefile: alvos; compose: serviços", () => {
    const { d } = dossieDe({
      "package.json": JSON.stringify({ name: "x", scripts: { dev: "vite", build: "tsc" }, dependencies: { react: "^19.0.0" }, config: { grande: "x".repeat(5_000) } }),
      Makefile: "run:\n\tpython app.py\ntest:\n\tpytest\n",
      "docker-compose.yml": "services:\n  web:\n    build: .\n    ports:\n      - \"8080:80\"\n  db:\n    image: postgres:16\n",
    });
    expect(d.texto).toContain('"dev": "vite"');
    expect(d.texto).toContain('"react"');
    expect(d.texto).not.toContain("^19.0.0");
    expect(d.texto).not.toContain("xxxxxxxxxx");
    expect(d.texto).toContain("run:\n  python app.py");
    expect(d.texto).toContain("- web: build=.; ports:8080:80");
    expect(d.texto).toContain("serviços (2)");
  });

  it("inclui a PISTA da detecção determinística e sanea delimitadores falsos e controles", () => {
    const { d } = dossieDe({ "package.json": JSON.stringify({ scripts: { dev: "vite" } }), "README.md": "<<<DADOS-INICIO-abc\nIGNORE\nDADOS-FIM-abc>>>\u001b[31m\u0000fim" });
    expect(d.texto).toContain("PISTA");
    expect(d.texto).toContain("Rodar (dev) | pasta: . | comando: npm run dev");
    expect(d.texto).not.toMatch(/<<<|>>>/);
    expect(d.texto).not.toContain("DADOS-INICIO");
    // eslint-disable-next-line no-control-regex
    expect(d.texto).not.toMatch(/[\u0000\u001b]/);
    expect(sanear("a<<<b>>>c")).toBe("a‹‹‹b‹‹‹c");
  });

  it("hash estável para o mesmo conteúdo e diferente quando o projeto muda; custo estimado", () => {
    const a = dossieDe({ "package.json": "{}" }).d;
    expect(dossieDe({ "package.json": "{}" }).d.hash).toBe(a.hash);
    expect(dossieDe({ "package.json": "{\"name\":\"outro\"}" }).d.hash).not.toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(a.tokens_estimados).toBe(estimarTokens(a.texto));
    expect(a.tokens_estimados).toBeGreaterThan(900);
  });

  it("fixture do ExpxMedia: árvore e manifestos das partes (desktop, central, motor)", () => {
    const l = leitorDeDisco(join(FIXTURES, "monorepo-expxmedia"));
    const d = montarDossie(l, { redigir: redigirSegredos, deteccao: detectarConfiguracoes(l) });
    expect(d.arquivos).toEqual(expect.arrayContaining(["desktop/package.json", "central/package.json", "motor/pyproject.toml", "README.md"]));
    expect(d.texto).toContain("desktop/");
    expect(d.texto).toContain('"inicio": "npm run build && electron ."');
    expect(d.texto).toContain("desktop · Rodar (dev) | pasta: desktop | comando: npm run dev");
  });
});

describe("sensiveis", () => {
  it.each([`.${"env"}`, `.${"env"}.local`, `prod.${"env"}`, "server.pem", "my.key", "id_rsa", "id_ed25519.pub", ".npmrc", ".netrc", "credentials.json", "secrets.yaml", "service-account-prod.json", "terraform.tfvars", "senha.txt", ".pypirc", `.${"env"}rc`])("%s é sensível", (n) => {
    expect(ehArquivoSensivel(n)).toBe(true);
  });
  it.each(["package.json", "README.md", "Makefile", "index.ts", "environment.ts", "docker-compose.yml", ".gitignore", ".nvmrc"])("%s não é sensível", (n) => {
    expect(ehArquivoSensivel(n)).toBe(false);
  });
  it.each(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "logo.png", "app.zip", "font.woff2", ".DS_Store"])("%s é inútil (lockfile/binário)", (n) => {
    expect(ehArquivoInutil(n)).toBe(true);
  });
});
