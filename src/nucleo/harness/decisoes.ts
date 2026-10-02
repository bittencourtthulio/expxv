// Decisões (Fase 9, T-09.17): registro de cada decisão do harness (tabelas `decisao` e `troca_log` pelos repositórios existentes,
// entrados por INTERFACE mínima), consulta paginada, retenção configurável e a função pura `explicar` em PT-BR (Pane e tela Consumo).
// Nada de rede e nada de segredo: todo texto que vai ao banco passa por `sanitizarTexto`; `resumo_enviado` só chega já redigido
// por quem falou com o decisor e é sanitizado de novo aqui.
import type { Decisao, DecisaoEntrada, PaginaDecisoes, PaginaTrocas, PedidoListarDecisoes, PedidoListarTrocas, PropositoDecisao, TotaisDecisoes, Troca, FonteDecisao, CustoOrigem } from "../../compartilhado/harness";
import type { NovaTroca, RegistroTroca } from "../banco/repos/troca-log";
import { sanitizarTexto, trocaParaLog, type DadosReciboTroca, type IdsTroca } from "./recibo";

/** Superfície mínima do repositório `decisao` (o real satisfaz; testes usam o banco real ou um dublê). */
export interface RepoDecisaoMinimo {
  inserir(d: DecisaoEntrada, instante?: string): Decisao;
  listar(op?: { desde?: string; proposito?: PropositoDecisao; cursor?: string; limite?: number }): { itens: Decisao[]; proximo: string | null };
  totais(desde?: string): TotaisDecisoes;
  compactar(antesDe: string, tamanhoLote?: number): number;
}
export interface RepoTrocaMinimo {
  inserir(d: NovaTroca, instante?: string): RegistroTroca;
  listar(op?: { desde?: string; cursor?: string; limite?: number; workspace_id?: string }): { itens: RegistroTroca[]; proximo: string | null };
}

export const RETENCAO_PADRAO_DIAS = 90;
export const RETENCAO_MIN_DIAS = 7;
export const RETENCAO_MAX_DIAS = 3650;
export const LIMITE_PAGINA_PADRAO = 50;
export const LIMITE_PAGINA_MAX = 200;
const DIA_MS = 86_400_000;

export const limitarRetencao = (dias: number): number => (Number.isFinite(dias) ? Math.min(RETENCAO_MAX_DIAS, Math.max(RETENCAO_MIN_DIAS, Math.round(dias))) : RETENCAO_PADRAO_DIAS);

/** Remove segredo e controle de TODO texto livre da decisão; `escolhida ∈ opcoes` é preservado (mesma sanitização nos dois). */
export function sanearDecisao(d: DecisaoEntrada): DecisaoEntrada {
  const t = (x: string): string => sanitizarTexto(x, 120);
  const opcoes = d.opcoes.map(t);
  return {
    ...d,
    opcoes,
    escolhida: t(d.escolhida),
    escolha_regra: d.escolha_regra === null ? null : t(d.escolha_regra),
    probs: d.probs === null ? null : Object.fromEntries(Object.entries(d.probs).map(([k, v]) => [t(k), v])),
    recibo: sanitizarTexto(d.recibo, 480) || "Decisão registrada.",
    resumo_enviado: d.resumo_enviado === null ? null : sanitizarTexto(d.resumo_enviado, 500),
    decisor: d.decisor === null ? null : { modo: sanitizarTexto(d.decisor.modo, 30), host: sanitizarTexto(d.decisor.host, 100), modelo: d.decisor.modelo === null ? null : sanitizarTexto(d.decisor.modelo, 100) },
  };
}

export interface ServicoDecisoes {
  /** Grava a decisão (sanitizada). Devolve a linha gravada. */
  registrar(d: DecisaoEntrada): Decisao;
  /** Grava uma troca (sugerida/feita/…); o recibo nasce de campos estruturados. */
  registrarTroca(ids: IdsTroca, dados: DadosReciboTroca, rotulos?: Readonly<Record<string, string>>): RegistroTroca;
  /** Paginado, mais recentes primeiro; `limite` entra em [1, 200]. */
  listar(pedido?: PedidoListarDecisoes): PaginaDecisoes;
  listarTrocas(pedido?: PedidoListarTrocas & { workspace_id?: string }): PaginaTrocas;
  /** Compacta o que passou da retenção (agregado por dia) e apaga o detalhe; devolve quantas foram compactadas. */
  aplicarRetencao(): number;
  retencaoDias(): number;
  definirRetencao(dias: number): number;
}

export interface OpcoesServicoDecisoes {
  decisoes: RepoDecisaoMinimo;
  trocas?: RepoTrocaMinimo;
  /** epoch ms (injetado; sem relógio aqui). */
  agora: () => number;
  retencaoDias?: number;
}

