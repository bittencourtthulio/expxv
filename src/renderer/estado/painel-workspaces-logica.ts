// Lógica PURA do painel de workspaces (D-450…): preferências persistidas, ordenação, filtro, atenção, árvore de linhas, confirmação de
// terminar e formatação. Sem React, sem relógio próprio e sem API: tudo entra por parâmetro, então cada regra é testável isolada.
import type { AtividadeTerminal, EstadoSessao } from "../../compartilhado/terminais";
import type { AgenteResumo, EstadoAgenteResumo, ItemWorkspaceResumo } from "../../compartilhado/workspaces-resumo";

export const CHAVE_PAINEL_WORKSPACES = "casca.painel-workspaces.v1";
export const LARGURA_MIN = 200;
export const LARGURA_MAX = 360;
export const LARGURA_PADRAO = 264;
export const LARGURA_PASSO = 16;
/** Abaixo disto a casca (mínimo 720 px) não comporta o painel ao lado: vira sobreposição. */
export const LARGURA_JANELA_SOBREPOSICAO = 900;
export const LIMITE_AGENTES_VISIVEIS = 6;
export const DESFAZER_MS = 5_000;

export type ModoPainel = "detalhado" | "compacto";

export interface PrefsPainelWorkspaces {
  fixado: boolean;
  largura: number;
  /** ordem manual (ids); ids novos entram no fim. */
  ordem: string[];
  favoritos: string[];
  /** cards recolhidos (só a linha do workspace); o padrão é expandido. */
  recolhidos: string[];
  modo: ModoPainel;
}

export const PREFS_PADRAO_PAINEL: PrefsPainelWorkspaces = { fixado: false, largura: LARGURA_PADRAO, ordem: [], favoritos: [], recolhidos: [], modo: "detalhado" };

export const limitarLargura = (n: number): number => (Number.isFinite(n) ? Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(n))) : LARGURA_PADRAO);

const lista = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))].slice(0, max) : [];

/** Valida o que veio do storage (nunca confia no que leu). */
export function sanearPrefsPainel(bruto: unknown): PrefsPainelWorkspaces {
  if (typeof bruto !== "object" || bruto === null) return { ...PREFS_PADRAO_PAINEL };
  const o = bruto as Record<string, unknown>;
  return {
    fixado: o["fixado"] === true,
    largura: typeof o["largura"] === "number" ? limitarLargura(o["largura"]) : LARGURA_PADRAO,
    ordem: lista(o["ordem"]),
    favoritos: lista(o["favoritos"]),
    recolhidos: lista(o["recolhidos"]),
    modo: o["modo"] === "compacto" ? "compacto" : "detalhado",
  };
}

export interface ArmazemLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const armazemPadrao = (): ArmazemLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function lerPrefsPainel(armazem: ArmazemLike | null = armazemPadrao()): PrefsPainelWorkspaces {
  try {
    const t = armazem?.getItem(CHAVE_PAINEL_WORKSPACES);
    return t === null || t === undefined ? { ...PREFS_PADRAO_PAINEL } : sanearPrefsPainel(JSON.parse(t));
  } catch { return { ...PREFS_PADRAO_PAINEL }; }
}

export function gravarPrefsPainel(p: PrefsPainelWorkspaces, armazem: ArmazemLike | null = armazemPadrao()): void {
  try { armazem?.setItem(CHAVE_PAINEL_WORKSPACES, JSON.stringify(p)); } catch { /* sem storage: vale só nesta sessão */ }
}

// ---- ordenação, favoritos, filtro --------------------------------------------------------------------------------------

/** Favoritos primeiro; depois a ordem manual; o que não tem posição vai ao fim, por nome. Estável e sem mutar a entrada. */
export function ordenarItens<T extends { id: string; nome: string }>(itens: readonly T[], p: Pick<PrefsPainelWorkspaces, "ordem" | "favoritos">): T[] {
  const pos = new Map(p.ordem.map((id, i) => [id, i]));
  const fav = new Set(p.favoritos);
  const chave = (x: T): [number, number, string] => [fav.has(x.id) ? 0 : 1, pos.get(x.id) ?? Number.MAX_SAFE_INTEGER, x.nome.toLocaleLowerCase("pt-BR")];
  return [...itens].sort((a, b) => {
    const ka = chave(a);
    const kb = chave(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2], "pt-BR");
  });
}

