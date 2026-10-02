import type { SubtipoExterno } from "../tipos";

// Dependências externas e licenças (T-17.28). Declaradas × usadas, versão EXATA do lock, dev × prod e licença lida LOCALMENTE
// e somente leitura (`node_modules/<p>/package.json`, `vendor/composer/installed.json`, `*.dist-info/METADATA`). Nenhum acesso à rede.
// O módulo é puro: quem lê o disco é o `LeitorProjeto` injetado. Os selos de copyleft são INFORMATIVOS (não são parecer jurídico).

export interface LeitorProjeto {
  /** Texto do arquivo (caminho relativo à raiz) ou `null` se não existir/ilegível. */
  ler(caminho: string): string | null;
  /** Nomes de entrada de uma pasta (relativa à raiz); vazio se não existir. */
  listar(pasta: string): string[];
}

export interface DependenciaDeclarada {
  eco: SubtipoExterno;
  nome: string;
  /** Faixa/versão como declarada no manifesto. */
  versao_declarada?: string | null;
  dev: boolean;
  arquivo: string;
  linha: number;
}

export type SeloCopyleft = "copyleft_forte" | "copyleft_fraco" | null;

export interface ExternaAnalisada {
  id: string;
  eco: SubtipoExterno;
  nome: string;
  /** Versão exata do lock; senão a declarada; senão `null`. */
  versao: string | null;
  versao_fonte: "lock" | "declarada" | null;
  declarado: boolean;
  usado: boolean;
  dev: boolean;
  /** Expressão SPDX normalizada, ou `desconhecida`. */
  licenca: string;
  licenca_fonte: string | null;
  selo: SeloCopyleft;
  /** Onde foi declarada (`arquivo:linha`). */
  declarada_em: string | null;
}

export interface ResultadoExternas {
  externas: ExternaAnalisada[];
  declaradas_nao_usadas: string[];
  usadas_nao_declaradas: string[];
  /** Contagem por selo, para o resumo. */
  copyleft: { forte: number; fraco: number; desconhecida: number };
  aviso: string;
}

export const AVISO_LICENCAS = "informativo: selos de copyleft não são parecer jurídico; licença lida localmente, sem rede";

// ---------------------------------------------------------------------------------------------
// SPDX

const ALIAS: ReadonlyArray<[RegExp, string]> = [
  [/^(the )?mit( license)?$/i, "MIT"],
  [/^apache([ -]license)?[ ,-]*(version )?2(\.0)?$/i, "Apache-2.0"],
  [/^apache-2\.0$/i, "Apache-2.0"],
  [/^isc( license)?$/i, "ISC"],
  [/^bsd[ -]?3([ -]clause)?( license)?$/i, "BSD-3-Clause"],
  [/^bsd[ -]?2([ -]clause)?( license)?$/i, "BSD-2-Clause"],
  [/^(new |revised |modified )?bsd( license)?$/i, "BSD-3-Clause"],
  [/^unlicense$/i, "Unlicense"],
  [/^(mpl|mozilla public license)[ -]*v?2(\.0)?$/i, "MPL-2.0"],
  [/^lgpl[ -]?v?3(\.0)?([+]|[ -]or[ -]later)?$/i, "LGPL-3.0-or-later"],
  [/^lgpl[ -]?v?2\.1([+]|[ -]or[ -]later)?$/i, "LGPL-2.1-or-later"],
  [/^agpl[ -]?v?3(\.0)?([+]|[ -]or[ -]later)?$/i, "AGPL-3.0-or-later"],
  [/^gpl[ -]?v?3(\.0)?([+]|[ -]or[ -]later)?$/i, "GPL-3.0-or-later"],
  [/^gpl[ -]?v?2(\.0)?([+]|[ -]or[ -]later)?$/i, "GPL-2.0-or-later"],
  [/^(cc0|cc0-1\.0|public domain)$/i, "CC0-1.0"],
  [/^0bsd$/i, "0BSD"],
];

