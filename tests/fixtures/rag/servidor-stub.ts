// Servidor FALSO (loopback 127.0.0.1, porta efêmera) que imita, em memória, os 4 provedores do RAG online (Qdrant, Supabase/PostgREST,
// Upstash Vector, Pinecone) no subconjunto da API que os adaptadores usam. NUNCA rede real. Modos injetáveis (mutáveis em `stub.modo`):
// chave exigida (401), latência, 429/5xx intermitente ou inicial, queda no meio (conexões destruídas até `religar()`), eco da credencial
// em erros (adversário), redirecionamento, consistência eventual. Registra TODAS as requisições (cabeçalhos/corpo) para provar onde vai
// a chave e que nada sai sem consentimento.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { subirServidorFalso, type RequisicaoVista, type ServidorFalso } from "../rede/servidor-falso";

export type ProvedorStub = "qdrant" | "supabase" | "upstash" | "pinecone";
type Metrica = "cosseno" | "produto_interno" | "euclidiana";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

export interface ModoStub {
  /** quando definida, exige a chave no cabeçalho certo do provedor (senão 401). */
  chave?: string;
  latenciaMs: number;
  /** a cada N-ésima requisição responde `status` (sem processar). */
  falhaIntermitente?: { status: number; cada: number };
  /** as próximas `quantas` requisições respondem `status`. */
  falhasIniciais?: { status: number; quantas: number };
  /** depois de N requisições de escrita bem-sucedidas as conexões passam a ser destruídas até `religar()`. */
  quedaAposUpserts?: number;
  /** o corpo de erro devolve a credencial e os cabeçalhos recebidos (adversário: o cliente nunca pode repassar isso). */
  ecoarCredencial: boolean;
  /** responde 307 para este URL em toda requisição. */
  redirecionarPara?: string;
  /** contagens (info/stats/count) só enxergam o que já foi `assentar()`. */
  eventual: boolean;
  /** Supabase: a tabela não foi criada (script de preparação não aplicado). */
  tabelaAusente: boolean;
  /** rejeita lote maior que N (400). */
  loteMaxServidor?: number;
}

export interface OpcoesStubRag {
  provedor: ProvedorStub;
  chave?: string;
  /** Pinecone/Upstash/Supabase: dimensão FIXA do índice/coluna (padrão 4). */
  dimensao?: number;
  /** Pinecone/Upstash: métrica FIXA do índice (padrão cosseno). */
  metrica?: Metrica;
  /** Supabase: nome da tabela preparada (padrão `rag_conhecimento`). */
  tabela?: string;
  modo?: Partial<ModoStub>;
}

export interface ItemStub {
  id: string;
  vetor: number[];
  texto: string;
  plano: Record<string, unknown>;
}

export interface StubRag {
  /** `http://127.0.0.1:<porta>` */
  url: string;
  host: "127.0.0.1";
  porta: number;
  provedor: ProvedorStub;
  modo: ModoStub;
  requisicoes: RequisicaoVista[];
  conexoes(): number;
  /** registros reais (sem o `__config__`) de todas as coleções/namespaces. */
  registros(colecao?: string): ItemStub[];
  /** coleções/namespaces existentes. */
  colecoes(): string[];
  assentar(): void;
  derrubar(): void;
  religar(): void;
  fechar(): Promise<void>;
}

interface Colecao {
  dimensao: number;
  metrica: Metrica;
  itens: Map<string, ItemStub>;
  visiveis: Set<string>;
}

