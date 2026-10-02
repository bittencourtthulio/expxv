// Escolha de destino e colisões (D-603). O destino nunca vem do renderer como caminho: o main resolve `pai` (token) e valida o `nome` como UM segmento.
// Nunca sobrescreve: pasta existente e não vazia vira "ocupado" com sugestão de outro nome; link simbólico e arquivo são recusados.
import { constants } from "node:fs";
import { access, lstat, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { validarNomePasta } from "./url";

export interface AvaliacaoDestinoFs {
  ok: boolean;
  situacao: "livre" | "vazio" | "ocupado" | "invalido";
  /** caminho completo (só no main). */
  caminho: string | null;
  motivo: string | null;
  sugestao: string | null;
}

/** `caminho` está DENTRO de `raiz` (ou é ela)? Compara segmentos, nunca prefixo de texto (`/a/b` não está em `/a/bc`). */
export function dentroDe(raiz: string, caminho: string): boolean {
  const r = resolve(raiz);
  const c = resolve(caminho);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** `~/…` no lugar da pasta pessoal (o renderer só vê isto). */
export function mascararCaminho(caminho: string, casa: string): string {
  const c = caminho.replaceAll("\\", "/");
  const h = casa.replaceAll("\\", "/").replace(/\/+$/, "");
  if (h !== "" && c === h) return "~";
  if (h !== "" && c.startsWith(`${h}/`)) return `~${c.slice(h.length)}`;
  return c;
}

const semBarraFinal = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p);

/** Pasta pai absoluta, normalizada, sem NUL. */
export function paiValido(pai: unknown): pai is string {
  return typeof pai === "string" && pai !== "" && !pai.includes("\0") && isAbsolute(pai) && semBarraFinal(normalize(pai)) === semBarraFinal(pai);
}

/** Padrão da "pasta de projetos": ~/orca/projects se existir, senão ~/Developer, senão a pasta pessoal. */
export async function pastaProjetosPadrao(casa: string, existe: (p: string) => Promise<boolean> = (p) => stat(p).then((s) => s.isDirectory(), () => false)): Promise<string> {
  for (const c of [join(casa, "orca", "projects"), join(casa, "Developer")]) if (await existe(c)) return c;
  return casa;
}

const SEM_PERMISSAO = "Sem permissão para criar pastas aqui. Escolha outra pasta de destino.";

export async function avaliarDestino(pai: string, nomeBruto: string): Promise<AvaliacaoDestinoFs> {
  const invalido = (motivo: string): AvaliacaoDestinoFs => ({ ok: false, situacao: "invalido", caminho: null, motivo, sugestao: null });
  if (!paiValido(pai)) return invalido("A pasta de destino é inválida.");
  const n = validarNomePasta(nomeBruto);
  if (!n.ok) return invalido(n.motivo);
  const destino = join(pai, n.nome);
  if (dirname(destino) !== semBarraFinal(pai)) return invalido("O nome da pasta é inválido.");
  try {
    if (!(await stat(pai)).isDirectory()) return invalido("A pasta de destino não é uma pasta.");
  } catch {
    return invalido("A pasta de destino não existe.");
  }
  try {
    await access(pai, constants.W_OK | constants.X_OK);
  } catch {
    return invalido(SEM_PERMISSAO);
  }
  let info;
  try {
    info = await lstat(destino);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, situacao: "livre", caminho: destino, motivo: null, sugestao: null };
    return invalido("Não foi possível verificar o destino.");
  }
  if (info.isSymbolicLink()) return invalido("Já existe um link simbólico com esse nome. Escolha outro nome.");
  if (!info.isDirectory()) return invalido("Já existe um arquivo com esse nome. Escolha outro nome.");
  let itens: string[];
  try {
    itens = await readdir(destino);
  } catch {
    return invalido("Já existe uma pasta com esse nome e ela não pode ser lida.");
  }
  if (itens.length === 0) return { ok: true, situacao: "vazio", caminho: destino, motivo: null, sugestao: null };
  return { ok: false, situacao: "ocupado", caminho: destino, motivo: "Já existe uma pasta com esse nome e ela não está vazia. Nada será sobrescrito.", sugestao: await nomeLivre(pai, n.nome) };
}

/** `nome-2`, `nome-3`… o primeiro que não existe. */
export async function nomeLivre(pai: string, nome: string): Promise<string | null> {
  for (let i = 2; i < 100; i++) {
    const candidato = `${nome.slice(0, 96)}-${i}`;
    try {
      await lstat(join(pai, candidato));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return candidato;
    }
  }
  return null;
}
