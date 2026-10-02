// Lógica pura do Chat orquestrador (Fase 15): citações, redutor de streaming, janela virtual e validações do composer/plano.
import type { CitacaoChat, CliChat, MensagemChatDto, PerfilChatEstado, PlanoChatDto } from "../../../compartilhado/chat";

export const LIMITE_COMPOSER = 8000;
export const LIMITE_PROMPT_PLANO = 20_000;
export const LIMITE_TEXTO_MENSAGEM = 200_000;
export const CLIS_CHAT: readonly CliChat[] = ["claude", "codex", "opencode", "gemini"];

// ---- citações ---------------------------------------------------------------------------------------------------------

export type SegmentoTexto = { tipo: "texto"; valor: string } | { tipo: "cit"; n: number };

/** `[n]` vira citação só se o número existe; todo o resto é TEXTO (a UI nunca usa HTML bruto). */
export function partirCitacoes(texto: string, citacoes: readonly CitacaoChat[]): SegmentoTexto[] {
  if (texto === "") return [];
  const validos = new Set(citacoes.map((c) => c.n));
  const saida: SegmentoTexto[] = [];
  let ultimo = 0;
  const re = /\[(\d{1,3})\]/g;
  let m: RegExpExecArray | null;
  const empurrar = (valor: string): void => {
    if (valor === "") return;
    const ant = saida[saida.length - 1];
    if (ant !== undefined && ant.tipo === "texto") ant.valor += valor; else saida.push({ tipo: "texto", valor });
  };
  while ((m = re.exec(texto)) !== null) {
    const n = Number(m[1]);
    if (!validos.has(n)) continue;
    empurrar(texto.slice(ultimo, m.index));
    saida.push({ tipo: "cit", n });
    ultimo = m.index + m[0].length;
  }
  empurrar(texto.slice(ultimo));
  return saida;
}

function dataCurta(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
export function linhaDeCitacao(c: CitacaoChat): string {
  const d = dataCurta(c.ocorrido_em);
  return `[${c.n}] ${c.titulo} · ${c.tipo} · ${c.origem}${d !== null ? ` · ${d}` : ""}`;
}

// ---- streaming ----------------------------------------------------------------------------------------------------------

export function reduzirToken(msgs: readonly MensagemChatDto[], mensagemId: string, delta: string): MensagemChatDto[] {
  const i = msgs.findIndex((m) => m.id === mensagemId);
  if (i < 0) {
    const nova: MensagemChatDto = { id: mensagemId, conversa_id: msgs[0]?.conversa_id ?? "", papel: "assistente", texto: delta.slice(0, LIMITE_TEXTO_MENSAGEM), citacoes: [], plano_id: null, estado: "transmitindo", criado_em: new Date().toISOString() };
    return [...msgs, nova];
  }
  const atual = msgs[i] as MensagemChatDto;
  const texto = (atual.texto + delta).slice(0, LIMITE_TEXTO_MENSAGEM);
  const copia = msgs.slice();
  copia[i] = { ...atual, texto };
  return copia;
}

export function mesclarMensagem(msgs: readonly MensagemChatDto[], nova: MensagemChatDto): MensagemChatDto[] {
  const i = msgs.findIndex((m) => m.id === nova.id);
  const lista = i < 0 ? [...msgs, nova] : msgs.map((m, k) => (k === i ? nova : m));
  return lista.sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));
}

// ---- janela virtual de altura variável ----------------------------------------------------------------------------------

export interface Janela { primeiro: number; ultimo: number; alturaTotal: number; deslocamento: number }

export function calcularJanela(alturas: readonly number[], topo: number, altura: number, extra: number): Janela {
  const n = alturas.length;
  if (n === 0) return { primeiro: 0, ultimo: 0, alturaTotal: 0, deslocamento: 0 };
  const offsets = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = (offsets[i] as number) + (alturas[i] as number);
  const total = offsets[n] as number;
  const achar = (y: number): number => {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if ((offsets[mid] as number) <= y) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const p = achar(Math.max(0, topo));
  const u = Math.min(n, achar(Math.max(0, topo + altura)) + 1);
  const primeiro = Math.max(0, p - extra);
  const ultimo = Math.min(n, u + extra);
  return { primeiro, ultimo, alturaTotal: total, deslocamento: offsets[primeiro] as number };
}

export const ALTURA_MAX_ESTIMADA = 2400;
/** Altura provisória (px) até a medição real: linhas por largura em caracteres × 17 px + cabeçalho. */
export function alturaEstimada(m: MensagemChatDto, colunas: number): number {
  const larg = Math.max(20, colunas);
  let linhas = 0;
  const texto = m.texto.length > 20_000 ? m.texto.slice(0, 20_000) : m.texto;
  for (const l of texto.split("\n")) linhas += Math.max(1, Math.ceil(l.length / larg));
  const extra = (m.citacoes.length > 0 ? 18 : 0) + (m.plano_id !== null ? 260 : 0);
  return Math.min(ALTURA_MAX_ESTIMADA, 34 + linhas * 17 + extra);
}

// ---- composer e plano ---------------------------------------------------------------------------------------------------

export function validarComposer(texto: string): { ok: boolean; motivo: string | null } {
  if (texto.trim() === "") return { ok: false, motivo: "Escreva a mensagem." };
  if (texto.length > LIMITE_COMPOSER) return { ok: false, motivo: `Máximo de ${LIMITE_COMPOSER} caracteres (${texto.length}).` };
  return { ok: true, motivo: null };
}

export function avaliarAjuste(a: { prompt?: string; cli?: CliChat }): { ok: boolean; motivo: string | null } {
  if (a.prompt !== undefined) {
    if (a.prompt.trim() === "") return { ok: false, motivo: "O prompt não pode ficar vazio." };
    if (a.prompt.length > LIMITE_PROMPT_PLANO) return { ok: false, motivo: `O prompt tem no máximo ${LIMITE_PROMPT_PLANO} caracteres.` };
  }
  if (a.cli !== undefined && !CLIS_CHAT.includes(a.cli)) return { ok: false, motivo: "CLI desconhecida." };
  return { ok: true, motivo: null };
}

export function podeDecidir(p: Pick<PlanoChatDto, "estado" | "exige_aprovacao">): { aprovar: boolean; editar: boolean; cancelar: boolean } {
  const proposto = p.estado === "proposto";
  return { aprovar: proposto && p.exige_aprovacao, editar: proposto, cancelar: proposto };
}

export const rotuloEstadoPlano = (e: PlanoChatDto["estado"]): string => e === "proposto" ? "proposto" : e === "aprovado" ? "aprovado" : e === "executando" ? "executando" : e === "concluido" ? "concluído" : e === "cancelado" ? "cancelado" : "falhou";

export function descreverSemLlm(p: PerfilChatEstado): { semLlm: boolean; motivo: string | null } {
  const disponiveis = p.clis.filter((c) => c.disponivel);
  if (p.clis.length > 0 && disponiveis.length === 0) {
    const motivo = p.clis.map((c) => `${c.cli}: ${c.motivo ?? "indisponível"}`).join("; ");
    return { semLlm: true, motivo: `Nenhuma CLI disponível (${motivo}).` };
  }
  if (p.perfil !== null) {
    const escolhida = p.clis.find((c) => c.cli === p.perfil?.cli);
    if (escolhida !== undefined && !escolhida.disponivel) return { semLlm: true, motivo: `${escolhida.cli} indisponível (${escolhida.motivo ?? "sem motivo informado"}).` };
  }
  return { semLlm: false, motivo: null };
}
