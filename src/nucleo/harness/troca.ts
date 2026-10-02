// Troca por consumo (Fase 9, T-09.19 e T-09.20, P-28). Duas partes, ambas SEM Electron e SEM I/O próprio:
//  1) `avaliarTroca`: PURA e determinística (relógio e "estado do mundo" por parâmetro). Decide, por Pane, se há gatilho,
//     se é um ponto seguro e para onde ir (`pickModel`). Permutar a ordem dos Panes não muda o resultado.
//  2) `criarExecutorTroca`: aplica os modos (manual / só sugerir / automático), grava `Decision(proposito:"troca")` e
//     `troca_log`, avisa e delega o movimento real à porta `moverPane` (T-09.18). O decisor externo NUNCA participa.
// Segurança: nada é encerrado sem ponto seguro; operação git em curso, handoff em voo e pergunta pendente nunca são
// interrompidos; falha no movimento deixa o Pane antigo intacto (a porta é atômica) e o log fica `falhou`.
import type {
  AcaoTroca,
  CandidataConta,
  ConfigHarness,
  DecisaoEntrada,
  EntradaEquivalencia,
  EventoHarness,
  Faixa,
  ModoTroca,
  OpcoesModelo,
  OpcoesPick,
  ResultadoMoverPane,
  Troca,
} from "../../compartilhado/harness";
import { ADIADA_POR, modoTrocaEfetivo } from "../../compartilhado/harness";
import type { AccountUsage, JanelaKind } from "../../compartilhado/limites";
import type { EstadoPane, Papel, Permissao } from "../dominio/enums";
import type { NovaTroca, RegistroTroca } from "../banco/repos/troca-log";
import { medirUso } from "./escolher-conta";
import { INTERVALO_MIN_ENTRE_TROCAS_MS, pickModel, type Confianca, type OpcoesModeloExtras, type ResultadoModeloDetalhado } from "./escolher-modelo";
import { reciboTroca, sanitizarTexto, trocaParaLog, type BloqueioModelo, type DadosReciboTroca } from "./recibo";
import type { ContaDoSistema } from "./roteador";

export type AdiadaPor = (typeof ADIADA_POR)[number];
export type MotivoGatilho = "consumo_alto" | "limite_atingido";
export type Urgencia = "normal" | "alta";
export type SituacaoTroca = "pronta" | "adiada" | "sem_alternativa";
/** O que fazer com a proposta: executar (automático, ponto seguro), sugerir (visível ao usuário), adiar (esperar) ou só avisar. */
export type AcaoProposta = "executar" | "sugerir" | "adiar" | "avisar";

/** Espera máxima pelo ponto seguro (padrão do contrato). */
export const ESPERA_PONTO_SEGURO_PADRAO_S = 600;
/** "Ignorar"/"adiar 30 min": a sugestão não reaparece antes disso. */
export const SILENCIO_SUGESTAO_MS = 30 * 60_000;
/** Depois de uma troca que falhou, o ciclo espera isto antes de tentar de novo. */
export const ESPERA_APOS_FALHA_MS = 5 * 60_000;

// ---------------------------------------------------------------- entrada
export interface PaneParaTroca {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  papel: Papel;
  task_type: string | null;
  /** provedor de ROTEAMENTO atual do Pane (id de CLI do catálogo ou "openrouter"). */
  provedor: string;
  conta_id: string | null;
  modelo: string | null;
  /** faixa do perfil do Pane (D-111): é a do PERFIL, não a da política. */
  faixa: Faixa;
  estado: EstadoPane;
  /** a CLI parou no limite (frase de limite vista na saída e sessão ociosa): conta como ponto seguro. */
  limite_detectado: boolean;
  /** trocas já feitas nesta task. */
  saltos: number;
  /** epoch ms da última troca deste Pane. */
  ultima_troca_em: number | null;
  /** epoch ms; a sugestão não reaparece antes. */
  ignorar_sugestao_ate: number | null;
}

