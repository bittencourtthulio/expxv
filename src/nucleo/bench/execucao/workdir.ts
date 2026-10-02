// Workdir descartável (T-12.07): `<userData>/bench/exec/<run>/<tarefa>/<alvo>/` (0700), FORA de qualquer repositório git (nenhum ancestral com `.git`), com cópia das fixtures. Re-run apaga e recria.
// Guarda de caminho: segmentos por regex, `realpath` contra a raiz, symlink recusado (na pasta e dentro das fixtures). Nada aqui toca o branch nem a árvore do usuário.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { ErroBench, type ArtefatoRegistrado } from "../tipos";

// `_logs`/`_juiz` são pastas INTERNAS: o slug de tarefa/alvo do usuário nunca começa com `_` (SLUG_VALIDO), então nunca colidem
const SEGMENTO = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,80}$/;
export const MAX_ARQUIVOS_ARTEFATO = 300;
export const MAX_BYTES_ARTEFATO = 5 * 1024 * 1024;
const IGNORADOS = new Set(["node_modules", ".git"]);

export interface WorkdirCriado { abs: string; rel: string }

/** `true` se algum ancestral (inclusive o próprio caminho) tem `.git`. */
export function dentroDeRepositorio(caminho: string): boolean {
  let atual = resolve(caminho);
  const raiz = parse(atual).root;
  for (;;) {
    if (existsSync(join(atual, ".git"))) return true;
    if (atual === raiz) return false;
    atual = dirname(atual);
  }
}

function segmentoValido(s: string): boolean {
  return SEGMENTO.test(s) && s !== "." && s !== "..";
}

/** Garante que `alvo` (existente) resolve para dentro de `raiz` sem atravessar symlink. */
export function garantirDentro(raiz: string, alvo: string): string {
  const r = realpathSync(raiz);
  const a = realpathSync(alvo);
  if (a !== r && !a.startsWith(r + sep)) throw new ErroBench("caminho_fora", "o caminho resolve para fora da pasta de execução");
  return a;
}

export function caminhoRelativoSeguro(rel: string): boolean {
  if (typeof rel !== "string" || rel === "" || rel.length > 200 || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

export interface EntradaWorkdir {
  raizExec: string;
  run: string;
  tarefa: string;
  alvo: string;
  fixtures: Readonly<Record<string, string>>;
}

export function criarWorkdir(e: EntradaWorkdir): WorkdirCriado {
  for (const s of [e.run, e.tarefa, e.alvo]) if (!segmentoValido(s)) throw new ErroBench("segmento_invalido", "identificador de execução inválido");
  mkdirSync(e.raizExec, { recursive: true, mode: 0o700 });
  const raiz = realpathSync(e.raizExec);
  if (dentroDeRepositorio(raiz)) throw new ErroBench("workdir_em_repositorio", "a pasta de execução do Bench não pode ficar dentro de um repositório git");
  const abs = join(raiz, e.run, e.tarefa, e.alvo);
  // re-run: apaga e recria vazio (um symlink no lugar da pasta é removido como link, nunca seguido)
  if (existsSync(abs) || isLink(abs)) rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true, mode: 0o700 });
  garantirDentro(raiz, abs);
  for (const [rel, conteudo] of Object.entries(e.fixtures)) {
    if (!caminhoRelativoSeguro(rel)) throw new ErroBench("fixture_invalida", "caminho de fixture inválido");
    const dest = join(abs, ...rel.split("/"));
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    writeFileSync(dest, conteudo, { mode: 0o600 });
  }
  return { abs, rel: relative(raiz, abs).split(sep).join("/") };
}

function isLink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** Limpeza por ação do usuário: remove `exec/<run>` inteiro. Idempotente. */
export function limparRun(raizExec: string, run: string): void {
  if (!segmentoValido(run)) return;
  const alvo = join(raizExec, run);
  if (!existsSync(alvo) && !isLink(alvo)) return;
  rmSync(alvo, { recursive: true, force: true });
}

const TIPOS: Record<string, string> = { html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", md: "text/markdown", txt: "text/plain", csv: "text/csv", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export function tipoDoArquivo(nome: string): string {
  const ext = nome.includes(".") ? (nome.split(".").pop() as string).toLowerCase() : "";
  return TIPOS[ext] ?? "application/octet-stream";
}

/** Lista os artefatos do workdir (sem seguir symlink, sem `node_modules`/`.git`, com tetos de quantidade e de tamanho) e calcula o sha256. */
export function listarArtefatos(workdir: string, ignorarNomes: ReadonlySet<string> = new Set()): ArtefatoRegistrado[] {
  const saida: ArtefatoRegistrado[] = [];
  const raiz = realpathSync(workdir);
  const andar = (dir: string, prefixo: string): void => {
    if (saida.length >= MAX_ARQUIVOS_ARTEFATO) return;
    let nomes: string[];
    try { nomes = readdirSync(dir).sort(); } catch { return; }
    for (const n of nomes) {
      if (saida.length >= MAX_ARQUIVOS_ARTEFATO) return;
      if (IGNORADOS.has(n)) continue;
      const p = join(dir, n);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      const nome = prefixo === "" ? n : `${prefixo}/${n}`;
      if (st.isDirectory()) { andar(p, nome); continue; }
      if (!st.isFile() || ignorarNomes.has(nome)) continue;
      const lido = st.size <= MAX_BYTES_ARTEFATO ? readFileSync(p) : null;
      saida.push({ nome, tipo: tipoDoArquivo(nome), bytes: st.size, sha256: lido === null ? "" : createHash("sha256").update(lido).digest("hex") });
    }
  };
  andar(raiz, "");
  return saida;
}

/** Resolve um artefato por NOME já registrado (o chamador valida contra `artefatos_json`); recusa `..`, absoluto e symlink. */
export function resolverArtefato(workdir: string, nome: string): string {
  if (!caminhoRelativoSeguro(nome)) throw new ErroBench("artefato_invalido", "nome de artefato inválido");
  const abs = join(workdir, ...nome.split("/"));
  if (isLink(abs)) throw new ErroBench("artefato_invalido", "symlink recusado");
  const st = statSync(abs);
  if (!st.isFile()) throw new ErroBench("artefato_invalido", "não é um arquivo");
  garantirDentro(workdir, abs);
  return abs;
}
