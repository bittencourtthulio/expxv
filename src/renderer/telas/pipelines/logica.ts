// Lógica PURA da UI do Maestro (Fase 16): seletor de rigidez, plano, matriz e acompanhamento. Sem React, sem `window.ade`: testável sem DOM.
import {
  TEXTO_PEDIDO_MAX,
  type AcaoDoPipelineIpc,
  type AchadoPipeline,
  type CelaDto,
  type EstadoEtapa,
  type EstadoPipeline,
  type EtapaDefDto,
  type EtapaDoPlano,
  type NivelRigidez,
  type PlanoMaestro,
} from "../../../compartilhado/maestro";

// ---------------------------------------------------------------- níveis (fallback estático: o seletor funciona antes de a matriz chegar)
export const NIVEIS: readonly NivelRigidez[] = [1, 2, 3, 4, 5];
export const NOMES_NIVEL: Readonly<Record<NivelRigidez, string>> = { 1: "Relâmpago", 2: "Leve", 3: "Padrão", 4: "Rigoroso", 5: "Total" };
export const NIVEL_PADRAO: NivelRigidez = 3;

export const valorTexto = (n: NivelRigidez, nome: string = NOMES_NIVEL[n]): string => `${nome}, nível ${n} de 5`;

/** Teclado do slider: ←/↓ −1, →/↑ +1, Home 1, End 5. `null` = tecla que o slider não trata. */
export function nivelPorTecla(tecla: string, atual: NivelRigidez): NivelRigidez | null {
  const alvo = tecla === "ArrowRight" || tecla === "ArrowUp" ? atual + 1 : tecla === "ArrowLeft" || tecla === "ArrowDown" ? atual - 1 : tecla === "Home" ? 1 : tecla === "End" ? 5 : null;
  if (alvo === null) return null;
  return Math.min(5, Math.max(1, alvo)) as NivelRigidez;
}

export const JUSTIFICATIVA_MIN = 20;
export const FRASE_CONFIRMACAO = "baixar";
export const justificativaValida = (t: string): boolean => t.trim().length >= JUSTIFICATIVA_MIN;
export const fraseValida = (t: string): boolean => t.trim().toLowerCase() === FRASE_CONFIRMACAO;

export type Exigencia = { tipo: "confirmacao"; mensagem: string } | { tipo: "justificativa"; mensagem: string };

/** Erros nominais do main (`confirmacao_necessaria`, `abaixo_do_minimo`) chegam no TEXTO do erro: viram o diálogo certo. */
export function exigenciaDoErro(e: unknown): Exigencia | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abaixo_do_minimo/.test(msg)) return { tipo: "justificativa", mensagem: limpar(msg) };
  if (/confirmacao_necessaria/.test(msg)) return { tipo: "confirmacao", mensagem: limpar(msg) };
  return null;
}
const limpar = (m: string): string => m.replace(/^(?:Error:\s*)?(?:abaixo_do_minimo|confirmacao_necessaria)\s*[:\-–]?\s*/i, "").trim() || m;

/** Descer abaixo do mínimo travado (raio ALTO) pede justificativa ANTES de chamar o main. */
export const exigenciaPrevia = (para: NivelRigidez, minimoTravado: NivelRigidez, motivo: string | null): Exigencia | null =>
  para < minimoTravado ? { tipo: "justificativa", mensagem: motivo ?? `O nível mínimo travado é ${minimoTravado}.` } : null;

// ---------------------------------------------------------------- pedido
export function problemaDoTexto(t: string): string | null {
  if (t.trim() === "") return "Escreva o que você quer fazer.";
  if (t.length > TEXTO_PEDIDO_MAX) return `O texto passa de ${TEXTO_PEDIDO_MAX} caracteres (${t.length}).`;
  return null;
}

// ---------------------------------------------------------------- plano
export type FaixaConf = "alta" | "media" | "baixa";
export const faixaDeConfianca = (c: number): FaixaConf => (c >= 0.7 ? "alta" : c >= 0.45 ? "media" : "baixa");
export const porcento = (c: number): string => `${Math.round(c * 100)}%`;

