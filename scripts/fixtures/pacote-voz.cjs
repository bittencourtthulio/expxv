// Roda DENTRO do app empacotado (ELECTRON_RUN_AS_NODE=1). Prova a voz local no pacote: o worker e o addon nativo da plataforma estão FORA do asar, o catálogo e as amostras estão em Resources/voz,
// NENHUM modelo viaja no pacote e o addon CARREGA de verdade (o worker responde `modelo_corrompido` a uma configuração sem modelo, e não `runtime_indisponivel`).
// Uso: <executavel> pacote-voz.cjs <pasta Resources>
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const recursos = process.argv[2];
const fora = join(recursos, "app.asar.unpacked");
const falhar = (m) => { console.error(JSON.stringify({ ok: false, erro: m })); process.exit(1); };

const so = process.platform === "win32" ? "win" : process.platform;
const addon = join(fora, "node_modules", `sherpa-onnx-${so}-${process.arch}`, "sherpa-onnx.node");
const worker = join(fora, "dist", "nucleo", "voz", "local", "worker-sherpa.js");
for (const c of [worker, addon, join(fora, "node_modules", "sherpa-onnx-node", "addon.js"), join(recursos, "voz", "modelos.json"), join(recursos, "voz", "amostra-pt.wav"), join(recursos, "voz", "amostra-en.wav")]) {
  if (!existsSync(c)) falhar(`ausente no pacote: ${c}`);
}
const sobra = readdirSync(join(recursos, "voz")).filter((n) => !/^(modelos\.json|amostra-[a-z]+\.wav)$/.test(n));
if (sobra.length > 0) falhar(`arquivos inesperados em voz/: ${sobra.join(", ")}`);
const catalogo = JSON.parse(readFileSync(join(recursos, "voz", "modelos.json"), "utf8"));
if (!Array.isArray(catalogo.modelos) || catalogo.modelos.filter((m) => m.recomendado).length !== 1) falhar("catálogo sem exatamente um modelo recomendado");

const filho = spawn(process.execPath, [worker], { stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
filho.on("exit", (c) => { if (c !== 0) falhar(`o worker morreu (código ${c}) antes de responder`); });
const limite = setTimeout(() => { filho.kill("SIGKILL"); falhar("o worker não respondeu em 20 s"); }, 20_000);
filho.on("message", (m) => {
  if (m.t === "pronto") {
    filho.send({ t: "carregar", req: 1, config: { chave: "pacote", trecho_max_s: 28, sherpa: { featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { whisper: { encoder: join(recursos, "voz", "nao-existe-e.onnx"), decoder: join(recursos, "voz", "nao-existe-d.onnx") }, tokens: join(recursos, "voz", "modelos.json"), numThreads: 1, provider: "cpu" } } } });
  } else if (m.t === "erro") {
    clearTimeout(limite);
    filho.send({ t: "sair" });
    if (m.codigo === "runtime_indisponivel") falhar("o addon de voz NÃO carregou dentro do pacote (runtime_indisponivel)");
    if (m.codigo !== "modelo_corrompido") falhar(`código inesperado: ${m.codigo}`);
    console.log(`worker e addon fora do asar, addon carrega (${so}-${process.arch}), catálogo com ${catalogo.modelos.length} modelos, nenhum modelo no pacote`);
    setTimeout(() => process.exit(0), 100);
  } else if (m.t === "carregado") {
    falhar("o worker carregou uma configuração inválida");
  }
});
