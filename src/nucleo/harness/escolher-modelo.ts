// pickModel (Fase 9, T-09.13, D-102): escolhe modelo/provedor/conta CHAMANDO `pickAccount` (nenhuma regra de conta é repetida aqui).
// PURA e determinística: dados injetados, sem I/O, sem `Date.now()`, sem aleatoriedade. Só importa tipos, `escolher-conta`,
// a consulta pura de `equivalencia` e o formatador puro de `recibo`.
// Ordem: (1) mesma conta se ainda boa → (2) outra conta do mesmo provedor → (3) mesma faixa em outro provedor (openrouter por último,
// só com CLI compatível) → (4) faixa inferior conforme `faixa_minima` (descer_1 / qualquer) → (5) `sem_alternativa`.
import type { CandidataConta, EntradaEquivalencia, Faixa, MotivoDescarte, OpcoesModelo, OpcoesPick, ResultadoModelo, ResultadoPick } from "../../compartilhado/harness";
import { equivalentes, PROVEDOR_OPENROUTER, type Equivalente } from "./equivalencia";
import { medirUso, pickAccount } from "./escolher-conta";
import { reciboModelo, type BloqueioModelo } from "./recibo";

/** Teto absoluto de saltos por task (P-28). */
export const MAX_SALTOS_TASK = 3;
/** Intervalo mínimo entre trocas do mesmo Pane (anti vai-e-volta): 10 min. */
export const INTERVALO_MIN_ENTRE_TROCAS_MS = 600_000;

/** Parâmetros além do contrato `OpcoesModelo` (todos opcionais; padrões seguros). */
export interface OpcoesModeloExtras {
  /** trocas já feitas nesta task. */
  saltos?: number;
  /** configurado; nunca passa de `MAX_SALTOS_TASK`. */
  max_saltos?: number;
  /** epoch ms da última troca deste Pane. */
  ultima_troca_em?: number | null;
  intervalo_min_entre_trocas_ms?: number;
  /** a operação em curso não se retoma (git em andamento, handoff em voo, pergunta ao humano): NUNCA troca sem `confirmouRisco`. */
  operacaoNaoRetomavel?: boolean;
  confirmouRisco?: boolean;
}
export type Confianca = "alta" | "media" | "baixa";
export interface ResultadoModeloDetalhado extends ResultadoModelo {
  confianca: Confianca;
  avisos: string[];
  /** por que NÃO trocou, quando uma regra de segurança impediu. */
  bloqueio: BloqueioModelo;
  tipo_troca: "outra_conta" | "outro_provedor" | "faixa_inferior" | null;
  consumo_origem_pct: number | null;
  consumo_destino_pct: number | null;
  /** o "recibo": motivo em texto (≤ 240 caracteres, sem segredos); quem tem os rótulos pode regenerar com `reciboModelo`. */
  recibo: string;
}

type Tier = 1 | 2 | 3 | 4;
interface Achado {
  provedor: string;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
  conta_id: string;
  tier: Tier;
  used: number | null;
  janela: string | null;
  confirmado: boolean;
}

const chavePick = (provedor: string, modelo: string | null): string => `${provedor}:${modelo ?? "default"}`;
const CONFIANCA_DO_TIER: Readonly<Record<Tier, Confianca>> = { 1: "alta", 2: "media", 3: "baixa", 4: "baixa" };
const minConf = (a: Confianca, b: Confianca): Confianca => (a === "baixa" || b === "baixa" ? "baixa" : a === "media" || b === "media" ? "media" : "alta");