/** Tudo o que NÃO é o Pane nem o consumo: injetado para a função continuar pura. */
export interface EstadoDoMundo {
  contas: readonly ContaDoSistema[];
  equivalencia: EntradaEquivalencia;
  /** provedores habilitados e instalados, na ordem de preferência. */
  provedoresViaveis: readonly string[];
  clisOpenrouter?: readonly string[];
  /** deriva o modo quando `config.modo_troca` é `null` (padrão `seguro` ⇒ só sugerir). */
  permissaoWorkspace?: Permissao;
  /** panes com operação git em curso no worktree (MERGE_HEAD, rebase-merge/, rebase-apply/, CHERRY_PICK_HEAD, REVERT_HEAD, index.lock recente). */
  operacaoGit?: ReadonlySet<string>;
  handoffEmVoo?: ReadonlySet<string>;
  /** pergunta/aprovação pendente ao humano. */
  perguntaPendente?: ReadonlySet<string>;
  /** quando o gatilho foi visto pela 1.ª vez por Pane (epoch ms): base da espera pelo ponto seguro. */
  gatilhoDesde?: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------- saída
export interface LadoProposta {
  provedor: string;
  modelo: string | null;
  conta_id: string | null;
  faixa: Faixa;
  used_pct: number | null;
}
export interface Proposta {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  modo: ModoTroca;
  motivo: Troca["motivo"];
  urgencia: Urgencia;
  situacao: SituacaoTroca;
  acao: AcaoProposta;
  adiada_por: AdiadaPor | null;
  /** o ponto seguro não veio a tempo: a proposta vira sugestão visível (nada é trocado sozinho). */
  espera_vencida: boolean;
  tipo_troca: Troca["tipo_troca"] | null;
  de: LadoProposta & { janela: JanelaKind | "modelo" | null };
  para: (LadoProposta & { cli: string; esforco: string | null }) | null;
  /** `no_capacity` quando a conta de origem está esgotada e não há destino (Pane intacto). */
  erro: "no_capacity" | null;
  bloqueio: BloqueioModelo;
  confianca: Confianca;
  avisos: string[];
  /** ranking do `pickModel` (para a Decisão). */
  ranking: ResultadoModeloDetalhado["ranking"];
  recibo: string;
}

// ---------------------------------------------------------------- função pura
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

/** Candidatas por provedor, prontas para `pickModel`. */
export function agruparContas(contas: readonly ContaDoSistema[], usos: readonly AccountUsage[]): { candidatas: CandidataConta[]; porProvedor: Record<string, CandidataConta[]> } {
  const uso = new Map<string, AccountUsage>();
  for (const u of usos) uso.set(u.account_id, u);
  const candidatas = contas.map((c) => candidataDe(c, uso.get(c.conta_id)));
  const porProvedor: Record<string, CandidataConta[]> = {};
  for (const c of candidatas) (porProvedor[c.provedor] ??= []).push(c);
  return { candidatas, porProvedor };
}

const CONFIANCA_NUM: Readonly<Record<Confianca, number>> = { alta: 0.9, media: 0.6, baixa: 0.3 };

/** Opções do `pickModel` para uma troca deste Pane (usadas pelo avaliador e pelo botão "mover"). */
export function opcoesDeTroca(pane: PaneParaTroca, config: ConfigHarness, mundo: EstadoDoMundo, agora: number, ajuste: { esgotada: boolean; ignorarIntervalo?: boolean; excluirAtual?: boolean; contaFixaId?: string | null; provedores?: readonly string[] }): OpcoesModelo & OpcoesModeloExtras {
  const excluirAtual = (ajuste.esgotada || ajuste.excluirAtual === true) && pane.conta_id !== null;
  return {
    papel: pane.papel,
    workspace_id: pane.workspace_id,
    agora,
    limiar_esgotamento_pct: config.limiar_esgotamento_pct,
    limiar_troca_pct: config.limiar_troca_pct,
    estrategia: "expires_first",
    janela: "auto",
    evitar_reservadas: true,
    atual: { provedor: pane.provedor, conta_id: pane.conta_id, modelo: pane.modelo, faixa: pane.faixa },
    provedores_viaveis: [...(ajuste.provedores ?? mundo.provedoresViaveis)],
    clis_openrouter: [...(mundo.clisOpenrouter ?? [])],
    task_type: pane.task_type,
    trocando: true,
    permitir_outro_provedor: config.troca_entre_provedores,
    faixa_minima: config.faixa_minima_troca,
    // limite batido: a origem não serve mais, então a margem de 10 pontos não faz sentido
    margem_troca_pontos: ajuste.esgotada || ajuste.excluirAtual === true ? 0 : config.margem_troca_pontos,
    excluir_contas: excluirAtual ? [pane.conta_id as string] : [],
    conta_fixa_id: ajuste.contaFixaId ?? null,
    saltos: pane.saltos,
    max_saltos: config.max_saltos,
    ultima_troca_em: ajuste.ignorarIntervalo === true ? null : pane.ultima_troca_em,
  };
}

/** Por que o Pane NÃO está num ponto seguro (`null` = ponto seguro: turno encerrado ou CLI parada no limite, sem bloqueio). */
export function bloqueioDoPane(pane: PaneParaTroca, mundo: EstadoDoMundo): AdiadaPor | null {
  if (mundo.operacaoGit?.has(pane.pane_id) === true) return "operacao_git";
  if (mundo.handoffEmVoo?.has(pane.pane_id) === true) return "handoff_em_voo";
  // `bloqueado` e `aguardando` precisam do humano: nunca são ponto seguro, nem com frase de limite
  if (mundo.perguntaPendente?.has(pane.pane_id) === true || pane.estado === "aguardando" || pane.estado === "bloqueado") return "pergunta_pendente";
  if (pane.estado === "pronto" || pane.limite_detectado) return null;
  return "trabalhando";
}

const rotuloOpcao = (p: string, m: string | null, c: string | null): string => `${p}/${m ?? "default"}#${c ?? "sem_conta"}`;

/**
 * Avalia quais Panes devem trocar de conta/modelo. Pura: `agora` e o mundo chegam por parâmetro.
 * Gatilho: gargalo da conta do Pane (5 h, semanal, balde do modelo ou crédito) ≥ `limiar_troca_pct`, ou limite atingido.
 * `manual` ⇒ `[]` (nada sugere). Resultado ordenado por urgência e `pane_id` (independe da ordem de entrada).
 */
export function avaliarTroca(panes: readonly PaneParaTroca[], usos: readonly AccountUsage[], config: ConfigHarness, mundo: EstadoDoMundo, agora: number): Proposta[] {
  const modo = modoTrocaEfetivo(config.modo_troca, mundo.permissaoWorkspace ?? "seguro");
  if (modo === "manual" || panes.length === 0) return [];
  const { candidatas, porProvedor } = agruparContas(mundo.contas, usos);
  const espera = Math.max(0, config.espera_ponto_seguro_s) * 1000;
  const saida: Proposta[] = [];

  for (const pane of panes) {
    if (pane.estado === "encerrado" || pane.estado === "iniciando") continue;
    const cand = pane.conta_id === null ? undefined : candidatas.find((c) => c.conta_id === pane.conta_id);
    const opcoesPick: OpcoesPick = {
      modelo: pane.modelo, papel: pane.papel, workspace_id: pane.workspace_id, agora, limiar_esgotamento_pct: config.limiar_esgotamento_pct,
      limiar_troca_pct: config.limiar_troca_pct, estrategia: "expires_first", janela: "auto", conta_fixa_id: null, evitar_reservadas: true, excluir: [],
    };
    const medida = cand ? medirUso(cand, opcoesPick) : null;
    const used = medida?.gargalo?.used_pct ?? null;
    const janela = medida?.gargalo?.kind ?? null;
    const esgotada = pane.limite_detectado || (used !== null && used >= config.limiar_esgotamento_pct);
    const quente = used !== null && used >= config.limiar_troca_pct;
    if (!esgotada && !quente) continue;
    // "ignorar/adiar 30 min" cala a sugestão, menos quando a CLI já parou no limite
    if (!pane.limite_detectado && pane.ignorar_sugestao_ate !== null && pane.ignorar_sugestao_ate > agora) continue;

    const motivo: MotivoGatilho = esgotada ? "limite_atingido" : "consumo_alto";
    const urgencia: Urgencia = esgotada ? "alta" : "normal";
    const escolha = pickModel(porProvedor, mundo.equivalencia, opcoesDeTroca(pane, config, mundo, agora, { esgotada }));
    const de: Proposta["de"] = { provedor: pane.provedor, modelo: pane.modelo, conta_id: pane.conta_id, faixa: pane.faixa, used_pct: used, janela };
    const base = { pane_id: pane.pane_id, workspace_id: pane.workspace_id, mission_id: pane.mission_id, task_ref: pane.task_ref, modo, motivo, urgencia, de, bloqueio: escolha.bloqueio, confianca: escolha.confianca, ranking: escolha.ranking };

    const e = escolha.escolhida;
    if (e === null || escolha.motivo === "mesma_conta_ok" || escolha.motivo === "sem_alternativa") {
      // sem destino: o Pane permanece intacto; esgotado de verdade ⇒ `no_capacity`
      saida.push({ ...base, situacao: "sem_alternativa", acao: "avisar", adiada_por: null, espera_vencida: false, tipo_troca: null, para: null, erro: esgotada ? "no_capacity" : null, avisos: [...escolha.avisos, "sem_alternativa"], recibo: escolha.recibo });
      continue;
    }
    const para: NonNullable<Proposta["para"]> = { provedor: e.provedor, cli: e.cli, modelo: e.modelo, esforco: e.esforco, conta_id: e.conta_id, faixa: e.faixa, used_pct: escolha.consumo_destino_pct };
    const adiadaPor = bloqueioDoPane(pane, mundo);
    const desde = mundo.gatilhoDesde?.[pane.pane_id];
    const vencida = adiadaPor !== null && desde !== undefined && agora - desde >= espera;
    let acao: AcaoProposta;
    if (adiadaPor === null) acao = modo === "automatico" ? "executar" : "sugerir";
    else if (modo === "so_sugerir" || vencida) acao = "sugerir";
    else acao = "adiar";
    saida.push({ ...base, situacao: adiadaPor === null ? "pronta" : "adiada", acao, adiada_por: adiadaPor, espera_vencida: vencida, tipo_troca: escolha.tipo_troca, para, erro: null, avisos: [...escolha.avisos], recibo: escolha.recibo });
  }
  saida.sort((a, b) => Number(b.urgencia === "alta") - Number(a.urgencia === "alta") || (a.pane_id < b.pane_id ? -1 : a.pane_id > b.pane_id ? 1 : 0));
  return saida;
}

// ---------------------------------------------------------------- executor
export type CodigoErroTroca = "no_capacity" | "not_at_limit" | "provider_mismatch" | "no_account_available" | "limit_reached" | "operacao_em_curso" | "pane_nao_encontrado" | "troca_nao_encontrada" | "mover_indisponivel" | "falhou";
export class ErroTroca extends Error {
  constructor(
    readonly codigo: CodigoErroTroca,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroTroca";
  }
}

export interface PedidoMoverPane {
  pane_id: string;
  workspace_id: string;
  de: Troca["de"];
  para: { provedor: string; cli: string; modelo: string | null; esforco: string | null; conta_id: string | null; faixa: Faixa };
  motivo: Troca["motivo"];
  /** vai para o recibo do novo Pane (≤ 480, sem segredo). */
  recibo: string;
  troca_id: string | null;
  decisao_id: string | null;
}
export interface AvisoTroca {
  tipo: "sugerida" | "feita" | "falhou" | "adiada" | "sem_alternativa";
  workspace_id: string;
  pane_id: string;
  troca_id: string | null;
  /** texto curto, já sem segredo. */
  texto: string;
}
export interface EntradaAvaliacao {
  panes: readonly PaneParaTroca[];
  usos: readonly AccountUsage[];
  config: ConfigHarness;
  mundo: EstadoDoMundo;
}
export interface PortasExecutorTroca {
  /** epoch ms. */
  agora(): number;
  /** Lê o mundo atual do workspace (Panes ativos, consumo, config, bloqueios). */
  lerMundo(workspaceId: string): EntradaAvaliacao | Promise<EntradaAvaliacao>;
  /** Grava a Decisão e devolve o id (pelo `ServicoDecisoes.registrar`, que sanitiza). */
  registrarDecisao(d: DecisaoEntrada): { id: string };
  inserirTroca(n: NovaTroca): RegistroTroca;
  atualizarTroca(id: string, status: Troca["status"], extra?: { adiada_por?: string | null; pane_novo_id?: string | null; recibo?: string }): RegistroTroca;
  obterTroca(id: string): RegistroTroca | undefined;
  /** Movimento real (T-09.18): novo Pane com brief, antigo `superseded`, cooldown da origem, saltos +1. Atômico: lança sem efeito colateral. */
  moverPane?(pedido: PedidoMoverPane): Promise<{ novo_pane_id: string }>;
  /** "Ignorar 30 min" persistido em `pane_rota` (ISO). */
  ignorarSugestaoAte(paneId: string, ateIso: string): void;
  avisar(aviso: AvisoTroca): void;
  emitir(evento: EventoHarness): void;
  /** rótulos de conta para os recibos (nunca segredo). */
  rotulos?(): Readonly<Record<string, string>>;
}

export interface ResumoCiclo {
  avaliadas: number;
  executadas: number;
  sugeridas: number;
  adiadas: number;
  semAlternativa: number;
  falhas: number;
}
export interface PedidoMover {
  pane_id: string;
  workspace_id: string;
  /** conta de destino pedida (mesmo provedor, ou outro se `troca_entre_provedores`). */
  conta_alvo_id?: string | null;
  /** botão = `true` (o clique é a prova); `account_switch` agêntico só com `force` explícito. */
  force?: boolean;
  /** autoriza interromper uma operação que não se retoma (git em curso, handoff em voo). */
  confirmouRisco?: boolean;
}
export interface ExecutorTroca {
  /** Avalia o workspace e aplica o modo (executa / sugere / adia / avisa). Reentrância serializada por workspace. */
  ciclo(workspaceId: string): Promise<ResumoCiclo>;
  /** `harness:troca_decidir`. */
  decidir(trocaId: string, acao: AcaoTroca): Promise<RegistroTroca>;
  /** `harness:mover_pane` e `account_switch`: o MESMO caminho. */
  mover(pedido: PedidoMover): Promise<ResultadoMoverPane>;
  /** há algo esperando ponto seguro (o chamador agenda a próxima avaliação). */
  temPendencias(): boolean;
  /** Pane encerrado: descarta o estado em memória. */
  liberarPane(paneId: string): void;
}

interface EstadoPaneTroca {
  trocaId: string | null;
  status: Troca["status"] | null;
  adiadaPor: AdiadaPor | null;
  avisoSemAlternativaEm: number | null;
  falhouEm: number | null;
  emVoo: boolean;
}

const dadosRecibo = (p: Pick<Proposta, "motivo" | "modo" | "tipo_troca" | "de" | "para">, status: Troca["status"], limiar: number, adiadaPor: AdiadaPor | null): DadosReciboTroca => ({
  motivo: p.motivo,
  modo: p.modo,
  tipo_troca: p.tipo_troca ?? "outra_conta",
  status,
  de: { ...p.de, janela: p.de.janela },
  para: p.para === null ? { provedor: "", modelo: null, conta_id: null, faixa: null, used_pct: null } : { provedor: p.para.provedor, modelo: p.para.modelo, conta_id: p.para.conta_id, faixa: p.para.faixa, used_pct: p.para.used_pct },
  limiar_troca_pct: limiar,
  adiada_por: adiadaPor,
});

export function criarExecutorTroca(portas: PortasExecutorTroca): ExecutorTroca {
  const estados = new Map<string, EstadoPaneTroca>();
  const gatilhoDesde = new Map<string, number>();
  /** Panes cujo "aceitar" aguarda o ponto seguro. */
  const aceitas = new Map<string, string>();
  /** Panes que acabaram de trocar (mundo ainda pode estar defasado): sem 2.ª troca dentro do intervalo mínimo. */
  const recentes = new Map<string, number>();
  const filas = new Map<string, Promise<unknown>>();
  const doPane = (id: string): EstadoPaneTroca => {
    let e = estados.get(id);
    if (!e) {
      e = { trocaId: null, status: null, adiadaPor: null, avisoSemAlternativaEm: null, falhouEm: null, emVoo: false };
      estados.set(id, e);
    }
    return e;
  };
  const rotulos = (): Readonly<Record<string, string>> => portas.rotulos?.() ?? {};

  const opcoesDecisao = (p: Proposta): { opcoes: string[]; escolhida: string } => {
    const r = rotulos();
    const nome = (c: string | null): string => (c === null ? "sem_conta" : (r[c] ?? c.slice(-8)));
    const permanecer = `permanecer/${p.de.provedor}/${p.de.modelo ?? "default"}#${nome(p.de.conta_id)}`;
    const itens = p.ranking.map((x) => rotuloOpcao(x.provedor, x.modelo, nome(x.conta_id)));
    const escolhida = p.para === null ? permanecer : rotuloOpcao(p.para.provedor, p.para.modelo, nome(p.para.conta_id));
    const opcoes = [permanecer, ...itens.filter((x, i) => itens.indexOf(x) === i && x !== permanecer)];
    if (!opcoes.includes(escolhida)) opcoes.push(escolhida);
    return { opcoes, escolhida };
  };
  const decisaoDe = (p: Proposta, recibo: string): string => {
    const { opcoes, escolhida } = opcoesDecisao(p);
    const d = portas.registrarDecisao({
      proposito: "troca", workspace_id: p.workspace_id, mission_id: p.mission_id, pane_id: p.pane_id, tipo: "choice", opcoes, probs: null, escolhida,
      confianca: CONFIANCA_NUM[p.confianca], fonte: "regra", escolha_regra: escolhida, divergiu: false, latencia_ms: null, custo_usd: null, custo_origem: "desconhecido",
      decisor: null, resumo_enviado: null, resumo_hash: null, skills_aplicadas: false, recibo,
    });
    return d.id;
  };
  const novaLinha = (p: Proposta, status: Troca["status"], limiar: number, decisaoId: string | null, paneNovo: string | null = null, recibo?: string): RegistroTroca => {
    const dados = dadosRecibo(p, status, limiar, status === "adiada" ? p.adiada_por : null);
    const linha = trocaParaLog({ workspace_id: p.workspace_id, mission_id: p.mission_id, task_ref: p.task_ref, pane_antigo_id: p.pane_id, pane_novo_id: paneNovo, decisao_id: decisaoId }, dados, rotulos());
    return portas.inserirTroca(recibo === undefined ? linha : { ...linha, recibo });
  };

  const avisar = (tipo: AvisoTroca["tipo"], p: { workspace_id: string; pane_id: string }, trocaId: string | null, texto: string): void => {
    try {
      portas.avisar({ tipo, workspace_id: p.workspace_id, pane_id: p.pane_id, troca_id: trocaId, texto: sanitizarTexto(texto, 240) });
    } catch {
      /* aviso é acessório */
    }
  };

  /** Executa a troca: porta de movimento → log feita/falhou → eventos. Falha deixa o Pane antigo intacto. */
  async function executar(p: Proposta, limiar: number, origem: "automatico" | "aceita" | "manual"): Promise<{ ok: true; troca: RegistroTroca; novo: string } | { ok: false; troca: RegistroTroca | null; erro: string }> {
    const st = doPane(p.pane_id);
    if (p.para === null) return { ok: false, troca: null, erro: "sem_destino" };
    if (st.emVoo) return { ok: false, troca: null, erro: "em_andamento" };
    st.emVoo = true;
    try {
      let linhaId = st.trocaId;
      let decisaoId: string | null = linhaId === null ? null : (portas.obterTroca(linhaId)?.decisao_id ?? null);
      const reciboFeita = reciboTroca(dadosRecibo(p, "feita", limiar, null), rotulos());
      if (linhaId === null) decisaoId = decisaoDe(p, reciboFeita);
      if (!portas.moverPane) {
        const t = linhaId === null ? novaLinha(p, "falhou", limiar, decisaoId) : portas.atualizarTroca(linhaId, "falhou", { recibo: reciboTroca(dadosRecibo(p, "falhou", limiar, null), rotulos()) });
        st.trocaId = t.id;
        st.status = "falhou";
        st.falhouEm = portas.agora();
        portas.emitir({ tipo: "troca_falhou", troca_id: t.id, pane_id: p.pane_id });
        return { ok: false, troca: t, erro: "mover_indisponivel" };
      }
      try {
        const r = await portas.moverPane({
          pane_id: p.pane_id,
          workspace_id: p.workspace_id,
          de: { conta_id: p.de.conta_id, provedor: p.de.provedor, modelo: p.de.modelo },
          para: { provedor: p.para.provedor, cli: p.para.cli, modelo: p.para.modelo, esforco: p.para.esforco, conta_id: p.para.conta_id, faixa: p.para.faixa },
          motivo: origem === "manual" ? "manual" : p.motivo,
          recibo: reciboFeita,
          troca_id: linhaId,
          decisao_id: decisaoId,
        });
        const t = linhaId === null ? novaLinha(p, "feita", limiar, decisaoId, r.novo_pane_id) : portas.atualizarTroca(linhaId, "feita", { pane_novo_id: r.novo_pane_id, recibo: reciboFeita });
        linhaId = t.id;
        estados.delete(p.pane_id);
        gatilhoDesde.delete(p.pane_id);
        aceitas.delete(p.pane_id);
        recentes.set(p.pane_id, portas.agora());
        portas.emitir({ tipo: "troca_feita", troca_id: t.id, pane_antigo_id: p.pane_id, pane_novo_id: r.novo_pane_id });
        avisar("feita", p, t.id, t.recibo);
        return { ok: true, troca: t, novo: r.novo_pane_id };
      } catch (erro) {
        // o Pane antigo continua intacto (a porta é atômica); só registramos
        const motivo = sanitizarTexto(erro instanceof Error ? erro.message : "erro", 120);
        const recibo = `${reciboTroca(dadosRecibo(p, "falhou", limiar, null), rotulos())} Motivo: ${motivo}`.slice(0, 480);
        const t = linhaId === null ? novaLinha(p, "falhou", limiar, decisaoId, null, recibo) : portas.atualizarTroca(linhaId, "falhou", { recibo });
        st.trocaId = t.id;
        st.status = "falhou";
        st.falhouEm = portas.agora();
        portas.emitir({ tipo: "troca_falhou", troca_id: t.id, pane_id: p.pane_id });
        avisar("falhou", p, t.id, `Troca falhou; a sessão atual continua como estava. ${motivo}`);
        return { ok: false, troca: t, erro: motivo };
      }
    } finally {
      st.emVoo = false;
    }
  }

  const serializar = <T>(chave: string, f: () => Promise<T>): Promise<T> => {
    const anterior = filas.get(chave) ?? Promise.resolve();
    const atual = anterior.then(f, f);
    filas.set(chave, atual.catch(() => undefined));
    return atual;
  };

  async function cicloInterno(workspaceId: string): Promise<ResumoCiclo> {
    const resumo: ResumoCiclo = { avaliadas: 0, executadas: 0, sugeridas: 0, adiadas: 0, semAlternativa: 0, falhas: 0 };
    const agora = portas.agora();
    const ent = await portas.lerMundo(workspaceId);
    const mundo: EstadoDoMundo = { ...ent.mundo, gatilhoDesde: { ...Object.fromEntries(gatilhoDesde), ...(ent.mundo.gatilhoDesde ?? {}) } };
    const pendentes = ent.panes.filter((x) => aceitas.has(x.pane_id));
    const demais = ent.panes.filter((x) => !aceitas.has(x.pane_id));
    const propostas = [
      ...avaliarTroca(demais, ent.usos, ent.config, mundo, agora),
      // quem já clicou "aceitar" é avaliado como automático: executa no primeiro ponto seguro
      ...avaliarTroca(pendentes, ent.usos, { ...ent.config, modo_troca: "automatico" }, mundo, agora),
    ];
    const vistos = new Set(propostas.map((x) => x.pane_id));
    // gatilho que sumiu: limpa espera e arquiva a sugestão que ficou para trás
    for (const p of ent.panes) {
      if (vistos.has(p.pane_id)) continue;
      gatilhoDesde.delete(p.pane_id);
      const st = estados.get(p.pane_id);
      if (st?.trocaId && (st.status === "sugerida" || st.status === "adiada")) {
        try {
          portas.atualizarTroca(st.trocaId, "ignorada");
        } catch {
          /* linha já resolvida */
        }
      }
      aceitas.delete(p.pane_id);
      if (st) estados.delete(p.pane_id);
    }
    const limiar = ent.config.limiar_troca_pct;
    for (const p of propostas) {
      resumo.avaliadas++;
      if (!gatilhoDesde.has(p.pane_id)) gatilhoDesde.set(p.pane_id, agora);
      const st = doPane(p.pane_id);
      if (p.acao === "avisar") {
        resumo.semAlternativa++;
        if (st.avisoSemAlternativaEm === null || agora - st.avisoSemAlternativaEm >= SILENCIO_SUGESTAO_MS) {
          st.avisoSemAlternativaEm = agora;
          avisar("sem_alternativa", p, null, p.erro === "no_capacity" ? "Sem capacidade: a conta atingiu o limite e não há alternativa. A sessão permanece como está." : "Consumo alto, mas sem alternativa com folga. A sessão permanece como está.");
        }
        continue;
      }
      // depois de uma falha, espera antes de tentar de novo (nada de laço de tentativas)
      if (st.status === "falhou" && st.falhouEm !== null && agora - st.falhouEm < ESPERA_APOS_FALHA_MS) continue;
      const ultima = recentes.get(p.pane_id);
      if (ultima !== undefined && agora - ultima < INTERVALO_MIN_ENTRE_TROCAS_MS) continue;
      const acao: AcaoProposta = aceitas.has(p.pane_id) && p.acao === "sugerir" ? "adiar" : p.acao;
      if (acao === "executar") {
        const r = await executar(p, limiar, aceitas.has(p.pane_id) ? "aceita" : "automatico");
        if (r.ok) resumo.executadas++;
        else resumo.falhas++;
        continue;
      }
      if (acao === "adiar") {
        resumo.adiadas++;
        if (st.trocaId === null) {
          const d = decisaoDe(p, p.recibo);
          const t = novaLinha(p, "adiada", limiar, d);
          st.trocaId = t.id;
          st.status = "adiada";
          st.adiadaPor = p.adiada_por;
        } else if (st.status === "adiada" && st.adiadaPor !== p.adiada_por) {
          portas.atualizarTroca(st.trocaId, "adiada", { adiada_por: p.adiada_por });
          st.adiadaPor = p.adiada_por;
        }
        continue;
      }
      // sugerir
      resumo.sugeridas++;
      if (st.trocaId === null) {
        const d = decisaoDe(p, p.recibo);
        const t = novaLinha(p, "sugerida", limiar, d);
        st.trocaId = t.id;
        st.status = "sugerida";
        portas.emitir({ tipo: "troca_sugerida", troca_id: t.id, pane_id: p.pane_id });
        avisar("sugerida", p, t.id, t.recibo);
      } else if (st.status === "adiada") {
        const t = portas.atualizarTroca(st.trocaId, "sugerida", { recibo: reciboTroca(dadosRecibo(p, "sugerida", limiar, null), rotulos()) });
        st.status = "sugerida";
        portas.emitir({ tipo: "troca_sugerida", troca_id: t.id, pane_id: p.pane_id });
        avisar("sugerida", p, t.id, t.recibo);
      }
    }
    return resumo;
  }

  async function decidirInterno(trocaId: string, acao: AcaoTroca): Promise<RegistroTroca> {
    const t = portas.obterTroca(trocaId);
    if (!t) throw new ErroTroca("troca_nao_encontrada", "troca não encontrada");
    const paneId = t.pane_antigo_id;
    if (acao === "ignorar" || acao === "adiar_30min") {
      if (paneId) {
        portas.ignorarSugestaoAte(paneId, new Date(portas.agora() + SILENCIO_SUGESTAO_MS).toISOString());
        aceitas.delete(paneId);
        const st = estados.get(paneId);
        if (st) {
          st.trocaId = null;
          st.status = null;
        }
        gatilhoDesde.delete(paneId);
      }
      return portas.atualizarTroca(trocaId, acao === "ignorar" ? "ignorada" : "adiada", { adiada_por: null });
    }
    // aceitar
    if (t.status === "feita" || t.status === "ignorada" || t.status === "falhou") return t;
    if (!paneId) throw new ErroTroca("pane_nao_encontrado", "a troca não tem Pane de origem");
    const ent = await portas.lerMundo(t.workspace_id);
    const pane = ent.panes.find((x) => x.pane_id === paneId);
    if (!pane) return portas.atualizarTroca(trocaId, "ignorada");
    const agora = portas.agora();
    const mundo: EstadoDoMundo = { ...ent.mundo, gatilhoDesde: {} };
    const [p] = avaliarTroca([pane], ent.usos, { ...ent.config, modo_troca: "automatico" }, mundo, agora);
    const st = doPane(paneId);
    st.trocaId = trocaId;
    st.status = t.status;
    if (!p) return portas.atualizarTroca(trocaId, "ignorada"); // o consumo baixou: não há mais o que trocar
    if (p.acao === "avisar") {
      return portas.atualizarTroca(trocaId, "falhou", { recibo: `${t.recibo} Sem alternativa no momento da confirmação; a sessão permanece como está.`.slice(0, 480) });
    }
    if (p.acao === "executar") {
      const r = await executar(p, ent.config.limiar_troca_pct, "aceita");
      if (r.ok) return r.troca;
      if (r.troca) return r.troca;
      throw new ErroTroca("falhou", r.erro);
    }
    // ponto seguro ainda não chegou: fica aceita; o próximo ciclo executa
    aceitas.set(paneId, trocaId);
    st.status = "adiada";
    st.adiadaPor = p.adiada_por;
    return portas.atualizarTroca(trocaId, "adiada", { adiada_por: p.adiada_por });
  }

  async function moverInterno(pedido: PedidoMover): Promise<ResultadoMoverPane> {
    const ent = await portas.lerMundo(pedido.workspace_id);
    const pane = ent.panes.find((x) => x.pane_id === pedido.pane_id);
    if (!pane) throw new ErroTroca("pane_nao_encontrado", "Pane não encontrado ou encerrado");
    const agora = portas.agora();
    const mundo = ent.mundo;
    const cfg = ent.config;
    const { candidatas } = agruparContas(mundo.contas, ent.usos);
    const cand = pane.conta_id === null ? undefined : candidatas.find((c) => c.conta_id === pane.conta_id);
    const medida = cand
      ? medirUso(cand, { modelo: pane.modelo, papel: pane.papel, workspace_id: pane.workspace_id, agora, limiar_esgotamento_pct: cfg.limiar_esgotamento_pct, limiar_troca_pct: cfg.limiar_troca_pct, estrategia: "expires_first", janela: "auto", conta_fixa_id: null, evitar_reservadas: true, excluir: [] })
      : null;
    const used = medida?.gargalo?.used_pct ?? null;
    const esgotada = pane.limite_detectado || (used !== null && used >= cfg.limiar_esgotamento_pct);
    const quente = used !== null && used >= cfg.limiar_troca_pct;
    if (pedido.force !== true && !esgotada && !quente) throw new ErroTroca("not_at_limit", "a conta do Pane ainda não está no gatilho de troca; use force para trocar mesmo assim");

    let provedores: readonly string[] | undefined;
    const alvoId = pedido.conta_alvo_id ?? null;
    if (alvoId !== null) {
      const alvo = candidatas.find((c) => c.conta_id === alvoId);
      if (!alvo || !alvo.habilitada) throw new ErroTroca("no_account_available", "conta de destino inexistente ou desabilitada");
      if (alvo.conta_id === pane.conta_id) throw new ErroTroca("no_account_available", "a conta de destino é a conta atual");
      if (alvo.provedor !== pane.provedor && !cfg.troca_entre_provedores) throw new ErroTroca("provider_mismatch", "a conta de destino é de outro provedor e a troca entre provedores está desligada neste workspace");
      provedores = [alvo.provedor];
    }
    const risco = bloqueioDoPane(pane, mundo);
    if ((risco === "operacao_git" || risco === "handoff_em_voo") && pedido.confirmouRisco !== true) {
      throw new ErroTroca("operacao_em_curso", risco === "operacao_git" ? "há operação git em curso no worktree; concluir antes de trocar" : "há handoff em voo; aguardar antes de trocar");
    }
    const { porProvedor } = agruparContas(mundo.contas, ent.usos);
    const escolha = pickModel(
      porProvedor,
      mundo.equivalencia,
      opcoesDeTroca(pane, cfg, mundo, agora, { esgotada, excluirAtual: true, ignorarIntervalo: pedido.force === true, contaFixaId: alvoId, ...(provedores === undefined ? {} : { provedores }), }),
    );
    const e = escolha.escolhida;
    if (e === null || escolha.motivo === "mesma_conta_ok" || escolha.motivo === "sem_alternativa") {
      if (escolha.bloqueio === "max_saltos") throw new ErroTroca("limit_reached", "limite de trocas por task atingido");
      if (escolha.bloqueio === "intervalo_entre_trocas") throw new ErroTroca("falhou", "troca recente; aguarde o intervalo mínimo ou use force");
      if (alvoId !== null) throw new ErroTroca("no_account_available", "a conta de destino não tem capacidade agora");
      throw new ErroTroca("no_capacity", "nenhuma conta ou modelo equivalente com folga");
    }
    const proposta: Proposta = {
      pane_id: pane.pane_id, workspace_id: pane.workspace_id, mission_id: pane.mission_id, task_ref: pane.task_ref, modo: modoTrocaEfetivo(cfg.modo_troca, mundo.permissaoWorkspace ?? "seguro"),
      motivo: "manual", urgencia: "normal", situacao: "pronta", acao: "executar", adiada_por: null, espera_vencida: false, tipo_troca: escolha.tipo_troca,
      de: { provedor: pane.provedor, modelo: pane.modelo, conta_id: pane.conta_id, faixa: pane.faixa, used_pct: used, janela: medida?.gargalo?.kind ?? null },
      para: { provedor: e.provedor, cli: e.cli, modelo: e.modelo, esforco: e.esforco, conta_id: e.conta_id, faixa: e.faixa, used_pct: escolha.consumo_destino_pct },
      erro: null, bloqueio: null, confianca: escolha.confianca, avisos: [...escolha.avisos], ranking: escolha.ranking, recibo: escolha.recibo,
    };
    // o recibo do botão usa o motivo "manual"
    const r = await executar(proposta, cfg.limiar_troca_pct, "manual");
    if (!r.ok) throw new ErroTroca(r.erro === "mover_indisponivel" ? "mover_indisponivel" : "falhou", r.erro);
    return { novo_pane_id: r.novo, de: { conta_id: proposta.de.conta_id, provedor: proposta.de.provedor, modelo: proposta.de.modelo }, para: { conta_id: e.conta_id, provedor: e.provedor, modelo: e.modelo } };
  }

  return {
    ciclo: (ws) => serializar(`ws:${ws}`, () => cicloInterno(ws)),
    decidir: (id, acao) => serializar(`troca:${id}`, () => decidirInterno(id, acao)),
    mover: (p) => serializar(`pane:${p.pane_id}`, () => moverInterno(p)),
    temPendencias: () => aceitas.size > 0 || [...estados.values()].some((s) => s.status === "adiada" || s.status === "sugerida"),
    liberarPane(paneId) {
      estados.delete(paneId);
      gatilhoDesde.delete(paneId);
      aceitas.delete(paneId);
      recentes.delete(paneId);
    },
  };
}

