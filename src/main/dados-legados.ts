// Migração de dados de um nome anterior do produto (Fase 21, T-21.04, D-341, AU-18).
// Quando `idDados` muda (o dono pediu `--migrar-dados`), o primeiro boot COPIA o `userData` de um id de
// `idsAnteriores` para a pasta nova. Regras: nunca apaga o antigo (é o backup); atômica (pasta temporária +
// rename); idempotente (marcador no destino); falha mantém o antigo e não cria o destino; o cofre do SO só vai junto se o
// item do chaveiro for alcançável, senão sinaliza `reconfigurar_cofre` e o banco migra mesmo assim.
// Sem Electron aqui: raiz, `safeStorage` e a cópia de arquivo entram por injeção. Sem rede, sem segredo em log.
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MARCADOR_MIGRACAO = ".migracao-dados.json";
const ARQUIVO_COFRE = "cofre.json";
const ID_VALIDO = /^[a-z][a-z0-9]{2,23}$/;
const IGNORADOS = /^Singleton/;

export type AvisoMigracao = "reconfigurar_cofre";

export interface SafeStorageMinimo {
  isEncryptionAvailable(): boolean;
  decryptString(dados: Uint8Array): string;
}

export interface DependenciasMigracaoDados {
  /** pasta que contém as pastas de dados de cada id (`app.getPath("appData")`). */
  raizDados: string;
  idDados: string;
  idsAnteriores: readonly string[];
  safeStorage?: SafeStorageMinimo;
  /** substituível em teste para simular falha; padrão `fs.copyFile`. */
  copiarArquivo?: (de: string, para: string) => Promise<void>;
  agora?: () => Date;
}

export interface ResultadoMigracao {
  estado: "nada_a_migrar" | "migrado" | "ja_migrado" | "destino_existente" | "falhou";
  /** id (nunca caminho) da pasta de onde veio a cópia. */
  origem?: string;
  avisos: AvisoMigracao[];
  /** código nominal da falha (sem caminho). */
  motivo?: string;
}

async function ehPasta(caminho: string): Promise<boolean> {
  try {
    return (await lstat(caminho)).isDirectory();
  } catch {
    return false;
  }
}

async function copiarArvore(de: string, para: string, copiar: (a: string, b: string) => Promise<void>): Promise<void> {
  await mkdir(para, { recursive: true });
  for (const e of await readdir(de, { withFileTypes: true })) {
    if (IGNORADOS.test(e.name)) continue;
    const origem = join(de, e.name);
    const destino = join(para, e.name);
    if (e.isDirectory()) await copiarArvore(origem, destino, copiar);
    else if (e.isFile()) await copiar(origem, destino); // symlink, socket e afins não migram
  }
}

/** O item do chaveiro do cofre é alcançável a partir deste app? Cofre ausente, vazio ou com senha-mestra: sim (nada do SO). */
async function cofreAlcancavel(arquivo: string, ss: SafeStorageMinimo | undefined): Promise<boolean> {
  let j: { motor?: unknown; entradas?: unknown };
  try {
    j = JSON.parse(await readFile(arquivo, "utf8")) as typeof j;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
  if (j.motor !== "safe_storage") return true;
  const entradas = Array.isArray(j.entradas) ? (j.entradas as Array<{ cifrado_b64?: unknown }>) : [];
  const amostra = entradas.find((x) => typeof x.cifrado_b64 === "string");
  if (amostra === undefined) return true;
  try {
    if (ss === undefined || !ss.isEncryptionAvailable()) return false;
    ss.decryptString(Buffer.from(amostra.cifrado_b64 as string, "base64"));
    return true;
  } catch {
    return false;
  }
}

async function lerMarcador(dir: string): Promise<{ origem?: string; avisos: AvisoMigracao[] } | null> {
  try {
    const j = JSON.parse(await readFile(join(dir, MARCADOR_MIGRACAO), "utf8")) as { origem?: unknown; avisos?: unknown };
    const avisos = Array.isArray(j.avisos) ? (j.avisos.filter((a) => a === "reconfigurar_cofre") as AvisoMigracao[]) : [];
    return typeof j.origem === "string" ? { origem: j.origem, avisos } : { avisos };
  } catch {
    return null;
  }
}

export async function migrarDadosLegados(d: DependenciasMigracaoDados): Promise<ResultadoMigracao> {
  if (!ID_VALIDO.test(d.idDados)) return { estado: "falhou", avisos: [], motivo: "id_invalido" };
  const destino = join(d.raizDados, d.idDados);
  let destinoExiste = false;

  if (await ehPasta(destino)) {
    const marcador = await lerMarcador(destino);
    if (marcador !== null) return { estado: "ja_migrado", ...(marcador.origem === undefined ? {} : { origem: marcador.origem }), avisos: marcador.avisos };
    destinoExiste = true;
  }

  let origemId: string | null = null;
  for (const id of d.idsAnteriores) {
    if (!ID_VALIDO.test(id) || id === d.idDados) continue;
    if (await ehPasta(join(d.raizDados, id))) {
      origemId = id;
      break;
    }
  }
  if (origemId === null) return { estado: "nada_a_migrar", avisos: [] };
  if (destinoExiste) return { estado: "destino_existente", avisos: [] };

  const temporaria = join(d.raizDados, `.${d.idDados}.migrando-${process.pid}-${Date.now().toString(36)}`);
  const avisos: AvisoMigracao[] = [];
  try {
    await copiarArvore(join(d.raizDados, origemId), temporaria, d.copiarArquivo ?? copyFile);
    const cofre = join(temporaria, ARQUIVO_COFRE);
    if (!(await cofreAlcancavel(cofre, d.safeStorage))) {
      await rm(cofre, { force: true });
      avisos.push("reconfigurar_cofre");
    }
    const quando = (d.agora ?? (() => new Date()))().toISOString();
    await writeFile(join(temporaria, MARCADOR_MIGRACAO), JSON.stringify({ versao: 1, origem: origemId, em: quando, avisos }, null, 2));
    await rename(temporaria, destino);
  } catch {
    await rm(temporaria, { recursive: true, force: true }).catch(() => undefined);
    return { estado: "falhou", origem: origemId, avisos: [], motivo: "copia_falhou" };
  }
  return { estado: "migrado", origem: origemId, avisos };
}
