#!/usr/bin/env node
// `npm run verificar:assinatura` (T-21.11, AU-20): codesign --verify --deep --strict, spctl, stapler e entitlements do `.app`.
// Windows: tabela de certificado do PE (estático) e, com --signtool=, `signtool verify /pa` [CI-Windows].
//   --app=<.app>  --exe=<Setup.exe>  --esperado=assinado|nao_assinado  --saida=<json>  --codesign= --spctl= --xcrun= --signtool=
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chavesDeEntitlements, esperadoValido, localizarApp, redigir, verificarAssinaturaApp } from "../lib/assinatura.mjs";
import { lerCabecalhoPE, lerProduto } from "../lib/instaladores.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : "1"]; }));
const esperado = args.esperado ?? "nao_assinado";
if (!esperadoValido(esperado)) {
  console.error("--esperado deve ser assinado ou nao_assinado");
  process.exit(2);
}
const relatorio = { esperado, mac: null, windows: null, ok: true, problemas: [] };
const app = args.app ? resolve(args.app) : args.exe ? null : localizarApp(raiz, lerProduto(raiz).nome);
if (!app && !args.exe) {
  console.error("nada a verificar: use --app=<.app> ou --exe=<Setup.exe> (ou rode `npm run dist:dir`)");
  process.exit(1);
}
if (app) {
  const esperados = chavesDeEntitlements(readFileSync(join(raiz, "build", "entitlements.mac.plist"), "utf8"));
  relatorio.mac = verificarAssinaturaApp({ app, esperado, ferramentas: { codesign: args.codesign, spctl: args.spctl, xcrun: args.xcrun }, entitlementsEsperados: esperados });
  relatorio.problemas.push(...relatorio.mac.problemas);
  if (relatorio.mac.nota) relatorio.nota = relatorio.mac.nota;
}
if (args.exe) {
  const exe = resolve(args.exe);
  const nome = exe.split("/").pop();
  const pe = lerCabecalhoPE(exe);
  const assinado = pe.ok && pe.assinado === true;
  const win = { assinado, detalhe: pe.ok ? (assinado ? "tabela de certificado presente" : "sem tabela de certificado") : `PE inválido (${pe.motivo})`, authenticode: "[CI-Windows] signtool verify /pa" };
  if (args.signtool) {
    const r = spawnSync(args.signtool, ["verify", "/pa", exe], { encoding: "utf8" });
    win.signtool = r.status === 0 ? "ok" : "falhou";
    if (esperado === "assinado" && r.status !== 0) relatorio.problemas.push("signtool verify /pa falhou");
  }
  if (!pe.ok) relatorio.problemas.push(`${nome}: ${win.detalhe}`);
  else if (esperado === "assinado" && !assinado) relatorio.problemas.push(`${nome}: sem assinatura Authenticode`);
  else if (esperado === "nao_assinado" && assinado) relatorio.problemas.push(`${nome}: está assinado, mas o esperado era não assinado`);
  if (!assinado) relatorio.nota = relatorio.nota ?? "sem assinatura real: R1";
  relatorio.windows = win;
}
relatorio.ok = relatorio.problemas.length === 0;
const json = redigir(JSON.stringify(relatorio, null, 2));
if (args.saida) {
  mkdirSync(dirname(resolve(args.saida)), { recursive: true });
  writeFileSync(resolve(args.saida), `${json}\n`);
}
for (const c of relatorio.mac?.checks ?? []) console.log(`${c.ok ? "ok  " : "não "} ${c.mensagem}`);
if (relatorio.windows) console.log(`PE: ${relatorio.windows.detalhe}`);
if (relatorio.nota) console.log(relatorio.nota);
for (const p of relatorio.problemas) console.error(redigir(`  ${p}`));
console.log(relatorio.ok ? `verificar-assinatura OK (esperado: ${esperado})` : `verificar-assinatura FALHOU (esperado: ${esperado})`);
process.exit(relatorio.ok ? 0 : 1);
