// Esforço do Bichinho (D-500…): quão forte o workspace está trabalhando AGORA, sem depender de adaptador de CLI. PURO (sem relógio, sem timer, sem I/O).
// Entradas baratas: vazão de saída do PTY por sessão (bytes e linhas numa janela deslizante curta, sem guardar conteúdo), entrada recente do usuário,
// tokens/min medidos (leitores de transcript) e quantas sessões estão fluindo. Saída: nível 0–4 com histerese (sobe rápido, desce devagar).
import { NIVEIS_ESFORCO, type NivelEsforco, type OrigemEsforco } from "../../compartilhado/bichinho";

export { NIVEIS_ESFORCO };
export type { NivelEsforco, OrigemEsforco };

/** Janela deslizante da vazão do PTY e tamanho do balde (8 baldes de 500 ms). */
export const JANELA_VAZAO_MS = 4_000;
export const BALDE_VAZAO_MS = 500;
/** Janela dos tokens/min. */
export const JANELA_TOKENS_MS = 60_000;
/** Enquanto houve saída, entrada ou consumo há menos que isto, o bichinho nunca fica abaixo de "atento" (nem dorme). */
export const ATIVIDADE_RECENTE_MS = 20_000;
/** Desce no máximo UM nível a cada tanto (subir é imediato). */
export const DESCER_NIVEL_MS = 6_000;

/** Limiares dos níveis 1…4. Escala logarítmica (cada degrau ≈ ×5 a ×20): tokens/min medidos e bytes/s de saída do PTY. */
export const LIMIARES_TOKENS_MIN: readonly number[] = [1, 500, 2_500, 12_000];
export const LIMIARES_BYTES_S: readonly number[] = [1, 30, 600, 4_000];
/** Sessões fluindo ao mesmo tempo que empurram um nível acima (equipe de agentes trabalhando junta). */
export const SESSOES_BONUS = 3;

const contar = (v: number, limiares: readonly number[]): number => limiares.reduce((n, l) => (v >= l ? n + 1 : n), 0);
const nivelDe = (n: number): NivelEsforco => Math.max(0, Math.min(4, Math.round(n))) as NivelEsforco;

export const nivelPorTokens = (tokensPorMin: number): NivelEsforco => nivelDe(Number.isFinite(tokensPorMin) ? contar(tokensPorMin, LIMIARES_TOKENS_MIN) : 0);
export const nivelPorBytes = (bytesPorS: number): NivelEsforco => nivelDe(Number.isFinite(bytesPorS) ? contar(bytesPorS, LIMIARES_BYTES_S) : 0);

export interface EntradaNivel {
  /** `null` = nenhuma fonte medida (cai na saída do PTY, rotulada "estimado"). */
  tokensPorMin: number | null;
  bytesPorS: number;
  sessoesFluindo: number;
  entradaRecente: boolean;
}

/** Nível instantâneo (sem histerese) pela taxa combinada. */
export function nivelBruto(e: EntradaNivel): { nivel: NivelEsforco; origem: OrigemEsforco } {
  const nt = e.tokensPorMin === null ? 0 : nivelPorTokens(e.tokensPorMin);
  const nb = nivelPorBytes(e.bytesPorS);
  let base = Math.max(nt, nb);
  if (base === 0 && e.entradaRecente) base = 1;
  if (base >= 1 && e.sessoesFluindo >= SESSOES_BONUS) base += 1;
  const origem: OrigemEsforco = base === 0 ? "nenhuma" : nt >= nb && nt > 0 ? "medido" : "estimado";
  return { nivel: nivelDe(base), origem };
}

/** Contador de vazão de UMA sessão: baldes de 500 ms num anel. Só números; nunca guarda o conteúdo. */
export interface ContadorVazao {
  registrar(bytes: number, linhas: number, agora: number): void;
  taxa(agora: number): { bytesPorS: number; linhasPorS: number };
  /** instante do último registro (0 = nunca). */
  readonly ultimoEm: number;
}

