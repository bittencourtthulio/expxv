// Lógica pura da tela Memória (Fase 8): rótulos, formatação, janela da lista virtualizada, validações de formulário, métricas.
// Nada aqui toca em React, DOM nem na ponte: tudo testável sem jsdom.
import type { ItemSubNav } from "../../componentes/subnavegacao-logica";
import type { EntradaMemoria, EscopoMemoria, EstadoMemoriaApp, FonteMemoria, ResultadoRestaurar, TipoMemoria } from "../../../compartilhado/memoria";

export const ROTULO_TIPO: Readonly<Record<TipoMemoria, string>> = {
  checkpoint: "checkpoint", decisao: "decisão", risco: "risco", evento: "evento", fato: "fato", preferencia: "preferência", handoff: "handoff", aprendizado: "aprendizado", resumo: "resumo",
};
/** glifo curto por tipo (decorativo; o nome sempre acompanha por texto ou aria-label). */
export const GLIFO_TIPO: Readonly<Record<TipoMemoria, string>> = {
  checkpoint: "◉", decisao: "◆", risco: "▲", evento: "·", fato: "■", preferencia: "★", handoff: "⇄", aprendizado: "✦", resumo: "≡",
};
export const ROTULO_ESCOPO: Readonly<Record<EscopoMemoria, string>> = { pane: "Pane", missao: "Missão", squad: "Squad", workspace: "Projeto", usuario: "Usuário" };
export const ROTULO_FONTE: Readonly<Record<FonteMemoria, string>> = { sistema: "sistema", agente: "agente", usuario: "você" };
export const TIPOS_DO_FILTRO: readonly TipoMemoria[] = ["checkpoint", "decisao", "risco", "evento", "fato", "handoff", "aprendizado", "resumo"];

export type AbaMemoria = "pane" | "missao" | "squad" | "workspace" | "preferencias" | "saude";
export const ABAS_MEMORIA: ReadonlyArray<ItemSubNav<AbaMemoria>> = [
  { id: "pane", rotulo: "Pane", icone: "terminais", grupo: "Escopos" }, { id: "missao", rotulo: "Missão", icone: "missoes", grupo: "Escopos" },
  { id: "squad", rotulo: "Squad", icone: "squads", grupo: "Escopos" }, { id: "workspace", rotulo: "Projeto", icone: "workspaces", grupo: "Escopos" },
  { id: "preferencias", rotulo: "Preferências", icone: "config", grupo: "Geral" }, { id: "saude", rotulo: "Saúde", icone: "alerta", grupo: "Geral" },
];
/** Escopo consultado por aba; Preferências (anel 3) e Saúde não listam entradas por `memoria:listar`. */
export const escopoDaAba = (aba: AbaMemoria): EscopoMemoria | null => (aba === "preferencias" || aba === "saude" ? null : aba);
export const abaListaEntradas = (aba: AbaMemoria): boolean => escopoDaAba(aba) !== null;

// ---------------------------------------------------------------- tempo
/** "agora", "há 3 min", "há 3 h", "há 2 d", "há 5 meses". Data inválida ou futura = "agora"/"—". */
export function haQuanto(iso: string, agora: Date = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.floor((agora.getTime() - t) / 1000);
  if (s < 45) return "agora";
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `há ${d} d`;
  const meses = Math.floor(d / 30);
  return meses < 24 ? `há ${meses} ${meses === 1 ? "mês" : "meses"}` : `há ${Math.floor(d / 365)} anos`;
}

export function formatarBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// ---------------------------------------------------------------- lista virtualizada
export interface Janela { primeiro: number; ultimo: number }
/** Linhas [primeiro, ultimo) que existem no DOM: as visíveis mais `extra` acima e abaixo. P-40: poucas dezenas, nunca as 5 000. */
export function janelaVisivel(topo: number, altura: number, total: number, alturaItem: number, extra = 4): Janela {
  if (total <= 0 || alturaItem <= 0) return { primeiro: 0, ultimo: 0 };
  const primeiro = Math.max(0, Math.floor(Math.max(0, topo) / alturaItem) - extra);
  const ultimo = Math.min(total, Math.ceil((Math.max(0, topo) + Math.max(0, altura)) / alturaItem) + extra);
  return { primeiro: Math.min(primeiro, total), ultimo: Math.max(ultimo, Math.min(primeiro, total)) };
}

