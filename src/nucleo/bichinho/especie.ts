// Escolha DETERMINÍSTICA e EXPLICÁVEL da espécie (D-461, D-672): pontua cada espécie pelos sinais do projeto (listas de afinidade em `afinidades.ts`)
// e, na ATRIBUIÇÃO, escolhe a mais afim ainda LIVRE entre os workspaces conhecidos (sem repetir espécie nas primeiras 100). Empate por hash estável.
// Pontos: linguagem = 10 × peso relativo × degrau da posição na lista (a dominante vale 10); tipo = `forca` (4 ou 12) × degrau; framework = 5 × degrau.
// Tudo zero (pasta vazia, sem marca): ordem estável pelo hash sobre o catálogo inteiro, avisada em `motivo`. A troca manual vence sempre.
import { ESPECIES, ESPECIES_LEGADAS, VARIANTES_MAX, type EspecieId } from "../../compartilhado/bichinho";
import { AFINIDADE_FRAMEWORK, AFINIDADE_LINGUAGEM, AFINIDADE_TIPO, DEGRAUS, PONTOS_FRAMEWORK } from "./afinidades";
import { CATALOGO } from "./catalogo";
import type { LinguagemId, SinaisProjeto, TipoProjeto } from "./sinais";

/** Preferida de cada linguagem e de cada tipo (a 1ª da lista de afinidade): as 14 originais continuam preferidas para as suas stacks. */
export const ESPECIE_DA_LINGUAGEM: Readonly<Partial<Record<LinguagemId, EspecieId>>> = Object.fromEntries(
  (Object.entries(AFINIDADE_LINGUAGEM) as Array<[LinguagemId, readonly EspecieId[]]>).map(([l, lista]) => [l, lista[0]]),
);

export const ESPECIE_DO_TIPO: Readonly<Partial<Record<TipoProjeto, EspecieId>>> = Object.fromEntries(
  (Object.entries(AFINIDADE_TIPO) as Array<[TipoProjeto, readonly EspecieId[]]>).map(([t, lista]) => [t, lista[0]]),
);

const NOME_LINGUAGEM: Record<LinguagemId, string> = {
  rust: "Rust", python: "Python", go: "Go", javascript: "JavaScript", typescript: "TypeScript", java: "Java", kotlin: "Kotlin", csharp: "C#/.NET", php: "PHP", ruby: "Ruby",
  c: "C", cpp: "C++", swift: "Swift", dart: "Dart", shell: "Shell", hcl: "Terraform", markdown: "Markdown",
};

