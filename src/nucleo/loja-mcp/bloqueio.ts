// Lista de bloqueio da Loja de MCPs (Fase 7B, T-07B.10): servidores, pacotes e versões proibidos, mais a
// detecção de nomes suspeitos (typosquatting) por distância de edição contra o catálogo. Falha fechada:
// bloqueio ilegível ou malformado bloqueia TUDO (nada instala). Consultada no plano, na instalação, na
// atualização e na habilitação. Lógica pura.

import { readFileSync } from "node:fs";
import type { CatalogoCarregado } from "./catalogo";
import type { EntradaMcp } from "./esquema";

export interface RegraBloqueio {
  id?: string;
  pacote?: string;
  /** Versões exatas bloqueadas; ausente ou `["*"]` = todas. */
  versoes?: string[];
  motivo: string;
  /** AAAA-MM-DD */
  desde: string;
}

export interface MotivoBloqueio {
  codigo: "bloqueado" | "descartado" | "bloqueio_ilegivel";
  motivo: string;
  regra: RegraBloqueio | null;
}

export class ErroBloqueio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroBloqueio";
  }
}

export interface Bloqueio {
  readonly regras: readonly RegraBloqueio[];
  /** `null` = liberado. Cobre id, pacote e versão da entrada (e `descartado`). */
  consultarEntrada(e: EntradaMcp): MotivoBloqueio | null;
  consultarPacote(pacote: string, versao?: string | null): MotivoBloqueio | null;
  consultarId(id: string): MotivoBloqueio | null;
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_VERSAO = /^\d+(\.\d+){1,2}([-+.][0-9A-Za-z.-]+)?$/;

function versaoBate(regra: RegraBloqueio, versao: string | null | undefined): boolean {
  if (!regra.versoes || regra.versoes.length === 0 || regra.versoes.includes("*")) return true;
  return versao !== null && versao !== undefined && regra.versoes.includes(versao);
}

/** Valida e cria a lista. Lança `ErroBloqueio` em qualquer irregularidade (falha fechada). */
export function criarBloqueio(json: unknown): Bloqueio {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new ErroBloqueio("bloqueio deve ser objeto");
  const o = json as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "schema_version" && k !== "regras") throw new ErroBloqueio(`campo desconhecido no bloqueio: ${k}`);
  if (o["schema_version"] !== 1) throw new ErroBloqueio("schema_version do bloqueio deve ser 1");
  if (!Array.isArray(o["regras"])) throw new ErroBloqueio("regras deve ser lista");
  const regras: RegraBloqueio[] = o["regras"].map((r, i) => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) throw new ErroBloqueio(`regra ${i} deve ser objeto`);
    const x = r as Record<string, unknown>;
    for (const k of Object.keys(x)) if (!["id", "pacote", "versoes", "motivo", "desde"].includes(k)) throw new ErroBloqueio(`regra ${i}: campo desconhecido ${k}`);
    if (x["id"] === undefined && x["pacote"] === undefined) throw new ErroBloqueio(`regra ${i}: informe id ou pacote`);
    for (const k of ["id", "pacote"]) if (x[k] !== undefined && (typeof x[k] !== "string" || (x[k] as string).trim() === "")) throw new ErroBloqueio(`regra ${i}: ${k} inválido`);
    if (typeof x["motivo"] !== "string" || x["motivo"].trim() === "") throw new ErroBloqueio(`regra ${i}: motivo obrigatório`);
    if (typeof x["desde"] !== "string" || !RE_DATA.test(x["desde"])) throw new ErroBloqueio(`regra ${i}: desde deve ser AAAA-MM-DD`);
    if (x["versoes"] !== undefined && (!Array.isArray(x["versoes"]) || !x["versoes"].every((v) => typeof v === "string" && (v === "*" || RE_VERSAO.test(v)))))
      throw new ErroBloqueio(`regra ${i}: versoes deve ser lista de versões exatas ou "*"`);
    return x as unknown as RegraBloqueio;
  });
  Object.freeze(regras);
  const motivoDe = (r: RegraBloqueio): MotivoBloqueio => ({ codigo: "bloqueado", motivo: r.motivo, regra: r });
  const porId = (id: string, versao: string | null | undefined): MotivoBloqueio | null => {
    const r = regras.find((x) => x.id === id && x.pacote === undefined && versaoBate(x, versao));
    return r ? motivoDe(r) : null;
  };
  const consultarPacote = (pacote: string, versao?: string | null): MotivoBloqueio | null => {
    const r = regras.find((x) => x.pacote !== undefined && x.pacote.toLowerCase() === pacote.toLowerCase() && versaoBate(x, versao));
    return r ? motivoDe(r) : null;
  };
  return {
    regras,
    consultarId: (id) => regras.find((x) => x.id === id && x.pacote === undefined) ? motivoDe(regras.find((x) => x.id === id && x.pacote === undefined)!) : null,
    consultarPacote,
    consultarEntrada(e) {
      if (e.classificacao === "descartado") return { codigo: "descartado", motivo: "servidor descartado pela curadoria", regra: null };
      const versao = e.instalacao.versao;
      const regraId = regras.find((x) => x.id === e.id && versaoBate(x, versao));
      if (regraId) return motivoDe(regraId);
      return (e.instalacao.pacote ? consultarPacote(e.instalacao.pacote, versao) : null) ?? porId(e.id, versao);
    },
  };
}

