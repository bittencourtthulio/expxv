// Formato em disco das squads (Fase 14, T-14.02; D-201). `squad.json` (sem texto de prompt) + `membros/<slug>.md`
// (frontmatter mínimo + corpo = prompt). Arquivos são a fonte da verdade: legíveis, versionáveis, editáveis fora do app.
// Escrita atômica (temporário + rename, 0600/0700); leitura nunca segue symlink e nunca sai da pasta da squad.
// Sem Electron; só `fs` com diretórios INJETADOS pelo chamador.
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import type { Faixa, Membro, OrcamentoSquad, OrigemSquad, PapelSquad, Squad } from "./tipos";
import { PADRAO_SLUG, SCHEMA_VERSION, caminhoPromptDe } from "./tipos";
import type { SquadNoDisco } from "./tipos";

export type CodigoFormato = "json_invalido" | "campo_invalido" | "versao_ausente" | "caminho_inseguro" | "frontmatter_invalido" | "arquivo_invalido";

export class FormatoInvalidoError extends Error {
  constructor(
    public readonly codigo: CodigoFormato,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "FormatoInvalidoError";
  }
}
/** Arquivo gravado por uma versão MAIS NOVA do app: nunca é lido "no escuro" (poderia perder campos ao regravar). */
export class VersaoMaiorError extends Error {
  constructor(
    public readonly versao: number,
    onde: string,
  ) {
    super(`${onde}: schema_version ${versao} é maior que a suportada (${SCHEMA_VERSION}); atualize o aplicativo`);
    this.name = "VersaoMaiorError";
  }
}

const LIMITE_SQUAD_JSON = 256 * 1024;
const LIMITE_MD_LEITURA = 64 * 1024;

export const sha256 = (dado: string | Uint8Array): string => createHash("sha256").update(dado).digest("hex");

/** Hash do conjunto: independe da ordem das chaves; muda com qualquer arquivo ou caminho. */
export function hashDoConjunto(arquivos: Record<string, string>): string {
  const h = createHash("sha256");
  for (const caminho of Object.keys(arquivos).sort()) h.update(`${caminho}\0${arquivos[caminho]}\n`);
  return h.digest("hex");
}

/** Caminho RELATIVO, em `/`, sem `..`, sem segmento vazio ou `.`, sem NUL, barra invertida, unidade de disco ou raiz. Devolve-o normalizado. */
export function caminhoSeguro(rel: string): string {
  const ruim = (): never => {
    throw new FormatoInvalidoError("caminho_inseguro", `caminho inseguro ou fora da pasta da squad: ${JSON.stringify(rel.slice(0, 80))}`);
  };
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 200) return ruim();
  if (rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.startsWith("~")) return ruim();
  const partes = rel.split("/");
  if (partes.some((p) => p === "" || p === "." || p === "..")) return ruim();
  return partes.join("/");
}

// ---------- squad.json ----------

const CHAVES_SQUAD = new Set(["schema_version", "slug", "nome", "descricao", "escopo", "rigidez_padrao", "max_instancias_paralelas", "orcamento", "portoes", "fabrica", "origem", "membros"]);
const CHAVES_MEMBRO = new Set(["slug", "papel", "rotulo", "descricao", "prompt", "perfil", "skills_permitidas", "mcps_permitidos", "hooks", "max_instancias", "orcamento", "rigidez", "permissao"]);
const CHAVES_PERFIL = new Set(["cli", "modelo", "esforco", "faixa"]);
const CHAVES_ORCAMENTO = new Set(["tempo_min", "tokens", "modo"]);
const CHAVES_FABRICA = new Set(["id", "versao"]);

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const invalido = (caminho: string, esperado: string): never => {
  throw new FormatoInvalidoError("campo_invalido", `campo ${caminho}: esperado ${esperado}`);
};

