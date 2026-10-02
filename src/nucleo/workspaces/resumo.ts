// Núcleo puro do painel de workspaces (D-450…): agrega sessões, Panes e Missões de TODOS os workspaces numa visão somente leitura.
// Sem Electron, sem disco, sem relógio próprio: tudo entra por parâmetro, então é testável e barato.
import type { AtividadeTerminal, FerramentaId, MetadadosSessao } from "../../compartilhado/terminais";
import type { AgenteResumo, ContagensWorkspace, EstadoAgenteResumo, ExecucaoResumo, ItemWorkspaceResumo, MissaoResumo, ResumoWorkspaces } from "../../compartilhado/workspaces-resumo";
import { VERSAO_RESUMO_WORKSPACES } from "../../compartilhado/workspaces-resumo";
import { missaoTerminal, type Mission, type Pane } from "../dominio";

export const TAMANHO_LINHA = 80;

/** Pasta pessoal → `~`, separadores `/`. Só prefixo de pasta inteira (nunca `/Users/analu` por `/Users/ana`). */
export function mascararCaminho(raiz: string, home: string): string {
  const r = raiz.replace(/\\/g, "/");
  const h = home.replace(/\\/g, "/").replace(/\/+$/, "");
  if (h.length === 0) return r;
  if (r === h) return "~";
  return r.startsWith(`${h}/`) ? `~${r.slice(h.length)}` : r;
}

// eslint-disable-next-line no-control-regex
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// eslint-disable-next-line no-control-regex
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESC_OUTROS = /\u001b[@-Z\\-_]|\u001b[()][A-Za-z0-9]/g;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const MOLDURA = /^[\s─-╿▀-▟▌▐░▒▓>$#%*•·…\-_=+|~`'".,:;!?()[\]{}\\/<]*$/u;
/** Sequências longas sem espaço que parecem credencial (token, chave, hash): nunca vão para a tela. */
const PARECE_SEGREDO = /[A-Za-z0-9_\-./+=]{24,}/g;
const BEARER = /\b(Bearer|Basic|Token)\s+\S+/gi;
const ATRIBUICAO = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|SENHA|PASS)[A-Za-z0-9_]*)\s*[=:]\s*\S+/gi;

const cortar = (t: string, max: number): string => {
  const pontos = [...t];
  return pontos.length <= max ? t : `${pontos.slice(0, max - 1).join("").trimEnd()}…`;
};

/**
 * "O que o agente faz agora" a partir do fim da saída do terminal: limpa de ANSI/OSC/controle, escolhe a última linha com conteúdo
 * (descarta moldura de TUI), redige credenciais (scrubber do cofre + padrões de token) e trunca em ~80. Falha do scrubber = nada
 * (nunca a linha crua). `null` quando não há nada legível.
 */
export function limparLinhaSaida(dados: string, scrub?: (texto: string) => string): string | null {
  const limpo = dados.replace(OSC, "").replace(CSI, "").replace(ESC_OUTROS, "").replace(/\r(?!\n)/g, "\n").replace(CONTROLE, "");
  const linhas = limpo.split(/\r?\n/);
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    const base = (linhas[i] ?? "").replace(/\s+/g, " ").trim();
    if (base.length < 3 || MOLDURA.test(base) || !/[\p{L}\p{N}]{2,}/u.test(base)) continue;
    let texto = base;
    if (scrub !== undefined) {
      try { texto = scrub(texto); } catch { return null; }
    }
    texto = texto.replace(BEARER, "$1 ***").replace(ATRIBUICAO, "$1=***").replace(PARECE_SEGREDO, "***");
    return cortar(texto, TAMANHO_LINHA);
  }
  return null;
}

export interface TempoSessao {
  atividade: AtividadeTerminal | null;
  atividade_em: number | null;
  linha: string | null;
  subagentes: { total: number; ativos: number } | null;
}

