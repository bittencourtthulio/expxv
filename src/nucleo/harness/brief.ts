// Checkpoint por turno e brief de retomada (Fase 9, T-09.18). PURO: sem I/O, sem relógio próprio, sem rede.
// O que toca disco, git e tela entra por injeção (`coletar`, `gravar`, `scrub`). Todo texto que sai daqui passou pelo
// scrubber do cofre (valor literal e variantes viram `«cofre:NOME»`) e respeita o teto de 16 KB.
// Nada daqui diz qual conta ou modelo usar: isso é do `pickModel`/`pickAccount` (uma regra, um lugar).

/** Teto de checkpoint e de brief, em bytes UTF-8. */
export const TETO_BYTES_CHECKPOINT = 16 * 1024;
/** No máximo 1 gravação de checkpoint por Pane neste intervalo (sobrescreve; o intermediário é descartado). */
export const INTERVALO_CHECKPOINT_MS = 30_000;
export const MAX_LINHAS_STATUS = 40;
export const MAX_LINHAS_TELA = 60;
const MAX_LINHA_CHARS = 400;

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export type Scrub = (texto: string) => string;
const identidade: Scrub = (t) => t;

function limpaLinha(l: string): string {
  const s = l.replace(ANSI, "").replace(CONTROLES, "").replace(/\s+$/g, "");
  return s.length > MAX_LINHA_CHARS ? `${s.slice(0, MAX_LINHA_CHARS)}…` : s;
}

/** Corta em `max` bytes UTF-8 sem partir caractere; marca o corte. */
export function cortarEmBytes(texto: string, max: number): string {
  if (Buffer.byteLength(texto, "utf8") <= max) return texto;
  const marca = "\n[…cortado]\n";
  const alvo = Math.max(0, max - Buffer.byteLength(marca, "utf8"));
  let corte = Buffer.from(texto, "utf8").subarray(0, alvo).toString("utf8");
  corte = corte.replace(/�+$/u, "");
  return `${corte}${marca}`;
}

export interface EntradaCheckpoint {
  task_ref: string | null;
  titulo: string | null;
  branch: string | null;
  /** `git status --short` (uma linha por item). */
  status_curto: readonly string[];
  /** tela do Pane, da mais antiga para a mais nova. */
  ultimas_linhas: readonly string[];
  /** ISO do instante da leitura (só informativo). */
  em: string;
}

/** Markdown do checkpoint: card, branch, `status --short` (≤ 40) e últimas linhas (≤ 60), tudo redigido pelo scrubber, ≤ 16 KB. */
export function montarCheckpoint(e: EntradaCheckpoint, scrub: Scrub = identidade): string {
  const status = e.status_curto.map(limpaLinha).filter((l) => l !== "");
  const tela = e.ultimas_linhas.slice(-MAX_LINHAS_TELA).map(limpaLinha);
  while (tela.length > 0 && tela[tela.length - 1] === "") tela.pop();
  const partes: string[] = ["# Checkpoint do turno", ""];
  partes.push(`- Card: ${e.task_ref === null ? "(sem card)" : e.task_ref}${e.titulo === null || e.titulo === "" ? "" : ` — ${limpaLinha(e.titulo)}`}`);
  partes.push(`- Branch: ${e.branch === null || e.branch === "" ? "(desconhecida)" : limpaLinha(e.branch)}`);
  partes.push(`- Registrado em: ${e.em}`, "");
  const mostradas = status.slice(0, MAX_LINHAS_STATUS);
  partes.push(`## Alterações no worktree (git status --short${status.length > mostradas.length ? `, ${mostradas.length} de ${status.length}` : ""})`, "");
  partes.push("```", ...(mostradas.length === 0 ? ["(sem alterações)"] : mostradas), "```", "");
  partes.push(`## Fim da tela (últimas ${tela.length} linhas)`, "", "```", ...(tela.length === 0 ? ["(vazia)"] : tela), "```", "");
  return cortarEmBytes(scrub(partes.join("\n")), TETO_BYTES_CHECKPOINT);
}

export interface EntradaBrief {
  /** de onde veio e para onde vai (sem segredo; rótulos, nunca chaves). */
  de: { provedor: string; modelo: string | null; conta: string };
  para: { provedor: string; modelo: string | null; conta: string };
  /** frase curta do motivo + consumo (vem do recibo da troca, já sem segredo). */
  recibo: string;
  card: { task_ref: string; titulo: string; briefing_path: string | null } | null;
  /** o último checkpoint gravado (markdown); `null` se não houve. */
  checkpoint: string | null;
  /** instante ISO do brief. */
  em: string;
}

