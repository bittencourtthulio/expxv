// Carregador e consulta do catálogo da Loja de MCPs (Fase 7B, T-07B.03).
// Leitura única do arquivo, validação estrita, índice de busca pré-computado (busca ≤ 10 ms com 100
// entradas; ≤ 16 ms com 2 000) e objetos congelados. Nada de rede, nada de Electron.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  CATEGORIAS_MCP, CLASSIFICACOES_MCP, instalavel as entradaInstalavel, motivoNaoInstalavel, validarCatalogo,
  type CatalogoMcp, type CategoriaMcp, type ClassificacaoMcp, type EntradaMcp, type ErroEsquema, type MotivoNaoInstalavel,
} from "./esquema";

export class ErroCatalogo extends Error {
  readonly codigo: "catalogo_ilegivel" | "catalogo_invalido";
  readonly erros: ErroEsquema[];
  constructor(codigo: "catalogo_ilegivel" | "catalogo_invalido", mensagem: string, erros: ErroEsquema[] = []) {
    super(mensagem);
    this.name = "ErroCatalogo";
    this.codigo = codigo;
    this.erros = erros;
  }
}

/** P-138: nunca anunciar "grátis" sem confirmação. */
export type SeloGratuito = "gratis" | "plano_gratis" | "pago" | "nao_confirmado";

export interface EntradaIndexada {
  readonly entrada: Readonly<EntradaMcp>;
  readonly instalavel: boolean;
  readonly motivo_nao_instalavel: MotivoNaoInstalavel | "catalogo_adulterado" | null;
  readonly selo_gratuito: SeloGratuito;
  /** P-135: licença restritiva/source-available é listada com selo, nunca empacotada. */
  readonly licenca_restritiva: boolean;
  readonly pede_chave: boolean;
  /** posição na ordem de curadoria (desempate estável). */
  readonly posicao: number;
}

export interface CatalogoCarregado {
  readonly schema_version: 1;
  readonly seed_versao: string | null;
  readonly gerado_em: string;
  readonly sha256: string;
  /** Hash diferente do esperado: a Loja abre só-leitura e nada é instalável (AC-14). */
  readonly somente_leitura: boolean;
  readonly aviso: string | null;
  readonly entradas: readonly EntradaIndexada[];
  readonly porId: ReadonlyMap<string, EntradaIndexada>;
  /** texto normalizado de cada entrada, mesma ordem de `entradas`. */
  readonly indice: readonly string[];
}

const RE_RESTRITIVA = /\b(A?GPL|FSL|BUSL|SSPL|ELASTIC|POLYFORM|COMMONS-CLAUSE|CC-BY-NC)/i;

export function licencaRestritiva(spdx: string | null): boolean {
  return spdx !== null && RE_RESTRITIVA.test(spdx);
}

export function seloGratuito(e: EntradaMcp): SeloGratuito {
  if (!e.confirmado) return "nao_confirmado";
  if (e.gratuito === "gratis_open_source") return "gratis";
  if (e.gratuito === "plano_gratis") return "plano_gratis";
  if (e.gratuito === "pago") return "pago";
  return "nao_confirmado";
}

/** Minúsculas, sem acento, para busca. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const ORDEM_CLASSIFICACAO: Record<ClassificacaoMcp, number> = {
  pre_instalado_habilitado: 0, pre_configurado: 1, opcional: 2, descartado: 3,
};

function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor as object)) congelar(v);
  }
  return valor;
}

export interface OpcoesCatalogo {
  /** sha256 esperado do arquivo (manifesto do build); divergência ⇒ somente leitura. */
  sha256Esperado?: string;
}

/** Constrói o catálogo a partir do JSON já lido (puro). Lança `ErroCatalogo` se inválido. */
export function criarCatalogo(json: unknown, sha256 = "", opcoes: OpcoesCatalogo = {}): CatalogoCarregado {
  const r = validarCatalogo(json);
  if (!r.ok) throw new ErroCatalogo("catalogo_invalido", `catálogo inválido: ${r.erros[0]?.caminho} ${r.erros[0]?.mensagem} (+${r.erros.length - 1})`, r.erros);
  const cat: CatalogoMcp = r.catalogo;
  const adulterado = opcoes.sha256Esperado !== undefined && opcoes.sha256Esperado.toLowerCase() !== sha256.toLowerCase();
  const ordenadas = cat.entradas
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ORDEM_CLASSIFICACAO[a.e.classificacao] - ORDEM_CLASSIFICACAO[b.e.classificacao]
      || a.e.nome.localeCompare(b.e.nome, "pt-BR") || a.e.id.localeCompare(b.e.id) || a.i - b.i)
    .map((x) => x.e);
  const entradas: EntradaIndexada[] = ordenadas.map((e, posicao) => ({
    entrada: e,
    instalavel: !adulterado && entradaInstalavel(e),
    motivo_nao_instalavel: adulterado ? "catalogo_adulterado" : motivoNaoInstalavel(e),
    selo_gratuito: seloGratuito(e),
    licenca_restritiva: licencaRestritiva(e.licenca_spdx),
    pede_chave: e.variaveis.some((v) => v.obrigatoria && v.secreta) || e.autenticacao === "oauth",
    posicao,
  }));
  const indice = entradas.map(({ entrada: e }) =>
    normalizar([e.id, e.nome, e.descricao_pt, e.categoria, e.mantenedor_nome, e.licenca_spdx ?? "", ...e.tools_principais].join(" ")));
  const porId = new Map(entradas.map((x) => [x.entrada.id, x]));
  const catalogo: CatalogoCarregado = {
    schema_version: 1,
    seed_versao: cat.seed_versao ?? null,
    gerado_em: cat.gerado_em,
    sha256,
    somente_leitura: adulterado,
    aviso: adulterado ? "catálogo adulterado: a Loja abre só em leitura" : (cat.aviso ?? null),
    entradas,
    porId,
    indice,
  };
  congelar(cat);
  Object.freeze(entradas);
  Object.freeze(indice);
  return Object.freeze(catalogo);
}