function extras(o: Obj, conhecidas: Set<string>, caminho: string, avisos: string[]): void {
  for (const k of Object.keys(o)) if (!conhecidas.has(k)) avisos.push(`campo desconhecido ignorado: ${caminho === "" ? k : `${caminho}.${k}`}`);
}
const texto = (o: Obj, k: string, caminho: string, padrao?: string): string => {
  const v = o[k];
  if (v === undefined && padrao !== undefined) return padrao;
  return typeof v === "string" ? v : invalido(`${caminho}${k}`, "texto");
};
const numOuNulo = (o: Obj, k: string, caminho: string): number | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : invalido(`${caminho}${k}`, "número ou null");
};
const textoOuNulo = (o: Obj, k: string, caminho: string): string | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : invalido(`${caminho}${k}`, "texto ou null");
};
const listaTexto = (o: Obj, k: string, caminho: string): string[] => {
  const v = o[k];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return invalido(`${caminho}${k}`, "lista de textos");
  return v as string[];
};

function lerOrcamento(v: unknown, caminho: string, avisos: string[]): OrcamentoSquad {
  if (v === undefined || v === null) return { tempo_min: null, tokens: null, modo: "soft" };
  if (!ehObj(v)) return invalido(caminho, "objeto");
  extras(v, CHAVES_ORCAMENTO, caminho, avisos);
  const modo = v["modo"] === undefined ? "soft" : v["modo"];
  if (modo !== "soft" && modo !== "rigido") return invalido(`${caminho}.modo`, '"soft" ou "rigido"');
  return { tempo_min: numOuNulo(v, "tempo_min", `${caminho}.`), tokens: numOuNulo(v, "tokens", `${caminho}.`), modo };
}

function lerMembro(v: unknown, i: number, avisos: string[]): Membro {
  const c = `membros[${i}]`;
  if (!ehObj(v)) return invalido(c, "objeto");
  extras(v, CHAVES_MEMBRO, c, avisos);
  const slug = texto(v, "slug", `${c}.`);
  const prompt = v["prompt"] === undefined ? caminhoPromptDe(slug) : texto(v, "prompt", `${c}.`);
  const seguro = caminhoSeguro(prompt);
  if (!seguro.startsWith("membros/") || !seguro.endsWith(".md") || seguro.split("/").length !== 2) {
    throw new FormatoInvalidoError("caminho_inseguro", `${c}.prompt: o caminho do prompt precisa ser membros/<arquivo>.md (recebido ${JSON.stringify(prompt.slice(0, 60))})`);
  }
  const p = v["perfil"];
  if (!ehObj(p)) return invalido(`${c}.perfil`, "objeto");
  extras(p, CHAVES_PERFIL, `${c}.perfil`, avisos);
  const rigidez = numOuNulo(v, "rigidez", `${c}.`);
  return {
    slug,
    papel: texto(v, "papel", `${c}.`) as PapelSquad,
    rotulo: texto(v, "rotulo", `${c}.`),
    descricao: texto(v, "descricao", `${c}.`, ""),
    prompt: seguro,
    perfil: { cli: texto(p, "cli", `${c}.perfil.`), modelo: textoOuNulo(p, "modelo", `${c}.perfil.`), esforco: textoOuNulo(p, "esforco", `${c}.perfil.`), faixa: texto(p, "faixa", `${c}.perfil.`) as Faixa },
    skills_permitidas: listaTexto(v, "skills_permitidas", `${c}.`),
    mcps_permitidos: listaTexto(v, "mcps_permitidos", `${c}.`),
    hooks: listaTexto(v, "hooks", `${c}.`),
    max_instancias: numOuNulo(v, "max_instancias", `${c}.`) ?? 1,
    orcamento: lerOrcamento(v["orcamento"], `${c}.orcamento`, avisos),
    rigidez: rigidez as Membro["rigidez"],
    permissao: textoOuNulo(v, "permissao", `${c}.`) as Membro["permissao"],
  };
}

