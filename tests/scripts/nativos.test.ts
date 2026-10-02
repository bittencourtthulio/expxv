// T-21.11 · verificar-nativos: todo Mach-O e PE do pacote (inclui app.asar.unpacked) com assinatura e arquitetura (AU-21).
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listarBinarios, tipoBinario, verificarNativos } from "../../scripts/lib/assinatura.mjs";
import { DUPLES, RAIZ, cli, criarApp, escrever, macho, pe, tmp } from "./instaladores-ajuda";

const ferramentas = { codesign: join(DUPLES, "codesign"), lipo: join(DUPLES, "lipo") };
const argsDuples = [`--codesign=${ferramentas.codesign}`, `--lipo=${ferramentas.lipo}`];
const soltoRel = "Contents/Resources/app.asar.unpacked/node_modules/sqlite-vec/vec0.dylib";

function appComSolto(assinadoSolto: boolean): { app: string; raiz: string } {
  const raiz = tmp();
  const app = criarApp(raiz);
  macho(join(app, soltoRel), "arm64 x86_64", assinadoSolto);
  return { app, raiz };
}

describe("detecção de binários por magic", () => {
  it("reconhece Mach-O e PE; ignora texto, classe Java e symlink", () => {
    const d = tmp();
    macho(join(d, "m"), "arm64");
    pe(join(d, "p.dll"));
    escrever(join(d, "t.txt"), "texto comum");
    escrever(join(d, "J.class"), Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 1, 2, 3]));
    symlinkSync(join(d, "m"), join(d, "elo"));
    expect(tipoBinario(join(d, "m"))).toBe("macho");
    expect(tipoBinario(join(d, "p.dll"))).toBe("pe");
    expect(tipoBinario(join(d, "t.txt"))).toBeNull();
    expect(tipoBinario(join(d, "J.class"))).toBeNull();
    expect(listarBinarios(d).map((b: { relativo: string }) => b.relativo)).toEqual(["m", "p.dll"]);
  });
});

describe("verificarNativos (dublês)", () => {
  it("pacote todo assinado passa em --esperado=assinado e enxerga app.asar.unpacked", () => {
    const { app } = appComSolto(true);
    const r = verificarNativos({ raiz: app, esperado: "assinado", ferramentas });
    expect(r.problemas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.binarios.map((b: { caminho: string }) => b.caminho)).toContain(soltoRel);
    expect(r.binarios.some((b: { caminho: string }) => b.caminho.includes("node-pty/prebuilds/darwin-arm64/pty.node"))).toBe(true);
  });

  it("AU-21: binário solto não assinado é apontado pelo caminho", () => {
    const { app } = appComSolto(false);
    const r = verificarNativos({ raiz: app, esperado: "assinado", ferramentas });
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain(soltoRel);
  });

  it("nao_assinado falha quando algum binário está assinado (mistura)", () => {
    const { app } = appComSolto(false);
    const r = verificarNativos({ raiz: app, esperado: "nao_assinado", ferramentas });
    expect(r.ok).toBe(false);
    expect(r.problemas.every((p: string) => p.includes("está assinado"))).toBe(true);
  });

  it("pacote sem nenhuma assinatura: nao_assinado passa com a nota R1", () => {
    const raiz = tmp();
    macho(join(raiz, "a"), "arm64", false);
    macho(join(raiz, "b"), "x86_64", false);
    const r = verificarNativos({ raiz, esperado: "nao_assinado", ferramentas });
    expect(r.ok).toBe(true);
    expect(r.nota).toBe("sem assinatura real: R1");
    expect(verificarNativos({ raiz, esperado: "assinado", ferramentas }).problemas.map((p: string) => p.split(":")[0])).toEqual(["a", "b"]);
  });

  it("PE entra na varredura (certificado presente = assinado) e arquitetura ilegível é apontada", () => {
    const raiz = tmp();
    pe(join(raiz, "resources", "pty.node"), { assinado: true });
    pe(join(raiz, "Solto.dll"));
    escrever(join(raiz, "sem-arch"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00]));
    const r = verificarNativos({ raiz, esperado: "assinado", ferramentas });
    expect(r.problemas.join("\n")).toContain("Solto.dll: sem assinatura real");
    expect(r.problemas.join("\n")).toContain("sem-arch: arquitetura ilegível");
    expect(r.problemas.join("\n")).not.toContain("pty.node");
  });

  it("pasta sem binário falha (nunca passa vazio)", () => {
    expect(verificarNativos({ raiz: tmp(), esperado: "nao_assinado", ferramentas }).ok).toBe(false);
  });
});

describe("CLI verificar-nativos", () => {
  it("lista o caminho no stderr, sai 1 e grava relatório JSON sem segredo", () => {
    const { app } = appComSolto(false);
    const saida = join(tmp(), "nativos.json");
    const sentinela = "SENTINELA-nativos-12345";
    const r = cli("scripts/assinatura/verificar-nativos.mjs", [`--pacote=${app}`, "--esperado=assinado", `--saida=${saida}`, ...argsDuples], { CSC_LINK: sentinela });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(soltoRel);
    const json = readFileSync(saida, "utf8");
    expect(JSON.parse(json).problemas[0]).toContain(soltoRel);
    for (const t of [json, r.stdout, r.stderr]) expect(t).not.toContain(sentinela);
  });

  it("assinado completo passa (exit 0)", () => {
    const { app } = appComSolto(true);
    const r = cli("scripts/assinatura/verificar-nativos.mjs", [`--pacote=${app}`, "--esperado=assinado", ...argsDuples]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

const appReal = join(RAIZ, "dist-app", "mac-universal", "ExpxV.app");
describe.skipIf(!existsSync(appReal) || process.platform !== "darwin")("pacote local real (somente leitura)", () => {
  it("é detectado como não assinado: nao_assinado passa (R1) e assinado falha listando binários", () => {
    const ok = cli("scripts/assinatura/verificar-nativos.mjs", [`--pacote=${appReal}`, "--esperado=nao_assinado"]);
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("sem assinatura real: R1");
    const f = cli("scripts/assinatura/verificar-nativos.mjs", [`--pacote=${appReal}`, "--esperado=assinado"]);
    expect(f.status).toBe(1);
    expect(f.stderr).toContain("node-pty");
  }, 60000);
});
