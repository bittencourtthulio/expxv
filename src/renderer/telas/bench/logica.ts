// Lógica PURA da tela Bench (sem React): formatação ("custo desconhecido" nunca vira 0), grade, resumo da estimativa, barras do SVG de comparação e o rascunho → política do harness.
import type { PoliticaEntrada } from "../../../compartilhado/harness";
import type { AgregadoAlvo, Comparacao, Estimativa, EstadoResultado, ModoSandbox, RascunhoPolitica, ResumoResultado, SeloComparacao } from "../../../compartilhado/bench";

export interface VisualEstado { glifo: string; rotulo: string; tom: "neutro" | "ok" | "erro" | "aviso" }
/** O estado é dito por FORMA (glifo) e por texto, nunca só por cor. */
export const VISUAL_ESTADO: Readonly<Record<EstadoResultado, VisualEstado>> = {
  enfileirado: { glifo: "◌", rotulo: "na fila", tom: "neutro" },
  executando: { glifo: "▶", rotulo: "executando", tom: "aviso" },
  concluido: { glifo: "✓", rotulo: "concluído", tom: "ok" },
  falhou: { glifo: "✕", rotulo: "falhou", tom: "erro" },
  tempo_esgotado: { glifo: "◷", rotulo: "tempo esgotado", tom: "erro" },
  cancelado: { glifo: "■", rotulo: "cancelado", tom: "neutro" },
  interrompido: { glifo: "!", rotulo: "interrompido", tom: "aviso" },
  substituido: { glifo: "↻", rotulo: "substituído", tom: "neutro" },
};

