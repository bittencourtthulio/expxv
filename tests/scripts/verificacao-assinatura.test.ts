// T-21.11 · verificação de assinatura do .app e do instalador (AU-20), com dublês de codesign/spctl/xcrun/signtool.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chavesDeEntitlements, verificarAssinaturaApp } from "../../scripts/lib/assinatura.mjs";
import { DUPLES, RAIZ, cli, criarApp, escrever, pe, tmp } from "./instaladores-ajuda";

const ferramentas = { codesign: join(DUPLES, "codesign"), spctl: join(DUPLES, "spctl"), xcrun: join(DUPLES, "xcrun") };
const doRepo = chavesDeEntitlements(readFileSync(join(RAIZ, "build", "entitlements.mac.plist"), "utf8"));
const argsDuples = [`--codesign=${ferramentas.codesign}`, `--spctl=${ferramentas.spctl}`, `--xcrun=${ferramentas.xcrun}`];
const envEnt = { FALSO_ENTITLEMENTS: join(RAIZ, "build", "entitlements.mac.plist") };

function appNaoAssinado(): string {
  const app = criarApp(tmp());
  escrever(join(app, ".nao-assinado"), "");
  return app;
}

describe("verificarAssinaturaApp (dublês)", () => {
  it("assinado: codesign --verify, spctl, stapler e entitlements passam", () => {
    const app = criarApp(tmp());
    const r = verificarAssinaturaApp({ app, esperado: "assinado", ferramentas, entitlementsEsperados: chavesDeEntitlements(readFileSync(join(DUPLES, "entitlements-falso.plist"), "utf8")) });
    expect(r.problemas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c: { id: string }) => c.id)).toEqual(["assinatura-real", "codesign-verify", "spctl", "stapler", "entitlements"]);
  });

  it("não assinado + esperado assinado falha com todos os itens; esperado nao_assinado passa dizendo R1", () => {
    const app = appNaoAssinado();
    const a = verificarAssinaturaApp({ app, esperado: "assinado", ferramentas, entitlementsEsperados: doRepo });
    expect(a.ok).toBe(false);
    expect(a.problemas.join(" ")).toContain("sem assinatura real: R1");
    expect(a.problemas.join(" ")).toContain("codesign --verify --deep --strict: falhou");
    expect(a.problemas.join(" ")).toContain("spctl --assess: recusado");
    const n = verificarAssinaturaApp({ app, esperado: "nao_assinado", ferramentas, entitlementsEsperados: doRepo });
    expect(n.ok).toBe(true);
    expect(n.nota).toBe("sem assinatura real: R1");
  });

  it("assinado mas esperado nao_assinado falha", () => {
    const r = verificarAssinaturaApp({ app: criarApp(tmp()), esperado: "nao_assinado", ferramentas, entitlementsEsperados: doRepo });
    expect(r.ok).toBe(false);
  });

  it("entitlements divergentes do plist do repositório falham citando as chaves", () => {
    const r = verificarAssinaturaApp({ app: criarApp(tmp()), esperado: "assinado", ferramentas, entitlementsEsperados: ["com.apple.security.device.audio-input"] });
    expect(r.ok).toBe(false);
    expect(r.problemas.join(" ")).toContain("extras:");
    expect(r.problemas.join(" ")).toContain("disable-library-validation");
  });
});

describe("CLI verificar-assinatura", () => {
  it("assinado com dublês: exit 0 e relatório JSON em --saida sem segredo", () => {
    const app = criarApp(tmp());
    const saida = join(tmp(), "relatorio.json");
    const sentinela = "SENTINELA-Zx9-nao-pode-vazar";
    const r = cli("scripts/assinatura/verificar-assinatura.mjs", [`--app=${app}`, "--esperado=assinado", `--saida=${saida}`, ...argsDuples], { ...envEnt, CSC_KEY_PASSWORD: sentinela, APPLE_API_KEY: sentinela });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const json = readFileSync(saida, "utf8");
    expect(JSON.parse(json).ok).toBe(true);
    for (const t of [json, r.stdout, r.stderr]) expect(t).not.toContain(sentinela);
  });

  it("não assinado: --esperado=assinado falha (exit 1) e nao_assinado passa", () => {
    const app = appNaoAssinado();
    expect(cli("scripts/assinatura/verificar-assinatura.mjs", [`--app=${app}`, "--esperado=assinado", ...argsDuples], envEnt).status).toBe(1);
    const ok = cli("scripts/assinatura/verificar-assinatura.mjs", [`--app=${app}`, "--esperado=nao_assinado", ...argsDuples], envEnt);
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("sem assinatura real: R1");
  });

  it("valor de --esperado inválido sai com 2", () => {
    expect(cli("scripts/assinatura/verificar-assinatura.mjs", [`--app=${tmp()}`, "--esperado=talvez"]).status).toBe(2);
  });

  it("Windows: tabela de certificado do PE (estático) e signtool dublê [CI-Windows]", () => {
    const d = tmp();
    const assinado = pe(join(d, "ExpxV-Setup.exe"), { assinado: true });
    const solto = pe(join(d, "Solto.exe"));
    const signtool = `--signtool=${join(DUPLES, "signtool")}`;
    expect(cli("scripts/assinatura/verificar-assinatura.mjs", [`--exe=${assinado}`, "--esperado=assinado", signtool]).status).toBe(0);
    const f = cli("scripts/assinatura/verificar-assinatura.mjs", [`--exe=${solto}`, "--esperado=assinado"]);
    expect(f.status).toBe(1);
    expect(f.stderr).toContain("Solto.exe: sem assinatura Authenticode");
    expect(cli("scripts/assinatura/verificar-assinatura.mjs", [`--exe=${solto}`, "--esperado=nao_assinado"]).status).toBe(0);
  });
});

const appReal = join(RAIZ, "dist-app", "mac-universal", "ExpxV.app");
describe.skipIf(!existsSync(appReal) || process.platform !== "darwin")("pacote local real (somente leitura)", () => {
  it("é detectado como NÃO assinado: nao_assinado passa e assinado falha", () => {
    const ok = cli("scripts/assinatura/verificar-assinatura.mjs", [`--app=${appReal}`, "--esperado=nao_assinado"]);
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("sem assinatura real: R1");
    expect(cli("scripts/assinatura/verificar-assinatura.mjs", [`--app=${appReal}`, "--esperado=assinado"]).status).toBe(1);
  }, 60000);
});
