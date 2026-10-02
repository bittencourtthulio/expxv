// Parser de comandos e respostas de CONSULTA (T-20.27). Respostas só de workspaces permitidos, redigidas, <= 1 500 caracteres, em HTML do Telegram
// (valores escapados). Comando de outro bot (`/cmd@outro_bot`) é ignorado; desconhecido => "Não entendi. /ajuda".
import { duracao } from "../alertas/templates";
import { redigirParaCanal, truncarVisivel } from "../alertas/texto";
import type { ModoWorkspaceTelegram } from "../../compartilhado/alertas";
import { escaparHtml } from "./formato";
import type { GatePendente, LinhaTarefaConsulta } from "./portas-entrada";

export const RESPOSTA_MAX = 1500;
export const ARGS_MAX = 2000;
export const COMANDOS_CONHECIDOS = ["start", "parear", "ajuda", "status", "tarefas", "atrasadas", "missoes", "consumo", "aprovacoes", "ws", "pedir", "aprovar", "cancelar", "silenciar", "parar"] as const;
export type ComandoConhecido = (typeof COMANDOS_CONHECIDOS)[number];

export type Parseado = { tipo: "comando"; cmd: string; conhecido: boolean; args: string } | { tipo: "texto"; texto: string } | { tipo: "ignorar" };

const RE_CMD = /^\/([A-Za-z][A-Za-z0-9_]{0,31})(?:@([A-Za-z0-9_]{1,64}))?(?:[ \t\r\n]+([\s\S]*))?$/;

export function parseComando(texto: string, botUsername: string | null): Parseado {
  const t = (texto.length > ARGS_MAX * 2 ? texto.slice(0, ARGS_MAX * 2) : texto).trimStart();
  if (!t.startsWith("/")) return { tipo: "texto", texto: t.trim() };
  const m = RE_CMD.exec(t);
  if (m === null) return { tipo: "comando", cmd: "?", conhecido: false, args: "" };
  const alvo = m[2];
  if (alvo !== undefined && (botUsername === null || alvo.toLowerCase() !== botUsername.toLowerCase())) return { tipo: "ignorar" };
  const cmd = (m[1] as string).toLowerCase();
  return { tipo: "comando", cmd, conhecido: (COMANDOS_CONHECIDOS as readonly string[]).includes(cmd), args: (m[3] ?? "").trim() };
}

/** `/silenciar [30m|2h|tudo 2h|off]` => duração em ms (0 = desligar) e se inclui críticos. `null` = formato inválido. */
export function parseSilenciar(args: string): { ms: number; incluir_criticos: boolean } | null {
  const t = args.trim().toLowerCase();
  if (t === "off" || t === "desligar" || t === "0") return { ms: 0, incluir_criticos: false };
  const m = /^(tudo\s+)?(\d{1,4})\s*(m|min|h)?$/.exec(t === "" ? "1h" : t);
  if (m === null) return null;
  const ms = Number(m[2]) * (m[3] === "h" ? 3_600_000 : 60_000);
  if (ms <= 0 || ms > 24 * 3_600_000) return null;
  return { ms, incluir_criticos: m[1] !== undefined };
}

const limpo = (t: string, n: number): string => escaparHtml(truncarVisivel(redigirParaCanal(t), n));
const pts = (v: number | null): string => (v === null ? "sem estimativa" : String(v));
const tok = (v: number | null): string => (v === null ? "sem fonte" : new Intl.NumberFormat("pt-BR").format(v));
const dur = (v: number | null | undefined): string => (v === null || v === undefined ? "sem medição" : duracao(v));

function cortar(linhas: string[]): string {
  let saida = "";
  for (const l of linhas) {
    if (saida.length + l.length + 1 > RESPOSTA_MAX) return `${saida}…`;
    saida += (saida === "" ? "" : "\n") + l;
  }
  return saida;
}

