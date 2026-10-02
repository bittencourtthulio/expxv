// Service Worker do PWA (T-22.13/T-22.16). O build concatena `verificar.js` ANTES deste arquivo e troca `__CHAVES__` (chaves públicas Ed25519 PINADAS: atual e próxima) e `__SW_VERSAO__`.
// Garantias: (1) o shell só é instalado se o manifesto estiver ASSINADO por uma chave pinada e CADA arquivo bater por tamanho e SHA-256; (2) atualização só com `versao` maior;
// (3) qualquer falha derruba a instalação e o shell ANTERIOR continua servindo; (4) arquivo fora do manifesto não é servido; (5) NUNCA se guarda conteúdo decifrado (só o shell).
// Residual declarado (R-F): uma origem que troque ESTE script depois da primeira instalação troca também as chaves pinadas; por isso a tela mostra o hash deste script.
const CHAVES = __CHAVES__;
const VERSAO_SW = __SW_VERSAO__;
// Cabeçalhos de segurança que a origem estática enviaria: o SW serve o shell do cache e as respostas dele NÃO herdam cabeçalho nenhum, então os repõe (A-09). `frame-ancestors` só vale por cabeçalho.
const CABECALHOS_SEG = { "Content-Security-Policy": __CSP__, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin", "Permissions-Policy": "camera=(self), microphone=(), geolocation=()" };
const META = "meta-v1";
const TIPOS = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json", png: "image/png" };
const tipoDe = (n) => TIPOS[n.split(".").pop()] ?? "application/octet-stream";
const base = () => self.registration.scope;

async function lerMeta(chave) {
  try {
    const r = await (await caches.open(META)).match(chave);
    return r ? (await r.json()).v | 0 : 0;
  } catch {
    return 0;
  }
}
async function gravarMeta(chave, v) {
  await (await caches.open(META)).put(chave, new Response(JSON.stringify({ v })));
}
async function buscar(caminho) {
  try {
    const r = await fetch(new URL(caminho, base()).href, { cache: "no-store", redirect: "error", credentials: "omit" });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
async function instalar() {
  // piso: este SW foi construído para a versão VERSAO_SW; se o armazenamento do navegador for limpo, um manifesto assinado MAIS ANTIGO ainda não volta (A-12)
  const r = await baixarEVerificarShell({ buscar, chaves: CHAVES, versaoInstalada: Math.max(await lerMeta("versao"), VERSAO_SW - 1) });
  if (!r.ok) throw new Error("shell_recusado"); // a instalação falha: o shell anterior (se houver) continua valendo
  const nome = `shell-${r.versao}`;
  await caches.delete(nome);
  const c = await caches.open(nome);
  for (const [arq, bytes] of r.arquivos) await c.put(new URL(arq, base()).href, new Response(bytes, { headers: { "Content-Type": tipoDe(arq), "Cache-Control": "no-store", ...CABECALHOS_SEG } }));
  await gravarMeta("pendente", r.versao);
}
async function ativar() {
  const v = await lerMeta("pendente");
  if (v > 0) await gravarMeta("versao", v);
  const ativo = await lerMeta("versao");
  for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== `shell-${ativo}`) await caches.delete(k);
  await self.clients.claim();
}
async function servir(req) {
  const url = new URL(req.url);
  let caminho = url.pathname.slice(new URL(base()).pathname.length);
  if (caminho === "" || req.mode === "navigate") caminho = "index.html";
  const v = await lerMeta("versao");
  const r = v > 0 ? await (await caches.open(`shell-${v}`)).match(new URL(caminho, base()).href) : undefined;
  return r ?? new Response("", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

self.addEventListener("install", (e) => e.waitUntil(instalar()));
self.addEventListener("activate", (e) => e.waitUntil(ativar()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== new URL(base()).origin || !url.href.startsWith(base())) return; // dados (wss, outras origens) nunca passam pelo cache
  e.respondWith(servir(req));
});
self.addEventListener("message", (e) => {
  const porta = e.ports && e.ports[0];
  if (!porta) return;
  const t = e.data && e.data.t;
  if (t === "versao") lerMeta("versao").then((v) => porta.postMessage({ versao: v, sw: VERSAO_SW }));
  else if (t === "hash-sw")
    buscar("sw.js").then(async (b) => porta.postMessage({ hash: b === null ? null : await sha256Hex(b) }));
});
