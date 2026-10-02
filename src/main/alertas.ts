// Alertas no main (Fase 20, T-20.33): compõe emissor -> regras -> entregador -> canais, as fontes de domínio, o tempo de trabalho e os manipuladores dos canais IPC
// `alertas:*`/`canais:*`. Nada aqui roda no boot da 1ª onda: `ligarAlertas` só monta objetos (sem I/O, sem timer, sem socket); `iniciar()` (onda 2, ocioso) semeia os canais,
// reconstitui o tempo e arma UM agendador (que só tem timer quando há vencimento). O Telegram (módulo `./alertas-telegram` e o núcleo `nucleo/telegram`) só entra por
// `import()` dinâmico — nunca por este arquivo estático (teste de varredura em `alertas.test.ts`) — e só quando o usuário abre o assistente ou o canal está ligado + consentido.
import { randomBytes } from "node:crypto";
import {
  CONFIG_ALERTAS_PADRAO,
  HOST_TELEGRAM_API,
  ID_CANAL_SO,
  ID_CANAL_TELEGRAM,
  nomeSegredoTokenTelegram,
  TIPOS_ALERTA,
  VERSAO_TEXTO_CONSENTIMENTO_TELEGRAM,
} from "../compartilhado/alertas";
import type {
  AlertaVisao,
  CanalRegistro,
  CanalVisao,
  ConfigAlertas,
  DestinoEntidade,
  EntradaAlerta,
  EstadoTelegram,
  FiltroListaAlertas,
  MetaTipoVisao,
  ModeloVisao,
  NivelTemplate,
  Pagina,
  PresetRegraAlerta,
  PrevisaoModelo,
  Regra,
  SilencioGlobalVisao,
  TipoAlerta,
  TipoCanal,
} from "../compartilhado/alertas";
import { criarAgendadorVencimentos, type AgendadorVencimentos, type TemporizadorPorta } from "../nucleo/alertas/agendador";
import { proximaHoraDigest } from "../nucleo/alertas/agrupar";
import { criarAlertRaise, ErroAlertRaise, type ContextoAlertRaise } from "../nucleo/alertas/alert-raise";
import type { AmostraConcluida } from "../nucleo/alertas/atraso";
import { CATALOGO, ehTipoAlerta } from "../nucleo/alertas/catalogo";
import { criarRegistroDeCanais, type CanalComunicacao, type RegistroDeCanais } from "../nucleo/alertas/canal";
import { criarCanalSo } from "../nucleo/alertas/canais/so";
import { montarResumoDiario, type DadosDia } from "../nucleo/alertas/digest";
import { criarEntregador, type Entregador } from "../nucleo/alertas/entregador";
import { criarFontes, type DadoVencimento, type Fontes } from "../nucleo/alertas/fontes";
import { montarDadosTarefa, type DadosTarefa, type DepsMetricas } from "../nucleo/alertas/metricas";
import type { PortaAgil, PortaCusto, ReferenciaTask, Relogio } from "../nucleo/alertas/portas";
import { relogioReal } from "../nucleo/alertas/portas";
import { criarRegraDePreset } from "../nucleo/alertas/presets";
import { executarRetencao } from "../nucleo/alertas/retencao";
import { criarServicoAlertas, type ServicoAlertas } from "../nucleo/alertas/servico";
import { criarAcumuladorTempo, type AcumuladorTempo } from "../nucleo/alertas/tempo";
import { horaValida } from "../nucleo/alertas/silencio";
import { escaparHtml, prever, validar } from "../nucleo/alertas/templates";
import { corpoPadrao } from "../nucleo/alertas/templates-padrao";
import type { Banco } from "../nucleo/banco";
import type { RepoConfig } from "../nucleo/banco/repos/config";
import { criarRepoAlertasSql, criarRepoCanaisSql, criarRepoEntregasSql, criarRepoModelosSql, criarRepoRegrasSql, criarRepoTempoSql, type RepoCanaisSql } from "../nucleo/banco/repos/alertas";
import { criarRepoTelegramSql } from "../nucleo/banco/repos/telegram";
import type { Cofre } from "../nucleo/cofre";
import type { RegistroConsentimento } from "../nucleo/rede";
import type { ServicoPortoes } from "../nucleo/orquestracao/portoes";
import type { IndiceProjeto } from "../nucleo/metodo/tipos";
import type { PortaAlertasMcp } from "../nucleo/mcp/portas";
import { argumentoInvalido, violacaoDeRegra } from "../nucleo/mcp/erros";
import type { Barramento } from "./barramento";
import { criarConsultaTelegram, criarGatesTelegram } from "./alertas-consulta";
import { ligarFontes } from "./alertas-fontes";
import type { LigacaoTelegram } from "./alertas-telegram";
import type { MaestroParaTelegram } from "./alertas-orquestrador";

export const CHAVE_CONFIG_ALERTAS = "alertas.config";
export const CHAVE_SILENCIO_GLOBAL = "alertas.silencio_global";
export const CHAVE_CONFIG_TELEGRAM = "telegram.config";
export const CHAVE_SILENCIO_TELEGRAM = "telegram.silencio";
const MARCA_NIVEL_COMPLETO = "nível completo (pergunta pendente e custo) e mensagens de agente";
const NIVEIS: readonly NivelTemplate[] = ["minimo", "padrao", "completo"];
const TIPOS_CANAL_COM_MODELO: readonly TipoCanal[] = ["so", "telegram"];
const DIA = 86_400_000;

/** Erro nominal que atravessa o IPC: `<codigo>: <mensagem>` (nunca stack, SQL nem caminho). */
export class ErroAlertasIpc extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(`${codigo}: ${mensagem}`);
    this.name = "ErroAlertasIpc";
  }
}

export interface DepsAlertas {
  banco: Banco;
  barramento: Barramento;
  config: RepoConfig;
  portoes: ServicoPortoes;
  emitirRenderer(canal: string, payload: unknown): void;
  workspaces: { obter(id: string): { nome: string; permissao?: string } | undefined; permissaoDe(id: string | null): string };
  cofre: () => Promise<Cofre>;
  consentimento: RegistroConsentimento;
  /** `new Notification(...)` do Electron (injetado). */
  mostrarNotificacaoSo(n: { title: string; body: string; silent: boolean }): void;
  janelaEmFoco(): boolean;
  /** preferência `notificacoes` (config + "Pausar notificações" da bandeja). */
  notificacoesAtivas(): boolean;
  maestro: () => MaestroParaTelegram | null;
  indiceMetodo(workspace_id: string): IndiceProjeto | null;
  cotaGeralPct(): number | null;
  consumo?(): Promise<Array<{ conta: string; provedor: string; pct: number | null }>>;
  escolherArquivoDeSaida(nomeSugerido: string): Promise<string | null>;
  aviso(m: string): void;
  scrub?: (t: string) => string;
  relogio?: Relogio;
  timers?: TemporizadorPorta;
  online?: () => boolean;
  env?: NodeJS.ProcessEnv;
  /** só testes: espera do backoff do poller (o padrão é o tempo real). */
  dormirTelegram?: import("../nucleo/telegram/portas").DormirPorta;
  /** só testes: substitui o carregamento dinâmico do módulo do Telegram. */
  carregarTelegram?: () => Promise<typeof import("./alertas-telegram")>;
}

