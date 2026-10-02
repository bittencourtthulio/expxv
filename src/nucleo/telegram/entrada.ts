// ENTRADA do Telegram (T-20.27/29/30): do update ao resultado. Mensagem recebida é DADO não confiável: passa por sanitização -> redação -> limite ->
// pré-filtro de gestos proibidos -> orquestrador DETERMINÍSTICO (porta) -> política pura -> plano ao chat com botões (nonce de uso único atrelado a
// `args_hash`) -> aprovação -> execução pelos serviços reais (porta). Nada é criado/executado antes de um toque válido (ou aprovação no desktop).
import { createHash, randomBytes } from "node:crypto";
import type { EntradaAlerta, ModoWorkspaceTelegram, PlanoRemoto, Regra } from "../../compartilhado/alertas";
import type { RepoRegras } from "../alertas/portas";
import { duracao } from "../alertas/templates";
import { envolverPedidoRemoto, redigirParaCanal, sanitizar, sha256, truncarVisivel } from "../alertas/texto";
import type { ClienteBotApi } from "./api";
import type { Autorizador } from "./autorizacao";
import type { Auditoria } from "./auditoria";
import { ARGS_MAX, parseComando, parseSilenciar, respostaAtrasadas, respostaConsumo, respostaGates, respostaMissoes, respostaStatus, respostaTarefas, textoAjuda } from "./comandos";
import { escaparHtml, lerCallback, montarCallback, novoNonce, teclado, type AcaoBotao } from "./formato";
import type { LimiteTaxa } from "./limite-taxa";
import type { Pareamento } from "./pareamento";
import { avaliarPlano, classeDoComando, gestoProibidoNoTexto, podeExecutarDireto, type ContextoPolitica } from "./politica";
import type { PortaConsulta, PortaGates, PortaOrquestrador, PortaPin, PortaRigidez } from "./portas-entrada";
import type { RelogioTg } from "./portas";
import type { AcaoAprovacao, AprovacaoRow, AutorizadoRow, EntradaRow, RepoTelegram, WorkspaceRow } from "./repo";
import type { TgUpdate } from "./tipos";

export interface ConfigTelegram {
  rigidez_max_remota: number;
  max_pedidos_10min: number;
  max_planos_pendentes: number;
  msg_por_min: number;
  plano_ttl_min: number;
  pareamento_ttl_min: number;
  autorizacao_inatividade_dias: number;
  idade_max_pedido_s: number;
  /** fichas de rajada do token bucket por usuário. */
  rajada_msg: number;
}
export const CONFIG_TELEGRAM_PADRAO: ConfigTelegram = { rigidez_max_remota: 3, max_pedidos_10min: 3, max_planos_pendentes: 3, msg_por_min: 20, plano_ttl_min: 10, pareamento_ttl_min: 5, autorizacao_inatividade_dias: 30, idade_max_pedido_s: 600, rajada_msg: 5 };

export const PEDIDO_MAX = 2000;
export const AJUSTE_MAX = 1000;
export const SKEW_S = 120;
const PROPOR_TIMEOUT_MS = 60_000;
const EDICAO_TTL_MS = 5 * 60_000;
const MAX_EDICOES = 3;
const PARAR_TTL_MS = 6 * 3_600_000;

export interface DepsEntrada {
  canal_id: string;
  repo: RepoTelegram;
  api: ClienteBotApi;
  autorizador: Autorizador;
  limite: LimiteTaxa;
  pareamento: Pareamento;
  auditoria: Auditoria;
  relogio: RelogioTg;
  orquestrador: PortaOrquestrador;
  rigidez?: PortaRigidez | null;
  consulta: PortaConsulta;
  gates?: PortaGates;
  pin?: PortaPin;
  regras?: RepoRegras;
  alertas?: { emitir(e: EntradaAlerta): unknown };
  botUsername(): string | null;
  /** `/silenciar` neste chat. `ate_iso = null` desliga. */
  silenciarCanal?(ate_iso: string | null, incluir_criticos: boolean): void;
  /** `/parar`: o módulo de pânico faz o resto (revoga tudo, 0 sockets, etc.). */
  aoPanico?(o: { parar_execucoes: boolean; origem: string }): Promise<void> | void;
  aoPlanoPendenteDesktop?(p: { plano_id: string; resumo: string; args_hash: string; expira_em: string }): void;
  aoDefinirWorkspacePadrao?(autorizado_id: string, workspace_id: string): void;
  config?: Partial<ConfigTelegram>;
  scrub?: (t: string) => string;
  novoId?: (prefixo: string) => string;
}

export interface Entrada {
  tratar(u: TgUpdate): Promise<void>;
  /** aprovação/recusa NO DESKTOP (`telegram:plano_decidir_desktop`): mesmo caminho, `aprovado_por = "desktop"`. */
  decidirNoDesktop(plano_id: string, decisao: "aprovar" | "cancelar", args_hash: string): Promise<{ ok: boolean; motivo?: string }>;
  /** fim da Missão: fecha o ciclo da entrada e ajusta a regra efêmera (fim + 1 h). */
  aoMissaoFechada(mission_id: string, resultado: "concluida" | "falhou", resumo: string): void;
}

const MSG = {
  devagar: "Devagar: você enviou mensagens demais. Tente de novo em instantes.",
  expirou: "Isso expirou. Reenvie o pedido.",
  muitoLongo: "Muito longo. Resuma em até 2 000 caracteres.",
  semWorkspace: "Nenhum workspace liberado para o bot. Libere no app.",
  consulta: "Este workspace é só consulta.",
  jaRecebi: "Já recebi esse pedido.",
  semPlano: "Não consegui montar o plano agora.",
  naoEntendi: "Não entendi. /ajuda",
} as const;

const iso = (ms: number): string => new Date(ms).toISOString();
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** id do workspace de um plano (o campo `workspace` é o nome exibido; `workspace_id`, quando existe, é o id). */
export const wsIdDe = (p: Pick<PlanoRemoto, "workspace" | "workspace_id">): string => p.workspace_id ?? p.workspace;
export const idCurto = (plano_id: string): string => {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const h = createHash("sha256").update(plano_id).digest();
  return Array.from({ length: 4 }, (_, i) => alfabeto[(h[i] as number) & 31]).join("");
};

