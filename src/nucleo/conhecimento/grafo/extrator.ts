// Extrator DETERMINÍSTICO de nós/arestas (T-15.20): caminhos de arquivo citados no texto (resolvidos contra o conjunto conhecido
// de `git ls-files`), `T-NN.MM`, `OC-…`, `PD-…`/`D-NN`/`P-NN`, SHAs e `#PR`, símbolos de código e imports simples. Sem rede, sem LLM.
import { simbolosDeCodigo } from "../chunking/codigo";
import type { DocumentoEntrada } from "../tipos";
import { chaveDe, tipoNoDoDocumento, type ArestaExtraida, type GrafoExtraido, type NoExtraido } from "./modelo";

export interface ContextoExtracao {
  /** arquivos conhecidos (relativos); sem isso só se aceita caminho com diretório e extensão. */
  arquivos?: ReadonlySet<string> | null;
  /** título curto do nó do documento. */
  rotuloMax?: number;
}

const RE_CAMINHO = /(?:^|[\s("'`<\[])((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s)"'`>,;:\]])/g;
const RE_TASK = /\bT-\d{1,3}\.\d{1,3}\b/g;
const RE_OC = /\bOC-[A-Za-z0-9][A-Za-z0-9_-]{1,40}\b/g;
const RE_DECISAO = /\b(?:PD|D|P)-\d{1,4}\b/g;
const RE_SHA = /\b(?:commit|sha|revert|cherry-pick)\s+([0-9a-f]{7,40})\b/gi;
const RE_PR = /(?:^|[\s(])#(\d{1,6})\b/g;
const RE_FIX = /^\s*(?:fix|corrige|corrigido|bugfix|hotfix)\b/i;

const unicos = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

export function caminhosCitados(texto: string, arquivos: ReadonlySet<string> | null | undefined): string[] {
  const achados: string[] = [];
  for (const m of texto.matchAll(RE_CAMINHO)) {
    const c = (m[1] as string).replace(/^\.\//, "");
    if (c.startsWith("/") || c.includes("..") || c.length > 200) continue;
    if (arquivos) {
      if (arquivos.has(c)) achados.push(c);
    } else if (/\/[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(c) && !/^https?:/i.test(c)) achados.push(c);
    if (achados.length >= 40) break;
  }
  return unicos(achados);
}

const RE_IMPORT = [
  /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
  /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  /^\s*from\s+(\.[\w.]*)\s+import\b/gm,
  /^\s*(?:include|require)(?:_once)?\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/gm,
];
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", "/index.ts", "/index.js", "/__init__.py"];

function resolverRelativo(de: string, alvo: string, arquivos: ReadonlySet<string>): string | null {
  const base = de.split("/").slice(0, -1);
  let spec = alvo;
  if (/^\.+[\w.]*$/.test(alvo) && !alvo.includes("/")) {
    // import relativo do Python: ".mod" / "..pkg.mod"
    const pontos = /^\.+/.exec(alvo)?.[0].length ?? 1;
    spec = `${"../".repeat(Math.max(0, pontos - 1)) || "./"}${alvo.slice(pontos).replace(/\./g, "/")}`;
  }
  const partes = [...base];
  for (const p of spec.split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") {
      if (partes.length === 0) return null;
      partes.pop();
    } else partes.push(p);
  }
  const cand = partes.join("/");
  const semExt = cand.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  for (const base2 of unicos([cand, semExt])) for (const e of EXTS) if (arquivos.has(base2 + e)) return base2 + e;
  return null;
}

export function importsResolvidos(arquivo: string, texto: string, arquivos: ReadonlySet<string>): string[] {
  const saida: string[] = [];
  for (const re of RE_IMPORT) {
    for (const m of texto.matchAll(re)) {
      const r = resolverRelativo(arquivo, m[1] as string, arquivos);
      if (r && r !== arquivo) saida.push(r);
    }
  }
  return unicos(saida);
}

/** Extrai o subgrafo de UM documento (texto já redigido). A proveniência é o próprio documento. */
export function extrair(doc: DocumentoEntrada, ctx: ContextoExtracao = {}): GrafoExtraido {
  const nos = new Map<string, NoExtraido>();
  const arestas: ArestaExtraida[] = [];
  const addNo = (n: NoExtraido): { tipo: NoExtraido["tipo"]; chave: string } => {
    if (!nos.has(chaveDe(n))) nos.set(chaveDe(n), { ...n, rotulo: n.rotulo.slice(0, 120) });
    return { tipo: n.tipo, chave: n.chave };
  };
  const rotuloMax = ctx.rotuloMax ?? 120;
  const tipoNo = tipoNoDoDocumento(doc.tipo);
  const eCodigo = doc.tipo === "codigo";
  const chaveDoc = doc.tipo === "commit" ? doc.origem.replace(/^commit:/, "") : doc.tipo === "task" ? doc.origem.replace(/^task:/, "") : doc.origem;
  const noDoc = addNo({ tipo: tipoNo, chave: chaveDoc, rotulo: eCodigo ? doc.origem : doc.titulo.slice(0, rotuloMax) });
  const ligar = (de: typeof noDoc, para: typeof noDoc, tipo: ArestaExtraida["tipo"], peso = 1): void => void arestas.push({ de, para, tipo, peso });
  const texto = `${doc.titulo}\n${doc.texto}`;
  const verbo = doc.tipo === "commit" || doc.tipo === "task" || doc.tipo === "transcricao" || doc.tipo === "handoff" ? "toca" : "citou";

  const arquivosToc = unicos([...(doc.arquivos ?? []), ...(eCodigo ? [] : caminhosCitados(texto, ctx.arquivos ?? null))]);
  const corrige = doc.tipo === "commit" && RE_FIX.test(doc.titulo);
  for (const a of arquivosToc) {
    if (eCodigo && a === doc.origem) continue;
    const n = addNo({ tipo: "arquivo", chave: a, rotulo: a });
    ligar(noDoc, n, corrige ? "corrigiu" : verbo);
  }

  for (const t of unicos(texto.match(RE_TASK) ?? [])) {
    if (doc.tipo === "task" && t === chaveDoc) continue;
    ligar(noDoc, addNo({ tipo: "task", chave: t, rotulo: t }), "citou");
  }
  for (const oc of unicos(texto.match(RE_OC) ?? [])) ligar(noDoc, addNo({ tipo: "ocorrencia", chave: oc, rotulo: oc }), corrige ? "corrigiu" : "citou");
  for (const d of unicos(texto.match(RE_DECISAO) ?? [])) {
    if (doc.tipo === "decisao" && d === chaveDoc) continue;
    ligar(noDoc, addNo({ tipo: "decisao", chave: d, rotulo: d }), doc.tipo === "task" || doc.tipo === "commit" ? "implementa" : "citou");
  }
  for (const m of texto.matchAll(RE_SHA)) {
    const sha = (m[1] as string).toLowerCase();
    if (doc.tipo === "commit" && chaveDoc.startsWith(sha.slice(0, 7))) continue;
    ligar(noDoc, addNo({ tipo: "commit", chave: sha, rotulo: sha.slice(0, 12) }), "citou");
  }
  for (const m of texto.matchAll(RE_PR)) ligar(noDoc, addNo({ tipo: "pr", chave: m[1] as string, rotulo: `#${m[1] as string}` }), "citou");

  if (doc.mission_id) ligar(noDoc, addNo({ tipo: "missao", chave: doc.mission_id, rotulo: doc.mission_id }), "pertence");
  if (doc.task_ref && !(doc.tipo === "task" && doc.task_ref === chaveDoc)) ligar(noDoc, addNo({ tipo: "task", chave: doc.task_ref, rotulo: doc.task_ref }), "pertence");
  if (doc.agente) {
    const ag = addNo({ tipo: "agente", chave: doc.agente, rotulo: doc.agente });
    ligar(ag, noDoc, "executou");
  }
  if (doc.tipo === "relatorio" || doc.tipo === "qa" || doc.tipo === "causa_raiz" || doc.tipo === "handoff") {
    if (doc.task_ref) ligar(addNo({ tipo: "task", chave: doc.task_ref, rotulo: doc.task_ref }), noDoc, "produziu");
  }

  if (eCodigo) {
    const lista = ctx.arquivos ?? null;
    for (const s of simbolosDeCodigo(doc.origem, doc.texto)) {
      const ns = addNo({ tipo: "simbolo", chave: `${doc.origem}#${s}`, rotulo: `${s}` });
      ligar(ns, noDoc, "pertence");
    }
    if (lista) for (const imp of importsResolvidos(doc.origem, doc.texto, lista)) ligar(noDoc, addNo({ tipo: "arquivo", chave: imp, rotulo: imp }), "depende");
  }
  return { nos: [...nos.values()], arestas };
}
