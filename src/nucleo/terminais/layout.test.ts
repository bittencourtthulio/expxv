import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LayoutTerminais, NoLayout } from "../../compartilhado/terminais";
import { criarArmazemLayout, restaurarLayout, validarLayout } from "./layout";

const T = (sessao_id: string): NoLayout => ({ tipo: "terminal", sessao_id });
const D = (primeiro: NoLayout, segundo: NoLayout, orientacao: "horizontal" | "vertical" = "horizontal"): NoLayout => ({ tipo: "divisao", orientacao, primeiro, segundo });
const bom: LayoutTerminais = { versao: 2, fixadas: [], ativa: "sessao_b", abas: [{ arvore: D(T("sessao_a"), T("sessao_b")) }, { arvore: T("sessao_c") }] };

describe("validarLayout", () => {
  it("aceita árvore com divisões e devolve o mesmo layout", () => {
    const r = validarLayout(bom);
    expect(r.ok && r.layout).toEqual(bom);
  });
  it("recusa versão, id, orientação, profundidade e nós inválidos", () => {
    const fundo = (n: number): unknown => (n === 0 ? T("s") : { tipo: "divisao", orientacao: "vertical", primeiro: fundo(n - 1), segundo: T("x") });
    const ruins: unknown[] = [
      null, "x", { ...bom, versao: 3 }, { ...bom, abas: "x" },
      { versao: 1, ativa: null, abas: [{ arvore: T("../etc/passwd") }] },
      { versao: 1, ativa: null, abas: [{ arvore: T("a".repeat(81)) }] },
      { versao: 1, ativa: null, abas: [{ arvore: { tipo: "divisao", orientacao: "diagonal", primeiro: T("a"), segundo: T("b") } }] },
      { versao: 1, ativa: null, abas: [{ arvore: fundo(20) }] },
      { versao: 1, ativa: null, abas: Array.from({ length: 65 }, (_, i) => ({ arvore: T(`s${i}`) })) },
      { versao: 1, ativa: 5, abas: [] },
    ];
    for (const ruim of ruins) expect(validarLayout(ruim).ok).toBe(false);
  });
  it("profundidade 16 passa e 17 não; 64 nós passam", () => {
    const fundo = (n: number): NoLayout => (n === 0 ? T("s") : D(fundo(n - 1), T("x")));
    expect(validarLayout({ versao: 2, ativa: null, fixadas: [], abas: [{ arvore: fundo(16) }] }).ok).toBe(true);
    expect(validarLayout({ versao: 2, ativa: null, fixadas: [], abas: [{ arvore: fundo(17) }] }).ok).toBe(false);
    expect(validarLayout({ versao: 2, ativa: null, fixadas: [], abas: Array.from({ length: 64 }, (_, i) => ({ arvore: T(`s${i}`) })) }).ok).toBe(true);
  });
  it("campos desconhecidos são descartados (reconstrói campo a campo)", () => {
    const r = validarLayout({ ...bom, intruso: 1, abas: [{ arvore: { ...T("sessao_a"), extra: "x" }, lixo: true }] });
    expect(r.ok && r.layout).toEqual({ versao: 2, fixadas: [], ativa: "sessao_b", abas: [{ arvore: T("sessao_a") }] });
  });
  it("v2 com fixadas passa; v1 antigo vira v2 com fixadas vazias; ids fora das árvores são descartados", () => {
    const v2 = validarLayout({ ...bom, fixadas: ["sessao_a", "sessao_c"] });
    expect(v2.ok && v2.layout.fixadas).toEqual(["sessao_a", "sessao_c"]);
    const { fixadas: _f, ...semFixadas } = bom;
    const v1 = validarLayout({ ...semFixadas, versao: 1 });
    expect(v1.ok && v1.layout).toEqual({ ...bom, fixadas: [] });
    const r = validarLayout({ ...bom, fixadas: ["sessao_zz", "sessao_c"] });
    expect(r.ok && r.layout.fixadas).toEqual(["sessao_c"]);
    expect(validarLayout({ ...bom, fixadas: ["../x"] }).ok).toBe(false);
  });
});

