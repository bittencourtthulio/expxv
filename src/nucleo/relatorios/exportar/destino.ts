// Destino de "Exportar para…" (T-19.21): é uma pasta que a PESSOA escolhe no diálogo do SO (aberto no main). Aqui só se decide se pode: recusa `docs/**` do projeto (D-04),
// `.git`, `node_modules`, `.expx`, `.claude`, a pasta do produto e diretórios do sistema; resolve symlink antes de comparar; nunca sobrescreve (sufixo `-2`).
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { PRODUTO } from "../../produto";
import { invalido, regraViolada } from "../erros";

const PASTAS_DO_PROJETO = new Set(["docs", ".git", "node_modules", ".expx", ".claude", PRODUTO.pastaNoProjeto.toLowerCase()]);
const SISTEMA_POSIX = ["/etc", "/usr", "/bin", "/sbin", "/lib", "/boot", "/dev", "/proc", "/sys", "/system", "/library", "/private/etc", "/applications", "/var/lib", "/var/log", "/var/db", "/var/run", "/var/spool", "/var/root", "/private/var/db", "/private/var/log", "/private/var/root", "/private/var/run"];
const SISTEMA_WIN = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"];

const iguaisOuDentro = (p: string, base: string): boolean => p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);

/** decisão pura sobre um caminho JÁ resolvido (sem symlink). Lança com mensagem nominal (sem expor o caminho). */
export function validarDestinoResolvido(destino: string, raizWorkspace: string | null): void {
  if (!isAbsolute(destino)) throw invalido("o destino precisa ser uma pasta escolhida no diálogo");
  const d = resolve(destino);
  const baixo = d.toLowerCase();
  if (d === resolve(sep) || /^[a-z]:\\?$/i.test(d)) throw regraViolada("não é possível exportar para a raiz do disco");
  if (SISTEMA_POSIX.some((s) => iguaisOuDentro(baixo, s)) || SISTEMA_WIN.some((s) => iguaisOuDentro(baixo, s))) throw regraViolada("não é possível exportar para uma pasta do sistema");
  if (baixo.split(/[\\/]/).some((p) => p === ".git" || p === "node_modules")) throw regraViolada("não é possível exportar para dentro de .git ou node_modules");
  if (raizWorkspace !== null) {
    const r = resolve(raizWorkspace).toLowerCase();
    if (iguaisOuDentro(baixo, r)) {
      const primeira = baixo.slice(r.length).split(/[\\/]/).filter(Boolean)[0];
      if (primeira !== undefined && PASTAS_DO_PROJETO.has(primeira)) throw regraViolada(primeira === "docs" ? "o ADE não escreve em docs/ do projeto: escolha outra pasta" : `não é possível exportar para a pasta ${primeira} do projeto`);
    }
  }
}

/** igual a `validarDestinoResolvido`, mas resolve symlinks (destino e raiz) antes de comparar. */
export async function validarDestino(destino: string, raizWorkspace: string | null, real: (p: string) => Promise<string> = realpath): Promise<string> {
  if (!isAbsolute(destino)) throw invalido("o destino precisa ser uma pasta escolhida no diálogo");
  let d: string;
  try { d = await real(destino); } catch { throw invalido("a pasta de destino não existe"); }
  let r: string | null = raizWorkspace;
  if (r !== null) { try { r = await real(r); } catch { r = raizWorkspace; } }
  validarDestinoResolvido(d, r);
  if (raizWorkspace !== null && r !== raizWorkspace) validarDestinoResolvido(d, raizWorkspace);
  return d;
}

export const rotuloDoDestino = (destino: string): string => basename(destino) || "pasta escolhida";
export const juntar = join;
