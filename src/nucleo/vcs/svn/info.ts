import { isAbsolute, relative } from "node:path";
import { acharBinarioSvn } from "../detectar";
import { caminhoWc, rodarSvn, rodarSvnRede, SvnErro, SvnIndisponivelErro, type OpcoesBaseSvn } from "./comum";
import { documento, filho, filhosDe, textoDe } from "./xml";

// T-06.23: `svn info --xml`, layout (trunk/branches/tags por `svn ls ^/`) e externals.

export interface InfoSvn {
  /** Caminho do alvo (`.` = a própria raiz). */
  caminho: string;
  tipoNo: "file" | "dir" | string;
  /** Raiz absoluta da cópia de trabalho (`wcroot-abspath`); null ao consultar uma URL. */
  raizWc: string | null;
  url: string;
  /** `^/trunk`, `^/branches/x`… */
  urlRelativa: string;
  raizRepositorio: string;
  uuid: string;
  revisao: number;
  ultimaRevisao: number | null;
  ultimoAutor: string | null;
  ultimaData: string | null;
  agendamento: string | null;
  profundidade: string | null;
  bloqueio: { dono: string; token: string; comentario: string | null; data: string | null } | null;
  conflito: boolean;
}

/** Interpreta `svn info --xml`. Devolve uma entrada por alvo; XML sem entrada devolve lista vazia. */
export function parseInfoXml(xml: string): InfoSvn[] {
  const info = documento(xml, "info");
  return filhosDe(info, "entry").map((e) => {
    const repo = filho(e, "repository");
    const wc = filho(e, "wc-info");
    const commit = filho(e, "commit");
    const lock = filho(e, "lock");
    const rev = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
    return {
      caminho: e.attrs.path ?? ".",
      tipoNo: e.attrs.kind ?? "dir",
      raizWc: textoDe(wc, "wcroot-abspath"),
      url: textoDe(e, "url") ?? "",
      urlRelativa: textoDe(e, "relative-url") ?? "",
      raizRepositorio: textoDe(repo, "root") ?? "",
      uuid: textoDe(repo, "uuid") ?? "",
      revisao: rev(e.attrs.revision) ?? 0,
      ultimaRevisao: rev(commit?.attrs.revision),
      ultimoAutor: textoDe(commit, "author"),
      ultimaData: textoDe(commit, "date"),
      agendamento: textoDe(wc, "schedule"),
      profundidade: textoDe(wc, "depth"),
      bloqueio: lock ? { dono: textoDe(lock, "owner") ?? "", token: textoDe(lock, "token") ?? "", comentario: textoDe(lock, "comment"), data: textoDe(lock, "created") } : null,
      conflito: filhosDe(e, "conflict").length > 0,
    };
  });
}

/** `svn` ausente vira instrução (`brew install subversion`). */
export async function garantirSvn(op: OpcoesBaseSvn = {}): Promise<string> {
  if (op.executavel !== undefined) return op.executavel;
  const bin = await acharBinarioSvn(op.env?.PATH ?? process.env.PATH);
  if (bin === null) throw new SvnIndisponivelErro();
  return bin;
}

/** Informações do alvo (padrão: a raiz da cópia). Local (sem rede) para cópia de trabalho. */
export async function infoSvn(raiz: string, op: OpcoesBaseSvn & { alvo?: string } = {}): Promise<InfoSvn> {
  const r = await rodarSvn(raiz, "info", ["--xml"], [op.alvo === undefined ? "." : caminhoWc(op.alvo)], op);
  const i = parseInfoXml(r.stdout)[0];
  if (i === undefined) throw new SvnErro("svn info não devolveu entrada (cópia de trabalho corrompida?)", "svn_falhou", ["info"]);
  return i;
}

// ---- layout --------------------------------------------------------------------------------------

export type TipoLocalSvn = "trunk" | "branch" | "tag" | "outro";

export interface LayoutSvn {
  /** trunk, branches e tags na raiz do repositório. */
  padrao: boolean;
  trunk: string | null;
  branches: string | null;
  tags: string | null;
  /** Entradas da raiz (`svn ls ^/`). */
  naRaiz: string[];
}

/** Interpreta `svn ls` (um nome por linha, diretórios terminam em `/`). */
export function parseLs(texto: string): string[] {
  return texto.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l !== "");
}

export function layoutDeRaiz(naRaiz: readonly string[]): LayoutSvn {
  const tem = (n: string): boolean => naRaiz.includes(`${n}/`);
  const padrao = tem("trunk") && tem("branches") && tem("tags");
  return { padrao, trunk: tem("trunk") ? "trunk" : null, branches: tem("branches") ? "branches" : null, tags: tem("tags") ? "tags" : null, naRaiz: [...naRaiz] };
}

