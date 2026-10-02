// AU-08 · nenhum certificado, chave privada ou token versionado (D-23, D-345). Usa `git ls-files`; sem rede.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const arquivos = execFileSync("git", ["ls-files", "-z"], { cwd: RAIZ, encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\0")
  .filter(Boolean);

const EXTENSOES_PROIBIDAS = /\.(p12|pfx|p8|pem|key|cer|crt|der|jks|keystore|mobileprovision|provisionprofile|gpg|asc)$/i;
const NOMES_PROIBIDOS = /(^|\/)(\.env(\.[^/]+)?|id_rsa|id_ed25519|id_ecdsa|credentials\.json|\.npmrc|\.netrc)$/i;
// Padrões de conteúdo (montados por partes para o próprio arquivo não casar consigo).
const PADROES: [string, RegExp][] = [
  ["bloco de chave privada", new RegExp("-----BEGIN " + "(?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY")],
  ["token do GitHub", new RegExp("\\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\\b")],
  ["chave AWS", new RegExp("\\bAKIA[0-9A-Z]{16}\\b")],
  ["token do npm", new RegExp("\\bnpm_[A-Za-z0-9]{36}\\b")],
  ["token do Slack", new RegExp("\\bxox[baprs]-[A-Za-z0-9-]{10,}")],
  ["chave de API sk-", new RegExp("\\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\\b")],
  ["certificado em base64 inline (p12)", new RegExp("(?:CSC_LINK|WIN_CSC_LINK)\\s*[:=]\\s*[\"']?MII[A-Za-z0-9+/]{40,}")],
];
const MAX_BYTES = 2 * 1024 * 1024;
// Fixtures que plantam segredos FALSOS de propósito (sentinelas de teste de redação). Lista exata: arquivo novo é sempre varrido.
const FIXTURES_FALSAS = new Set([
  ".expx/marketplace/plugins/expx/hooks/testes/testar-falsos-positivos.sh",
  ".expx/marketplace/plugins/expx/hooks/testes/testar.sh",
  "src/main/orquestracao.test.ts",
  "src/nucleo/banco/repos/conta-openrouter.test.ts",
  "src/nucleo/mapa/redacao.test.ts",
  "tests/fixtures/forge/gh/auth-status.txt",
  "tests/fixtures/mapa/typescript/src/segredo.ts",
]);

describe("segredos versionados (AU-08)", () => {
  it("git ls-files lista arquivos (o teste não passa vazio)", () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it("nenhum .p12/.p8/.pem/.key/.pfx e nenhum arquivo de ambiente ou credencial versionado", () => {
    const ruins = arquivos.filter((f) => EXTENSOES_PROIBIDAS.test(f) || NOMES_PROIBIDOS.test(f));
    expect(ruins).toEqual([]);
  });

  it("nenhum conteúdo versionado casa com chave privada, token ou certificado inline", () => {
    const achados: string[] = [];
    for (const f of arquivos) {
      if (FIXTURES_FALSAS.has(f)) continue;
      const caminho = join(RAIZ, f);
      let tamanho = 0;
      try {
        tamanho = statSync(caminho).size;
      } catch {
        continue; // apagado na árvore de trabalho
      }
      if (tamanho > MAX_BYTES || tamanho === 0) continue;
      const buf = readFileSync(caminho);
      if (buf.subarray(0, 8000).includes(0)) continue; // binário
      const texto = buf.toString("utf8");
      for (const [nome, re] of PADROES) if (re.test(texto)) achados.push(`${f}: ${nome}`);
    }
    expect(achados).toEqual([]);
  });

  it("a lista de fixtures falsas só contém arquivos que existem (nada de exceção órfã)", () => {
    for (const f of FIXTURES_FALSAS) expect(arquivos, f).toContain(f);
  });

  it(".gitignore barra os formatos de credencial", () => {
    const gi = readFileSync(join(RAIZ, ".gitignore"), "utf8");
    for (const padrao of [".env", "*.pem", "*.key", "*.p12", "*.pfx"]) expect(gi).toContain(padrao);
  });
});
