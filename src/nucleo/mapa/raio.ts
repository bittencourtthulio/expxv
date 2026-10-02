import { alcance, candidatosCostura } from "./grafo/alcance";
import { construirGrafo } from "./grafo/memoria";
import type { EstadoTeste } from "./analises/testes";
import type { Entrada } from "./analises/entradas";
import type { ZonaCandidata } from "./analises/zonas";
import { NOTA_RAIO, limiaresPadrao, type FaixaRaio, type Limiares, type RaioProvisorio, type SinalRaio } from "./tipos";

// Raio de impacto PROVISÓRIO (T-17.30), fiel ao `02-raio-de-impacto.md` do legadox: 8 sinais, cada um com valor, método e
// confiança; chamadores = ARQUIVOS distintos (sem testes e sem o alvo), diretos + um nível indireto, parando em ponto de entrada,
// com mínimo (só exatas) e máximo (com heurísticas); faixa pelo máximo; "na dúvida entre duas faixas vale a maior".
// Quem classifica de verdade é o `avaliador-de-raio` do legadox; a aprovação de ALTO é humana (D-21).

export interface ArestaRaio {
  tipo: string;
  /** Ids do grafo: `arq:`, `sim:`, `ent:`, `tab:`, `ext:`. */
  de: string;
  para: string;
  confianca: "exata" | "heuristica";
}

export interface InfoArquivoRaio {
  e_teste?: boolean;
  e_migracao?: boolean;
  /** Tem recurso dinâmico (reflexão, eval, `$$var`, `method_missing`, DI por convenção) que o grafo não vê. */
  dinamico?: boolean;
  churn_total?: number | null;
  churn_janela?: number | null;
  commits_correcao?: number | null;
  criado_git?: string | null;
  ultima_alt?: string | null;
}

export interface CoberturaRaio {
  estado: EstadoTeste;
  fonte: "estimada" | "medida";
}

export interface ContextoRaio {
  arestas: readonly ArestaRaio[];
  arquivos: ReadonlyMap<string, InfoArquivoRaio>;
  entradas?: readonly Pick<Entrada, "id" | "subtipo" | "chave" | "caminho">[];
  cobertura?: ReadonlyMap<string, CoberturaRaio>;
  /** Zonas declaradas no `PERFIL.md` (prefixos de caminho ou nomes de tabela), quando o perfil existe. */
  zonasDeclaradas?: readonly string[];
  /** Zonas candidatas do dicionário (usadas, rotuladas `candidata`, se não houver zonas declaradas). */
  zonasCandidatas?: readonly Pick<ZonaCandidata, "categoria" | "pastas" | "arquivos" | "tabelas">[];
  /** `ok` | `parcial` | `indisponivel`: sem história o sinal 6 vira pior caso. */
  historia?: "ok" | "parcial" | "indisponivel";
  /** Tabelas cuja definição está em migração: nome → caminhos das migrações. */
  tabelasDefinidasEm?: ReadonlyMap<string, readonly string[]>;
  /** Migrações que fazem parte do trabalho (padrão: as migrações entre os arquivos-alvo). */
  migracoesDoTrabalho?: ReadonlySet<string>;
  /** Chamadas descartadas por ambiguidade (> 5 candidatos): vira pior caso do sinal 1. */
  chamadasAmbiguas?: number;
  /** Resposta da pessoa/skill ao sinal 8 (dado histórico): `null`/ausente = não coletável = pior caso. */
  dadoHistorico?: boolean | null;
  /** Versão do extrator (para o método declarado). */
  versaoExtrator?: number;
  /** Data de referência para a idade. */
  agora?: Date;
}

export interface AlvoRaio {
  arquivos: readonly string[];
  /** Qualificados (`arquivo#nome`) ou ids `sim:`; restringem o primeiro nível aos símbolos. */
  simbolos?: readonly string[];
}

export interface DetalhesRaio {
  chamadores_min: string[];
  chamadores_max: string[];
  alcance_transitivo: number;
  alcance_transitivo_min: number;
  rotas: string[];
  consumo_assincrono: string[];
}

