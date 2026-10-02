import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { DadosAnaliseMapa, RaioMapaIpc, ResumoMapaIpc } from "../../compartilhado/mapa";
import { compararInventarios, montarInventarioStackx, type EntradaInventario, type ItemInventario, type MudancasInventario } from "./inventario";
import { montarPerfilProvisorio, type EntradaPerfil } from "./perfil-provisorio";
import { PASTA_PACOTES, PASTA_PRODUTO } from "./pasta";

// Pacote de contexto (T-17.31): `<pasta do produto>/mapa/<carimbo>/` com o que as skills do método leem. Escrita ATÔMICA (pasta temporária +
// rename), no máximo 3 pacotes, só caminhos relativos, nenhuma linha de código-fonte e NADA fora da pasta de pacotes do mapa (docs/** nunca).

export const PACOTES_MAX = 3;
export const ORCAMENTO_TOKENS_RESUMO = 6_000;
export const ORCAMENTO_TOKENS_RAIO = 2_000;
export const RE_CARIMBO = /^\d{8}T\d{6}Z$/;

/** Estimador do plano: caracteres / 4. */
export const estimarTokens = (texto: string): number => Math.ceil(texto.length / 4);

export function carimboDe(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export interface ArquivoImportante {
  caminho: string;
  linguagem: string;
  loc: number | null;
  pagerank: number | null;
  camada: number | null;
  ciclo_id: number | null;
  modulo: string;
}

export interface EntradaPacote extends EntradaPerfil {
  /** Entrada do inventário do stackx (arquivos com extração, manifestos…). */
  inventario: EntradaInventario;
  importantes: readonly ArquivoImportante[];
  externas?: DadosAnaliseMapa["externas"];
  dados_acesso?: DadosAnaliseMapa["dados"];
}

// ---------------------------------------------------------------------------------------------
// RESUMO.md

interface Secao {
  titulo: string;
  /** Gera o texto com no máximo `cap` itens. */
  gerar: (cap: number) => string[];
  base: number;
}

const cod = (t: string): string => `\`${t.replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\``;

function secoes(e: EntradaPacote): Secao[] {
  const d = e.dados;
  const r = e.resumo;
  const ord = <T,>(l: readonly T[], f: (x: T) => string): T[] => [...l].sort((a, b) => f(a).localeCompare(f(b)));
  return [
    { titulo: "Panorama", base: 12, gerar: (cap) => [
      `Mapa ${r.estado}, versão ${r.versao_mapa}${r.analisado_em !== null ? `, analisado em ${r.analisado_em}` : ""}. ${r.arquivos} arquivos, ${r.nos} nós; arestas: ${r.arestas.exata} exatas e ${r.arestas.heuristica} heurísticas. História git: ${r.historia}.`,
      ...r.linguagens.slice(0, cap).map((l) => `- ${l.linguagem}: ${l.arquivos} arquivos, ${l.loc} linhas`),
    ] },
    { titulo: "Arquivos mais importantes (PageRank)", base: 25, gerar: (cap) => e.importantes.slice(0, cap).map((a) => `- ${cod(a.caminho)} (${a.linguagem}${a.camada !== null ? `, camada ${a.camada}` : ""}${a.ciclo_id !== null ? ", em ciclo" : ""})`) },
    { titulo: "Entradas", base: 25, gerar: (cap) => [
      Object.entries(d.entradas.por_categoria).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}: ${v}`).join("; ") || "nenhuma entrada detectada",
      ...ord(d.entradas.itens, (x) => `${x.subtipo}|${x.chave}|${x.caminho}`).slice(0, cap).map((x) => `- ${cod(x.chave)} (${x.subtipo}) em ${cod(`${x.caminho}:${x.linha}`)}${x.confianca === "heuristica" ? " [heurística]" : ""}`),
    ] },
    { titulo: "Camadas e violações", base: 15, gerar: (cap) => [
      `${d.camadas.modulos.length} módulos; ${d.camadas.violacoes.length} violações candidatas; ${d.camadas.regras_importadas} regras de fronteira importadas.`,
      ...d.camadas.violacoes.slice(0, cap).map((v) => `- ${cod(v.de_modulo)} -> ${cod(v.para_modulo)} (${v.origem})${v.evidencias[0] !== undefined ? ` ${cod(v.evidencias[0])}` : ""}`),
    ] },
    { titulo: "Ciclos", base: 10, gerar: (cap) => [d.ciclos.total === 0 ? "Nenhum ciclo." : `${d.ciclos.total} ciclos.`, ...d.ciclos.ciclos.slice(0, cap).map((c) => `- ciclo ${c.id}: ${c.tamanho} arquivos, ex.: ${c.nos.slice(0, 2).map((n) => cod(n.replace(/^arq:/, ""))).join(", ")}`)] },
    { titulo: "Hotspots (top 15)", base: 15, gerar: (cap) => [d.hotspots.disponivel ? "" : "História git indisponível: sem hotspots.", ...d.hotspots.itens.slice(0, cap).map((h) => `- ${cod(h.caminho)} pontuação ${h.score.toFixed(2)} (alterações ${h.churn_janela}, complexidade ${h.complexidade_max})`)].filter((x) => x !== "") },
    { titulo: "Dados", base: 15, gerar: (cap) => (e.dados_acesso?.tabelas ?? []).slice(0, cap).map((t) => `- ${cod(t.nome)}: ${t.le_n} leituras, ${t.escreve_n} escritas`) },
    { titulo: "Dependências externas", base: 10, gerar: (cap) => (e.externas?.itens ?? []).slice(0, cap).map((x) => `- ${cod(x.nome)} ${x.versao ?? "?"} (${x.ecossistema}${x.licenca !== null ? `, ${x.licenca}` : ""})`) },
    { titulo: "Arquivos sem teste por pasta", base: 12, gerar: (cap) => d.sem_teste.por_pasta.filter((p) => p.sem_teste > 0).slice(0, cap).map((p) => `- ${cod(p.pasta)}: ${p.sem_teste} de ${p.total}`) },
    { titulo: "Zonas de risco candidatas", base: 8, gerar: (cap) => d.zonas.zonas.slice(0, cap).map((z) => `- ${z.categoria}: ${z.pastas.slice(0, 3).map(cod).join(", ")}. Quem valida: ${z.quem_valida}`) },
    { titulo: "Candidatos a código morto", base: 8, gerar: (cap) => [`${d.mortos.itens.length} candidatos (cada um exige prova de vida; evidência de falta de uso não autoriza remoção).`, ...d.mortos.itens.slice(0, cap).map((m) => `- ${cod(m.caminho)} (candidato, ${m.confianca})`)] },
    { titulo: "Confiança e limites", base: 6, gerar: () => [
      "- Aresta exata vem de regra da linguagem ou manifesto; heurística vem de nome ou convenção.",
      "- O mapa não vê reflexão, DI por convenção, SQL montado em tempo de execução nem rotas em banco.",
      "- Cobertura é estimada por convenção de teste, salvo relatório medido. Faixa de raio é provisória.",
    ] },
    { titulo: "Como usar", base: 6, gerar: () => [
      "- `inventario-stackx.json`: fatos com contagem e evidência `arquivo:linha`; confirme por amostragem em vez de varrer tudo.",
      "- `perfil-provisorio.json` e `entradas.json`: ponto de partida do perfil; o que está estimado ou candidato exige verificação.",
      "- Use as tools MCP `map_*` para o resto. Este pacote não substitui `docs/**`; quem escreve os artefatos do método é a skill.",
    ] },
  ];
}

const FATORES = [1, 0.5, 0.25, 0.1, 0];

/** Corte determinístico: reduz o teto de itens de todas as seções por fatores fixos até caber no orçamento. */
export function montarResumoMd(e: EntradaPacote, opcoes: { orcamentoTokens?: number } = {}): string {
  const orc = opcoes.orcamentoTokens ?? ORCAMENTO_TOKENS_RESUMO;
  const ss = secoes(e);
  const montar = (f: number): string => {
    const L: string[] = ["# Resumo do mapa do código", "", "Provisório: gerado pelo mapa determinístico, nunca contém código-fonte.", ""];
    for (const s of ss) {
      const cap = f === 0 ? 0 : Math.max(1, Math.floor(s.base * f));
      L.push(`## ${s.titulo}`, "", ...s.gerar(cap), "");
    }
    return `${L.join("\n")}\n`;
  };
  for (const f of FATORES) {
    const t = montar(f);
    if (estimarTokens(t) <= orc) return t;
  }
  // último recurso: corta por caracteres sem quebrar linha
  const t = montar(0);
  const max = orc * 4 - 40;
  return `${t.slice(0, max).replace(/\n[^\n]*$/, "")}\n\n[corte por orçamento de tokens]\n`;
}

// ---------------------------------------------------------------------------------------------
// gravação atômica

export interface ConteudoPacote {
  resumo_md: string;
  inventario: readonly ItemInventario[];
  perfil: unknown;
  entradas: unknown;
  /** Uma linha JSON por arquivo importante. */
  arquivos_jsonl: string;
  mudancas: MudancasInventario;
  raio?: { trabalho_id: string; json: unknown };
}

export const nomeRaio = (trabalhoId: string): string => `raio-${trabalhoId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 60)}.json`;

function recusarSeSymlink(p: string): void {
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error(`${p}: symlink não permitido`);
}

export function gravarPacote(p: { raiz: string; carimbo: string; conteudo: ConteudoPacote }): { pasta_rel: string; arquivos: string[] } {
  const { raiz, carimbo, conteudo } = p;
  if (typeof raiz !== "string" || !isAbsolute(raiz) || raiz.includes("\0") || raiz.split(/[\\/]/).includes("..")) throw new Error("raiz inválida");
  if (!RE_CARIMBO.test(carimbo)) throw new Error("carimbo inválido");
  const pastaProduto = join(raiz, PASTA_PRODUTO);
  const baseMapa = join(pastaProduto, "mapa");
  recusarSeSymlink(pastaProduto);
  mkdirSync(baseMapa, { recursive: true });
  recusarSeSymlink(baseMapa);
  const gi = join(pastaProduto, ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, "*\n", "utf8");
  const arquivos: Record<string, string> = {
    "RESUMO.md": conteudo.resumo_md,
    "inventario-stackx.json": `${JSON.stringify(conteudo.inventario, null, 1)}\n`,
    "perfil-provisorio.json": `${JSON.stringify(conteudo.perfil, null, 1)}\n`,
    "entradas.json": `${JSON.stringify(conteudo.entradas, null, 1)}\n`,
    "arquivos.jsonl": conteudo.arquivos_jsonl,
    "mudancas-desde-ultimo.json": `${JSON.stringify(conteudo.mudancas, null, 1)}\n`,
  };
  if (conteudo.raio !== undefined) arquivos[nomeRaio(conteudo.raio.trabalho_id)] = `${JSON.stringify(conteudo.raio.json, null, 1)}\n`;
  for (const [nome, texto] of Object.entries(arquivos)) {
    if (texto.includes(raiz)) throw new Error(`${nome}: contém o caminho absoluto da raiz`);
  }
  const tmp = join(baseMapa, `.tmp-${carimbo}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  try {
    for (const [nome, texto] of Object.entries(arquivos)) writeFileSync(join(tmp, nome), texto, "utf8");
    const destino = join(baseMapa, carimbo);
    rmSync(destino, { recursive: true, force: true });
    renameSync(tmp, destino);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  podarPacotes(baseMapa);
  return { pasta_rel: `${PASTA_PACOTES}/${carimbo}`, arquivos: Object.keys(arquivos).sort() };
}

/** Mantém só os `PACOTES_MAX` mais recentes; remove SOMENTE pastas com nome de carimbo dentro da pasta de pacotes do mapa. */
export function podarPacotes(baseMapa: string): string[] {
  const pastas = readdirSync(baseMapa).filter((n) => RE_CARIMBO.test(n)).sort().reverse();
  const removidos = pastas.slice(PACOTES_MAX);
  for (const n of removidos) rmSync(join(baseMapa, n), { recursive: true, force: true });
  return removidos;
}

/** Carimbo e inventário do pacote mais recente (para `mudancas-desde-ultimo.json`). */
export function lerInventarioAnterior(raiz: string): { carimbo: string; itens: ItemInventario[] } | null {
  const base = join(raiz, PASTA_PRODUTO, "mapa");
  if (!existsSync(base)) return null;
  const ultimo = readdirSync(base).filter((n) => RE_CARIMBO.test(n)).sort().reverse()[0];
  if (ultimo === undefined) return null;
  try {
    const j = JSON.parse(readFileSync(join(base, ultimo, "inventario-stackx.json"), "utf8")) as unknown;
    return Array.isArray(j) ? { carimbo: ultimo, itens: j as ItemInventario[] } : null;
  } catch {
    return null;
  }
}

export interface PedidoGerarPacote {
  raiz: string;
  carimbo?: string;
  agora?: Date;
  entrada: EntradaPacote;
  raio?: { trabalho_id: string; raio: RaioMapaIpc };
  orcamentoTokens?: number;
}

export interface ResultadoPacote {
  carimbo: string;
  pasta_rel: string;
  arquivos: string[];
  tokens_resumo: number;
  mudancas: MudancasInventario;
}

/** Monta tudo (inventário, perfil, resumo, mudanças) e grava o pacote. Nada fora da pasta de pacotes do mapa. */
export function gerarPacote(p: PedidoGerarPacote): ResultadoPacote {
  const carimbo = p.carimbo ?? carimboDe(p.agora);
  const anterior = lerInventarioAnterior(p.raiz);
  const inventario = montarInventarioStackx(p.entrada.inventario);
  const mudancas = compararInventarios(inventario, anterior?.itens ?? null);
  const perfil = montarPerfilProvisorio(p.agora === undefined ? p.entrada : { ...p.entrada, agora: p.agora });
  const resumo_md = montarResumoMd(p.entrada, p.orcamentoTokens === undefined ? {} : { orcamentoTokens: p.orcamentoTokens });
  const raioJson = p.raio === undefined ? undefined : { trabalho_id: p.raio.trabalho_id, json: limitarRaio(p.raio.raio) };
  const r = gravarPacote({
    raiz: p.raiz, carimbo,
    conteudo: {
      resumo_md, inventario, perfil, entradas: p.entrada.dados.entradas,
      arquivos_jsonl: p.entrada.importantes.slice(0, 500).map((a) => JSON.stringify(a)).join("\n") + "\n",
      mudancas, ...(raioJson === undefined ? {} : { raio: raioJson }),
    },
  });
  return { carimbo, pasta_rel: r.pasta_rel, arquivos: r.arquivos, tokens_resumo: estimarTokens(resumo_md), mudancas };
}

/** `raio-*.json` cabe em 2 000 tokens: encurta listas longas de forma determinística. */
export function limitarRaio(raio: RaioMapaIpc): RaioMapaIpc {
  let cap = 50;
  let r: RaioMapaIpc = raio;
  while (estimarTokens(JSON.stringify(r)) > ORCAMENTO_TOKENS_RAIO && cap > 1) {
    cap = Math.floor(cap / 2);
    r = { ...raio, chamadores: raio.chamadores.slice(0, cap), candidatos_costura: raio.candidatos_costura.slice(0, cap), arquivos: raio.arquivos.slice(0, cap), pior_caso: raio.pior_caso.slice(0, cap) };
  }
  return r;
}

export type { ResumoMapaIpc };
