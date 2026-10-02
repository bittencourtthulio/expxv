// Quando os botões "Commit e push" e "Enviar PR" aparecem e em que estado (D-630). Função pura, testada por tabela:
// tela × git × remoto github × gh × branch padrão × alterações × commits à frente. Nada de I/O: os fatos vêm do main (`vcs:publicar_estado`).
import type { EstadoGh, EstadoPublicacao } from "../../../compartilhado/vcs-publicar";

export const TELA_DOS_BOTOES = "terminais";
export const TOOLTIP_GH = "Instale/autentique o gh (gh auth login)";

export interface BotaoPublicar {
  visivel: boolean;
  habilitado: boolean;
  rotulo: string;
  tooltip: string;
  /** contagem discreta (`3 · ↑2`); null = nada a contar */
  badge: string | null;
  /** desabilitado para enviar, mas o clique ainda abre o diálogo (só há pastas da suíte a decidir: ignorar ou incluir). */
  abreMesmoDesabilitado?: boolean;
}

export interface EntradaVisibilidade {
  /** tela ativa da casca (`terminais` é a única que mostra os botões). */
  tela: string;
  /** null = fatos ainda não chegaram (nada de piscar botão). */
  fatos: EstadoPublicacao | null;
  /** há um pull em andamento (o botão Atualizar fica desabilitado). */
  atualizando?: boolean;
}

const OCULTO: BotaoPublicar = { visivel: false, habilitado: false, rotulo: "", tooltip: "", badge: null };

/** `alteradas` já é o TOTAL contável: rastreados alterados + arquivos/pastas novos no nível do `git status` (D-691). A suíte nunca entra. */
export function badgeDe(alteradas: number, aFrente: number): string | null {
  const p: string[] = [];
  if (alteradas > 0) p.push(String(alteradas));
  if (aFrente > 0) p.push(`↑${aFrente}`);
  return p.length === 0 ? null : p.join(" · ");
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** "3 pastas da suíte não rastreadas" (o texto do tooltip e do diálogo). */
export const textoSuite = (n: number): string => plural(n, "pasta da suíte não rastreada", "pastas da suíte não rastreadas");

export function descreverContagem(alteradas: number, novas: number, aFrente: number): string {
  const p: string[] = [];
  if (alteradas > 0) p.push(plural(alteradas, "arquivo alterado", "arquivos alterados"));
  if (novas > 0) p.push(plural(novas, "pasta/arquivo novo", "pastas/arquivos novos"));
  if (aFrente > 0) p.push(plural(aFrente, "commit para enviar", "commits para enviar"));
  return p.join(" e ");
}

export function aparecem(e: EntradaVisibilidade): boolean {
  const f = e.fatos;
  return e.tela === TELA_DOS_BOTOES && f !== null && f.git && f.remoto_github;
}

function botaoCommit(f: EstadoPublicacao): BotaoPublicar {
  const total = f.alteradas + f.novas;
  const badge = badgeDe(total, f.a_frente);
  const soEnviar = total === 0 && f.a_frente > 0;
  const rotulo = soEnviar ? "Enviar commits" : "Commit e push";
  const base = { visivel: true, rotulo, badge };
  if (f.operacao_em_curso) return { ...base, habilitado: false, tooltip: "Há um merge/rebase em andamento: conclua ou aborte antes." };
  if (f.branch === null && total + f.a_frente > 0) return { ...base, habilitado: false, tooltip: "HEAD destacado: crie um branch primeiro." };
  if (total === 0 && f.a_frente === 0) {
    // só sobrou a suíte (ou nada): desabilitado, mas com suíte o clique abre o diálogo para o dono decidir (ignorar neste computador / incluir)
    if (f.suite.itens > 0) return { ...base, habilitado: false, abreMesmoDesabilitado: true, tooltip: `Nada para commitar. ${textoSuite(f.suite.itens)}: clique para ignorar neste computador ou incluir no commit.` };
    return { ...base, habilitado: false, tooltip: "Nada para commitar" };
  }
  const destino = f.no_padrao ? " (o app vai pedir um branch novo)" : "";
  const suite = f.suite.itens > 0 ? ` · ${textoSuite(f.suite.itens)} ficam de fora` : "";
  return { ...base, habilitado: true, tooltip: `${soEnviar ? "Enviar commits" : "Commit e push"}: ${descreverContagem(f.alteradas, f.novas, f.a_frente)}${destino}${suite}` };
}

function motivoGh(gh: EstadoGh): string {
  return gh === "desconhecido" ? "Verificando o gh…" : TOOLTIP_GH;
}

function botaoPr(f: EstadoPublicacao): BotaoPublicar {
  const base = { visivel: true, rotulo: "Enviar PR", badge: null };
  if (f.gh !== "ok") return { ...base, habilitado: false, tooltip: motivoGh(f.gh) };
  if (f.operacao_em_curso) return { ...base, habilitado: false, tooltip: "Há um merge/rebase em andamento: conclua ou aborte antes." };
  if (f.branch === null || f.no_padrao) return { ...base, habilitado: false, tooltip: "Crie um branch primeiro" };
  const comCommits = (f.a_frente_base ?? 0) > 0 || f.a_frente > 0;
  if (!comCommits && !f.tem_upstream) return { ...base, habilitado: false, tooltip: "Este branch ainda não tem commits além do branch padrão: faça o commit primeiro." };
  if (f.pr !== null) return { ...base, habilitado: false, tooltip: `Já existe o PR #${f.pr.numero} para este branch.`, badge: `#${f.pr.numero}` };
  return { ...base, habilitado: true, tooltip: `Abrir um pull request de ${f.branch} para ${f.ramo_padrao ?? "o branch padrão"}` };
}

/** "Atualizar" (pull, D-693): mostra quantos commits o branch está atrás do upstream (`↓N`, do último fetch); só `git pull --ff-only`. */
function botaoAtualizar(f: EstadoPublicacao, atualizando: boolean): BotaoPublicar {
  const base = { visivel: true, rotulo: "Atualizar", badge: f.atras > 0 ? `↓${f.atras}` : null };
  if (atualizando) return { ...base, habilitado: false, tooltip: "Atualizando…" };
  if (f.operacao_em_curso) return { ...base, habilitado: false, tooltip: "Há um merge/rebase em andamento: conclua ou aborte antes." };
  if (f.branch === null) return { ...base, habilitado: false, tooltip: "HEAD destacado: troque para um branch antes de atualizar." };
  if (!f.tem_upstream) return { ...base, habilitado: false, tooltip: "Este branch não tem upstream: nada para trazer." };
  if (f.atras === 0) return { ...base, habilitado: false, tooltip: "Já está atualizado" };
  return { ...base, habilitado: true, tooltip: `Trazer ${plural(f.atras, "commit", "commits")} de ${f.upstream ?? "origin"} para ${f.branch}` };
}

export interface BotoesDecididos { commit: BotaoPublicar; pr: BotaoPublicar; atualizar: BotaoPublicar }

export function decidirBotoes(e: EntradaVisibilidade): BotoesDecididos {
  if (!aparecem(e) || e.fatos === null) return { commit: OCULTO, pr: OCULTO, atualizar: OCULTO };
  return { commit: botaoCommit(e.fatos), pr: botaoPr(e.fatos), atualizar: botaoAtualizar(e.fatos, e.atualizando === true) };
}