export interface EstadoExecucaoMinimo {
  workspace_id: string;
  fase: string;
  nome: string | null;
  porta: number | null;
  sessao_id: string | null;
  iniciado_em: number | null;
}

export interface WorkspaceMinimoResumo { id: string; nome: string; raiz: string }

export interface EntradaResumo {
  workspaces: readonly WorkspaceMinimoResumo[];
  atualId: string | null;
  home: string;
  sessoes: readonly MetadadosSessao[];
  panes: readonly Pane[];
  missoes: readonly Mission[];
  execucoes: readonly EstadoExecucaoMinimo[];
  ramos: Readonly<Record<string, string | null>>;
  sujos: Readonly<Record<string, boolean>>;
  tempo: Readonly<Record<string, TempoSessao>>;
  nomeFerramenta: (id: string) => string;
  agora: number;
}

/** Fases em que a execução do projeto ainda ocupa um processo (ou acabou de falhar e a pessoa precisa ver). */
const FASES_VISIVEIS = new Set(["preparando", "rodando", "parando", "falhou"]);
const ROTULO_PAPEL: Record<string, string> = { piloto: "piloto", executor: "executor", explorador: "explorador", revisor: "revisor" };

function estadoDoAgente(s: MetadadosSessao, t: TempoSessao | undefined): EstadoAgenteResumo {
  if (s.estado === "erro") return "erro";
  if (s.estado === "iniciando") return "iniciando";
  return t?.atividade ?? "ocioso";
}

const tempoEm = (iso: string): number | null => {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
};

