// Política de ENTRADA (T-20.28, PURA, sem I/O): decide onde um plano remoto pode ser aprovado — `telegram`, `desktop` ou `bloqueado`.
// Nada destrutivo/humano por este canal (D-21): assinatura do prodx, aprovação de raio ALTO, `mergex-revisar`, merge, push forçado, descartar/apagar,
// `encerrar_pane`/`abortar_missao` não existem aqui. Porta ausente/que lança => exige desktop (falha segura).
import { ACOES_REMOTAS, type ModoWorkspaceTelegram, type PlanoRemoto } from "../../compartilhado/alertas";
import type { PortaRigidez } from "./portas-entrada";

export type Classe = "leitura" | "escrita_leve" | "escrita" | "proibida";
export type PermitidoEm = "telegram" | "desktop" | "bloqueado";

export interface ContextoPolitica {
  modo: ModoWorkspaceTelegram;
  /** padrão 3: rigidez acima disso só no desktop. */
  rigidez_max_remota?: number;
  rigidez?: PortaRigidez | null;
  mission_id?: string;
}
export interface DecisaoPolitica {
  permitido: PermitidoEm;
  motivo: string;
}

/** classe de cada comando do chat. `proibida` = nunca por aqui. */
export const CLASSE_DO_COMANDO: Readonly<Record<string, Classe>> = {
  start: "leitura",
  ajuda: "leitura",
  status: "leitura",
  tarefas: "leitura",
  atrasadas: "leitura",
  missoes: "leitura",
  consumo: "leitura",
  aprovacoes: "leitura",
  ws: "escrita_leve",
  silenciar: "escrita_leve",
  cancelar: "escrita_leve",
  pedir: "escrita",
  aprovar: "escrita",
  parar: "escrita_leve", // pânico: desliga; só o desktop religa
};

/** gestos que este canal NUNCA executa, em nenhum modo (item 11 do plano). */
export const GESTOS_PROIBIDOS: readonly string[] = [
  "assinar_prodx",
  "aprovar_raio_alto",
  "mergex_revisar",
  "merge",
  "push_forcado",
  "descartar_ou_apagar",
  "encerrar_pane",
  "abortar_missao",
  "instalar_mcp_ou_skill",
  "alterar_rigidez_ou_permissao",
  "ler_arquivo_arbitrario",
  "responder_com_conteudo_de_arquivo_ou_terminal",
];

export const classeDoComando = (cmd: string): Classe => CLASSE_DO_COMANDO[cmd] ?? "proibida";

const sem = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DESTRUIR = "(?:apag\\w*|delet\\w*|exclu\\w*|remov\\w*|destru\\w*|zer(?:ar|e)|limp(?:ar|e)|drop\\w*|wipe\\w*|rm\\s+-[a-z]*r[a-z]*f?)";
const ALVO = "(?:repositorio|repo\\b|branch|banco|database|base de dados|tabela|pasta|diretorio|arquivos?|tudo|worktree|projeto|producao|prod\\b|workspace|historico|commits?|pane|missao)";
const ARQUIVO_SECRETO = "(?:\\.en" + "v\\b|senha|segredo|token|chave|credencia\\w+|id_rsa|\\/etc\\/)";
const PADROES_PROIBIDOS: Array<{ gesto: string; re: RegExp }> = [
  { gesto: "descartar_ou_apagar", re: new RegExp(`\\b${DESTRUIR}\\b[^.\\n]{0,60}\\b${ALVO}`) },
  { gesto: "descartar_ou_apagar", re: /\b(?:git\s+clean|reset\s+--hard|rm\s+-rf|drop\s+(?:table|database)|truncate\s+table)\b/ },
  { gesto: "descartar_ou_apagar", re: /\bdescart\w*\b/ },
  { gesto: "push_forcado", re: /\b(?:push\s*(?:-f\b|--force)|force[- ]?push|push\s+forcado|push\s+forc\w*)/ },
  { gesto: "merge", re: /\b(?:merge|mergear|mesclar|squash)\b/ },
  { gesto: "assinar_prodx", re: /\b(?:assin\w+)\b[^.\n]{0,40}\bprodx\b|\bprodx\b[^.\n]{0,40}\bassin\w+/ },
  { gesto: "aprovar_raio_alto", re: /\baprov\w*\b[^.\n]{0,40}\braio\s+alto\b|\braio\s+alto\b[^.\n]{0,40}\baprov\w*/ },
  { gesto: "mergex_revisar", re: /\bmergex[- ]?revisar\b/ },
  { gesto: "encerrar_pane", re: /\b(?:encerr\w+|mat(?:ar|e)|fech(?:ar|e))\b[^.\n]{0,30}\b(?:pane|terminal)\b/ },
  { gesto: "abortar_missao", re: /\b(?:abort\w+|cancel\w+)\b[^.\n]{0,30}\bmissao\b/ },
  { gesto: "instalar_mcp_ou_skill", re: /\binstal\w+\b[^.\n]{0,40}\b(?:mcp|skill|plugin|hook)\b/ },
  { gesto: "alterar_rigidez_ou_permissao", re: /\b(?:alter\w+|mud\w+|troc\w+|ajust\w+)\b[^.\n]{0,40}\b(?:rigidez|permiss\w+|bypass|modo automatico)\b/ },
  { gesto: "ler_arquivo_arbitrario", re: new RegExp(`\\b(?:mostr\\w+|envi\\w+|cole|mand\\w*|exib\\w+|leia|ler|cat)\\b[^.\\n]{0,50}${ARQUIVO_SECRETO}`) },
];