const cache = new Map<string, { chave: string; catalogo: CatalogoCarregado }>();

/** Lê, valida e indexa o arquivo; cache em memória por caminho (invalida por tamanho+mtime). */
export function carregarCatalogo(caminho: string, opcoes: OpcoesCatalogo = {}): CatalogoCarregado {
  let bruto: Buffer;
  let chave: string;
  try {
    const info = statSync(caminho);
    chave = `${info.size}:${info.mtimeMs}:${opcoes.sha256Esperado ?? ""}`;
    const emCache = cache.get(caminho);
    if (emCache && emCache.chave === chave) return emCache.catalogo;
    bruto = readFileSync(caminho);
  } catch {
    throw new ErroCatalogo("catalogo_ilegivel", "catálogo ilegível");
  }
  let json: unknown;
  try { json = JSON.parse(bruto.toString("utf8")); } catch { throw new ErroCatalogo("catalogo_invalido", "catálogo não é JSON válido"); }
  const catalogo = criarCatalogo(json, createHash("sha256").update(bruto).digest("hex"), opcoes);
  cache.set(caminho, { chave, catalogo });
  return catalogo;
}

export function limparCacheCatalogo(): void { cache.clear(); }

export type OrdemCatalogo = "relevancia" | "curadoria" | "nome" | "categoria";

export interface FiltroCatalogo {
  texto?: string;
  categoria?: CategoriaMcp;
  classificacao?: ClassificacaoMcp;
  /** só gratuitos CONFIRMADOS (open source ou plano grátis); P-138. */
  gratuito?: boolean;
  /** SPDX exato (sem diferenciar caixa) ou "restritiva" / "permissiva". */
  licenca?: string;
  instalavel?: boolean;
  pedeChave?: boolean;
  ordenar?: OrdemCatalogo;
}

/** Busca e filtros sobre o índice pré-computado. Ordenação estável (desempate pela ordem de curadoria). */
export function consultar(catalogo: CatalogoCarregado, filtro: FiltroCatalogo = {}): EntradaIndexada[] {
  const termos = filtro.texto ? normalizar(filtro.texto).split(/\s+/).filter(Boolean) : [];
  const lic = filtro.licenca?.toLowerCase();
  const nomesNorm = termos.length > 0 ? catalogo.entradas.map((x) => normalizar(x.entrada.nome)) : [];
  const saida: Array<{ x: EntradaIndexada; score: number }> = [];
  for (let i = 0; i < catalogo.entradas.length; i++) {
    const x = catalogo.entradas[i]!;
    const e = x.entrada;
    if (filtro.categoria && e.categoria !== filtro.categoria) continue;
    if (filtro.classificacao && e.classificacao !== filtro.classificacao) continue;
    if (filtro.instalavel !== undefined && x.instalavel !== filtro.instalavel) continue;
    if (filtro.pedeChave !== undefined && x.pede_chave !== filtro.pedeChave) continue;
    if (filtro.gratuito !== undefined && (x.selo_gratuito === "gratis" || x.selo_gratuito === "plano_gratis") !== filtro.gratuito) continue;
    if (lic) {
      if (lic === "restritiva") { if (!x.licenca_restritiva) continue; }
      else if (lic === "permissiva") { if (x.licenca_restritiva || e.licenca_spdx === null) continue; }
      else if ((e.licenca_spdx ?? "").toLowerCase() !== lic) continue;
    }
    let score = 0;
    if (termos.length > 0) {
      const blob = catalogo.indice[i]!;
      let ok = true;
      for (const t of termos) if (!blob.includes(t)) { ok = false; break; }
      if (!ok) continue;
      const nome = nomesNorm[i]!;
      score = nome === termos.join(" ") ? 4 : nome.startsWith(termos[0]!) ? 3 : nome.includes(termos[0]!) ? 2 : 1;
    }
    saida.push({ x, score });
  }
  const ordem: OrdemCatalogo = filtro.ordenar ?? (termos.length > 0 ? "relevancia" : "curadoria");
  if (ordem === "relevancia") saida.sort((a, b) => b.score - a.score || a.x.posicao - b.x.posicao);
  else if (ordem === "nome") saida.sort((a, b) => a.x.entrada.nome.localeCompare(b.x.entrada.nome, "pt-BR") || a.x.posicao - b.x.posicao);
  else if (ordem === "categoria") saida.sort((a, b) => CATEGORIAS_MCP.indexOf(a.x.entrada.categoria) - CATEGORIAS_MCP.indexOf(b.x.entrada.categoria) || a.x.posicao - b.x.posicao);
  return saida.map((s) => s.x);
}

/** Entradas do Kit mínimo (D-134): `pre_instalado_habilitado` confirmadas. */
export function kitMinimo(catalogo: CatalogoCarregado): EntradaIndexada[] {
  return catalogo.entradas.filter((x) => x.entrada.classificacao === "pre_instalado_habilitado" && x.instalavel);
}

export { CLASSIFICACOES_MCP };