export function agregarResumo(e: EntradaResumo): ResumoWorkspaces {
  const conhecidos = new Set(e.workspaces.map((w) => w.id));
  const paneDaSessao = new Map<string, Pane>();
  for (const p of e.panes) if (p.estado !== "encerrado" && p.sessao_pty_id !== null) paneDaSessao.set(p.sessao_pty_id, p);
  const sessaoDoPane = new Map<string, string>();
  for (const [sid, p] of paneDaSessao) sessaoDoPane.set(p.id, sid);
  const sessaoDeExecucao = new Set<string>();
  for (const x of e.execucoes) if (x.sessao_id !== null && FASES_VISIVEIS.has(x.fase)) sessaoDeExecucao.add(x.sessao_id);

  const itens: ItemWorkspaceResumo[] = e.workspaces.map((w) => {
    const ativas = e.missoes.filter((m) => m.workspace_id === w.id && !missaoTerminal(m.estado));
    const m0 = ativas[0];
    const missao: MissaoResumo | null = m0 === undefined ? null : {
      id: m0.id, titulo: m0.titulo, modo: m0.modo, estado: m0.estado,
      piloto_sessao_id: m0.piloto_pane_id === null ? null : (sessaoDoPane.get(m0.piloto_pane_id) ?? null),
    };
    const exec = e.execucoes.find((x) => x.workspace_id === w.id && FASES_VISIVEIS.has(x.fase));
    const execucao: ExecucaoResumo | null = exec === undefined ? null : { fase: exec.fase, nome: exec.nome, porta: exec.porta, sessao_id: exec.sessao_id, iniciado_em: exec.iniciado_em };
    return {
      id: w.id, nome: w.nome, pasta_mascarada: mascararCaminho(w.raiz, e.home), branch: e.ramos[w.id] ?? null, sujo: e.sujos[w.id] ?? null,
      atual: w.id === e.atualId, missao, missoes_ativas: Math.max(0, ativas.length - 1), agentes: [], execucao,
      contagens: { agentes: 0, trabalhando: 0, aguardando: 0, erro: 0, subagentes: 0, terminais: 0 },
    };
  });
  const porId = new Map(itens.map((i) => [i.id, i]));
  const brutos = new Map<string, Array<{ s: MetadadosSessao; p: Pane | undefined }>>();

  for (const s of e.sessoes) {
    if (s.estado === "encerrada" || sessaoDeExecucao.has(s.sessao_id)) continue;
    const p = paneDaSessao.get(s.sessao_id);
    const wsId = p?.workspace_id ?? s.workspace_id ?? e.atualId;
    if (wsId === null || !conhecidos.has(wsId)) continue;
    const lista = brutos.get(wsId) ?? [];
    lista.push({ s, p });
    brutos.set(wsId, lista);
  }

  for (const [wsId, lista] of brutos) {
    const item = porId.get(wsId);
    if (item === undefined) continue;
    const c: ContagensWorkspace = item.contagens;
    const agentes: AgenteResumo[] = [];
    for (const { s, p } of lista) {
      if (s.ferramenta_id === "terminal" && p === undefined) { c.terminais += 1; continue; }
      const t = e.tempo[s.sessao_id];
      const nome = e.nomeFerramenta(s.ferramenta_id);
      const papel = p === undefined || p.papel === "nenhum" ? null : (ROTULO_PAPEL[p.papel] ?? p.papel);
      const titulo = p === undefined ? nome : `${nome} · ${papel === null ? `#${p.display_id}` : `${papel}${p.eh_piloto ? "" : ` #${p.display_id}`}`}`;
      const mis = p?.mission_id === null || p === undefined ? undefined : e.missoes.find((m) => m.id === p.mission_id);
      const pilotoSessao = mis?.piloto_pane_id == null ? null : (sessaoDoPane.get(mis.piloto_pane_id) ?? null);
      const piloto = p?.eh_piloto === true;
      const pai = !piloto && pilotoSessao !== null && pilotoSessao !== s.sessao_id ? pilotoSessao : null;
      agentes.push({
        sessao_id: s.sessao_id, pane_id: p?.id ?? null, mission_id: p?.mission_id ?? null, pai_sessao_id: pai, profundidade: pai === null ? 0 : 1,
        ferramenta_id: s.ferramenta_id as FerramentaId, titulo, papel, piloto, estado: estadoDoAgente(s, t), sessao_estado: s.estado,
        atividade: t?.atividade ?? null, desde: tempoEm(s.criada_em), atividade_em: t?.atividade_em ?? null, linha: t?.linha ?? null, subagentes: t?.subagentes ?? null,
      });
    }
    // sem Pane, nomes repetidos ganham número para o dono distinguir ("Claude Code #2")
    const repetidos = new Map<string, number>();
    for (const a of agentes) if (a.pane_id === null) repetidos.set(a.titulo, (repetidos.get(a.titulo) ?? 0) + 1);
    const vistos = new Map<string, number>();
    for (const a of agentes) {
      if (a.pane_id !== null || (repetidos.get(a.titulo) ?? 0) < 2) continue;
      const n = (vistos.get(a.titulo) ?? 0) + 1;
      vistos.set(a.titulo, n);
      a.titulo = `${a.titulo} #${n}`;
    }
    // pai antes dos filhos (ordem estável das raízes)
    const ids = new Set(agentes.map((a) => a.sessao_id));
    const raizes = agentes.filter((a) => a.pai_sessao_id === null || !ids.has(a.pai_sessao_id));
    const ordenados: AgenteResumo[] = [];
    for (const r of raizes) {
      ordenados.push(r);
      for (const f of agentes) if (f.pai_sessao_id === r.sessao_id && f !== r) ordenados.push(f);
    }
    for (const a of ordenados) if (a.pai_sessao_id !== null && !ids.has(a.pai_sessao_id)) { a.pai_sessao_id = null; a.profundidade = 0; }
    item.agentes = ordenados;
    c.agentes = ordenados.length;
    c.trabalhando = ordenados.filter((a) => a.estado === "trabalhando").length;
    c.aguardando = ordenados.filter((a) => a.estado === "aguardando").length;
    c.erro = ordenados.filter((a) => a.estado === "erro").length;
    c.subagentes = ordenados.reduce((n, a) => n + (a.subagentes?.ativos ?? 0), 0);
  }
  return { versao: VERSAO_RESUMO_WORKSPACES, gerado_em: e.agora, itens };
}
