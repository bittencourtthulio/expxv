// Templates editáveis (T-20.12): `{{campo}}` ou `{{campo|formatador|ou:"—"}}` — Mustache SEM lógica: sem expressões, laços nem código.
// Lista branca de campos por tipo e de formatadores; campo/formatador desconhecido é erro DE VALIDAÇÃO (ao salvar), nunca de runtime.
// Cada VALOR é redigido e escapado pelo canal; o TEMPLATE é confiável (vem do app/do usuário).
import type { DadosAlerta, NivelTemplate, TipoAlerta, TipoCanal } from "../../compartilhado/alertas";
import { CATALOGO } from "./catalogo";
import { corpoPadrao } from "./templates-padrao";
import { redigirParaCanal, truncarVisivel, contarVisiveis } from "./texto";

export const CORPO_MAX = 2000;
export const ALVO_PADRAO = 1500;
export const LIMITE_DURO_DIVIDIR = 3500;

const BASE = ["titulo", "rotulo", "contagem", "workspace", "severidade", "tipo"] as const;
const TAREFA = ["task_id", "missao", "tempo_trabalho", "decorrido", "tokens", "tokens_entrada", "tokens_saida", "usd", "story_points", "estimativa", "limite", "atraso", "status", "cli", "modelo", "motivo"] as const;
const PR = ["pr_numero", "link", "branch", "checks", "motivo"] as const;
const DIGEST = ["data", "concluidas_n", "pontos_concluidos", "tempo_trabalho", "tokens", "em_andamento_n", "atrasadas_n", "bloqueadas_n", "prs_n", "lista_atrasadas", "sprint_nome", "entregues_pts", "comprometido_pts", "velocidade", "retrabalho"] as const;
const EXTRAS: Partial<Record<TipoAlerta, readonly string[]>> = {
  pane_aguardando: ["cli", "missao", "espera", "pergunta"],
  pane_terminou: ["cli", "missao"],
  qa_aprovado: ["task_id", "missao", "achados", "rodada"],
  qa_reprovado: ["task_id", "missao", "achados", "rodada"],
  pr_aberto: PR,
  pr_mesclado: PR,
  checks_falhando: PR,
  cota_atingida: ["conta", "provedor", "pct", "zera_em"],
  limite_consumo: ["conta", "provedor", "pct", "zera_em"],
  conta_trocada: ["conta", "provedor", "para"],
  sprint_iniciada: ["sprint_nome", "capacidade_pts", "comprometido_pts"],
  sprint_fechada: ["sprint_nome", "entregues_pts", "comprometido_pts", "velocidade", "retrabalho"],
  sprint_em_risco: ["sprint_nome", "restante", "capacidade"],
  relatorio_pronto: ["tipo_relatorio", "formato", "caminho"],
  missao_concluida: [...TAREFA, "tarefas_feitas", "tarefas_total"],
  missao_falhou: [...TAREFA, "tarefas_feitas", "tarefas_total"],
  missao_aguardando_aprovacao: ["missao", "cli", "espera"],
  erro_sistema: ["componente", "codigo"],
  resumo_diario: DIGEST,
  resumo_sprint: DIGEST,
  agente_mensagem: ["detalhe", "task_id", "cli"],
  pedido_remoto: ["quem", "resumo", "plano"],
  plano_aguardando_aprovacao: ["quem", "resumo", "plano", "expira_em"],
  canal_erro: ["canal", "causa", "acao"],
};
for (const t of ["tarefa_iniciada", "tarefa_concluida", "tarefa_bloqueada", "tarefa_atrasada", "tarefa_tempo", "tarefa_tokens", "tarefa_story_points"] as const) EXTRAS[t] = TAREFA;

export const camposDoTipo = (tipo: TipoAlerta): ReadonlySet<string> => new Set<string>([...BASE, ...(EXTRAS[tipo] ?? [])]);

// ---- formatadores (lista branca) ----
export type Valor = string | number | boolean | null | undefined;
const nf = new Intl.NumberFormat("pt-BR");

export function duracao(ms: number): string {
  const neg = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  let t: string;
  if (s < 60) t = `${s} s`;
  else if (s < 3600) t = `${Math.round(s / 60)} min`;
  else {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    t = m === 60 ? `${h + 1} h 00` : `${h} h ${String(m).padStart(2, "0")}`;
  }
  return neg ? `-${t}` : t;
}

type Formatador = (v: Valor, arg: string | null) => Valor;
const num = (v: Valor): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
export const FORMATADORES: Readonly<Record<string, { arg: "nenhum" | "texto" | "inteiro"; f: Formatador }>> = {
  duracao: { arg: "nenhum", f: (v) => (num(v) === null ? null : duracao(num(v) as number)) },
  delta: { arg: "nenhum", f: (v) => (num(v) === null ? null : `${(num(v) as number) >= 0 ? "+" : ""}${duracao(num(v) as number)}`) },
  milhar: { arg: "nenhum", f: (v) => (num(v) === null ? null : nf.format(num(v) as number)) },
  pct: { arg: "nenhum", f: (v) => (num(v) === null ? null : `${Math.round(num(v) as number)}%`) },
  ou: { arg: "texto", f: (v, a) => (v === null || v === undefined || v === "" ? a : v) },
  truncar: { arg: "inteiro", f: (v, a) => (v === null || v === undefined ? null : truncarVisivel(String(v), Number(a))) },
};

