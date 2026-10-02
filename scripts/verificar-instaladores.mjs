#!/usr/bin/env node
// `npm run verificar:instaladores` (T-21.08/T-21.09, P-157 ≤ 60 s): verificação estática dos instaladores de dist-app/.
// Uso: --dist=<pasta> --plataforma=mac|win|todas --saida=<arquivo.json> --limite-mb=N
//      --hdiutil= --lipo= --unzip= --plutil=   (caminhos dos executáveis; dublês nos testes)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITE_MB_PADRAO, lerProduto, lerVersao, resumo, verificarMac, verificarWindows } from "./lib/instaladores.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : "1"]; }));
const dir = resolve(args.dist ?? join(raiz, "dist-app"));
const inicio = Date.now();
const produto = lerProduto(raiz);
const versao = lerVersao(raiz);
const ferramentas = Object.fromEntries(["hdiutil", "lipo", "unzip", "plutil"].filter((k) => args[k]).map((k) => [k, args[k]]));
const limiteMb = args["limite-mb"] ? Number(args["limite-mb"]) : LIMITE_MB_PADRAO;

let plataforma = args.plataforma ?? "auto";
if (plataforma === "auto") {
  const mac = existsSync(join(dir, "latest-mac.yml"));
  const win = existsSync(join(dir, "latest.yml"));
  plataforma = mac && win ? "todas" : mac ? "mac" : win ? "win" : "nenhuma";
}
const itens = [];
if (plataforma === "nenhuma") itens.push({ id: "artefatos", ok: false, mensagem: `nenhum instalador em ${dir} (rode \`npm run dist:dir\`/dist:mac)` });
if (plataforma === "mac" || plataforma === "todas") itens.push(...(await verificarMac({ dir, produto, versao, ferramentas, limiteMb })));
if (plataforma === "win" || plataforma === "todas") itens.push(...(await verificarWindows({ dir, produto, versao, limiteMb })));

const r = resumo(itens);
const relatorio = { produto: produto.nome, versao, plataforma, ok: r.ok, segundos: Number(((Date.now() - inicio) / 1000).toFixed(1)), itens };
if (args.saida) {
  mkdirSync(dirname(resolve(args.saida)), { recursive: true });
  writeFileSync(resolve(args.saida), `${JSON.stringify(relatorio, null, 2)}\n`);
}
for (const i of itens) console.log(`${i.pulado ? "PULA" : i.ok ? "ok  " : "FALHA"} ${i.mensagem}`);
console.log(`\n${r.ok ? "instaladores OK" : `instaladores com ${r.falhas.length} falha(s)`} em ${relatorio.segundos}s (${r.total} itens, ${r.pulados} pulados)`);
process.exit(r.ok ? 0 : 1);