/** Move `id` para a posição de `alvo` (antes dele) e devolve a ordem COMPLETA dos ids visíveis, pronta para gravar. */
export function moverNaOrdem(ids: readonly string[], id: string, alvo: string): string[] {
  if (id === alvo || !ids.includes(id) || !ids.includes(alvo)) return [...ids];
  const sem = ids.filter((x) => x !== id);
  sem.splice(sem.indexOf(alvo), 0, id);
  return sem;
}

/** Move `id` um passo (−1 sobe, +1 desce) na ordem; nos extremos não muda. Alternativa por teclado ao arrastar. */
export function moverUmPasso(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const r = [...ids];
  [r[i], r[j]] = [r[j]!, r[i]!];
  return r;
}

export const alternarEm = (lista: readonly string[], id: string): string[] => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

const normalizar = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** Filtra por nome, pasta, ramo, título da Missão ou nome de agente. Vazio devolve tudo. */
export function filtrarItens(itens: readonly ItemWorkspaceResumo[], termo: string): ItemWorkspaceResumo[] {
  const t = normalizar(termo.trim());
  if (t === "") return [...itens];
  return itens.filter((i) => {
    const campos = [i.nome, i.pasta_mascarada, i.branch ?? "", i.missao?.titulo ?? "", ...i.agentes.map((a) => a.titulo)];
    return campos.some((c) => normalizar(c).includes(t));
  });
}

// ---- atenção -----------------------------------------------------------------------------------------------------------

export const precisaAtencao = (i: Pick<ItemWorkspaceResumo, "contagens">): boolean => i.contagens.aguardando > 0 || i.contagens.erro > 0;

/** Selo do painel: quantos agentes (de workspaces que NÃO são o atual) aguardam você ou falharam. */
export function somarAtencaoFora(itens: readonly ItemWorkspaceResumo[]): number {
  return itens.reduce((n, i) => (i.atual ? n : n + i.contagens.aguardando + i.contagens.erro), 0);
}

// ---- estado ao vivo ----------------------------------------------------------------------------------------------------

export interface SessaoAoVivo {
  estado: EstadoSessao;
  atividade?: AtividadeTerminal | undefined;
  subagentes?: { total: number; ativos: number } | undefined;
}

const estadoDe = (estado: EstadoSessao, atividade: AtividadeTerminal | undefined): EstadoAgenteResumo =>
  estado === "erro" ? "erro" : estado === "iniciando" ? "iniciando" : (atividade ?? "ocioso");

/** O store de terminais do renderer já recebe cada evento: ele manda no estado, na atividade e nos subagentes (sem esperar o main). Sem mudança, devolve o MESMO objeto (cartões memorizados não renderizam à toa). */
export function mesclarAoVivo(a: AgenteResumo, s: SessaoAoVivo | undefined, agora: number): AgenteResumo {
  if (s === undefined) return a;
  const atividade = s.atividade ?? a.atividade;
  const estado = estadoDe(s.estado, atividade ?? undefined);
  const subagentes = s.subagentes ?? a.subagentes;
  const mesmoSub = subagentes === a.subagentes || (subagentes !== null && a.subagentes !== null && subagentes.total === a.subagentes.total && subagentes.ativos === a.subagentes.ativos);
  if (s.estado === a.sessao_estado && atividade === a.atividade && estado === a.estado && mesmoSub) return a;
  return { ...a, sessao_estado: s.estado, atividade, estado, atividade_em: atividade !== a.atividade ? agora : a.atividade_em, subagentes };
}

export function contagensDe(agentes: readonly AgenteResumo[]): ItemWorkspaceResumo["contagens"] & Record<string, number> {
  return {
    agentes: agentes.length,
    trabalhando: agentes.filter((a) => a.estado === "trabalhando").length,
    aguardando: agentes.filter((a) => a.estado === "aguardando").length,
    erro: agentes.filter((a) => a.estado === "erro").length,
    subagentes: agentes.reduce((n, a) => n + (a.subagentes?.ativos ?? 0), 0),
    terminais: 0,
  };
}

/** Aplica o estado ao vivo a um item inteiro e recalcula as contagens. Nada mudou = o mesmo objeto. */
export function aplicarAoVivo(item: ItemWorkspaceResumo, sessao: (id: string) => SessaoAoVivo | undefined, agora: number): ItemWorkspaceResumo {
  if (item.agentes.length === 0) return item;
  let mudou = false;
  const agentes = item.agentes.map((a) => {
    const m = mesclarAoVivo(a, sessao(a.sessao_id), agora);
    if (m !== a) mudou = true;
    return m;
  });
  return mudou ? { ...item, agentes, contagens: { ...contagensDe(agentes), terminais: item.contagens.terminais } } : item;
}

