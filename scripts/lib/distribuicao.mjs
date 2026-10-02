// Manifesto de build da distribuição (T-21.02, D-342): lê e valida build/distribuicao.json.
// SEM segredo: só chaves PÚBLICAS, host do feed e as duas chaves de ligação do atualizador (a de build é `atualizacao.habilitada`).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_PADRAO = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

export const CANAIS = Object.freeze(["stable", "beta"]);
export const ADAPTADORES_BANCO = Object.freeze(["node:sqlite", "better-sqlite3"]);
export const PERFIS = Object.freeze(["local", "ci", "release", "com-atualizacao", "perf"]);

/** Chaves PÚBLICAS de teste (as privadas derivam de uma semente fixa em tests/fixtures/atualizacao/chaves-de-teste.ts). O build `release` as recusa. */
export const CHAVES_PUBLICAS_DE_TESTE = Object.freeze(["2B7+RGAAEcf7g1NmvsY7Ak0CVYsemb6N9lG/ppPR66k=", "uDv39ZGdmkw9pQpq/nZf9A3Cn77qhlZ1lDDlzQhSKEg="]);

const RAIZES_VALIDAS = new Set(["versao_esquema", "atualizacao", "assinatura", "banco"]);
const ATUALIZACAO_VALIDAS = new Set(["habilitada", "canal_padrao", "canais", "feed", "chaves_aceitas", "rollout", "valido_ate_dias"]);
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** @param {string} b64 */
export function chavePublicaBem(b64) {
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(b64)) return false;
  return Buffer.from(b64, "base64").length === 32;
}

/**
 * Valida o objeto lido de build/distribuicao.json. Estrito: campo desconhecido é erro.
 * @param {unknown} o
 * @param {{ perfil?: string }} [opcoes]
 * @returns {{ ok: boolean, erros: string[] }}
 */
export function validarDistribuicao(o, opcoes = {}) {
  const perfil = opcoes.perfil ?? "local";
  /** @type {string[]} */
  const erros = [];
  const e = (m) => erros.push(m);
  if (typeof o !== "object" || o === null || Array.isArray(o)) return { ok: false, erros: ["raiz: objeto esperado"] };
  const raiz = /** @type {Record<string, any>} */ (o);
  for (const k of Object.keys(raiz)) if (!RAIZES_VALIDAS.has(k)) e(`campo desconhecido: ${k}`);
  if (raiz.versao_esquema !== 1) e("versao_esquema deve ser 1");

  const a = raiz.atualizacao;
  if (typeof a !== "object" || a === null || Array.isArray(a)) e("atualizacao: objeto esperado");
  else {
    for (const k of Object.keys(a)) if (!ATUALIZACAO_VALIDAS.has(k)) e(`atualizacao.${k}: campo desconhecido`);
    if (typeof a.habilitada !== "boolean") e("atualizacao.habilitada deve ser booleano");
    if (!CANAIS.includes(a.canal_padrao)) e(`atualizacao.canal_padrao desconhecido: ${String(a.canal_padrao).slice(0, 20)}`);
    if (!Array.isArray(a.canais) || a.canais.length === 0 || a.canais.some((c) => !CANAIS.includes(c)) || new Set(a.canais).size !== a.canais.length) e("atualizacao.canais: lista de canais conhecidos sem repetição (stable|beta)");
    else if (!a.canais.includes(a.canal_padrao)) e("atualizacao.canal_padrao precisa estar em canais");
    const f = a.feed;
    if (typeof f !== "object" || f === null) e("atualizacao.feed: objeto esperado");
    else {
      for (const k of Object.keys(f)) if (k !== "host" && k !== "caminho_base") e(`atualizacao.feed.${k}: campo desconhecido`);
      if (typeof f.host !== "string" || !HOST_RE.test(f.host)) e("atualizacao.feed.host: nome de host puro (sem esquema, porta, caminho ou credencial)");
      if (typeof f.caminho_base !== "string" || !/^\/[A-Za-z0-9._~\/-]*$/.test(f.caminho_base) || f.caminho_base.includes("..")) e("atualizacao.feed.caminho_base: caminho começando com / (sem query, credencial ou ..)");
    }
    if (!Array.isArray(a.chaves_aceitas) || a.chaves_aceitas.length > 2) e("atualizacao.chaves_aceitas: lista de até 2 chaves públicas (atual e próxima)");
    else {
      for (const c of a.chaves_aceitas) if (!chavePublicaBem(c)) e("atualizacao.chaves_aceitas: chave pública Ed25519 malformada (base64 de 32 bytes)");
      if (new Set(a.chaves_aceitas).size !== a.chaves_aceitas.length) e("atualizacao.chaves_aceitas: chave repetida");
    }
    const r = a.rollout;
    if (typeof r !== "object" || r === null || !Number.isInteger(r.staging_padrao) || r.staging_padrao < 0 || r.staging_padrao > 100) e("atualizacao.rollout.staging_padrao: inteiro 0..100");
    if (!Number.isInteger(a.valido_ate_dias) || a.valido_ate_dias < 1 || a.valido_ate_dias > 365) e("atualizacao.valido_ate_dias: inteiro 1..365");
  }

  const s = raiz.assinatura;
  if (typeof s !== "object" || s === null || typeof s.exigir !== "boolean") e("assinatura.exigir deve ser booleano");
  const b = raiz.banco;
  if (typeof b !== "object" || b === null || !ADAPTADORES_BANCO.includes(b.adaptador)) e("banco.adaptador desconhecido (node:sqlite|better-sqlite3)");

  // URL com credencial em qualquer string do arquivo (AU-23: o app nunca carrega token)
  const texto = JSON.stringify(o);
  if (/[a-z][a-z0-9+.-]*:\/\/[^"\s/]*@/i.test(texto)) e("URL com credencial é proibida");
  if (/(token|senha|password|secret|segredo|private)/i.test(Object.keys(flatten(raiz)).join(" "))) e("nenhum campo pode se chamar token/senha/segredo/chave privada");

  if (perfil === "release") {
    const aceitas = Array.isArray(a?.chaves_aceitas) ? a.chaves_aceitas : [];
    if (aceitas.some((c) => CHAVES_PUBLICAS_DE_TESTE.includes(c))) e("perfil release recusa chave pública de teste");
    if (a?.habilitada === true) {
      if (aceitas.length === 0) e("perfil release com atualizacao.habilitada exige ao menos uma chave pública aceita (P-334)");
      if (typeof a?.feed?.host === "string" && /\.invalid$/i.test(a.feed.host)) e("perfil release com atualizacao.habilitada exige host de feed real (P-331)");
    }
  }
  return { ok: erros.length === 0, erros };
}

function flatten(o, prefixo = "", saida = {}) {
  for (const [k, v] of Object.entries(o)) {
    saida[`${prefixo}${k}`] = true;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, `${prefixo}${k}.`, saida);
  }
  return saida;
}

/** Lê e valida; lança com as mensagens se inválido. */
export function lerDistribuicao(raiz = RAIZ_PADRAO, opcoes = {}) {
  const caminho = join(raiz, "build", "distribuicao.json");
  const o = JSON.parse(readFileSync(caminho, "utf8"));
  const r = validarDistribuicao(o, opcoes);
  if (!r.ok) throw new Error(`build/distribuicao.json inválido:\n - ${r.erros.join("\n - ")}`);
  return o;
}
