// Tabela de equivalência por faixa (Fase 9, T-09.11, D-102, P-31). PURA: sem I/O, sem relógio, sem aleatoriedade.
// O arquivo versionado (`resources/harness/equivalencia.json`) é lido por `equivalencia-arquivo.ts`; aqui só há
// validação estrita, override do usuário, incorporação dos modelos OpenRouter e consulta. Nomes de modelo são DADO:
// o código só conhece faixas. Nenhum nome de modelo entra aqui.
import {
  FAIXAS,
  type EntradaEquivalencia,
  type EstadoEquivalencia,
  type Faixa,
  type FaixaMinimaTroca,
  type ModeloEquivalente,
  type ModeloOpenRouter,
  type TabelaEquivalencia,
} from "../../compartilhado/harness";
import { CATALOGO_TERMINAIS, MODELO_PADRAO_DA_CLI, modelosDaFerramenta } from "../terminais/catalogo";

/** Entrada da tabela: o contrato (`ModeloEquivalente`) + marcas opcionais que o arquivo/override podem trazer. */
export interface ModeloEquivalenteMarcado extends ModeloEquivalente {
  /** `false` = nome não confirmado pela documentação (vira `default` da CLI); ausente = confirmado. */
  confirmado?: boolean;
  /** só modelos OpenRouter: tipos de tarefa em que podem ser usados (`[]`/ausente = todos). */
  tipos_permitidos?: string[];
}

export const PROVEDOR_OPENROUTER = "openrouter";
/** Provedores de roteamento: ids de CLI do catálogo (menos o shell) + `openrouter`. */
export const PROVEDORES_ROTEAVEIS: readonly string[] = [...CATALOGO_TERMINAIS.filter((f) => f.id !== "terminal").map((f) => f.id), PROVEDOR_OPENROUTER];

// Mesmo formato aceito por `argumentosDeModelo` (catalogo.ts) e id `vendor/modelo` do OpenRouter.
const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const ID_OPENROUTER = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const TIPO_VALIDO = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_ENTRADAS_POR_FAIXA = 20;
const MAX_TIPOS = 50;

export interface ErroEquivalencia {
  campo: string;
  motivo: string;
}
export type ResultadoValidacao<T> = { ok: true; valor: T } | { ok: false; erros: ErroEquivalencia[] };

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehFaixa = (v: string): v is Faixa => (FAIXAS as readonly string[]).includes(v);

function niveisDeEsforco(provedor: string, modelo: string | null): readonly string[] {
  const nome = modelo ?? MODELO_PADRAO_DA_CLI;
  return modelosDaFerramenta(provedor).find((m) => m.modelo === nome)?.niveis_esforco ?? [];
}

function validarEntrada(provedor: string, campo: string, bruto: unknown, erros: ErroEquivalencia[]): ModeloEquivalenteMarcado | null {
  if (!ehObjeto(bruto)) {
    erros.push({ campo, motivo: "esperado objeto" });
    return null;
  }
  const n0 = erros.length;
  for (const k of Object.keys(bruto)) {
    if (!["modelo", "esforco", "confirmado", "tipos_permitidos"].includes(k)) erros.push({ campo: `${campo}.${k}`, motivo: "campo desconhecido" });
  }
  const modelo = bruto.modelo;
  if (modelo !== null && typeof modelo !== "string") erros.push({ campo: `${campo}.modelo`, motivo: "esperado texto ou null" });
  else if (typeof modelo === "string") {
    const ehOr = provedor === PROVEDOR_OPENROUTER;
    const ok = ehOr ? ID_OPENROUTER.test(modelo) : modelo === MODELO_PADRAO_DA_CLI || MODELO_VALIDO.test(modelo);
    if (!ok) erros.push({ campo: `${campo}.modelo`, motivo: ehOr ? "esperado id vendor/modelo" : "nome de modelo inválido" });
  }
  const esforco = bruto.esforco === undefined ? null : bruto.esforco;
  if (esforco !== null) {
    if (typeof esforco !== "string") erros.push({ campo: `${campo}.esforco`, motivo: "esperado texto ou null" });
    else if (!niveisDeEsforco(provedor, typeof modelo === "string" ? modelo : null).includes(esforco)) erros.push({ campo: `${campo}.esforco`, motivo: "nível de esforço não suportado por este modelo" });
  }
  if (bruto.confirmado !== undefined && typeof bruto.confirmado !== "boolean") erros.push({ campo: `${campo}.confirmado`, motivo: "esperado booleano" });
  let tipos: string[] | undefined;
  if (bruto.tipos_permitidos !== undefined) {
    const t = bruto.tipos_permitidos;
    if (!Array.isArray(t) || t.length > MAX_TIPOS || !t.every((x) => typeof x === "string" && TIPO_VALIDO.test(x))) erros.push({ campo: `${campo}.tipos_permitidos`, motivo: "esperado lista de slugs" });
    else if (provedor !== PROVEDOR_OPENROUTER) erros.push({ campo: `${campo}.tipos_permitidos`, motivo: "só vale para modelos do openrouter" });
    else tipos = [...(t as string[])];
  }
  if (erros.length > n0) return null;
  const saida: ModeloEquivalenteMarcado = { modelo: (modelo as string | null | undefined) ?? null, esforco: (esforco as string | null) };
  if (bruto.confirmado !== undefined) saida.confirmado = bruto.confirmado as boolean;
  if (tipos !== undefined) saida.tipos_permitidos = tipos;
  return saida;
}