export const NOMES_FONTE: Readonly<Record<PlanoMaestro["fonte"], string>> = { comando: "comando explícito", explicito: "rótulo explícito", regra: "regras locais", decisor: "decisor externo", "regra+decisor": "regras e decisor", fallback: "regras (decisor indisponível)" };
export const NOMES_INTENCAO: Readonly<Record<string, string>> = {
  bug: "Correção de defeito", feature: "Funcionalidade nova", pedido: "Pedido cru (triagem)", projeto: "Projeto inteiro", refatoracao: "Refatoração / legado", entrega: "Entrega (PR)",
  duvida: "Dúvida", historico: "Histórico", convencoes: "Convenções do repositório", design: "Design system", onboarding: "Preparar o repositório", controle: "Controle do Maestro", desconhecida: "Não identificada",
};

export function marcasDaEtapa(e: Pick<EtapaDoPlano, "estado_inicial" | "reduz" | "reforco" | "piso" | "agrupa_com_anterior" | "avaliacoes">): string[] {
  const m: string[] = [];
  if (e.estado_inicial === "humano") m.push("H");
  else if (e.estado_inicial === "pulada_nivel" || e.estado_inicial === "pulada_usuario") m.push("○");
  else if (e.reforco !== null && e.reforco !== undefined) m.push("◆");
  else if (e.reduz) m.push("◐");
  if (e.piso) m.push("P");
  if (e.agrupa_com_anterior) m.push("⛓");
  if ((e.avaliacoes ?? 1) > 1) m.push("×2");
  return m;
}
export const LEGENDA_MARCAS: ReadonlyArray<{ marca: string; texto: string }> = [
  { marca: "◐", texto: "roda reduzida" }, { marca: "◆", texto: "roda com reforço" }, { marca: "○", texto: "não despachada neste nível" },
  { marca: "H", texto: "ação humana (o Maestro para)" }, { marca: "P", texto: "etapa de piso (nunca omitida)" }, { marca: "⛓", texto: "agrupada no terminal anterior" },
];

/** Quantos terminais o plano abre: uma por etapa despachável, menos as agrupadas, as humanas, as puladas e as sem Pane (consulta). */
export function contarTerminais(plano: { etapas: readonly EtapaDoPlano[] }): number {
  return plano.etapas.filter((e) => (e.estado_inicial === "pendente" || e.estado_inicial === "confirmar") && e.tipo !== "humano" && e.tipo !== "consulta" && e.comando !== null && !e.agrupa_com_anterior).length;
}
export const terminaisDaEtapa = (e: Pick<EtapaDoPlano, "estado_inicial" | "tipo" | "comando" | "agrupa_com_anterior">): number => (contarTerminais({ etapas: [e as EtapaDoPlano] }));

export const planoTemCandidatas = (p: Pick<PlanoMaestro, "candidatas" | "confianca">): boolean => (p.candidatas?.length ?? 0) > 1 && faixaDeConfianca(p.confianca) !== "alta";

// ---------------------------------------------------------------- acompanhamento
export const ROTULO_ESTADO_PIPELINE: Readonly<Record<EstadoPipeline, string>> = {
  proposto: "Proposto", executando: "Executando", aguardando_humano: "Aguardando você", aguardando_usuario: "O método perguntou", aguardando_confirmacao: "Aguardando confirmação", bloqueado_piso: "Bloqueado: piso de qualidade",
  bloqueado_trava: "Bloqueado: trava de segurança", pausado: "Pausado", concluido: "Concluído", concluido_parcial: "Concluído (parcial)", falhou: "Falhou", cancelado: "Cancelado", expirado: "Expirado",
};
export const ROTULO_ESTADO_ETAPA: Readonly<Record<EstadoEtapa, string>> = {
  pendente: "pendente", pulada_nivel: "pulada pelo nível", pulada_usuario: "pulada por você", despachando: "abrindo terminal", executando: "executando", aguardando_humano: "aguardando você", aguardando_usuario: "aguardando resposta no terminal",
  aguardando_confirmacao: "aguardando confirmação", concluida: "concluída", reprovada: "reprovada", falhou: "falhou", sem_progresso: "sem progresso",
};
export type Tom = "ok" | "aviso" | "erro" | "neutro";
export const tomDoEstado = (e: EstadoPipeline): Tom =>
  e === "concluido" ? "ok" : e === "falhou" || e === "bloqueado_piso" || e === "bloqueado_trava" ? "erro" : e === "executando" || e === "proposto" || e === "cancelado" || e === "expirado" ? "neutro" : e === "concluido_parcial" ? "aviso" : "aviso";
