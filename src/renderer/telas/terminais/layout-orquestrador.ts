// Layout "orquestrador + workers" (D-515 a D-517): função PURA. Entrada: nós {id, papel, pai?, ordem}, a área do corpo da grade e o tamanho mínimo legível; saída: a árvore de
// divisões COM proporções. Sem DOM, sem estado, sem tempo: a Tela mede o corpo e o reducer (`estado.ts`) chama isto para refazer a aba quando um worker chega ou sai.
//
// Regra (pedido do dono):
//  1. UM orquestrador: ele ocupa a coluna ESQUERDA (altura total, 50% da largura até 2 workers, 45% depois) e os workers vão sendo criados à DIREITA, como Command+D /
//     Command+Shift+D: o 1º ocupa a direita inteira; o 2º divide a direita em cima/baixo; o 3º divide a linha de baixo em esquerda/direita; e assim por diante. Cada nova
//     divisão cai na célula de MAIOR área que cabe com o tamanho mínimo (empate: a mais recente), cortando pelo lado maior. Até 8 workers; o que não cabe vai para outra aba.
//  2. DOIS ou mais orquestradores: LINHA DE CIMA = orquestradores lado a lado (divisão igual); LINHA DE BAIXO = workers numa grade que se ajusta (55 a 60% da altura quando
//     há workers; 100% para cima quando não há). Workers de orquestradores diferentes ficam agrupados (ordem do pai, depois a de chegada).
//  3. Sem orquestrador no grupo: não há layout (o chamador mantém o comportamento atual).
import { LIMITES_PAINEL_LIVRE } from "../../../compartilhado/painel-livre";
import type { NoPainel, Orientacao } from "./layout";

export type PapelNo = "orquestrador" | "worker";

export interface NoOrquestracao {
  id: string;
  papel: PapelNo;
  /** worker: id do orquestrador que o abriu (ausente = o primeiro orquestrador) */
  pai?: string;
  /** ordem de chegada (menor primeiro) */
  ordem: number;
}

export interface Medida { largura: number; altura: number }

/**
 * Tamanho mínimo legível de um painel nesta regra: ~40 colunas × 8 linhas de terminal mais o cabeçalho (a fonte do terminal NÃO muda). Menor que o mínimo da grade equilibrada
 * (360×180) de propósito: com 1280×800 a metade direita (≈640 px) ainda comporta duas colunas de workers.
 */
export const MINIMO_ORQUESTRACAO: Medida = { largura: 320, altura: 160 };
/** Área usada quando a Tela ainda não mediu o corpo (desktop comum). */
export const AREA_PADRAO: Medida = { largura: 1600, altura: 900 };
/** Fatia da altura dada à linha de baixo (workers) quando há 2+ orquestradores. */
export const ALTURA_DA_LINHA_DE_BAIXO = 0.58;
export const MAXIMO_DE_WORKERS = LIMITES_PAINEL_LIVRE.workers_por_painel;

/** Divisão com proporção do primeiro filho (0..1): `NoPainel` aceita o campo opcional `proporcao`. */
type Divisao = Extract<NoPainel, { tipo: "divisao" }>;
const folha = (sessao_id: string): NoPainel => ({ tipo: "terminal", sessao_id });
const divisao = (orientacao: Orientacao, proporcao: number, primeiro: NoPainel, segundo: NoPainel): Divisao => ({ tipo: "divisao", orientacao, proporcao: arredondar(proporcao), primeiro, segundo });
const arredondar = (x: number): number => Math.round(x * 1000) / 1000;

/** Proporção da coluna do orquestrador único: 50% até 2 workers, 45% a partir de 3 (os workers precisam de espaço). */
export const proporcaoDoOrquestrador = (workers: number): number => (workers <= 2 ? 0.5 : 0.45);

/** Letras dos orquestradores (A, B, C…); depois do Z cai em número. */
export const letraDoOrquestrador = (indice: number): string => (indice < 26 ? String.fromCharCode(65 + indice) : String(indice + 1));

/** Árvore de divisões IGUAIS (cada folha com a mesma fatia): `orientacao` "vertical" = lado a lado, "horizontal" = empilhado. */
function igual(nos: readonly NoPainel[], orientacao: Orientacao): NoPainel {
  if (nos.length === 1) return nos[0] as NoPainel;
  const meio = Math.ceil(nos.length / 2);
  return divisao(orientacao, meio / nos.length, igual(nos.slice(0, meio), orientacao), igual(nos.slice(meio), orientacao));
}

export interface ResultadoLayout {
  /** árvore da aba (orquestradores e workers que couberam); `null` quando não há orquestrador (sem regra) */
  arvore: NoPainel | null;
  /** workers que NÃO couberam com tamanho legível (ou passaram do teto): o chamador os leva para outra aba */
  excedentes: string[];
  /** orquestradores na ordem em que aparecem (a letra de cada um é o índice) */
  orquestradores: string[];
}