export function montarMensagemPlano(p: PlanoRemoto, pedido: string, opcoes: { desktop: boolean; direto: boolean; ttl_min: number }): string {
  const e = escaparHtml;
  const t = (v: string, n: number): string => e(truncarVisivel(redigirParaCanal(v), n));
  const est = p.estimativa;
  const linhas = [
    `<b>Plano proposto</b> · <code>#${idCurto(p.plano_id)}</code>`,
    `Pedido: <i>"${t(pedido, 160)}"</i>`,
    `Intenção: ${t(p.intencao, 30)} · Squad: ${p.squad === null ? "nenhuma" : t(p.squad.nome, 30)} · Pipeline: ${t(p.pipeline.skill, 30)} (${p.pipeline.etapas.length} etapas)`,
    `Workspace: ${t(p.workspace, 40)} · Branch de trabalho: <code>${t(p.branch_de_trabalho, 40)}</code> · Painéis: ${p.paineis_estimados} · Raio: ${p.raio} · Rigidez: ${p.rigidez}`,
    `Estimativa: ${est.pontos === null ? "sem estimativa" : est.pontos} pts · ~${est.tempo_trabalho_ms === null ? "sem estimativa" : duracao(est.tempo_trabalho_ms)} de trabalho`,
    "Nada será mesclado, enviado (push) nem assinado por este canal.",
    opcoes.desktop ? "Aprove no desktop (Centro de Alertas)." : opcoes.direto ? "Modo direto: iniciando agora." : `Expira em ${opcoes.ttl_min} min.`,
  ];
  return linhas.join("\n");
}