export const tomDaEtapa = (e: EstadoEtapa): Tom => (e === "concluida" ? "ok" : e === "falhou" || e === "reprovada" ? "erro" : e === "pendente" || e === "executando" || e === "despachando" || e === "pulada_nivel" || e === "pulada_usuario" ? "neutro" : "aviso");
export const pipelineTerminou = (e: EstadoPipeline): boolean => e === "concluido" || e === "concluido_parcial" || e === "falhou" || e === "cancelado" || e === "expirado";

export const TEXTO_HUMANO: Readonly<Record<string, string>> = {
  "prodx.assinatura": "A assinatura do veredito é sua: abra o VEREDITO.md e assine. O Maestro nunca preenche a assinatura.",
  "mergex.revisar": "O merge é seu: revise o PR e faça o merge. O Maestro nunca revisa nem faz merge.",
  "legadox.raio": "O raio está em nível ALTO: a aprovação é humana. Leia o arquivo do raio e registre a aprovação você mesmo.",
};
export const textoHumano = (etapaId: string): string => TEXTO_HUMANO[etapaId] ?? "Esta etapa é humana: o Maestro espera você agir no arquivo indicado.";

/** Ações do usuário permitidas no momento. NUNCA existe ação de assinar/aprovar/mergear (I6). */
export function acoesPermitidas(pipeline: EstadoPipeline, etapa: EstadoEtapa | null): AcaoDoPipelineIpc[] {
  if (pipelineTerminou(pipeline)) return [];
  const a: AcaoDoPipelineIpc[] = [];
  a.push(pipeline === "pausado" ? "retomar" : "pausar");
  if (etapa === "aguardando_confirmacao") a.push("confirmar_etapa");
  if (etapa === "pendente" || etapa === "aguardando_confirmacao" || etapa === "sem_progresso") a.push("pular_etapa");
  if (etapa === "concluida" || etapa === "reprovada" || etapa === "falhou" || etapa === "sem_progresso") a.push("reabrir_etapa");
  if (etapa === "aguardando_humano") a.push("abrir_arquivo");
  return a;
}
export const ROTULO_ACAO: Readonly<Record<AcaoDoPipelineIpc, string>> = { pausar: "Pausar", retomar: "Retomar", pular_etapa: "Pular etapa", reabrir_etapa: "Reabrir etapa", confirmar_etapa: "Confirmar etapa", abrir_arquivo: "Abrir arquivo" };

export const ROTULO_PISO: Readonly<Record<string, string>> = { ok: "ok", violado: "violado", nao_comprovado: "não comprovado" };
export const SIMBOLO_PISO: Readonly<Record<string, string>> = { ok: "✓", violado: "✗", nao_comprovado: "?" };

// ---------------------------------------------------------------- matriz skill × etapa
export interface GrupoDeEtapas {
  skill: string;
  etapas: EtapaDefDto[];
}
export function agruparPorSkill(etapas: readonly EtapaDefDto[]): GrupoDeEtapas[] {
  const mapa = new Map<string, EtapaDefDto[]>();
  for (const e of etapas) {
    const l = mapa.get(e.skill);
    if (l === undefined) mapa.set(e.skill, [e]);
    else l.push(e);
  }
  return [...mapa].map(([skill, es]) => ({ skill, etapas: es }));
}
export function achadosPorEtapa(achados: readonly AchadoPipeline[]): Map<string, AchadoPipeline[]> {
  const m = new Map<string, AchadoPipeline[]>();
  for (const a of achados) for (const id of [a.etapa_id, ...(a.relacionadas ?? [])]) m.set(id, [...(m.get(id) ?? []), a]);
  return m;
}
export const temErroDeValidacao = (achados: readonly AchadoPipeline[]): boolean => achados.some((a) => a.severidade === "erro");
/** Etapa humana: linha travada (cadeado), sem seletores. */
export const linhaTravada = (e: Pick<EtapaDefDto, "humano">): boolean => e.humano;
/** Etapa de piso não pode ser desligada (V5). */
export const podeDesligar = (e: Pick<EtapaDefDto, "humano" | "piso">): boolean => !e.humano && !e.piso;

