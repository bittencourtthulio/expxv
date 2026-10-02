// T-21.28: scripts de manifesto e assinatura Ed25519. O manifesto gerado precisa ser aceito pelo núcleo do atualizador (politica.ts);
// sem chave o manifesto sai marcado `nao_assinado` e é RECUSADO; a chave privada nunca aparece em saída nem em arquivo (AU-01, AU-07).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { avaliarManifesto } from "../../src/nucleo/atualizador/politica";
import { nomeDaVariavelDaChave } from "../../scripts/lib/manifesto.mjs";
import { CHAVES_ACEITAS_DE_TESTE, privadaPemDeTeste, publicaDeTeste } from "../fixtures/atualizacao/chaves-de-teste";
import { artefatoSintetico, sha512Hex } from "../fixtures/atualizacao/manifestos";

const RAIZ = resolve(__dirname, "..", "..");
const GERAR = join(RAIZ, "scripts", "gerar-manifesto.mjs");
const ASSINAR = join(RAIZ, "scripts", "assinar-manifesto.mjs");
const AGORA = new Date();
let pasta = "";
let artefato = "";
const conteudo = artefatoSintetico(2048);
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "manifesto-scripts-"));
  artefato = join(pasta, "App-universal.dmg");
  writeFileSync(artefato, conteudo);
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

const VARIAVEL = nomeDaVariavelDaChave(RAIZ);
function rodar(script: string, argv: string[], extra: Record<string, string> = {}) {
  const ambiente: Record<string, string> = { PATH: String(process.env.PATH) };
  Object.assign(ambiente, extra); // a variável da chave só existe se o teste a puser
  return spawnSync("node", [script, ...argv], { cwd: RAIZ, encoding: "utf8", env: ambiente });
}
function gerar(versao = "1.1.0", canal = "stable", extra: string[] = []) {
  const r = rodar(GERAR, ["--versao", versao, "--canal", canal, "--artefato", `darwin:universal:${artefato}:${canal}/${versao}/App-universal.dmg`, "--saida", pasta, "--notas", join(pasta, "n.md"), ...extra]);
  return { r, caminho: join(pasta, canal, "manifesto.json") };
}
function avaliar(caminho: string, sobre: Record<string, unknown> = {}) {
  const sig = existsSync(`${caminho}.sig`) ? readFileSync(`${caminho}.sig`, "utf8") : null;
  return avaliarManifesto({
    bytes: readFileSync(caminho),
    assinatura: sig,
    chavesAceitas: CHAVES_ACEITAS_DE_TESTE,
    versaoAtual: "1.0.0",
    canal: "stable",
    betaConsentido: false,
    idInstalacao: "5f0c1a2e-0000-4000-8000-000000000001",
    agora: AGORA,
    ultimoPublicadoEm: null,
    plataforma: "darwin",
    arquitetura: "arm64",
    ...sobre,
  });
}

describe("gerar-manifesto", () => {
  it("gera o manifesto a partir do artefato real (sha512 e tamanho conferem) e o núcleo o lê", () => {
    writeFileSync(join(pasta, "n.md"), "## 1.1.0\n- novidade");
    const { r, caminho } = gerar();
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(readFileSync(caminho, "utf8"));
    expect(m.artefatos[0]).toMatchObject({ plataforma: "darwin", arquitetura: "universal", sha512: sha512Hex(conteudo), tamanho: conteudo.length, url_relativa: "stable/1.1.0/App-universal.dmg" });
    expect(m.notas).toContain("novidade");
    expect(Date.parse(m.valido_ate) - Date.parse(m.publicado_em)).toBe(30 * 86_400_000);
  });
  it("artefato inexistente e argumentos faltando falham com mensagem clara", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    expect(rodar(GERAR, ["--versao", "1.0.0", "--canal", "stable", "--artefato", `darwin:universal:${join(pasta, "nao-existe.dmg")}:a/b.dmg`]).status).toBe(1);
    expect(rodar(GERAR, []).status).toBe(1);
  });
});