describe("criarArmazemLayout (um arquivo por workspace)", () => {
  it("grava e lê por workspace em layout/<sha1[0:16]>.json; workspaces diferentes não se misturam", () => {
    const dir = mkdtempSync(join(tmpdir(), "layout-"));
    const a = criarArmazemLayout(dir, "ws_a");
    const b = criarArmazemLayout(dir, "ws_b");
    expect(a.ler()).toBeNull();
    a.gravar(bom);
    expect(a.ler()).toEqual(bom);
    expect(b.ler()).toBeNull();
    const nome = `${createHash("sha1").update("ws_a").digest("hex").slice(0, 16)}.json`;
    expect(readdirSync(join(dir, "layout"))).toEqual([nome]);
  });
  it("workspace nulo usa a chave 'padrao'", () => {
    const dir = mkdtempSync(join(tmpdir(), "layout-"));
    criarArmazemLayout(dir, null).gravar(bom);
    expect(existsSync(join(dir, "layout", `${createHash("sha1").update("padrao").digest("hex").slice(0, 16)}.json`))).toBe(true);
  });
  it("escrita atômica sem temporário sobrando; corrompido, adulterado ou grande vira null; gravar recusa inválido sem tocar o arquivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "layout-"));
    const a = criarArmazemLayout(dir, "ws_a");
    a.gravar(bom);
    a.gravar({ ...bom, ativa: "sessao_a" });
    const pasta = join(dir, "layout");
    expect(readdirSync(pasta).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const arquivo = join(pasta, readdirSync(pasta)[0]!);
    writeFileSync(arquivo, "{nao é json");
    expect(a.ler()).toBeNull();
    writeFileSync(arquivo, JSON.stringify({ versao: 1, ativa: null, abas: [{ arvore: T("../x") }] }));
    expect(a.ler()).toBeNull();
    writeFileSync(arquivo, JSON.stringify({ ...bom, lixo: "x".repeat(70 * 1024) }));
    expect(a.ler()).toBeNull();
    writeFileSync(arquivo, "original");
    expect(() => a.gravar({ versao: 9 } as never)).toThrow();
    expect(readFileSync(arquivo, "utf8")).toBe("original");
  });
  it("lê v1 e devolve v2", () => {
    const dir = mkdtempSync(join(tmpdir(), "layout-"));
    const a = criarArmazemLayout(dir, "ws_a");
    a.gravar(bom);
    const arquivo = join(dir, "layout", readdirSync(join(dir, "layout"))[0]!);
    writeFileSync(arquivo, JSON.stringify({ versao: 1, ativa: "sessao_c", abas: [{ arvore: T("sessao_c") }] }));
    expect(a.ler()).toEqual({ versao: 2, ativa: "sessao_c", abas: [{ arvore: T("sessao_c") }], fixadas: [] });
  });
});

describe("restaurarLayout (tolerante)", () => {
  it("sessão que não voltou sai da árvore e a divisão colapsa no irmão", () => {
    const r = restaurarLayout(bom, new Set(["sessao_a", "sessao_c"]));
    expect(r.abas).toEqual([{ arvore: T("sessao_a") }, { arvore: T("sessao_c") }]);
    expect(r.ativa).toBe("sessao_a"); // a ativa sumiu: cai na primeira viva
  });
  it("colapso em cadeia, aba vazia removida e fixadas filtradas", () => {
    const l: LayoutTerminais = { versao: 2, ativa: "s3", fixadas: ["s1", "s9"], abas: [{ arvore: D(D(T("s1"), T("s2")), T("s3"), "vertical") }, { arvore: T("s9") }] };
    const r = restaurarLayout(l, ["s3"]);
    expect(r.abas).toEqual([{ arvore: T("s3") }]);
    expect(r.ativa).toBe("s3");
    expect(r.fixadas).toEqual([]);
    const r2 = restaurarLayout(l, ["s1", "s3"]);
    expect(r2.abas[0]!.arvore).toEqual({ tipo: "divisao", orientacao: "vertical", primeiro: T("s1"), segundo: T("s3") });
    expect(r2.fixadas).toEqual(["s1"]);
  });
  it("nada vivo vira layout vazio; tudo vivo não muda; não altera a entrada", () => {
    const copia = JSON.parse(JSON.stringify(bom)) as LayoutTerminais;
    expect(restaurarLayout(bom, [])).toEqual({ versao: 2, ativa: null, abas: [], fixadas: [] });
    expect(restaurarLayout(bom, ["sessao_a", "sessao_b", "sessao_c"])).toEqual(bom);
    expect(bom).toEqual(copia);
  });
});