function validarProvedores(bruto: unknown, campo: string, opcoes: { permitirOpenRouter: boolean; exigirTodos: boolean }, erros: ErroEquivalencia[]): TabelaEquivalencia {
  const saida: TabelaEquivalencia = {};
  if (!ehObjeto(bruto)) {
    erros.push({ campo, motivo: "esperado objeto" });
    return saida;
  }
  for (const [prov, faixas] of Object.entries(bruto)) {
    const cp = `${campo}.${prov}`;
    if (!PROVEDORES_ROTEAVEIS.includes(prov)) {
      erros.push({ campo: cp, motivo: "provedor fora do catálogo" });
      continue;
    }
    if (prov === PROVEDOR_OPENROUTER && !opcoes.permitirOpenRouter) {
      erros.push({ campo: cp, motivo: "as faixas do openrouter vêm dos modelos habilitados" });
      continue;
    }
    if (!ehObjeto(faixas)) {
      erros.push({ campo: cp, motivo: "esperado objeto de faixas" });
      continue;
    }
    const tabela: Partial<Record<Faixa, ModeloEquivalente[]>> = {};
    for (const [faixa, lista] of Object.entries(faixas)) {
      const cf = `${cp}.${faixa}`;
      if (!ehFaixa(faixa)) {
        erros.push({ campo: cf, motivo: "faixa desconhecida" });
        continue;
      }
      if (!Array.isArray(lista) || lista.length > MAX_ENTRADAS_POR_FAIXA) {
        erros.push({ campo: cf, motivo: `esperado lista de até ${MAX_ENTRADAS_POR_FAIXA} modelos` });
        continue;
      }
      const itens: ModeloEquivalente[] = [];
      const vistos = new Set<string>();
      lista.forEach((e, i) => {
        const v = validarEntrada(prov, `${cf}[${i}]`, e, erros);
        if (!v) return;
        const chave = `${v.modelo ?? MODELO_PADRAO_DA_CLI}|${v.esforco ?? ""}`;
        if (vistos.has(chave)) erros.push({ campo: `${cf}[${i}]`, motivo: "entrada duplicada na faixa" });
        vistos.add(chave);
        itens.push(v);
      });
      tabela[faixa] = itens;
    }
    saida[prov] = tabela;
  }
  if (opcoes.exigirTodos) {
    for (const prov of PROVEDORES_ROTEAVEIS) {
      const t = saida[prov];
      if (!t) erros.push({ campo: `${campo}.${prov}`, motivo: "provedor do catálogo ausente" });
      else for (const f of FAIXAS) if (t[f] === undefined) erros.push({ campo: `${campo}.${prov}.${f}`, motivo: "faixa ausente" });
    }
  }
  return saida;
}

/** Valida o ARQUIVO versionado (estrito: campo desconhecido, faixa/provedor fora do catálogo, esforço inválido, duplicata). */
export function validarEquivalencia(bruto: unknown): ResultadoValidacao<EntradaEquivalencia> {
  const erros: ErroEquivalencia[] = [];
  if (!ehObjeto(bruto)) return { ok: false, erros: [{ campo: "$", motivo: "esperado objeto" }] };
  for (const k of Object.keys(bruto)) if (!["versao", "faixas", "ordem_de_descida", "provedores"].includes(k)) erros.push({ campo: k, motivo: "campo desconhecido" });
  if (!Number.isInteger(bruto.versao) || (bruto.versao as number) < 1) erros.push({ campo: "versao", motivo: "esperado inteiro ≥ 1" });
  const mesmas = (v: unknown): v is Faixa[] => Array.isArray(v) && v.length === FAIXAS.length && FAIXAS.every((f) => v.includes(f));
  if (!mesmas(bruto.faixas)) erros.push({ campo: "faixas", motivo: "esperadas exatamente as faixas topo, alto, medio e rapido" });
  if (!mesmas(bruto.ordem_de_descida)) erros.push({ campo: "ordem_de_descida", motivo: "esperada permutação das faixas" });
  const provedores = validarProvedores(bruto.provedores, "provedores", { permitirOpenRouter: true, exigirTodos: false }, erros);
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, valor: { faixas: [...(bruto.faixas as Faixa[])], ordem_de_descida: [...(bruto.ordem_de_descida as Faixa[])], provedores } };
}

