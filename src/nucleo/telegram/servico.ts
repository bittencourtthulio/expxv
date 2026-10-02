// Composição do núcleo Telegram (T-20.33, parte pura): liga cliente -> poller -> autorização -> pareamento -> entrada -> pânico -> canal de saída.
// Só este arquivo conhece todas as peças; o main injeta cofre, rede, serviços reais, banco e eventos. Importar este módulo NÃO abre socket nem cria
// timer: tudo nasce parado (o main só o importa — por import dinâmico — com saída ou entrada ligada).
import { randomBytes } from "node:crypto";
import type { AutorizadoVisao, EntradaAlerta, EstadoCanal, EstadoPoller, ModoWorkspaceTelegram } from "../../compartilhado/alertas";
import type { RepoRegras } from "../alertas/portas";
import { redigirParaCanal } from "../alertas/texto";
import { criarCanalTelegram } from "./adaptador";
import { criarClienteBotApi, type ClienteBotApi } from "./api";
import { criarAuditoria, type Auditoria } from "./auditoria";
import { criarAutorizador, INATIVIDADE_MS, type Autorizador } from "./autorizacao";
import { CONFIG_TELEGRAM_PADRAO, criarEntrada, type ConfigTelegram, type Entrada } from "./entrada";
import { criarLimiteTaxa } from "./limite-taxa";
import { criarPanico, type Panico } from "./panico";
import { criarPareamento, type Pareamento, type PedidoPareamento } from "./pareamento";
import { hashPin, verificarPin } from "./pin";
import { criarPoller, type Poller } from "./poller";
import type { DormirPorta, PortaRedeSegredo, RelogioTg } from "./portas";
import type { PortaConsulta, PortaGates, PortaOrquestrador, PortaPin, PortaRigidez } from "./portas-entrada";
import type { AutorizadoRow, RepoTelegram, WorkspaceRow } from "./repo";
import type { CanalComunicacao } from "../alertas/canal";

export type EventoServico =
  | { tipo: "pareamento"; estado: string; pedido?: PedidoPareamento }
  | { tipo: "poller"; estado: EstadoPoller; detalhe?: string }
  | { tipo: "panico" | "revogado" | "entrada_expirou"; revogados?: number }
  | { tipo: "plano_pendente_desktop"; plano_id: string; resumo: string; args_hash: string; expira_em: string };

export interface DepsServicoTelegram {
  canal_id: string;
  repo: RepoTelegram;
  rede: PortaRedeSegredo;
  /** token do COFRE; chamado a cada requisição. */
  token: () => Promise<string | null> | string | null;
  consentimentoValido(): boolean;
  host?: string;
  /** só testes. */
  porta?: number;
  relogio: RelogioTg;
  dormir?: DormirPorta;
  orquestrador: PortaOrquestrador;
  rigidez?: PortaRigidez | null;
  consulta: PortaConsulta;
  gates?: PortaGates;
  pin?: PortaPin;
  regras?: RepoRegras;
  alertas?: { emitir(e: EntradaAlerta): unknown };
  estadoCanal(): EstadoCanal;
  /** pânico/expiração: `entrada_ligada=0`, `saida_ligada=0`, `estado='desligado'`. */
  desligarCanal(): void;
  cancelarFila?(): void;
  silenciarCanal?(ate_iso: string | null, incluir_criticos: boolean): void;
  eventos?(e: EventoServico): void;
  online?(): boolean;
  /** `true` enquanto o poller roda SÓ por causa da janela de pareamento: nesse modo só `/start <código>`/`/parear` chegam à entrada (nada de `/pedir`, aprovação ou consulta). */
  somentePareamento?(): boolean;
  scrub?: (t: string) => string;
  config?: Partial<ConfigTelegram>;
  aleatorio?: () => number;
  travas?: Set<string>;
}

export interface ServicoTelegram {
  api: ClienteBotApi;
  poller: Poller;
  entrada: Entrada;
  autorizador: Autorizador;
  pareamento: Pareamento;
  auditoria: Auditoria;
  panico: Panico;
  canal: CanalComunicacao;
  iniciarPareamento(): { codigo: string; link: string | null; expira_em: string };
  /** o DESKTOP decide. Só `permitir` grava o autorizado e avisa no chat. */
  decidirPareamento(pedido_id: string, permitir: boolean): Promise<AutorizadoVisao | null>;
  autorizados(): AutorizadoVisao[];
  configurarAutorizado(id: string, patch: { modo_padrao?: ModoWorkspaceTelegram; texto_livre?: boolean; workspaces?: Array<{ workspace_id: string; modo: ModoWorkspaceTelegram; padrao: boolean }>; pin?: string | null; confirmacao?: string }): Promise<{ ok: true; autorizado: AutorizadoVisao } | { ok: false; erro: string }>;
  /** liga o poller (exige >= 1 autorizado ativo e >= 1 workspace liberado). */
  ligarEntrada(): { ok: boolean; erro?: string };
  desligarEntrada(): Promise<void>;
  retomar(): void;
  bloquearUsuario(user_id: number): void;
  verificarInatividade(): void;
}

