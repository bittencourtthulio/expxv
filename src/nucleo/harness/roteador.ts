// Roteador (Fase 9, T-09.15): o PONTO ÚNICO de decisão de rota. PURO e determinístico: dados injetados, sem I/O, sem relógio
// (`agora` vem em `deps`), sem rede. Compõe o que já existe: política por task_type (herança workspace → global) → faixa →
// `pickModel` (que chama `pickAccount`) → recibo. Nenhuma regra de conta/modelo é repetida aqui.
// Garantias: nenhum caminho devolve conta exaurida/desabilitada/em cooldown (a conta sempre vem de `pickAccount`);
// modo de troca (P-28): `manual` nunca troca, `so_sugerir` devolve a sugestão marcada `requer_aprovacao`, `automatico` decide.
import type {
  CandidataConta,
  ConfigHarness,
  Decisao,
  DecisaoEntrada,
  EntradaEquivalencia,
  ErroRoteamento,
  Executor,
  Faixa,
  FonteDecisao,
  ModoTroca,
  OpcoesModelo,
  OpcoesPick,
  PedidoDeRota,
  Politica,
} from "../../compartilhado/harness";
import { modoTrocaEfetivo } from "../../compartilhado/harness";
import type { AccountUsage } from "../../compartilhado/limites";
import type { ContaRoteamento } from "../../compartilhado/harness";
import type { Papel, Permissao } from "../dominio/enums";
import { faixaDe, PROVEDOR_OPENROUTER, PROVEDORES_ROTEAVEIS } from "./equivalencia";
import { pickAccount } from "./escolher-conta";
import { pickModel, type Confianca, type OpcoesModeloExtras, type ResultadoModeloDetalhado } from "./escolher-modelo";
import { candidatosDaPolitica, executorConcreto, politicaEfetiva } from "./politica";
import { reciboEscolhaConta, sanitizarTexto } from "./recibo";
import { FAIXA_PADRAO_POR_TASK_TYPE } from "./task-types";

// ---- entrada ----
/** Conta do sistema (sem segredo): provedor, habilitação e as colunas de roteamento (`null` = padrões). */
export interface ContaDoSistema {
  conta_id: string;
  provedor: string;
  habilitada: boolean;
  roteamento: ContaRoteamento | null;
}
/** Perfil pedido (CLI `auto` = a faixa escolhe o provedor e a conta). */
export interface PerfilDoPedido {
  cli: string;
  modelo: string | null;
  esforco: string | null;
  faixa: Faixa;
}
export interface PedidoRoteador {
  /** `null` = classificar (função injetada) ou `geral`. */
  taskType: string | null;
  workspace: string;
  papel?: Papel;
  /** só para o classificador injetado; NUNCA entra no recibo nem no banco. */
  descricao?: string | null;
  origem?: PedidoDeRota["origem"];
  mission_id?: string | null;
  pane_id?: string | null;
  /** `nenhuma` = o explícito vence sem política. */
  modoRota?: "auto" | "nenhuma";
  explicito?: PedidoDeRota["explicito"];
  perfil?: PerfilDoPedido;
  /** força a faixa dos candidatos da política. */
  faixa?: Faixa;
  /** CLI preferida: sobe ao topo dos candidatos viáveis. */
  cliPreferida?: string;
  /** conta preferida (suave): só vale se ainda for boa. */
  contaPreferida?: string | null;
  excluirProvedores?: readonly string[];
  excluirContas?: readonly string[];
  /** Pane em curso: a decisão vira TROCA (exige melhora pela margem, saltos, intervalo e ponto seguro). */
  atual?: { provedor: string; conta_id: string | null; modelo: string | null; faixa: Faixa };
  saltos?: number;
  ultimaTrocaEm?: number | null;
  operacaoNaoRetomavel?: boolean;
  confirmouRisco?: boolean;
  /** ação direta do usuário (ex.: botão "mover"): ignora o modo de troca. */
  acaoDoUsuario?: boolean;
}
export interface DepsRoteador {
  politica: { globais: readonly Politica[]; doWorkspace: readonly Politica[] };
  usos: readonly AccountUsage[];
  contas: readonly ContaDoSistema[];
  equivalencia: EntradaEquivalencia;
  config: ConfigHarness;
  /** epoch ms. */
  agora: number;
  /** deriva o modo quando `config.modo_troca` é `null` (padrão `seguro` → só sugerir). */
  permissaoWorkspace?: Permissao;
  /** provedores habilitados e instalados, na ordem de preferência; padrão: os das contas habilitadas. */
  provedoresViaveis?: readonly string[];
  clisOpenrouter?: readonly string[];
  openrouterConsentido?: boolean;
  /** TaskTypes conhecidos; ausente = não valida. */
  taskTypes?: ReadonlySet<string>;
  classificar?: (descricao: string) => { task_type: string; confianca: number } | null;
  /** grava a Decisão (`decisoes.ts`); falha de gravação nunca derruba a rota. */
  registrar?: (d: DecisaoEntrada) => unknown;
}