/** Instrução curta (cabe em argv) que manda o novo Pane ler o brief. */
export function instrucaoDeRetomada(caminhoRelativo: string): string {
  return `Você assume um trabalho em andamento por troca de conta. Leia ${caminhoRelativo} e retome de onde parou; o histórico da conversa anterior não foi preservado.`;
}

/** Brief de retomada: contrato do card + último checkpoint + instrução. ≤ 16 KB, redigido pelo scrubber. */
export function montarBrief(e: EntradaBrief, scrub: Scrub = identidade): string {
  const lado = (l: EntradaBrief["de"]): string => `${limpaLinha(l.provedor)}/${l.modelo === null ? "padrão" : limpaLinha(l.modelo)} (${limpaLinha(l.conta)})`;
  const p: string[] = ["# Brief de retomada", ""];
  p.push(`Troca de ${lado(e.de)} para ${lado(e.para)}.`);
  p.push(limpaLinha(e.recibo), "");
  p.push("**Atenção:** o raciocínio da sessão anterior não foi preservado. Só valem o card, o checkpoint abaixo e o que está no worktree. Confira o estado real (`git status`, testes) antes de continuar e não refaça o que já está pronto.", "");
  if (e.card !== null) {
    p.push("## Card", "", `- ${e.card.task_ref} — ${limpaLinha(e.card.titulo)}`);
    if (e.card.briefing_path !== null) p.push(`- Briefing original: ${limpaLinha(e.card.briefing_path)}`);
    p.push("");
  }
  p.push("## Último checkpoint", "");
  p.push(e.checkpoint === null || e.checkpoint.trim() === "" ? "(nenhum checkpoint gravado: confira o worktree)" : e.checkpoint.trim().replace(/^# Checkpoint do turno\n*/u, ""), "");
  p.push("## O que fazer agora", "", "1. Releia o card e o checkpoint.", "2. Confira o worktree e os testes.", "3. Continue a partir daí e entregue pelo fluxo normal (handoff).", `4. Brief gerado em ${e.em}.`, "");
  return cortarEmBytes(scrub(p.join("\n")), TETO_BYTES_CHECKPOINT);
}

/** Porta do brief: a fase 8 (memória) trocará a implementação sem mudar quem chama. */
export interface ProvedorDeBrief {
  gerar(pedido: { pane_id: string; recibo: string; de: EntradaBrief["de"]; para: EntradaBrief["para"] }): Promise<{ caminho_relativo: string }>;
}

// ---------------------------------------------------------------- checkpoint por turno
export interface PortasCheckpoint {
  agora(): number;
  /** Lê o mundo do Pane (card, branch, status, tela). `null` = Pane sem o que registrar (fora de Missão, encerrado). */
  coletar(paneId: string): Promise<EntradaCheckpoint | null>;
  /** Grava (sobrescreve) o checkpoint já redigido. */
  gravar(paneId: string, texto: string): Promise<void>;
  /** Prepara e devolve o scrubber do cofre (identidade se não há cofre). */
  scrub(): Promise<Scrub>;
  intervaloMs?: number;
}
export type ResultadoCheckpoint = "gravado" | "limitado" | "vazio" | "falhou";
export interface Checkpointer {
  /** Chamado ao fim de cada turno (estado → pronto). Nunca lança. */
  aoFimDoTurno(paneId: string): Promise<ResultadoCheckpoint>;
  liberar(paneId: string): void;
}

export function criarCheckpointer(p: PortasCheckpoint): Checkpointer {
  const intervalo = p.intervaloMs ?? INTERVALO_CHECKPOINT_MS;
  const ultimo = new Map<string, number>();
  const emVoo = new Set<string>();
  return {
    async aoFimDoTurno(paneId) {
      const t = p.agora();
      const anterior = ultimo.get(paneId);
      if (emVoo.has(paneId) || (anterior !== undefined && t - anterior < intervalo)) return "limitado";
      emVoo.add(paneId);
      ultimo.set(paneId, t);
      try {
        const entrada = await p.coletar(paneId);
        if (entrada === null) return "vazio";
        const scrub = await p.scrub();
        await p.gravar(paneId, montarCheckpoint(entrada, scrub));
        return "gravado";
      } catch {
        return "falhou";
      } finally {
        emVoo.delete(paneId);
      }
    },
    liberar(paneId) {
      ultimo.delete(paneId);
      emVoo.delete(paneId);
    },
  };
}

/** Caminhos relativos à raiz da árvore (sempre `/`): `<pasta do produto>/missoes/<missao>/{checkpoints,briefs}/<pane>.md` (a pasta vem de `PRODUTO.pastaNoProjeto`, nunca literal). */
export const nomeSeguro = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_");