/** Valida o override do usuário (só diferenças: `provedores.<id>.<faixa>` substitui a lista inteira; `[]` pula o provedor na faixa). */
export function validarDiferencas(bruto: unknown): ResultadoValidacao<TabelaEquivalencia> {
  const erros: ErroEquivalencia[] = [];
  const valor = validarProvedores(bruto, "provedores", { permitirOpenRouter: false, exigirTodos: false }, erros);
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valor };
}

/** Tabela mínima derivada do catálogo (todas as faixas = `default` não confirmado). Só quando o arquivo falta ou está corrompido. */
export function equivalenciaMinima(): EntradaEquivalencia {
  const provedores: TabelaEquivalencia = {};
  for (const prov of PROVEDORES_ROTEAVEIS) {
    const f: Partial<Record<Faixa, ModeloEquivalente[]>> = {};
    for (const faixa of FAIXAS) {
      f[faixa] = prov === PROVEDOR_OPENROUTER ? [] : [{ modelo: MODELO_PADRAO_DA_CLI, esforco: null, confirmado: false } as ModeloEquivalenteMarcado];
    }
    provedores[prov] = f;
  }
  return { faixas: [...FAIXAS], ordem_de_descida: [...FAIXAS], provedores };
}

export interface PadraoCarregado {
  padrao: EntradaEquivalencia;
  origem: "arquivo" | "embutido";
  avisos: string[];
}
/** Carrega o texto do arquivo versionado; texto ausente, JSON inválido ou conteúdo inválido ⇒ tabela mínima embutida + aviso. */
export function carregarEquivalenciaPadrao(texto: string | null): PadraoCarregado {
  if (texto === null) return { padrao: equivalenciaMinima(), origem: "embutido", avisos: ["arquivo de equivalência ausente: usando a tabela mínima embutida"] };
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { padrao: equivalenciaMinima(), origem: "embutido", avisos: ["arquivo de equivalência corrompido (JSON inválido): usando a tabela mínima embutida"] };
  }
  const r = validarEquivalencia(bruto);
  if (!r.ok) return { padrao: equivalenciaMinima(), origem: "embutido", avisos: [`arquivo de equivalência inválido (${r.erros[0]?.campo}: ${r.erros[0]?.motivo}): usando a tabela mínima embutida`] };
  // provedor do catálogo ausente no arquivo: completa com a faixa vazia (provedor pulado), nunca inventa modelo.
  const provedores: TabelaEquivalencia = { ...r.valor.provedores };
  for (const prov of PROVEDORES_ROTEAVEIS) if (!provedores[prov]) provedores[prov] = { topo: [], alto: [], medio: [], rapido: [] };
  return { padrao: { ...r.valor, provedores }, origem: "arquivo", avisos: [] };
}

export interface OpenRouterNaEquivalencia {
  habilitado: boolean;
  consentido: boolean;
  modelos: readonly ModeloOpenRouter[];
}

const clonar = (t: TabelaEquivalencia): TabelaEquivalencia => {
  const s: TabelaEquivalencia = {};
  for (const [p, fs] of Object.entries(t)) {
    const f: Partial<Record<Faixa, ModeloEquivalente[]>> = {};
    for (const [fx, l] of Object.entries(fs) as Array<[Faixa, ModeloEquivalente[] | undefined]>) if (l) f[fx] = l.map((e) => ({ ...e }));
    s[p] = f;
  }
  return s;
};

export interface EquivalenciaMontada extends EstadoEquivalencia {
  avisos: string[];
}
/**
 * Tabela efetiva = padrão + override do usuário (que vence o arquivo) + modelos OpenRouter habilitados (só com `openrouter.habilitado`
 * E consentimento; ordenados por `ordem` e id). Override inválido é ignorado com aviso. Modelo OpenRouter desabilitado some.
 */
