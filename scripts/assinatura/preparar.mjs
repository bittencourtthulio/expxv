#!/usr/bin/env node
// `npm run assinatura:preparar` (T-21.10, D-345). Mostra capacidade × NOME da variável × presente? (sem valores).
//   --perfil=local   (padrão) exit 0: "build sem assinatura real (R1)"
//   --perfil=release exit ≠ 0 se faltar variável (cita só nomes)
//   --simulado       usa dublês de codesign/notarytool/signtool (--duples=<pasta>, padrão tests/fixtures/assinatura)
//   --verificar      só a tabela (comportamento padrão; aceito por compatibilidade)  --saida=<arquivo>
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { avaliarAmbiente, redigir, tabela } from "../lib/assinatura.mjs";
import { lerProduto } from "../lib/instaladores.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.length ? v.join("=") : "1"]; }));
const perfil = args.perfil ?? "local";
if (perfil !== "local" && perfil !== "release") {
  console.error("perfil inválido: use --perfil=local|release");
  process.exit(2);
}
const produto = lerProduto(raiz);
const av = avaliarAmbiente(process.env, produto.prefixoEnv);
const saida = [tabela(av.linhas), ""];
let codigo = 0;

if (args.simulado) {
  const pasta = resolve(args.duples ?? join(raiz, "tests", "fixtures", "assinatura"));
  saida.push(`[simulado] dublês em ${pasta}: nada é assinado, notarizado nem enviado de verdade`);
  const chamadas = [
    ["codesign", ["--sign", "SIMULADO", "--force", "--options", "runtime", "--timestamp", "alvo-simulado"]],
    ["xcrun", ["notarytool", "submit", "alvo-simulado.zip", "--wait"]],
    ["signtool", ["sign", "/fd", "sha256", "alvo-simulado.exe"]],
  ];
  for (const [nome, a] of chamadas) {
    const exe = join(pasta, nome);
    if (!existsSync(exe)) {
      saida.push(`[simulado] dublê ausente: ${nome}`);
      codigo = 1;
      continue;
    }
    try {
      chmodSync(exe, 0o755);
    } catch {
      /* somente leitura */
    }
    const r = spawnSync(exe, a, { encoding: "utf8" });
    saida.push(`[simulado] ${nome}: ${r.status === 0 ? "ok" : `falhou (${r.status})`}`);
    if (r.status !== 0) codigo = 1;
  }
} else if (av.satisfeito) {
  saida.push(`perfil ${perfil}: todas as capacidades de assinatura têm variáveis presentes`);
} else if (perfil === "local") {
  saida.push("build sem assinatura real (R1): perfil local, variáveis ausentes não bloqueiam");
  saida.push(`(para release, faltariam: ${av.faltando.flatMap((f) => f.variaveis).join(", ")})`);
} else {
  saida.push("FALHA (perfil release): faltam variáveis de assinatura");
  for (const f of av.faltando) saida.push(`  ${f.capacidade}: ${f.variaveis.join(", ")}`);
  codigo = 1;
}

const texto = redigir(saida.join("\n"));
if (args.saida) {
  mkdirSync(dirname(resolve(args.saida)), { recursive: true });
  writeFileSync(resolve(args.saida), `${texto}\n`);
}
(codigo === 0 ? console.log : console.error)(texto);
process.exit(codigo);
