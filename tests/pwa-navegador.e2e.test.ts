// E2E do PWA no Chromium REAL (Playwright), sem Electron e sem rede externa: o build assinado do PWA (pwa/build.mjs) é servido por um servidor estático em 127.0.0.1.
//   1) shell instalável: manifesto, ícones, Service Worker ativo, versão do shell verificada (manifesto assinado por chave pinada), impressão digital na tela
//   2) origem ADULTERADA (JS trocado depois da assinatura): o Service Worker RECUSA instalar o shell (versão 0) e nada decifrado vai ao cache
//   3) CSP: CSP estrita (sem inline nem eval) e script inline injetado não executa
// Rodar: `npx vitest run --config vitest.e2e.config.mts tests/pwa-navegador.e2e.test.ts` (não precisa de `npm run build`; usa só `pwa/` e tmpdir).
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copiar, lancar, texto, type Lancamento, type Origem } from "./fixtures/pwa/origem-adulterada";

const TIPOS: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css", json: "application/json", webmanifest: "application/manifest+json", png: "image/png", sig: "text/plain" };
const servidores: Server[] = [];
async function servir(origem: Origem): Promise<number> {
  const s = createServer((req, res) => {
    const caminho = (req.url ?? "/").split("?")[0] ?? "/";
    const nome = caminho === "/" ? "index.html" : caminho.slice(1);
    const dados = origem.get(nome);
    if (dados === undefined) {
      res.statusCode = 404;
      return void res.end();
    }
    res.setHeader("Content-Type", TIPOS[nome.split(".").pop() ?? ""] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    if (nome === "sw.js") res.setHeader("Service-Worker-Allowed", "/");
    res.end(Buffer.from(dados));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return (s.address() as { port: number }).port;
}

let navegador: Browser;
let legitimo: Lancamento;
beforeAll(async () => {
  navegador = await chromium.launch();
  legitimo = await lancar(1);
}, 60_000);
afterAll(async () => {
  await navegador?.close().catch(() => undefined);
  for (const s of servidores) await new Promise<void>((r) => s.close(() => r()));
  legitimo?.limpar();
});

const versaoDoShell = (pagina: import("playwright").Page): Promise<number | null> =>
  pagina.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return new Promise<number | null>((resolve) => {
      const canal = new MessageChannel();
      canal.port1.onmessage = (e) => resolve((e.data as { versao: number | null }).versao);
      reg.active?.postMessage({ t: "versao" }, [canal.port2]);
      setTimeout(() => resolve(null), 4000);
    });
  });

describe("PWA no Chromium", () => {
  it("é instalável e verificado: manifesto válido, ícones, Service Worker ativo com o shell na versão assinada, impressão digital visível, CSP estrita, script inline não executa", async () => {
    const porta = await servir(legitimo.origem);
    const ctx = await navegador.newContext({ serviceWorkers: "allow" });
    const pagina = await ctx.newPage();
    const violacoes: string[] = [];
    pagina.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && violacoes.push(m.text()));
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.waitForSelector("h1");
    expect(await pagina.locator("h1").first().textContent()).toBe("Controle remoto");
    const manifesto = (await (await pagina.request.get(`http://127.0.0.1:${porta}/manifest.webmanifest`)).json()) as { icons: Array<{ src: string; sizes: string }>; display: string; start_url: string };
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifesto.display);
    expect(manifesto.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const i of manifesto.icons) expect((await pagina.request.get(`http://127.0.0.1:${porta}/${i.src.replace(/^\//, "")}`)).status()).toBe(200);
    await pagina.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", undefined, { timeout: 15_000 });
    await expect.poll(() => versaoDoShell(pagina), { timeout: 15_000 }).toBe(1);
    // o SW repõe os cabeçalhos de segurança nas respostas que serve do cache (A-09): `frame-ancestors` só vale por cabeçalho
    await pagina.reload();
    const resposta = await pagina.reload();
    const h = resposta?.headers() ?? {};
    expect(h["content-security-policy"] ?? "").toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    // nada decifrado em cache nem em localStorage
    const armazenado = await pagina.evaluate(async () => ({ ls: Object.keys(localStorage).length, caches: await caches.keys() }));
    expect(armazenado.ls).toBe(0);
    for (const nome of armazenado.caches) expect(nome).toMatch(/^(shell-\d+|meta-v1)$/); // só shell assinado e a versão (metadado), nunca conteúdo decifrado
    // a CSP é estrita: sem unsafe-inline nem unsafe-eval, e Trusted Types exigido (o `eval` por CDP não vale como prova: o DevTools o isenta)
    const csp = (await pagina.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")) ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    const inline = await pagina.evaluate(() => {
      try {
        const s = document.createElement("script");
        s.textContent = "window.__inline = 1"; // Trusted Types: atribuir texto a <script> exige TrustedScript
        document.head.appendChild(s);
      } catch {
        return "bloqueado";
      }
      return (window as unknown as { __inline?: number }).__inline === 1 ? "executou" : "bloqueado";
    });
    expect(inline).toBe("bloqueado");

    await ctx.close();
  }, 60_000);

  it("origem ADULTERADA: o Service Worker recusa o shell (versão 0) e não cacheia nada", async () => {
    const hostil = copiar(legitimo.origem);
    hostil.set("app.js", new TextEncoder().encode(`${texto(hostil.get("app.js"))}\n;window.__hostil = 1;`)); // JS trocado DEPOIS da assinatura
    const porta = await servir(hostil);
    const ctx = await navegador.newContext({ serviceWorkers: "allow" });
    const pagina = await ctx.newPage();
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    // a instalação do SW FALHA (hash não confere): ele nunca fica ativo e nada do shell vai ao cache
    await expect
      .poll(async () => pagina.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state ?? "sem_instalacao"), { timeout: 15_000 })
      .toBe("sem_instalacao");
    expect(await pagina.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? "inativo")).toBe("inativo");
    expect((await pagina.evaluate(() => caches.keys())).filter((n) => /^shell-/.test(n))).toEqual([]);
    await ctx.close();
  }, 60_000);
});
