// Portas de persistência do Telegram (tabelas de `docs/ade/pedidos/20-pedidos.md`) + implementação EM MEMÓRIA com o mesmo contrato do SQL.
// Invariantes que o repositório SQL também precisa honrar: `consumirAprovacao` é atômico (`UPDATE ... WHERE estado='pendente' AND expira_em>?`
// com `changes()==1`); `inserirEntrada` respeita `UNIQUE(canal_id, update_id)`; nenhuma coluna guarda token/PIN em claro (só hashes).
import type { ModoWorkspaceTelegram } from "../../compartilhado/alertas";

export interface EstadoTelegramRow {
  canal_id: string;
  proximo_offset: number | null;
  ultimo_update_id: number | null;
  bot_id: number | null;
  bot_username: string | null;
  bot_nome: string | null;
  ultimo_poll_em: string | null;
  ultimo_erro_codigo: string | null;
  conflitos_seguidos: number;
  descarte_inicial_feito: boolean;
}
export interface AutorizadoRow {
  id: string;
  canal_id: string;
  user_id: number;
  chat_id: number;
  /** informativo, redigido, <= 40; NUNCA usado para autorizar. */
  nome_exibicao: string;
  modo_padrao: ModoWorkspaceTelegram;
  texto_livre: boolean;
  /** `scrypt$...` — nunca o PIN. */
  pin_hash: string | null;
  criado_em: string;
  ultimo_uso_em: string;
  expira_em: string;
  revogado_em: string | null;
}
export interface WorkspaceRow {
  autorizado_id: string;
  workspace_id: string;
  modo: ModoWorkspaceTelegram;
  padrao: boolean;
}
export interface NaoAutorizadoRow {
  user_id: number;
  primeiro_em: string;
  ultimo_em: string;
  contagem: number;
  bloqueado: boolean;
}
export type EstadoEntrada = "recebida" | "ignorada" | "plano_enviado" | "aprovada" | "cancelada" | "expirada" | "bloqueada" | "executando" | "concluida" | "falhou";
export interface EntradaRow {
  id: string;
  canal_id: string;
  autorizado_id: string;
  update_id: number;
  /** sempre redigido e <= 2000. */
  texto_redigido: string;
  tamanho_original: number;
  comando: string | null;
  intencao: string | null;
  plano_id: string | null;
  workspace_id: string | null;
  estado: EstadoEntrada;
  motivo: string | null;
  args_hash: string | null;
  mission_id: string | null;
  resultado_resumo: string | null;
  aprovado_em: string | null;
  aprovado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  /** hash do texto normalizado (dedupe de 2 min). */
  texto_hash?: string;
  /** nº de edições já feitas do plano (máx. 3). */
  edicoes?: number;
}
export type AcaoAprovacao = "aprovar" | "editar" | "cancelar" | "parar" | "ws" | "gate_aprovar" | "gate_recusar" | "gate_confirmar";
export interface AprovacaoRow {
  nonce_hash: string;
  mensagem_entrada_id: string;
  acao: AcaoAprovacao;
  plano_id: string;
  args_hash: string;
  chat_id: number;
  message_id: number | null;
  user_id: number;
  estado: "pendente" | "usado" | "anulado" | "expirado";
  expira_em: string;
  usado_em: string | null;
  /** só `ws`: workspace escolhido (dado do APP, nunca do usuário). */
  extra?: string | null;
}
export interface AuditoriaRow {
  id: string;
  ts: string;
  canal_id: string;
  evento: string;
  user_id: number | null;
  workspace_id: string | null;
  plano_id: string | null;
  mensagem_entrada_id: string | null;
  args_hash: string | null;
  resultado: string | null;
  detalhe: Record<string, unknown>;
}

export interface RepoTelegram {
  estado(canal_id: string): EstadoTelegramRow;
  salvarEstado(canal_id: string, patch: Partial<EstadoTelegramRow>): void;
  updateVisto(update_id: number): boolean;
  marcarVisto(update_id: number, em: string): void;
  apagarVistosAntesDe(iso: string): number;
  /** retenção de 30 dias: apaga `mensagem_entrada` (e, em cascata, os nonces) e os desconhecidos antigos NÃO bloqueados. */
  apagarEntradasAntesDe(iso: string): number;

  autorizadoPorUser(canal_id: string, user_id: number): AutorizadoRow | null;
  autorizadoPorId(id: string): AutorizadoRow | null;
  listarAutorizados(canal_id: string): AutorizadoRow[];
  gravarAutorizado(r: AutorizadoRow): void;
  revogarAutorizado(id: string, em: string): boolean;
  revogarTodos(canal_id: string, em: string): number;
  workspaces(autorizado_id: string): WorkspaceRow[];
  gravarWorkspaces(autorizado_id: string, rows: WorkspaceRow[]): void;

