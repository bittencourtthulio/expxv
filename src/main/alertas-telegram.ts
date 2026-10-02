// Ligação do bot do Telegram no main (Fase 20, T-20.33). ESTE MÓDULO SÓ É CARREGADO POR `import()` dinâmico (P-143), e só quando o usuário abre o assistente ou o canal está
// ligado + consentido: ele importa, também dinamicamente, o núcleo `nucleo/telegram`. Importar este arquivo não abre socket nem cria timer: o poller só nasce em `ligarEntrada()`
// (clique) ou em `retomarSeLigado()` (onda 2 do boot, SÓ com entrada ligada + consentimento vigente + token no cofre + autorizado). Token: só no cofre (nome
// `TELEGRAM_BOT_TOKEN_<canal>`); entra pela UI uma vez (`tokenSalvar`) e volta só mascarado. Cada clique de "testar token" vale como consentimento por clique para o host.
import { writeFile } from "node:fs/promises";
import { ID_CANAL_TELEGRAM, nomeSegredoTokenTelegram, HOST_TELEGRAM_API } from "../compartilhado/alertas";
import type {
  AuditoriaTelegramVisao,
  AutorizadoCompletoVisao,
  CanalRegistro,
  EntradaAlerta,
  EstadoTelegram,
  NaoAutorizadoVisao,
  Pagina,
  PedidoConfigAutorizado,
  PareamentoVisao,
  ResultadoTesteToken,
} from "../compartilhado/alertas";
import type { Cofre } from "../nucleo/cofre";
import type { RegistroConsentimento } from "../nucleo/rede";
import type { RepoCanaisSql } from "../nucleo/banco/repos/alertas";
import type { RepoRegras } from "../nucleo/alertas/portas";
import type { Assistente } from "../nucleo/telegram/assistente";
import type { ServicoTelegram, EventoServico } from "../nucleo/telegram/servico";
import type { PortaConsulta, PortaGates } from "../nucleo/telegram/portas-entrada";
import type { ConfigTelegram } from "../nucleo/telegram/entrada";
import type { RepoTelegram } from "../nucleo/telegram/repo";
import { criarRedeTelegram, type RedeTelegram } from "./alertas-rede";
import { criarOrquestradorTelegram, criarRigidezTelegram, type MaestroParaTelegram } from "./alertas-orquestrador";

export interface DepsTelegramMain {
  canal_id?: string;
  repoTelegram: RepoTelegram;
  repoCanais: RepoCanaisSql;
  repoRegras: RepoRegras;
  consentimento: RegistroConsentimento;
  cofre: () => Promise<Cofre>;
  /** consentimento VIGENTE do canal (versão do texto atual). */
  consentimentoVigente(): boolean;
  /** itens (rótulos dos tipos) hoje ligados ao canal, para o texto de consentimento. */
  itensDeConsentimento(): string[];
  maestro: () => MaestroParaTelegram | null;
  nomeWorkspace(workspace_id: string): string | null;
  workspaceAutomatico(workspace_id: string): boolean;
  consulta: PortaConsulta;
  gates: PortaGates;
  emitirAlerta(e: EntradaAlerta): unknown;
  emitirRenderer(canal: string, payload: unknown): void;
  /** grava o canal e avisa `canais:estado`. */
  atualizarCanal(patch: Partial<CanalRegistro>): CanalRegistro;
  cancelarFila(): void;
  silenciarCanal(ate_iso: string | null, incluir_criticos: boolean): void;
  relogio: { agora(): number };
  config(): Partial<ConfigTelegram>;
  scrub?: (t: string) => string;
  online?: () => boolean;
  /** abre o diálogo de salvar (o destino nunca vem do renderer). */
  escolherArquivoDeSaida(nomeSugerido: string): Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  aviso(m: string): void;
  /** só testes. */
  dormir?: import("../nucleo/telegram/portas").DormirPorta;
}