export function criarServicoDecisoes(o: OpcoesServicoDecisoes): ServicoDecisoes {
  let retencao = limitarRetencao(o.retencaoDias ?? RETENCAO_PADRAO_DIAS);
  const limite = (n: number | undefined): number => (n === undefined || !Number.isFinite(n) ? LIMITE_PAGINA_PADRAO : Math.min(LIMITE_PAGINA_MAX, Math.max(1, Math.floor(n))));
  const semUndef = <T extends Record<string, unknown>>(x: T): { [K in keyof T]?: Exclude<T[K], undefined> } => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
  return {
    registrar: (d) => o.decisoes.inserir(sanearDecisao(d)),
    registrarTroca(ids, dados, rotulos) {
      if (!o.trocas) throw new Error("repositório de trocas não configurado");
      return o.trocas.inserir(trocaParaLog(ids, dados, rotulos));
    },
    listar(p = {}) {
      const pg = o.decisoes.listar(semUndef({ desde: p.desde, proposito: p.proposito, cursor: p.cursor, limite: limite(p.limite) }));
      return { itens: pg.itens, proximo: pg.proximo, totais: o.decisoes.totais(p.desde) };
    },
    listarTrocas(p = {}) {
      if (!o.trocas) return { itens: [], proximo: null };
      const pg = o.trocas.listar(semUndef({ desde: p.desde, cursor: p.cursor, limite: limite(p.limite), workspace_id: p.workspace_id }));
      return { itens: pg.itens, proximo: pg.proximo };
    },
    aplicarRetencao: () => o.decisoes.compactar(new Date(o.agora() - retencao * DIA_MS).toISOString()),
    retencaoDias: () => retencao,
    definirRetencao(dias) {
      retencao = limitarRetencao(dias);
      return retencao;
    },
  };
}

// ---- explicar (PURO, PT-BR) ----
const ROTULO_PROPOSITO: Readonly<Record<PropositoDecisao, string>> = {
  selecao_conta: "Seleção de conta",
  task_type: "Tipo de tarefa",
  modelo_esforco: "Modelo e esforço",
  troca: "Troca por consumo",
  intencao: "Intenção do pedido",
};
const TEXTO_FONTE: Readonly<Record<FonteDecisao, string>> = {
  decisor: "o decisor externo",
  regra: "a regra determinística",
  politica: "a política do tipo de tarefa",
  explicito: "o que foi pedido explicitamente",
  fallback: "o plano B (alternativa ou regra de reserva)",
};
const TEXTO_CUSTO: Readonly<Record<CustoOrigem, string>> = { resposta: "informado pela resposta", tabela: "estimado pela tabela de preços", informado: "informado por você", desconhecido: "origem desconhecida" };

const num = (n: number, casas: number): string => n.toFixed(casas).replace(".", ",");
const usd = (n: number): string => {
  let s = n.toFixed(6);
  while (s.endsWith("0") && s.length - s.indexOf(".") - 1 > 4) s = s.slice(0, -1);
  return `US$ ${s.replace(".", ",")}`;
};

/**
 * Explica uma decisão em português claro, em 2 a 5 frases curtas. Pura e determinística. Custo/consumo desconhecido nunca vira zero:
 * escreve "custo desconhecido". Nunca inclui nada além do que já está na decisão (que já foi sanitizada ao gravar).
 */
export function explicar(d: Decisao): string {
  const partes: string[] = [];
  const outras = d.opcoes.length - 1;
  const dentre = outras > 0 ? ` entre ${d.opcoes.length} opções` : "";
  const conf = d.confianca === null ? "" : `, com confiança de ${Math.round(d.confianca * 100)}%`;
  partes.push(`${ROTULO_PROPOSITO[d.proposito]}: escolheu «${d.escolhida}»${dentre}, por ${TEXTO_FONTE[d.fonte]}${conf}.`);
  if (d.divergiu) partes.push(`A regra determinística escolheria «${d.escolha_regra ?? "—"}», mas a decisão divergiu dela.`);
  else if (d.fonte === "fallback" && d.escolha_regra !== null && d.escolha_regra !== d.escolhida) partes.push(`A regra de reserva escolheu «${d.escolha_regra}».`);
  if (d.probs !== null) {
    const topo = Object.entries(d.probs)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([k, v]) => `${k} ${Math.round(v * 100)}%`);
    if (topo.length > 0) partes.push(`Probabilidades: ${topo.join(", ")}.`);
  }
  if (d.decisor !== null) partes.push(`Consultou o decisor ${d.decisor.modelo ?? "padrão"} em ${d.decisor.host}${d.latencia_ms === null ? "" : ` (${Math.round(d.latencia_ms)} ms)`}.`);
  partes.push(d.resumo_enviado === null ? "Nada saiu da máquina." : `Foi enviado ao decisor: «${d.resumo_enviado}».`);
  partes.push(d.custo_usd === null ? "Custo desconhecido." : `Custo: ${usd(d.custo_usd)}${d.custo_origem === null ? "" : ` (${TEXTO_CUSTO[d.custo_origem]})`}.`);
  if (d.skills_aplicadas) partes.push("As skills da política foram aplicadas.");
  partes.push(`Recibo: ${d.recibo}`);
  return partes.join(" ");
}

const TEXTO_STATUS_TROCA: Readonly<Record<Troca["status"], string>> = { sugerida: "Troca sugerida", feita: "Troca feita", ignorada: "Troca ignorada", adiada: "Troca adiada", falhou: "Troca falhou" };
/** Explica uma troca registrada: o recibo (já em PT-BR, sem segredo) com o consumo medido, ou "sem dado de limite". */
export function explicarTroca(t: Troca): string {
  const c = (n: number | null): string => (n === null ? "sem dado de limite" : `${num(n, n % 1 === 0 ? 0 : 1)}% usado`);
  return `${TEXTO_STATUS_TROCA[t.status]} (${t.modo.replace("_", " ")}). Origem: ${c(t.consumo_origem_pct)}; destino: ${c(t.consumo_destino_pct)}. ${t.recibo}`;
}