const num = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Curto, para a célula: `?` quando desconhecido (nunca "0"). */
export function custoCurto(usd: number | null): string {
  return usd === null ? "?" : `US$ ${usd < 0.1 && usd > 0 ? num4.format(usd) : num.format(usd)}`;
}
/** Por extenso, para leitor de tela e tooltip. */
export function custoTexto(usd: number | null): string {
  return usd === null ? "custo desconhecido" : custoCurto(usd);
}
export function duracaoTexto(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${num1.format(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, "0")} s`;
}
export const notaTexto = (q: number | null): string => (q === null ? "sem nota" : num1.format(q));
export const scoreTexto = (c: number | null): string => (c === null ? "—" : num1.format(c));

export function rotuloCelula(tarefa: string, alvo: string, r: ResumoResultado | null): string {
  if (r === null) return `${tarefa} em ${alvo}: sem execução`;
  const v = VISUAL_ESTADO[r.estado];
  return `${tarefa} em ${alvo}: ${v.rotulo}, ${duracaoTexto(r.duracao_s)}, ${custoTexto(r.custo_usd)}, ${r.qualidade === null ? "sem nota" : `nota ${notaTexto(r.qualidade)}`}${r.aviso === null ? "" : `. Aviso: ${r.aviso}`}`;
}

export interface LinhaGrade { tarefa: string; celulas: Array<{ alvo: string; resultado: ResumoResultado | null }> }
/** Grade tarefa × alvo a partir dos resultados vigentes. */
export function construirGrade(resultados: readonly ResumoResultado[], tarefas: readonly string[], alvos: readonly string[]): LinhaGrade[] {
  const idx = new Map<string, ResumoResultado>();
  for (const r of resultados) if (r.estado !== "substituido") idx.set(`${r.tarefa}\u0000${r.alvo}`, r);
  return tarefas.map((t) => ({ tarefa: t, celulas: alvos.map((a) => ({ alvo: a, resultado: idx.get(`${t}\u0000${a}`) ?? null })) }));
}

export const LIMITE_VIRTUALIZAR = 100;
export const deveVirtualizar = (linhas: number): boolean => linhas > LIMITE_VIRTUALIZAR;

export function contadorTexto(concluidos: number, total: number, custo: number | null): string {
  return `${concluidos}/${total} · ${custo === null ? "custo ?" : custoCurto(custo)}`;
}

export function textoSandbox(m: Estimativa["sandbox"]): string {
  const t: Record<ModoSandbox | "indisponivel", string> = {
    macos: "Sandbox do macOS ativo: escrita só na pasta da execução; credenciais fora de alcance.",
    nativo_cli: "Sandbox da própria CLI (Codex, modo workspace-write).",
    nenhum: "Sem sandbox neste sistema: o código gerado roda sem isolamento. Exige a frase reforçada.",
    indisponivel: "Sandbox indisponível: não posso rodar. O Bench recusa executar código gerado por IA sem isolamento.",
  };
  return t[m];
}

export function textoCustoEstimado(e: Estimativa): string {
  if (e.custo_min_usd === null || e.custo_max_usd === null) return `custo desconhecido${e.alvos_sem_custo > 0 ? ` para ${e.alvos_sem_custo} alvo(s)` : ""}`;
  const faixa = e.custo_min_usd === e.custo_max_usd ? custoCurto(e.custo_min_usd) : `${custoCurto(e.custo_min_usd)} – ${custoCurto(e.custo_max_usd).replace("US$ ", "")}`;
  return e.alvos_sem_custo > 0 ? `${faixa} (+ custo desconhecido para ${e.alvos_sem_custo} alvo(s))` : faixa;
}

export const ROTULO_ACAO: Readonly<Record<"rodar" | "rerodar" | "julgar", string>> = { rodar: "Rodar", rerodar: "Re-rodar", julgar: "Julgar" };

export const SELO_TEXTO: Readonly<Record<SeloComparacao, string>> = {
  sem_custo: "sem custo",
  nao_comparavel: "score não comparável",
  harness_parcial: "harness parcial",
  versoes_diferentes: "versões diferentes da tarefa",
};

export interface BarraSvg { alvo: string; valor: number | null; largura: number; vitorias: number }
/** Barras horizontais do composite médio por alvo (0–100). Sem biblioteca: o SVG é montado no componente. */
export function barrasDeComposite(agregado: readonly AgregadoAlvo[], larguraMax = 100): BarraSvg[] {
  const maior = Math.max(1, ...agregado.map((a) => a.composite_medio ?? 0));
  return agregado.map((a) => ({ alvo: a.alvo, valor: a.composite_medio, largura: a.composite_medio === null ? 0 : Math.max(1, Math.round((a.composite_medio / maior) * larguraMax)), vitorias: a.vitorias }));
}

export function placarTexto(c: Comparacao): string {
  const partes = c.agregado.map((a) => `${a.alvo} ${a.vitorias}`);
  return `${partes.join(" · ")}${c.placar.empates > 0 ? ` · ${c.placar.empates} empate(s)` : ""}`;
}

/** Rascunho do Bench → entrada da política do harness (global). `fallback` nunca vazio: alternativas, ou o próprio executor. NADA é gravado aqui. */
export function politicaDoRascunho(r: RascunhoPolitica): PoliticaEntrada {
  const alternativas = r.alternativas.map((a) => ({ ...a }));
  return {
    workspace_id: null, task_type: r.task_type, executor: { ...r.executor }, alternativas,
    fallback: alternativas.length > 0 ? alternativas.map((a) => ({ ...a })) : [{ ...r.executor }],
    skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true,
  };
}

export const textoExecutor = (e: { provider: string; model: string | null; effort: string | null }): string => `${e.provider}/${e.model ?? "padrão"}${e.effort === null ? "" : ` · ${e.effort}`}`;

/** Esforços por CLI (espelha os adaptadores; o serviço valida de novo). */
export const ESFORCOS_POR_CLI: Readonly<Record<"claude" | "codex", readonly string[]>> = { claude: ["low", "medium", "high", "xhigh", "max"], codex: ["minimal", "low", "medium", "high"] };

/** Junta páginas de log sem ultrapassar o teto em memória (mantém o FIM). */
export const TETO_LOG_MEMORIA = 2 * 1024 * 1024;
export function anexarLog(atual: string, pagina: string): string {
  const t = atual + pagina;
  return t.length > TETO_LOG_MEMORIA ? t.slice(t.length - TETO_LOG_MEMORIA) : t;
}