export function montarEquivalencia(padrao: EntradaEquivalencia, diferencas: unknown, openrouter?: OpenRouterNaEquivalencia): EquivalenciaMontada {
  const avisos: string[] = [];
  let dif: TabelaEquivalencia = {};
  if (diferencas !== undefined && diferencas !== null) {
    const v = validarDiferencas(diferencas);
    if (v.ok) dif = v.valor;
    else avisos.push(`override de equivalência ignorado (${v.erros[0]?.campo}: ${v.erros[0]?.motivo})`);
  }
  const provedores = clonar(padrao.provedores);
  for (const [prov, fs] of Object.entries(dif)) {
    provedores[prov] = { ...(provedores[prov] ?? {}) };
    for (const [fx, l] of Object.entries(fs) as Array<[Faixa, ModeloEquivalente[] | undefined]>) if (l) (provedores[prov] as Partial<Record<Faixa, ModeloEquivalente[]>>)[fx] = l.map((e) => ({ ...e }));
  }
  const or: Partial<Record<Faixa, ModeloEquivalente[]>> = { topo: [], alto: [], medio: [], rapido: [] };
  if (openrouter && openrouter.habilitado && openrouter.consentido) {
    const ordenados = openrouter.modelos.filter((m) => m.habilitado && m.faixa !== null && ID_OPENROUTER.test(m.id)).sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const m of ordenados) {
      const e: ModeloEquivalenteMarcado = { modelo: m.id, esforco: null, confirmado: true };
      if (m.tipos_permitidos.length > 0) e.tipos_permitidos = [...m.tipos_permitidos];
      (or[m.faixa as Faixa] as ModeloEquivalente[]).push(e);
    }
  }
  provedores[PROVEDOR_OPENROUTER] = or;
  return {
    padrao: { ...padrao, provedores: clonar(padrao.provedores) },
    efetiva: { ...padrao, provedores },
    diferencas: dif,
    avisos,
  };
}

// ---- consulta ----
const nomeDe = (m: string | null): string => m ?? MODELO_PADRAO_DA_CLI;

/** Lista ordenada (o primeiro é o preferido) de uma faixa; `[]` = o provedor não tem equivalente aqui (é pulado). */
export function resolverFaixa(eq: EntradaEquivalencia, provedor: string, faixa: Faixa): ModeloEquivalenteMarcado[] {
  return (eq.provedores[provedor]?.[faixa] as ModeloEquivalenteMarcado[] | undefined) ?? [];
}

/** Faixa mais alta (na ordem de descida) em que o modelo aparece para o provedor; `null` se desconhecido. */
export function faixaDe(eq: EntradaEquivalencia, provedor: string, modelo: string | null): Faixa | null {
  const alvo = nomeDe(modelo);
  for (const f of eq.ordem_de_descida) if (resolverFaixa(eq, provedor, f).some((e) => nomeDe(e.modelo) === alvo)) return f;
  return null;
}

export interface Equivalente {
  provedor: string;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
  /** 0 = mesma faixa; 1 = desceu uma faixa… */
  descida: number;
  /** `false` = nome ainda não confirmado (é o `default` da CLI). */
  confirmado: boolean;
  tipos_permitidos: string[];
}
export interface OrigemEquivalencia {
  provedor: string;
  modelo: string | null;
  /** quando omitida, deriva de `faixaDe`. */
  faixa?: Faixa | null;
}
const limiteDeDescida = (m: FaixaMinimaTroca): number => (m === "mesma" ? 0 : m === "descer_1" ? 1 : Number.MAX_SAFE_INTEGER);

/**
 * Modelos equivalentes ao de origem, em ordem: faixa igual (provedores na ordem recebida), depois cada faixa abaixo permitida por
 * `faixaMinima` (`mesma`: nenhuma; `descer_1`: 1 abaixo, com aviso a cargo de quem chama; `qualquer`: todas). NUNCA sobe de faixa.
 * Exclui a própria origem e repetições (mesmo provedor+modelo+esforço já listado numa faixa mais alta). Só provedores habilitados.
 */
export function equivalentes(eq: EntradaEquivalencia, origem: OrigemEquivalencia, faixaMinima: FaixaMinimaTroca, provedoresHabilitados: readonly string[]): Equivalente[] {
  const faixaOrigem = origem.faixa ?? faixaDe(eq, origem.provedor, origem.modelo);
  if (faixaOrigem === null) return [];
  const idx0 = eq.ordem_de_descida.indexOf(faixaOrigem);
  const teto = limiteDeDescida(faixaMinima);
  const vistos = new Set<string>([`${origem.provedor}|${nomeDe(origem.modelo)}|`]);
  const saida: Equivalente[] = [];
  for (let i = idx0; i < eq.ordem_de_descida.length; i++) {
    const descida = i - idx0;
    if (descida > teto) break;
    const faixa = eq.ordem_de_descida[i] as Faixa;
    for (const provedor of provedoresHabilitados) {
      for (const e of resolverFaixa(eq, provedor, faixa)) {
        const chave = `${provedor}|${nomeDe(e.modelo)}|${e.esforco ?? ""}`;
        const chaveSemEsforco = `${provedor}|${nomeDe(e.modelo)}|`;
        if (vistos.has(chave) || vistos.has(chaveSemEsforco)) continue;
        vistos.add(chave);
        saida.push({ provedor, modelo: e.modelo === MODELO_PADRAO_DA_CLI ? null : e.modelo, esforco: e.esforco, faixa, descida, confirmado: e.confirmado !== false, tipos_permitidos: e.tipos_permitidos ?? [] });
      }
    }
  }
  return saida;
}
