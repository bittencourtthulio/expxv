// Ponto de entrada do PWA (T-22.13/T-22.15). Liga o cliente do relay à interface; tudo vira TEXTO (AX-12). Impressão digital do app: hash do manifesto e do sw.js instalados (R-A/R-F).
const raiz = document.getElementById("raiz");
async function pedirAoSw(msg) {
  const reg = await navigator.serviceWorker.ready;
  return new Promise((resolve) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = (e) => resolve(e.data);
    reg.active.postMessage(msg, [canal.port2]);
    setTimeout(() => resolve(null), 4000);
  });
}
async function impressaoDoApp() {
  const m = await (await fetch("manifesto-pwa.json", { cache: "no-store" })).arrayBuffer();
  const h = await pedirAoSw({ t: "hash-sw" });
  return { manifesto: await impressaoDigital(new Uint8Array(m)), sw: h && h.hash ? h.hash.slice(0, 32) : null };
}
function registrarSw() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(false);
  let url = "sw.js";
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    // CSP exige Trusted Types: a única URL de script permitida é a do próprio Service Worker
    const politica = window.trustedTypes.createPolicy("pwa-sw", { createScriptURL: (u) => (u === "sw.js" ? u : "about:blank") });
    url = politica.createScriptURL("sw.js");
  }
  return navigator.serviceWorker.register(url, { updateViaCache: "none" }).then(() => true, () => false);
}
async function iniciar() {
  raiz.textContent = "";
  const swOk = await registrarSw();
  const cliente = criarClienteRemoto({
    criarWs: (u) => new WebSocket(u),
    armazem: armazemIndexedDb(),
    relogio: { agora: () => Date.now() },
    agendar: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  });
  montarApp({ raiz, cliente, loc: location, hist: history, impressaoCliente: swOk ? impressaoDoApp : undefined });
  await cliente.iniciar();
}
iniciar();