export interface OpcoesLayout { area?: Medida; minimo?: Medida }

interface Celula { id: string; w: number; h: number; seq: number }

/** Workers agrupados pelo pai (na ordem dos orquestradores) e, dentro do grupo, pela ordem de chegada; pai desconhecido vale o primeiro orquestrador. Limita a 8 por pai. */
function ordenarWorkers(workers: readonly NoOrquestracao[], orquestradores: readonly NoOrquestracao[]): { ordenados: NoOrquestracao[]; passaramDoTeto: string[] } {
  const indicePai = (w: NoOrquestracao): number => Math.max(0, orquestradores.findIndex((o) => o.id === w.pai));
  const todos = [...workers].sort((a, b) => indicePai(a) - indicePai(b) || a.ordem - b.ordem || a.id.localeCompare(b.id));
  const contagem = new Map<number, number>();
  const ordenados: NoOrquestracao[] = [];
  const passaramDoTeto: string[] = [];
  for (const w of todos) {
    const i = indicePai(w);
    const n = contagem.get(i) ?? 0;
    if (n >= MAXIMO_DE_WORKERS) { passaramDoTeto.push(w.id); continue; }
    contagem.set(i, n + 1);
    ordenados.push(w);
  }
  return { ordenados, passaramDoTeto };
}

/** Um orquestrador: workers na área da direita, subdividida como ⌘D / ⌘⇧D (a maior célula que cabe, cortando pelo lado maior). */
function arvoreDaDireita(ids: readonly string[], area: Medida, minimo: Medida): { arvore: NoPainel | null; excedentes: string[] } {
  if (ids.length === 0) return { arvore: null, excedentes: [] };
  // célula = folha com a geometria; a árvore é reconstruída no fim a partir da lista de cortes (cada corte guarda quem foi dividido)
  type Corte = { alvo: string; novo: string; orientacao: Orientacao };
  const celulas = new Map<string, Celula>();
  celulas.set(ids[0] as string, { id: ids[0] as string, w: area.largura, h: area.altura, seq: 0 });
  const cortes: Corte[] = [];
  const excedentes: string[] = [];
  let seq = 1;
  for (const novo of ids.slice(1)) {
    const candidatas = [...celulas.values()].sort((a, b) => b.w * b.h - a.w * a.h || b.seq - a.seq);
    let feito = false;
    for (const c of candidatas) {
      // pelo lado maior primeiro; o outro lado só se o primeiro não deixa as duas metades legíveis
      const preferida: Orientacao = c.w > c.h ? "vertical" : "horizontal";
      const ordem: Orientacao[] = preferida === "vertical" ? ["vertical", "horizontal"] : ["horizontal", "vertical"];
      const orientacao = ordem.find((o) => (o === "vertical" ? c.w / 2 >= minimo.largura && c.h >= minimo.altura : c.h / 2 >= minimo.altura && c.w >= minimo.largura));
      if (orientacao === undefined) continue;
      const w = orientacao === "vertical" ? c.w / 2 : c.w;
      const h = orientacao === "horizontal" ? c.h / 2 : c.h;
      celulas.set(c.id, { id: c.id, w, h, seq: c.seq });
      celulas.set(novo, { id: novo, w, h, seq: seq++ });
      cortes.push({ alvo: c.id, novo, orientacao });
      feito = true;
      break;
    }
    if (!feito) excedentes.push(novo);
  }
  // reconstrói: cada corte troca a folha `alvo` por (alvo, novo); a metade do corte é sempre 0.5
  let arvore: NoPainel = folha(ids[0] as string);
  const trocar = (no: NoPainel, c: Corte): NoPainel => {
    if (no.tipo === "terminal") return no.sessao_id === c.alvo ? divisao(c.orientacao, 0.5, no, folha(c.novo)) : no;
    return { ...no, primeiro: trocar(no.primeiro, c), segundo: trocar(no.segundo, c) };
  };
  for (const c of cortes) arvore = trocar(arvore, c);
  return { arvore, excedentes };
}

/** Dois ou mais orquestradores: workers em linhas (cada linha com `cols` colunas no máximo), na ordem recebida, o que não cabe vira excedente. */
function arvoreDaLinhaDeBaixo(ids: readonly string[], area: Medida, minimo: Medida): { arvore: NoPainel | null; excedentes: string[] } {
  if (ids.length === 0) return { arvore: null, excedentes: [] };
  const colunasMax = Math.max(1, Math.floor(area.largura / minimo.largura));
  const linhasMax = Math.max(1, Math.floor(area.altura / minimo.altura));
  const cabem = ids.slice(0, colunasMax * linhasMax);
  const excedentes = ids.slice(cabem.length);
  const linhas = Math.ceil(cabem.length / colunasMax);
  const base = Math.floor(cabem.length / linhas);
  const sobra = cabem.length % linhas; // as primeiras `sobra` linhas levam um a mais (a de cima nunca é menor que a de baixo)
  const porLinha: NoPainel[] = [];
  let i = 0;
  for (let l = 0; l < linhas; l++) {
    const n = base + (l < sobra ? 1 : 0);
    porLinha.push(igual(cabem.slice(i, i + n).map(folha), "vertical"));
    i += n;
  }
  return { arvore: igual(porLinha, "horizontal"), excedentes };
}