const PADRAO_AUSENTE: Record<string, string> = {
  tokens: "sem fonte",
  tokens_entrada: "sem fonte",
  tokens_saida: "sem fonte",
  usd: "sem fonte",
  story_points: "sem estimativa",
  estimativa: "sem estimativa",
  limite: "sem estimativa",
  tempo_trabalho: "sem medição",
};

// ---- parser ----
interface Chamada {
  nome: string;
  arg: string | null;
}
type Parte = { t: "texto"; v: string } | { t: "campo"; campo: string; fs: Chamada[] };

const RE_CAMPO = /^[a-z][a-z0-9_]{0,40}$/;

export function analisar(corpo: string): { partes: Parte[]; erros: string[] } {
  const erros: string[] = [];
  const partes: Parte[] = [];
  let i = 0;
  while (i < corpo.length) {
    const ini = corpo.indexOf("{{", i);
    if (ini < 0) {
      partes.push({ t: "texto", v: corpo.slice(i) });
      break;
    }
    if (ini > i) partes.push({ t: "texto", v: corpo.slice(i, ini) });
    const fim = corpo.indexOf("}}", ini + 2);
    if (fim < 0) {
      erros.push("'{{' sem fechamento");
      break;
    }
    const interno = corpo.slice(ini + 2, fim);
    // separa por `|` respeitando aspas
    const segs: string[] = [];
    let atual = "";
    let aspas = false;
    for (const c of interno) {
      if (c === '"') aspas = !aspas;
      if (c === "|" && !aspas) {
        segs.push(atual);
        atual = "";
      } else atual += c;
    }
    segs.push(atual);
    const campo = (segs[0] ?? "").trim();
    if (!RE_CAMPO.test(campo)) erros.push(`campo inválido: ${truncarVisivel(campo, 30) || "(vazio)"}`);
    const fs: Chamada[] = [];
    for (const bruto of segs.slice(1)) {
      const m = /^\s*([a-z_]+)(?::(.*))?\s*$/s.exec(bruto);
      if (m === null) {
        erros.push(`formatador inválido: ${truncarVisivel(bruto.trim(), 30)}`);
        continue;
      }
      let arg: string | null = null;
      if (m[2] !== undefined) {
        const a = m[2].trim();
        const q = /^"((?:[^"\\]|\\.)*)"$/s.exec(a);
        arg = q !== null ? (q[1] as string).replace(/\\(.)/g, "$1") : a;
      }
      fs.push({ nome: m[1] as string, arg });
    }
    partes.push({ t: "campo", campo, fs });
    i = fim + 2;
  }
  return { partes, erros };
}

/** erros de validação (vazio = ok). Chamado ao SALVAR: nunca falha em runtime depois. */
export function validar(corpo: string, tipo: TipoAlerta): string[] {
  if (typeof corpo !== "string") return ["corpo inválido"];
  const erros: string[] = [];
  if (corpo.length > CORPO_MAX) erros.push(`corpo acima de ${CORPO_MAX} caracteres`);
  const { partes, erros: es } = analisar(corpo);
  erros.push(...es);
  const permitidos = camposDoTipo(tipo);
  for (const p of partes) {
    if (p.t !== "campo") continue;
    if (RE_CAMPO.test(p.campo) && !permitidos.has(p.campo)) erros.push(`campo desconhecido para ${tipo}: ${p.campo}`);
    for (const f of p.fs) {
      const def = FORMATADORES[f.nome];
      if (def === undefined) {
        erros.push(`formatador desconhecido: ${f.nome}`);
        continue;
      }
      if (def.arg === "nenhum" && f.arg !== null) erros.push(`formatador ${f.nome} não aceita argumento`);
      if (def.arg === "texto" && f.arg === null) erros.push(`formatador ${f.nome} exige argumento`);
      if (def.arg === "inteiro" && (f.arg === null || !/^\d{1,4}$/.test(f.arg) || Number(f.arg) < 1)) erros.push(`formatador ${f.nome} exige um inteiro positivo`);
    }
  }
  return erros;
}

export const escaparHtml = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface OpcoesRender {
  /** escape do VALOR para o canal (HTML no Telegram). Padrão: identidade. */
  escapar?: (v: string) => string;
  scrub?: (t: string) => string;
  /** só IDs: remove títulos, pergunta e texto de terceiro (P-75, AB-28). */
  ocultarTitulos?: boolean;
  /** corpo personalizado (template editado); senão o padrão embutido. */
  corpo?: string;
  /** campos extras além de `dados` (workspace, rotulo...). */
  extras?: Record<string, Valor>;
}