  naoAutorizado(user_id: number): NaoAutorizadoRow | null;
  gravarNaoAutorizado(r: NaoAutorizadoRow): void;
  listarNaoAutorizados(): NaoAutorizadoRow[];

  entradaPorUpdate(canal_id: string, update_id: number): EntradaRow | null;
  inserirEntrada(r: EntradaRow): boolean;
  entrada(id: string): EntradaRow | null;
  atualizarEntrada(id: string, patch: Partial<EntradaRow>): void;
  entradasDoAutorizado(autorizado_id: string, estados: EstadoEntrada[]): EntradaRow[];
  entradaPorPlano(plano_id: string): EntradaRow | null;
  entradaRecentePorHash(autorizado_id: string, texto_hash: string, desde_iso: string): EntradaRow | null;

  inserirAprovacao(r: AprovacaoRow): void;
  /** grava o `message_id` real nos nonces da entrada depois que o `sendMessage` devolveu. */
  definirMessageIdAprovacoes(mensagem_entrada_id: string, message_id: number): void;
  aprovacao(nonce_hash: string): AprovacaoRow | null;
  /** atômico: devolve a linha SÓ para o primeiro que consome; 50 chamadas concorrentes => 1 vencedor. */
  consumirAprovacao(nonce_hash: string, agora_iso: string): AprovacaoRow | null;
  /** atômico: consome o nonce pendente (não expirado) de `acao` do plano — usado por `/aprovar` e `/cancelar` digitados. */
  consumirAprovacaoPorPlano(plano_id: string, acao: AcaoAprovacao, agora_iso: string): AprovacaoRow | null;
  anularAprovacoesPorPlano(plano_id: string): number;
  anularAprovacoesDoUsuario(user_id: number): number;
  anularTodasAprovacoes(canal_id: string): number;

  inserirAuditoria(r: AuditoriaRow): void;
  listarAuditoria(canal_id: string, depois_ts: string | null, limite: number): AuditoriaRow[];
  apagarAuditoriaAntesDe(iso: string): number;

  /** o SQL real roda `fn` numa transação; a memória só chama. */
  transacao<T>(fn: () => T): T;
}

export const estadoVazio = (canal_id: string): EstadoTelegramRow => ({ canal_id, proximo_offset: null, ultimo_update_id: null, bot_id: null, bot_username: null, bot_nome: null, ultimo_poll_em: null, ultimo_erro_codigo: null, conflitos_seguidos: 0, descarte_inicial_feito: false });

