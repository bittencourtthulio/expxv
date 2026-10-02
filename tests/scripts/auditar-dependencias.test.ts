// T-21.24 (D-23: sem rede; o `npm audit` entra por executor injetado, o teste nunca o executa).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARQUIVO_BASE, EXCECOES_LICENCA_DEV, auditar, auditarLicencas, auditarRegistro, executarAudit, falhas, gerarBase, gerarSbom, licencaPermitida, validarSbom,
  type Lock,
} from "../../scripts/lib/auditar-dependencias.mjs";

const RAIZ = join(__dirname, "..", "..");
const lockFixture = JSON.parse(readFileSync(join(RAIZ, "tests/fixtures/auditoria/package-lock.json"), "utf8")) as Lock;
const comLicenca = (l: string): Lock => ({ packages: { ...lockFixture.packages, "node_modules/ruim": { version: "9.9.9", license: l } } });

describe("licenças", () => {
  it("aceita a lista e expressões SPDX com alternativa permitida", () => {
    for (const l of ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "MPL-2.0", "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "Python-2.0", "CC-BY-4.0", "(MIT OR CC0-1.0)", "WTFPL OR ISC"]) expect(licencaPermitida(l), l).toBe(true);
    for (const l of ["GPL-3.0", "AGPL-3.0-only", "WTFPL", "(GPL-2.0 AND MIT)", "", "(MIT AND SSPL-1.0)"]) expect(licencaPermitida(l), l).toBe(false);
  });
  it("fixture limpa passa; licença fora da lista falha nomeando o pacote", () => {
    expect(auditarLicencas(lockFixture)).toEqual([]);
    const f = auditarLicencas(comLicenca("GPL-3.0"));
    expect(f.map((x) => x.pacote)).toEqual(["ruim"]);
    const raiz = mkdtempSync(join(tmpdir(), "aud-"));
    writeFileSync(join(raiz, "package-lock.json"), JSON.stringify(comLicenca("GPL-3.0")));
    writeFileSync(join(raiz, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    expect(falhas(auditar(raiz)).join("\n")).toContain("ruim@9.9.9 (GPL-3.0)");
  });
  it("licença ausente conta como fora da lista", () => {
    const l: Lock = { packages: { "node_modules/x": { version: "1.0.0" } } };
    expect(auditarLicencas(l)[0]?.licenca).toBe("(ausente)");
  });
});

describe("registro de dependências", () => {
  const pkg = { dependencies: { a: "1" }, devDependencies: { b: "2" } };
  it("base gerada do package.json cobre tudo", () => {
    expect(auditarRegistro(pkg, gerarBase(pkg), "")).toEqual([]);
  });
  it("dependência nova fora da base falha, a menos que 01-DECISOES cite o nome", () => {
    const base = { versao: 1, dependencias: ["a"] };
    expect(auditarRegistro(pkg, base, "").map((x) => x.pacote)).toEqual(["b"]);
    expect(auditarRegistro(pkg, base, "D-999 adota `b` por motivo X")).toEqual([]);
  });
  it("a base real cobre o package.json real", () => {
    const base = JSON.parse(readFileSync(join(RAIZ, ARQUIVO_BASE), "utf8"));
    const real = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
    expect(auditarRegistro(real, base, "")).toEqual([]);
  });
});

describe("SBOM CycloneDX 1.5", () => {
  it("é JSON, tem componentes == pacotes do lock e é determinístico", () => {
    const s = gerarSbom(lockFixture);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.specVersion).toBe("1.5");
    expect(s.components).toHaveLength(3);
    expect(validarSbom(s, lockFixture)).toEqual([]);
    expect(gerarSbom(lockFixture)).toEqual(s);
    const b = s.components.find((c) => c.name === "@s/b");
    expect(b?.purl).toBe("pkg:npm/%40s/b@2.0.0");
    expect(s.components.find((c) => c.name === "c")?.version).toBe("0.1.0");
    expect((s.components.find((c) => c.name === "a")?.hashes as { alg: string }[])[0]?.alg).toBe("SHA-512");
  });
  it("detecta componente faltando e formato errado", () => {
    const s = gerarSbom(lockFixture);
    expect(validarSbom({ ...s, components: s.components.slice(1) }, lockFixture).join()).toContain("diferem");
    expect(validarSbom({ ...s, specVersion: "1.4" }, lockFixture).join()).toContain("1.5");
  });
});

describe("npm audit informativo", () => {
  it("sem rede ou erro => não executado, nunca ok", () => {
    expect(executarAudit(() => ({ erro: "ENOTFOUND" })).estado).toBe("não executado");
    expect(executarAudit(() => { throw new Error("sem npm"); }).estado).toBe("não executado");
    expect(executarAudit(() => ({ saida: "" })).estado).toBe("não executado");
    expect(executarAudit(() => ({ saida: JSON.stringify({ error: { summary: "getaddrinfo ENOTFOUND" } }) })).estado).toBe("não executado");
  });
  it("resposta real: ok só com zero; vulnerabilidades não reprovam a auditoria", () => {
    const v = (n: number) => JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: n, moderate: 0, high: 0, critical: 0 } } });
    expect(executarAudit(() => ({ saida: v(0) })).estado).toBe("ok");
    const r = executarAudit(() => ({ saida: v(2) }));
    expect(r).toMatchObject({ estado: "vulnerabilidades", total: 2 });
    const raiz = mkdtempSync(join(tmpdir(), "aud-"));
    mkdirSync(join(raiz, "scripts/lib"), { recursive: true });
    writeFileSync(join(raiz, "package-lock.json"), JSON.stringify(lockFixture));
    writeFileSync(join(raiz, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    const res = auditar(raiz, { executorAudit: () => ({ saida: v(2) }) });
    expect(res.audit.estado).toBe("vulnerabilidades");
    expect(falhas(res)).toEqual([]);
  });
});

describe("lock real", () => {
  it("SBOM válido e sem dependência sem registro; licença fora da lista é achado conhecido", () => {
    const r = auditar(RAIZ);
    expect(r.errosSbom).toEqual([]);
    expect(r.semRegistro).toEqual([]);
    expect(r.audit.estado).toBe("não executado");
    // WTFPL puro só em dependência de BUILD (truncate-utf8-bytes, via electron-builder): exceção explícita e nominal (D-380). Qualquer outro pacote fora da lista reprova aqui.
    expect(r.licencasForaDaLista).toEqual([]);
    expect(EXCECOES_LICENCA_DEV["truncate-utf8-bytes@1.0.2"]).toMatch(/WTFPL/);
  });
});

describe("exceção de licença só para dependência de desenvolvimento (D-380)", () => {
  it("a mesma licença em dependência de PRODUÇÃO continua sendo achado", () => {
    const lock: Lock = { packages: { "node_modules/truncate-utf8-bytes": { version: "1.0.2", license: "WTFPL" } } };
    expect(auditarLicencas(lock).map((x) => x.pacote)).toEqual(["truncate-utf8-bytes"]);
    const dev: Lock = { packages: { "node_modules/truncate-utf8-bytes": { version: "1.0.2", license: "WTFPL", dev: true } } };
    expect(auditarLicencas(dev)).toEqual([]);
    const outraVersao: Lock = { packages: { "node_modules/truncate-utf8-bytes": { version: "2.0.0", license: "WTFPL", dev: true } } };
    expect(auditarLicencas(outraVersao)).toHaveLength(1);
  });
});