describe("assinar-manifesto", () => {
  it("com a chave de teste (arquivo fora do repo) a assinatura é aceita pelo núcleo: `disponivel`", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    const chave = join(pasta, "chave.pem");
    writeFileSync(chave, privadaPemDeTeste("atual"));
    const r = rodar(ASSINAR, ["--manifesto", caminho, "--chave", chave, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")]);
    expect(r.status, r.stderr).toBe(0);
    const a = avaliar(caminho);
    expect(a.ok && a.tipo === "disponivel").toBe(true);
  });

  it("variável de ambiente do CI (semente base64) assina; a rotação (chave próxima) também é aceita", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    const pem = privadaPemDeTeste("proxima");
    const r = rodar(ASSINAR, ["--manifesto", caminho, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")], { [VARIAVEL]: pem });
    expect(r.status, r.stderr).toBe(0);
    const a = avaliar(caminho);
    expect(a.ok && a.tipo === "disponivel" && a.chaveUsada === publicaDeTeste("proxima")).toBe(true);
  });

  it("chave que o build não aceita: erro, nenhuma .sig escrita", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    const chave = join(pasta, "intrusa.pem");
    writeFileSync(chave, privadaPemDeTeste("intrusa"));
    const r = rodar(ASSINAR, ["--manifesto", caminho, "--chave", chave, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")]);
    expect(r.status).toBe(1);
    expect(existsSync(`${caminho}.sig`)).toBe(false);
  });

  it("sem chave: manifesto marcado `nao_assinado`, sem .sig, e o app o RECUSA; com --exigir sai com erro", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    const r = rodar(ASSINAR, ["--manifesto", caminho, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(VARIAVEL);
    expect(JSON.parse(readFileSync(caminho, "utf8")).nao_assinado).toBe(true);
    expect(existsSync(`${caminho}.sig`)).toBe(false);
    const a = avaliar(caminho);
    expect(a).toEqual({ ok: false, motivo: "assinatura_ausente" });
    const { caminho: c2 } = gerar("1.2.0");
    expect(rodar(ASSINAR, ["--manifesto", c2, "--exigir"]).status).toBe(1);
  });

  it("assinar manifesto já marcado `nao_assinado` é recusado", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    rodar(ASSINAR, ["--manifesto", caminho]);
    const chave = join(pasta, "chave.pem");
    writeFileSync(chave, privadaPemDeTeste("atual"));
    expect(rodar(ASSINAR, ["--manifesto", caminho, "--chave", chave, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")]).status).toBe(1);
  });

  it("au07: a chave privada NUNCA aparece em stdout/stderr nem em arquivo gerado, nem com chave inválida (sentinela)", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    const pem = privadaPemDeTeste("atual");
    const corpoPem = pem.replace(/-----[A-Z ]+-----|\s/g, "");
    const ok = rodar(ASSINAR, ["--manifesto", caminho, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")], { [VARIAVEL]: pem });
    const ruim = rodar(ASSINAR, ["--manifesto", caminho, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")], { [VARIAVEL]: "SENTINELA-chave-privada-0042" });
    expect(ruim.status).toBe(1);
    for (const saida of [ok.stdout, ok.stderr, ruim.stdout, ruim.stderr]) {
      expect(saida).not.toContain(corpoPem);
      expect(saida).not.toContain("BEGIN");
      expect(saida).not.toContain("SENTINELA");
    }
    expect(ruim.stderr).toContain(VARIAVEL); // cita o NOME, nunca o valor
    for (const f of readdirSync(join(pasta, "stable"))) expect(readFileSync(join(pasta, "stable", f), "utf8")).not.toContain(corpoPem);
  });

  it("chave dentro do repositório é recusada; sem chaves públicas conhecidas não há como conferir", () => {
    writeFileSync(join(pasta, "n.md"), "x");
    const { caminho } = gerar();
    const dentro = join(RAIZ, "tests", "fixtures", "chave-que-nao-deve-existir.pem");
    const r = rodar(ASSINAR, ["--manifesto", caminho, "--chave", dentro, "--publicas", CHAVES_ACEITAS_DE_TESTE.join(",")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/dentro do repositório/);
    mkdirSync(join(pasta, "fora"));
    const chave = join(pasta, "fora", "k.pem");
    writeFileSync(chave, privadaPemDeTeste("atual"));
    const semPublicas = rodar(ASSINAR, ["--manifesto", caminho, "--chave", chave]); // build/distribuicao.json tem chaves_aceitas vazio
    expect(semPublicas.status).toBe(1);
    expect(semPublicas.stderr).toMatch(/nenhuma chave pública/);
  });

  it("os scripts não gravam nada em dist-app/ e o nome da variável deriva de produto.ts", () => {
    expect(VARIAVEL).toMatch(/^[A-Z0-9]+_MANIFESTO_CHAVE_PRIVADA$/);
    for (const f of [GERAR, ASSINAR, join(RAIZ, "scripts", "lib", "manifesto.mjs")]) expect(readFileSync(f, "utf8")).not.toMatch(/dist-app\/.*writeFile|writeFileSync\([^)]*dist-app/);
  });
});