/** Texto de `squad.json` → `Squad`. `origem` vem do LOCAL (fábrica/usuário); só `importada` é guardada no arquivo. */
export function interpretarSquad(bruto: string, origem: OrigemSquad): { squad: Squad; avisos: string[] } {
  let o: unknown;
  try {
    o = JSON.parse(bruto);
  } catch {
    throw new FormatoInvalidoError("json_invalido", "squad.json não é um JSON válido");
  }
  if (!ehObj(o)) return invalido("squad.json", "objeto");
  const avisos: string[] = [];
  const versao = o["schema_version"];
  if (versao === undefined) throw new FormatoInvalidoError("versao_ausente", "squad.json sem schema_version");
  if (typeof versao !== "number" || !Number.isInteger(versao) || versao < 1) return invalido("schema_version", "inteiro ≥ 1");
  if (versao > SCHEMA_VERSION) throw new VersaoMaiorError(versao, "squad.json");
  extras(o, CHAVES_SQUAD, "", avisos);
  if (!Array.isArray(o["membros"])) return invalido("membros", "lista");
  let fabrica: Squad["fabrica"] = null;
  const f = o["fabrica"];
  if (f !== undefined && f !== null) {
    if (!ehObj(f)) return invalido("fabrica", "objeto ou null");
    extras(f, CHAVES_FABRICA, "fabrica", avisos);
    const v = numOuNulo(f, "versao", "fabrica.");
    fabrica = { id: texto(f, "id", "fabrica."), versao: v ?? 1 };
  }
  const portoes = o["portoes"];
  if (portoes !== undefined && portoes !== null && (!Array.isArray(portoes) || portoes.some((p) => typeof p !== "string"))) return invalido("portoes", "lista de textos ou null");
  return {
    squad: {
      slug: texto(o, "slug", ""),
      nome: texto(o, "nome", ""),
      descricao: texto(o, "descricao", "", ""),
      escopo: texto(o, "escopo", "", "outro") as Squad["escopo"],
      rigidez_padrao: numOuNulo(o, "rigidez_padrao", "") as Squad["rigidez_padrao"],
      max_instancias_paralelas: numOuNulo(o, "max_instancias_paralelas", "") ?? 4,
      orcamento: lerOrcamento(o["orcamento"], "orcamento", avisos),
      portoes: (portoes ?? null) as Squad["portoes"],
      fabrica,
      origem: origem === "fabrica" ? "fabrica" : o["origem"] === "importada" ? "importada" : "usuario",
      membros: (o["membros"] as unknown[]).map((m, i) => lerMembro(m, i, avisos)),
    },
    avisos,
  };
}

