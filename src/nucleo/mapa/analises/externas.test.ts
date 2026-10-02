import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analisarExternas, analisarLicenca, normalizarIdSpdx, type LeitorProjeto } from "./externas";

function leitor(arquivos: Record<string, string>): LeitorProjeto {
  return {
    ler: (c) => arquivos[c] ?? null,
    listar: (pasta) => {
      const p = `${pasta}/`;
      return [...new Set(Object.keys(arquivos).filter((k) => k.startsWith(p)).map((k) => k.slice(p.length).split("/")[0] as string))];
    },
  };
}

describe("SPDX", () => {
  it.each([
    ["MIT", "MIT", null],
    ["The MIT License", "MIT", null],
    ["Apache License 2.0", "Apache-2.0", null],
    ["MIT OR Apache-2.0", "MIT OR Apache-2.0", null],
    ["(MIT AND CC0-1.0)", "MIT AND CC0-1.0", null],
    ["GPL-3.0-only", "GPL-3.0-only", "copyleft_forte"],
    ["GPLv3", "GPL-3.0-or-later", "copyleft_forte"],
    ["AGPL-3.0-or-later", "AGPL-3.0-or-later", "copyleft_forte"],
    ["LGPL-2.1-only", "LGPL-2.1-only", "copyleft_fraco"],
    ["MPL-2.0", "MPL-2.0", "copyleft_fraco"],
    ["EPL-2.0", "EPL-2.0", "copyleft_fraco"],
    ["MIT OR GPL-3.0-only", "MIT OR GPL-3.0-only", null], // o licenciado escolhe a alternativa branda
    ["MIT AND GPL-3.0-only", "MIT AND GPL-3.0-only", "copyleft_forte"],
    ["GPL-2.0-only WITH Classpath-exception-2.0", "GPL-2.0-only WITH Classpath-exception-2.0", "copyleft_fraco"],
    ["(LGPL-3.0 OR GPL-3.0-only) AND MIT", "(LGPL-3.0-or-later OR GPL-3.0-only) AND MIT", "copyleft_fraco"],
    ["", "desconhecida", null],
    ["SEE LICENSE IN LICENSE.txt", "desconhecida", null],
  ])("%s", (entrada, licenca, selo) => {
    const r = analisarLicenca(entrada);
    expect(r.licenca).toBe(licenca);
    expect(r.selo).toBe(selo);
  });
  it("normaliza identificadores", () => {
    expect(normalizarIdSpdx("BSD")).toBe("BSD-3-Clause");
    expect(normalizarIdSpdx("Foo-1.0")).toBe("Foo-1.0");
  });
});