export const visao = (a: AutorizadoRow): AutorizadoVisao => ({ id: a.id, canal_id: a.canal_id, nome_exibicao: a.nome_exibicao, modo_padrao: a.modo_padrao, texto_livre: a.texto_livre, com_pin: a.pin_hash !== null, criado_em: a.criado_em, ultimo_uso_em: a.ultimo_uso_em, expira_em: a.expira_em, revogado_em: a.revogado_em });

export function criarServicoTelegram(deps: DepsServicoTelegram): ServicoTelegram {
  const cfg: ConfigTelegram = { ...CONFIG_TELEGRAM_PADRAO, ...(deps.config ?? {}) };
  const iso = (): string => new Date(deps.relogio.agora()).toISOString();
  const api = criarClienteBotApi({ rede: deps.rede, token: deps.token, consentimentoValido: deps.consentimentoValido, ...(deps.host === undefined ? {} : { host: deps.host }), ...(deps.porta === undefined ? {} : { porta: deps.porta }) });
  const auditoria = criarAuditoria({ repo: deps.repo, canal_id: deps.canal_id, relogio: deps.relogio, ...(deps.scrub === undefined ? {} : { scrub: deps.scrub }) });
  const autorizador = criarAutorizador({
    repo: deps.repo,
    canal_id: deps.canal_id,
    relogio: deps.relogio,
    aoDesconhecido: (i) => deps.alertas?.emitir({ tipo: "erro_sistema", titulo: `Tentativa de acesso de um usuário desconhecido (id ${i.user_id})`, dados: { componente: "telegram", codigo: "nao_autorizado" }, estado: "desconhecido" }),
  });
  const limite = criarLimiteTaxa({ relogio: deps.relogio, msg_por_min: cfg.msg_por_min, rajada: cfg.rajada_msg, max_pedidos: cfg.max_pedidos_10min });
  let username: string | null = null;
  const pareamento = criarPareamento({
    relogio: deps.relogio,
    ttl_ms: cfg.pareamento_ttl_min * 60_000,
    aoPedido: (pedido) => deps.eventos?.({ tipo: "pareamento", estado: "pedido", pedido }),
    aoEstado: (e) => deps.eventos?.({ tipo: "pareamento", estado: e }),
  });

  const entrada = criarEntrada({
    canal_id: deps.canal_id,
    repo: deps.repo,
    api,
    autorizador,
    limite,
    pareamento,
    auditoria,
    relogio: deps.relogio,
    orquestrador: deps.orquestrador,
    rigidez: deps.rigidez ?? null,
    consulta: deps.consulta,
    ...(deps.gates === undefined ? {} : { gates: deps.gates }),
    pin: deps.pin ?? { verificar: verificarPin },
    ...(deps.regras === undefined ? {} : { regras: deps.regras }),
    ...(deps.alertas === undefined ? {} : { alertas: deps.alertas }),
    botUsername: () => username,
    ...(deps.silenciarCanal === undefined ? {} : { silenciarCanal: deps.silenciarCanal }),
    aoPanico: (o) => void panico.panico(o),
    aoPlanoPendenteDesktop: (p) => deps.eventos?.({ tipo: "plano_pendente_desktop", ...p }),
    config: cfg,
    ...(deps.scrub === undefined ? {} : { scrub: deps.scrub }),
  });

  const poller = criarPoller({
    api,
    repo: deps.repo,
    canal_id: deps.canal_id,
    relogio: deps.relogio,
    processar: (u) => (deps.somentePareamento?.() === true && !/^\/(?:start|parear)(?:@[A-Za-z0-9_]{1,64})?[ \t]+\S{1,64}[ \t]*$/.test(u.message?.text?.slice(0, 200) ?? "") ? Promise.resolve() : entrada.tratar(u)),
    ...(deps.dormir === undefined ? {} : { dormir: deps.dormir }),
    ...(deps.aleatorio === undefined ? {} : { aleatorio: deps.aleatorio }),
    ...(deps.online === undefined ? {} : { online: deps.online }),
    ...(deps.travas === undefined ? {} : { travas: deps.travas }),
    aoLote: () => autorizador.descarregar(),
    aoEstado: (estado, detalhe) => {
      if (estado === "erro" && detalhe === "token_invalido") auditoria.registrar("token_invalido", { resultado: "401" });
      if (estado === "conflito" || estado === "token_possivelmente_comprometido") auditoria.registrar("conflito", { resultado: estado });
      if (estado === "erro" || estado === "conflito" || estado === "token_possivelmente_comprometido") {
        deps.alertas?.emitir({ tipo: "canal_erro", titulo: "Erro no canal Telegram", dados: { canal: "Telegram", causa: estado === "erro" ? "token inválido ou revogado" : estado === "conflito" ? "outro programa está lendo este bot" : "webhook desconhecido: o token pode ter vazado", acao: estado === "erro" ? "Troque o token no assistente." : "Revise e clique em Retomar." }, estado });
      }
      deps.eventos?.({ tipo: "poller", estado, ...(detalhe === undefined ? {} : { detalhe }) });
    },
  });

  const panico = criarPanico({
    repo: deps.repo,
    canal_id: deps.canal_id,
    relogio: deps.relogio,
    auditoria,
    pararPoller: () => poller.parar(),
    cancelarFila: () => deps.cancelarFila?.(),
    pareamento,
    orquestrador: deps.orquestrador,
    desligarCanal: () => deps.desligarCanal(),
    aoEvento: (tipo, d) => deps.eventos?.({ tipo, ...(d.revogados === undefined ? {} : { revogados: d.revogados }) }),
  });

  const canal = criarCanalTelegram({ api, repo: deps.repo, canal_id: deps.canal_id, relogio: deps.relogio, consentimentoValido: deps.consentimentoValido, estadoCanal: deps.estadoCanal, poller, ...(deps.dormir === undefined ? {} : { dormir: deps.dormir }) });

  return {
    api,
    poller,
    entrada,
    autorizador,
    pareamento,
    auditoria,
    panico,
    canal,
    iniciarPareamento() {
      const r = pareamento.iniciar();
      auditoria.registrar("pareamento_aberto", { resultado: "aguardando" });
      return { codigo: r.codigo, link: username === null ? null : `https://t.me/${username}?start=${r.payload}`, expira_em: r.expira_em };
    },
    async decidirPareamento(pedido_id, permitir) {
      const p = pareamento.decidir(pedido_id, permitir);
      if (p === null) {
        auditoria.registrar("pareamento_negado", { resultado: permitir ? "pedido_inexistente" : "negado" });
        return null;
      }
      const t = deps.relogio.agora();
      const row: AutorizadoRow = { id: `aut_${randomBytes(9).toString("base64url")}`, canal_id: deps.canal_id, user_id: p.user_id, chat_id: p.chat_id, nome_exibicao: redigirParaCanal(p.nome, { max: 40 }), modo_padrao: "aprovar", texto_livre: true, pin_hash: null, criado_em: new Date(t).toISOString(), ultimo_uso_em: new Date(t).toISOString(), expira_em: new Date(t + INATIVIDADE_MS).toISOString(), revogado_em: null };
      deps.repo.gravarAutorizado(row);
      auditoria.registrar("pareamento_concluido", { user_id: p.user_id });
      try {
        await api.sendMessage({ chat_id: p.chat_id, text: "Pareado. Digite /ajuda." });
      } catch {
        /* o pareamento vale mesmo se a confirmação não chegar */
      }
      return visao(row);
    },
    autorizados: () => deps.repo.listarAutorizados(deps.canal_id).map(visao),
    async configurarAutorizado(id, patch) {
      const a = deps.repo.autorizadoPorId(id);
      if (a === null || a.canal_id !== deps.canal_id || a.revogado_em !== null) return { ok: false, erro: "autorizado_inexistente" };
      if (patch.workspaces?.some((w) => w.modo === "direto") === true && patch.confirmacao !== "DIRETO") return { ok: false, erro: "confirmacao_direto_ausente" };
      if (patch.modo_padrao === "direto" && patch.confirmacao !== "DIRETO") return { ok: false, erro: "confirmacao_direto_ausente" };
      const novo: AutorizadoRow = { ...a, ...(patch.modo_padrao === undefined ? {} : { modo_padrao: patch.modo_padrao }), ...(patch.texto_livre === undefined ? {} : { texto_livre: patch.texto_livre }) };
      if (patch.pin !== undefined) {
        try {
          novo.pin_hash = patch.pin === null ? null : await hashPin(patch.pin);
        } catch {
          return { ok: false, erro: "pin_invalido" };
        }
      }
      deps.repo.gravarAutorizado(novo);
      if (patch.workspaces !== undefined) deps.repo.gravarWorkspaces(a.id, patch.workspaces.map((w): WorkspaceRow => ({ autorizado_id: a.id, workspace_id: w.workspace_id, modo: w.modo, padrao: w.padrao })));
      return { ok: true, autorizado: visao(novo) };
    },
    ligarEntrada() {
      if (!deps.consentimentoValido()) return { ok: false, erro: "consentimento_ausente" };
      const ativos = deps.repo.listarAutorizados(deps.canal_id).filter((a) => a.revogado_em === null && Date.parse(a.expira_em) > deps.relogio.agora());
      if (ativos.length === 0) return { ok: false, erro: "sem_autorizado" };
      if (!ativos.some((a) => deps.repo.workspaces(a.id).length > 0)) return { ok: false, erro: "sem_workspace_liberado" };
      void api.getMe().then((b) => (username = b.username), () => undefined);
      poller.iniciar();
      return { ok: true };
    },
    desligarEntrada: () => poller.parar(),
    retomar: () => poller.retomarManual(),
    bloquearUsuario: (id) => autorizador.bloquear(id),
    verificarInatividade: () => void panico.verificarInatividade(),
  };
}
