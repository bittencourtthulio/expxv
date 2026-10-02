// Manifesto da árvore ANTES e DEPOIS do `expxdev init` (D-474): lista o que foi criado/alterado/removido, protege o que já existia
// (cópia de segurança) e desfaz com segurança só o que o instalador criou (cancelamento). Nunca segue symlink; nunca toca fora da raiz.
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LIMITES_SUITE, PASTAS_GRAVADAS, dentroDe } from "./modelo";

export interface EntradaManifesto {
  tipo: "arquivo" | "link" | "pasta";
  /** hash (arquivo pequeno) ou `tamanho:mtime` (grande); vazio para pasta */
  assinatura: string;
}
export type Manifesto = Map<string, EntradaManifesto>;

export interface ResultadoManifesto {
  mapa: Manifesto;
  truncado: boolean;
}

const IGNORADOS = new Set(["node_modules", ".git"]);

async function assinaturaDe(caminho: string, tamanho: number, mtimeMs: number): Promise<string> {
  if (tamanho > LIMITES_SUITE.manifesto_hash_bytes) return `${tamanho}:${Math.floor(mtimeMs)}`;
  try { return createHash("sha256").update(await readFile(caminho)).digest("hex"); } catch { return `${tamanho}:${Math.floor(mtimeMs)}`; }
}

/**
 * Percorre `.claude`, `.expx` e `.opencode` por inteiro e, na raiz, só os NOMES (arquivos com assinatura). Limitado em quantidade;
 * `truncado` avisa quando o teto cortou a varredura.
 */
export async function criarManifesto(raiz: string): Promise<ResultadoManifesto> {
  const mapa: Manifesto = new Map();
  let truncado = false;

  async function entrada(rel: string, caminho: string): Promise<EntradaManifesto | null> {
    try {
      const s = await lstat(caminho);
      if (s.isSymbolicLink()) return { tipo: "link", assinatura: "link" };
      if (s.isDirectory()) return { tipo: "pasta", assinatura: "" };
      if (s.isFile()) return { tipo: "arquivo", assinatura: await assinaturaDe(caminho, s.size, s.mtimeMs) };
    } catch { /* sumiu no meio */ }
    void rel;
    return null;
  }

  async function descer(rel: string): Promise<void> {
    let nomes: string[];
    try { nomes = await readdir(join(raiz, rel)); } catch { return; }
    for (const nome of nomes.sort()) {
      if (IGNORADOS.has(nome)) continue;
      if (mapa.size >= LIMITES_SUITE.manifesto_arquivos) { truncado = true; return; }
      const r = `${rel}/${nome}`;
      const e = await entrada(r, join(raiz, r));
      if (e === null) continue;
      mapa.set(r, e);
      if (e.tipo === "pasta") await descer(r);
    }
  }

  let raizes: string[] = [];
  try { raizes = await readdir(raiz); } catch { return { mapa, truncado: false }; }
  for (const nome of raizes.sort()) {
    if (IGNORADOS.has(nome)) continue;
    if (mapa.size >= LIMITES_SUITE.manifesto_arquivos) { truncado = true; break; }
    const e = await entrada(nome, join(raiz, nome));
    if (e === null) continue;
    if (e.tipo === "pasta" && !PASTAS_GRAVADAS.includes(nome)) { mapa.set(nome, e); continue; }
    mapa.set(nome, e);
    if (e.tipo === "pasta") await descer(nome);
  }
  return { mapa, truncado };
}

export interface DiferencaManifesto {
  criados: string[];
  alterados: string[];
  removidos: string[];
  /** caminhos que mudaram FORA das pastas esperadas */
  fora_do_esperado: string[];
}

const primeiro = (rel: string): string => rel.split("/")[0] ?? rel;

export function compararManifestos(antes: Manifesto, depois: Manifesto): DiferencaManifesto {
  const criados: string[] = [];
  const alterados: string[] = [];
  const removidos: string[] = [];
  for (const [rel, e] of depois) {
    const a = antes.get(rel);
    if (a === undefined) { if (e.tipo !== "pasta") criados.push(rel); continue; }
    if (a.tipo !== e.tipo || a.assinatura !== e.assinatura) alterados.push(rel);
  }
  for (const [rel, a] of antes) if (!depois.has(rel) && a.tipo !== "pasta") removidos.push(rel);
  // pasta nova na raiz (fora das esperadas) também conta como fora do esperado
  const pastasNovas = [...depois].filter(([rel, e]) => e.tipo === "pasta" && !antes.has(rel) && !rel.includes("/")).map(([rel]) => rel);
  const fora = new Set<string>();
  for (const rel of [...criados, ...alterados, ...removidos, ...pastasNovas]) if (!PASTAS_GRAVADAS.includes(primeiro(rel))) fora.add(rel);
  return { criados: criados.sort(), alterados: alterados.sort(), removidos: removidos.sort(), fora_do_esperado: [...fora].sort() };
}

