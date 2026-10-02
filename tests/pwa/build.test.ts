// T-22.13: build do PWA, CSP, SRI, manifesto instalável, peso (P-164) e independência do app Electron.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { lancar, texto, type Lancamento } from "../fixtures/pwa/origem-adulterada";
import { carregar, RAIZ, type Build } from "./carregar";

const lancamentos: Lancamento[] = [];
afterAll(() => lancamentos.forEach((l) => l.limpar()));

describe("build do PWA (T-22.13)", async () => {
  const build = await carregar<Build>("pwa/build.mjs");
  const l = await lancar(4);
  lancamentos.push(l);
  const html = texto(l.origem.get("index.html"));

  it("gera o shell instalável: HTML, JS, CSS, manifesto, ícones PNG válidos, SW e cabeçalhos", () => {
    expect([...l.origem.keys()].sort()).toEqual(["app.css", "app.js", "cabecalhos.txt", "icones/icone-192.png", "icones/icone-512.png", "index.html", "manifest.webmanifest", "manifesto-pwa.json", "manifesto-pwa.sig", "sw.js"]);
    const man = JSON.parse(texto(l.origem.get("manifest.webmanifest"))) as { name: string; start_url: string; display: string; icons: Array<{ src: string; sizes: string; type: string }> };
    expect(man.display).toBe("standalone");
    expect(man.start_url).toBe("./");
    expect(man.name).toContain(build.produtoDe().nome); // o nome vem de produto.ts, não de literal do PWA
    for (const ic of man.icons) {
      const png = l.origem.get(ic.src) as Uint8Array;
      expect(Buffer.from(png.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
      const w = Buffer.from(png).readUInt32BE(16);
      expect(`${w}x${w}`).toBe(ic.sizes);
      expect(gunzipSync(gzipSync(Buffer.from(png))).length).toBe(png.length);
    }
    expect(html).toMatch(/<link rel="manifest" href="manifest\.webmanifest">/);
  });
  it("CSP estrita no <meta> e nos cabeçalhos: sem unsafe-inline/unsafe-eval, Trusted Types, frame-ancestors none", () => {
    const csp = build.csp();
    for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "require-trusted-types-for 'script'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|data:|blob:/);
    expect(html).toContain(`content="${csp}"`);
    expect(texto(l.origem.get("cabecalhos.txt"))).toContain(`Content-Security-Policy: ${csp}`);
    expect(build.csp({ connect: "wss://relay.exemplo.com" })).toContain("connect-src 'self' wss://relay.exemplo.com");
  });
  it("HTML mínimo: um script e um CSS, ambos com SRI correto; sem script inline, sem handler inline, sem innerHTML", () => {
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script>[^<]|\son[a-z]+=|javascript:|<style/);
    for (const [arq, attr] of [["app.js", "script"], ["app.css", "link"]] as const) {
      const sri = `sha384-${createHash("sha384").update(l.origem.get(arq) as Uint8Array).digest("base64")}`;
      expect(html).toContain(`integrity="${sri}"`);
      expect(html).toContain(attr === "script" ? `src="${arq}"` : `href="${arq}"`);
    }
    const js = texto(l.origem.get("app.js"));
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage/);
  });
  it("P-164: JS <= 60 KB gz, HTML <= 4 KB, CSS <= 12 KB gz (e o script de medição falha ao estourar)", async () => {
    const gz = (n: string): number => gzipSync(Buffer.from(l.origem.get(n) as Uint8Array), { level: 9 }).length;
    expect(gz("app.js") + gz("sw.js")).toBeLessThan(60 * 1024);
    expect(l.origem.get("index.html")?.length).toBeLessThan(4 * 1024);
    expect(gz("app.css")).toBeLessThan(12 * 1024);
    const t = await carregar<{ medir(d: string): { ok: boolean; estouros: string[]; js_gz: number } }>("pwa/tamanho.mjs");
    const ok = t.medir(l.dir);
    expect(ok.ok).toBe(true);
  });
  it("build é determinístico e recusa destino perigoso e versão inválida", () => {
    expect(() => build.construir({ destino: RAIZ })).toThrow();
    expect(() => build.construir({ destino: join(RAIZ, "pwa", "..") })).toThrow();
    expect(() => build.construir({ destino: join(l.dir, "..", "x"), versao: 0 })).toThrow();
    expect(() => build.construir({ destino: "" })).toThrow();
  });
  it("o app Electron NÃO importa nada de pwa/ nem de dist-pwa (builds independentes)", () => {
    const fontes = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const c = join(dir, n);
        return statSync(c).isDirectory() ? fontes(c) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [c] : [];
      });
    for (const f of fontes(join(RAIZ, "src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/from "[^"]*\/pwa\/|dist-pwa/);
    expect(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")).not.toMatch(/dist-pwa|pwa\//); // fora do pacote: o `files` só leva dist/**
    expect(readFileSync(join(RAIZ, ".gitignore"), "utf8")).toContain("dist-pwa/");
  });
  it("sw.js do build tem as chaves PINADAS (só públicas) e a versão; a tela mostra os hashes para comparação (R-F)", () => {
    const sw = texto(l.origem.get("sw.js"));
    expect(sw).toContain(`const CHAVES = ["${l.publicaB64}"]`);
    expect(sw).toContain("const VERSAO_SW = 4;");
    const app = texto(l.origem.get("app.js"));
    expect(app).toContain("hash-sw");
    expect(app).toContain("Impressão digital do cliente");
  });
});