export function criarContadorVazao(janelaMs = JANELA_VAZAO_MS, baldeMs = BALDE_VAZAO_MS): ContadorVazao {
  const n = Math.max(1, Math.round(janelaMs / baldeMs));
  const marca = new Array<number>(n).fill(-1);
  const bytes = new Array<number>(n).fill(0);
  const linhas = new Array<number>(n).fill(0);
  let ultimo = 0;
  return {
    registrar(b, l, agora) {
      const id = Math.floor(agora / baldeMs);
      const i = ((id % n) + n) % n;
      if (marca[i] !== id) { marca[i] = id; bytes[i] = 0; linhas[i] = 0; }
      bytes[i]! += Math.max(0, b);
      linhas[i]! += Math.max(0, l);
      ultimo = agora;
    },
    taxa(agora) {
      const id = Math.floor(agora / baldeMs);
      let sb = 0;
      let sl = 0;
      for (let i = 0; i < n; i++) {
        const m = marca[i]!;
        if (m >= 0 && id - m >= 0 && id - m < n) { sb += bytes[i]!; sl += linhas[i]!; }
      }
      const s = (n * baldeMs) / 1000;
      return { bytesPorS: sb / s, linhasPorS: sl / s };
    },
    get ultimoEm() { return ultimo; },
  };
}

/** Tokens/min numa janela deslizante (60 s). */
export interface JanelaTokens {
  somar(tokens: number, agora: number): void;
  porMinuto(agora: number): number;
  /** instante do último consumo (0 = nunca). */
  readonly ultimoEm: number;
}

export function criarJanelaTokens(janelaMs = JANELA_TOKENS_MS): JanelaTokens {
  let itens: Array<{ t: number; n: number }> = [];
  let ultimo = 0;
  const podar = (agora: number): void => { if (itens.length > 0 && agora - itens[0]!.t >= janelaMs) itens = itens.filter((i) => agora - i.t < janelaMs); };
  return {
    somar(tokens, agora) {
      if (!Number.isFinite(tokens) || tokens <= 0) return;
      podar(agora);
      itens.push({ t: agora, n: tokens });
      ultimo = agora;
    },
    porMinuto(agora) {
      podar(agora);
      return itens.reduce((s, i) => s + i.n, 0) * (60_000 / janelaMs);
    },
    get ultimoEm() { return ultimo; },
  };
}

/** Histerese: sobe na hora; desce um nível por `DESCER_NIVEL_MS`; com atividade < 20 s o piso é "atento". */
export interface AvaliadorEsforco {
  avaliar(bruto: NivelEsforco, atividadeEm: number, agora: number): NivelEsforco;
  readonly nivel: NivelEsforco;
}

export function criarAvaliadorEsforco(descerMs = DESCER_NIVEL_MS): AvaliadorEsforco {
  let nivel: NivelEsforco = 0;
  let desde = 0;
  return {
    avaliar(bruto, atividadeEm, agora) {
      const piso: NivelEsforco = atividadeEm > 0 && agora - atividadeEm < ATIVIDADE_RECENTE_MS ? 1 : 0;
      const alvo = Math.max(bruto, piso);
      if (alvo >= nivel) { nivel = alvo as NivelEsforco; desde = agora; }
      else if (agora - desde >= descerMs) { nivel = (nivel - 1) as NivelEsforco; desde = agora; }
      return nivel;
    },
    get nivel() { return nivel; },
  };
}

/** Texto do tooltip e do popover, sem dado sensível: "acelerado · ~4,2 mil tokens/min" ou "acelerado · saída intensa". */
export function descreverEsforco(nivel: NivelEsforco, origem: OrigemEsforco, tokensPorMin: number | null, formatar: (n: number) => string): string {
  const nome = NIVEIS_ESFORCO[nivel];
  if (nivel === 0 || origem === "estado") return nome;
  if (origem === "medido" && tokensPorMin !== null && tokensPorMin >= 1) return `${nome} · ~${formatar(tokensPorMin)} tokens/min`;
  return `${nome} · ${nivel >= 3 ? "saída intensa" : nivel === 2 ? "saída contínua" : "atividade recente"}`;
}