/** Bloqueio que recusa tudo: usado quando o arquivo de bloqueio não pôde ser lido (falha fechada). */
export function bloqueioFechado(motivo = "lista de bloqueio ilegível: nada é instalado"): Bloqueio {
  const m: MotivoBloqueio = { codigo: "bloqueio_ilegivel", motivo, regra: null };
  return { regras: [], consultarEntrada: () => m, consultarPacote: () => m, consultarId: () => m };
}

/** Lê o arquivo de bloqueio; qualquer falha (ausente, não-JSON, malformado) devolve o bloqueio fechado. */
export function carregarBloqueio(caminho: string): Bloqueio {
  try {
    return criarBloqueio(JSON.parse(readFileSync(caminho, "utf8")));
  } catch (e) {
    return bloqueioFechado(`lista de bloqueio inválida (${e instanceof Error ? e.message : "ilegível"}): nada é instalado`);
  }
}

// ---- Nomes suspeitos (typosquatting) -------------------------------------------------------------

/** Distância de Damerau-Levenshtein restrita (transposição conta 1). */
export function distanciaEdicao(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let anterior2: number[] = [];
  let anterior = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const atual = [i];
    for (let j = 1; j <= m; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(anterior[j]! + 1, atual[j - 1]! + 1, anterior[j - 1]! + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, anterior2[j - 2]! + 1);
      atual[j] = v;
    }
    anterior2 = anterior;
    anterior = atual;
  }
  return anterior[m]!;
}

export interface Suspeita {
  suspeito: boolean;
  motivo: "escopo_diferente" | "homoglifo" | "parecido" | null;
  parecido_com: string | null;
  distancia: number | null;
}

const LIMPO: Suspeita = { suspeito: false, motivo: null, parecido_com: null, distancia: null };

const separarEscopo = (nome: string): { escopo: string | null; base: string } => {
  const n = nome.trim().toLowerCase();
  const m = /^@([^/]+)\/(.+)$/.exec(n);
  return m ? { escopo: m[1]!, base: m[2]! } : { escopo: null, base: n };
};
/** Troca confundíveis visuais e remove separadores: `c0ntext-7` ≈ `context7`. */
const achatar = (s: string): string =>
  s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/[-_.]/g, "");

function limiteDistancia(tamanho: number): number {
  return tamanho < 5 ? 0 : tamanho < 10 ? 1 : 2;
}

/** Nomes conhecidos de um catálogo: ids e pacotes (completos). */
export function nomesConhecidos(catalogo: CatalogoCarregado): string[] {
  const nomes = new Set<string>();
  for (const x of catalogo.entradas) { nomes.add(x.entrada.id); if (x.entrada.instalacao.pacote) nomes.add(x.entrada.instalacao.pacote.toLowerCase()); }
  return [...nomes];
}

/**
 * Um nome de pacote/servidor é suspeito se NÃO é conhecido mas parece um conhecido: mesmo nome com outro escopo,
 * igual após trocar confundíveis visuais, ou a poucas edições (≤ 1 até 9 letras, ≤ 2 acima).
 */
export function analisarNome(nome: string, conhecidos: readonly string[]): Suspeita {
  const alvo = nome.trim().toLowerCase();
  if (alvo === "" || conhecidos.some((c) => c.toLowerCase() === alvo)) return LIMPO;
  const a = separarEscopo(alvo);
  let melhor: Suspeita = LIMPO;
  for (const conhecido of conhecidos) {
    const k = separarEscopo(conhecido);
    if (a.base === k.base && a.escopo !== k.escopo) return { suspeito: true, motivo: "escopo_diferente", parecido_com: conhecido, distancia: 0 };
    if (achatar(a.base) === achatar(k.base) && a.base !== k.base) return { suspeito: true, motivo: "homoglifo", parecido_com: conhecido, distancia: distanciaEdicao(a.base, k.base) };
    const d = distanciaEdicao(a.base, k.base);
    if (d >= 1 && d <= limiteDistancia(Math.min(a.base.length, k.base.length)) && (a.escopo === k.escopo || a.escopo === null || k.escopo === null)) {
      if (melhor.distancia === null || d < melhor.distancia) melhor = { suspeito: true, motivo: "parecido", parecido_com: conhecido, distancia: d };
    }
  }
  return melhor;
}