export const CLIS_DA_MATRIZ: readonly string[] = ["auto", "claude", "opencode", "codex", "gemini", "aider", "goose"];
export const ESFORCOS_PADRAO: readonly string[] = ["minimo", "baixo", "medio", "alto", "maximo"];
export const FAIXAS_PADRAO = ["topo", "alto", "medio", "rapido"] as const;
export const ROTULO_MODO: Readonly<Record<string, string>> = { novo_terminal: "novo terminal", reusar_terminal: "reusar terminal", confirmar: "confirmar antes", desligada: "desligada" };

// ---------------------------------------------------------------- rigidez (matriz nível × etapa)
export const SIMBOLO_CELA: Readonly<Record<CelaDto["modo"], string>> = { roda: "●", reduzida: "◐", reforco: "◆", omitida: "○", humano: "H", substituida: "R" };
export const ROTULO_CELA: Readonly<Record<CelaDto["modo"], string>> = { roda: "roda como o método define", reduzida: "roda reduzida", reforco: "roda com reforço", omitida: "não despachada", humano: "pausa para ação humana", substituida: "substituída pelo pipeline rápido" };
export function rotuloDaCela(c: CelaDto, nivel: number, etapaNome: string): string {
  const extra = [c.agrupa ? "agrupada no terminal anterior" : null, c.avaliacoes !== null && c.avaliacoes > 1 ? `${c.avaliacoes} avaliações independentes` : null, c.confirma ? "confirma antes de enviar" : null, c.nota].filter((x): x is string => x !== null && x !== "");
  return `${etapaNome}, nível ${nivel}: ${ROTULO_CELA[c.modo]}${extra.length > 0 ? `; ${extra.join("; ")}` : ""}`;
}
export const ROTULO_HOOK: Readonly<Record<string, string>> = { aviso: "aviso", bloqueio: "bloqueio", desligado: "desligado" };

// ---------------------------------------------------------------- leitura humana do plano e do acompanhamento (redesenho da tela)
export interface PerfilLegivel { cli: string; modelo: string; esforco: string }
const CLIS_NOMES: Readonly<Record<string, string>> = { auto: "automática", claude: "Claude Code", opencode: "OpenCode", codex: "Codex", gemini: "Gemini", aider: "Aider", goose: "Goose" };
export const rotuloCli = (cli: string): string => CLIS_NOMES[cli] ?? cli;
const ESFORCOS_NOMES: Readonly<Record<string, string>> = { minimo: "mínimo", baixo: "baixo", medio: "médio", alto: "alto", maximo: "máximo" };
export const rotuloEsforco = (e: string | null): string => (e === null || e === "padrão" ? "padrão" : (ESFORCOS_NOMES[e] ?? e));
export const ROTULO_FAIXA: Readonly<Record<string, string>> = { topo: "topo", alto: "alto", medio: "médio", rapido: "rápido" };

/** "claude·padrão·alto" (resumo do núcleo) vira os três campos que a tela mostra com rótulo. `null` quando não há perfil (etapa humana). */
export function perfilLegivel(resumo: string | null | undefined): PerfilLegivel | null {
  if (resumo === null || resumo === undefined || resumo.trim() === "") return null;
  const [cli = "", modelo = "padrão", esforco = "padrão"] = resumo.split("·").map((x) => x.trim());
  return { cli: rotuloCli(cli), modelo: modelo === "" || modelo === "padrão" ? "padrão da faixa" : modelo, esforco: rotuloEsforco(esforco === "" ? null : esforco) };
}