export interface ClaimsDeAlerta {
  pane_id: string;
  mission_id: string | null;
  workspace_id: string | null;
  role: "piloto" | "worker";
  /** o workspace habilitou workers a levantar alertas? */
  worker_habilitado?: boolean;
}

export interface LigacaoAlertas {
  servico: ServicoAlertas;
  entregador: Entregador;
  fontes: Fontes;
  tempo: AcumuladorTempo;
  /** emite um alerta (usado pelos serviços do main). */
  emitir(e: EntradaAlerta): AlertaVisao | null;
  // ---- canais alertas:*
  catalogo(): MetaTipoVisao[];
  listar(f: FiltroListaAlertas): Pagina<AlertaVisao>;
  contar(): { nao_lidos: number; criticos: number };
  marcarLido(ids: string[]): { n: number };
  marcarTodosLidos(filtro?: Omit<FiltroListaAlertas, "depois_id" | "limite">): { n: number };
  silenciar(alvo: { tipo: TipoAlerta } | { entidade_tipo: string; entidade_id: string }, ate: string | null): { ok: boolean };
  regrasListar(): Regra[];
  regraGravar(r: Omit<Regra, "id"> & { id?: string }): Regra;
  regraApagar(id: string): { ok: boolean };
  regraPreset(preset: PresetRegraAlerta, canal_id: string): Regra;
  silencioLer(): SilencioGlobalVisao;
  silencioGravar(s: SilencioGlobalVisao): SilencioGlobalVisao;
  modelosListar(): ModeloVisao[];
  modeloGravar(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate; corpo: string }): ModeloVisao | { erros: string[] };
  modeloRestaurar(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate }): ModeloVisao;
  modeloPrever(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate; corpo: string }): PrevisaoModelo;
  configLer(): ConfigAlertas;
  configGravar(patch: Partial<ConfigAlertas>): ConfigAlertas;
  abrirEntidade(alerta_id: string): { ok: boolean; destino: DestinoEntidade };
  // ---- canais canais:*
  canaisListar(): CanalVisao[];
  canalConsentir(canal_id: string, versao_texto: string, hash_texto: string): Promise<CanalVisao>;
  canalLigarSaida(canal_id: string): Promise<CanalVisao>;
  canalDesligarSaida(canal_id: string): CanalVisao;
  canalTesteEnvio(canal_id: string): Promise<{ ok: boolean; detalhe: string }>;
  /** Fase 19 (divulgação): o canal externo está pronto para saída (ligado, estado ok e consentimento vigente)? Sem I/O. */
  canalSaidaPronta(canal_id: string): boolean;
  /** Fase 19 (divulgação): envia um texto avulso pelo MESMO adaptador do entregador; só com saída ligada + consentimento vigente, senão recusa sem I/O. Nunca lança. */
  canalEnviarTexto(canal_id: string, titulo: string, texto: string): Promise<{ ok: boolean; erro: string | null }>;
  // ---- telegram (lazy)
  telegramCarregado(): boolean;
  telegram(): Promise<LigacaoTelegram>;
  telegramEstado(): Promise<EstadoTelegram>;
  /** pânico que NÃO falha em silêncio (bandeja): tenta o fluxo completo; se ele falhar, desliga entrada e saída direto no banco e cancela a fila (auditoria B3). */
  panicoTelegram(pararExecucoes: boolean): Promise<{ ok: boolean; completo: boolean }>;
  // ---- integrações
  /** sinaleira dos terminais livres (`contexto-terminais`): vira alerta `pane_aguardando`/`pane_terminou`. `false` = não tratado (o chamador usa o aviso antigo). */
  aoAtividadeTerminal(ferramentaId: string, nomeFerramenta: string, atividade: string): boolean;
  /** `alert_raise` (MCP): identidade SEMPRE do token. */
  alertRaise(args: unknown, ctx: ClaimsDeAlerta): { alert_id: string; queued: boolean };
  /** a porta do MCP (erros nominais viram `ErroMcp`). */
  paraMcp(): PortaAlertasMcp;
  aoSuspenderSistema(): void;
  aoRetomarSistema(): void;
  iniciar(): Promise<void>;
  encerrar(): void;
}

const novoIdRegra = (): string => `reg_${randomBytes(9).toString("base64url")}`;
const agoraIso = (r: Relogio): string => new Date(r.agora()).toISOString();

function limitar(n: unknown, min: number, max: number, padrao: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}

/** Config com tudo dentro da faixa: valor fora dela nunca propaga (cai no padrão). */
export function normalizarConfig(bruto: unknown): ConfigAlertas {
  const b = (typeof bruto === "object" && bruto !== null ? bruto : {}) as Partial<ConfigAlertas> & Record<string, unknown>;
  const p = CONFIG_ALERTAS_PADRAO;
  const at = (typeof b.atraso === "object" && b.atraso !== null ? b.atraso : {}) as Partial<ConfigAlertas["atraso"]>;
  const tabela: Record<string, number> = {};
  for (const [k, v] of Object.entries(at.tabela_pontos_min ?? p.atraso.tabela_pontos_min)) {
    if (/^\d{1,3}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10_080) tabela[k] = v;
  }
  const dig = (typeof b.digest === "object" && b.digest !== null ? b.digest : {}) as Partial<ConfigAlertas["digest"]>;
  const hora = typeof dig.diario?.hora === "string" && horaValida(dig.diario.hora) ? dig.diario.hora : p.digest.diario.hora;
  return {
    ligado: typeof b.ligado === "boolean" ? b.ligado : p.ligado,
    retencao_dias: Math.round(limitar(b.retencao_dias, 7, 365, p.retencao_dias)),
    atraso: {
      fator: limitar(at.fator, 1, 10, p.atraso.fator),
      folga_min: limitar(at.folga_min, 0, 1440, p.atraso.folga_min),
      tabela_pontos_min: Object.keys(tabela).length === 0 ? { ...p.atraso.tabela_pontos_min } : tabela,
      minimo_amostras: Math.round(limitar(at.minimo_amostras, 1, 50, p.atraso.minimo_amostras)),
    },
    pane_aguardando_min: Math.round(limitar(b.pane_aguardando_min, 0, 1440, p.pane_aguardando_min)),
    digest: { diario: { ligado: typeof dig.diario?.ligado === "boolean" ? dig.diario.ligado : p.digest.diario.ligado, hora }, sprint: { ligado: typeof dig.sprint?.ligado === "boolean" ? dig.sprint.ligado : p.digest.sprint.ligado } },
    ...(typeof b.ocultar_titulos_externos === "boolean" ? { ocultar_titulos_externos: b.ocultar_titulos_externos } : {}),
  };
}