/** FNV-1a de 32 bits sobre o texto em UTF-8: estável entre execuções e máquinas (mesma função do personagem de referência). */
export function hashEstavel(texto: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(texto)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface ResultadoEspecie {
  especie: EspecieId;
  /** `true` quando nenhum sinal pontuou (sorteio estável pelo nome). */
  sem_sinais: boolean;
  pontos: Record<EspecieId, number>;
  motivo: string[];
}

const arred = (n: number): number => Math.round(n * 100) / 100;
const minusculo = (e: EspecieId): string => CATALOGO[e].rotulo.toLowerCase();

export interface Pontuacao {
  /** pontos "de preferência" (D-461): só a espécie preferida (1ª da lista) de linguagens e tipos que mapeiam para as 14 originais. Manda na ordem. */
  legado: Record<EspecieId, number>;
  /** pontos de afinidade (todas as listas, com degraus) e de frameworks: ordenam o resto e desempatam. */
  afinidade: Record<EspecieId, number>;
  motivo: string[];
}

/**
 * Pontos de TODAS as espécies pelos sinais. A ordem é lexicográfica (legado, afinidade, hash): assim as 14 originais continuam as preferidas para as
 * suas stacks, e as outras 86 ocupam, por afinidade, a "fila" de quando a preferida já está em uso.
 */
export function pontuarEspecies(sinais: SinaisProjeto): Pontuacao {
  const zerado = (): Record<EspecieId, number> => Object.fromEntries(ESPECIES.map((e) => [e, 0])) as Record<EspecieId, number>;
  const legado = zerado();
  const afinidade = zerado();
  const motivo: string[] = [];
  const dar = (lista: readonly EspecieId[], base: number): void => lista.forEach((e, i) => { afinidade[e] += base * (DEGRAUS[i] ?? 0); });
  for (const l of sinais.linguagens) {
    const lista = AFINIDADE_LINGUAGEM[l.id];
    const p = arred(10 * l.peso);
    dar(lista, p);
    const primeira = lista[0];
    if (primeira !== undefined && p > 0) {
      if (ESPECIES_LEGADAS.includes(primeira)) legado[primeira] += p;
      motivo.push(`${NOME_LINGUAGEM[l.id]} (${Math.round(l.peso * 100)}% do peso) conta ${p} ponto${p === 1 ? "" : "s"} para ${minusculo(primeira)}`);
    }
  }
  for (const t of sinais.tipos) {
    const lista = AFINIDADE_TIPO[t.tipo];
    dar(lista, t.forca);
    const primeira = lista[0];
    if (primeira !== undefined && ESPECIES_LEGADAS.includes(primeira)) {
      legado[primeira] += t.forca;
      motivo.push(`Projeto de ${t.tipo} (${t.por}) conta ${t.forca} pontos para ${minusculo(primeira)}`);
    }
  }
  for (const f of sinais.frameworks) {
    const lista = AFINIDADE_FRAMEWORK[f];
    if (lista !== undefined) dar(lista, PONTOS_FRAMEWORK);
  }
  for (const e of ESPECIES) { legado[e] = arred(legado[e]); afinidade[e] = arred(afinidade[e]); }
  return { legado, afinidade, motivo };
}

export function escolherEspecie(sinais: SinaisProjeto, nomeProjeto: string): ResultadoEspecie {
  const { legado, afinidade, motivo } = pontuarEspecies(sinais);
  const pontos = Object.fromEntries(ESPECIES.map((e) => [e, arred(legado[e] + afinidade[e])])) as Record<EspecieId, number>;
  const maxLegado = Math.max(...ESPECIES.map((e) => legado[e]));
  const maxAfin = Math.max(...ESPECIES.map((e) => afinidade[e]));
  const semSinais = maxLegado <= 0 && maxAfin <= 0;
  const chave = maxLegado > 0 ? legado : afinidade;
  const topo = maxLegado > 0 ? maxLegado : maxAfin;
  const candidatas = semSinais ? [...ESPECIES] : ESPECIES.filter((e) => chave[e] === topo);
  const escolhida = candidatas[hashEstavel(nomeProjeto) % candidatas.length]!;
  if (semSinais) motivo.push("Nenhum sinal de stack encontrado: espécie sorteada de forma estável pelo nome do projeto");
  else if (candidatas.length > 1) motivo.push(`Empate entre ${candidatas.map((c) => minusculo(c)).join(" e ")}: desempate pelo nome do projeto`);
  return { especie: escolhida, sem_sinais: semSinais, pontos, motivo };
}

function ordenar(p: Pontuacao, nomeProjeto: string, workspaceId: string): EspecieId[] {
  // o hash de cada espécie é calculado UMA vez (não dentro do comparador: n log n hashes por atribuição seria desperdício)
  const h = new Map<EspecieId, number>(ESPECIES.map((e) => [e, hashEstavel(`${nomeProjeto}\u0000${workspaceId}\u0000${e}`)]));
  return [...ESPECIES].sort((a, b) => p.legado[b] - p.legado[a] || p.afinidade[b] - p.afinidade[a] || h.get(a)! - h.get(b)! || (a < b ? -1 : 1));
}

/** As 100 espécies da mais para a menos afim; empate pelo hash estável de (nome do workspace + id + espécie). */
export function classificarEspecies(sinais: SinaisProjeto, nomeProjeto: string, workspaceId: string): EspecieId[] {
  return ordenar(pontuarEspecies(sinais), nomeProjeto, workspaceId);
}

export interface EntradaAtribuicao {
  sinais: SinaisProjeto;
  nome: string;
  workspaceId: string;
  /** quantos OUTROS workspaces conhecidos já usam cada espécie (ausente = livre). */
  usos: ReadonlyMap<EspecieId, number>;
  /** `false` = preferência "Sem repetir espécie" desligada: vale a mais afim, usada ou não. Padrão `true`. */
  semRepetir?: boolean;
}

export interface Atribuicao {
  especie: EspecieId;
  /** 0 = original; > 0 só quando as 100 espécies estão em uso e esta se repete (paleta rotacionada e marca extra). */
  variante: number;
  /** a mais afim ignorando o uso (para explicar o desvio). */
  ideal: EspecieId;
  repetiu: boolean;
  motivo: string[];
}

/** Variante da n-ésima repetição de uma espécie: 1, 2, 3, 1, 2, 3… (a original é a 0). */
export const varianteDaRepeticao = (usosExistentes: number): number => (usosExistentes <= 0 ? 0 : ((usosExistentes - 1) % (VARIANTES_MAX - 1)) + 1);

/**
 * Atribuição SEM REPETIÇÃO (D-672): a mais afim ainda não usada por outro workspace; a ordem é estável (pontos, depois hash). Só quando as 100 estão
 * em uso a repetição é permitida, e vai para a menos repetida entre as mais afins, ganhando uma VARIANTE visual.
 */
export function atribuirEspecie(e: EntradaAtribuicao): Atribuicao {
  const pont = pontuarEspecies(e.sinais);
  const ordem = ordenar(pont, e.nome, e.workspaceId);
  const ideal = ordem[0]!;
  const motivo = [...pont.motivo];
  if (ESPECIES.every((x) => pont.legado[x] <= 0 && pont.afinidade[x] <= 0)) motivo.push("Nenhum sinal de stack encontrado: espécie escolhida de forma estável pelo nome do projeto");
  if (e.semRepetir === false) return { especie: ideal, variante: 0, ideal, repetiu: false, motivo };
  const uso = (x: EspecieId): number => e.usos.get(x) ?? 0;
  const livre = ordem.find((x) => uso(x) === 0);
  if (livre !== undefined) {
    if (livre !== ideal) motivo.push(`A mais afim (${minusculo(ideal)}) já está em uso em outro workspace: ficou a próxima mais afim livre, ${minusculo(livre)}`);
    return { especie: livre, variante: 0, ideal, repetiu: false, motivo };
  }
  const menor = Math.min(...ordem.map(uso));
  const escolhida = ordem.find((x) => uso(x) === menor)!;
  motivo.push(`As ${ESPECIES.length} espécies já estão em uso: ${minusculo(escolhida)} se repete, com visual próprio`);
  return { especie: escolhida, variante: varianteDaRepeticao(menor), ideal, repetiu: true, motivo };
}

/** A troca manual do dono vence a automática; `null` volta ao automático. */
export const especieEfetiva = (automatica: EspecieId, manual: EspecieId | null): EspecieId => manual ?? automatica;