export type TipoRigor = "reduz" | "reforco" | "piso" | "humano" | "agrupa" | "avaliacoes" | "pulada" | "confirma";
export interface Rigor { tipo: TipoRigor; texto: string }
type EntradaRigor = Pick<EtapaDoPlano, "estado_inicial" | "reduz" | "reforco" | "piso" | "agrupa_com_anterior" | "avaliacoes">;
/** Rigor da etapa em palavras (no lugar dos símbolos soltos): o que o nível faz com ela e o que a protege. */
export function rigoresDaEtapa(e: EntradaRigor): Rigor[] {
  const r: Rigor[] = [];
  if (e.estado_inicial === "humano") r.push({ tipo: "humano", texto: "ação humana: o Maestro para" });
  else if (e.estado_inicial === "pulada_nivel") r.push({ tipo: "pulada", texto: "fora deste nível" });
  else if (e.estado_inicial === "pulada_usuario") r.push({ tipo: "pulada", texto: "pulada por você" });
  else if (e.reforco !== null && e.reforco !== undefined) r.push({ tipo: "reforco", texto: `com reforço: ${e.reforco}` });
  else if (e.reduz) r.push({ tipo: "reduz", texto: "roda reduzida" });
  if (e.estado_inicial === "confirmar") r.push({ tipo: "confirma", texto: "confirma antes de enviar" });
  if (e.piso) r.push({ tipo: "piso", texto: "piso de qualidade" });
  if (e.agrupa_com_anterior) r.push({ tipo: "agrupa", texto: "no terminal anterior" });
  if ((e.avaliacoes ?? 1) > 1) r.push({ tipo: "avaliacoes", texto: `${e.avaliacoes} avaliações independentes` });
  return r;
}

/** Estado da etapa em linguagem curta + glifo (a cor nunca é a única pista). */
export const GLIFO_ETAPA: Readonly<Record<EstadoEtapa, string>> = {
  pendente: "○", pulada_nivel: "–", pulada_usuario: "–", despachando: "◔", executando: "●", aguardando_humano: "!", aguardando_usuario: "?",
  aguardando_confirmacao: "!", concluida: "✓", reprovada: "✗", falhou: "✗", sem_progresso: "…",
};
export const etapaEmAtencao = (e: EstadoEtapa): boolean => e === "aguardando_humano" || e === "aguardando_usuario" || e === "aguardando_confirmacao" || e === "sem_progresso";
export const etapaAtiva = (e: EstadoEtapa): boolean => e === "executando" || e === "despachando" || etapaEmAtencao(e);