export function criarEntrada(deps: DepsEntrada): Entrada {
  const cfg: ConfigTelegram = { ...CONFIG_TELEGRAM_PADRAO, ...(deps.config ?? {}) };
  const agora = (): number => deps.relogio.agora();
  const novoId = deps.novoId ?? ((p: string): string => `${p}_${randomBytes(9).toString("base64url")}`);
  const scrub = deps.scrub === undefined ? {} : { scrub: deps.scrub };
  const aud = deps.auditoria;
  const planosHtml = new Map<string, string>(); // plano_id -> html enviado (para trocar o rodapé)
  const edicoes = new Map<string, { entrada_id: string; expira: number }>(); // `${chat}:${prompt_msg}`
  const pinTentativas = new Map<number, number[]>();
  /** falhas de PIN em 24 h (memória): PIN de 4 dígitos só é seguro com bloqueio; passou do teto, a autorização é REVOGADA e o app avisa. */
  const pinFalhasDia = new Map<number, number[]>();
  const MAX_FALHAS_PIN_DIA = 6;

  // ---------- saída ----------
  async function enviar(chat_id: number, html: string, tecl?: ReturnType<typeof teclado>): Promise<number | null> {
    try {
      const r = await deps.api.sendMessage({ chat_id, text: html, parse_mode: "HTML", ...(tecl === undefined ? {} : { reply_markup: { inline_keyboard: tecl } }) });
      return r.message_id;
    } catch {
      return null;
    }
  }
  const responder = (chat_id: number, texto: string): Promise<number | null> => enviar(chat_id, escaparHtml(texto));
  async function responderCb(id: string, texto: string): Promise<void> {
    try {
      await deps.api.answerCallbackQuery({ callback_query_id: id, text: texto });
    } catch {
      /* só para o indicador de carregamento */
    }
  }
  async function limparTeclado(chat_id: number, message_id: number | null): Promise<void> {
    if (message_id === null) return;
    try {
      await deps.api.editMessageReplyMarkup({ chat_id, message_id });
    } catch {
      /* mensagem antiga demais ou já editada */
    }
  }
  async function trocarTexto(chat_id: number, message_id: number | null, html: string): Promise<void> {
    if (message_id === null) return;
    try {
      await deps.api.editMessageText({ chat_id, message_id, text: html, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } });
    } catch {
      /* ignora */
    }
  }

  // ---------- workspaces ----------
  const permitidos = (a: AutorizadoRow): WorkspaceRow[] => deps.repo.workspaces(a.id);
  const idsPermitidos = (a: AutorizadoRow): string[] => permitidos(a).map((w) => w.workspace_id);
  function workspaceAlvo(a: AutorizadoRow): { ws: WorkspaceRow | null } {
    const todos = permitidos(a);
    if (todos.length === 0) return { ws: null };
    return { ws: todos.find((w) => w.padrao) ?? (todos.length === 1 ? (todos[0] as WorkspaceRow) : null) };
  }
  const modoDe = (a: AutorizadoRow, ws: WorkspaceRow | null): ModoWorkspaceTelegram => ws?.modo ?? a.modo_padrao;
  const ctxPolitica = (modo: ModoWorkspaceTelegram, mission_id?: string): ContextoPolitica => ({ modo, rigidez_max_remota: cfg.rigidez_max_remota, rigidez: deps.rigidez ?? null, ...(mission_id === undefined ? {} : { mission_id }) });

  // ---------- nonces ----------
  function criarNonce(entrada: EntradaRow, acao: AcaoAprovacao, plano_id: string, args_hash: string, user_id: number, chat_id: number, ttl_ms: number, extra?: string): string {
    const nonce = novoNonce();
    deps.repo.inserirAprovacao({ nonce_hash: sha256(nonce), mensagem_entrada_id: entrada.id, acao, plano_id, args_hash, chat_id, message_id: null, user_id, estado: "pendente", expira_em: iso(agora() + ttl_ms), usado_em: null, ...(extra === undefined ? {} : { extra }) });
    return nonce;
  }
  const LETRA: Record<AcaoAprovacao, AcaoBotao> = { aprovar: "a", editar: "e", cancelar: "c", parar: "p", ws: "w", gate_aprovar: "g", gate_recusar: "r", gate_confirmar: "y" };

  // ---------- entradas ----------
  function novaEntrada(a: AutorizadoRow, update_id: number, texto: string, extra: Partial<EntradaRow> = {}): EntradaRow | null {
    const e: EntradaRow = {
      id: novoId("ent"),
      canal_id: deps.canal_id,
      autorizado_id: a.id,
      update_id,
      texto_redigido: truncarVisivel(redigirParaCanal(sanitizar(texto), { ...scrub, max: PEDIDO_MAX }), PEDIDO_MAX),
      tamanho_original: texto.length,
      comando: null,
      intencao: null,
      plano_id: null,
      workspace_id: null,
      estado: "recebida",
      motivo: null,
      args_hash: null,
      mission_id: null,
      resultado_resumo: null,
      aprovado_em: null,
      aprovado_por: null,
      criado_em: iso(agora()),
      atualizado_em: iso(agora()),
      ...extra,
    };
    return deps.repo.inserirEntrada(e) ? e : null;
  }
  const atualizar = (id: string, patch: Partial<EntradaRow>): void => deps.repo.atualizarEntrada(id, { ...patch, atualizado_em: iso(agora()) });

  const idade = (m: { date: number }): "ok" | "expirada" => {
    const dt = agora() - m.date * 1000;
    return dt > cfg.idade_max_pedido_s * 1000 || dt < -SKEW_S * 1000 ? "expirada" : "ok";
  };

  // ---------- consultas ----------
  async function consultar(cmd: string, a: AutorizadoRow, chat_id: number): Promise<void> {
    const ws = idsPermitidos(a);
    if (ws.length === 0) return void (await responder(chat_id, MSG.semWorkspace));
    const c = deps.consulta;
    try {
      if (cmd === "status") {
        const [missoes, em, atrasadas] = await Promise.all([c.missoesAtivas(ws), c.tarefasEmAndamento(ws, 5), c.atrasadas(ws)]);
        return void (await enviar(chat_id, respostaStatus({ missoes, emAndamento: em, atrasadas: atrasadas.length, cotaPct: c.cotaGeralPct(), criticos: c.alertasCriticosNaoLidos() })));
      }
      if (cmd === "tarefas") {
        const [em, prox] = await Promise.all([c.tarefasEmAndamento(ws, 8), c.proximasTarefas?.(ws, 8) ?? Promise.resolve([])]);
        return void (await enviar(chat_id, respostaTarefas(em, prox)));
      }
      if (cmd === "atrasadas") return void (await enviar(chat_id, respostaAtrasadas(await c.atrasadas(ws))));
      if (cmd === "missoes") return void (await enviar(chat_id, respostaMissoes(await c.missoesAtivas(ws))));
      if (cmd === "consumo") return void (await enviar(chat_id, respostaConsumo((await c.consumo?.()) ?? [], c.cotaGeralPct())));
      if (cmd === "aprovacoes") return void (await listarGates(a, chat_id, ws));
    } catch {
      await responder(chat_id, "Não consegui consultar agora.");
    }
  }

  async function listarGates(a: AutorizadoRow, chat_id: number, ws: string[]): Promise<void> {
    if (deps.gates === undefined) return void (await responder(chat_id, "Nenhuma aprovação pendente."));
    // workspace `consulta` nunca libera gate pelo chat, e quem configurou PIN só libera no desktop (o gate não tem o fluxo `/aprovar <PIN>`): a lista aparece, SEM botão (auditoria M1)
    const elegiveis = ws.filter((id) => modoDe(a, permitidos(a).find((w) => w.workspace_id === id) ?? null) !== "consulta");
    const g = await deps.gates.pendentes(elegiveis);
    await enviar(chat_id, respostaGates(g) + (a.pin_hash !== null && g.length > 0 ? "\nCom PIN configurado, libere no desktop." : ""));
    if (a.pin_hash !== null) return;
    for (const gate of g.slice(0, 5)) {
      if (gate.exige_humano) continue; // D-21: só no desktop, sem botão
      const ent = novaEntrada(a, -Math.floor(agora() % 2_000_000_000) - Math.floor(Math.random() * 1e6), `gate ${gate.id}`, { comando: "aprovacoes", estado: "plano_enviado" });
      if (ent === null) continue;
      const na = criarNonce(ent, "gate_aprovar", gate.id, sha256(`gate:${gate.id}`), a.user_id, chat_id, cfg.plano_ttl_min * 60_000, gate.id);
      const nr = criarNonce(ent, "gate_recusar", gate.id, sha256(`gate:${gate.id}`), a.user_id, chat_id, cfg.plano_ttl_min * 60_000, gate.id);
      const mid = await enviar(chat_id, `<b>Aprovação</b>: ${escaparHtml(truncarVisivel(redigirParaCanal(gate.titulo), 80))}`, teclado([[{ rotulo: "Aprovar", dado: montarCallback("g", na) }, { rotulo: "Recusar", dado: montarCallback("r", nr) }]]));
      if (mid !== null) deps.repo.definirMessageIdAprovacoes(ent.id, mid);
    }
  }

  // ---------- pedido ----------
  async function proporComTimeout(args: Parameters<PortaOrquestrador["proporPlano"]>[0]): Promise<Awaited<ReturnType<PortaOrquestrador["proporPlano"]>> | null> {
    let t: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([deps.orquestrador.proporPlano(args), new Promise<null>((r) => (t = setTimeout(() => r(null), PROPOR_TIMEOUT_MS)))]);
    } catch {
      return null;
    } finally {
      if (t !== undefined) clearTimeout(t);
    }
  }

  async function publicarPlano(a: AutorizadoRow, ent: EntradaRow, plano: PlanoRemoto, chat_id: number, ws: WorkspaceRow | null, pedidoResumo: string): Promise<void> {
    const modo = modoDe(a, ws);
    const ctx = ctxPolitica(modo);
    const dec = avaliarPlano(plano, ctx);
    atualizar(ent.id, { plano_id: plano.plano_id, intencao: plano.intencao, args_hash: plano.args_hash, workspace_id: ws?.workspace_id ?? wsIdDe(plano) });
    if (dec.permitido === "bloqueado") {
      atualizar(ent.id, { estado: "bloqueada", motivo: dec.motivo });
      aud.registrar("bloqueado", { user_id: a.user_id, workspace_id: wsIdDe(plano), plano_id: plano.plano_id, mensagem_entrada_id: ent.id, args_hash: plano.args_hash, resultado: dec.motivo });
      deps.alertas?.emitir({ tipo: "pedido_remoto", titulo: "Pedido remoto bloqueado", dados: { quem: a.nome_exibicao, resumo: pedidoResumo, motivo: dec.motivo }, estado: `bloqueado:${ent.id}` });
      return void (await responder(chat_id, `Isso precisa ser feito no desktop (${dec.motivo}).`));
    }
    const direto = dec.permitido === "telegram" && podeExecutarDireto(plano, ctx);
    const desktop = dec.permitido === "desktop";
    const html = montarMensagemPlano(plano, pedidoResumo, { desktop, direto, ttl_min: cfg.plano_ttl_min });
    planosHtml.set(plano.plano_id, html);
    const ttl = cfg.plano_ttl_min * 60_000;
    const botoes: Array<{ rotulo: string; dado: string }> = [];
    if (!desktop && !direto && a.pin_hash === null) botoes.push({ rotulo: "Aprovar", dado: montarCallback("a", criarNonce(ent, "aprovar", plano.plano_id, plano.args_hash, a.user_id, chat_id, ttl)) });
    if (!desktop && !direto) botoes.push({ rotulo: "Editar", dado: montarCallback("e", criarNonce(ent, "editar", plano.plano_id, plano.args_hash, a.user_id, chat_id, ttl)) });
    if (!direto) botoes.push({ rotulo: "Cancelar", dado: montarCallback("c", criarNonce(ent, "cancelar", plano.plano_id, plano.args_hash, a.user_id, chat_id, ttl)) });
    // com PIN o botão não basta: o `aprovar` fica como nonce (para o comando digitado) mas sem botão
    if (!desktop && !direto && a.pin_hash !== null) criarNonce(ent, "aprovar", plano.plano_id, plano.args_hash, a.user_id, chat_id, ttl);
    const textoPin = !desktop && !direto && a.pin_hash !== null ? `\nPara aprovar: /aprovar #${idCurto(plano.plano_id)} PIN` : "";
    const mid = await enviar(chat_id, html + textoPin, botoes.length === 0 ? undefined : teclado([botoes]));
    if (mid !== null) deps.repo.definirMessageIdAprovacoes(ent.id, mid);
    atualizar(ent.id, { estado: "plano_enviado" });
    aud.registrar("plano_enviado", { user_id: a.user_id, workspace_id: wsIdDe(plano), plano_id: plano.plano_id, mensagem_entrada_id: ent.id, args_hash: plano.args_hash, resultado: dec.permitido, detalhe: { motivo: dec.motivo } });
    if (desktop) {
      deps.alertas?.emitir({ tipo: "plano_aguardando_aprovacao", workspace_id: wsIdDe(plano), entidade_tipo: "plano", entidade_id: plano.plano_id, titulo: "Plano aguardando aprovação no desktop", dados: { quem: a.nome_exibicao, resumo: pedidoResumo, plano: plano.pipeline.skill, expira_em: `${cfg.plano_ttl_min} min` }, estado: dec.motivo });
      deps.aoPlanoPendenteDesktop?.({ plano_id: plano.plano_id, resumo: truncarVisivel(redigirParaCanal(pedidoResumo, scrub), 160), args_hash: plano.args_hash, expira_em: iso(agora() + ttl) });
    } else {
      deps.alertas?.emitir({ tipo: "pedido_remoto", workspace_id: wsIdDe(plano), entidade_tipo: "plano", entidade_id: plano.plano_id, titulo: "Pedido remoto recebido", dados: { quem: a.nome_exibicao, resumo: pedidoResumo }, estado: ent.id });
    }
    if (direto) await executarAprovado(ent, plano.plano_id, plano.args_hash, `telegram:${a.user_id}`, a, chat_id, mid);
  }

  async function pedir(a: AutorizadoRow, msg: { message_id: number; date: number }, update_id: number, chat_id: number, texto: string, opcoes: { ajusteDe?: EntradaRow } = {}): Promise<void> {
    if (idade(msg) === "expirada") return void (await responder(chat_id, MSG.expirou));
    const ws = workspaceAlvo(a).ws;
    if (permitidos(a).length === 0) return void (await responder(chat_id, MSG.semWorkspace));
    const modo = modoDe(a, ws);
    if (ws === null) return void (await responder(chat_id, "Escolha o workspace com /ws."));
    if (modo === "consulta") return void (await responder(chat_id, MSG.consulta));
    if (texto.length > (opcoes.ajusteDe === undefined ? PEDIDO_MAX : AJUSTE_MAX)) {
      novaEntrada(a, update_id, texto.slice(0, 100), { estado: "ignorada", motivo: "muito_longo", comando: "pedir" });
      return void (await responder(chat_id, MSG.muitoLongo));
    }
    const limpoTxt = sanitizar(texto).trim();
    if (limpoTxt === "") return void (await responder(chat_id, "Diga o que você precisa: /pedir texto"));
    const proibido = gestoProibidoNoTexto(limpoTxt);
    if (proibido !== null) {
      const e = novaEntrada(a, update_id, limpoTxt, { estado: "bloqueada", motivo: `gesto_proibido:${proibido}`, comando: "pedir" });
      aud.registrar("bloqueado", { user_id: a.user_id, workspace_id: ws.workspace_id, mensagem_entrada_id: e?.id ?? null, resultado: `gesto_proibido:${proibido}` });
      return void (await responder(chat_id, `Isso precisa ser feito no desktop (${proibido.replace(/_/g, " ")}).`));
    }
    if (!deps.limite.pedido(a.user_id)) return void (await responder(chat_id, `Devagar: no máximo ${cfg.max_pedidos_10min} pedidos a cada 10 minutos.`));
    const abertos = deps.repo.entradasDoAutorizado(a.id, ["plano_enviado"]).filter((e) => e.comando === "pedir" || e.comando === "ajuste" || e.plano_id !== null);
    if (opcoes.ajusteDe === undefined && abertos.length >= cfg.max_planos_pendentes) return void (await responder(chat_id, `Você já tem ${abertos.length} planos pendentes. Cancele ou aprove um antes.`));
    const normal = limpoTxt.toLowerCase().replace(/\s+/g, " ");
    const hash = sha256(normal);
    if (opcoes.ajusteDe === undefined && deps.repo.entradaRecentePorHash(a.id, hash, iso(agora() - 120_000)) !== null) return void (await responder(chat_id, MSG.jaRecebi));
    const redigido = truncarVisivel(redigirParaCanal(limpoTxt, scrub), opcoes.ajusteDe === undefined ? PEDIDO_MAX : AJUSTE_MAX);
    const ent = novaEntrada(a, update_id, limpoTxt, { comando: opcoes.ajusteDe === undefined ? "pedir" : "ajuste", workspace_id: ws.workspace_id, texto_hash: hash });
    if (ent === null) return; // update repetido
    aud.registrar("pedido_recebido", { user_id: a.user_id, workspace_id: ws.workspace_id, mensagem_entrada_id: ent.id, detalhe: { tamanho: texto.length } });
    if (/\[REDACTED\]|\[removido\]/.test(redigido)) await responder(chat_id, "Removi um possível segredo do pedido.");
    const r = await proporComTimeout({
      workspace_id: ws.workspace_id,
      texto_redigido: envolverPedidoRemoto(redigido),
      origem: "telegram",
      usuario_ref: `telegram:${a.user_id}`,
      ...(opcoes.ajusteDe === undefined ? {} : { ajuste: redigido, plano_anterior_id: opcoes.ajusteDe.plano_id ?? "" }),
    });
    if (r === null) {
      atualizar(ent.id, { estado: "falhou", motivo: "orquestrador_indisponivel" });
      return void (await responder(chat_id, MSG.semPlano));
    }
    if ("recusado" in r) {
      atualizar(ent.id, { estado: "bloqueada", motivo: r.recusado });
      aud.registrar("bloqueado", { user_id: a.user_id, workspace_id: ws.workspace_id, mensagem_entrada_id: ent.id, resultado: r.recusado });
      return void (await responder(chat_id, r.recusado === "orquestrador_indisponivel" ? MSG.semPlano : `Não posso montar esse plano (${r.recusado.replace(/_/g, " ")}).`));
    }
    if (opcoes.ajusteDe !== undefined) {
      const antigo = opcoes.ajusteDe;
      if (antigo.plano_id !== null) deps.repo.anularAprovacoesPorPlano(antigo.plano_id);
      atualizar(antigo.id, { plano_id: r.plano_id, args_hash: r.args_hash, edicoes: (antigo.edicoes ?? 0) + 1 });
      const cache = antigo.plano_id === null ? undefined : planosHtml.get(antigo.plano_id);
      if (cache !== undefined) planosHtml.delete(antigo.plano_id as string);
      aud.registrar("edicao", { user_id: a.user_id, plano_id: r.plano_id, mensagem_entrada_id: antigo.id, args_hash: r.args_hash });
      return void (await publicarPlano(a, deps.repo.entrada(antigo.id) as EntradaRow, r, chat_id, ws, truncarVisivel(redigirParaCanal(deps.repo.entrada(antigo.id)?.texto_redigido ?? redigido, scrub), 160)));
    }
    await publicarPlano(a, ent, r, chat_id, ws, redigido);
  }

  // ---------- aprovação e execução ----------
  async function executarAprovado(ent: EntradaRow, plano_id: string, args_hash: string, por: string, a: AutorizadoRow | null, chat_id: number, message_id: number | null): Promise<{ ok: boolean; motivo?: string }> {
    let atual: PlanoRemoto | null = null;
    try {
      atual = await deps.orquestrador.planoAtual(plano_id);
    } catch {
      atual = null;
    }
    const falhar = async (motivo: string, texto: string): Promise<{ ok: boolean; motivo: string }> => {
      atualizar(ent.id, { estado: "bloqueada", motivo });
      aud.registrar("bloqueado", { user_id: a?.user_id ?? null, plano_id, mensagem_entrada_id: ent.id, args_hash, resultado: motivo });
      await responder(chat_id, texto);
      return { ok: false, motivo };
    };
    if (atual === null) return falhar("plano_inexistente", "Esse plano não existe mais. Peça de novo.");
    if (atual.args_hash !== args_hash) return falhar("plano_alterado", "O plano mudou depois que eu o mostrei. Peça de novo.");
    // o autorizado pode ter sido revogado (ou expirado) depois do toque: um lote em voo no momento do pânico não executa nada, em silêncio
    if (a !== null) {
      const vivo = deps.repo.autorizadoPorId(a.id);
      if (vivo === null || vivo.revogado_em !== null || Date.parse(vivo.expira_em) <= agora()) {
        atualizar(ent.id, { estado: "cancelada", motivo: "revogado" });
        aud.registrar("bloqueado", { user_id: a.user_id, plano_id, mensagem_entrada_id: ent.id, args_hash, resultado: "revogado" });
        return { ok: false, motivo: "revogado" };
      }
    }
    const ws = a === null ? null : (permitidos(a).find((w) => w.workspace_id === wsIdDe(atual)) ?? null);
    // o workspace do plano precisa continuar liberado para este usuário (e não pode ter virado só-consulta): relê o modo AGORA, nunca o da proposta
    if (a !== null && ws === null) return falhar("workspace_nao_permitido", "Esse workspace não está mais liberado para o bot.");
    const modo = a === null ? "aprovar" : modoDe(a, ws);
    const dec = avaliarPlano(atual, ctxPolitica(modo));
    if (dec.permitido === "bloqueado") return falhar(dec.motivo, `Isso precisa ser feito no desktop (${dec.motivo}).`);
    if (dec.permitido === "desktop" && por.startsWith("telegram:")) return falhar(dec.motivo, `Agora isso exige o desktop (${dec.motivo}).`);
    let r: { iniciado: boolean; mission_id?: string; motivo?: string };
    try {
      r = await deps.orquestrador.executarPlano(plano_id, { aprovado_por: por, args_hash });
    } catch {
      r = { iniciado: false, motivo: "falha_na_execucao" };
    }
    atualizar(ent.id, { estado: r.iniciado ? "executando" : "falhou", aprovado_em: iso(agora()), aprovado_por: por, mission_id: r.mission_id ?? null, ...(r.iniciado ? {} : { motivo: r.motivo ?? "nao_iniciou" }) });
    aud.registrar("aprovado", { user_id: a?.user_id ?? null, workspace_id: wsIdDe(atual), plano_id, mensagem_entrada_id: ent.id, args_hash, resultado: por });
    if (!r.iniciado) {
      aud.registrar("falhou", { user_id: a?.user_id ?? null, plano_id, mensagem_entrada_id: ent.id, resultado: r.motivo ?? "nao_iniciou" });
      await responder(chat_id, "Não consegui iniciar a execução.");
      return { ok: false, motivo: r.motivo ?? "nao_iniciou" };
    }
    aud.registrar("execucao_iniciada", { user_id: a?.user_id ?? null, workspace_id: wsIdDe(atual), plano_id, mensagem_entrada_id: ent.id, args_hash, detalhe: { mission_id: r.mission_id ?? null } });
    const base = planosHtml.get(plano_id);
    await trocarTexto(chat_id, message_id, `${base === undefined ? "<b>Plano</b>" : base.replace(/\nExpira em \d+ min\.$/, "").replace(/\nAprove no desktop[^\n]*$/, "")}\nAprovado às ${hhmm(agora())} — iniciando`);
    // acompanhamento: regra efêmera liga ESTA Missão a ESTE chat
    if (r.mission_id !== undefined && deps.regras !== undefined) {
      const regra: Regra = {
        id: novoId("rgr"),
        nome: `Acompanhamento ${idCurto(plano_id)}`,
        ativa: true,
        tipos: ["tarefa_iniciada", "tarefa_concluida", "tarefa_bloqueada", "tarefa_atrasada", "pane_aguardando", "qa_aprovado", "qa_reprovado", "pr_aberto", "pr_mesclado", "checks_falhando", "missao_concluida", "missao_falhou"],
        canal_id: deps.canal_id,
        filtros: { mission_ids: [r.mission_id] },
        silencio: {},
        agrupamento: { modo: "imediato" },
        nivel: "padrao",
        efemera_ate: iso(agora() + 24 * 3_600_000),
        origem: "pedido_remoto",
        chat_ref: `chat:${chat_id}`,
      };
      deps.regras.gravar(regra);
    }
    if (a !== null) {
      const np = criarNonce(ent, "parar", plano_id, args_hash, a.user_id, chat_id, PARAR_TTL_MS);
      const mid = await enviar(chat_id, `Em andamento · <code>#${idCurto(plano_id)}</code>`, teclado([[{ rotulo: "Parar", dado: montarCallback("p", np) }]]));
      if (mid !== null) deps.repo.definirMessageIdAprovacoes(ent.id, mid);
    }
    return { ok: true };
  }

  async function aprovarPorComando(a: AutorizadoRow, chat_id: number, args: string): Promise<void> {
    const partes = args.split(/\s+/).filter((x) => x !== "");
    const pend = deps.repo.entradasDoAutorizado(a.id, ["plano_enviado"]).filter((e) => e.plano_id !== null);
    const idArg = partes[0]?.replace(/^#/, "").toUpperCase();
    const ent = idArg === undefined ? (pend.length === 1 ? (pend[0] as EntradaRow) : null) : (pend.find((e) => idCurto(e.plano_id as string) === idArg) ?? null);
    if (ent === null) return void (await responder(chat_id, pend.length > 1 ? "Qual plano? Use /aprovar #ID" : "Nenhum plano pendente com esse ID."));
    if (a.pin_hash !== null) {
      const t = agora();
      const lista = (pinTentativas.get(a.user_id) ?? []).filter((x) => t - x < 600_000);
      if (lista.length >= 3) return void (await responder(chat_id, "Muitas tentativas de PIN. Tente de novo em 10 minutos."));
      const pin = partes[1] ?? "";
      const ok = deps.pin !== undefined && pin !== "" && (await deps.pin.verificar(a.pin_hash, pin));
      if (!ok) {
        lista.push(t);
        pinTentativas.set(a.user_id, lista);
        const dia = (pinFalhasDia.get(a.user_id) ?? []).filter((x) => t - x < 86_400_000);
        dia.push(t);
        pinFalhasDia.set(a.user_id, dia);
        if (dia.length >= MAX_FALHAS_PIN_DIA) {
          // força bruta de PIN: revoga ESTE autorizado, anula os nonces dele e avisa no app (o dono refaz o pareamento)
          deps.repo.revogarAutorizado(a.id, iso(t));
          deps.repo.anularAprovacoesDoUsuario(a.user_id);
          pinFalhasDia.delete(a.user_id);
          aud.registrar("revogado", { user_id: a.user_id, resultado: "pin_forca_bruta" });
          deps.alertas?.emitir({ tipo: "erro_sistema", titulo: "Autorização do Telegram revogada: PIN errado várias vezes", dados: { componente: "telegram", codigo: "pin_forca_bruta" }, estado: `pin:${a.user_id}` });
          return;
        }
        aud.registrar("bloqueado", { user_id: a.user_id, plano_id: ent.plano_id, mensagem_entrada_id: ent.id, resultado: "pin_incorreto" });
        return void (await responder(chat_id, "PIN incorreto."));
      }
    }
    const row = deps.repo.consumirAprovacaoPorPlano(ent.plano_id as string, "aprovar", iso(agora()));
    if (row === null) return void (await responder(chat_id, "Esse plano precisa ser aprovado no desktop, ou já expirou."));
    if (row.user_id !== a.user_id || row.chat_id !== chat_id) return void (await responder(chat_id, "Esse plano não é seu."));
    deps.repo.anularAprovacoesPorPlano(row.plano_id);
    await executarAprovado(ent, row.plano_id, row.args_hash, `telegram:${a.user_id}`, a, chat_id, row.message_id);
  }

  async function cancelarPlano(ent: EntradaRow, chat_id: number, message_id: number | null, user_id: number | null): Promise<void> {
    if (ent.plano_id !== null) deps.repo.anularAprovacoesPorPlano(ent.plano_id);
    atualizar(ent.id, { estado: "cancelada" });
    // a proposta também sai do orquestrador (senão ela ficaria viva até expirar); melhor esforço: o estado local já é "cancelada"
    if (ent.plano_id !== null) {
      try {
        await deps.orquestrador.pararPlano(ent.plano_id);
      } catch {
        /* acessório */
      }
    }
    aud.registrar("cancelado", { user_id, plano_id: ent.plano_id, mensagem_entrada_id: ent.id, args_hash: ent.args_hash });
    await trocarTexto(chat_id, message_id, `Cancelado às ${hhmm(agora())}.`);
  }

  // ---------- callbacks ----------
  async function callback(a: AutorizadoRow, user_id: number, chat_id: number, cb: { id: string; data?: string }, mensagem: { message_id: number; date: number }): Promise<void> {
    const p = lerCallback(cb.data);
    if (p === null) return void (await responderCb(cb.id, "Botão inválido."));
    const hash = sha256(p.nonce);
    const peek = deps.repo.aprovacao(hash);
    const negar = async (motivo: string): Promise<void> => {
      aud.registrar("bloqueado", { user_id, resultado: `callback_${motivo}` });
      await responderCb(cb.id, "Não foi possível.");
    };
    if (peek === null) return void (await negar("sem_nonce"));
    if (LETRA[peek.acao] !== p.acao) return void (await negar("acao_diferente"));
    if (peek.user_id !== user_id || peek.chat_id !== chat_id) return void (await negar("outro_usuario_ou_chat"));
    if (peek.message_id === null || peek.message_id !== mensagem.message_id) return void (await negar("outra_mensagem"));
    if (peek.acao === "aprovar" && a.pin_hash !== null) return void (await responderCb(cb.id, "Use /aprovar com o PIN."));
    const row = deps.repo.consumirAprovacao(hash, iso(agora()));
    if (row === null) return void (await responderCb(cb.id, "Já usado ou expirado."));
    const ent = deps.repo.entrada(row.mensagem_entrada_id);
    if (ent === null) return void (await responderCb(cb.id, "Não foi possível."));
    switch (row.acao) {
      case "aprovar": {
        deps.repo.anularAprovacoesPorPlano(row.plano_id);
        await responderCb(cb.id, "Aprovado. Iniciando…");
        await executarAprovado(ent, row.plano_id, row.args_hash, `telegram:${user_id}`, a, chat_id, mensagem.message_id);
        return;
      }
      case "cancelar": {
        await responderCb(cb.id, "Cancelado.");
        await cancelarPlano(ent, chat_id, mensagem.message_id, user_id);
        return;
      }
      case "editar": {
        const feitas = ent.edicoes ?? 0;
        if (feitas >= MAX_EDICOES) {
          await responderCb(cb.id, "Limite de edições atingido.");
          return;
        }
        await responderCb(cb.id, "Responda com o ajuste.");
        const mid = await responder(chat_id, "Responda a esta mensagem com o ajuste (até 1 000 caracteres, 5 min).");
        if (mid !== null) edicoes.set(`${chat_id}:${mid}`, { entrada_id: ent.id, expira: agora() + EDICAO_TTL_MS });
        return;
      }
      case "parar": {
        await responderCb(cb.id, "Parando…");
        let ok = false;
        try {
          ok = await deps.orquestrador.pararPlano(row.plano_id);
        } catch {
          ok = false;
        }
        aud.registrar("parada_solicitada", { user_id, plano_id: row.plano_id, mensagem_entrada_id: ent.id, resultado: ok ? "parado" : "nao_parou" });
        await trocarTexto(chat_id, mensagem.message_id, ok ? `Parado às ${hhmm(agora())}.` : "Não consegui parar.");
        return;
      }
      case "ws": {
        const ws = row.extra ?? "";
        if (!permitidos(a).some((w) => w.workspace_id === ws)) return void (await responderCb(cb.id, "Não foi possível."));
        deps.repo.gravarWorkspaces(a.id, permitidos(a).map((w) => ({ ...w, padrao: w.workspace_id === ws })));
        deps.aoDefinirWorkspacePadrao?.(a.id, ws);
        await responderCb(cb.id, "Workspace padrão definido.");
        await trocarTexto(chat_id, mensagem.message_id, `Workspace padrão: ${escaparHtml(truncarVisivel(deps.consulta.nomeWorkspace(ws) ?? ws, 40))}`);
        return;
      }
      case "gate_aprovar":
      case "gate_recusar": {
        const decisao = row.acao === "gate_aprovar" ? "aprovar" : "recusar";
        const nc = criarNonce(ent, "gate_confirmar", row.plano_id, row.args_hash, user_id, chat_id, 2 * 60_000, `${row.extra ?? ""}|${decisao}`);
        const nn = criarNonce(ent, "cancelar", row.plano_id, row.args_hash, user_id, chat_id, 2 * 60_000);
        await responderCb(cb.id, "Confirme.");
        await trocarTexto(chat_id, mensagem.message_id, `Confirma ${decisao}?`);
        try {
          await deps.api.editMessageReplyMarkup({ chat_id, message_id: mensagem.message_id, reply_markup: { inline_keyboard: teclado([[{ rotulo: "Confirmar", dado: montarCallback("y", nc) }, { rotulo: "Cancelar", dado: montarCallback("c", nn) }]]) } });
        } catch {
          /* ignora */
        }
        deps.repo.definirMessageIdAprovacoes(ent.id, mensagem.message_id);
        return;
      }
      case "gate_confirmar": {
        const [gateId, decisao] = (row.extra ?? "|").split("|");
        // reconferido NA CONFIRMAÇÃO (o PIN ou o modo podem ter mudado depois da lista): PIN => desktop; workspace só-consulta => nunca
        if (a.pin_hash !== null) {
          await responderCb(cb.id, "Com PIN configurado, isso é feito no desktop.");
          aud.registrar("bloqueado", { user_id, resultado: "gate_exige_desktop_com_pin" });
          return;
        }
        const elegiveis = idsPermitidos(a).filter((id) => modoDe(a, permitidos(a).find((w) => w.workspace_id === id) ?? null) !== "consulta");
        const atuais = deps.gates === undefined ? [] : await deps.gates.pendentes(elegiveis);
        const g = atuais.find((x) => x.id === gateId);
        if (g === undefined || g.exige_humano || (decisao !== "aprovar" && decisao !== "recusar") || deps.gates === undefined) {
          await responderCb(cb.id, "Isso precisa ser feito no desktop.");
          aud.registrar("bloqueado", { user_id, resultado: "gate_exige_humano_ou_inexistente" });
          return;
        }
        const r = await deps.gates.decidir(g.id, decisao, `telegram:${user_id}`);
        aud.registrar(r.ok ? "aprovado" : "falhou", { user_id, resultado: `gate:${decisao}` });
        await responderCb(cb.id, r.ok ? "Feito." : "Não foi possível.");
        await trocarTexto(chat_id, mensagem.message_id, r.ok ? `Gate ${decisao === "aprovar" ? "aprovado" : "recusado"} às ${hhmm(agora())}.` : "Não foi possível concluir.");
        return;
      }
    }
  }

  // ---------- mensagens ----------
  async function mensagem(a: AutorizadoRow, user_id: number, chat_id: number, m: NonNullable<TgUpdate["message"]>, update_id: number): Promise<void> {
    const texto = typeof m.text === "string" ? m.text : null;
    if (texto === null) return; // mídia, sticker, voz: ignorados
    const bruto = texto.length > PEDIDO_MAX * 2 ? texto.slice(0, PEDIDO_MAX * 2) : texto;
    // resposta a um pedido de edição: gera plano novo
    const re = m.reply_to_message;
    if (re !== undefined) {
      const ed = edicoes.get(`${chat_id}:${re.message_id}`);
      if (ed !== undefined) {
        edicoes.delete(`${chat_id}:${re.message_id}`);
        const ent = deps.repo.entrada(ed.entrada_id);
        if (ed.expira < agora() || ent === null || ent.autorizado_id !== a.id || ent.estado !== "plano_enviado") return void (await responder(chat_id, MSG.expirou));
        if (m.text !== undefined && m.text.length > AJUSTE_MAX) return void (await responder(chat_id, `Muito longo. Resuma em até ${AJUSTE_MAX} caracteres.`));
        return void (await pedir(a, m, update_id, chat_id, bruto, { ajusteDe: ent }));
      }
    }
    const p = parseComando(bruto, deps.botUsername());
    if (p.tipo === "ignorar") return;
    if (p.tipo === "texto") {
      if (!a.texto_livre) return void (await responder(chat_id, MSG.naoEntendi));
      return void (await pedir(a, m, update_id, chat_id, p.texto));
    }
    if (!p.conhecido) return void (await responder(chat_id, MSG.naoEntendi));
    const classe = classeDoComando(p.cmd);
    if (classe === "proibida") return void (await responder(chat_id, MSG.naoEntendi));
    // comandos de escrita respeitam a idade; consulta responde sempre (AB-08)
    if (classe === "escrita" && idade(m) === "expirada") return void (await responder(chat_id, MSG.expirou));
    switch (p.cmd) {
      case "start":
      case "parear":
      case "ajuda": {
        const ws = workspaceAlvo(a).ws;
        return void (await enviar(chat_id, textoAjuda(permitidos(a).length === 0 ? null : modoDe(a, ws))));
      }
      case "status":
      case "tarefas":
      case "atrasadas":
      case "missoes":
      case "consumo":
      case "aprovacoes":
        return void (await consultar(p.cmd, a, chat_id));
      case "ws": {
        const todos = permitidos(a);
        if (todos.length === 0) return void (await responder(chat_id, MSG.semWorkspace));
        const ent = novaEntrada(a, update_id, "/ws", { comando: "ws", estado: "plano_enviado" });
        if (ent === null) return;
        const botoes = todos.slice(0, 8).map((w) => [{ rotulo: truncarVisivel(deps.consulta.nomeWorkspace(w.workspace_id) ?? w.workspace_id, 30), dado: montarCallback("w", criarNonce(ent, "ws", `ws:${w.workspace_id}`, sha256(w.workspace_id), user_id, chat_id, 5 * 60_000, w.workspace_id)) }]);
        const mid = await enviar(chat_id, "Escolha o workspace padrão:", teclado(botoes));
        if (mid !== null) deps.repo.definirMessageIdAprovacoes(ent.id, mid);
        return;
      }
      case "silenciar": {
        const s = parseSilenciar(p.args);
        if (s === null) return void (await responder(chat_id, "Use /silenciar 30m, 2h, tudo 2h ou off."));
        deps.silenciarCanal?.(s.ms === 0 ? null : iso(agora() + s.ms), s.incluir_criticos);
        return void (await responder(chat_id, s.ms === 0 ? "Alertas reativados." : `Alertas silenciados por ${duracao(s.ms)}${s.incluir_criticos ? " (inclui críticos)" : " (críticos continuam)"}.`));
      }
      case "pedir":
        return void (await pedir(a, m, update_id, chat_id, p.args));
      case "aprovar":
        return void (await aprovarPorComando(a, chat_id, p.args));
      case "cancelar": {
        const pend = deps.repo.entradasDoAutorizado(a.id, ["plano_enviado"]).filter((e) => e.plano_id !== null);
        const idArg = p.args.split(/\s+/)[0]?.replace(/^#/, "").toUpperCase() ?? "";
        const ent = idArg === "" ? (pend.length === 1 ? (pend[0] as EntradaRow) : null) : (pend.find((e) => idCurto(e.plano_id as string) === idArg) ?? null);
        if (ent === null) return void (await responder(chat_id, pend.length > 1 ? "Qual plano? Use /cancelar #ID" : "Nenhum plano pendente."));
        await cancelarPlano(ent, chat_id, null, user_id);
        return void (await responder(chat_id, "Plano cancelado."));
      }
      case "parar": {
        await responder(chat_id, "Desligando o bot e revogando os pareamentos. Rotacione o token no BotFather.");
        await deps.aoPanico?.({ parar_execucoes: true, origem: `telegram:${user_id}` });
        return;
      }
    }
  }

  return {
    async tratar(u) {
      // 1) pareamento: o único caminho aberto a quem ainda não está autorizado (e mesmo assim em silêncio)
      const m0 = u.message;
      if (m0 !== undefined && typeof m0.text === "string" && m0.chat?.type === "private" && m0.from !== undefined && m0.from.is_bot !== true && m0.forward_origin === undefined && m0.via_bot === undefined && m0.sender_chat === undefined && typeof m0.from.id === "number") {
        const mp = /^\/(?:start|parear)(?:@[A-Za-z0-9_]{1,64})?[ \t]+(\S{1,64})[ \t]*$/.exec(m0.text.slice(0, 200));
        if (mp !== null && deps.pareamento.estado() === "aguardando") {
          const nome = [m0.from.first_name, m0.from.last_name].filter((x): x is string => typeof x === "string").join(" ");
          const r = deps.pareamento.tentar({ user_id: m0.from.id, chat_id: m0.chat.id, nome }, mp[1] as string);
          if (r.pedido !== null) aud.registrar("pareamento_pedido", { user_id: m0.from.id, resultado: "aguardando_desktop" });
          return;
        }
      }
      // 2) autorização (silêncio total para quem não está na lista)
      const r = deps.autorizador.autorizar(u);
      if (!r.ok) return;
      const lim = deps.limite.mensagem(r.user_id);
      if (!lim.ok) {
        if (lim.avisar) await responder(r.chat_id, MSG.devagar);
        return;
      }
      try {
        if (r.tipo === "callback") await callback(r.autorizado, r.user_id, r.chat_id, r.callback, r.mensagem);
        else await mensagem(r.autorizado, r.user_id, r.chat_id, r.mensagem, u.update_id);
      } catch {
        /* um update com erro nunca derruba o poller */
      }
    },

    async decidirNoDesktop(plano_id, decisao, args_hash) {
      const ent = deps.repo.entradaPorPlano(plano_id);
      if (ent === null || ent.estado !== "plano_enviado") return { ok: false, motivo: "plano_inexistente_ou_encerrado" };
      const a = deps.repo.autorizadoPorId(ent.autorizado_id);
      const chat = a?.chat_id ?? 0;
      if (ent.args_hash !== args_hash) {
        aud.registrar("bloqueado", { user_id: a?.user_id ?? null, plano_id, mensagem_entrada_id: ent.id, resultado: "plano_alterado" });
        return { ok: false, motivo: "plano_alterado" };
      }
      deps.repo.anularAprovacoesPorPlano(plano_id);
      if (decisao === "cancelar") {
        await cancelarPlano(ent, chat, null, a?.user_id ?? null);
        return { ok: true };
      }
      // a aprovação no app vale o MESMO que a do chat: o plano proposto expira no TTL (10 min), nunca fica aprovável para sempre
      if (agora() - Date.parse(ent.criado_em) > cfg.plano_ttl_min * 60_000) {
        atualizar(ent.id, { estado: "expirada", motivo: "ttl" });
        aud.registrar("bloqueado", { user_id: a?.user_id ?? null, plano_id, mensagem_entrada_id: ent.id, resultado: "expirou" });
        return { ok: false, motivo: "expirou" };
      }
      return executarAprovado(ent, plano_id, args_hash, "desktop", a, chat, null);
    },

    aoMissaoFechada(mission_id, resultado, resumo) {
      for (const e of [...(deps.regras?.listar() ?? [])]) {
        if (e.origem === "pedido_remoto" && e.filtros.mission_ids?.includes(mission_id) === true) deps.regras?.gravar({ ...e, efemera_ate: iso(agora() + 3_600_000) });
      }
      const ent = [...deps.repo.listarAutorizados(deps.canal_id)].flatMap((a) => deps.repo.entradasDoAutorizado(a.id, ["executando"])).find((x) => x.mission_id === mission_id);
      if (ent === undefined) return;
      atualizar(ent.id, { estado: resultado === "concluida" ? "concluida" : "falhou", resultado_resumo: truncarVisivel(redigirParaCanal(resumo, scrub), 300) });
      aud.registrar(resultado === "concluida" ? "concluida" : "falhou", { plano_id: ent.plano_id, mensagem_entrada_id: ent.id, resultado: truncarVisivel(redigirParaCanal(resumo, scrub), 100) });
    },
  };
}