// ---- saída ----
export interface SugestaoRota {
  provedor: string;
  cli: string;
  modelo: string | null;
  conta_id: string;
  faixa: Faixa;
  recibo: string;
}
export interface Rota {
  ok: boolean;
  erro: ErroRoteamento | null;
  task_type: string;
  executor: Executor | null;
  cli: string | null;
  conta_id: string | null;
  faixa: Faixa | null;
  modo: ModoTroca;
  /** `true` = há uma sugestão que só vale com a aprovação do usuário (modo `so_sugerir`). */
  requer_aprovacao: boolean;
  /** `false` = a rota é só sugestão (ou não há rota). */
  aplicada: boolean;
  /** a rota difere do que foi pedido (perfil/Pane atual). */
  mudou: boolean;
  confianca: Confianca;
  /** frase curta do motivo (= recibo). */
  motivo: string;
  recibo: string;
  avisos: string[];
  decisoes: string[];
  fontes: { task_type: FonteDecisao; executor: FonteDecisao; conta: FonteDecisao };
  skills: string[];
  skills_aplicadas: false;
  tentativas: Array<{ provedor: string; modelo: string | null; resultado: string }>;
  /** sugestão não aplicada (modo manual sem capacidade no que foi pedido). */
  sugestao: SugestaoRota | null;
}

type ExecutorFaixa = Executor & { faixa: Faixa };
type Opcoes = OpcoesModelo & OpcoesModeloExtras;
const NUM_CONFIANCA: Readonly<Record<Confianca, number>> = { alta: 0.9, media: 0.6, baixa: 0.3 };
const chaveExec = (e: { provider: string; model: string | null }): string => `${sanitizarTexto(e.provider, 30)}:${e.model === null ? "default" : sanitizarTexto(e.model, 100)}`;

function candidataDe(c: ContaDoSistema, uso: AccountUsage | undefined): CandidataConta {
  const r = c.roteamento;
  return {
    conta_id: c.conta_id,
    provedor: c.provedor,
    habilitada: c.habilitada,
    auth: r?.auth ?? "desconhecida",
    reservada_modelos: r?.reservada_modelos ?? [],
    reservada_papeis: r?.reservada_papeis ?? [],
    fixada_em: r?.workspaces_fixados ?? [],
    cooldown_ate: r?.em_cooldown_ate ?? null,
    uso: uso ?? null,
  };
}

