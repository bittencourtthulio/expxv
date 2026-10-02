// `board:abrir_arquivo` (T-10.13, CT-10.26): o main resolve o caminho; só `.md|.json|.jsonl|.yaml` sob `docs/` do worktree do trabalho, sem `..`, sem caminho absoluto vindo do
// renderer e sem symlink que escape do worktree. O núcleo recebe `realpath` por injeção (sem importar `fs`).
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ErroBoard } from "./erros";

export const EXTENSOES_ABRIVEIS: readonly string[] = [".md", ".json", ".jsonl", ".yaml"];

/** Valida a forma do caminho relativo (sem tocar o disco). Devolve o relativo normalizado com `/`. */
export function validarRelativoAbrivel(rel: string): string {
  const proibido = (m: string): never => {
    throw new ErroBoard("forbidden", m, "path_not_allowed");
  };
  if (typeof rel !== "string" || rel === "") return proibido("arquivo da task ausente");
  if (rel.includes("\0") || rel.includes("\\")) return proibido("caminho inválido");
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || isAbsolute(rel)) return proibido("caminho absoluto não é permitido");
  const partes = rel.split("/");
  if (partes.includes("..") || partes.includes(".")) return proibido("caminho fora de docs/");
  if (partes[0] !== "docs" || partes.length < 2) return proibido("só arquivos sob docs/ podem ser abertos");
  const base = partes[partes.length - 1] as string;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  if (!EXTENSOES_ABRIVEIS.includes(ext) || base.length <= ext.length) return proibido("extensão não permitida");
  return rel;
}

/** Resolve o absoluto e confere, pelo `realpath`, que o arquivo continua dentro de `<worktree>/docs` (symlink para fora é recusado). */
export async function resolverArquivoAbrivel(worktreeAbs: string, rel: string, realpath: (p: string) => Promise<string>): Promise<string> {
  const ok = validarRelativoAbrivel(rel);
  const alvo = resolve(join(worktreeAbs, ok));
  let real: string;
  let docsReal: string;
  try {
    [real, docsReal] = await Promise.all([realpath(alvo), realpath(join(worktreeAbs, "docs"))]);
  } catch {
    throw new ErroBoard("not_found", "arquivo da task não encontrado", "file_missing");
  }
  const dentro = (base: string, p: string): boolean => {
    const r = relative(base, p);
    return r !== "" && !r.startsWith("..") && !isAbsolute(r) && !r.split(sep).includes("..");
  };
  if (!dentro(docsReal, real)) throw new ErroBoard("forbidden", "o arquivo resolve para fora de docs/ do trabalho", "path_not_allowed");
  return real;
}