export function pickModel(contasPorProvedor: Readonly<Record<string, readonly CandidataConta[]>>, equiv: EntradaEquivalencia, opcoes: OpcoesModelo & OpcoesModeloExtras): ResultadoModeloDetalhado {
  const o = opcoes;
  const picks: Record<string, ResultadoPick> = {};
  const avisos: string[] = [];
  const considerados: ResultadoModelo["ranking"] = [];
  const contasDe = (p: string): readonly CandidataConta[] => contasPorProvedor[p] ?? [];
  const viaveis = o.provedores_viaveis;
  const opcoesPick = (modelo: string | null, excluir: string[]): OpcoesPick => ({
    modelo,
    papel: o.papel,
    workspace_id: o.workspace_id,
    agora: o.agora,
    limiar_esgotamento_pct: o.limiar_esgotamento_pct,
    limiar_troca_pct: o.limiar_troca_pct,
    estrategia: o.estrategia,
    janela: o.janela,
    conta_fixa_id: o.conta_fixa_id,
    evitar_reservadas: o.evitar_reservadas,
    excluir,
  });
  const cliDe = (p: string): string | null => (p === PROVEDOR_OPENROUTER ? (o.clis_openrouter[0] ?? null) : p);
  const pickDe = (provedor: string, modelo: string | null, excluir: string[]): ResultadoPick => {
    const k = chavePick(provedor, modelo);
    const cache = picks[k];
    if (cache && excluir.length === o.excluir_contas.length) return cache;
    const r = pickAccount(contasDe(provedor), opcoesPick(modelo, excluir));
    if (excluir.length === o.excluir_contas.length) picks[k] = r;
    else picks[`${k}#sem_atual`] = r;
    return r;
  };
  const usadoDe = (provedor: string, conta_id: string, modelo: string | null): { used: number | null; janela: string | null } => {
    const c = contasDe(provedor).find((x) => x.conta_id === conta_id);
    const g = c ? medirUso(c, opcoesPick(modelo, [])).gargalo : null;
    return { used: g?.used_pct ?? null, janela: g?.kind ?? null };
  };

  // ---- estado da conta atual ----
  const atual = o.atual;
  const atualViavel = viaveis.includes(atual.provedor);
  const pAtual = atualViavel ? pickDe(atual.provedor, atual.modelo, [...o.excluir_contas]) : null;
  const contaAtualId = o.trocando ? atual.conta_id : null;
  const entradaAtual = contaAtualId !== null && pAtual ? pAtual.ranking.find((r) => r.conta_id === contaAtualId) : undefined;
  const descarteAtual: MotivoDescarte | undefined = contaAtualId !== null && pAtual ? pAtual.descartadas.find((d) => d.conta_id === contaAtualId)?.motivo : undefined;
  const existeAtual = contaAtualId !== null && contasDe(atual.provedor).some((c) => c.conta_id === contaAtualId);
  const usoAtual = contaAtualId !== null ? usadoDe(atual.provedor, contaAtualId, atual.modelo) : { used: null, janela: null };
  // sem capacidade = a conta atual não pode continuar (esgotada, em cooldown, auth, desabilitada…)
  const semCapacidade = existeAtual && descarteAtual !== undefined;
  const origemUsed = usoAtual.used ?? (semCapacidade && (descarteAtual === "esgotada" || descarteAtual === "modelo_esgotado") ? o.limiar_esgotamento_pct : null);

  const fim = (escolhida: Achado | null, motivo: ResultadoModelo["motivo"], extra: { bloqueio?: BloqueioModelo; confianca?: Confianca } = {}): ResultadoModeloDetalhado => {
    const bloqueio = extra.bloqueio ?? null;
    const mesmoItem = (r: ResultadoModelo["ranking"][number]): boolean => escolhida !== null && r.conta_id === escolhida.conta_id && r.provedor === escolhida.provedor && r.modelo === escolhida.modelo;
    const vistosRanking = new Set<string>();
    const ranking = considerados.filter((r) => {
      const k = `${r.provedor}|${r.modelo ?? ""}|${r.conta_id}`;
      if (vistosRanking.has(k)) return false;
      vistosRanking.add(k);
      return true;
    });
    ranking.sort((a, b) => Number(mesmoItem(b)) - Number(mesmoItem(a)));
    let confianca: Confianca = escolhida ? CONFIANCA_DO_TIER[escolhida.tier] : "baixa";
    if (escolhida && motivo === "outro_provedor") confianca = minConf(confianca, escolhida.confirmado ? "media" : "baixa");
    if (escolhida && motivo === "faixa_inferior") confianca = "baixa";
    if (extra.confianca) confianca = minConf(confianca, extra.confianca);
    const tipo_troca = motivo === "outra_conta" || motivo === "outro_provedor" || motivo === "faixa_inferior" ? motivo : null;
    const dados = {
      motivo,
      trocando: o.trocando,
      atual: { provedor: atual.provedor, modelo: atual.modelo, conta_id: atual.conta_id, faixa: atual.faixa, used_pct: origemUsed },
      escolhida: escolhida ? { provedor: escolhida.provedor, modelo: escolhida.modelo, conta_id: escolhida.conta_id, faixa: escolhida.faixa, used_pct: escolhida.used, janela: escolhida.janela } : null,
      confianca,
      avisos,
      bloqueio,
      limiar_troca_pct: o.limiar_troca_pct,
    };
    return {
      escolhida: escolhida
        ? { provedor: escolhida.provedor, cli: cliDe(escolhida.provedor) ?? escolhida.provedor, modelo: escolhida.modelo, esforco: escolhida.esforco, conta_id: escolhida.conta_id, faixa: escolhida.faixa }
        : null,
      motivo,
      ranking,
      picks,
      confianca,
      avisos,
      bloqueio,
      tipo_troca,
      consumo_origem_pct: origemUsed,
      consumo_destino_pct: escolhida ? escolhida.used : null,
      recibo: reciboModelo(dados),
    };
  };
  const achado = (provedor: string, modelo: string | null, esforco: string | null, faixa: Faixa, conta_id: string, tier: Tier, confirmado: boolean): Achado => {
    const u = usadoDe(provedor, conta_id, modelo);
    const a: Achado = { provedor, modelo, esforco, faixa, conta_id, tier, used: u.used, janela: u.janela, confirmado };
    considerados.push({ provedor, modelo, faixa, conta_id, tier });
    return a;
  };

  // ---- (1) mesma conta, se ainda boa ----
  if (o.trocando && existeAtual && entradaAtual && entradaAtual.tier !== 3) {
    return fim(achado(atual.provedor, atual.modelo, null, atual.faixa, entradaAtual.conta_id, entradaAtual.tier, true), "mesma_conta_ok");
  }
  if (!o.trocando && pAtual) {
    const melhor = pAtual.ranking[0];
    if (melhor && melhor.tier !== 3) return fim(achado(atual.provedor, atual.modelo, null, atual.faixa, melhor.conta_id, melhor.tier, true), "mesma_conta_ok");
  }

  // ---- a partir daqui haveria TROCA: regras de segurança ----
  if (o.trocando) {
    if (o.operacaoNaoRetomavel === true) {
      if (o.confirmouRisco !== true) {
        avisos.push("operacao_nao_retomavel: troca adiada ate o fim da operacao");
        return fim(null, "sem_alternativa", { bloqueio: "operacao_nao_retomavel" });
      }
      avisos.push("troca_interrompe_operacao_nao_retomavel");
    }
    const teto = Math.min(o.max_saltos ?? MAX_SALTOS_TASK, MAX_SALTOS_TASK);
    if ((o.saltos ?? 0) >= teto) {
      avisos.push("limite_de_saltos_por_task");
      return fim(null, "sem_alternativa", { bloqueio: "max_saltos" });
    }
    const ultima = o.ultima_troca_em ?? null;
    if (!semCapacidade && ultima !== null && o.agora - ultima < (o.intervalo_min_entre_trocas_ms ?? INTERVALO_MIN_ENTRE_TROCAS_MS)) {
      avisos.push("intervalo_minimo_entre_trocas");
      return fim(null, "sem_alternativa", { bloqueio: "intervalo_entre_trocas" });
    }
  }

  const excluirSemAtual = contaAtualId !== null ? [...o.excluir_contas, contaAtualId] : [...o.excluir_contas];
  const passaMargem = (destUsed: number | null): boolean => !o.trocando || origemUsed === null || destUsed === null || destUsed <= origemUsed - o.margem_troca_pontos;
  const melhorDaConta = (r: ResultadoPick, provedor: string, modelo: string | null, aceita: (t: Tier) => boolean): { conta_id: string; tier: Tier } | null => {
    for (const x of r.ranking) if (aceita(x.tier) && passaMargem(usadoDe(provedor, x.conta_id, modelo).used)) return { conta_id: x.conta_id, tier: x.tier };
    return null;
  };

  // (2) outra conta do mesmo provedor
  const outraConta = (aceita: (t: Tier) => boolean): Achado | null => {
    if (!o.trocando || !atualViavel) return null;
    const r = pickDe(atual.provedor, atual.modelo, excluirSemAtual);
    const m = melhorDaConta(r, atual.provedor, atual.modelo, aceita);
    return m ? achado(atual.provedor, atual.modelo, null, atual.faixa, m.conta_id, m.tier, true) : null;
  };

  // (3) e (4): equivalentes (mesma faixa em outro provedor; depois faixas abaixo)
  const buscarEquivalentes = (nivel: "mesma" | "abaixo", aceita: (t: Tier) => boolean): Achado | null => {
    if (nivel === "abaixo" && o.faixa_minima === "mesma") return null;
    const provedores = o.permitir_outro_provedor ? viaveis : viaveis.filter((p) => p === atual.provedor);
    const lista = equivalentes(equiv, { provedor: atual.provedor, modelo: atual.modelo, faixa: atual.faixa }, nivel === "mesma" ? "mesma" : o.faixa_minima, provedores);
    const porNivel = new Map<number, Equivalente[]>();
    for (const e of lista) {
      if (nivel === "mesma" ? e.descida !== 0 || e.provedor === atual.provedor : e.descida < 1) continue;
      porNivel.set(e.descida, [...(porNivel.get(e.descida) ?? []), e]);
    }
    for (const descida of [...porNivel.keys()].sort((a, b) => a - b)) {
      const candidatos: Array<{ a: Achado; chave: [number, number, number, number, number] }> = [];
      for (const [idxLista, e] of (porNivel.get(descida) ?? []).entries()) {
        if (e.provedor === PROVEDOR_OPENROUTER) {
          if (o.clis_openrouter.length === 0) {
            if (!avisos.includes("sem_cli_compativel")) avisos.push("sem_cli_compativel");
            continue;
          }
          if (e.tipos_permitidos.length > 0 && (o.task_type === null || !e.tipos_permitidos.includes(o.task_type))) continue;
        }
        const r = pickDe(e.provedor, e.modelo, [...o.excluir_contas]);
        const m = melhorDaConta(r, e.provedor, e.modelo, aceita);
        if (!m) continue;
        const conta = contasDe(e.provedor).find((c) => c.conta_id === m.conta_id);
        const a = achado(e.provedor, e.modelo, e.esforco, e.faixa, m.conta_id, m.tier, e.confirmado);
        candidatos.push({ a, chave: [e.provedor === PROVEDOR_OPENROUTER ? 1 : 0, m.tier, conta?.auth === "ok" ? 0 : 1, viaveis.indexOf(e.provedor), idxLista] });
      }
      candidatos.sort((x, y) => {
        for (let i = 0; i < 5; i++) if (x.chave[i] !== y.chave[i]) return (x.chave[i] as number) - (y.chave[i] as number);
        return 0;
      });
      const melhor = candidatos[0];
      if (melhor) return melhor.a;
    }
    return null;
  };

  const ate2 = (t: Tier): boolean => t <= 2;
  const ate3SeEsgotada = (t: Tier): boolean => t <= 2 || (t === 3 && semCapacidade);
  const qualquer = (): boolean => true;

  if (o.trocando) {
    const a2 = outraConta(ate2);
    if (a2) return fim(a2, "outra_conta");
    const a3 = buscarEquivalentes("mesma", ate3SeEsgotada);
    if (a3) return fim(a3, "outro_provedor");
    const a4 = buscarEquivalentes("abaixo", ate3SeEsgotada);
    if (a4) {
      avisos.push("desceu_de_faixa");
      return fim(a4, "faixa_inferior");
    }
    if (semCapacidade) {
      const quente = outraConta((t) => t <= 3);
      if (quente) return fim(quente, "outra_conta", { confianca: "baixa" });
    }
    return fim(null, "sem_alternativa");
  }

  // abertura de Pane: o provedor pedido está quente, esgotado ou indisponível
  const a3 = buscarEquivalentes("mesma", ate2);
  if (a3) return fim(a3, "outro_provedor");
  const a4 = buscarEquivalentes("abaixo", ate2);
  if (a4) {
    avisos.push("desceu_de_faixa");
    return fim(a4, "faixa_inferior");
  }
  const quente = pAtual?.ranking[0];
  if (quente) {
    avisos.push("conta_quente");
    return fim(achado(atual.provedor, atual.modelo, null, atual.faixa, quente.conta_id, quente.tier, true), "mesma_conta_ok", { confianca: "baixa" });
  }
  const b3 = buscarEquivalentes("mesma", qualquer);
  if (b3) return fim(b3, "outro_provedor", { confianca: "baixa" });
  const b4 = buscarEquivalentes("abaixo", qualquer);
  if (b4) {
    avisos.push("desceu_de_faixa");
    return fim(b4, "faixa_inferior");
  }
  return fim(null, "sem_alternativa");
}