/** Normaliza um identificador simples (sem operadores). Mantém o que já parece SPDX. */
export function normalizarIdSpdx(bruto: string): string {
  const t = bruto.trim().replace(/^["'(]+|["')]+$/g, "");
  for (const [re, spdx] of ALIAS) if (re.test(t)) return spdx;
  return t;
}

type ExprSpdx = { op: "id"; id: string } | { op: "or" | "and"; esq: ExprSpdx; dir: ExprSpdx };

function tokens(s: string): string[] {
  return s.match(/\(|\)|[^\s()]+/g) ?? [];
}

/** Parser mínimo de expressão SPDX: `A OR B`, `A AND B`, `A WITH exc`, parênteses. */
function parseExpr(toks: string[]): ExprSpdx | null {
  let i = 0;
  const atomo = (): ExprSpdx | null => {
    const t = toks[i];
    if (t === undefined) return null;
    if (t === "(") {
      i++;
      const e = ou();
      if (toks[i] === ")") i++;
      return e;
    }
    i++;
    let id = t;
    if ((toks[i] ?? "").toUpperCase() === "WITH") {
      id += ` WITH ${toks[i + 1] ?? ""}`;
      i += 2;
    }
    return { op: "id", id: normalizarIdSpdx(id) };
  };
  const e1 = (): ExprSpdx | null => {
    let esq = atomo();
    while (esq !== null && (toks[i] ?? "").toUpperCase() === "AND") {
      i++;
      const dir = atomo();
      if (dir === null) break;
      esq = { op: "and", esq, dir };
    }
    return esq;
  };
  const ou = (): ExprSpdx | null => {
    let esq = e1();
    while (esq !== null && (toks[i] ?? "").toUpperCase() === "OR") {
      i++;
      const dir = e1();
      if (dir === null) break;
      esq = { op: "or", esq, dir };
    }
    return esq;
  };
  return ou();
}

function render(e: ExprSpdx, pai?: "or" | "and"): string {
  if (e.op === "id") return e.id;
  const txt = `${render(e.esq, e.op)} ${e.op.toUpperCase()} ${render(e.dir, e.op)}`;
  return pai !== undefined && pai !== e.op ? `(${txt})` : txt;
}

const PESO_SELO: Record<Exclude<SeloCopyleft, null> | "nenhum", number> = { nenhum: 0, copyleft_fraco: 1, copyleft_forte: 2 };

function seloDeId(id: string): Exclude<SeloCopyleft, null> | "nenhum" {
  const u = id.toUpperCase();
  if (/^(A?GPL)-/.test(u) && !/WITH /.test(u)) return "copyleft_forte";
  if (/^A?GPL-.*WITH /.test(u)) return "copyleft_fraco"; // exceção de linking (ex.: GPL-2.0 WITH Classpath-exception-2.0)
  if (/^(LGPL|MPL|EPL|CDDL|EUPL|OSL)-/.test(u)) return "copyleft_fraco";
  return "nenhum";
}

function seloDeExpr(e: ExprSpdx): Exclude<SeloCopyleft, null> | "nenhum" {
  if (e.op === "id") return seloDeId(e.id);
  const a = seloDeExpr(e.esq);
  const b = seloDeExpr(e.dir);
  // OR: o licenciado escolhe a alternativa mais branda; AND: vale a mais restritiva
  return e.op === "or" ? (PESO_SELO[a] <= PESO_SELO[b] ? a : b) : PESO_SELO[a] >= PESO_SELO[b] ? a : b;
}

/** Normaliza uma expressão SPDX (ou texto livre) e calcula o selo informativo. */
export function analisarLicenca(bruto: string | null | undefined): { licenca: string; selo: SeloCopyleft } {
  const t = (bruto ?? "").trim();
  if (t === "" || /^(unknown|see license|proprietary|unlicensed)/i.test(t) || /^see license in/i.test(t)) return { licenca: "desconhecida", selo: null };
  // texto livre sem operadores ("The MIT License", "Apache License 2.0") é UM identificador
  if (!/\b(OR|AND|WITH)\b/.test(t) && !/[()]/.test(t)) {
    const id = normalizarIdSpdx(t);
    const sel = seloDeId(id);
    return { licenca: id, selo: sel === "nenhum" ? null : sel };
  }
  const e = parseExpr(tokens(t));
  if (e === null) return { licenca: "desconhecida", selo: null };
  const s = seloDeExpr(e);
  return { licenca: render(e), selo: s === "nenhum" ? null : s };
}

// ---------------------------------------------------------------------------------------------
// Leitura local de licenças

function licencaDePackageJson(texto: string): { versao: string | null; licenca: string | null } {
  try {
    const j = JSON.parse(texto) as { version?: string; license?: unknown; licenses?: unknown };
    let lic: string | null = null;
    if (typeof j.license === "string") lic = j.license;
    else if (typeof j.license === "object" && j.license !== null && typeof (j.license as { type?: unknown }).type === "string") lic = (j.license as { type: string }).type;
    else if (Array.isArray(j.licenses)) lic = j.licenses.map((l) => (typeof l === "string" ? l : String((l as { type?: unknown }).type ?? ""))).filter((x) => x !== "").join(" OR ") || null;
    return { versao: typeof j.version === "string" ? j.version : null, licenca: lic };
  } catch {
    return { versao: null, licenca: null };
  }
}

function composerInstalado(texto: string): Map<string, { versao: string | null; licenca: string | null }> {
  const saida = new Map<string, { versao: string | null; licenca: string | null }>();
  try {
    const j = JSON.parse(texto) as { packages?: Array<{ name?: string; version?: string; license?: string[] | string }> } | Array<{ name?: string; version?: string; license?: string[] | string }>;
    const lista = Array.isArray(j) ? j : (j.packages ?? []);
    for (const p of lista) {
      if (typeof p.name !== "string") continue;
      const lic = Array.isArray(p.license) ? p.license.join(" OR ") : (p.license ?? null);
      saida.set(p.name.toLowerCase(), { versao: p.version?.replace(/^v/, "") ?? null, licenca: lic });
    }
  } catch {
    // arquivo malformado: sem licenças (desconhecida)
  }
  return saida;
}

function licencaDeMetadata(texto: string): { versao: string | null; licenca: string | null } {
  const cab = texto.split(/\r?\n\r?\n/)[0] ?? "";
  const pega = (k: string): string | null => new RegExp(`^${k}:\\s*(.+)$`, "mi").exec(cab)?.[1]?.trim() ?? null;
  const expr = pega("License-Expression");
  if (expr !== null) return { versao: pega("Version"), licenca: expr };
  const classif = [...cab.matchAll(/^Classifier:\s*License\s*::\s*(?:OSI Approved\s*::\s*)?(.+)$/gm)].map((m) => (m[1] as string).trim());
  const lic = pega("License");
  return { versao: pega("Version"), licenca: classif.length > 0 ? classif.join(" OR ") : lic !== null && lic.length < 80 ? lic : null };
}

const norm = (n: string): string => n.toLowerCase().replace(/[-_.]+/g, "-");

export interface OpcoesExternas {
  declaradas: readonly DependenciaDeclarada[];
  /** Ids `ext:<eco>:<nome>` alcançados por arestas `importa` (com repetição ou não). */
  usados: Iterable<string>;
  /** Versão exata dos locks: chave `eco:nome` (nome normalizado pelo chamador como declarado). */
  locks?: ReadonlyMap<string, string>;
  leitor?: LeitorProjeto;
  /** Pastas `site-packages` (relativas) para ler `*.dist-info/METADATA`. */
  pastasSitePackages?: readonly string[];
}

const ECO_SEM_DECLARACAO = new Set<string>(["stdlib", "builtin", "sistema"]);

export function analisarExternas(op: OpcoesExternas): ResultadoExternas {
  const usados = new Set<string>();
  for (const u of op.usados) usados.add(u);
  const porId = new Map<string, DependenciaDeclarada>();
  for (const d of op.declaradas) {
    const id = `ext:${d.eco}:${d.nome}`;
    const atual = porId.get(id);
    if (atual === undefined || (atual.dev && !d.dev)) porId.set(id, d); // prod prevalece sobre dev
  }
  const composer = op.leitor === undefined ? null : composerInstalado(op.leitor.ler("vendor/composer/installed.json") ?? "");
  const pythonMeta = new Map<string, { versao: string | null; licenca: string | null; fonte: string }>();
  if (op.leitor !== undefined) {
    for (const pasta of op.pastasSitePackages ?? []) {
      for (const e of op.leitor.listar(pasta)) {
        const m = /^(.+?)-(\d[^-]*)\.dist-info$/.exec(e);
        if (m === null) continue;
        const txt = op.leitor.ler(`${pasta}/${e}/METADATA`);
        if (txt !== null) pythonMeta.set(norm(m[1] as string), { ...licencaDeMetadata(txt), fonte: `${pasta}/${e}/METADATA` });
      }
    }
  }
  const todos = new Set<string>([...porId.keys(), ...[...usados].filter((u) => !ECO_SEM_DECLARACAO.has(u.split(":")[1] ?? ""))]);
  const externas: ExternaAnalisada[] = [];
  for (const id of todos) {
    const [, eco, ...resto] = id.split(":");
    const nome = resto.join(":");
    const d = porId.get(id);
    let versao: string | null = null;
    let versaoFonte: ExternaAnalisada["versao_fonte"] = null;
    const lock = op.locks?.get(`${eco}:${nome}`);
    if (lock !== undefined) {
      versao = lock;
      versaoFonte = "lock";
    } else if (d?.versao_declarada != null) {
      versao = d.versao_declarada;
      versaoFonte = "declarada";
    }
    let licBruta: string | null = null;
    let licFonte: string | null = null;
    if (op.leitor !== undefined) {
      if (eco === "npm") {
        const caminho = `node_modules/${nome}/package.json`;
        const t = op.leitor.ler(caminho);
        if (t !== null) {
          const p = licencaDePackageJson(t);
          licBruta = p.licenca;
          licFonte = caminho;
          if (versaoFonte !== "lock" && p.versao !== null) {
            versao = p.versao;
            versaoFonte = "lock";
          }
        }
      } else if (eco === "composer" && composer !== null) {
        const p = composer.get(nome.toLowerCase());
        if (p !== undefined) {
          licBruta = p.licenca;
          licFonte = "vendor/composer/installed.json";
          if (versaoFonte !== "lock" && p.versao !== null) {
            versao = p.versao;
            versaoFonte = "lock";
          }
        }
      } else if (eco === "pip") {
        const p = pythonMeta.get(norm(nome));
        if (p !== undefined) {
          licBruta = p.licenca;
          licFonte = p.fonte;
        }
      }
    }
    const { licenca, selo } = analisarLicenca(licBruta);
    externas.push({ id, eco: eco as SubtipoExterno, nome, versao, versao_fonte: versaoFonte, declarado: d !== undefined, usado: usados.has(id), dev: d?.dev ?? false, licenca, licenca_fonte: licBruta === null ? null : licFonte, selo, declarada_em: d === undefined ? null : `${d.arquivo}:${d.linha}` });
  }
  externas.sort((a, b) => a.id.localeCompare(b.id));
  return {
    externas,
    declaradas_nao_usadas: externas.filter((e) => e.declarado && !e.usado).map((e) => e.id),
    usadas_nao_declaradas: externas.filter((e) => !e.declarado && e.usado).map((e) => e.id),
    copyleft: { forte: externas.filter((e) => e.selo === "copyleft_forte").length, fraco: externas.filter((e) => e.selo === "copyleft_fraco").length, desconhecida: externas.filter((e) => e.licenca === "desconhecida").length },
    aviso: AVISO_LICENCAS,
  };
}