/** Duração entre dois instantes ISO ("3 min 12 s"); sem início, `null`; sem fim, conta até `agora`. */
export function duracaoDaEtapa(inicio: string | null, fim: string | null, agora: number = Date.now()): string | null {
  if (inicio === null) return null;
  const t0 = Date.parse(inicio);
  const t1 = fim === null ? agora : Date.parse(fim);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  const s = Math.max(0, Math.round((t1 - t0) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 > 0 ? ` ${s % 60} s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 > 0 ? ` ${m % 60} min` : ""}`;
}

/** Quantas etapas concluídas do total (as puladas não contam no total). */
export function progressoDoPipeline(execs: ReadonlyArray<{ estado: EstadoEtapa }>): { feitas: number; total: number } {
  const validas = execs.filter((e) => e.estado !== "pulada_nivel" && e.estado !== "pulada_usuario");
  return { feitas: validas.filter((e) => e.estado === "concluida").length, total: validas.length };
}

// ---------------------------------------------------------------- escala de rigidez: efeito de cada nível
export const CELA_CURTA: Readonly<Record<CelaDto["modo"], string>> = { roda: "completa", reduzida: "reduzida", reforco: "reforço", omitida: "fora", humano: "você", substituida: "rápido" };
export interface EfeitoDoNivel { total: number; completas: number; reduzidas: number; reforcadas: number; fora: number; humanas: number; avaliacoesExtras: number }
/** Conta, para um nível, o que acontece com cada etapa da matriz (opcionalmente só as `somente` etapas, ex.: as do pipeline em foco). */
export function efeitoDoNivel(celulas: ReadonlyArray<{ etapa_id: string; por_nivel: Record<string, CelaDto> }>, nivel: NivelRigidez, somente?: ReadonlySet<string>): EfeitoDoNivel {
  const e: EfeitoDoNivel = { total: 0, completas: 0, reduzidas: 0, reforcadas: 0, fora: 0, humanas: 0, avaliacoesExtras: 0 };
  for (const l of celulas) {
    if (somente !== undefined && !somente.has(l.etapa_id)) continue;
    const c = l.por_nivel[String(nivel)];
    if (c === undefined) continue;
    e.total++;
    if (c.modo === "roda" || c.modo === "substituida") e.completas++;
    else if (c.modo === "reduzida") e.reduzidas++;
    else if (c.modo === "reforco") e.reforcadas++;
    else if (c.modo === "omitida") e.fora++;
    else e.humanas++;
    if (c.avaliacoes !== null && c.avaliacoes > 1) e.avaliacoesExtras += c.avaliacoes - 1;
  }
  return e;
}
/** Frase única do efeito ("5 rodam, 1 reduzida, 2 fora"); só cita o que existe. */
export function frasesDoEfeito(e: EfeitoDoNivel): string {
  const partes: string[] = [];
  const rodam = e.completas + e.reduzidas + e.reforcadas;
  partes.push(`${rodam} ${rodam === 1 ? "etapa roda" : "etapas rodam"}`);
  if (e.reduzidas > 0) partes.push(`${e.reduzidas} ${e.reduzidas === 1 ? "reduzida" : "reduzidas"}`);
  if (e.reforcadas > 0) partes.push(`${e.reforcadas} com reforço`);
  if (e.fora > 0) partes.push(`${e.fora} fora`);
  if (e.humanas > 0) partes.push(`${e.humanas} ${e.humanas === 1 ? "pausa" : "pausas"} para você`);
  return partes.join(", ");
}

// ---------------------------------------------------------------- comparação dos perfis prontos (prévia só de leitura; quem aplica é o núcleo)
export type IdPerfilPronto = "economico" | "equilibrado" | "maxima-qualidade";
const ORDEM_FAIXAS = ["topo", "alto", "medio", "rapido"] as const;
const ESFORCO_POR_FAIXA: Readonly<Record<IdPerfilPronto, Readonly<Record<string, string>>>> = {
  economico: { topo: "medio", alto: "baixo", medio: "baixo", rapido: "minimo" },
  equilibrado: { topo: "alto", alto: "medio", medio: "medio", rapido: "baixo" },
  "maxima-qualidade": { topo: "maximo", alto: "alto", medio: "alto", rapido: "medio" },
};
/** O que o perfil pronto faz com uma etapa que hoje está na faixa dada: Econômico desce uma faixa, Máxima qualidade sobe uma. Equilibrado depende do tipo da etapa (fábrica): devolve `null`. */
export function previaDoPerfilPronto(id: string, faixaAtual: string): { faixa: string; esforco: string } | null {
  if (id !== "economico" && id !== "maxima-qualidade") return null;
  const i = ORDEM_FAIXAS.indexOf(faixaAtual as (typeof ORDEM_FAIXAS)[number]);
  if (i < 0) return null;
  const j = Math.min(ORDEM_FAIXAS.length - 1, Math.max(0, i + (id === "economico" ? 1 : -1)));
  const faixa = ORDEM_FAIXAS[j] as string;
  return { faixa, esforco: ESFORCO_POR_FAIXA[id][faixa] ?? "medio" };
}

/** O mesmo resumo, calculado do plano proposto (etapas já resolvidas para o nível escolhido). */
export function efeitoDoPlano(etapas: ReadonlyArray<EntradaRigor>): EfeitoDoNivel {
  const e: EfeitoDoNivel = { total: etapas.length, completas: 0, reduzidas: 0, reforcadas: 0, fora: 0, humanas: 0, avaliacoesExtras: 0 };
  for (const x of etapas) {
    if (x.estado_inicial === "humano") e.humanas++;
    else if (x.estado_inicial === "pulada_nivel" || x.estado_inicial === "pulada_usuario") e.fora++;
    else if (x.reforco !== null && x.reforco !== undefined) e.reforcadas++;
    else if (x.reduz) e.reduzidas++;
    else e.completas++;
    if ((x.avaliacoes ?? 1) > 1) e.avaliacoesExtras += (x.avaliacoes ?? 1) - 1;
  }
  return e;
}

/** Quadro comparativo dos perfis prontos (fatos do núcleo, só leitura): quanto a faixa desloca e qual esforço cada faixa recebe. */
export const COMPARATIVO_PERFIS: Readonly<Record<string, { faixa: string; esforcos: ReadonlyArray<{ faixa: string; esforco: string }> }>> = {
  economico: { faixa: "uma faixa abaixo da fábrica", esforcos: ESFORCO_LINHAS("economico") },
  equilibrado: { faixa: "a faixa de fábrica de cada tipo de etapa", esforcos: ESFORCO_LINHAS("equilibrado") },
  "maxima-qualidade": { faixa: "uma faixa acima da fábrica", esforcos: ESFORCO_LINHAS("maxima-qualidade") },
};
function ESFORCO_LINHAS(id: IdPerfilPronto): Array<{ faixa: string; esforco: string }> {
  return ORDEM_FAIXAS.map((f) => ({ faixa: ROTULO_FAIXA[f] ?? f, esforco: rotuloEsforco(ESFORCO_POR_FAIXA[id][f] ?? null) }));
}

// ---------------------------------------------------------------- parâmetros e hooks por nível (leitura humana; nunca valor técnico cru)
export const PARAMETROS_INFO: Readonly<Record<string, { rotulo: string; descricao: string }>> = {
  pipeline_bug_feature: { rotulo: "Pipeline de bug e feature", descricao: "Quantas fases o pipeline roda." },
  densidade: { rotulo: "Densidade do plano", descricao: "Quão detalhado é o plano gerado." },
  forma: { rotulo: "Forma da descoberta", descricao: "Se o método entrevista você ou decide sozinho." },
  auditoria_rodadas: { rotulo: "Rodadas de auditoria", descricao: "Quantas vezes o plano é auditado." },
  auditoria_reauditoria: { rotulo: "Reauditorias", descricao: "Quantas vezes a auditoria é refeita depois de correções." },
  qa_voltas_max: { rotulo: "Voltas do QA", descricao: "Máximo de idas e vindas entre o QA e a correção." },
  testes: { rotulo: "Exigência de testes", descricao: "O quanto de teste cada task precisa trazer." },
  avaliador_outro_provedor: { rotulo: "Avaliador em outro provedor", descricao: "Usar outra CLI para avaliar o que a primeira escreveu." },
  subagentes_de_veredito: { rotulo: "Subagentes de veredito", descricao: "Quem dá parecer antes de a entrega fechar." },
  hooks_de_metodo: { rotulo: "Hooks de método", descricao: "Quais travas do método ficam ligadas." },
  portao_mergex: { rotulo: "Portão do mergex", descricao: "Rigor da checagem antes de abrir o PR." },
  consulta_rag: { rotulo: "Consulta ao RAG", descricao: "Se o método consulta a base de conhecimento do projeto." },
  max_terminais: { rotulo: "Terminais simultâneos", descricao: "Quantos terminais um pipeline abre ao mesmo tempo." },
  agrupa_etapas: { rotulo: "Agrupa etapas", descricao: "Junta etapas parecidas no mesmo terminal." },
  fecha_trabalho: { rotulo: "Fecha o trabalho", descricao: "Se o Maestro encerra o trabalho ao concluir." },
  reaproveita_terminal: { rotulo: "Reaproveita terminal", descricao: "Reusa o terminal de uma etapa na etapa seguinte." },
};
export function infoDoParametro(chave: string): { rotulo: string; descricao: string } {
  const p = PARAMETROS_INFO[chave];
  if (p !== undefined) return p;
  const t = chave.replace(/_/g, " ");
  return { rotulo: t.charAt(0).toUpperCase() + t.slice(1), descricao: "" };
}
const VALORES_PARAMETRO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pipeline_bug_feature: { rapido: "rápido", condensado: "condensado", metodo: "como o método define", reforcado: "reforçado", total: "total" },
  densidade: { mvp: "MVP", padrao: "padrão", completo: "completo", profundo: "profundo" },
  forma: { autonomo: "autônomo", entrevista: "com entrevista" },
  testes: { piso: "só o piso", regressao_por_task: "regressão por task", dois_por_task: "dois testes por task", com_revisor_testes: "com revisor de testes", revisor_em_segundo_provedor: "revisor em outro provedor" },
  avaliador_outro_provedor: { nao: "não", recomendado: "recomendado", obrigatorio: "obrigatório" },
  hooks_de_metodo: { desligados_piso_aviso: "desligados, piso em aviso", escopo_verde_aviso: "escopo e suíte verde em aviso", nascimento: "só os de nascimento", promovidos: "promovidos a bloqueio", quase_todos_bloqueio: "quase todos em bloqueio" },
  portao_mergex: { nenhum: "nenhum", pronto_bloqueado: "bloqueia sem PRONTO", completo: "completo", estrito: "estrito", estrito_segunda_opiniao: "estrito com segunda opinião" },
  consulta_rag: { nao: "não", sim: "sim", sim_com_regressoes: "sim, com regressões" },
};
/** Valor de um parâmetro em português corrido: sem sublinhado, sem token interno. */
export function valorDoParametro(chave: string, v: unknown): string {
  if (v === null || v === undefined) return "não se aplica";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) return v.length === 0 ? "nenhum" : v.map((x) => String(x).replace(/_/g, " ")).join(", ");
  const s = String(v);
  return VALORES_PARAMETRO[chave]?.[s] ?? s.replace(/_/g, " ");
}