/** Anúncios discretos (aria-live) das mudanças que importam: agente que passou a aguardar você ou a falhar. No máximo 3 por vez. */
export function anunciosDeMudanca(antes: readonly ItemWorkspaceResumo[], depois: readonly ItemWorkspaceResumo[]): string[] {
  const ant = new Map<string, EstadoAgenteResumo>();
  for (const i of antes) for (const a of i.agentes) ant.set(a.sessao_id, a.estado);
  const msgs: string[] = [];
  for (const i of depois) {
    for (const a of i.agentes) {
      const e = ant.get(a.sessao_id);
      if (e === undefined || e === a.estado) continue;
      if (a.estado === "aguardando") msgs.push(`${i.nome}: ${a.titulo} aguarda você`);
      else if (a.estado === "erro") msgs.push(`${i.nome}: ${a.titulo} terminou com erro`);
    }
  }
  return msgs.length <= 3 ? msgs : [...msgs.slice(0, 3), `e mais ${msgs.length - 3}`];
}

// ---- texto -------------------------------------------------------------------------------------------------------------

/** Trunca no MEIO (mantém o começo e o fim do caminho). */
export function abreviarMeio(texto: string, max: number): string {
  const p = [...texto];
  if (p.length <= max || max < 5) return texto;
  const resto = max - 1;
  const fim = Math.ceil(resto / 2);
  const inicio = resto - fim;
  return `${p.slice(0, inicio).join("")}…${p.slice(p.length - fim).join("")}`;
}

/** Compacto para caber na linha do agente: "agora", "42s", "5m", "1h05". */
export function formatarDuracao(desde: number | null, agora: number): string {
  if (desde === null) return "";
  const s = Math.max(0, Math.floor((agora - desde) / 1000));
  if (s < 5) return "agora";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
}

/** "há 3 min": última atividade em linguagem curta (vazio quando desconhecida). */
export function rotuloHa(desde: number | null, agora: number): string {
  if (desde === null) return "";
  const s = Math.max(0, Math.floor((agora - desde) / 1000));
  if (s < 5) return "agora";
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}

export interface RotuloEstado { texto: string; forma: "anel" | "alerta" | "check" | "erro" | "ponto" | "pausa" }
/** Forma e texto de cada estado: a cor nunca é o único sinal. */
export function rotuloDoEstado(e: EstadoAgenteResumo): RotuloEstado {
  switch (e) {
    case "trabalhando": return { texto: "trabalhando", forma: "anel" };
    case "aguardando": return { texto: "aguardando você", forma: "alerta" };
    case "pronto": return { texto: "pronto", forma: "check" };
    case "erro": return { texto: "com erro", forma: "erro" };
    case "iniciando": return { texto: "iniciando", forma: "pausa" };
    default: return { texto: "ocioso", forma: "ponto" };
  }
}

/** O que o agente faz agora: a última linha de saída quando há; senão o estado em palavras. */
export function descreverAgora(a: AgenteResumo): string {
  if (a.estado === "aguardando") return a.linha ?? "aguardando sua resposta";
  if (a.estado === "trabalhando") return a.linha ?? "trabalhando";
  if (a.estado === "erro") return a.linha ?? "terminou com erro";
  if (a.estado === "iniciando") return "iniciando";
  return a.linha ?? (a.estado === "pronto" ? "pronto para o próximo pedido" : "ocioso");
}

// ---- terminar ----------------------------------------------------------------------------------------------------------

export interface ConfirmacaoTerminar { pergunta: string; forte: boolean; detalhe: string | null }
/** Agente trabalhando (ou piloto com workers) pede aviso mais claro: terminar interrompe o que está em curso. */
export function confirmacaoTerminar(a: AgenteResumo, filhos: number): ConfirmacaoTerminar {
  const nome = a.titulo;
  if (a.estado === "trabalhando") return { pergunta: `Terminar ${nome}?`, forte: true, detalhe: "Está trabalhando agora: o que estiver em andamento será interrompido." };
  if (a.piloto && filhos > 0) return { pergunta: `Terminar ${nome}?`, forte: true, detalhe: `É o piloto de ${filhos} ${filhos === 1 ? "worker" : "workers"}; eles seguem rodando até você terminá-los.` };
  return { pergunta: `Terminar ${nome}?`, forte: false, detalhe: null };
}

// ---- árvore de linhas do card ------------------------------------------------------------------------------------------