export interface RaioCompleto extends RaioProvisorio {
  detalhes: DetalhesRaio;
}

// ---------------------------------------------------------------------------------------------
// Faixa (função pura)

export type CoberturaFaixa = "existente" | "parcial" | "ausente" | "desconhecida";

export interface SinaisFaixa {
  /** Chamadores (use o MÁXIMO: D-168). */
  chamadores: number;
  cobertura: CoberturaFaixa;
  consumoAssincrono: boolean;
  zona: boolean;
  migracao: boolean;
  /** Dado histórico: `true` (ou pior caso assumido) → ALTO. */
  dadoHistorico: boolean;
}

/**
 * BAIXO é conjuntivo (≤ baixo_max chamadores, com cobertura `existente`, sem zona, sem migração, sem consumo assíncrono);
 * MEDIO e ALTO são disjuntivos. Na dúvida vale a maior (cobertura desconhecida conta como ausente).
 */
export function faixaDoRaio(s: SinaisFaixa, limiares: Limiares = limiaresPadrao): FaixaRaio {
  if (s.chamadores > limiares.chamadores_medio_max || s.zona || s.migracao || s.dadoHistorico) return "ALTO";
  if (s.chamadores > limiares.chamadores_baixo_max || s.cobertura !== "existente" || s.consumoAssincrono) return "MEDIO";
  return "BAIXO";
}

// ---------------------------------------------------------------------------------------------

const USO = new Set(["importa", "reexporta", "chama", "instancia", "herda", "implementa", "referencia"]);
const ASSINCRONOS = new Set(["job", "fila", "webhook", "cli", "evento"]);

/** Caminho do arquivo de um id de nó (`arq:`, `sim:`, `ent:`); `null` para tabelas e externos. */
export function arquivoDoId(id: string): string | null {
  if (id.startsWith("arq:")) return id.slice(4);
  if (id.startsWith("sim:") || id.startsWith("ent:")) {
    const r = id.slice(4);
    const i = r.indexOf("#");
    return i < 0 ? r : r.slice(0, i);
  }
  return null;
}

function idSimboloDe(s: string): string {
  return s.startsWith("sim:") ? s : `sim:${s}`;
}