export const HOOKS_INFO: Readonly<Record<string, string>> = {
  "task-so-fecha-verde": "A task só fecha com a suíte verde.",
  "regressao-antes-do-fix": "Exige o teste de regressão antes de corrigir.",
  "escopo-da-ocorrencia": "Mantém as edições dentro do escopo da ocorrência.",
  "escopo-da-task": "Mantém as edições dentro do escopo da task.",
  "arvore-limpa-antes-da-suite": "Pede árvore limpa antes de rodar a suíte.",
  "task-reivindicada": "A task precisa estar reivindicada antes de editar.",
  "uma-ocorrencia-por-arvore": "Uma ocorrência por árvore de trabalho.",
  "causa-antes-do-plano": "Exige a causa raiz antes do plano.",
  "sem-placeholder-no-plano": "Barra texto de preenchimento no plano.",
  "raio-antes-do-plano": "Exige o raio de impacto antes do plano (legado).",
  "caracterizacao-antes": "Exige testes de caracterização antes de mexer (legado).",
  "orcamento-de-mudanca": "Limita o tamanho da mudança.",
  "reversao-declarada": "Exige declarar como desfazer a mudança.",
  "sem-colateral": "Barra mudanças colaterais.",
  "commit-por-task": "Um commit por task concluída.",
  "arquivo-fora-do-plano": "Avisa sobre arquivo fora do plano.",
  "pr-so-com-portao": "O PR só abre com o portão PRONTO.",
  "tdd-teste-antes": "O teste vem antes do código.",
  aderencia: "Confere a aderência ao plano.",
  "sem-convencoes": "Barra quebra das convenções do repositório.",
  "sem-jargao-no-uso": "Barra jargão nos textos de uso.",
  "designx-audit": "Roda a auditoria de design.",
  "designx-token-check": "Confere o uso dos tokens de design.",
};
export const descricaoDoHook = (nome: string): string => HOOKS_INFO[nome] ?? "";
export const MODO_HOOK_CURTO: Readonly<Record<string, string>> = { bloqueio: "bloqueia", aviso: "só avisa", desligado: "desligado" };
export interface HookDoNivel { nome: string; modo: string; descricao: string }
/** Hooks que o app gerencia num nível, ordenados com os que bloqueiam primeiro. Nível sem entrada = o método volta ao padrão. */
export function hooksDoNivel(porNivel: Readonly<Record<string, Readonly<Record<string, string>>>>, nivel: NivelRigidez): HookDoNivel[] {
  const peso = (m: string): number => (m === "bloqueio" ? 0 : m === "aviso" ? 1 : 2);
  return Object.entries(porNivel[String(nivel)] ?? {}).map(([nome, modo]) => ({ nome, modo, descricao: descricaoDoHook(nome) })).sort((a, b) => peso(a.modo) - peso(b.modo) || a.nome.localeCompare(b.nome));
}