export function criarRepoTelegramMemoria(): RepoTelegram {
  const estados = new Map<string, EstadoTelegramRow>();
  const vistos = new Map<number, string>();
  const autorizados = new Map<string, AutorizadoRow>();
  const ws = new Map<string, WorkspaceRow[]>();
  const nao = new Map<number, NaoAutorizadoRow>();
  const entradas = new Map<string, EntradaRow>();
  const aprovacoes = new Map<string, AprovacaoRow>();
  const auditoria: AuditoriaRow[] = [];
  const anular = (pred: (a: AprovacaoRow) => boolean): number => {
    let n = 0;
    for (const a of aprovacoes.values()) if (a.estado === "pendente" && pred(a)) (a.estado = "anulado", n++);
    return n;
  };
  return {
    estado: (c) => ({ ...(estados.get(c) ?? estadoVazio(c)) }),
    salvarEstado(c, patch) {
      estados.set(c, { ...(estados.get(c) ?? estadoVazio(c)), ...patch });
    },
    updateVisto: (id) => vistos.has(id),
    marcarVisto: (id, em) => void vistos.set(id, em),
    apagarVistosAntesDe(iso) {
      let n = 0;
      for (const [id, em] of vistos) if (em < iso) (vistos.delete(id), n++);
      return n;
    },
    apagarEntradasAntesDe(iso) {
      let n = 0;
      for (const [id, e] of entradas) {
        if (e.criado_em >= iso) continue;
        entradas.delete(id);
        for (const [h, a] of aprovacoes) if (a.mensagem_entrada_id === id) aprovacoes.delete(h);
        n++;
      }
      for (const [u, x] of nao) if (!x.bloqueado && x.ultimo_em < iso) nao.delete(u);
      return n;
    },
    autorizadoPorUser: (c, u) => [...autorizados.values()].find((a) => a.canal_id === c && a.user_id === u) ?? null,
    autorizadoPorId: (id) => autorizados.get(id) ?? null,
    listarAutorizados: (c) => [...autorizados.values()].filter((a) => a.canal_id === c),
    gravarAutorizado(r) {
      // UNIQUE (canal_id, user_id): regravar o mesmo usuário substitui a linha
      for (const a of autorizados.values()) if (a.canal_id === r.canal_id && a.user_id === r.user_id && a.id !== r.id) autorizados.delete(a.id);
      autorizados.set(r.id, { ...r });
    },
    revogarAutorizado(id, em) {
      const a = autorizados.get(id);
      if (a === undefined || a.revogado_em !== null) return false;
      a.revogado_em = em;
      return true;
    },
    revogarTodos(c, em) {
      let n = 0;
      for (const a of autorizados.values()) if (a.canal_id === c && a.revogado_em === null) (a.revogado_em = em, n++);
      return n;
    },
    workspaces: (id) => (ws.get(id) ?? []).map((w) => ({ ...w })),
    gravarWorkspaces: (id, rows) => void ws.set(id, rows.map((r) => ({ ...r, autorizado_id: id }))),
    naoAutorizado: (u) => (nao.get(u) === undefined ? null : { ...(nao.get(u) as NaoAutorizadoRow) }),
    gravarNaoAutorizado(r) {
      nao.set(r.user_id, { ...r });
      // teto de 500 linhas: descarta as mais antigas não bloqueadas
      if (nao.size > 500) {
        const velhas = [...nao.values()].filter((x) => !x.bloqueado).sort((a, b) => (a.ultimo_em < b.ultimo_em ? -1 : 1));
        for (const v of velhas.slice(0, nao.size - 500)) nao.delete(v.user_id);
      }
    },
    listarNaoAutorizados: () => [...nao.values()].map((x) => ({ ...x })),
    entradaPorUpdate: (c, u) => [...entradas.values()].find((e) => e.canal_id === c && e.update_id === u) ?? null,
    inserirEntrada(r) {
      if ([...entradas.values()].some((e) => e.canal_id === r.canal_id && e.update_id === r.update_id)) return false;
      entradas.set(r.id, { ...r });
      return true;
    },
    entrada: (id) => entradas.get(id) ?? null,
    atualizarEntrada(id, patch) {
      const e = entradas.get(id);
      if (e !== undefined) entradas.set(id, { ...e, ...patch });
    },
    entradasDoAutorizado: (id, estados) => [...entradas.values()].filter((e) => e.autorizado_id === id && estados.includes(e.estado)),
    entradaPorPlano: (p) => [...entradas.values()].find((e) => e.plano_id === p) ?? null,
    entradaRecentePorHash: (id, h, desde) => [...entradas.values()].find((e) => e.autorizado_id === id && e.texto_hash === h && e.criado_em >= desde) ?? null,
    inserirAprovacao: (r) => void aprovacoes.set(r.nonce_hash, { ...r }),
    definirMessageIdAprovacoes(id, mid) {
      for (const a of aprovacoes.values()) if (a.mensagem_entrada_id === id && a.message_id === null) a.message_id = mid;
    },
    aprovacao: (h) => aprovacoes.get(h) ?? null,
    consumirAprovacao(h, agora) {
      const a = aprovacoes.get(h);
      if (a === undefined || a.estado !== "pendente") return null;
      if (a.expira_em <= agora) {
        a.estado = "expirado";
        return null;
      }
      a.estado = "usado";
      a.usado_em = agora;
      return { ...a };
    },
    consumirAprovacaoPorPlano(plano_id, acao, agora) {
      const a = [...aprovacoes.values()].find((x) => x.plano_id === plano_id && x.acao === acao && x.estado === "pendente" && x.expira_em > agora);
      if (a === undefined) return null;
      a.estado = "usado";
      a.usado_em = agora;
      return { ...a };
    },
    anularAprovacoesPorPlano: (p) => anular((a) => a.plano_id === p),
    anularAprovacoesDoUsuario: (u) => anular((a) => a.user_id === u),
    anularTodasAprovacoes: () => anular(() => true),
    inserirAuditoria: (r) => void auditoria.push({ ...r }),
    listarAuditoria(c, depois, limite) {
      return auditoria
        .filter((a) => a.canal_id === c && (depois === null || a.ts < depois))
        .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1))
        .slice(0, limite);
    },
    apagarAuditoriaAntesDe(iso) {
      let n = 0;
      for (let i = auditoria.length - 1; i >= 0; i--) if ((auditoria[i] as AuditoriaRow).ts < iso) (auditoria.splice(i, 1), n++);
      return n;
    },
    transacao: (fn) => fn(),
  };
}