export interface LigacaoTelegram {
  servico: ServicoTelegram;
  assistente: Assistente;
  rede: RedeTelegram;
  estado(): Promise<EstadoTelegram>;
  tokenTestar(token: string | null): Promise<ResultadoTesteToken>;
  tokenSalvar(token: string): Promise<{ ok: boolean; token_mascarado?: string; bot?: { id: number; username: string; nome: string }; erro?: ResultadoTesteToken["erro"]; instrucao?: string }>;
  tokenRemover(): Promise<{ ok: boolean }>;
  webhookLimpar(): Promise<{ ok: boolean }>;
  comandosConfigurar(): Promise<{ ok: boolean }>;
  parearIniciar(): { codigo: string; link: string | null; expira_em: string };
  parearCancelar(): { ok: boolean };
  parearDecidir(pedido_id: string, permitir: boolean): Promise<import("../compartilhado/alertas").AutorizadoVisao | null>;
  autorizadoConfig(p: PedidoConfigAutorizado): Promise<{ ok: boolean; autorizado?: AutorizadoCompletoVisao; erro?: string }>;
  autorizadoRevogar(id: string): { ok: boolean };
  naoAutorizadoListar(): NaoAutorizadoVisao[];
  naoAutorizadoBloquear(user_id: number): { ok: boolean };
  entradaLigar(ligada: boolean): Promise<{ ok: boolean; erro?: string; estado: EstadoTelegram }>;
  retomar(): Promise<EstadoTelegram>;
  panico(parar_execucoes: boolean): Promise<{ ok: boolean; revogados: number }>;
  planoDecidirDesktop(p: { plano_id: string; decisao: "aprovar" | "cancelar"; args_hash: string }): Promise<{ ok: boolean; motivo?: string }>;
  auditoriaListar(depois: string | null, limite: number): Pagina<AuditoriaTelegramVisao>;
  auditoriaExportar(): Promise<{ ok: boolean; cancelado?: boolean }>;
  /** onda 2 do boot: retoma o poller SÓ se entrada ligada + consentimento + token + autorizado. Nunca lança. */
  retomarSeLigado(): Promise<void>;
  aoMissaoFechada(mission_id: string, resultado: "concluida" | "falhou", resumo: string): void;
  aoSuspender(): void;
  aoRetomarSistema(): void;
  encerrar(): Promise<void>;
}

const aVisaoPareamento = (e: string, expira_em: string | null, pedido: PareamentoVisao["pedido"]): PareamentoVisao => ({
  estado: e === "fechado" ? "inativo" : (e as PareamentoVisao["estado"]),
  expira_em,
  pedido,
});