export function ligarAlertas(d: DepsAlertas): LigacaoAlertas {
  const relogio = d.relogio ?? relogioReal;
  const repoAlertas = criarRepoAlertasSql(d.banco);
  const repoEntregas = criarRepoEntregasSql(d.banco);
  const repoRegras = criarRepoRegrasSql(d.banco);
  const repoCanais: RepoCanaisSql = criarRepoCanaisSql(d.banco);
  const repoTempo = criarRepoTempoSql(d.banco);
  const repoModelos = criarRepoModelosSql(d.banco, () => relogio.agora());
  const repoTelegram = criarRepoTelegramSql(d.banco);
  const scrub = d.scrub ?? ((t: string): string => t);

  // ---------------------------------------------------------------- config (banco kv; sem segredo)
  const configLer = (): ConfigAlertas => normalizarConfig(d.config.obter(CHAVE_CONFIG_ALERTAS));
  const lerSilencio = (): SilencioGlobalVisao => {
    const v = d.config.obter<Partial<SilencioGlobalVisao>>(CHAVE_SILENCIO_GLOBAL) ?? {};
    return { janela: v.janela ?? {}, temporario_ate: typeof v.temporario_ate === "string" ? v.temporario_ate : null, temporario_incluir_criticos: v.temporario_incluir_criticos === true };
  };

  // ---------------------------------------------------------------- portas de dados (F10 custo, F18 ágil) lidas direto das tabelas, sem tocar nesses módulos
  const portaCusto: PortaCusto = {
    tokensDaTask(ref) {
      try {
        const chave = `${ref.workspace_id}|${ref.trabalho_id}|${ref.task_id}`;
        const l = d.banco.consultarUm<{ r: number | null; ap: number | null; e: number | null; s: number | null; ce: number | null; cl: number | null; usd: number | null }>(
          "SELECT SUM(registros) AS r, SUM(registros_aproximados) AS ap, SUM(tokens_entrada) AS e, SUM(tokens_saida) AS s, SUM(tokens_cache_escrita) AS ce, SUM(tokens_cache_leitura) AS cl, SUM(usd_conhecido) AS usd FROM custo_agregado WHERE escopo = 'card' AND chave = ?",
          [chave],
        );
        if (l === undefined || !l.r || l.r <= 0) return { entrada: 0, saida: 0, cache_escrita: 0, cache_leitura: 0, usd_conhecido: null, fonte: "sem_fonte" };
        return { entrada: l.e ?? 0, saida: l.s ?? 0, cache_escrita: l.ce ?? 0, cache_leitura: l.cl ?? 0, usd_conhecido: l.usd ?? null, fonte: (l.ap ?? 0) > 0 ? "estimada" : "medida" };
      } catch {
        return { entrada: 0, saida: 0, cache_escrita: 0, cache_leitura: 0, usd_conhecido: null, fonte: "sem_fonte" }; // tabela ausente/erro: nunca zero inventado
      }
    },
  };
  const portaAgil: PortaAgil = {
    pontos(ref) {
      try {
        const l = d.banco.consultarUm<{ pontos: number | null }>(
          "SELECT e.pontos AS pontos FROM agil_item i JOIN agil_estimativa e ON e.item_id = i.id AND e.ativa = 1 WHERE i.workspace_id = ? AND i.trabalho_id = ? AND i.task_ref = ? LIMIT 1",
          [ref.workspace_id, ref.trabalho_id, ref.task_id],
        );
        return typeof l?.pontos === "number" ? l.pontos : null;
      } catch {
        return null;
      }
    },
  };
  const historico = (workspace_id: string): AmostraConcluida[] =>
    repoTempo
      .concluidas(workspace_id, 500)
      .filter((r) => r.ativo_ms > 0)
      .map((r) => ({ workspace_id, story_points: portaAgil.pontos({ workspace_id, trabalho_id: r.trabalho_id, task_id: r.task_id }), tempo_trabalho_ms: r.ativo_ms }));

  const tempo = criarAcumuladorTempo({ repo: repoTempo, relogio });
  const metricas: Omit<DepsMetricas, "tempo" | "historico" | "agora"> & { historico: (ws: string) => AmostraConcluida[] } = { custo: portaCusto, agil: portaAgil, config: () => configLer().atraso, historico };
  const dm: DepsMetricas = { ...metricas, tempo, agora: () => relogio.agora() };
  const dadosDaTask = (ref: ReferenciaTask): DadosTarefa => montarDadosTarefa(dm, ref);

  // ---------------------------------------------------------------- canais
  const registro: RegistroDeCanais = criarRegistroDeCanais();
  registro.registrar("so", () =>
    criarCanalSo({
      mostrar: (n) => d.mostrarNotificacaoSo({ title: n.titulo, body: n.corpo, silent: n.silenciosa }),
      emFoco: () => d.janelaEmFoco(),
      preferenciaLigada: () => d.notificacoesAtivas(),
    }),
  );
  let telegramP: Promise<LigacaoTelegram> | null = null;
  let telegramCarregado = false;

  function visaoCanal(c: CanalRegistro): CanalVisao {
    const externo = c.tipo === "telegram" || c.tipo === "webhook";
    const bot = c.tipo === "telegram" ? repoTelegram.estado(c.id).bot_username : null;
    return {
      id: c.id,
      tipo: c.tipo,
      nome: c.nome,
      estado: c.estado,
      resumo: c.tipo === "so" ? "Notificação do sistema" : bot !== null && bot !== "" ? `@${bot}` : c.nome,
      saida_ligada: c.saida_ligada,
      entrada_ligada: c.entrada_ligada,
      consentimento: c.consentimento === null ? null : { versao_texto: c.consentimento.versao_texto, aceito_em: c.consentimento.aceito_em, host: c.consentimento.host },
      silenciado_ate: c.silenciado_ate,
      erro_codigo: c.erro_codigo,
      capacidades: { entrada: c.tipo === "telegram", botoes: c.tipo === "telegram", formato: c.tipo === "telegram" ? "html" : "texto", precisa_consentimento: externo },
    };
  }
  function garantirCanais(): void {
    const t = agoraIso(relogio);
    if (repoCanais.obter(ID_CANAL_SO) === null) {
      repoCanais.gravar({ id: ID_CANAL_SO, tipo: "so", nome: "Notificação do sistema", estado: "ativo", saida_ligada: true, entrada_ligada: false, consentimento: null, silenciado_ate: null, erro_codigo: null });
      const cfg = repoCanais.config(ID_CANAL_SO);
      if (cfg["regras_semeadas"] !== true) {
        // regra padrão do canal SO: os avisos que o app já dava por notificação nativa (sinaleira) + o que exige a sua atenção; nada externo, nada para fora da máquina
        const r = criarRegraDePreset("tudo_no_app", ID_CANAL_SO, novoIdRegra());
        repoRegras.gravar({ ...r, nome: "Notificação do sistema", tipos: ["pane_aguardando", "pane_terminou", "tarefa_atrasada", "missao_falhou", "erro_sistema", "canal_erro", "plano_aguardando_aprovacao", "cota_atingida"], nivel: "minimo" });
        repoCanais.gravarConfig(ID_CANAL_SO, { ...cfg, regras_semeadas: true });
      }
    }
    if (repoCanais.obter(ID_CANAL_TELEGRAM) === null) {
      repoCanais.gravar({ id: ID_CANAL_TELEGRAM, tipo: "telegram", nome: "Telegram", estado: "desligado", saida_ligada: false, entrada_ligada: false, consentimento: null, silenciado_ate: null, erro_codigo: null });
    }
    void t;
  }
  function atualizarCanal(id: string, patch: Partial<CanalRegistro>): CanalRegistro {
    garantirCanais();
    const atual = repoCanais.obter(id);
    if (atual === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
    const novo: CanalRegistro = { ...atual, ...patch, id: atual.id, tipo: atual.tipo };
    repoCanais.gravar(novo);
    d.barramento.emitir("channel.state_changed", { canal_id: novo.id, tipo: novo.tipo, estado: novo.estado });
    d.emitirRenderer("canais:estado", { canal: visaoCanal(novo) });
    return novo;
  }

  // ---------------------------------------------------------------- entregador + serviço
  const entregador = criarEntregador({
    entregas: repoEntregas,
    alertas: repoAlertas,
    canais: repoCanais,
    obterAdaptador: (tipo) => registro.obter(tipo),
    versaoConsentimento: (tipo) => (tipo === "telegram" ? VERSAO_TEXTO_CONSENTIMENTO_TELEGRAM : ""),
    opcoesMensagem: (canal, entrega) => ({
      nivel: entrega.nivel,
      scrub,
      corpos: repoModelos.corpos(),
      ocultarTitulos: canal.tipo === "telegram" || canal.tipo === "webhook" ? configLer().ocultar_titulos_externos === true : false,
      chat_ref: entrega.chat_ref,
    }),
    barramento: { emitir: (t, p) => d.barramento.emitir(t, p) },
    relogio,
    ...(d.timers === undefined ? {} : { timers: d.timers }),
    aoErroPermanente(canal, erro) {
      try {
        atualizarCanal(canal.id, { estado: "erro", erro_codigo: erro });
        servico.emitir({ tipo: "canal_erro", entidade_tipo: "canal", entidade_id: canal.id, titulo: `Erro no canal ${canal.nome}`, dados: { canal: canal.nome, causa: erro === "token_invalido" ? "token inválido ou revogado" : erro === "chat_inalcancavel" ? "o chat não pode ser alcançado" : "falha permanente de envio", acao: erro === "token_invalido" ? "Troque o token no assistente." : "Revise o canal em Alertas > Canais." }, estado: erro });
      } catch {
        /* acessório */
      }
    },
  });
  const servico: ServicoAlertas = criarServicoAlertas({
    repo: repoAlertas,
    entregas: repoEntregas,
    regras: repoRegras,
    canais: repoCanais,
    barramento: { emitir: (t, p) => d.barramento.emitir(t, p) },
    entregador,
    relogio,
    scrub,
    contextoAvaliacao() {
      const s = lerSilencio();
      // `/silenciar` do Telegram: vale só para o canal Telegram e, com `tudo`, também para os críticos
      const sc = d.config.obter<{ ate?: string | null; incluir_criticos?: boolean }>(CHAVE_SILENCIO_TELEGRAM);
      const canalAte = typeof sc?.ate === "string" && Date.parse(sc.ate) > relogio.agora() ? sc.ate : null;
      return {
        silencio_global: s.janela,
        ...(s.temporario_ate === null ? {} : { silencio_global_temporario: { ate: s.temporario_ate, incluir_criticos: s.temporario_incluir_criticos } }),
        ...(canalAte === null ? {} : { silencio_canal: { [ID_CANAL_TELEGRAM]: { ate: canalAte, incluir_criticos: sc?.incluir_criticos === true } } }),
      };
    },
    aoErro: (codigo) => d.aviso(`alertas: falha isolada (${codigo})`),
  });
  const emitirSeLigado = (e: EntradaAlerta): AlertaVisao | null => (configLer().ligado ? servico.emitir(e) : null);

  // renderer: `alertas:novo` imediato (P-140: sem coalescência de 300 ms) e contagem coalescida em 100 ms
  const desassinar: Array<() => void> = [];
  desassinar.push(
    d.barramento.assinar<{ alert_id: string }>("alert.created", (p) => {
      const a = repoAlertas.obter(p.alert_id);
      if (a === null) return;
      d.emitirRenderer("alertas:novo", { alerta: a });
      d.barramento.emitirCoalescido("alertas:contagem", "unico", repoAlertas.contar(), 100);
    }),
  );
  desassinar.push(d.barramento.assinar<{ nao_lidos: number; criticos: number }>("alertas:contagem", (c) => d.emitirRenderer("alertas:contagem", c)));
  desassinar.push(d.barramento.assinar<{ ids: string[] }>("alert.read", (p) => {
    d.emitirRenderer("alertas:mudou", { ids: p.ids });
    d.emitirRenderer("alertas:contagem", repoAlertas.contar());
  }));
  desassinar.push(d.barramento.assinar("alert.muted", () => d.emitirRenderer("alertas:mudou", { ids: [] })));

  // ---------------------------------------------------------------- agendador e fontes
  type DadoAgenda = DadoVencimento | { tipo: "digest_diario" } | { tipo: "retencao" };
  let fontes: Fontes;
  const agendador: AgendadorVencimentos<DadoAgenda> = criarAgendadorVencimentos<DadoAgenda>({
    relogio,
    ...(d.timers === undefined ? {} : { timers: d.timers }),
    aoVencer(v) {
      const dado = v.dado;
      if (dado.tipo === "digest_diario") void resumoDiario();
      else if (dado.tipo === "retencao") retencao();
      else fontes.aoVencer(dado);
    },
  });
  fontes = criarFontes({
    emissor: { emitir: emitirSeLigado, suprimidos: () => servico.emissor.suprimidos() },
    tempo,
    metricas,
    agendador: agendador as AgendadorVencimentos<DadoVencimento>,
    agora: () => relogio.agora(),
    config: () => configLer(),
  });
  let desligarFontes: (() => void) | null = null;

  function dadosDoDia(): DadosDia {
    const agora = relogio.agora();
    const inicioDia = new Date(agora);
    inicioDia.setHours(0, 0, 0, 0);
    const abertas = tempo.abertas();
    const concl = d.banco
      .consultar<{ workspace_id: string; trabalho_id: string; task_id: string; ativo_ms: number }>("SELECT workspace_id, trabalho_id, task_id, ativo_ms FROM tarefa_tempo WHERE fim IS NOT NULL AND fim >= ?", [inicioDia.toISOString()])
      .map((r) => {
        const c = portaCusto.tokensDaTask(r);
        return { pontos: portaAgil.pontos(r), tempo_trabalho_ms: r.ativo_ms, tokens: c.fonte === "sem_fonte" ? null : c.entrada + c.saida + c.cache_escrita + c.cache_leitura };
      });
    const atrasadas = abertas
      .map((r) => ({ r, x: dadosDaTask(r) }))
      .filter((o) => typeof o.x.atraso_ms === "number" && o.x.atraso_ms > 0)
      .map((o) => ({ task_id: o.r.task_id, titulo: o.r.task_id, atraso_ms: o.x.atraso_ms }));
    const dia = `${inicioDia.getFullYear()}-${String(inicioDia.getMonth() + 1).padStart(2, "0")}-${String(inicioDia.getDate()).padStart(2, "0")}`;
    return { dia, workspace_id: null, concluidas: concl, em_andamento: abertas.length, atrasadas, bloqueadas: 0, prs_abertos: null };
  }
  async function resumoDiario(): Promise<void> {
    try {
      const cfg = configLer();
      if (cfg.ligado && cfg.digest.diario.ligado) servico.emitir(montarResumoDiario(dadosDoDia()).alerta);
    } catch (e) {
      d.aviso(`alertas: resumo diário falhou (${e instanceof Error ? e.name : "erro"})`);
    } finally {
      reagendarDigest();
    }
  }
  function reagendarDigest(): void {
    const cfg = configLer();
    agendador.cancelar("digest_diario");
    if (!cfg.ligado || !cfg.digest.diario.ligado) return;
    const prox = proximaHoraDigest(cfg.digest.diario.hora, relogio.agora());
    if (prox !== null) agendador.agendar("digest_diario", prox, { tipo: "digest_diario" });
  }
  function retencao(): void {
    try {
      executarRetencao({ alertas: repoAlertas, entregas: repoEntregas }, relogio.agora(), configLer());
      // só o módulo minúsculo de retenção (nada do serviço): roda mesmo com o Telegram nunca aberto nesta sessão
      void import("../nucleo/telegram/retencao").then((m) => m.executarRetencaoTelegram(repoTelegram, relogio.agora())).catch((e) => d.aviso(`alertas: retenção do Telegram falhou (${e instanceof Error ? e.name : "erro"})`));
    } catch (e) {
      d.aviso(`alertas: retenção falhou (${e instanceof Error ? e.name : "erro"})`);
    } finally {
      agendador.agendar("retencao", relogio.agora() + DIA, { tipo: "retencao" });
    }
  }

  // ---------------------------------------------------------------- Telegram (lazy)
  /**
   * O que o consentimento cobre: TODOS os tipos que podem sair por padrão (a lista independe das regras do momento, então ligar uma regra comum não invalida nada) + a marca de "nível completo /
   * mensagens de agente" quando uma regra do usuário passa a enviar mais do que o padrão (pergunta pendente, custo, `agente_mensagem`). Regras efêmeras de pedido remoto acompanham o que o
   * PRÓPRIO usuário pediu e ficam de fora. Escopo maior que o consentido => consentimento deixa de valer (auditoria M4): o usuário precisa aceitar de novo.
   */
  function escopoConsentimento(): { itens: string[]; completo: boolean } {
    const base = TIPOS_ALERTA.filter((t) => CATALOGO[t].externo_por_padrao).map((t) => CATALOGO[t].rotulo).sort();
    const completo = repoRegras
      .listar()
      .some((r) => r.canal_id === ID_CANAL_TELEGRAM && r.ativa && r.origem !== "pedido_remoto" && (r.nivel === "completo" || r.tipos.some((t) => t !== "*" && !CATALOGO[t].externo_por_padrao)));
    return { itens: completo ? [...base, MARCA_NIVEL_COMPLETO] : base, completo };
  }
  const itensDeConsentimento = (): string[] => escopoConsentimento().itens;
  const consentimentoVigente = (): boolean => {
    const c = repoCanais.obter(ID_CANAL_TELEGRAM)?.consentimento ?? null;
    if (c === null || c.versao_texto !== VERSAO_TEXTO_CONSENTIMENTO_TELEGRAM || c.host !== HOST_TELEGRAM_API || !Number.isFinite(Date.parse(c.aceito_em))) return false;
    return !escopoConsentimento().completo || c.itens_enviados.includes(MARCA_NIVEL_COMPLETO);
  };
  /** depois de mexer em regra do Telegram: se o escopo passou do consentido, o consentimento cai (`null`) e a UI pede de novo; nada sai nesse meio-tempo. */
  function revalidarConsentimento(): void {
    const c = repoCanais.obter(ID_CANAL_TELEGRAM);
    if (c !== null && c.consentimento !== null && !consentimentoVigente()) atualizarCanal(ID_CANAL_TELEGRAM, { consentimento: null });
  }
  function telegram(): Promise<LigacaoTelegram> {
    garantirCanais();
    telegramP ??= (d.carregarTelegram === undefined ? import("./alertas-telegram") : d.carregarTelegram())
      .then((m) =>
        m.criarLigacaoTelegram({
          repoTelegram,
          repoCanais,
          repoRegras,
          consentimento: d.consentimento,
          cofre: d.cofre,
          consentimentoVigente,
          itensDeConsentimento,
          maestro: d.maestro,
          nomeWorkspace: (id) => d.workspaces.obter(id)?.nome ?? null,
          workspaceAutomatico: (id) => d.workspaces.permissaoDe(id) === "automatico",
          consulta: criarConsultaTelegram({ banco: d.banco, nomeWorkspace: (id) => d.workspaces.obter(id)?.nome ?? null, dadosDaTask, cotaGeralPct: d.cotaGeralPct, criticosNaoLidos: () => repoAlertas.contar().criticos, ...(d.consumo === undefined ? {} : { consumo: d.consumo }) }),
          gates: criarGatesTelegram({ banco: d.banco, config: d.config, portoes: d.portoes }),
          emitirAlerta: emitirSeLigado,
          emitirRenderer: d.emitirRenderer,
          atualizarCanal: (patch) => atualizarCanal(ID_CANAL_TELEGRAM, patch),
          cancelarFila: () => entregador.cancelar(ID_CANAL_TELEGRAM),
          silenciarCanal: (ate, criticos) => {
            d.config.definir(CHAVE_SILENCIO_TELEGRAM, { ate, incluir_criticos: criticos });
            atualizarCanal(ID_CANAL_TELEGRAM, { silenciado_ate: ate });
          },
          relogio: { agora: () => relogio.agora() },
          config: () => (d.config.obter<Record<string, unknown>>(CHAVE_CONFIG_TELEGRAM) ?? {}) as never,
          ...(d.scrub === undefined ? {} : { scrub: d.scrub }),
          ...(d.online === undefined ? {} : { online: d.online }),
          escolherArquivoDeSaida: d.escolherArquivoDeSaida,
          ...(d.dormirTelegram === undefined ? {} : { dormir: d.dormirTelegram }),
          ...(d.env === undefined ? {} : { env: d.env }),
          aviso: d.aviso,
        }),
      )
      .then((l) => {
        telegramCarregado = true;
        return l;
      })
      .catch((e) => {
        telegramP = null; // permite tentar de novo
        throw e;
      });
    return telegramP;
  }

  // registra o canal Telegram (a fábrica só roda no primeiro envio: import dinâmico)
  registro.registrar("telegram", async () => (await telegram()).servico.canal);

  async function telegramEstado(): Promise<EstadoTelegram> {
    return (await telegram()).estado();
  }

  // ---------------------------------------------------------------- modelos
  function modeloVisao(tipo: TipoAlerta, canal_tipo: TipoCanal, nivel: NivelTemplate, editados: Map<string, { corpo: string; atualizado_em: string | null }>): ModeloVisao {
    const e = editados.get(`${tipo}|${canal_tipo}|${nivel}`);
    return { tipo, canal_tipo, nivel, corpo: e?.corpo ?? corpoPadrao(tipo, canal_tipo, nivel), editado: e !== undefined, atualizado_em: e?.atualizado_em ?? null };
  }
  const editadosAtuais = (): Map<string, { corpo: string; atualizado_em: string | null }> => new Map(repoModelos.listar().filter((m) => m.editado).map((m) => [`${m.tipo}|${m.canal_tipo}|${m.nivel}`, { corpo: m.corpo, atualizado_em: m.atualizado_em }]));

  function destinoDe(a: AlertaVisao): DestinoEntidade {
    switch (a.entidade_tipo) {
      case "task": return { tipo: "task", workspace_id: a.workspace_id, entidade_id: a.entidade_id };
      case "missao": return { tipo: "missao", workspace_id: a.workspace_id, entidade_id: a.entidade_id };
      case "pane":
      case "terminal": return { tipo: "pane", workspace_id: a.workspace_id, entidade_id: a.entidade_id };
      case "pr": return { tipo: "pr", workspace_id: a.workspace_id, entidade_id: a.entidade_id };
      case "canal": return { tipo: "canal", workspace_id: null, entidade_id: a.entidade_id };
      case "componente": return { tipo: "componente", workspace_id: null, entidade_id: a.entidade_id };
      default: return null;
    }
  }

  const alertRaise = criarAlertRaise({ emissor: { emitir: emitirSeLigado }, relogio, scrub });

  const L: LigacaoAlertas = {
    servico,
    entregador,
    fontes,
    tempo,
    emitir: emitirSeLigado,
    catalogo: () => TIPOS_ALERTA.map((t) => ({ tipo: t, rotulo: CATALOGO[t].rotulo, severidade: CATALOGO[t].severidade, fonte: CATALOGO[t].fonte, agrupavel: CATALOGO[t].agrupavel, externo_por_padrao: CATALOGO[t].externo_por_padrao, fonte_indisponivel: CATALOGO[t].fonte_indisponivel })),
    listar: (f) => servico.listar({ ...f, limite: Math.min(f.limite ?? 50, 100) }),
    contar: () => servico.contar(),
    marcarLido: (ids) => ({ n: servico.marcarLido(ids) }),
    marcarTodosLidos: (filtro = {}) => ({ n: servico.marcarTodosLidos(filtro) }),
    silenciar: (alvo, ate) => ({ ok: servico.silenciar(alvo, ate) }),
    regrasListar: () => repoRegras.listar(),
    regraGravar(r) {
      garantirCanais();
      const canal = repoCanais.obter(r.canal_id);
      if (canal === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
      const existente = r.id === undefined ? null : (repoRegras.listar().find((x) => x.id === r.id) ?? null);
      if (existente?.origem === "pedido_remoto") throw new ErroAlertasIpc("rule_violation", "regra de acompanhamento de pedido remoto não é editável (só apagável)");
      for (const t of r.tipos) if (t !== "*" && !ehTipoAlerta(t)) throw new ErroAlertasIpc("invalid_argument", "tipo de alerta desconhecido");
      // o renderer nunca define destino fixo, efemeridade nem origem: isso é do main
      const regra: Regra = { ...r, id: r.id ?? novoIdRegra(), efemera_ate: null, origem: existente?.origem === "padrao" ? "padrao" : "usuario", chat_ref: null };
      repoRegras.gravar(regra);
      if (regra.canal_id === ID_CANAL_TELEGRAM) revalidarConsentimento();
      return regra;
    },
    regraApagar: (id) => ({ ok: repoRegras.apagar(id) }),
    regraPreset(preset, canal_id) {
      garantirCanais();
      if (repoCanais.obter(canal_id) === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
      const r = criarRegraDePreset(preset, canal_id, novoIdRegra(), configLer().digest.diario.hora);
      repoRegras.gravar(r);
      if (canal_id === ID_CANAL_TELEGRAM) revalidarConsentimento();
      return r;
    },
    silencioLer: lerSilencio,
    silencioGravar(s) {
      const v: SilencioGlobalVisao = { janela: s.janela, temporario_ate: s.temporario_ate, temporario_incluir_criticos: s.temporario_incluir_criticos };
      d.config.definir(CHAVE_SILENCIO_GLOBAL, v);
      return v;
    },
    modelosListar() {
      const ed = editadosAtuais();
      return TIPOS_ALERTA.flatMap((t) => TIPOS_CANAL_COM_MODELO.flatMap((c) => NIVEIS.map((n) => modeloVisao(t, c, n, ed))));
    },
    modeloGravar(m) {
      const erros = validar(m.corpo, m.tipo);
      if (erros.length > 0) return { erros };
      repoModelos.gravar({ tipo: m.tipo, canal_tipo: m.canal_tipo, nivel: m.nivel, corpo: m.corpo });
      return modeloVisao(m.tipo, m.canal_tipo, m.nivel, editadosAtuais());
    },
    modeloRestaurar(m) {
      repoModelos.restaurar(m.tipo, m.canal_tipo, m.nivel);
      return modeloVisao(m.tipo, m.canal_tipo, m.nivel, editadosAtuais());
    },
    modeloPrever: (m) => prever(m.tipo, m.canal_tipo, m.nivel, m.corpo, m.canal_tipo === "telegram" ? escaparHtml : undefined),
    configLer,
    configGravar(patch) {
      const atual = configLer();
      const novo = normalizarConfig({ ...atual, ...patch, atraso: { ...atual.atraso, ...(patch.atraso ?? {}) }, digest: { diario: { ...atual.digest.diario, ...(patch.digest?.diario ?? {}) }, sprint: { ...atual.digest.sprint, ...(patch.digest?.sprint ?? {}) } } });
      d.config.definir(CHAVE_CONFIG_ALERTAS, novo);
      reagendarDigest();
      return novo;
    },
    abrirEntidade(alerta_id) {
      const a = repoAlertas.obter(alerta_id);
      if (a === null) return { ok: false, destino: null };
      const destino = destinoDe(a);
      return { ok: destino !== null, destino };
    },
    canaisListar() {
      garantirCanais();
      return repoCanais.listar().map(visaoCanal);
    },
    async canalConsentir(canal_id, versao_texto, hash_texto) {
      garantirCanais();
      const c = repoCanais.obter(canal_id);
      if (c === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
      if (c.tipo !== "telegram") throw new ErroAlertasIpc("invalid_argument", "este canal não usa consentimento");
      const { textoConsentimento } = await import("../nucleo/telegram/assistente");
      const itens = itensDeConsentimento();
      const t = textoConsentimento(itens);
      if (versao_texto !== t.versao_texto || hash_texto !== t.hash_texto) throw new ErroAlertasIpc("consent_texto_desatualizado", "o texto de consentimento mudou: leia e aceite de novo");
      d.consentimento.permitirHost(HOST_TELEGRAM_API);
      return visaoCanal(atualizarCanal(canal_id, { consentimento: { versao_texto: t.versao_texto, hash_texto: t.hash_texto, aceito_em: agoraIso(relogio), host: t.host, itens_enviados: itens } }));
    },
    async canalLigarSaida(canal_id) {
      garantirCanais();
      const c = repoCanais.obter(canal_id);
      if (c === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
      if (c.tipo === "telegram") {
        if (!consentimentoVigente()) throw new ErroAlertasIpc("consentimento_ausente", "aceite o consentimento antes de ligar a saída");
        let tem = false;
        try {
          tem = await (await d.cofre()).existe(nomeSegredoTokenTelegram(c.id));
        } catch {
          tem = false;
        }
        if (!tem) throw new ErroAlertasIpc("token_ausente", "salve o token do bot (no cofre) antes de ligar a saída");
        d.consentimento.permitirHost(HOST_TELEGRAM_API);
      }
      return visaoCanal(atualizarCanal(canal_id, { saida_ligada: true, estado: "ativo", erro_codigo: null }));
    },
    canalDesligarSaida(canal_id) {
      garantirCanais();
      const c = repoCanais.obter(canal_id);
      if (c === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
      entregador.cancelar(canal_id);
      return visaoCanal(atualizarCanal(canal_id, { saida_ligada: false, ...(c.tipo === "telegram" && c.entrada_ligada ? {} : { estado: c.tipo === "so" ? "ativo" : ("desligado" as const) }) }));
    },
    async canalTesteEnvio(canal_id) {
      garantirCanais();
      const c = repoCanais.obter(canal_id);
      if (c === null) throw new ErroAlertasIpc("not_found", "canal inexistente");
      if (c.tipo === "telegram" && !consentimentoVigente()) return { ok: false, detalhe: "consentimento ausente" };
      const adaptador: CanalComunicacao | null = await registro.obter(c.tipo);
      if (adaptador === null) return { ok: false, detalhe: "canal indisponível" };
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      t.unref?.();
      try {
        return await adaptador.testar(ctl.signal);
      } catch {
        return { ok: false, detalhe: "falha ao enviar o teste" };
      } finally {
        clearTimeout(t);
      }
    },
    canalSaidaPronta(canal_id) {
      garantirCanais();
      const c = repoCanais.obter(canal_id);
      if (c === null || !c.saida_ligada || c.estado === "desligado" || c.estado === "erro") return false;
      return c.tipo === "telegram" ? consentimentoVigente() : c.tipo === "so";
    },
    async canalEnviarTexto(canal_id, titulo, texto) {
      garantirCanais();
      const c = repoCanais.obter(canal_id);
      if (c === null) return { ok: false, erro: "canal inexistente" };
      if (!c.saida_ligada || c.estado === "desligado") return { ok: false, erro: "desligado" };
      if (c.tipo === "telegram" && !consentimentoVigente()) return { ok: false, erro: "consentimento_ausente" };
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      t.unref?.();
      try {
        const adaptador: CanalComunicacao | null = await registro.obter(c.tipo);
        if (adaptador === null) return { ok: false, erro: "canal indisponível" };
        const limpo = scrub(texto);
        const r = await adaptador.enviar({ entrega_id: `div_${randomBytes(6).toString("base64url")}`, alerta_ids: [], titulo: scrub(titulo), texto: limpo, severidade: "info", silenciosa: true }, ctl.signal);
        return r.ok ? { ok: true, erro: null } : { ok: false, erro: r.erro };
      } catch {
        return { ok: false, erro: "falha ao enviar" };
      } finally {
        clearTimeout(t);
      }
    },
    telegramCarregado: () => telegramCarregado,
    telegram,
    telegramEstado,
    async panicoTelegram(pararExecucoes) {
      try {
        const r = await (await telegram()).panico(pararExecucoes);
        return { ok: r.ok, completo: true };
      } catch (e) {
        d.aviso(`telegram: o pânico completo falhou (${e instanceof Error ? e.name : "erro"}); desligando o canal direto`);
        try {
          entregador.cancelar(ID_CANAL_TELEGRAM);
          garantirCanais();
          atualizarCanal(ID_CANAL_TELEGRAM, { saida_ligada: false, entrada_ligada: false, estado: "desligado" });
          d.consentimento.revogarHost(HOST_TELEGRAM_API);
          return { ok: true, completo: false };
        } catch {
          return { ok: false, completo: false };
        }
      }
    },
    aoAtividadeTerminal(ferramentaId, nome, atividade) {
      if (atividade === "trabalhando" || !configLer().ligado) return false;
      const aguardando = atividade === "aguardando";
      // cada fim de turno/pedido de aprovação do terminal é um aviso próprio (como a notificação nativa de antes): o `estado` leva o instante para o dedupe não fundi-los
      const a = servico.emitir({
        tipo: aguardando ? "pane_aguardando" : "pane_terminou",
        entidade_tipo: "terminal",
        entidade_id: ferramentaId.slice(0, 80),
        titulo: aguardando ? `${nome} aguarda você` : `${nome} terminou`,
        dados: { cli: nome.slice(0, 80), missao: null, espera_ms: 0, pergunta: null },
        estado: `${atividade}:${relogio.agora()}`,
      });
      return a !== null;
    },
    alertRaise(args, ctx) {
      try {
        const c: ContextoAlertRaise = { ...ctx };
        return alertRaise.executar(args, c);
      } catch (e) {
        if (e instanceof ErroAlertRaise) throw e;
        throw new ErroAlertRaise("invalid_args");
      }
    },
    paraMcp() {
      return {
        levantar: async (claims, args) => {
          // identidade SEMPRE do token; piloto ou worker conforme o papel do Pane (o catálogo já esconde a tool de quem não pode: esta é a segunda barreira)
          const role = claims.role === "piloto" ? "piloto" : "worker";
          try {
            return L.alertRaise(args, { pane_id: claims.pane_id, mission_id: claims.mission_id, workspace_id: claims.workspace_id, role, worker_habilitado: role === "worker" });
          } catch (e) {
            if (e instanceof ErroAlertRaise) {
              if (e.codigo === "rate_limited") throw violacaoDeRegra("limit_reached", "Limite de 3 alertas por hora neste painel.");
              if (e.codigo === "forbidden") throw violacaoDeRegra("forbidden_role", "Este papel não levanta alertas.");
              throw argumentoInvalido("Argumentos de alerta inválidos.");
            }
            throw e;
          }
        },
      };
    },
    aoSuspenderSistema() {
      if (telegramCarregado) void telegram().then((t) => t.aoSuspender());
    },
    aoRetomarSistema() {
      agendador.retomar();
      if (telegramCarregado) void telegram().then((t) => t.aoRetomarSistema());
    },
    async iniciar() {
      garantirCanais();
      desligarFontes ??= ligarFontes({
        banco: d.banco,
        barramento: d.barramento,
        fontes,
        tempo,
        emitir: emitirSeLigado,
        conta: (id) => {
          const c = d.banco.consultarUm<{ rotulo: string; provedor: string }>("SELECT rotulo, provedor FROM conta WHERE id = ?", [id]);
          return c === undefined ? null : { rotulo: c.rotulo, provedor: c.provedor };
        },
        destinoDaTroca: (id) => {
          const t = d.banco.consultarUm<{ para_conta_id: string | null }>("SELECT para_conta_id FROM troca_log WHERE id = ?", [id]);
          if (t?.para_conta_id == null) return null;
          return d.banco.consultarUm<{ rotulo: string }>("SELECT rotulo FROM conta WHERE id = ?", [t.para_conta_id])?.rotulo ?? null;
        },
        indiceMetodo: d.indiceMetodo,
        aviso: d.aviso,
      });
      // fim de Missão: fecha o ciclo da entrada do Telegram (só se o módulo já está carregado; nunca o carrega por isto)
      desassinar.push(
        d.barramento.assinar<{ mission_id?: string; estado?: string }>("mission.closed", (p) => {
          if (!telegramCarregado || typeof p.mission_id !== "string" || (p.estado !== "concluida" && p.estado !== "falhou")) return;
          const m = d.banco.consultarUm<{ titulo: string }>("SELECT titulo FROM mission WHERE id = ?", [p.mission_id]);
          void telegram().then((t) => t.aoMissaoFechada(p.mission_id as string, p.estado as "concluida" | "falhou", scrub(m?.titulo ?? "")));
        }),
      );
      const vivos = new Set(d.banco.consultar<{ id: string }>("SELECT id FROM pane WHERE estado <> 'encerrado'").map((p) => p.id));
      tempo.reconstituir(vivos);
      entregador.acordar();
      reagendarDigest();
      agendador.agendar("retencao", relogio.agora() + 60_000, { tipo: "retencao" });
      // entrada ligada + consentimento + token + autorizado: retoma o poller (nunca no boot da 1ª onda; só aqui, em ocioso)
      const tg = repoCanais.obter(ID_CANAL_TELEGRAM);
      if (tg !== null && tg.entrada_ligada && consentimentoVigente()) void telegram().then((t) => t.retomarSeLigado()).catch((e) => d.aviso(`telegram: ${e instanceof Error ? e.name : "erro"}`));
    },
    encerrar() {
      agendador.parar();
      entregador.parar();
      desligarFontes?.();
      desligarFontes = null;
      for (const f of desassinar.splice(0)) f();
      if (telegramCarregado) void telegram().then((t) => t.encerrar()).catch(() => undefined);
    },
  };
  return L;
}
