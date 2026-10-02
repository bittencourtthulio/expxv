// Marca de integridade e verificação dos modelos instalados (Fase 11, D-543). Depois de instalado, o modelo pode ser trocado/corrompido no disco (disco ruim, outro programa, adulteração):
//  - `verificarRapido` (a cada carga na memória): marca presente e válida, cada arquivo é arquivo regular (nunca symlink), com o MESMO tamanho e mtime do momento da verificação completa, e os arquivos
//    pequenos (≤ 4 MiB: vocabulário/configuração) são refeitos por sha256. Custo: algumas chamadas `lstat` + ~100 KB lidos;
//  - `verificarCompleto` (instalação, autoteste e "Verificar modelo"): sha256 de TUDO contra o catálogo, atualiza `verificado_em`.
// Qualquer divergência = `modelo_corrompido`: o runtime não carrega e a UI oferece apagar e baixar de novo.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModeloCatalogo } from "./catalogo";

export const MARCA_INTEGRIDADE = ".integridade.json";
const PEQUENO_BYTES = 4 * 1024 * 1024;

export interface Manifesto {
  versao: 1;
  modelo_id: string;
  instalado_em: string;
  verificado_em: string;
  arquivos: Array<{ nome: string; bytes: number; sha256: string; mtime_ms: number }>;
}

export async function gravarManifesto(pasta: string, m: Manifesto): Promise<void> {
  const tmp = join(pasta, `${MARCA_INTEGRIDADE}.tmp`);
  await writeFile(tmp, JSON.stringify(m), { mode: 0o600 });
  await rename(tmp, join(pasta, MARCA_INTEGRIDADE));
  if (process.platform !== "win32") await chmod(join(pasta, MARCA_INTEGRIDADE), 0o600);
}

export async function lerManifesto(pasta: string): Promise<Manifesto | null> {
  try {
    const l = await lstat(join(pasta, MARCA_INTEGRIDADE));
    if (!l.isFile() || l.isSymbolicLink() || l.size > 64 * 1024) return null;
    const j = JSON.parse(await readFile(join(pasta, MARCA_INTEGRIDADE), "utf8")) as Partial<Manifesto>;
    if (j.versao !== 1 || typeof j.modelo_id !== "string" || typeof j.instalado_em !== "string" || typeof j.verificado_em !== "string" || !Array.isArray(j.arquivos)) return null;
    const arquivos = j.arquivos.filter((a) => typeof a === "object" && a !== null && typeof a.nome === "string" && Number.isInteger(a.bytes) && typeof a.sha256 === "string" && typeof a.mtime_ms === "number");
    if (arquivos.length !== j.arquivos.length) return null;
    return { versao: 1, modelo_id: j.modelo_id, instalado_em: j.instalado_em, verificado_em: j.verificado_em, arquivos };
  } catch {
    return null;
  }
}

export function sha256DoArquivo(caminho: string): Promise<string> {
  return new Promise((ok, falha) => {
    const h = createHash("sha256");
    const r = createReadStream(caminho);
    r.on("data", (d) => h.update(d));
    r.on("end", () => ok(h.digest("hex")));
    r.on("error", falha);
  });
}

export type ResultadoVerificacao = { ok: true; manifesto: Manifesto } | { ok: false; motivo: "ausente" | "corrompido" };

/** a marca precisa descrever EXATAMENTE os arquivos do catálogo atual (mesmos nomes, tamanhos e hashes). */
function marcaConfereComCatalogo(m: Manifesto, modelo: ModeloCatalogo): boolean {
  if (m.modelo_id !== modelo.id || m.arquivos.length !== modelo.arquivos.length) return false;
  return modelo.arquivos.every((a) => m.arquivos.some((x) => x.nome === a.nome && x.bytes === a.bytes && x.sha256 === a.sha256));
}

export async function verificarRapido(pastaModelos: string, modelo: ModeloCatalogo): Promise<ResultadoVerificacao> {
  const pasta = join(pastaModelos, modelo.id);
  try {
    const raiz = await lstat(pasta);
    if (raiz.isSymbolicLink() || !raiz.isDirectory()) return { ok: false, motivo: "corrompido" };
  } catch {
    return { ok: false, motivo: "ausente" };
  }
  const m = await lerManifesto(pasta);
  if (m === null || !marcaConfereComCatalogo(m, modelo)) return { ok: false, motivo: "corrompido" };
  for (const a of m.arquivos) {
    try {
      const caminho = join(pasta, a.nome);
      const l = await lstat(caminho);
      if (l.isSymbolicLink() || !l.isFile() || l.size !== a.bytes || Math.abs(l.mtimeMs - a.mtime_ms) > 1) return { ok: false, motivo: "corrompido" };
      if (a.bytes <= PEQUENO_BYTES && (await sha256DoArquivo(caminho)) !== a.sha256) return { ok: false, motivo: "corrompido" };
    } catch {
      return { ok: false, motivo: "corrompido" };
    }
  }
  return { ok: true, manifesto: m };
}

export async function verificarCompleto(pastaModelos: string, modelo: ModeloCatalogo, agora: () => Date = () => new Date()): Promise<ResultadoVerificacao> {
  const rapida = await verificarRapido(pastaModelos, modelo);
  if (!rapida.ok && rapida.motivo === "ausente") return rapida;
  const pasta = join(pastaModelos, modelo.id);
  const m = await lerManifesto(pasta);
  if (m === null || !marcaConfereComCatalogo(m, modelo)) return { ok: false, motivo: "corrompido" };
  for (const a of modelo.arquivos) {
    try {
      const l = await lstat(join(pasta, a.nome));
      if (l.isSymbolicLink() || !l.isFile() || l.size !== a.bytes || (await sha256DoArquivo(join(pasta, a.nome))) !== a.sha256) return { ok: false, motivo: "corrompido" };
    } catch {
      return { ok: false, motivo: "corrompido" };
    }
  }
  // arquivos conferidos: renova mtime e data na marca (a verificação rápida seguinte passa)
  const novos = { ...m, verificado_em: agora().toISOString(), arquivos: await Promise.all(m.arquivos.map(async (a) => ({ ...a, mtime_ms: (await lstat(join(pasta, a.nome))).mtimeMs }))) };
  await gravarManifesto(pasta, novos);
  return { ok: true, manifesto: novos };
}

/** bytes que o modelo ocupa (soma dos arquivos do catálogo presentes). */
export async function bytesEmDisco(pastaModelos: string, modelo: ModeloCatalogo): Promise<number | null> {
  try {
    let total = 0;
    for (const a of modelo.arquivos) total += (await lstat(join(pastaModelos, modelo.id, a.nome))).size;
    return total;
  } catch {
    return null;
  }
}

/** ids (pastas de nível único, sem ponto inicial) presentes na pasta de modelos. */
export async function pastasInstaladas(pastaModelos: string): Promise<string[]> {
  try {
    const itens = await readdir(pastaModelos, { withFileTypes: true });
    return itens.filter((i) => i.isDirectory() && !i.name.startsWith(".")).map((i) => i.name);
  } catch {
    return [];
  }
}

export async function apagarPasta(pastaModelos: string, modeloId: string): Promise<void> {
  await rm(join(pastaModelos, modeloId), { recursive: true, force: true });
}