export async function criarLigacaoTelegram(d: DepsTelegramMain): Promise<LigacaoTelegram> {
  const canal_id = d.canal_id ?? ID_CANAL_TELEGRAM;
  const tg = await import("../nucleo/telegram");
  const nomeSegredo = nomeSegredoTokenTelegram(canal_id);
  let cliques = 0;
  const comClique = async <T>(f: () => Promise<T>): Promise<T> => {
    cliques++;
    try {
      return await f();
    } finally {
      cliques--;
    }
  };
  const rede = criarRedeTelegram({
    consentimento: d.consentimento,
    autorizado: () => cliques > 0 || d.consentimentoVigente(),
    ...(d.scrub === undefined ? {} : { scrub: d.scrub }),
    ...(d.env === undefined ? {} : { env: d.env }),
  });
  const base = rede.baseTeste;
  const hostPorta = base === null ? {} : { host: base.host, porta: base.porta };

  async function lerToken(): Promise<string | null> {
    try {
      const c = await d.cofre();
      if (!(await c.existe(nomeSegredo))) return null;
      return await c.obter(nomeSegredo);
    } catch {
      return null; // cofre trancado/indisponível: sem token, sem rede
    }
  }

  /** o poller foi ligado SÓ para receber o `/start <código>` do pareamento: ao fechar a janela (expirou, cancelou, pareou, negou) ele para (sem entrada ligada não há polling). */
  let pollerSoParaPareamento = false;
  /** confere a janela do pareamento (expira, queima por tentativas erradas, fecha) e então encerra o poller que existia só por ela; só existe durante a janela. */
  let vigiaPareamento: NodeJS.Timeout | null = null;
  const fecharPollerDoPareamento = (): void => {
    if (vigiaPareamento !== null) {
      clearInterval(vigiaPareamento);
      vigiaPareamento = null;
    }
    if (!pollerSoParaPareamento) return;
    pollerSoParaPareamento = false;
    if (d.repoCanais.obter(canal_id)?.entrada_ligada !== true) void servico.desligarEntrada();
  };
  let pareamentoEvento: PareamentoVisao = aVisaoPareamento("fechado", null, null);
  let eventoPareamentoExpira: string | null = null;

  const orquestrador = criarOrquestradorTelegram({ maestro: d.maestro, nomeWorkspace: d.nomeWorkspace, workspaceAutomatico: d.workspaceAutomatico });
  const cfgTelegram = (): ConfigTelegram => ({ ...tg.CONFIG_TELEGRAM_PADRAO, ...d.config() });
  const rigidez = criarRigidezTelegram({ maestro: d.maestro, maximoRemoto: () => cfgTelegram().rigidez_max_remota });

  const eventos = (e: EventoServico): void => {
    if (e.tipo === "pareamento") {
      const pedido = e.pedido === undefined ? null : { pedido_id: e.pedido.pedido_id, nome: e.pedido.nome, user_id: e.pedido.user_id };
      pareamentoEvento = aVisaoPareamento(e.estado, eventoPareamentoExpira, pedido);
      d.emitirRenderer("telegram:pareamento", { estado: pareamentoEvento.estado === "inativo" ? "cancelado" : pareamentoEvento.estado, ...(pedido === null ? {} : { pedido }) });
      if (e.estado === "expirado" || e.estado === "cancelado" || e.estado === "negado" || e.estado === "pareado") fecharPollerDoPareamento();
    } else if (e.tipo === "poller") {
      const t = e.estado === "conflito" ? "conflito" : e.estado === "erro" && e.detalhe === "token_invalido" ? "token_invalido" : e.estado === "token_possivelmente_comprometido" ? "webhook_suspeito" : e.estado === "erro" ? "rede" : e.estado === "ativo" ? "ativo" : "parado";
      d.emitirRenderer("telegram:evento", { tipo: t });
      if (e.estado === "conflito" || e.estado === "erro" || e.estado === "token_possivelmente_comprometido") {
        d.atualizarCanal({ estado: e.estado === "conflito" ? "conflito" : "erro", erro_codigo: e.estado === "erro" && e.detalhe === "token_invalido" ? "token_invalido" : e.estado });
      }
    } else if (e.tipo === "panico") d.emitirRenderer("telegram:evento", { tipo: "panico" });
    else if (e.tipo === "entrada_expirou") d.emitirRenderer("telegram:evento", { tipo: "entrada_expirou" });
    else if (e.tipo === "plano_pendente_desktop") d.emitirRenderer("telegram:plano_pendente_desktop", { plano_id: e.plano_id, resumo: e.resumo, args_hash: e.args_hash, expira_em: e.expira_em });
  };

  const servico = tg.criarServicoTelegram({
    canal_id,
    repo: d.repoTelegram,
    rede,
    token: lerToken,
    consentimentoValido: d.consentimentoVigente,
    ...hostPorta,
    relogio: d.relogio,
    ...(d.dormir === undefined ? {} : { dormir: d.dormir }),
    orquestrador,
    rigidez,
    consulta: d.consulta,
    gates: d.gates,
    regras: d.repoRegras,
    alertas: { emitir: (e) => d.emitirAlerta(e) },
    estadoCanal: () => d.repoCanais.obter(canal_id)?.estado ?? "desligado",
    desligarCanal: () => {
      d.atualizarCanal({ saida_ligada: false, entrada_ligada: false, estado: "desligado" });
      // a allowlist é reposta a cada chamada AUTORIZADA (`alertas-rede`); quem barra de verdade é `autorizado()` (consentimento vigente OU clique em curso): depois do pânico nada abre socket sozinho
      d.consentimento.revogarHost(HOST_TELEGRAM_API);
    },
    cancelarFila: () => d.cancelarFila(),
    silenciarCanal: (ate, criticos) => d.silenciarCanal(ate, criticos),
    eventos,
    somentePareamento: () => pollerSoParaPareamento,
    ...(d.online === undefined ? {} : { online: d.online }),
    ...(d.scrub === undefined ? {} : { scrub: d.scrub }),
    config: d.config(),
  });

  const guardarToken = async (valor: string): Promise<void> => {
    await (await d.cofre()).guardar({ id: null, nome: nomeSegredo, valor, escopo: "global", workspace_id: null, sensivel: true });
  };

  const assistente = tg.criarAssistente({
    canal_id,
    apiPara: (token) => tg.criarClienteBotApi({ rede, token: () => token, consentimentoValido: () => cliques > 0 || d.consentimentoVigente(), ...hostPorta }),
    apiSalva: () => tg.criarClienteBotApi({ rede, token: lerToken, consentimentoValido: () => cliques > 0 || d.consentimentoVigente(), ...hostPorta }),
    cofre: {
      disponivel: () => cofreDisponivelSync,
      async guardar(nome, valor) {
        if (nome !== nomeSegredo) throw new Error("nome de segredo inesperado");
        await guardarToken(valor);
      },
      async remover(nome) {
        const c = await d.cofre();
        const e = (await c.listar()).find((x) => x.nome === nome);
        if (e !== undefined) await c.apagar(e.id);
      },
      async existe(nome) {
        return (await d.cofre()).existe(nome);
      },
    },
  });
  let cofreDisponivelSync = false;
  const atualizarCofre = async (): Promise<boolean> => {
    try {
      const e = await (await d.cofre()).estado();
      cofreDisponivelSync = e.ok && !e.bloqueado;
    } catch {
      cofreDisponivelSync = false;
    }
    return cofreDisponivelSync;
  };

  const workspacesDe = (id: string): AutorizadoCompletoVisao["workspaces"] => d.repoTelegram.workspaces(id).map((w) => ({ workspace_id: w.workspace_id, modo: w.modo, padrao: w.padrao }));
  const autorizadoCompleto = (id: string): AutorizadoCompletoVisao | null => {
    const a = d.repoTelegram.autorizadoPorId(id);
    return a === null ? null : { ...tg.visao(a), workspaces: workspacesDe(id) };
  };

  function visaoCanal(): EstadoTelegram["canal"] {
    const c = d.repoCanais.obter(canal_id);
    const est = d.repoTelegram.estado(canal_id);
    const reg: CanalRegistro = c ?? { id: canal_id, tipo: "telegram", nome: "Telegram", estado: "desligado", saida_ligada: false, entrada_ligada: false, consentimento: null, silenciado_ate: null, erro_codigo: null };
    return {
      id: reg.id,
      tipo: "telegram",
      nome: reg.nome,
      estado: reg.estado,
      resumo: est.bot_username === null || est.bot_username === "" ? "Telegram" : `@${est.bot_username}`,
      saida_ligada: reg.saida_ligada,
      entrada_ligada: reg.entrada_ligada,
      consentimento: reg.consentimento === null ? null : { versao_texto: reg.consentimento.versao_texto, aceito_em: reg.consentimento.aceito_em, host: reg.consentimento.host },
      silenciado_ate: reg.silenciado_ate,
      erro_codigo: reg.erro_codigo,
      capacidades: { entrada: true, botoes: true, formato: "html", precisa_consentimento: true },
    };
  }

  async function estado(): Promise<EstadoTelegram> {
    await atualizarCofre();
    const est = d.repoTelegram.estado(canal_id);
    const cfg = d.repoCanais.config(canal_id);
    const mascarado = typeof cfg["token_mascarado"] === "string" ? (cfg["token_mascarado"] as string) : null;
    const pol = servico.poller.estado();
    const par = servico.pareamento.estado();
    const pendentesPlano = d.repoTelegram.listarAutorizados(canal_id).reduce((n, a) => n + d.repoTelegram.entradasDoAutorizado(a.id, ["plano_enviado"]).length, 0);
    return {
      canal: visaoCanal(),
      bot: est.bot_id === null ? null : { id: est.bot_id, username: est.bot_username ?? "", nome: est.bot_nome ?? "" },
      token_mascarado: mascarado,
      cofre_disponivel: cofreDisponivelSync,
      texto_consentimento: tg.textoConsentimento(d.itensDeConsentimento()),
      passos_botfather: [...tg.PASSOS_BOTFATHER],
      poller: { estado: pol, ultimo_poll_em: est.ultimo_poll_em, conflito: pol === "conflito" },
      pareamento: par === "fechado" ? aVisaoPareamento("fechado", null, null) : pareamentoEvento.estado === "inativo" ? aVisaoPareamento(par, eventoPareamentoExpira, null) : pareamentoEvento,
      autorizados: d.repoTelegram.listarAutorizados(canal_id).filter((a) => a.revogado_em === null).map((a) => ({ ...tg.visao(a), workspaces: workspacesDe(a.id) })),
      contadores: { nao_autorizados: d.repoTelegram.listarNaoAutorizados().length, planos_pendentes: pendentesPlano },
    };
  }

  const bot = (b: { id: number; username: string; nome: string } | undefined): { id: number; username: string; nome: string } | undefined => b;

  const L: LigacaoTelegram = {
    servico,
    assistente,
    rede,
    estado,
    async tokenTestar(token) {
      await atualizarCofre();
      return comClique(async () => {
        const r = await assistente.testar(token);
        return { ok: r.ok, ...(r.bot === undefined ? {} : { bot: r.bot }), ...(r.erro === undefined ? {} : { erro: r.erro }), ...(r.instrucao === undefined ? {} : { instrucao: r.instrucao }) };
      });
    },
    async tokenSalvar(token) {
      await atualizarCofre();
      return comClique(async () => {
        let r = await assistente.salvar(token);
        // token VÁLIDO (getMe ok) mas com webhook ativo: guarda no cofre mesmo assim, para o passo "Limpar webhook" usar o token salvo; a UI continua mostrando o aviso
        if (!r.ok && r.erro === "webhook_ativo" && r.bot !== undefined) {
          await guardarToken(token);
          r = { ...r, token_mascarado: tg.mascararToken(token) };
        }
        if (r.token_mascarado !== undefined && (r.ok || r.erro === "webhook_ativo")) {
          const b = bot(r.bot);
          if (b !== undefined) d.repoTelegram.salvarEstado(canal_id, { bot_id: b.id, bot_username: b.username, bot_nome: b.nome, ultimo_erro_codigo: null });
          d.repoCanais.gravarConfig(canal_id, { ...d.repoCanais.config(canal_id), token_mascarado: r.token_mascarado ?? null });
          d.atualizarCanal({ estado: "configurando", erro_codigo: null });
        }
        return { ok: r.ok, ...(r.token_mascarado === undefined ? {} : { token_mascarado: r.token_mascarado }), ...(r.bot === undefined ? {} : { bot: r.bot }), ...(r.erro === undefined ? {} : { erro: r.erro }), ...(r.instrucao === undefined ? {} : { instrucao: r.instrucao }) };
      });
    },
    async tokenRemover() {
      await servico.panico.panico({ parar_execucoes: false, origem: "desktop:token_removido" });
      await assistente.remover();
      const { token_mascarado: _t, ...resto } = d.repoCanais.config(canal_id);
      void _t;
      d.repoCanais.gravarConfig(canal_id, resto);
      d.repoTelegram.salvarEstado(canal_id, { bot_id: null, bot_username: null, bot_nome: null });
      return { ok: true };
    },
    async webhookLimpar() {
      return comClique(() => assistente.limparWebhook());
    },
    async comandosConfigurar() {
      return comClique(() => assistente.configurarComandos());
    },
    parearIniciar() {
      if (!d.consentimentoVigente()) throw new Error("consentimento_ausente: aceite o consentimento antes de parear");
      const r = servico.iniciarPareamento();
      // o `/start <código>` só chega com o poller ligado: liga SÓ pela janela do pareamento (e o desliga ao fechar, se a entrada não está ligada)
      if (!servico.poller.ativo()) {
        d.consentimento.permitirHost(HOST_TELEGRAM_API);
        pollerSoParaPareamento = true;
        servico.poller.iniciar();
        vigiaPareamento = setInterval(() => {
          if (servico.pareamento.estado() === "fechado") fecharPollerDoPareamento();
        }, 5_000);
        vigiaPareamento.unref?.();
      }
      const username = d.repoTelegram.estado(canal_id).bot_username;
      if (r.link === null && username !== null && username !== "") r.link = `https://t.me/${username}?start=${r.codigo.replace("-", "")}`;
      eventoPareamentoExpira = r.expira_em;
      pareamentoEvento = aVisaoPareamento("aguardando", r.expira_em, null);
      d.emitirRenderer("telegram:pareamento", { estado: "aguardando" });
      return r;
    },
    parearCancelar() {
      servico.pareamento.cancelar();
      pareamentoEvento = aVisaoPareamento("fechado", null, null);
      fecharPollerDoPareamento();
      return { ok: true };
    },
    async parearDecidir(pedido_id, permitir) {
      const r = await servico.decidirPareamento(pedido_id, permitir);
      pareamentoEvento = aVisaoPareamento(permitir && r !== null ? "pareado" : "fechado", null, null);
      d.emitirRenderer("telegram:pareamento", { estado: permitir && r !== null ? "pareado" : "cancelado" });
      return r;
    },
    async autorizadoConfig(p) {
      const r = await servico.configurarAutorizado(p.id, {
        ...(p.patch.modo_padrao === undefined ? {} : { modo_padrao: p.patch.modo_padrao }),
        ...(p.patch.texto_livre === undefined ? {} : { texto_livre: p.patch.texto_livre }),
        ...(p.patch.workspaces === undefined ? {} : { workspaces: p.patch.workspaces }),
        ...(p.patch.pin === undefined ? {} : { pin: p.patch.pin }),
        ...(p.confirmacao === undefined ? {} : { confirmacao: p.confirmacao }),
      });
      if (!r.ok) return { ok: false, erro: r.erro };
      const a = autorizadoCompleto(p.id);
      return a === null ? { ok: false, erro: "autorizado_inexistente" } : { ok: true, autorizado: a };
    },
    autorizadoRevogar: (id) => ({ ok: servico.panico.revogar(id) }),
    naoAutorizadoListar: () => d.repoTelegram.listarNaoAutorizados().map((n) => ({ user_id: n.user_id, primeiro_em: n.primeiro_em, ultimo_em: n.ultimo_em, contagem: n.contagem, bloqueado: n.bloqueado })),
    naoAutorizadoBloquear(user_id) {
      servico.bloquearUsuario(user_id);
      return { ok: true };
    },
    async entradaLigar(ligada) {
      if (!ligada) {
        await servico.desligarEntrada();
        d.atualizarCanal({ entrada_ligada: false, ...(d.repoCanais.obter(canal_id)?.saida_ligada === true ? {} : { estado: "desligado" as const }) });
        return { ok: true, estado: await estado() };
      }
      if ((await lerToken()) === null) return { ok: false, erro: "token_ausente", estado: await estado() };
      const r = servico.ligarEntrada();
      if (r.ok) {
        d.consentimento.permitirHost(HOST_TELEGRAM_API);
        d.atualizarCanal({ entrada_ligada: true, estado: "ativo", erro_codigo: null });
      }
      return { ok: r.ok, ...(r.erro === undefined ? {} : { erro: r.erro }), estado: await estado() };
    },
    async retomar() {
      // antes de sugerir retomar: `getWebhookInfo` (webhook que o app não definiu => token possivelmente comprometido; NUNCA `deleteWebhook` aqui)
      try {
        const w = await servico.api.getWebhookInfo();
        if (w.url !== "") {
          d.atualizarCanal({ estado: "erro", erro_codigo: "token_possivelmente_comprometido" });
          d.emitirRenderer("telegram:evento", { tipo: "webhook_suspeito" });
          return estado();
        }
      } catch {
        /* diagnóstico opcional */
      }
      servico.retomar();
      d.atualizarCanal({ estado: "ativo", erro_codigo: null });
      d.emitirRenderer("telegram:evento", { tipo: "retomado" });
      return estado();
    },
    async panico(parar_execucoes) {
      const r = await servico.panico.panico({ parar_execucoes, origem: "desktop" });
      return { ok: r.ok, revogados: r.revogados };
    },
    planoDecidirDesktop: (p) => servico.entrada.decidirNoDesktop(p.plano_id, p.decisao, p.args_hash),
    auditoriaListar(depois, limite) {
      const r = servico.auditoria.listar(depois, Math.max(1, Math.min(limite, 100)));
      return { itens: r.itens.map((a) => ({ id: a.id, ts: a.ts, evento: a.evento, user_id: a.user_id, workspace_id: a.workspace_id, plano_id: a.plano_id, resultado: a.resultado, detalhe: a.detalhe })), proximo: r.proximo };
    },
    async auditoriaExportar() {
      const nome = `telegram-auditoria-${new Date(d.relogio.agora()).toISOString().slice(0, 10)}.csv`;
      const destino = await d.escolherArquivoDeSaida(nome);
      if (destino === null) return { ok: false, cancelado: true };
      if (!tg.destinoDeExportPermitido(destino)) return { ok: false };
      const linhas: import("../nucleo/telegram/repo").AuditoriaRow[] = [];
      let depois: string | null = null;
      for (let i = 0; i < 100; i++) {
        const p = servico.auditoria.listar(depois, 100);
        linhas.push(...p.itens);
        if (p.proximo === null) break;
        depois = p.proximo;
      }
      try {
        await writeFile(destino, servico.auditoria.exportarCsv(linhas), { encoding: "utf8", mode: 0o600 });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    async retomarSeLigado() {
      try {
        const c = d.repoCanais.obter(canal_id);
        if (c === null || !c.entrada_ligada || !d.consentimentoVigente()) return;
        // `conflito`/`erro` (token inválido, webhook suspeito) NÃO se religam sozinhos no reinício: exigem o [Retomar] do usuário (auditoria M5)
        if (c.estado === "conflito" || c.estado === "erro") return;
        if ((await lerToken()) === null) {
          d.atualizarCanal({ estado: "erro", erro_codigo: "token_ausente" });
          return;
        }
        d.consentimento.permitirHost(HOST_TELEGRAM_API);
        servico.verificarInatividade();
        if (d.repoCanais.obter(canal_id)?.entrada_ligada !== true) return;
        const r = servico.ligarEntrada();
        if (r.ok) d.atualizarCanal({ estado: "ativo", erro_codigo: null });
      } catch (e) {
        d.aviso(`telegram: não foi possível retomar (${e instanceof Error ? e.name : "erro"})`);
      }
    },
    aoMissaoFechada(mission_id, resultado, resumo) {
      try {
        servico.entrada.aoMissaoFechada(mission_id, resultado, resumo);
      } catch {
        /* acessório */
      }
    },
    aoSuspender: () => servico.poller.suspender(),
    aoRetomarSistema: () => servico.poller.retomarSistema(),
    async encerrar() {
      await servico.desligarEntrada().catch(() => undefined);
    },
  };
  return L;
}