// ---------------------------------------------------------------- cópia de segurança
export interface ResultadoBackup {
  copiados: number;
  truncado: boolean;
}

/** Copia, para `destino` (fora do projeto), os ARQUIVOS que já existiam nas pastas gravadas. Limitada em quantidade e bytes. */
export async function copiarBackup(raiz: string, antes: Manifesto, destino: string): Promise<ResultadoBackup> {
  let copiados = 0;
  let bytes = 0;
  let truncado = false;
  for (const [rel, e] of antes) {
    if (e.tipo !== "arquivo" || !PASTAS_GRAVADAS.includes(primeiro(rel)) || !rel.includes("/")) continue;
    if (copiados >= LIMITES_SUITE.backup_arquivos) { truncado = true; break; }
    try {
      const origem = join(raiz, rel);
      const s = await lstat(origem);
      if (!s.isFile()) continue;
      if (bytes + s.size > LIMITES_SUITE.backup_bytes) { truncado = true; break; }
      const alvo = join(destino, ...rel.split("/"));
      await mkdir(dirname(alvo), { recursive: true });
      await copyFile(origem, alvo);
      bytes += s.size;
      copiados += 1;
    } catch { /* arquivo que sumiu ou ilegível: fica sem cópia */ }
  }
  return { copiados, truncado };
}

// ---------------------------------------------------------------- devolução do que o instalador removeu
/** Pastas temporárias que o `init` cria AO LADO de `.expx` na raiz do projeto (troca atômica): `.expx.tmp-<pid>-<ms>` e `...-anterior`. */
export const PADRAO_TEMPORARIA_EXPX = /^\.expx\.tmp-\d+-\d+(-anterior)?$/;
/** O que a re-instalação NÃO reproduz e é do usuário: o `init` troca `.expx/` inteiro e leva isto junto. Devolvido da cópia de segurança. */
export const ARQUIVOS_DO_USUARIO_EM_EXPX: readonly string[] = [".expx/hooks.json"];

async function destinoSeguro(raizReal: string, rel: string): Promise<string | null> {
  const partes = rel.split("/");
  if (partes.includes("..") || partes.includes("") || !PASTAS_GRAVADAS.includes(partes[0] ?? "") || partes.length < 2) return null;
  // o ancestral mais próximo que existe tem de estar dentro da raiz (nenhum symlink de saída)
  let ancestral = join(raizReal, ...partes.slice(0, -1));
  for (;;) {
    try { if (!dentroDe(raizReal, await realpath(ancestral))) return null; break; } catch {
      const pai = dirname(ancestral);
      if (pai === ancestral || !dentroDe(raizReal, pai)) return null;
      ancestral = pai;
    }
  }
  return join(raizReal, ...partes);
}

/** Devolve da cópia de segurança os arquivos `permitidos` que existiam antes e o instalador removeu. Nunca sobrescreve o que existe. */
export async function devolverArquivosDoUsuario(raiz: string, antes: Manifesto, depois: Manifesto, backup: string | null, permitidos: readonly string[] = ARQUIVOS_DO_USUARIO_EM_EXPX): Promise<string[]> {
  if (backup === null) return [];
  let raizReal: string;
  try { raizReal = await realpath(raiz); } catch { return []; }
  const feitos: string[] = [];
  for (const rel of permitidos) {
    if (antes.get(rel)?.tipo !== "arquivo" || depois.has(rel)) continue;
    const alvo = await destinoSeguro(raizReal, rel);
    if (alvo === null) continue;
    try { await mkdir(dirname(alvo), { recursive: true }); await copyFile(join(backup, ...rel.split("/")), alvo); feitos.push(rel); } catch { /* sem cópia: fica na lista de removidos do resumo */ }
  }
  return feitos;
}

// ---------------------------------------------------------------- limpeza segura (cancelamento)
export interface ResultadoLimpeza {
  removidos: number;
  restaurados: number;
  /** o que NÃO foi possível desfazer (arquivo alterado sem cópia, erro) */
  restantes: string[];
}