export function calcularRaio(alvo: AlvoRaio, ctx: ContextoRaio, limiares: Limiares = limiaresPadrao): RaioCompleto {
  const alvos = new Set(alvo.arquivos);
  const ehTeste = (c: string): boolean => ctx.arquivos.get(c)?.e_teste === true;
  const metodo = `grafo de chamadas Tree-sitter v${ctx.versaoExtrator ?? 1}; consulta map_impact`;
  const simbolosAlvo = new Set((alvo.simbolos ?? []).map(idSimboloDe));
  const entradasPorArquivo = new Map<string, number>();
  for (const e of ctx.entradas ?? []) entradasPorArquivo.set(e.caminho, (entradasPorArquivo.get(e.caminho) ?? 0) + 1);

  // arestas de uso agregadas a ARQUIVO → ARQUIVO (chamador → chamado), com a melhor confiança
  const reversoMax = new Map<string, Map<string, boolean>>(); // chamado → (chamador → exata?)
  const primeiroNivel = new Map<string, boolean>();
  for (const a of ctx.arestas) {
    if (!USO.has(a.tipo)) continue;
    const de = arquivoDoId(a.de);
    const para = arquivoDoId(a.para);
    if (de === null || para === null || de === para) continue;
    let m = reversoMax.get(para);
    if (m === undefined) reversoMax.set(para, (m = new Map()));
    m.set(de, (m.get(de) ?? false) || a.confianca === "exata");
    if (simbolosAlvo.size > 0 && simbolosAlvo.has(a.para) && alvos.has(para) && !ehTeste(de) && !alvos.has(de)) primeiroNivel.set(de, (primeiroNivel.get(de) ?? false) || a.confianca === "exata");
  }

  const coletar = (somenteExatas: boolean): Set<string> => {
    const saida = new Set<string>();
    const nivel1 = new Set<string>();
    for (const t of alvos) {
      if (simbolosAlvo.size > 0) {
        for (const [de, exata] of primeiroNivel) if (!somenteExatas || exata) nivel1.add(de);
        break;
      }
      for (const [de, exata] of reversoMax.get(t) ?? []) if (!somenteExatas || exata) if (!alvos.has(de) && !ehTeste(de)) nivel1.add(de);
    }
    for (const c of nivel1) saida.add(c);
    // um nível indireto acima, parando em ponto de entrada
    for (const c of nivel1) {
      if (entradasPorArquivo.has(c)) continue;
      for (const [de, exata] of reversoMax.get(c) ?? []) if ((!somenteExatas || exata) && !alvos.has(de) && !ehTeste(de)) saida.add(de);
    }
    return saida;
  };
  const cMin = coletar(true);
  const cMax = coletar(false);

  // alcance transitivo (reverso, todas as profundidades) — por arquivo
  const todosIds = new Set<string>();
  const arestasArquivo: Array<{ de: string; para: string; confianca: "exata" | "heuristica" }> = [];
  for (const [para, m] of reversoMax) for (const [de, exata] of m) {
    arestasArquivo.push({ de, para, confianca: exata ? "exata" : "heuristica" });
    todosIds.add(de);
    todosIds.add(para);
  }
  for (const t of alvos) todosIds.add(t);
  const g = construirGrafo(todosIds, arestasArquivo.map((a) => ({ ...a, tipo: "importa" })));
  const origens = [...alvos].map((t) => g.indice(t)).filter((i) => i >= 0);
  const alc = (so: boolean): string[] =>
    [...alcance(g, origens, { direcao: "entrada", minConfianca: so ? "exata" : "heuristica" }).nos].map((i) => g.ids[i] as string).filter((c) => !alvos.has(c) && !ehTeste(c)).sort();
  const alcMax = alc(false);
  const alcMin = alc(true);

  // sinais 2 e 3: entradas alcançáveis para cima
  const acima = new Set<string>([...alvos, ...alcMax]);
  const rotas: string[] = [];
  const assincronos: string[] = [];
  for (const e of ctx.entradas ?? []) {
    if (!acima.has(e.caminho)) continue;
    if (e.subtipo === "rota") rotas.push(`${e.chave} (${e.caminho})`);
    else if (ASSINCRONOS.has(e.subtipo)) assincronos.push(`${e.subtipo}:${e.chave} (${e.caminho})`);
  }
  rotas.sort();
  assincronos.sort();

  // tabelas tocadas pelo alvo
  const tabelas = new Set<string>();
  for (const a of ctx.arestas) {
    if (a.tipo !== "le_tabela" && a.tipo !== "escreve_tabela") continue;
    const de = arquivoDoId(a.de);
    if (de !== null && alvos.has(de)) tabelas.add(a.para.replace(/^tab:/, ""));
  }

  // sinal 4: cobertura (a pior entre os alvos)
  const ordem: CoberturaFaixa[] = ["existente", "parcial", "ausente", "desconhecida"];
  let cobertura: CoberturaFaixa = "existente";
  let fonteCob = "estimada";
  for (const t of alvos) {
    const c = ctx.cobertura?.get(t);
    const estado: CoberturaFaixa = c === undefined || c.estado === "nao_aplicavel" ? (c === undefined ? "desconhecida" : "existente") : c.estado;
    if (c?.fonte === "medida") fonteCob = "medida";
    if (ordem.indexOf(estado) > ordem.indexOf(cobertura)) cobertura = estado;
  }
  if (alvos.size === 0) cobertura = "desconhecida";

  // sinal 5: zona de risco
  const declaradas = ctx.zonasDeclaradas;
  const zonasAchadas: string[] = [];
  const casaPasta = (c: string, p: string): boolean => c === p || c.startsWith(`${p.replace(/\/$/, "")}/`);
  if (declaradas !== undefined && declaradas.length > 0) {
    for (const z of declaradas) if ([...alvos].some((t) => casaPasta(t, z)) || tabelas.has(z.toLowerCase())) zonasAchadas.push(z);
  } else {
    for (const z of ctx.zonasCandidatas ?? []) {
      if ([...alvos].some((t) => z.arquivos.includes(t) || z.pastas.some((p) => casaPasta(t, p))) || [...tabelas].some((t) => z.tabelas.includes(t))) zonasAchadas.push(`${z.categoria} (candidata)`);
    }
  }
  const zonaDeclarada = declaradas !== undefined && declaradas.length > 0;
  const temZona = zonasAchadas.length > 0;

  // sinal 7: migração
  const migracoesTrabalho = ctx.migracoesDoTrabalho ?? new Set([...alvos].filter((t) => ctx.arquivos.get(t)?.e_migracao === true));
  const ehMigracao = [...alvos].some((t) => ctx.arquivos.get(t)?.e_migracao === true);
  const tabelasEmMigracao = [...tabelas].filter((t) => (ctx.tabelasDefinidasEm?.get(t) ?? []).some((m) => migracoesTrabalho.has(m)));
  const migracao = ehMigracao || tabelasEmMigracao.length > 0;

  // sinal 6: churn e idade
  const semHistoria = (ctx.historia ?? "ok") === "indisponivel";
  let churnTotal = 0;
  let churnJanela = 0;
  let correcoes = 0;
  let criado: string | null = null;
  let ultima: string | null = null;
  for (const t of alvos) {
    const i = ctx.arquivos.get(t);
    churnTotal += i?.churn_total ?? 0;
    churnJanela += i?.churn_janela ?? 0;
    correcoes += i?.commits_correcao ?? 0;
    if (i?.criado_git != null && (criado === null || i.criado_git < criado)) criado = i.criado_git;
    if (i?.ultima_alt != null && (ultima === null || i.ultima_alt > ultima)) ultima = i.ultima_alt;
  }

  // pior caso
  const piorCaso: Array<{ sinal: number; motivo: string }> = [];
  const dinamicoNoAlcance = [...alvos, ...alcMax].find((c) => ctx.arquivos.get(c)?.dinamico === true);
  if (dinamicoNoAlcance !== undefined) piorCaso.push({ sinal: 1, motivo: `aresta dinâmica possível (reflexão/eval/DI por convenção) em ${dinamicoNoAlcance}: chamadores reais podem ser mais que o grafo mostra` });
  if ((ctx.chamadasAmbiguas ?? 0) > 0) piorCaso.push({ sinal: 1, motivo: `${ctx.chamadasAmbiguas} chamada(s) descartada(s) por nome genérico ambíguo (mais de 5 candidatos)` });
  if (cobertura === "desconhecida") piorCaso.push({ sinal: 4, motivo: "cobertura desconhecida para o alvo: assumida ausente" });
  if (semHistoria) piorCaso.push({ sinal: 6, motivo: "sem histórico git (indisponível): churn e idade assumidos no pior caso" });
  if (!zonaDeclarada && temZona) piorCaso.push({ sinal: 5, motivo: "zona só CANDIDATA (sem PERFIL.md declarando): tratada como zona no pior caso" });
  const dadoHist = ctx.dadoHistorico;
  if (dadoHist === undefined || dadoHist === null) piorCaso.push({ sinal: 8, motivo: "dado histórico não é coletável pelo mapa: pior caso até a pessoa/skill responder" });

  const chamadoresMax = cMax.size;
  const chamadoresMin = cMin.size;
  const faixa = faixaDoRaio({ chamadores: chamadoresMax, cobertura, consumoAssincrono: assincronos.length > 0, zona: temZona && zonaDeclarada, migracao, dadoHistorico: dadoHist === true }, limiares);
  const dinamicoOuAmbiguo = piorCaso.some((p) => p.sinal === 1);
  const faixaPior = faixaDoRaio(
    {
      // dinâmico/ambíguo: o número de chamadores é um piso; na dúvida vale a maior faixa possível
      chamadores: dinamicoOuAmbiguo ? Math.max(chamadoresMax, limiares.chamadores_medio_max + 1) : chamadoresMax,
      cobertura: cobertura === "desconhecida" ? "ausente" : cobertura,
      consumoAssincrono: assincronos.length > 0,
      zona: temZona,
      migracao,
      dadoHistorico: dadoHist !== false,
    },
    limiares,
  );

  const sinais: SinalRaio[] = [
    { id: 1, nome: "Chamadores", min: chamadoresMin, max: chamadoresMax, valor: `${chamadoresMin}–${chamadoresMax} arquivo(s) chamador(es) distintos (sem testes e sem o alvo; diretos + 1 nível indireto); alcance transitivo ${alcMin.length}–${alcMax.length}`, metodo, pior_caso: piorCaso.some((p) => p.sinal === 1) },
    { id: 2, nome: "Telas e rotas", min: rotas.length, max: rotas.length, valor: rotas.length === 0 ? "nenhuma rota alcançável" : rotas.slice(0, 10).join("; "), metodo, pior_caso: false },
    { id: 3, nome: "Consumo assíncrono", min: assincronos.length, max: assincronos.length, valor: assincronos.length === 0 ? "nenhum job/fila/webhook/CLI alcançável" : assincronos.slice(0, 10).join("; "), metodo, pior_caso: false },
    { id: 4, nome: "Cobertura", min: null, max: null, valor: `${cobertura} (${fonteCob})`, metodo: `convenção de teste/relatório (${fonteCob})`, pior_caso: cobertura === "desconhecida" },
    { id: 5, nome: "Zona de risco", min: null, max: null, valor: temZona ? zonasAchadas.join(", ") : "nenhuma zona casada", metodo: zonaDeclarada ? "PERFIL.md §Zonas" : "dicionário v1 (candidatas)", pior_caso: !zonaDeclarada && temZona },
    { id: 6, nome: "Churn e idade", min: null, max: null, valor: semHistoria ? "indisponível" : `${churnTotal} alteração(ões) na janela coletada (${churnJanela} recente(s)), ${correcoes} correção(ões); criado ${criado ?? "?"}, última ${ultima ?? "?"}`, metodo: "git log --no-merges --name-status -M (janela configurada)", pior_caso: semHistoria },
    { id: 7, nome: "Migração", min: null, max: null, valor: migracao ? (ehMigracao ? "o alvo é migração" : `toca tabela(s) definida(s) em migração do trabalho: ${tabelasEmMigracao.join(", ")}`) : "não", metodo: "detecção por pasta/DDL", pior_caso: false },
    { id: 8, nome: "Dado histórico", min: null, max: null, valor: dadoHist === true ? "sim (informado)" : dadoHist === false ? "não (informado)" : "não coletável pelo mapa", metodo: dadoHist == null ? "pior caso: a pessoa/skill responde" : "informado pela pessoa/skill", pior_caso: dadoHist == null },
  ];

  // costura: nós por onde passam todos os caminhos entrada → alvo (nível de arquivo)
  const entradasArq = [...new Set((ctx.entradas ?? []).map((e) => e.caminho))].map((c) => g.indice(c)).filter((i) => i >= 0);
  const costura = new Set<string>();
  for (const t of origens) for (const i of candidatosCostura(g, entradasArq, t)) costura.add(g.ids[i] as string);

  return {
    arquivos: [...alvos],
    sinais,
    faixa,
    faixa_pior_caso: faixaPior,
    pior_caso: piorCaso,
    candidatos_costura: [...costura].filter((c) => !alvos.has(c)).sort(),
    nota: NOTA_RAIO,
    detalhes: { chamadores_min: [...cMin].sort(), chamadores_max: [...cMax].sort(), alcance_transitivo: alcMax.length, alcance_transitivo_min: alcMin.length, rotas, consumo_assincrono: assincronos },
  };
}