/**
 * Pré-filtro determinístico do TEXTO (antes de qualquer orquestrador): pedido que contém gesto proibido vira
 * `bloqueado: só no desktop`. É deliberadamente conservador (falso positivo = "faça no desktop"; nunca o contrário).
 */
export function gestoProibidoNoTexto(texto: string): string | null {
  const t = sem(texto).slice(0, 2000);
  for (const { gesto, re } of PADROES_PROIBIDOS) if (re.test(t)) return gesto;
  return null;
}

const acoesFora = (p: PlanoRemoto): string | null => p.acoes.find((a) => !(ACOES_REMOTAS as readonly string[]).includes(a)) ?? null;

export function avaliarPlano(plano: PlanoRemoto, ctx: ContextoPolitica): DecisaoPolitica {
  if (ctx.modo === "consulta") return { permitido: "bloqueado", motivo: "workspace_somente_consulta" };
  const fora = acoesFora(plano);
  if (fora !== null) return { permitido: "bloqueado", motivo: `acao_fora_da_lista:${fora}` };
  if (plano.acao_humana === true) return { permitido: "bloqueado", motivo: "acao_humana_so_no_desktop" };
  const max = ctx.rigidez_max_remota ?? 3;
  if (plano.rigidez > max) return { permitido: "desktop", motivo: `rigidez_${plano.rigidez}_exige_desktop` };
  if (plano.raio === "ALTO") return { permitido: "desktop", motivo: "raio_alto_exige_desktop" };
  if (plano.raio === "desconhecido") return { permitido: "desktop", motivo: "raio_desconhecido_exige_desktop" };
  if (plano.branch_protegida) return { permitido: "desktop", motivo: "branch_protegida_exige_desktop" };
  if (plano.destrutivo) return { permitido: "desktop", motivo: "destrutivo_exige_desktop" };
  if (plano.workspace_automatico === true && ctx.modo !== "direto") return { permitido: "desktop", motivo: "workspace_automatico_exige_desktop" };
  if (plano.paineis_estimados > 3) return { permitido: "desktop", motivo: "muitos_paineis_exige_desktop" };
  // rigidez do workspace/Missão (F16): porta ausente, que lança ou que responde "exige" => desktop (falha segura)
  if (ctx.rigidez === undefined || ctx.rigidez === null) return { permitido: "desktop", motivo: "porta_de_rigidez_ausente" };
  try {
    const r = ctx.rigidez.exigeDesktop({ workspace_id: plano.workspace_id ?? plano.workspace, ...(ctx.mission_id === undefined ? {} : { mission_id: ctx.mission_id }), plano });
    if (r.exige) return { permitido: "desktop", motivo: r.motivo === "" ? "rigidez_exige_desktop" : r.motivo };
  } catch {
    return { permitido: "desktop", motivo: "porta_de_rigidez_falhou" };
  }
  return { permitido: "telegram", motivo: "ok" };
}

/** `direto` só quando TODAS as condições valem (item 10); qualquer falha cai para `aprovar`. */
export function podeExecutarDireto(plano: PlanoRemoto, ctx: ContextoPolitica): boolean {
  return ctx.modo === "direto" && avaliarPlano(plano, ctx).permitido === "telegram" && plano.rigidez <= 3 && plano.raio === "BAIXO" && !plano.destrutivo && !plano.branch_protegida && plano.paineis_estimados <= 2 && plano.acao_humana !== true;
}