export function textoAjuda(modo: ModoWorkspaceTelegram | null): string {
  const base = ["<b>Comandos</b>", "/status — situação geral", "/tarefas — em andamento e próximas", "/atrasadas — o que está atrasado", "/missoes — Missões ativas", "/consumo — cotas e consumo", "/aprovacoes — pendências de aprovação", "/silenciar 30m | 2h | tudo 2h | off — pausa os alertas deste chat", "/ws — escolhe o workspace padrão"];
  const pedir = modo === "consulta" ? ["Este workspace é só consulta."] : ["/pedir texto — pede um trabalho; você aprova o plano antes de executar", "/aprovar id [PIN] — aprova um plano pendente", "/cancelar [id] — cancela um plano"];
  return cortar([...base, ...pedir, "/parar — desliga o bot e revoga os pareamentos", modo === null ? "Nenhum workspace liberado." : `Modo atual: ${modo}`]);
}

const linhaTarefa = (t: LinhaTarefaConsulta): string => `<code>${limpo(t.task_id, 20)}</code> ${limpo(t.titulo, 50)} · ${pts(t.story_points)} pts · ${dur(t.tempo_trabalho_ms)} · tokens ${tok(t.tokens)}`;

export function respostaStatus(d: { missoes: Array<{ titulo: string; panes_trabalhando: number; panes_aguardando: number }>; emAndamento: LinhaTarefaConsulta[]; atrasadas: number; cotaPct: number | null; criticos: number }): string {
  return cortar([
    "<b>Status</b>",
    `Missões ativas: ${d.missoes.length}${d.missoes.slice(0, 3).map((m) => `\n• ${limpo(m.titulo, 40)} (${m.panes_trabalhando} trabalhando, ${m.panes_aguardando} aguardando)`).join("")}`,
    `Tarefas em andamento: ${d.emAndamento.length}${d.emAndamento.slice(0, 5).map((t) => `\n• ${linhaTarefa(t)}`).join("")}`,
    `Atrasadas: ${d.atrasadas}`,
    `Cota geral: ${d.cotaPct === null ? "sem fonte" : `${Math.round(d.cotaPct)}%`}`,
    `Alertas críticos não lidos: ${d.criticos}`,
  ]);
}
export function respostaTarefas(em: LinhaTarefaConsulta[], proximas: LinhaTarefaConsulta[]): string {
  if (em.length === 0 && proximas.length === 0) return "Nenhuma tarefa por aqui.";
  return cortar(["<b>Em andamento</b>", ...(em.length === 0 ? ["nenhuma"] : em.slice(0, 8).map(linhaTarefa)), "<b>Próximas</b>", ...(proximas.length === 0 ? ["nenhuma"] : proximas.slice(0, 8).map(linhaTarefa))]);
}
export function respostaAtrasadas(a: LinhaTarefaConsulta[]): string {
  if (a.length === 0) return "Nada atrasado.";
  return cortar(["<b>Atrasadas</b>", ...a.slice(0, 10).map((t) => `${linhaTarefa(t)} · trabalhando ${dur(t.tempo_trabalho_ms)} — limite ${dur(t.limite_ms)} · ${t.quem === null || t.quem === undefined ? "" : limpo(t.quem, 20)}`.trim())]);
}
export function respostaMissoes(m: Array<{ titulo: string; panes_trabalhando: number; panes_aguardando: number }>): string {
  if (m.length === 0) return "Nenhuma Missão ativa.";
  return cortar(["<b>Missões ativas</b>", ...m.slice(0, 10).map((x) => `• ${limpo(x.titulo, 50)} — ${x.panes_trabalhando} trabalhando, ${x.panes_aguardando} aguardando`)]);
}
export function respostaConsumo(c: Array<{ conta: string; provedor: string; pct: number | null }>, geral: number | null): string {
  return cortar(["<b>Consumo</b>", `Cota geral: ${geral === null ? "sem fonte" : `${Math.round(geral)}%`}`, ...c.slice(0, 10).map((x) => `• ${limpo(x.conta, 30)} (${limpo(x.provedor, 20)}): ${x.pct === null ? "sem fonte" : `${Math.round(x.pct)}%`}`)]);
}
export function respostaGates(g: GatePendente[]): string {
  if (g.length === 0) return "Nenhuma aprovação pendente.";
  return cortar(["<b>Aprovações pendentes</b>", ...g.slice(0, 8).map((x) => `• ${limpo(x.titulo, 60)}${x.exige_humano ? " — só no desktop" : ""}`)]);
}
