// Gera `resources/skills/manifesto.json` (Fase 7, T-07.16): sha256 de cada arquivo das skills embarcadas `ev-*`. O teste falha se uma skill muda sem regerar.
// Uso: node scripts/gerar-manifesto-skills.mjs [--verificar]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSAO_PACOTE = 1;

const sha = (b) => createHash("sha256").update(b).digest("hex");

function descricaoDe(texto) {
  const m = /^description:\s*(.+)$/m.exec(texto);
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
}

/** Calcula o manifesto a partir de `<raiz>/resources/skills`. Determinístico (ordenado, sem data). */
export function calcularManifesto(raiz) {
  const base = join(raiz, "resources", "skills");
  const skills = [];
  for (const nome of readdirSync(base).sort()) {
    const dir = join(base, nome);
    if (!statSync(dir).isDirectory() || !/^ev-[a-z0-9-]+$/.test(nome)) continue;
    const arquivo = join(dir, "SKILL.md");
    if (!existsSync(arquivo)) continue;
    const buf = readFileSync(arquivo);
    skills.push({
      name: nome,
      version: VERSAO_PACOTE,
      path: `${nome}/SKILL.md`,
      description: descricaoDe(buf.toString("utf8")).slice(0, 200),
      clis: ["claude", "codex", "opencode", "portatil"],
      sha256: sha(buf),
    });
  }
  return { manifest_version: VERSAO_PACOTE, skills };
}

export function textoDoManifesto(raiz) {
  return JSON.stringify(calcularManifesto(raiz), null, 2) + "\n";
}

const aqui = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raiz = join(aqui, "..");
  const destino = join(raiz, "resources", "skills", "manifesto.json");
  const novo = textoDoManifesto(raiz);
  if (process.argv.includes("--verificar")) {
    const atual = existsSync(destino) ? readFileSync(destino, "utf8") : "";
    if (atual !== novo) {
      console.error("manifesto das skills embarcadas desatualizado: rode `node scripts/gerar-manifesto-skills.mjs`");
      process.exit(1);
    }
  } else {
    writeFileSync(destino, novo);
    console.log(`manifesto gravado (${calcularManifesto(raiz).skills.length} skills)`);
  }
}