export type LinhaCard =
  | { tipo: "missao"; id: string; titulo: string; modo: string; estado: string; piloto_sessao_id: string | null; mais: number }
  | { tipo: "agente"; id: string; agente: AgenteResumo; nivel: number; ultimo: boolean }
  | { tipo: "execucao"; id: string; nome: string | null; fase: string; porta: number | null; sessao_id: string | null; iniciado_em: number | null }
  | { tipo: "mais"; id: string; quantos: number };

/** Linhas da árvore do card: Missão → agentes (pai antes dos filhos, com nível) → execução; no máximo `limite` agentes, o resto em "e mais N". */
export function linhasDoCard(item: ItemWorkspaceResumo, limite = LIMITE_AGENTES_VISIVEIS, tudo = false): LinhaCard[] {
  const linhas: LinhaCard[] = [];
  if (item.missao !== null) linhas.push({ tipo: "missao", id: `m:${item.missao.id}`, titulo: item.missao.titulo, modo: item.missao.modo, estado: item.missao.estado, piloto_sessao_id: item.missao.piloto_sessao_id, mais: item.missoes_ativas });
  const agentes = tudo ? item.agentes : item.agentes.slice(0, limite);
  const baseNivel = item.missao !== null ? 1 : 0;
  agentes.forEach((a, i) => {
    // "último" = nenhum irmão depois dele no mesmo nível (as linhas-guia da árvore fecham aqui)
    let ultimo = true;
    for (let j = i + 1; j < agentes.length; j += 1) {
      const p = agentes[j]!.profundidade;
      if (p === a.profundidade) { ultimo = false; break; }
      if (p < a.profundidade) break;
    }
    linhas.push({ tipo: "agente", id: `a:${a.sessao_id}`, agente: a, nivel: baseNivel + a.profundidade, ultimo });
  });
  const resto = item.agentes.length - agentes.length;
  if (resto > 0) linhas.push({ tipo: "mais", id: `mais:${item.id}`, quantos: resto });
  if (item.execucao !== null) linhas.push({ tipo: "execucao", id: `x:${item.id}`, nome: item.execucao.nome, fase: item.execucao.fase, porta: item.execucao.porta, sessao_id: item.execucao.sessao_id, iniciado_em: item.execucao.iniciado_em });
  return linhas;
}

export const rotuloFaseExecucao = (fase: string): string =>
  fase === "rodando" ? "rodando" : fase === "preparando" ? "preparando" : fase === "parando" ? "parando" : fase === "falhou" ? "falhou" : fase;

// ---- teclado -----------------------------------------------------------------------------------------------------------

/** ↑/↓/Home/End sobre uma lista de `n` itens a partir de `i` (-1 = nada focado). Devolve o novo índice ou null (tecla não é de navegação). */
export function passoNaLista(tecla: string, i: number, n: number): number | null {
  if (n <= 0) return null;
  if (tecla === "ArrowDown") return Math.min(n - 1, i + 1);
  if (tecla === "ArrowUp") return i <= 0 ? 0 : i - 1;
  if (tecla === "Home") return 0;
  if (tecla === "End") return n - 1;
  return null;
}

/** Teclas de redimensionar a borda: ←/→ 16 px (Shift ×4), Home/End nos extremos. */
export function larguraPorTecla(tecla: string, atual: number, shift: boolean): number | null {
  const passo = LARGURA_PASSO * (shift ? 4 : 1);
  if (tecla === "ArrowLeft") return limitarLargura(atual - passo);
  if (tecla === "ArrowRight") return limitarLargura(atual + passo);
  if (tecla === "Home") return LARGURA_MIN;
  if (tecla === "End") return LARGURA_MAX;
  return null;
}

// ---- coalescência ------------------------------------------------------------------------------------------------------

/** Junta rajadas: `agendar` guarda só o último valor e entrega uma vez após `ms` (≥ 250 no painel). Devolve cancelar. */
export function criarCoalescedor<T>(entregar: (v: T) => void, ms: number, agendador: { set(fn: () => void, ms: number): unknown; clear(id: unknown): void } = { set: (fn, t) => setTimeout(fn, t), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) }) {
  let pendente: { v: T } | null = null;
  let id: unknown = null;
  return {
    agendar(v: T): void {
      pendente = { v };
      if (id !== null) return;
      id = agendador.set(() => { id = null; const p = pendente; pendente = null; if (p !== null) entregar(p.v); }, ms);
    },
    cancelar(): void { if (id !== null) agendador.clear(id); id = null; pendente = null; },
  };
}
