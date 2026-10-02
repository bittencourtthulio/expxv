// Leitura do catálogo de voz local do disco (`resources/voz/modelos.json`). Falha FECHADA: arquivo ausente, grande demais ou inválido = catálogo vazio e o motivo para a UI.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validarCatalogo, type Catalogo } from "./catalogo";

const MAX_BYTES = 256 * 1024;

export type CatalogoCarregado = { ok: true; catalogo: Catalogo } | { ok: false; motivo: string };

export function carregarCatalogoDe(pasta: string): CatalogoCarregado {
  try {
    const arquivo = join(pasta, "modelos.json");
    if (statSync(arquivo).size > MAX_BYTES) return { ok: false, motivo: "catálogo de modelos grande demais" };
    const r = validarCatalogo(JSON.parse(readFileSync(arquivo, "utf8")) as unknown);
    return r.ok ? { ok: true, catalogo: r.catalogo } : { ok: false, motivo: `catálogo de modelos inválido: ${r.erros[0] ?? "erro"}` };
  } catch {
    return { ok: false, motivo: "catálogo de modelos indisponível" };
  }
}

/** O catálogo vai em `extraResources` (arquivo real, fora do asar). Candidatas em ordem. */
export function pastaDoCatalogoDeVoz(o: { empacotado: boolean; resourcesPath: string; appPath: string; existe: (c: string) => boolean }): string | null {
  const candidatas = o.empacotado ? [join(o.resourcesPath, "voz")] : [join(o.appPath, "resources", "voz"), join(o.appPath, "dist", "resources", "voz")];
  return candidatas.find((c) => o.existe(c)) ?? null;
}