describe("analisarExternas", () => {
  const arquivos = {
    "node_modules/express/package.json": JSON.stringify({ name: "express", version: "4.19.2", license: "MIT" }),
    "node_modules/gplzinha/package.json": JSON.stringify({ name: "gplzinha", version: "1.0.0", license: "GPL-3.0-only" }),
    "node_modules/dupla/package.json": JSON.stringify({ name: "dupla", version: "2.0.0", license: "MIT OR Apache-2.0" }),
    "node_modules/antiga/package.json": JSON.stringify({ name: "antiga", licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }),
    "vendor/composer/installed.json": JSON.stringify({ packages: [{ name: "Laravel/Framework", version: "v10.1.0", license: ["MIT"] }, { name: "acme/lgpl", version: "1.0", license: ["LGPL-3.0-or-later"] }] }),
    ".venv/lib/python3.12/site-packages/requests-2.31.0.dist-info/METADATA": "Metadata-Version: 2.1\nName: requests\nVersion: 2.31.0\nLicense: Apache 2.0\n\nCorpo longo da descrição",
    ".venv/lib/python3.12/site-packages/Django-4.2.dist-info/METADATA": "Name: Django\nVersion: 4.2\nClassifier: License :: OSI Approved :: BSD License\n\n",
  };
  const declaradas = [
    { eco: "npm" as const, nome: "express", versao_declarada: "^4.0.0", dev: false, arquivo: "package.json", linha: 10 },
    { eco: "npm" as const, nome: "gplzinha", versao_declarada: "*", dev: false, arquivo: "package.json", linha: 11 },
    { eco: "npm" as const, nome: "dupla", dev: true, arquivo: "package.json", linha: 14 },
    { eco: "npm" as const, nome: "antiga", dev: false, arquivo: "package.json", linha: 15 },
    { eco: "npm" as const, nome: "nao-instalada", versao_declarada: "1.0.0", dev: false, arquivo: "package.json", linha: 16 },
    { eco: "npm" as const, nome: "sobrando", versao_declarada: "1.0.0", dev: false, arquivo: "package.json", linha: 17 },
    { eco: "composer" as const, nome: "laravel/framework", dev: false, arquivo: "composer.json", linha: 5 },
    { eco: "composer" as const, nome: "acme/lgpl", dev: false, arquivo: "composer.json", linha: 6 },
    { eco: "pip" as const, nome: "requests", dev: false, arquivo: "requirements.txt", linha: 1 },
    { eco: "pip" as const, nome: "django", dev: false, arquivo: "requirements.txt", linha: 2 },
  ];
  const usados = ["ext:npm:express", "ext:npm:gplzinha", "ext:npm:dupla", "ext:npm:antiga", "ext:npm:nao-instalada", "ext:npm:fantasma", "ext:composer:laravel/framework", "ext:composer:acme/lgpl", "ext:pip:requests", "ext:pip:django", "ext:stdlib:os", "ext:builtin:fs"];
  const r = analisarExternas({ declaradas, usados, leitor: leitor(arquivos), locks: new Map([["npm:nao-instalada", "1.0.5"]]), pastasSitePackages: [".venv/lib/python3.12/site-packages"] });
  const por = (id: string) => r.externas.find((e) => e.id === id)!;

  it("declarada × usada, nos dois sentidos, sem contar stdlib/builtin", () => {
    expect(r.declaradas_nao_usadas).toEqual(["ext:npm:sobrando"]);
    expect(r.usadas_nao_declaradas).toEqual(["ext:npm:fantasma"]);
  });
  it("versão exata: do lock; senão do node_modules; senão a declarada", () => {
    expect(por("ext:npm:nao-instalada")).toMatchObject({ versao: "1.0.5", versao_fonte: "lock" });
    expect(por("ext:npm:express")).toMatchObject({ versao: "4.19.2", versao_fonte: "lock" });
    expect(por("ext:npm:sobrando")).toMatchObject({ versao: "1.0.0", versao_fonte: "declarada" });
    expect(por("ext:npm:dupla")).toMatchObject({ dev: true, declarada_em: "package.json:14" });
  });
  it("licenças lidas localmente de npm, composer e pip, incluindo composta e selos", () => {
    expect(por("ext:npm:express")).toMatchObject({ licenca: "MIT", selo: null, licenca_fonte: "node_modules/express/package.json" });
    expect(por("ext:npm:dupla").licenca).toBe("MIT OR Apache-2.0");
    expect(por("ext:npm:antiga").licenca).toBe("MIT OR Apache-2.0");
    expect(por("ext:npm:gplzinha")).toMatchObject({ licenca: "GPL-3.0-only", selo: "copyleft_forte" });
    expect(por("ext:composer:laravel/framework")).toMatchObject({ licenca: "MIT", versao: "10.1.0" });
    expect(por("ext:composer:acme/lgpl").selo).toBe("copyleft_fraco");
    expect(por("ext:pip:requests").licenca).toBe("Apache-2.0");
    expect(por("ext:pip:django").licenca).toBe("BSD-3-Clause");
    expect(r.copyleft).toEqual({ forte: 1, fraco: 1, desconhecida: 3 });
    expect(r.aviso).toMatch(/não são parecer jurídico/);
  });
  it("pasta de dependências ausente não gera erro: licença desconhecida", () => {
    const x = analisarExternas({ declaradas: declaradas.slice(0, 1), usados: ["ext:npm:express"], leitor: leitor({}) });
    expect(x.externas[0]).toMatchObject({ licenca: "desconhecida", licenca_fonte: null });
    expect(() => analisarExternas({ declaradas, usados })).not.toThrow();
  });
  it("zero acesso à rede (net/http/https espiados)", () => {
    const req = createRequire(__filename);
    const net = req("node:net") as typeof import("node:net");
    const http = req("node:http") as typeof import("node:http");
    const https = req("node:https") as typeof import("node:https");
    const espioes = [vi.spyOn(net, "connect"), vi.spyOn(net.Socket.prototype, "connect"), vi.spyOn(http, "request"), vi.spyOn(https, "request"), vi.spyOn(http, "get")];
    analisarExternas({ declaradas, usados, leitor: leitor(arquivos), pastasSitePackages: [".venv/lib/python3.12/site-packages"] });
    for (const e of espioes) expect(e).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // e o módulo nem importa nada de rede
    expect(readFileSync(join(__dirname, "externas.ts"), "utf8")).not.toMatch(/from "node:(net|http|https|dns|tls)"/);
  });
});