const norm = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0);
const dist = (a: number[], b: number[]): number => Math.sqrt(a.reduce((s, x, i) => s + (x - (b[i] as number)) ** 2, 0));
const tokens = (t: unknown): Set<string> => new Set(String(t ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class ErroHttp extends Error {
  constructor(
    readonly status: number,
    readonly corpo: unknown,
  ) {
    super(`http ${status}`);
  }
}

// ---------------------------------------------------------------- filtros por dialeto
function qCond(c: J, p: Record<string, unknown>): boolean {
  if (c.must !== undefined || c.should !== undefined || c.must_not !== undefined) return qFiltro(c, p);
  if (typeof c.key !== "string") throw new ErroHttp(400, { status: { error: "condição inválida" } });
  const v = p[c.key];
  if (c.match !== undefined) {
    if ("value" in c.match) return v === c.match.value;
    if ("any" in c.match) return (c.match.any as unknown[]).includes(v);
    if ("text" in c.match) {
      const q = [...tokens(c.match.text)];
      const t = tokens(v);
      return q.length > 0 && q.every((x) => t.has(x));
    }
  }
  if (c.range !== undefined) return typeof v === "number" && (c.range.gte === undefined || v >= c.range.gte) && (c.range.lte === undefined || v <= c.range.lte);
  throw new ErroHttp(400, { status: { error: "condição não suportada" } });
}
function qFiltro(f: J, p: Record<string, unknown>): boolean {
  if (f === undefined || f === null) return true;
  const must: J[] = f.must ?? [];
  const should: J[] = f.should ?? [];
  const nao: J[] = f.must_not ?? [];
  return must.every((c) => qCond(c, p)) && (should.length === 0 || should.some((c) => qCond(c, p))) && !nao.some((c) => qCond(c, p));
}

function pFiltro(f: J, p: Record<string, unknown>): boolean {
  if (f === undefined || f === null) return true;
  if (f.$and) return (f.$and as J[]).every((x) => pFiltro(x, p));
  if (f.$or) return (f.$or as J[]).some((x) => pFiltro(x, p));
  const chaves = Object.keys(f);
  if (chaves.length !== 1) throw new ErroHttp(400, { code: 3, message: "filtro inválido" });
  const campo = chaves[0] as string;
  const cond = f[campo];
  const v = p[campo];
  if (cond === null || typeof cond !== "object") return v === cond;
  const ops = Object.keys(cond);
  return ops.every((op) => {
    if (op === "$eq") return v === cond[op];
    if (op === "$in") return (cond[op] as unknown[]).includes(v);
    if (op === "$gte") return typeof v === "number" && v >= cond[op];
    if (op === "$lte") return typeof v === "number" && v <= cond[op];
    throw new ErroHttp(400, { code: 3, message: "operador inválido" });
  });
}

// Upstash: SQL-like (strings entre aspas simples com escape por barra invertida)
type TokU = { t: "id" | "num" | "str" | "op" | "par" | "virg"; v: string };
function tokenizarU(s: string): TokU[] {
  const r: TokU[] = [];
  let i = 0;
  const erro = (): never => {
    throw new ErroHttp(422, { error: "Invalid filter" });
  };
  while (i < s.length) {
    const c = s[i] as string;
    if (/\s/.test(c)) i++;
    else if (c === "(" || c === ")") (r.push({ t: "par", v: c }), i++);
    else if (c === ",") (r.push({ t: "virg", v: c }), i++);
    else if (c === ">" || c === "<") {
      if (s[i + 1] !== "=") erro();
      r.push({ t: "op", v: `${c}=` });
      i += 2;
    } else if (c === "=") (r.push({ t: "op", v: "=" }), i++);
    else if (c === "'") {
      let v = "";
      i++;
      for (;;) {
        if (i >= s.length) erro();
        const d = s[i] as string;
        if (d === "\\") {
          if (i + 1 >= s.length) erro();
          v += s[i + 1];
          i += 2;
        } else if (d === "'") {
          i++;
          break;
        } else (v += d, i++);
      }
      r.push({ t: "str", v });
    } else if (/[0-9-]/.test(c)) {
      const m = /^-?\d+(\.\d+)?/.exec(s.slice(i));
      if (!m) erro();
      r.push({ t: "num", v: (m as RegExpExecArray)[0] });
      i += (m as RegExpExecArray)[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]+/.exec(s.slice(i)) as RegExpExecArray;
      r.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else erro();
  }
  return r;
}
function avaliarU(expr: string, meta: Record<string, unknown>): boolean {
  const tk = tokenizarU(expr);
  let i = 0;
  const erro = (): never => {
    throw new ErroHttp(422, { error: "Invalid filter" });
  };
  const val = (): string | number => {
    const t = tk[i++];
    if (!t || (t.t !== "str" && t.t !== "num")) return erro();
    return t.t === "num" ? Number(t.v) : t.v;
  };
  const fator = (): boolean => {
    const t = tk[i];
    if (t?.t === "par" && t.v === "(") {
      i++;
      const r = ou();
      if (tk[i]?.v !== ")") erro();
      i++;
      return r;
    }
    if (t?.t !== "id") return erro();
    i++;
    const campo = t.v;
    if (!["projeto_id", "equipe_id", "tipo", "origem", "hash_conteudo", "modelo_embedding", "dimensao", "criado_em_ms"].includes(campo)) erro();
    const o = tk[i++];
    const v = meta[campo];
    if (o?.t === "op" && o.v === "=") return v === val();
    if (o?.t === "op" && o.v === ">=") {
      const x = val();
      return typeof v === "number" && v >= (x as number);
    }
    if (o?.t === "op" && o.v === "<=") {
      const x = val();
      return typeof v === "number" && v <= (x as number);
    }
    if (o?.t === "id" && o.v === "IN") {
      if (tk[i++]?.v !== "(") erro();
      const l: Array<string | number> = [val()];
      while (tk[i]?.t === "virg") (i++, l.push(val()));
      if (tk[i++]?.v !== ")") erro();
      return l.includes(v as string | number);
    }
    return erro();
  };
  const e = (): boolean => {
    let r = fator();
    while (tk[i]?.t === "id" && tk[i]?.v === "AND") {
      i++;
      const x = fator();
      r = r && x;
    }
    return r;
  };
  const ou = (): boolean => {
    let r = e();
    while (tk[i]?.t === "id" && tk[i]?.v === "OR") {
      i++;
      const x = e();
      r = r || x;
    }
    return r;
  };
  const r = ou();
  if (i !== tk.length) erro();
  return r;
}

// PostgREST: and=(a.eq."x",or(b.in.("a","b"),c.gte.5))
interface NoPg {
  tipo: "and" | "or" | "folha";
  filhos?: NoPg[];
  col?: string;
  op?: string;
  vals?: Array<{ v: string; aspas: boolean }>;
}
function parsePg(s: string): NoPg {
  let i = 0;
  const erro = (): never => {
    throw new ErroHttp(400, { code: "PGRST100", message: "parse error" });
  };
  const valor = (): { v: string; aspas: boolean } => {
    if (s[i] === '"') {
      i++;
      let v = "";
      for (;;) {
        if (i >= s.length) erro();
        const c = s[i] as string;
        if (c === "\\") (v += s[i + 1] ?? "", i += 2);
        else if (c === '"') {
          i++;
          break;
        } else (v += c, i++);
      }
      return { v, aspas: true };
    }
    const m = /^[^,()"]+/.exec(s.slice(i));
    if (!m) return erro();
    i += m[0].length;
    return { v: m[0], aspas: false };
  };
  const lista = (): NoPg[] => {
    if (s[i++] !== "(") erro();
    const r: NoPg[] = [item()];
    while (s[i] === ",") (i++, r.push(item()));
    if (s[i++] !== ")") erro();
    return r;
  };
  const item = (): NoPg => {
    if (s.startsWith("and(", i)) (i += 3);
    else if (s.startsWith("or(", i)) i += 2;
    else {
      const m = /^([a-z_]+)\.(eq|neq|gt|gte|lte|in)\./.exec(s.slice(i));
      if (!m) return erro();
      i += m[0].length;
      if (m[2] === "in") {
        if (s[i++] !== "(") erro();
        const vals = [valor()];
        while (s[i] === ",") (i++, vals.push(valor()));
        if (s[i++] !== ")") erro();
        return { tipo: "folha", col: m[1] as string, op: "in", vals };
      }
      return { tipo: "folha", col: m[1] as string, op: m[2] as string, vals: [valor()] };
    }
    const nome = s.startsWith("and(", i - 3) ? "and" : "or";
    return { tipo: nome, filhos: lista() };
  };
  // raiz: "(" itens ")"
  const filhos = lista();
  if (i !== s.length) erro();
  return { tipo: "and", filhos };
}
function avaliarPg(n: NoPg, row: Record<string, unknown>): boolean {
  if (n.tipo === "and") return (n.filhos as NoPg[]).every((f) => avaliarPg(f, row));
  if (n.tipo === "or") return (n.filhos as NoPg[]).some((f) => avaliarPg(f, row));
  const col = n.col as string;
  if (!(col in row)) throw new ErroHttp(400, { code: "42703", message: "coluna inexistente" });
  const x = row[col];
  const vals = n.vals as Array<{ v: string; aspas: boolean }>;
  const igual = (a: { v: string; aspas: boolean }): boolean => (x === null || x === undefined ? false : a.aspas ? String(x) === a.v : Number(x) === Number(a.v));
  switch (n.op) {
    case "eq":
      return igual(vals[0] as { v: string; aspas: boolean });
    case "neq":
      return !igual(vals[0] as { v: string; aspas: boolean });
    case "in":
      return vals.some(igual);
    case "gt":
      return x !== null && x !== undefined && (typeof x === "number" ? x > Number((vals[0] as { v: string }).v) : String(x) > (vals[0] as { v: string }).v);
    case "gte":
      return typeof x === "number" && x >= Number((vals[0] as { v: string }).v);
    case "lte":
      return typeof x === "number" && x <= Number((vals[0] as { v: string }).v);
  }
  return false;
}

// filtro da RPC do Supabase (AST do núcleo)
function astFiltro(f: J, row: Record<string, unknown>): boolean {
  if (f === null || f === undefined) return true;
  if (f.e) return (f.e as J[]).every((x) => astFiltro(x, row));
  if (f.ou) return (f.ou as J[]).some((x) => astFiltro(x, row));
  if (!["projeto_id", "equipe_id", "tipo", "origem", "hash_conteudo", "modelo_embedding", "dimensao", "criado_em_ms"].includes(f.campo)) return false;
  const v = row[f.campo];
  if ("igual" in f) return v !== null && v !== undefined && String(v) === String(f.igual);
  if ("em" in f) return (f.em as unknown[]).some((x) => String(x) === String(v));
  if ("entre" in f) return typeof v === "number" && v >= f.entre[0] && v <= f.entre[1];
  return false;
}

// ---------------------------------------------------------------- servidor
export async function subirStubRag(opcoes: OpcoesStubRag): Promise<StubRag> {
  const prov = opcoes.provedor;
  const dimIndice = opcoes.dimensao ?? 4;
  const metIndice: Metrica = opcoes.metrica ?? "cosseno";
  const tabela = opcoes.tabela ?? "rag_conhecimento";
  const modo: ModoStub = { latenciaMs: 0, ecoarCredencial: false, eventual: false, tabelaAusente: false, ...(opcoes.chave === undefined ? {} : { chave: opcoes.chave }), ...(opcoes.modo ?? {}) };
  const colecoes = new Map<string, Colecao>();
  let reqN = 0;
  let escritas = 0;
  let derrubado = false;
  const nova = (dimensao: number, metrica: Metrica): Colecao => ({ dimensao, metrica, itens: new Map(), visiveis: new Set() });
  const ns = (nome: string): Colecao => {
    let c = colecoes.get(nome);
    if (!c) {
      c = nova(dimIndice, metIndice);
      colecoes.set(nome, c);
    }
    return c;
  };
  const tabelaSupabase = (): Colecao => ns(tabela);

  const responder = (res: ServerResponse, status: number, corpo?: unknown, cab: Record<string, string> = {}): void => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    for (const [k, v] of Object.entries(cab)) res.setHeader(k, v);
    res.end(corpo === undefined ? "" : JSON.stringify(corpo));
  };
  const lerChave = (req: IncomingMessage): string | undefined => {
    const h = req.headers;
    const bearer = typeof h.authorization === "string" ? h.authorization.replace(/^Bearer\s+/i, "") : undefined;
    if (prov === "qdrant") return (h["api-key"] as string | undefined) ?? bearer;
    if (prov === "pinecone") return h["api-key"] as string | undefined;
    if (prov === "supabase") return h.apikey === bearer ? bearer : undefined;
    return bearer;
  };
  const gravou = (c: Colecao, itens: ItemStub[]): void => {
    for (const it of itens) {
      c.itens.set(it.id, it);
      if (!modo.eventual) c.visiveis.add(it.id);
    }
    escritas++;
  };
  const contaveis = (c: Colecao): number => (modo.eventual ? c.visiveis.size : c.itens.size);
  const ordenados = (c: Colecao): ItemStub[] => [...c.itens.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const checarLote = (n: number): void => {
    if (modo.loteMaxServidor !== undefined && n > modo.loteMaxServidor) throw new ErroHttp(400, { error: "lote grande demais" });
  };
  const checarVetor = (c: Colecao, v: number[]): void => {
    if (!Array.isArray(v) || v.length !== c.dimensao || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new ErroHttp(prov === "qdrant" ? 400 : prov === "upstash" ? 422 : 400, { error: `vetor com dimensão errada (esperada ${c.dimensao})` });
  };

  // ---------------- Qdrant
  async function qdrant(req: IncomingMessage, res: ServerResponse, caminho: string, q: URLSearchParams, corpo: J): Promise<void> {
    const ok = (result: unknown): void => responder(res, 200, { result, status: "ok", time: 0.001 });
    const metodo = req.method as string;
    if (caminho === "/" && metodo === "GET") return responder(res, 200, { title: "qdrant - vector search engine", version: "1.15.0-stub" });
    if (caminho === "/collections" && metodo === "GET") return ok({ collections: [...colecoes.keys()].map((name) => ({ name })) });
    const m = /^\/collections\/([^/]+)(\/.*)?$/.exec(caminho);
    if (!m) throw new ErroHttp(404, { status: { error: "Not found" } });
    const nome = decodeURIComponent(m[1] as string);
    const sub = m[2] ?? "";
    if (sub === "" && metodo === "PUT") {
      if (colecoes.has(nome)) throw new ErroHttp(409, { status: { error: "já existe" } });
      const d = corpo?.vectors?.distance as string;
      const metrica: Metrica = d === "Dot" ? "produto_interno" : d === "Euclid" ? "euclidiana" : "cosseno";
      colecoes.set(nome, nova(Number(corpo?.vectors?.size), metrica));
      return ok(true);
    }
    const c = colecoes.get(nome);
    if (!c) throw new ErroHttp(404, { status: { error: `Collection \`${nome}\` doesn't exist!` } });
    if (sub === "" && metodo === "GET") return ok({ status: "green", points_count: c.itens.size, config: { params: { vectors: { size: c.dimensao, distance: c.metrica === "cosseno" ? "Cosine" : c.metrica === "produto_interno" ? "Dot" : "Euclid" } } } });
    if (sub === "/index" && metodo === "PUT") return ok({ operation_id: 1, status: "completed" });
    if (sub === "/points" && metodo === "PUT") {
      const pts = corpo.points as J[];
      checarLote(pts.length);
      const itens: ItemStub[] = pts.map((p) => {
        if (typeof p.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(p.id)) throw new ErroHttp(400, { status: { error: "id inválido (UUID)" } });
        checarVetor(c, p.vector);
        const { texto, ...plano } = (p.payload ?? {}) as Record<string, unknown>;
        return { id: p.id, vetor: p.vector, texto: String(texto ?? ""), plano: { ...plano, ...(texto === undefined ? {} : { texto }) } };
      });
      gravou(c, itens);
      return ok({ operation_id: 2, status: "completed" });
    }
    const cond = (it: ItemStub, f: J): boolean => qFiltro(f, { ...it.plano, texto: it.texto });
    const ponto = (it: ItemStub, vetor: boolean): J => ({ id: it.id, payload: { ...it.plano, texto: it.texto }, ...(vetor ? { vector: it.vetor } : {}) });
    if (sub === "/points" && metodo === "POST") {
      const ids = corpo.ids as string[];
      return ok(ids.map((i) => c.itens.get(i)).filter((x): x is ItemStub => x !== undefined).map((it) => ponto(it, corpo.with_vector === true)));
    }
    if (sub === "/points/search" && metodo === "POST") {
      const qv = c.metrica === "euclidiana" ? (corpo.vector as number[]) : norm(corpo.vector as number[]);
      checarVetor(c, qv);
      const l = [...c.itens.values()].filter((it) => cond(it, corpo.filter)).map((it) => ({ it, s: c.metrica === "euclidiana" ? dist(qv, it.vetor) : dot(qv, norm(it.vetor)) }));
      l.sort((a, b) => (c.metrica === "euclidiana" ? a.s - b.s : b.s - a.s) || (a.it.id < b.it.id ? -1 : 1));
      return ok(l.slice(0, corpo.limit).map((x) => ({ ...ponto(x.it, false), score: x.s })));
    }
    if (sub === "/points/count" && metodo === "POST") return ok({ count: [...c.itens.values()].filter((it) => cond(it, corpo.filter)).length });
    if (sub === "/points/scroll" && metodo === "POST") {
      const todos = ordenados(c).filter((it) => cond(it, corpo.filter));
      const ini = corpo.offset === undefined || corpo.offset === null ? 0 : todos.findIndex((x) => x.id >= corpo.offset);
      const fatia = ini < 0 ? [] : todos.slice(ini, ini + corpo.limit);
      const prox = ini >= 0 && ini + corpo.limit < todos.length ? (todos[ini + corpo.limit] as ItemStub).id : null;
      return ok({ points: fatia.map((it) => ponto(it, corpo.with_vector === true)), next_page_offset: prox });
    }
    if (sub === "/points/delete" && metodo === "POST") {
      if (corpo.filter === undefined) throw new ErroHttp(400, { status: { error: "filtro obrigatório" } });
      for (const it of [...c.itens.values()]) if (cond(it, corpo.filter)) (c.itens.delete(it.id), c.visiveis.delete(it.id));
      return ok({ operation_id: 3, status: "completed" });
    }
    throw new ErroHttp(404, { status: { error: "Not found" } });
  }

  // ---------------- Upstash
  async function upstash(req: IncomingMessage, res: ServerResponse, caminho: string, _q: URLSearchParams, corpo: J): Promise<void> {
    const ok = (result: unknown): void => responder(res, 200, { result });
    const metodo = req.method as string;
    if (caminho === "/info" && metodo === "GET") {
      const namespaces: Record<string, unknown> = {};
      for (const [k, c] of colecoes) namespaces[k] = { vectorCount: contaveis(c), pendingVectorCount: c.itens.size - contaveis(c) };
      return ok({ vectorCount: 0, pendingVectorCount: 0, dimension: dimIndice, similarityFunction: metIndice === "cosseno" ? "COSINE" : metIndice === "euclidiana" ? "EUCLIDEAN" : "DOT_PRODUCT", namespaces });
    }
    const m = /^\/(upsert|query|range|fetch|delete)(?:\/([^/]*))?$/.exec(caminho);
    if (!m || metodo !== "POST") throw new ErroHttp(404, { error: "Not found" });
    const c = ns(decodeURIComponent(m[2] ?? ""));
    const meta = (it: ItemStub): Record<string, unknown> => it.plano;
    const saida = (it: ItemStub, o: J): J => ({ id: it.id, ...(o.includeVectors ? { vector: it.vetor } : {}), ...(o.includeMetadata ? { metadata: it.plano } : {}), ...(o.includeData ? { data: it.texto } : {}) });
    switch (m[1]) {
      case "upsert": {
        const l = corpo as J[];
        checarLote(l.length);
        const itens: ItemStub[] = l.map((v) => {
          checarVetor(c, v.vector);
          return { id: String(v.id), vetor: v.vector, texto: String(v.data ?? ""), plano: v.metadata ?? {} };
        });
        gravou(c, itens);
        return ok("Success");
      }
      case "query": {
        const q = metIndice === "euclidiana" ? (corpo.vector as number[]) : norm(corpo.vector as number[]);
        checarVetor(c, q);
        const l = [...c.itens.values()].filter((it) => corpo.filter === undefined || avaliarU(corpo.filter, meta(it))).map((it) => ({ it, s: metIndice === "euclidiana" ? 1 / (1 + dist(q, it.vetor)) : metIndice === "cosseno" ? (dot(q, norm(it.vetor)) + 1) / 2 : 1 / (1 + Math.exp(-dot(q, it.vetor))) }));
        l.sort((a, b) => b.s - a.s || (a.it.id < b.it.id ? -1 : 1));
        return ok(l.slice(0, corpo.topK).map((x) => ({ ...saida(x.it, corpo), score: x.s })));
      }
      case "range": {
        const todos = ordenados(c);
        const ini = Number(corpo.cursor ?? "0");
        if (!Number.isInteger(ini) || ini < 0) throw new ErroHttp(422, { error: "cursor inválido" });
        const fatia = todos.slice(ini, ini + corpo.limit);
        return ok({ nextCursor: ini + corpo.limit < todos.length ? String(ini + corpo.limit) : "", vectors: fatia.map((it) => saida(it, corpo)) });
      }
      case "fetch":
        return ok((corpo.ids as string[]).map((i) => c.itens.get(i)).map((it) => (it ? saida(it, corpo) : null)));
      case "delete": {
        let n = 0;
        for (const it of [...c.itens.values()]) {
          const alvo = corpo.ids !== undefined ? (corpo.ids as string[]).includes(it.id) : corpo.filter !== undefined && avaliarU(corpo.filter, meta(it));
          if (alvo) (c.itens.delete(it.id), c.visiveis.delete(it.id), n++);
        }
        return ok({ deleted: n });
      }
    }
    throw new ErroHttp(404, { error: "Not found" });
  }

  // ---------------- Pinecone
  async function pinecone(req: IncomingMessage, res: ServerResponse, caminho: string, q: URLSearchParams, corpo: J): Promise<void> {
    const metodo = req.method as string;
    if (typeof req.headers["x-pinecone-api-version"] !== "string") throw new ErroHttp(400, { code: 3, message: "versão da API ausente" });
    if (caminho === "/describe_index_stats" && metodo === "POST") {
      const namespaces: Record<string, unknown> = {};
      let total = 0;
      for (const [k, c] of colecoes) (namespaces[k] = { vectorCount: contaveis(c) }, (total += contaveis(c)));
      return responder(res, 200, { namespaces, dimension: dimIndice, indexFullness: 0, totalVectorCount: total, metric: metIndice === "cosseno" ? "cosine" : metIndice === "euclidiana" ? "euclidean" : "dotproduct" });
    }
    const nsNome = (corpo?.namespace as string | undefined) ?? q.get("namespace") ?? "";
    const c = ns(nsNome);
    const vec = (it: ItemStub, valores: boolean): J => ({ id: it.id, ...(valores ? { values: it.vetor } : {}), metadata: { ...it.plano, ...(it.texto === "" && !("texto" in it.plano) ? {} : { texto: it.texto }) } });
    if (caminho === "/vectors/upsert" && metodo === "POST") {
      const l = corpo.vectors as J[];
      checarLote(l.length);
      if (l.length > 1000) throw new ErroHttp(400, { code: 3, message: "lote grande demais" });
      const itens: ItemStub[] = l.map((v) => {
        checarVetor(c, v.values);
        if (v.values.every((x: number) => x === 0)) throw new ErroHttp(400, { code: 3, message: "vetor denso todo zero" });
        for (const [k, val] of Object.entries(v.metadata ?? {})) if (val === null || (typeof val === "object" && !Array.isArray(val))) throw new ErroHttp(400, { code: 3, message: `metadado inválido em ${k}` });
        const { texto, ...plano } = (v.metadata ?? {}) as Record<string, unknown>;
        return { id: String(v.id), vetor: v.values, texto: String(texto ?? ""), plano };
      });
      gravou(c, itens);
      return responder(res, 200, { upsertedCount: itens.length });
    }
    if (caminho === "/query" && metodo === "POST") {
      const qv = metIndice === "euclidiana" ? (corpo.vector as number[]) : norm(corpo.vector as number[]);
      checarVetor(c, qv);
      const l = [...c.itens.values()].filter((it) => pFiltro(corpo.filter, { ...it.plano, texto: it.texto })).map((it) => ({ it, s: metIndice === "euclidiana" ? dist(qv, it.vetor) : metIndice === "cosseno" ? dot(qv, norm(it.vetor)) : dot(qv, it.vetor) }));
      l.sort((a, b) => (metIndice === "euclidiana" ? a.s - b.s : b.s - a.s) || (a.it.id < b.it.id ? -1 : 1));
      return responder(res, 200, { namespace: nsNome, matches: l.slice(0, corpo.topK).map((x) => ({ ...vec(x.it, false), score: x.s })) });
    }
    if (caminho === "/vectors/list" && metodo === "GET") {
      const lim = Math.min(Number(q.get("limit") ?? 100), 100);
      const tok = q.get("paginationToken");
      const todos = ordenados(c);
      let ini = 0;
      if (tok !== null) {
        let ultimo: string;
        try {
          ultimo = Buffer.from(tok, "base64url").toString("utf8");
        } catch {
          throw new ErroHttp(400, { code: 3, message: "token inválido" });
        }
        if (ultimo === "") throw new ErroHttp(400, { code: 3, message: "token inválido" });
        ini = todos.findIndex((x) => x.id > ultimo);
        if (ini < 0) ini = todos.length;
      }
      const fatia = todos.slice(ini, ini + lim);
      const temMais = ini + lim < todos.length;
      return responder(res, 200, { vectors: fatia.map((x) => ({ id: x.id })), ...(temMais ? { pagination: { next: Buffer.from((fatia[fatia.length - 1] as ItemStub).id).toString("base64url") } } : {}), namespace: nsNome });
    }
    if (caminho === "/vectors/fetch" && metodo === "GET") {
      const ids = q.getAll("ids");
      if (ids.length === 0 || ids.length > 1000) throw new ErroHttp(400, { code: 3, message: "ids inválidos" });
      const vs: Record<string, J> = {};
      for (const i of ids) {
        const it = c.itens.get(i);
        if (it) vs[i] = vec(it, true);
      }
      return responder(res, 200, { vectors: vs, namespace: nsNome });
    }
    if (caminho === "/vectors/delete" && metodo === "POST") {
      if (corpo.ids === undefined) throw new ErroHttp(400, { code: 3, message: "apenas por ids neste stub" });
      for (const i of corpo.ids as string[]) (c.itens.delete(i), c.visiveis.delete(i));
      return responder(res, 200, {});
    }
    throw new ErroHttp(404, { code: 5, message: "Not found" });
  }

  // ---------------- Supabase / PostgREST
  async function supabase(req: IncomingMessage, res: ServerResponse, caminho: string, q: URLSearchParams, corpo: J): Promise<void> {
    const metodo = req.method as string;
    if (modo.tabelaAusente) throw new ErroHttp(404, { code: "PGRST205", message: "Could not find the table", hint: null });
    const c = tabelaSupabase();
    const linha = (it: ItemStub): Record<string, unknown> => ({ ...it.plano, id: it.id, texto: it.texto, embedding: JSON.stringify(it.vetor) });
    const selecionar = (r: Record<string, unknown>, sel: string | null): Record<string, unknown> => {
      if (sel === null || sel === "*") return r;
      const o: Record<string, unknown> = {};
      for (const k of sel.split(",")) if (k in r) o[k] = r[k];
      return o;
    };
    // colunas fixas da tabela (null quando ausente)
    const completa = (it: ItemStub): Record<string, unknown> => {
      const base: Record<string, unknown> = { equipe_id: null, indice: null, titulo: null };
      return { ...base, ...linha(it) };
    };
    if (caminho === `/rest/v1/${tabela}_buscar` || caminho === `/rest/v1/rpc/${tabela}_buscar`) {
      if (metodo !== "POST") throw new ErroHttp(405, {});
      const consulta = JSON.parse(corpo.consulta as string) as number[];
      if (consulta.length !== c.dimensao) throw new ErroHttp(400, { code: "22000", message: `expected ${c.dimensao} dimensions, not ${consulta.length}` });
      const metrica = corpo.metrica as string;
      const l = [...c.itens.values()]
        .filter((it) => it.id !== "__config__" && it.vetor.length > 0 && astFiltro(corpo.filtro, completa(it)))
        .map((it) => {
          const d = metrica === "produto_interno" ? -dot(consulta, it.vetor) : metrica === "euclidiana" ? dist(consulta, it.vetor) : 1 - dot(norm(consulta), norm(it.vetor));
          const { embedding: _e, ...resto } = completa(it);
          return { it, linha: { ...resto, distancia: d } };
        })
        .sort((a, b) => (a.linha.distancia as number) - (b.linha.distancia as number) || (a.it.id < b.it.id ? -1 : 1));
      return responder(res, 200, l.slice(0, Math.min(Number(corpo.k), 200)).map((x) => x.linha));
    }
    if (caminho === `/rest/v1/rpc/${tabela}_buscar_texto`) {
      const ct = String(corpo.consulta_texto);
      if (!/^[\p{L}\p{N}_]+( \| [\p{L}\p{N}_]+)*$/u.test(ct)) throw new ErroHttp(400, { code: "42601", message: "syntax error in tsquery" });
      const termos = ct.split(" | ");
      const l = [...c.itens.values()].filter((it) => it.id !== "__config__" && astFiltro(corpo.filtro, completa(it)) && termos.some((t) => tokens(it.texto).has(t))).sort((a, b) => (a.id < b.id ? -1 : 1));
      return responder(
        res,
        200,
        l.slice(0, Math.min(Number(corpo.k), 200)).map((it) => {
          const { embedding: _e, ...resto } = completa(it);
          return resto;
        }),
      );
    }
    if (caminho === `/rest/v1/${tabela}`) {
      const prefer = String(req.headers.prefer ?? "");
      if (metodo === "POST") {
        const rows = corpo as Array<Record<string, unknown>>;
        if (!Array.isArray(rows) || rows.length === 0) throw new ErroHttp(400, { code: "PGRST102", message: "corpo inválido" });
        checarLote(rows.length);
        const chaves = Object.keys(rows[0] as object).sort().join(",");
        const esperado = "criado_em,criado_em_ms,dimensao,embedding,equipe_id,hash_conteudo,id,indice,modelo_embedding,origem,projeto_id,texto,tipo,titulo";
        if (chaves !== esperado) throw new ErroHttp(400, { code: "PGRST204", message: "colunas inesperadas" });
        if (rows.some((r) => Object.keys(r).sort().join(",") !== chaves)) throw new ErroHttp(400, { code: "PGRST102", message: "All object keys must match" });
        if (q.get("on_conflict") !== "id" || !prefer.includes("resolution=merge-duplicates")) throw new ErroHttp(409, { code: "23505", message: "duplicate key" });
        const itens: ItemStub[] = rows.map((r) => {
          const { id, texto, embedding, ...plano } = r;
          let vetor: number[] = [];
          if (embedding !== null) {
            vetor = JSON.parse(String(embedding)) as number[];
            if (vetor.length !== c.dimensao) throw new ErroHttp(400, { code: "22000", message: `expected ${c.dimensao} dimensions, not ${vetor.length}` });
          }
          for (const [k, v] of Object.entries(plano)) if (v === null) delete plano[k];
          if (typeof texto === "string" && texto.includes("\u0000")) throw new ErroHttp(400, { code: "22P05", message: "unsupported Unicode escape" });
          return { id: String(id), vetor, texto: String(texto), plano };
        });
        gravou(c, itens);
        return responder(res, 201);
      }
      if (metodo === "GET" || metodo === "DELETE") {
        const and = q.get("and");
        const id = q.get("id");
        let alvo = [...c.itens.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (and !== null) {
          const no = parsePg(and);
          alvo = alvo.filter((it) => avaliarPg(no, completa(it)));
        }
        if (id !== null) {
          const m = /^eq\.(.*)$/.exec(id);
          if (!m) throw new ErroHttp(400, { code: "PGRST100", message: "parse error" });
          alvo = alvo.filter((it) => it.id === m[1]);
        }
        if (metodo === "DELETE") {
          if (and === null && id === null) throw new ErroHttp(400, { code: "21000", message: "DELETE requires a WHERE clause" });
          for (const it of alvo) (c.itens.delete(it.id), c.visiveis.delete(it.id));
          return responder(res, 200, prefer.includes("return=representation") ? alvo.map((it) => selecionar(completa(it), q.get("select"))) : undefined);
        }
        const total = modo.eventual ? alvo.filter((it) => c.visiveis.has(it.id)).length : alvo.length;
        const lim = q.get("limit") === null ? alvo.length : Number(q.get("limit"));
        const fatia = alvo.slice(0, lim);
        const cab: Record<string, string> = {};
        if (prefer.includes("count=exact")) cab["content-range"] = fatia.length === 0 ? `*/${total}` : `0-${fatia.length - 1}/${total}`;
        return responder(res, 200, fatia.map((it) => selecionar(completa(it), q.get("select"))), cab);
      }
    }
    throw new ErroHttp(404, { code: "PGRST205", message: "Not found" });
  }

  const servidor: ServidorFalso = await subirServidorFalso(async (req, res, corpoTexto) => {
    reqN++;
    if (modo.latenciaMs > 0) await dormir(modo.latenciaMs);
    if (derrubado) {
      req.socket.destroy();
      return;
    }
    const falha = (status: number): void =>
      responder(res, status, modo.ecoarCredencial ? { message: "erro", chave_recebida: lerChave(req), cabecalhos: req.headers, corpo: corpoTexto } : { message: "erro" }, status === 429 ? { "retry-after": "0" } : {});
    if (modo.redirecionarPara !== undefined) return void responder(res, 307, undefined, { location: modo.redirecionarPara });
    if (modo.falhasIniciais !== undefined && modo.falhasIniciais.quantas > 0) {
      modo.falhasIniciais.quantas--;
      return falha(modo.falhasIniciais.status);
    }
    if (modo.falhaIntermitente !== undefined && reqN % modo.falhaIntermitente.cada === 0) return falha(modo.falhaIntermitente.status);
    if (modo.chave !== undefined && lerChave(req) !== modo.chave) return falha(401);
    const u = new URL(req.url ?? "/", "http://stub");
    let corpo: J;
    try {
      corpo = corpoTexto === "" ? undefined : JSON.parse(corpoTexto);
    } catch {
      return responder(res, 400, { error: "json inválido" });
    }
    const antes = escritas;
    try {
      if (prov === "qdrant") await qdrant(req, res, u.pathname, u.searchParams, corpo);
      else if (prov === "upstash") await upstash(req, res, u.pathname, u.searchParams, corpo);
      else if (prov === "pinecone") await pinecone(req, res, u.pathname, u.searchParams, corpo);
      else await supabase(req, res, u.pathname, u.searchParams, corpo);
    } catch (e) {
      if (e instanceof ErroHttp) {
        if (modo.ecoarCredencial && e.status !== 404) return void responder(res, e.status, { ...(e.corpo as object), chave_recebida: lerChave(req), cabecalhos: req.headers });
        return void responder(res, e.status, e.corpo);
      }
      throw e;
    }
    if (escritas > antes && modo.quedaAposUpserts !== undefined && escritas >= modo.quedaAposUpserts) derrubado = true;
  });

  return {
    url: `http://127.0.0.1:${servidor.porta}`,
    host: servidor.host,
    porta: servidor.porta,
    provedor: prov,
    modo,
    requisicoes: servidor.requisicoes,
    conexoes: servidor.conexoes,
    registros: (colecao) => [...colecoes.entries()].filter(([k]) => colecao === undefined || k === colecao).flatMap(([, c]) => [...c.itens.values()]).filter((i) => i.id !== "__config__" && i.plano.__config__ !== true),
    colecoes: () => [...colecoes.keys()],
    assentar: () => {
      for (const c of colecoes.values()) c.visiveis = new Set(c.itens.keys());
    },
    derrubar: () => {
      derrubado = true;
    },
    religar: () => {
      derrubado = false;
      delete modo.quedaAposUpserts;
    },
    fechar: () => servidor.fechar(),
  };
}

/** impressão digital estável do conteúdo gravado (para comparar estados em testes). */
export function digestRegistros(itens: ItemStub[]): string {
  return createHash("sha256").update(JSON.stringify([...itens].sort((a, b) => (a.id < b.id ? -1 : 1)).map((i) => [i.id, i.texto, i.plano]))).digest("hex");
}