const CAMPOS_OCULTAVEIS = new Set(["titulo", "pergunta", "resumo", "detalhe", "lista_atrasadas", "motivo"]);

function valorDe(campo: string, dados: DadosAlerta, extras: Record<string, Valor>): Valor {
  switch (campo) {
    case "tempo_trabalho": return dados.tempo_trabalho_ms;
    case "decorrido": return dados.decorrido_ms;
    case "estimativa": return dados.estimativa_ms;
    case "limite": return dados.limite_ms;
    case "atraso": return dados.atraso_ms;
    case "espera": return dados.espera_ms;
    case "usd": return dados.usd_conhecido;
    default: return campo in extras ? extras[campo] : (dados[campo] as Valor);
  }
}

/** Renderiza um alerta. Devolve o texto final (já redigido) — para HTML, os VALORES saem escapados; as marcas do template permanecem. */
export function renderizar(tipo: TipoAlerta, canal_tipo: TipoCanal, nivel: NivelTemplate, dados: DadosAlerta, titulo: string, op: OpcoesRender = {}): { texto: string; tamanho_visivel: number; erros: string[] } {
  const corpo = op.corpo ?? corpoPadrao(tipo, canal_tipo, nivel);
  const erros = validar(corpo, tipo);
  if (erros.length > 0) return { texto: "", tamanho_visivel: 0, erros };
  const escapar = op.escapar ?? ((v: string): string => v);
  const extras: Record<string, Valor> = { titulo, rotulo: CATALOGO[tipo].rotulo, tipo, ...(op.extras ?? {}) };
  const { partes } = analisar(corpo);
  let saida = "";
  for (const p of partes) {
    if (p.t === "texto") {
      saida += p.v;
      continue;
    }
    let v: Valor = op.ocultarTitulos === true && CAMPOS_OCULTAVEIS.has(p.campo) ? null : valorDe(p.campo, dados, extras);
    for (const f of p.fs) v = (FORMATADORES[f.nome] as { f: Formatador }).f(v, f.arg);
    if (v === null || v === undefined || v === "") v = op.ocultarTitulos === true && CAMPOS_OCULTAVEIS.has(p.campo) ? "" : (PADRAO_AUSENTE[p.campo] ?? "—");
    const texto = typeof v === "string" ? redigirParaCanal(v, op.scrub === undefined ? {} : { scrub: op.scrub }) : String(v);
    saida += escapar(texto);
  }
  saida = saida.split("\n").map((l) => l.replace(/[ \t]+$/g, "").replace(/ {2,}/g, " ")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texto: saida, tamanho_visivel: contarVisiveis(saida), erros: [] };
}

/** Dados de exemplo para a prévia ao vivo (Modelos). */
export const DADOS_EXEMPLO: DadosAlerta = {
  task_id: "T-20.07", missao: "Corrigir o login", cli: "claude", modelo: "sonnet", status: "concluida", tempo_trabalho_ms: 4_320_000, decorrido_ms: 5_400_000, tokens: 182_340, tokens_entrada: 150_000, tokens_saida: 32_340,
  usd_conhecido: 1.84, story_points: 3, estimativa_ms: 3_600_000, limite_ms: 5_400_000, atraso_ms: 720_000, espera_ms: 780_000, pergunta: "Posso apagar o arquivo antigo?", pr_numero: 42, link: "https://exemplo.dev/pr/42",
  achados: 2, rodada: 1, branch: "feat/login", checks: "2 falhando", conta: "conta-a", provedor: "claude", pct: 92, zera_em: "18:00", para: "conta-b", motivo: "aguardando credencial",
  sprint_nome: "Sprint 7", capacidade_pts: 40, capacidade: 3_600_000, comprometido_pts: 34, entregues_pts: 29, velocidade: 31, retrabalho: "8%", restante: 7_200_000,
  tarefas_feitas: 4, tarefas_total: 5, tipo_relatorio: "técnico", formato: "HTML", caminho: "abrir no app", componente: "daemon", codigo: "falha_isolada",
  quem: "telegram:123", resumo: "corrige o bug do login", plano: "runx em 2 painéis", expira_em: "10 min", detalhe: "terminei a análise", canal: "Telegram", causa: "token inválido", acao: "Troque o token no assistente.",
  data: "01/10/2026", concluidas_n: 4, pontos_concluidos: 9, em_andamento_n: 2, atrasadas_n: 1, bloqueadas_n: 0, prs_n: 3, lista_atrasadas: "T-20.07 Corrigir bug — +37 min",
};

export function prever(tipo: TipoAlerta, canal_tipo: TipoCanal, nivel: NivelTemplate, corpo: string, escapar?: (v: string) => string): { texto: string; tamanho_visivel: number; erros: string[] } {
  return renderizar(tipo, canal_tipo, nivel, DADOS_EXEMPLO, "Corrigir bug do login <b>x</b>", { corpo, ...(escapar === undefined ? {} : { escapar }) });
}