/** Onde a cópia de trabalho está: `^/trunk`, `^/branches/x`, `^/tags/y`. */
export function localAtual(urlRelativa: string): { tipo: TipoLocalSvn; nome: string | null } {
  const p = urlRelativa.replace(/^\^\//, "").split("/");
  if (p[0] === "trunk") return { tipo: "trunk", nome: "trunk" };
  if (p[0] === "branches" && p[1]) return { tipo: "branch", nome: p[1] };
  if (p[0] === "tags" && p[1]) return { tipo: "tag", nome: p[1] };
  return { tipo: "outro", nome: null };
}

export async function layoutSvn(raiz: string, op: OpcoesBaseSvn = {}): Promise<LayoutSvn> {
  const r = await rodarSvnRede(raiz, "ls", [], ["^/"], { ...op, tipo: "leitura" });
  return layoutDeRaiz(parseLs(r.stdout));
}

/** Nomes de branches ou tags (`svn ls ^/branches`). */
export async function listarRamosSvn(raiz: string, tipo: "branches" | "tags", op: OpcoesBaseSvn = {}): Promise<string[]> {
  const r = await rodarSvnRede(raiz, "ls", [], [`^/${tipo}`], { ...op, tipo: "leitura" });
  return parseLs(r.stdout).filter((l) => l.endsWith("/")).map((l) => l.slice(0, -1));
}

// ---- externals -----------------------------------------------------------------------------------

export interface ExternalSvn {
  /** Pasta (relativa à raiz) que carrega a propriedade. */
  em: string;
  /** Diretório destino do external. */
  destino: string;
  url: string;
  revisao: number | null;
  /** Aponta para FORA deste repositório (outro servidor/repositório): o app não o segue sem aviso. */
  foraDoRepositorio: boolean;
}

function tokens(linha: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^\s\\]|\\.)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linha)) !== null) out.push((m[1] ?? m[2] ?? m[3] ?? "").replace(/\\(.)/g, "$1"));
  return out;
}

const pareceUrl = (t: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("^/") || t.startsWith("//") || t.startsWith("/") || t.startsWith("../");

/** Valor de `svn:externals` (formato 1.5+ e antigo) -> lista. `raizRepositorio` decide `foraDoRepositorio`. */
export function parseExternals(valor: string, em: string, raizRepositorio: string): ExternalSvn[] {
  const lista: ExternalSvn[] = [];
  for (const bruta of valor.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (linha === "" || linha.startsWith("#")) continue;
    const t = tokens(linha);
    let revisao: number | null = null;
    const resto: string[] = [];
    for (let i = 0; i < t.length; i++) {
      const x = t[i] as string;
      const rm = /^-r(\d+)$/.exec(x);
      if (rm) revisao = Number(rm[1]);
      else if (x === "-r" && /^\d+$/.test(t[i + 1] ?? "")) revisao = Number(t[++i]);
      else resto.push(x);
    }
    if (resto.length < 2) continue;
    const urlPrimeiro = pareceUrl(resto[0] as string);
    const url = (urlPrimeiro ? resto[0] : resto[resto.length - 1]) as string;
    const destino = (urlPrimeiro ? resto[1] : resto[0]) as string;
    const dentro = url.startsWith("^/") || url.startsWith("../") || (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && raizRepositorio !== "" && (url === raizRepositorio || url.startsWith(`${raizRepositorio}/`)));
    lista.push({ em, destino, url, revisao, foraDoRepositorio: !dentro });
  }
  return lista;
}

/** Todos os `svn:externals` da cópia de trabalho (local, sem rede). */
export async function externalsSvn(raiz: string, op: OpcoesBaseSvn & { raizRepositorio?: string } = {}): Promise<ExternalSvn[]> {
  const r = await rodarSvn(raiz, "propget", ["svn:externals", "-R", "--xml"], ["."], { ...op, tolerar: [1] });
  const info = op.raizRepositorio === undefined ? await infoSvn(raiz, op) : null;
  const repo = op.raizRepositorio ?? (info as InfoSvn).raizRepositorio;
  const props = documento(r.stdout, "properties");
  const lista: ExternalSvn[] = [];
  for (const alvo of filhosDe(props, "target")) {
    const caminho = alvo.attrs.path ?? ".";
    const em = isAbsolute(caminho) ? relative(info?.raizWc ?? raiz, caminho).replace(/\\/g, "/") || "." : caminho;
    for (const p of filhosDe(alvo, "property")) lista.push(...parseExternals(p.texto, em, repo));
  }
  return lista;
}
