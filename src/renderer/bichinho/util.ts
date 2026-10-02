// Funções puras do Bichinho no renderer: rótulo de acessibilidade, formatação de contagens e posição do popover.
import type { BichinhoVisao, EstagioId, HumorId, NivelEsforco, OvoVisao } from "../../compartilhado/bichinho";
import { CATALOGO } from "../../nucleo/bichinho/catalogo";
import { descreverEsforco } from "../../nucleo/bichinho/esforco";

export const ROTULO_ESTAGIO: Readonly<Record<EstagioId, string>> = { ovo: "ovo", filhote: "filhote", jovem: "jovem", adulto: "adulto", veterano: "veterano", lendario: "lendário" };

export const ROTULO_HUMOR: Readonly<Record<HumorId, string>> = {
  ocioso: "parado", dormindo: "dormindo", curioso: "curioso", trabalhando: "trabalhando", pensando: "pensando", aguardando: "esperando você",
  comemorando: "comemorando", preocupado: "preocupado",
};

/** "Bichinho do projeto X: raposa, jovem, trabalhando" (+ apelido e cota alta quando houver). A cor nunca é o único sinal. */
export function rotuloDoBichinho(v: Pick<BichinhoVisao, "especie" | "estagio" | "humor" | "doente" | "apelido"> & { esforco?: BichinhoVisao["esforco"]; ovo?: BichinhoVisao["ovo"] }, nomeProjeto: string | null): string {
  const base = `Bichinho${nomeProjeto === null ? "" : ` do projeto ${nomeProjeto}`}${v.apelido === null ? "" : `, chamado ${v.apelido}`}: ${CATALOGO[v.especie].rotulo.toLowerCase()}, ${ROTULO_ESTAGIO[v.estagio]}, ${ROTULO_HUMOR[v.humor]}`;
  const n = nivelDaVisao(v as never);
  const comOvo = v.ovo === null || v.ovo === undefined ? base : `${base}, ${textoOvo(v.ovo).toLowerCase()}`;
  const comEsforco = n >= 3 ? `${comOvo}, esforço ${NIVEIS_ESFORCO_ROTULO[n]}` : comOvo;
  return v.doente ? `${comEsforco}, com a cota de consumo alta` : comEsforco;
}

const um = (n: number): string => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
/** 950 → "950"; 12 300 → "12,3 mil"; 4 500 000 → "4,5 mi"; 1,2 bilhão → "1,2 bi". */
export function formatarContagem(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${um(n / 1_000)} mil`;
  if (n < 1_000_000_000) return `${um(n / 1_000_000)} mi`;
  return `${um(n / 1_000_000_000)} bi`;
}

export interface Retangulo { left: number; right: number; top: number; bottom: number }

/** Popover fixo ao lado do bichinho: à direita se couber, senão à esquerda; alinhado pela base e preso à janela. */
export function posicionarPopover(ancora: Retangulo, janela: { largura: number; altura: number }, popover = { largura: 268, altura: 360 }, folga = 8): { left: number; bottom: number } {
  const cabeDireita = ancora.right + folga + popover.largura <= janela.largura - folga;
  const left = cabeDireita ? ancora.right + folga : Math.max(folga, ancora.left - folga - popover.largura);
  const bottomIdeal = janela.altura - ancora.bottom;
  const bottom = Math.min(Math.max(folga, bottomIdeal), Math.max(folga, janela.altura - popover.altura - folga));
  return { left: Math.round(left), bottom: Math.round(bottom) };
}

/**
 * Perfil de movimento por nível de esforço (D-502): `ciclo` em segundos (menor = mais rápido) e `amp` (multiplicador da amplitude). O CSS lê as duas
 * variáveis; a tabela é a única fonte (testada), então velocidade e amplitude crescem juntas e de forma monotônica.
 */
export const PERFIL_MOVIMENTO: Readonly<Record<NivelEsforco, { ciclo: number; amp: number }>> = {
  0: { ciclo: 0, amp: 0 },
  1: { ciclo: 2.4, amp: 0.3 },
  2: { ciclo: 0.56, amp: 1 },
  3: { ciclo: 0.34, amp: 2.2 },
  4: { ciclo: 0.19, amp: 3.6 },
};
export const perfilMovimento = (n: NivelEsforco): { ciclo: number; amp: number } => PERFIL_MOVIMENTO[n];

/** Nível exibido de uma visão (dormindo = 0; trabalhando vale no mínimo 2). Visões sem o campo (versões antigas do main) caem no humor. */
export function nivelDaVisao(v: Pick<BichinhoVisao, "humor"> & { esforco?: BichinhoVisao["esforco"] }): NivelEsforco {
  if (v.humor === "dormindo") return 0;
  const n = v.esforco?.nivel ?? 0;
  return v.humor === "trabalhando" ? (Math.max(2, n) as NivelEsforco) : n;
}

/** "acelerado · ~4,2 mil tokens/min" (medido) ou "acelerado · saída intensa" (estimado). Só números agregados: nada sensível. */
export function textoEsforco(v: Pick<BichinhoVisao, "humor"> & { esforco?: BichinhoVisao["esforco"] }): string {
  const e = v.esforco;
  return descreverEsforco(nivelDaVisao(v), e?.origem ?? "estado", e?.tokens_por_min ?? null, formatarContagem);
}
const NIVEIS_ESFORCO_ROTULO: Readonly<Record<NivelEsforco, string>> = { 0: "parado", 1: "atento", 2: "trabalhando", 3: "acelerado", 4: "frenético" };

/** "Ovo: 2/4 tarefas · 80 mil/150 mil tokens (50%)": o progresso de choque (D-671), só números agregados. */
export function textoOvo(o: OvoVisao): string {
  return `Ovo: ${o.tarefas}/${o.meta_tarefas} tarefas · ${formatarContagem(o.tokens)}/${formatarContagem(o.piso_tokens)} tokens (${o.progresso}%)`;
}

/** O que ainda falta para o ovo chocar, em português corrido ("2 tarefas e 70 mil tokens"); `null` quando nada falta. */
export function faltaParaChocar(o: OvoVisao): string | null {
  const t = Math.max(0, o.meta_tarefas - o.tarefas);
  const k = Math.max(0, o.piso_tokens - o.tokens);
  const partes = [...(t > 0 ? [`${t} tarefa${t === 1 ? "" : "s"}`] : []), ...(k > 0 ? [`${formatarContagem(k)} tokens`] : [])];
  return partes.length === 0 ? null : partes.join(" e ");
}

/** Texto de apoio (title) do bichinho: o ovo mostra o progresso de choque; o resto, o esforço de agora. */
export function dicaDoBichinho(v: Pick<BichinhoVisao, "humor" | "ovo"> & { esforco?: BichinhoVisao["esforco"] }): string {
  return v.ovo === null || v.ovo === undefined ? `Agora: ${textoEsforco(v)}` : `${textoOvo(v.ovo)} · Agora: ${textoEsforco(v)}`;
}