export function layoutOrquestrador(nos: readonly NoOrquestracao[], opcoes: OpcoesLayout = {}): ResultadoLayout {
  const area = opcoes.area ?? AREA_PADRAO;
  const minimo = opcoes.minimo ?? MINIMO_ORQUESTRACAO;
  const vistos = new Set<string>();
  const unicos = nos.filter((n) => (vistos.has(n.id) ? false : (vistos.add(n.id), true)));
  const orquestradores = unicos.filter((n) => n.papel === "orquestrador").sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  if (orquestradores.length === 0) return { arvore: null, excedentes: [], orquestradores: [] };
  const { ordenados, passaramDoTeto } = ordenarWorkers(unicos.filter((n) => n.papel === "worker"), orquestradores);
  const ids = ordenados.map((w) => w.id);
  const lista = orquestradores.map((o) => o.id);

  if (orquestradores.length === 1) {
    const orq = lista[0] as string;
    if (ids.length === 0) return { arvore: folha(orq), excedentes: [...passaramDoTeto], orquestradores: lista };
    const p = proporcaoDoOrquestrador(ids.length);
    const direita = arvoreDaDireita(ids, { largura: area.largura * (1 - p), altura: area.altura }, minimo);
    const arvore = direita.arvore === null ? folha(orq) : divisao("vertical", p, folha(orq), direita.arvore);
    return { arvore, excedentes: [...direita.excedentes, ...passaramDoTeto], orquestradores: lista };
  }

  const cima = igual(lista.map(folha), "vertical");
  if (ids.length === 0) return { arvore: cima, excedentes: [...passaramDoTeto], orquestradores: lista };
  const baixo = arvoreDaLinhaDeBaixo(ids, { largura: area.largura, altura: area.altura * ALTURA_DA_LINHA_DE_BAIXO }, minimo);
  const arvore = baixo.arvore === null ? cima : divisao("horizontal", 1 - ALTURA_DA_LINHA_DE_BAIXO, cima, baixo.arvore);
  return { arvore, excedentes: [...baixo.excedentes, ...passaramDoTeto], orquestradores: lista };
}

/** Rótulo e cor (0..3) de cada nó para a UI: orquestrador "orq. A" (só quando há vários); worker "↳ orq. A" (sem a letra quando há um orquestrador só). Workers sem pai conhecido herdam o primeiro. */
export function rotulosDaOrquestracao(nos: readonly NoOrquestracao[]): Readonly<Record<string, { rotulo: string; cor: number }>> {
  const orqs = nos.filter((n) => n.papel === "orquestrador").sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
  const saida: Record<string, { rotulo: string; cor: number }> = {};
  const varios = orqs.length > 1;
  // um orquestrador só: o cabeçalho dele já diz "orquestrando" (sem chip); com vários, cada um leva a letra e a cor dos seus workers
  if (varios) orqs.forEach((o, i) => { saida[o.id] = { rotulo: `orq. ${letraDoOrquestrador(i)}`, cor: i % 4 }; });
  for (const w of nos) {
    if (w.papel !== "worker") continue;
    const i = Math.max(0, orqs.findIndex((o) => o.id === w.pai));
    saida[w.id] = { rotulo: varios ? `↳ orq. ${letraDoOrquestrador(i)}` : "↳ orq.", cor: i % 4 };
  }
  return saida;
}

export interface Retangulo { id: string; x: number; y: number; largura: number; altura: number }

/** Geometria de cada folha dentro de `area` (usada nos testes, nas capturas e em qualquer conferência de mínimos). */
export function retangulosDaArvore(arvore: NoPainel, area: Medida): Retangulo[] {
  const saida: Retangulo[] = [];
  const andar = (no: NoPainel, x: number, y: number, w: number, h: number): void => {
    if (no.tipo === "terminal") { saida.push({ id: no.sessao_id, x, y, largura: w, altura: h }); return; }
    const p = no.proporcao ?? 0.5;
    if (no.orientacao === "vertical") { andar(no.primeiro, x, y, w * p, h); andar(no.segundo, x + w * p, y, w * (1 - p), h); }
    else { andar(no.primeiro, x, y, w, h * p); andar(no.segundo, x, y + h * p, w, h * (1 - p)); }
  };
  andar(arvore, 0, 0, area.largura, area.altura);
  return saida;
}