/** `Squad` → texto de `squad.json` (ordem de chaves fixa: o hash é estável). O texto do prompt nunca entra aqui. */
export function serializarSquad(s: Squad): string {
  const orc = (o: OrcamentoSquad): OrcamentoSquad => ({ tempo_min: o.tempo_min, tokens: o.tokens, modo: o.modo });
  const obj: Obj = {
    schema_version: SCHEMA_VERSION,
    slug: s.slug,
    nome: s.nome,
    descricao: s.descricao,
    escopo: s.escopo,
    rigidez_padrao: s.rigidez_padrao,
    max_instancias_paralelas: s.max_instancias_paralelas,
    orcamento: orc(s.orcamento),
    portoes: s.portoes,
    fabrica: s.fabrica === null ? null : { id: s.fabrica.id, versao: s.fabrica.versao },
    ...(s.origem === "importada" ? { origem: "importada" } : {}),
    membros: s.membros.map((m) => ({
      slug: m.slug,
      papel: m.papel,
      rotulo: m.rotulo,
      descricao: m.descricao,
      prompt: caminhoPromptDe(m.slug),
      perfil: { cli: m.perfil.cli, modelo: m.perfil.modelo, esforco: m.perfil.esforco, faixa: m.perfil.faixa },
      skills_permitidas: [...m.skills_permitidas],
      mcps_permitidos: [...m.mcps_permitidos],
      hooks: [...m.hooks],
      max_instancias: m.max_instancias,
      orcamento: orc(m.orcamento),
      rigidez: m.rigidez,
      permissao: m.permissao,
    })),
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

// ---------- membros/<slug>.md ----------

export interface MembroMd {
  papel: string | null;
  rotulo: string | null;
  corpo: string;
  avisos: string[];
}

export function serializarMembroMd(m: { papel: PapelSquad; rotulo: string }, corpo: string): string {
  return `---\nschema_version: ${SCHEMA_VERSION}\npapel: ${m.papel}\nrotulo: ${JSON.stringify(m.rotulo)}\n---\n${corpo}`;
}

export function interpretarMembroMd(bruto: string): MembroMd {
  if (bruto.includes("\0")) throw new FormatoInvalidoError("arquivo_invalido", "arquivo de prompt binário (contém NUL)");
  if (!/^---\r?\n/.test(bruto)) return { papel: null, rotulo: null, corpo: bruto, avisos: ["prompt sem frontmatter: tratado como texto puro"] };
  const resto = bruto.replace(/^---\r?\n/, "");
  const fecho = /(^|\n)---[ \t]*(\r?\n|$)/.exec(resto);
  if (fecho === null) throw new FormatoInvalidoError("frontmatter_invalido", "frontmatter do prompt não foi fechado (arquivo truncado?)");
  const cabecalho = resto.slice(0, fecho.index);
  const corpo = resto.slice(fecho.index + fecho[0].length);
  const avisos: string[] = [];
  const campos = new Map<string, string>();
  for (const linha of cabecalho.split("\n")) {
    const l = linha.replace(/\r$/, "");
    if (l.trim() === "") continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(l);
    if (m === null) {
      avisos.push(`linha de frontmatter ignorada: ${l.slice(0, 40)}`);
      continue;
    }
    let valor = (m[2] ?? "").trim();
    if (valor.startsWith('"')) {
      try {
        valor = String(JSON.parse(valor));
      } catch {
        avisos.push(`valor ilegível em ${m[1]}`);
      }
    }
    campos.set(m[1] ?? "", valor);
  }
  const v = campos.get("schema_version");
  if (v === undefined) avisos.push("frontmatter sem schema_version: assumido 1");
  else if (!/^\d+$/.test(v)) throw new FormatoInvalidoError("frontmatter_invalido", "schema_version do prompt inválido");
  else if (Number(v) > SCHEMA_VERSION) throw new VersaoMaiorError(Number(v), "frontmatter do prompt");
  for (const k of campos.keys()) if (k !== "schema_version" && k !== "papel" && k !== "rotulo") avisos.push(`campo desconhecido ignorado no frontmatter: ${k}`);
  return { papel: campos.get("papel") ?? null, rotulo: campos.get("rotulo") ?? null, corpo, avisos };
}

// ---------- diretório ----------

async function lstatOuNulo(caminho: string): Promise<Stats | null> {
  try {
    return await lstat(caminho);
  } catch {
    return null;
  }
}

/** Lê a pasta de UMA squad. Nunca segue symlink; arquivo ruim vira aviso (o índice não cai); `squad.json` ruim lança. */
export async function lerSquadDoDiretorio(dir: string, origem: OrigemSquad): Promise<SquadNoDisco> {
  const st = await lstatOuNulo(dir);
  if (st === null || !st.isDirectory()) throw new FormatoInvalidoError("arquivo_invalido", "pasta da squad ausente ou symlink");
  const caminhoJson = join(dir, "squad.json");
  const sj = await lstatOuNulo(caminhoJson);
  if (sj === null) throw new FormatoInvalidoError("arquivo_invalido", "squad.json ausente");
  if (sj.isSymbolicLink() || !sj.isFile()) throw new FormatoInvalidoError("caminho_inseguro", "squad.json é symlink ou não é arquivo");
  if (sj.size > LIMITE_SQUAD_JSON) throw new FormatoInvalidoError("arquivo_invalido", "squad.json grande demais");
  const textoJson = await readFile(caminhoJson, "utf8");
  const { squad, avisos } = interpretarSquad(textoJson, origem);
  const arquivos: Record<string, string> = { "squad.json": sha256(textoJson) };
  const prompts: Record<string, string> = {};

  const pastaMembros = await lstatOuNulo(join(dir, "membros"));
  if (pastaMembros !== null && (pastaMembros.isSymbolicLink() || !pastaMembros.isDirectory())) {
    throw new FormatoInvalidoError("caminho_inseguro", "membros/ é symlink ou não é pasta");
  }
  await Promise.all(
    squad.membros.map(async (m) => {
      prompts[m.slug] = "";
      const aviso = (msg: string): void => void avisos.push(`membros/${m.slug}: ${msg}`);
      if (pastaMembros === null) return aviso("pasta membros/ ausente");
      const alvo = join(dir, m.prompt);
      const info = await lstatOuNulo(alvo);
      if (info === null) return aviso("arquivo de prompt ausente");
      if (info.isSymbolicLink() || !info.isFile()) return aviso("symlink ou não é arquivo: recusado");
      if (info.size > LIMITE_MD_LEITURA) return aviso("arquivo de prompt grande demais: não lido");
      const buf = await readFile(alvo);
      arquivos[m.prompt] = sha256(buf);
      let conteudo: string;
      try {
        conteudo = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        return aviso("arquivo de prompt não é UTF-8 válido");
      }
      try {
        const md = interpretarMembroMd(conteudo);
        prompts[m.slug] = md.corpo;
        for (const a of md.avisos) aviso(a);
        if (md.papel !== null && md.papel !== m.papel) aviso(`papel do frontmatter (${md.papel}) difere do squad.json (${m.papel}); vale o squad.json`);
      } catch (e) {
        aviso(e instanceof Error ? e.message : "arquivo de prompt inválido");
      }
    }),
  );
  return { squad, prompts, avisos, hash: hashDoConjunto(arquivos), arquivos };
}

async function escreverAtomico(caminho: string, conteudo: string): Promise<string> {
  const tmp = `${caminho}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(tmp, conteudo, { mode: 0o600, flag: "wx" });
    await rename(tmp, caminho);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  return sha256(conteudo);
}

/**
 * Grava a squad na pasta `dir` (cria; sobrescreve). Cada arquivo é atômico; `squad.json` vai POR ÚLTIMO (é o que
 * "confirma" a gravação) e os `.md` de membros que saíram são removidos depois. Exige o texto de TODOS os membros.
 */
export async function gravarSquadNoDiretorio(dir: string, squad: Squad, prompts: Record<string, string>): Promise<{ hash: string; arquivos: Record<string, string> }> {
  const slugs = new Set<string>();
  for (const m of squad.membros) {
    if (!PADRAO_SLUG.test(m.slug)) throw new FormatoInvalidoError("caminho_inseguro", `slug de membro inválido: ${JSON.stringify(m.slug.slice(0, 50))}`);
    if (typeof prompts[m.slug] !== "string") throw new FormatoInvalidoError("campo_invalido", `falta o texto do prompt do membro ${m.slug}`);
    slugs.add(m.slug);
  }
  await mkdir(join(dir, "membros"), { recursive: true, mode: 0o700 });
  const arquivos: Record<string, string> = {};
  await Promise.all(
    squad.membros.map(async (m) => {
      const rel = caminhoPromptDe(m.slug);
      arquivos[rel] = await escreverAtomico(join(dir, rel), serializarMembroMd(m, prompts[m.slug] ?? ""));
    }),
  );
  arquivos["squad.json"] = await escreverAtomico(join(dir, "squad.json"), serializarSquad(squad));
  for (const nome of await readdir(join(dir, "membros"))) {
    if (nome.endsWith(".md") && !slugs.has(nome.slice(0, -3))) await unlink(join(dir, "membros", nome)).catch(() => undefined);
  }
  return { hash: hashDoConjunto(arquivos), arquivos };
}