/** Junta o topo recém-buscado à lista atual SEM recarregar tudo: o que já existe é atualizado no lugar, o novo entra na frente (ordem do servidor). */
export function mesclarNovas(atual: readonly EntradaMemoria[], topo: readonly EntradaMemoria[]): EntradaMemoria[] {
  const porId = new Map(topo.map((e) => [e.id, e]));
  const existentes = new Set(atual.map((e) => e.id));
  const novas = topo.filter((e) => !existentes.has(e.id));
  return [...novas, ...atual.map((e) => porId.get(e.id) ?? e)];
}

/** Filtro de origem (lado do cliente: o canal de listagem não filtra por origem). */
export function filtrarPorOrigem(itens: readonly EntradaMemoria[], origem: FonteMemoria | null): readonly EntradaMemoria[] {
  return origem === null ? itens : itens.filter((e) => e.fonte === origem);
}

// ---------------------------------------------------------------- formulários
export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string };

export const PREFERENCIA_MAX = 300;
export const PREFERENCIAS_LIMITE = 50;
export const CONTEUDO_MAX = 1000;

const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const pontos = (t: string): number => Array.from(t).length;

export function validarTexto(texto: string, max: number, nome = "texto"): Validacao<string> {
  const limpo = texto.trim();
  if (limpo === "") return { ok: false, erro: `Escreva o ${nome}.` };
  if (CONTROLE.test(limpo)) return { ok: false, erro: `O ${nome} tem caracteres de controle.` };
  if (pontos(limpo) > max) return { ok: false, erro: `O ${nome} passa de ${max} caracteres (tem ${pontos(limpo)}).` };
  return { ok: true, valor: limpo };
}
export const validarPreferencia = (texto: string, totalAtual: number, editando: boolean): Validacao<string> => {
  if (!editando && totalAtual >= PREFERENCIAS_LIMITE) return { ok: false, erro: `Limite de ${PREFERENCIAS_LIMITE} preferências atingido: remova uma antes de adicionar.` };
  return validarTexto(texto, PREFERENCIA_MAX, "texto da preferência");
};

/** modelo de embedding local (hash, sem rede): igual a `MODELO_HASH` do núcleo (conferido por teste). */
export const MODELO_EMBEDDING_LOCAL = "hash-256-v1";

export const ORCAMENTO_MIN = 1500;
export const ORCAMENTO_MAX = 20_000;
export function validarOrcamento(texto: string): Validacao<number> {
  const n = Number(texto.trim());
  if (texto.trim() === "" || !Number.isInteger(n)) return { ok: false, erro: "Use um número inteiro de caracteres." };
  if (n < ORCAMENTO_MIN || n > ORCAMENTO_MAX) return { ok: false, erro: `O orçamento do brief fica entre ${ORCAMENTO_MIN} e ${ORCAMENTO_MAX} caracteres.` };
  return { ok: true, valor: n };
}
/** Retenção (P-22): 0 = sem limite; senão de 7 a 3650 dias (a tela sugere até 365). */
export function validarRetencao(texto: string): Validacao<number> {
  const n = Number(texto.trim());
  if (texto.trim() === "" || !Number.isInteger(n)) return { ok: false, erro: "Use um número inteiro de dias (0 = sem limite)." };
  if (n !== 0 && (n < 7 || n > 3650)) return { ok: false, erro: "A retenção é 0 (sem limite) ou de 7 a 3650 dias." };
  return { ok: true, valor: n };
}
export function validarTeto(texto: string): Validacao<number> {
  const n = Number(texto.trim());
  if (texto.trim() === "" || !Number.isInteger(n)) return { ok: false, erro: "Use um número inteiro de MB." };
  if (n < 16 || n > 100_000) return { ok: false, erro: "O teto fica entre 16 MB e 100 000 MB." };
  return { ok: true, valor: n };
}
export const textoRetencao = (dias: number): string => (dias === 0 ? "sem limite" : dias === 1 ? "1 dia" : `${dias} dias`);

/** Apagar exige o nome do projeto digitado, exato (igual à validação do main). */
export const confirmacaoConfere = (digitado: string, nome: string): boolean => nome !== "" && digitado === nome;

// ---------------------------------------------------------------- teto de tamanho
export const percentualTeto = (bytes: number, tetoMb: number): number => (tetoMb <= 0 ? 0 : Math.min(100, Math.round((bytes / (tetoMb * 1024 * 1024)) * 100)));
export function textoTeto(bytes: number, tetoMb: number): string {
  return `${formatarBytes(bytes)} de ${tetoMb} MB (${percentualTeto(bytes, tetoMb)}%)`;
}

