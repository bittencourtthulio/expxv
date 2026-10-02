// Manifesto do seed da Loja de MCPs (Fase 7B, T-07B.03, D-141): `resources/mcp/catalogo-mcps.json.sha256` com o sha256 do seed, gerado
// a cada `build:main` (junto da cópia de ativos). O main lê esse arquivo e, se o seed empacotado divergir, abre a Loja SÓ EM LEITURA
// ("catálogo adulterado"). Formato: `<sha256 hex>  catalogo-mcps.json\n` (o mesmo de `shasum -a 256`).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SEED_MCP = "resources/mcp/catalogo-mcps.json";
export const MANIFESTO_MCP = `${SEED_MCP}.sha256`;

const sha256DoArquivo = (caminho) => createHash("sha256").update(readFileSync(caminho)).digest("hex");

/** Escreve o manifesto do seed. Idempotente; seed ausente é erro (o build não pode passar sem catálogo). Devolve o hash. */
export function gerarManifestoMcp(raiz) {
  const seed = join(raiz, SEED_MCP);
  if (!existsSync(seed)) throw new Error(`seed da Loja de MCPs ausente: ${SEED_MCP}`);
  const hash = sha256DoArquivo(seed);
  const conteudo = `${hash}  catalogo-mcps.json\n`;
  const destino = join(raiz, MANIFESTO_MCP);
  if (!existsSync(destino) || readFileSync(destino, "utf8") !== conteudo) writeFileSync(destino, conteudo, { mode: 0o644 });
  return hash;
}

/** Confere o seed contra o manifesto gravado. `ausente` = sem manifesto (build antigo); `adulterado` = hash diferente. */
export function conferirManifestoMcp(raiz) {
  const destino = join(raiz, MANIFESTO_MCP);
  if (!existsSync(destino)) return "ausente";
  const esperado = readFileSync(destino, "utf8").trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-f]{64}$/i.test(esperado) && esperado.toLowerCase() === sha256DoArquivo(join(raiz, SEED_MCP)) ? "ok" : "adulterado";
}