/** Roteia. Nunca lança por falta de capacidade: devolve `ok:false` com erro nominal e recibo. */
export function rotear(pedido: PedidoRoteador, deps: DepsRoteador): Rota {
  const cfg = deps.config;
  const avisos: string[] = [];
  const decisoes: string[] = [];
  const tentativas: Rota["tentativas"] = [];
  const modoConfig = modoTrocaEfetivo(cfg.modo_troca, deps.permissaoWorkspace ?? "seguro");
  const papel: Papel = pedido.papel ?? "executor";

  // ---- (2) task_type ----
  let taskType = pedido.taskType;
  let fonteTipo: FonteDecisao = "explicito";
  if (taskType === null) {
    const c = pedido.descricao ? (deps.classificar?.(pedido.descricao) ?? null) : null;
    if (c) {
      taskType = c.task_type;
      fonteTipo = "regra";
    } else {
      taskType = "geral";
      fonteTipo = "fallback";
      avisos.push("task_type_nao_identificado: usando geral");
    }
  }
  decisoes.push(`task_type=${taskType} (${fonteTipo})`);

  const vazia = (erro: ErroRoteamento, recibo: string, sugestao: SugestaoRota | null = null): Rota => {
    const r: Rota = {
      ok: false, erro, task_type: taskType as string, executor: null, cli: null, conta_id: null, faixa: null, modo: modoConfig, requer_aprovacao: sugestao !== null,
      aplicada: false, mudou: false, confianca: "baixa", motivo: recibo, recibo, avisos, decisoes, fontes: { task_type: fonteTipo, executor: "fallback", conta: "regra" },
      skills: [], skills_aplicadas: false, tentativas, sugestao,
    };
    return gravar(r, [], null);
  };
  const gravar = (r: Rota, opcoes: string[], escolhida: string | null): Rota => {
    if (deps.registrar) {
      const alvo = escolhida ?? "nenhuma";
      const todas = opcoes.includes(alvo) ? opcoes : [...opcoes, alvo];
      try {
        deps.registrar({
          proposito: "selecao_conta", workspace_id: pedido.workspace, mission_id: pedido.mission_id ?? null, pane_id: pedido.pane_id ?? null, tipo: "choice", opcoes: todas,
          probs: null, escolhida: alvo, confianca: NUM_CONFIANCA[r.confianca], fonte: r.fontes.executor, escolha_regra: escolhida, divergiu: false, latencia_ms: null,
          custo_usd: null, custo_origem: "desconhecido", decisor: null, resumo_enviado: null, resumo_hash: null, skills_aplicadas: false, recibo: r.recibo,
        });
      } catch {
        r.avisos.push("decisao_nao_registrada");
      }
    }
    return r;
  };
  if (deps.taskTypes && !deps.taskTypes.has(taskType)) return vazia("unknown_task_type", `Tipo de tarefa "${sanitizarTexto(taskType, 40)}" desconhecido.`);

  // ---- ambiente: provedores viáveis e contas ----
  const excluidos = new Set(pedido.excluirProvedores ?? []);
  const base = deps.provedoresViaveis ?? [...new Set(deps.contas.filter((c) => c.habilitada).map((c) => c.provedor))];
  const viaveis = base.filter((p) => !excluidos.has(p));
  const viaveisSet: ReadonlySet<string> = new Set(viaveis);
  const usoPorConta = new Map<string, AccountUsage>();
  for (const u of deps.usos) usoPorConta.set(u.account_id, u);
  const porProvedor: Record<string, CandidataConta[]> = {};
  const provedorDaConta = new Map<string, string>();
  for (const c of deps.contas) {
    provedorDaConta.set(c.conta_id, c.provedor);
    if (!viaveisSet.has(c.provedor)) continue;
    (porProvedor[c.provedor] ??= []).push(candidataDe(c, usoPorConta.get(c.conta_id)));
  }
  const excluirContas = [...(pedido.excluirContas ?? [])];
  const pol = politicaEfetiva(deps.politica.globais, deps.politica.doWorkspace, taskType);
  const faixaPadrao: Faixa = FAIXA_PADRAO_POR_TASK_TYPE[taskType] ?? "alto";
  const equiv = deps.equivalencia;
  const clisOr = deps.clisOpenrouter ?? [];
  const skills = pol ? [...pol.skills] : [];
  const evitarReservadas = pol?.evitar_reservadas ?? true;

  const opcoesPick = (modelo: string | null, contaFixa: string | null): OpcoesPick => ({
    modelo, papel, workspace_id: pedido.workspace, agora: deps.agora, limiar_esgotamento_pct: cfg.limiar_esgotamento_pct, limiar_troca_pct: cfg.limiar_troca_pct,
    estrategia: "expires_first", janela: "auto", conta_fixa_id: contaFixa, evitar_reservadas: evitarReservadas, excluir: excluirContas,
  });
  // pin duro da política só vale para candidatos do provedor da conta fixada
  const pinPara = (provedor: string): string | null => {
    const fixa = pedido.explicito?.account_id ?? pol?.conta_fixa_id ?? null;
    return fixa !== null && provedorDaConta.get(fixa) === provedor ? fixa : null;
  };

  const concretizar = (e: Executor, forcar: Faixa | null): ExecutorFaixa => {
    const c = executorConcreto(forcar === null ? e : { ...e, model: null, effort: null, faixa: forcar }, equiv);
    return { ...c, faixa: c.faixa ?? faixaPadrao };
  };

  const final = (
    fonteExec: FonteDecisao,
    achado: NonNullable<ResultadoModeloDetalhado["escolhida"]>,
    alvoEffort: string | null,
    extra: { recibo: string; confianca: Confianca; mudou: boolean; aplicada: boolean; requer: boolean; opcoes: string[]; modo: ModoTroca; fonteConta: FonteDecisao },
  ): Rota => {
    const executor: Executor = { provider: achado.provedor, cli: achado.cli, model: achado.modelo, effort: achado.esforco ?? alvoEffort, faixa: achado.faixa };
    const recibo = extra.recibo.length > 480 ? `${extra.recibo.slice(0, 479)}…` : extra.recibo;
    decisoes.push(`escolhido=${chaveExec(executor)} conta=${sanitizarTexto(achado.conta_id, 40)}`);
    const r: Rota = {
      ok: true, erro: null, task_type: taskType as string, executor, cli: achado.cli, conta_id: achado.conta_id, faixa: achado.faixa, modo: extra.modo,
      requer_aprovacao: extra.requer, aplicada: extra.aplicada, mudou: extra.mudou, confianca: extra.confianca, motivo: recibo, recibo, avisos, decisoes,
      fontes: { task_type: fonteTipo, executor: fonteExec, conta: extra.fonteConta }, skills, skills_aplicadas: false, tentativas, sugestao: null,
    };
    return gravar(r, extra.opcoes, chaveExec(executor));
  };

  // ---- (1) explícito vence ----
  const ex = pedido.explicito ?? {};
  if (pedido.modoRota === "nenhuma" || ex.provider !== undefined || ex.cli !== undefined) {
    const provedor = ex.provider ?? ex.cli;
    if (provedor === undefined) return vazia("provider_unavailable", "Rota 'nenhuma' exige provedor explícito.");
    if (!viaveisSet.has(provedor)) return vazia("provider_unavailable", `Provedor ${sanitizarTexto(provedor, 30)} indisponível.`);
    const modelo = ex.model ?? null;
    const p = pickAccount(porProvedor[provedor] ?? [], opcoesPick(modelo, pinPara(provedor)));
    if (p.escolhida === null) {
      tentativas.push({ provedor, modelo, resultado: "sem_conta" });
      return vazia("no_capacity", `Sem conta disponível em ${sanitizarTexto(provedor, 30)} (explícito).`);
    }
    const escolha = p.ranking[0]!;
    const faixa = faixaDe(equiv, provedor, modelo) ?? faixaPadrao;
    const medida = p.ranking.find((x) => x.conta_id === p.escolhida);
    const recibo = `${reciboEscolhaConta({ rotulo: p.escolhida, detalhe: `pedido explícito; ${medida?.motivo ?? ""}`, task_type: taskType, fonte_task_type: fonteTipo, used_pct: null, janela: null })}`;
    tentativas.push({ provedor, modelo, resultado: "ok" });
    const conf: Confianca = escolha.tier === 1 ? "alta" : escolha.tier === 2 ? "media" : "baixa";
    return final("explicito", { provedor, cli: provedor === PROVEDOR_OPENROUTER ? (clisOr[0] ?? ex.cli ?? provedor) : (ex.cli ?? provedor), modelo, esforco: ex.effort ?? null, conta_id: p.escolhida, faixa }, ex.effort ?? null, {
      recibo, confianca: conf, mudou: false, aplicada: true, requer: false, opcoes: [chaveExec({ provider: provedor, model: modelo })], modo: modoConfig, fonteConta: "explicito",
    });
  }

  // ---- (3) candidatos ----
  const perfil = pedido.perfil;
  const perfilConcreto = perfil !== undefined && perfil.cli !== "auto";
  let cands: ExecutorFaixa[];
  if (pedido.atual) {
    const a = pedido.atual;
    cands = [{ provider: a.provedor, cli: a.provedor === PROVEDOR_OPENROUTER ? null : a.provedor, model: a.modelo, effort: null, faixa: a.faixa }];
  } else if (perfilConcreto) {
    if (!PROVEDORES_ROTEAVEIS.includes(perfil.cli)) return vazia("no_compatible_cli", `CLI ${sanitizarTexto(perfil.cli, 30)} inexistente no catálogo.`);
    cands = [concretizar({ provider: perfil.cli, cli: perfil.cli === PROVEDOR_OPENROUTER ? null : perfil.cli, model: perfil.modelo, effort: perfil.esforco, faixa: perfil.faixa }, null)];
  } else {
    const forcar = perfil?.faixa ?? pedido.faixa ?? null;
    if (pol) cands = candidatosDaPolitica(pol, viaveisSet, { excluirProvedores: [...excluidos], openrouterConsentido: deps.openrouterConsentido === true }).map((e) => concretizar(e, forcar));
    else {
      avisos.push("sem_politica: usando a faixa padrão do tipo");
      cands = viaveis
        .filter((p) => p !== PROVEDOR_OPENROUTER || deps.openrouterConsentido === true)
        .map((p) => concretizar({ provider: p, cli: p === PROVEDOR_OPENROUTER ? null : p, model: null, effort: null, faixa: forcar ?? faixaPadrao }, forcar ?? faixaPadrao));
    }
    if (pedido.cliPreferida !== undefined) {
      const cp = pedido.cliPreferida;
      const primeiros = cands.filter((c) => c.provider === cp);
      if (primeiros.length === 0 && viaveisSet.has(cp) && cands[0]) primeiros.push(concretizar({ provider: cp, cli: cp, model: null, effort: null, faixa: cands[0].faixa }, cands[0].faixa));
      cands = [...primeiros, ...cands.filter((c) => c.provider !== cp)];
    }
  }
  if (cands.length === 0) return vazia("no_capacity", "Nenhum executor viável para este tipo de tarefa.");
  const opcoesStr = cands.map(chaveExec);

  const trocando = pedido.atual !== undefined;
  const extras: OpcoesModeloExtras = { max_saltos: cfg.max_saltos, ultima_troca_em: pedido.ultimaTrocaEm ?? null };
  if (pedido.saltos !== undefined) extras.saltos = pedido.saltos;
  if (pedido.operacaoNaoRetomavel !== undefined) extras.operacaoNaoRetomavel = pedido.operacaoNaoRetomavel;
  if (pedido.confirmouRisco !== undefined) extras.confirmouRisco = pedido.confirmouRisco;

  const opcoesModelo = (c: ExecutorFaixa, faixaMinima: Opcoes["faixa_minima"], outro: boolean): Opcoes => ({
    papel, workspace_id: pedido.workspace, agora: deps.agora, limiar_esgotamento_pct: cfg.limiar_esgotamento_pct, limiar_troca_pct: cfg.limiar_troca_pct, estrategia: "expires_first",
    janela: "auto", evitar_reservadas: evitarReservadas,
    atual: { provedor: c.provider, conta_id: trocando ? (pedido.atual?.conta_id ?? null) : null, modelo: c.model, faixa: c.faixa },
    provedores_viaveis: [...viaveis], clis_openrouter: [...clisOr], task_type: taskType, trocando, permitir_outro_provedor: outro, faixa_minima: faixaMinima,
    margem_troca_pontos: cfg.margem_troca_pontos, excluir_contas: excluirContas, conta_fixa_id: pinPara(c.provider), ...extras,
  });
  const alvo = cands[0] as ExecutorFaixa;
  const gate = pedido.atual !== undefined || perfil !== undefined;
  const gated = gate && pedido.acaoDoUsuario !== true;
  const outroProvedor = gate ? cfg.troca_entre_provedores : true;

  // (4) uma passada por candidato; primeiro sem descer de faixa, depois conforme `faixa_minima`
  const tentar = (lista: readonly ExecutorFaixa[], faixaMinima: Opcoes["faixa_minima"], outro: boolean): { r: ResultadoModeloDetalhado; idx: number } | null => {
    let ultimo: ResultadoModeloDetalhado | null = null;
    for (const [i, c] of lista.entries()) {
      const r = pickModel(porProvedor, equiv, opcoesModelo(c, faixaMinima, outro));
      ultimo = r;
      tentativas.push({ provedor: c.provider, modelo: c.model, resultado: r.escolhida ? r.motivo : (r.bloqueio ?? "sem_alternativa") });
      if (r.escolhida) return { r, idx: i };
      if (trocando) break;
    }
    return ultimo && trocando ? { r: ultimo, idx: 0 } : null;
  };
  const resolver = (outro: boolean): { r: ResultadoModeloDetalhado; idx: number } | null => {
    const p1 = tentar(cands, "mesma", outro);
    if (p1 && (p1.r.escolhida || cfg.faixa_minima_troca === "mesma")) return p1;
    return cfg.faixa_minima_troca === "mesma" ? p1 : (tentar(cands, cfg.faixa_minima_troca, outro) ?? p1);
  };

  // Pane em curso sem alternativa: mantém a atual SÓ se ela ainda tem capacidade; senão, `no_capacity`.
  const manter = (r: ResultadoModeloDetalhado): Rota => {
    const a = pedido.atual as NonNullable<PedidoRoteador["atual"]>;
    const p = pickAccount(porProvedor[a.provedor] ?? [], opcoesPick(a.modelo, pinPara(a.provedor)));
    const ainda = a.conta_id !== null && p.ranking.some((x) => x.conta_id === a.conta_id);
    if (!ainda) return vazia("no_capacity", r.recibo);
    if (r.bloqueio !== null) avisos.push(`troca_adiada: ${r.bloqueio}`);
    return final("regra", { provedor: a.provedor, cli: a.provedor, modelo: a.modelo, esforco: null, conta_id: a.conta_id as string, faixa: a.faixa }, null, {
      recibo: r.recibo, confianca: "baixa", mudou: false, aplicada: true, requer: false, opcoes: opcoesStr, modo: modoConfig, fonteConta: "regra",
    });
  };

  const livre = resolver(outroProvedor);
  if (!livre || !livre.r.escolhida) {
    if (trocando && livre) return manter(livre.r);
    return vazia("no_capacity", livre?.r.recibo ?? "Nenhuma conta ou modelo equivalente com folga.");
  }
  const esc = livre.r.escolhida;
  const deviou = esc.provedor !== alvo.provider || esc.modelo !== alvo.model || esc.faixa !== alvo.faixa;
  const mudou = gate ? deviou || (pedido.atual?.conta_id != null && esc.conta_id !== pedido.atual.conta_id) : false;
  const fonteNominal: FonteDecisao = perfil !== undefined || pedido.atual !== undefined ? "explicito" : "politica";
  /** Conta preferida (suave): só vale se for do mesmo provedor e não pior (tier) que a escolhida; `pickAccount` já filtrou as inviáveis. */
  const preferir = (e: NonNullable<ResultadoModeloDetalhado["escolhida"]>): string => {
    const pref = pedido.contaPreferida ?? null;
    if (pref === null || e.conta_id === pref || provedorDaConta.get(pref) !== e.provedor) return e.conta_id;
    const p = pickAccount(porProvedor[e.provedor] ?? [], opcoesPick(e.modelo, pinPara(e.provedor)));
    const x = p.ranking.find((y) => y.conta_id === pref);
    const melhor = p.ranking.find((y) => y.conta_id === e.conta_id);
    return x && melhor && x.tier <= melhor.tier ? pref : e.conta_id;
  };
  const montar = (r: ResultadoModeloDetalhado, idx: number, aplicada: boolean, requer: boolean): Rota => {
    for (const x of r.avisos) if (!avisos.includes(x)) avisos.push(x);
    if (idx > 0) avisos.push(`candidato_${idx + 1}_da_politica`);
    const e0 = r.escolhida as NonNullable<ResultadoModeloDetalhado["escolhida"]>;
    const conta = preferir(e0);
    const igual = e0.provedor === alvo.provider && e0.modelo === alvo.model && e0.faixa === alvo.faixa;
    return final(idx === 0 && igual ? fonteNominal : "fallback", { ...e0, conta_id: conta }, cands[idx]?.effort ?? null, {
      recibo: conta === e0.conta_id ? r.recibo : `${r.recibo} Conta preferida mantida.`, confianca: r.confianca, mudou, aplicada, requer, opcoes: opcoesStr, modo: modoConfig, fonteConta: "regra",
    });
  };

  if (!gated || modoConfig === "automatico") return montar(livre.r, livre.idx, true, false);
  if (modoConfig === "so_sugerir") {
    const sugestao = deviou || (mudou && pedido.atual !== undefined);
    return montar(livre.r, livre.idx, !sugestao, sugestao);
  }
  // manual: nunca troca de provedor/modelo/faixa nem de Pane; no máximo escolhe a conta dentro do que foi pedido
  if (!deviou && (pedido.atual === undefined || !mudou)) return montar(livre.r, livre.idx, true, false);
  const restrito = pedido.atual === undefined ? tentar([alvo], "mesma", false) : null;
  const re = restrito?.r.escolhida;
  if (restrito && re && re.provedor === alvo.provider && re.modelo === alvo.model) return montar(restrito.r, 0, true, false);
  const a = pedido.atual;
  if (a !== undefined && a.conta_id !== null) {
    const p = pickAccount(porProvedor[a.provedor] ?? [], opcoesPick(a.modelo, pinPara(a.provedor)));
    if (p.ranking.some((x) => x.conta_id === a.conta_id)) {
      avisos.push("modo_manual: sem troca automática");
      return final("regra", { provedor: a.provedor, cli: a.provedor, modelo: a.modelo, esforco: null, conta_id: a.conta_id, faixa: a.faixa }, null, {
        recibo: `Modo manual: mantido ${sanitizarTexto(a.provedor, 20)}; nada foi trocado.`, confianca: "baixa", mudou: false, aplicada: true, requer: false, opcoes: opcoesStr, modo: modoConfig, fonteConta: "regra",
      });
    }
  }
  for (const x of livre.r.avisos) if (!avisos.includes(x)) avisos.push(x);
  return vazia("no_capacity", `Modo manual: o pedido não tem capacidade e nada foi trocado. Sugestão disponível. ${livre.r.recibo}`, {
    provedor: esc.provedor, cli: esc.cli, modelo: esc.modelo, conta_id: esc.conta_id, faixa: esc.faixa, recibo: livre.r.recibo,
  });
}

/** Atalho para a UI/Maestro: a decisão registrada como `Decisao` já gravada pode ser reexibida; aqui só o tipo de apoio. */
export type DecisaoDaRota = Pick<Decisao, "recibo" | "escolhida" | "fonte">;