/**
 * Desfaz o que o instalador deixou pela metade: remove SÓ arquivos que não existiam antes (dentro de `.claude`/`.expx`/`.opencode`, sem seguir
 * symlink), restaura da cópia de segurança os que já existiam e foram alterados, e apara pastas novas que ficaram vazias.
 * Arquivo do usuário que não pôde ser restaurado é listado em `restantes`, nunca apagado.
 */
export async function limparCriados(raiz: string, antes: Manifesto, depois: Manifesto, backup: string | null): Promise<ResultadoLimpeza> {
  const r: ResultadoLimpeza = { removidos: 0, restaurados: 0, restantes: [] };
  let raizReal: string;
  try { raizReal = await realpath(raiz); } catch { return { ...r, restantes: ["a pasta do projeto não existe mais"] }; }
  const seguro = async (rel: string): Promise<string | null> => {
    if (!PASTAS_GRAVADAS.includes(primeiro(rel)) || !rel.includes("/") || rel.split("/").includes("..")) return null;
    const alvo = join(raizReal, ...rel.split("/"));
    try { if (!dentroDe(raizReal, join(await realpath(dirname(alvo)), rel.split("/").pop() ?? ""))) return null; } catch { return null; }
    return alvo;
  };

  for (const [rel, e] of depois) {
    if (e.tipo === "pasta") continue;
    const a = antes.get(rel);
    if (a === undefined) {
      const alvo = await seguro(rel);
      if (alvo === null) { r.restantes.push(rel); continue; }
      try { await unlink(alvo); r.removidos += 1; } catch { r.restantes.push(rel); }
    } else if (a.assinatura !== e.assinatura || a.tipo !== e.tipo) {
      const alvo = await seguro(rel);
      const copia = backup === null ? null : join(backup, ...rel.split("/"));
      if (alvo === null || copia === null) { r.restantes.push(rel); continue; }
      try { await copyFile(copia, alvo); r.restaurados += 1; } catch { r.restantes.push(rel); }
    }
  }
  // o que já existia e o instalador REMOVEU (a troca atômica de `.expx/` leva junto o que não é da instalação): volta da cópia de segurança
  for (const [rel, a] of antes) {
    if (a.tipo !== "arquivo" || depois.has(rel) || backup === null) continue;
    const alvo = await destinoSeguro(raizReal, rel);
    if (alvo === null) { if (PASTAS_GRAVADAS.includes(primeiro(rel)) && rel.includes("/")) r.restantes.push(rel); continue; }
    try { await mkdir(dirname(alvo), { recursive: true }); await copyFile(join(backup, ...rel.split("/")), alvo); r.restaurados += 1; } catch { r.restantes.push(rel); }
  }
  // sobras da troca atômica na raiz: se o `.expx` ficou de lado (cancelado entre os dois `rename`), volta; o resto sai
  const sobras = [...depois].filter(([rel, e]) => e.tipo === "pasta" && !antes.has(rel) && PADRAO_TEMPORARIA_EXPX.test(rel)).map(([rel]) => rel).sort((x, y) => Number(y.endsWith("-anterior")) - Number(x.endsWith("-anterior")));
  for (const rel of sobras) {
    const alvo = join(raizReal, rel);
    try {
      if (!(await lstat(alvo)).isDirectory()) continue;
      if (rel.endsWith("-anterior") && antes.has(".expx") && !(await lstat(join(raizReal, ".expx")).then(() => true, () => false))) { await rename(alvo, join(raizReal, ".expx")); r.restaurados += 1; continue; }
      await rm(alvo, { recursive: true, force: true });
      r.removidos += 1;
    } catch { r.restantes.push(rel); }
  }
  const novasPastas = [...depois].filter(([rel, e]) => e.tipo === "pasta" && !antes.has(rel) && rel.includes("/")).map(([rel]) => rel).sort((a, b) => b.length - a.length);
  const novasRaiz = [...depois].filter(([rel, e]) => e.tipo === "pasta" && !antes.has(rel) && !rel.includes("/") && PASTAS_GRAVADAS.includes(rel)).map(([rel]) => rel);
  for (const rel of novasPastas) {
    const alvo = await seguro(rel);
    if (alvo === null) continue;
    try { await rmdir(alvo); } catch { /* não vazia: fica */ }
  }
  for (const rel of novasRaiz) { try { await rmdir(join(raizReal, rel)); } catch { /* não vazia: fica */ } }
  return r;
}
