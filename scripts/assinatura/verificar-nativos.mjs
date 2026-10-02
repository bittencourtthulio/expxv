#!/usr/bin/env node
// `npm run verificar:nativos` (T-21.11, AU-21): percorre TODO Mach-O/PE do pacote (inclui app.asar.unpacked), confere assinatura e arquitetura.
//   --pacote=<.app ou pasta>  --esperado=assinado|nao_assinado  --saida=<json>  --codesign= --lipo=  (dublês)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { esperadoValido, localizarApp, redigir, verificarNativos } from "../lib/assinatura.mjs";
import { lerProduto } from "../lib/instaladores.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : "1"]; }));
const esperado = args.esperado ?? "nao_assinado";
if (!esperadoValido(esperado)) {
  console.error("--esperado deve ser assinado ou nao_assinado");
  process.exit(2);
}
const pacote = args.pacote ? resolve(args.pacote) : localizarApp(raiz, lerProduto(raiz).nome);
if (!pacote) {
  console.error("pacote não encontrado (use --pacote=<.app> ou rode `npm run dist:dir`)");
  process.exit(1);
}
const r = verificarNativos({ raiz: pacote, esperado, ferramentas: { codesign: args.codesign, lipo: args.lipo } });
const json = redigir(JSON.stringify(r, null, 2));
if (args.saida) {
  mkdirSync(dirname(resolve(args.saida)), { recursive: true });
  writeFileSync(resolve(args.saida), `${json}\n`);
}
console.log(`binários: ${r.total} (assinados: ${r.assinados}, sem assinatura real: ${r.nao_assinados})${r.nota ? ` — ${r.nota}` : ""}`);
for (const p of r.problemas) console.error(redigir(`  ${p}`));
console.log(r.ok ? `verificar-nativos OK (esperado: ${esperado})` : `verificar-nativos FALHOU (esperado: ${esperado}): ${r.problemas.length} problema(s)`);
process.exit(r.ok ? 0 : 1);