// ---------------------------------------------------------------- métricas (só números; nunca conteúdo)
export interface GrupoMetricas { grupo: string; itens: Array<{ nome: string; valor: number }> }
const NOME_METRICA_OK = /^[a-z0-9_.]{1,60}$/;

/** Agrupa `chave.subchave` pelo prefixo. Descarta nome fora do padrão ou valor não numérico (nada de texto livre na tela nem no diagnóstico). */
export function agruparMetricas(metricas: Readonly<Record<string, number>> | undefined): GrupoMetricas[] {
  if (metricas === undefined) return [];
  const grupos = new Map<string, Array<{ nome: string; valor: number }>>();
  for (const [chave, valor] of Object.entries(metricas)) {
    if (!NOME_METRICA_OK.test(chave) || typeof valor !== "number" || !Number.isFinite(valor)) continue;
    const i = chave.indexOf(".");
    const grupo = i < 0 ? "geral" : chave.slice(0, i);
    const lista = grupos.get(grupo) ?? [];
    lista.push({ nome: i < 0 ? chave : chave.slice(i + 1), valor });
    grupos.set(grupo, lista);
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([grupo, itens]) => ({ grupo, itens: itens.sort((a, b) => a.nome.localeCompare(b.nome)) }));
}

/** Bloco de texto para o diagnóstico copiável: uma linha `chave=valor` por métrica; vazio quando não há métrica. */
export function textoMetricas(metricas: Readonly<Record<string, number>> | undefined): string {
  const linhas = agruparMetricas(metricas).flatMap((g) => g.itens.map((i) => `${g.grupo === "geral" ? "" : `${g.grupo}.`}${i.nome}=${i.valor}`));
  return linhas.length === 0 ? "" : `Memória (métricas, só números):\n${linhas.join("\n")}`;
}

/**
 * Bloco da memória para o diagnóstico copiável (Configurações): só números e sim/não (contagens, tamanho, teto, retenção, FTS5, métricas).
 * Nunca `conteudo`, nome de projeto nem caminho. Estado ausente = texto vazio.
 */
export function textoDiagnosticoMemoria(e: EstadoMemoriaApp | null | undefined): string {
  if (e === null || e === undefined) return "";
  const linhas = [
    "Memória:",
    ...Object.entries(e.contagens).map(([k, v]) => `  entradas.${k}=${Number(v)}`),
    `  tamanho_bytes=${Number(e.tamanho_bytes)}`,
    `  teto_mb=${Number(e.config.teto_mb)}`,
    `  retencao_dias=${Number(e.config.retencao_dias)}`,
    `  aviso_teto=${e.aviso_teto ? "sim" : "nao"}`,
    `  fts5=${e.fts5 ? "sim" : "nao"}`,
    `  memox_instalado=${e.memox.instalado ? "sim" : "nao"}`,
  ];
  const m = textoMetricas(e.metricas);
  return m === "" ? linhas.join("\n") : `${linhas.join("\n")}\n${m}`;
}

/** Texto do aviso depois de Restaurar (não promete o que não houve: "já existia" não abre outro Pane). */
export function textoRestauracao(r: Pick<ResultadoRestaurar, "modo" | "brief_injetado" | "truncado" | "ja_existia">): string {
  if (r.ja_existia) return "Este painel já tinha sido restaurado: nada foi duplicado.";
  if (r.modo === "retomada") return "Painel restaurado retomando a conversa anterior.";
  if (r.modo === "sem_memoria") return "Painel reaberto sem brief: a memória está desligada para ele.";
  return r.brief_injetado ? `Painel restaurado com o brief de memória${r.truncado ? " (resumido para caber no orçamento)" : ""}.` : "Painel reaberto sem brief (nada gravado ainda).";
}

// ---------------------------------------------------------------- Missão
/** "no_learning_recorded": Missão terminal sem `aprendizado` gravado pelo agente (o sistema grava um resumo próprio, D-50). */
export function semAprendizadoDoPiloto(missaoTerminal: boolean, aprendizados: readonly Pick<EntradaMemoria, "fonte" | "tipo">[]): boolean {
  return missaoTerminal && !aprendizados.some((e) => e.tipo === "aprendizado" && e.fonte === "agente");
}

export type ModoMissao = "herdar" | "ligada" | "desligada";
export const modoDaMissao = (v: boolean | null | undefined): ModoMissao => (v === true ? "ligada" : v === false ? "desligada" : "herdar");
export const valorDoModoMissao = (m: ModoMissao): boolean | null => (m === "ligada" ? true : m === "desligada" ? false : null);
