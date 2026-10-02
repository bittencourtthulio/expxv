// Validação pura de squads, membros e prompts (Fase 14, T-14.07/T-14.04 do plano; D-203). Sem I/O: tudo que depende do
// mundo (CLIs instaladas, catálogo de skills/MCPs, níveis de esforço por CLI) entra por `ContextoValidacao`.
// Cada achado traz `severidade` do contrato (erro/aviso), `gravidade` (alta/média/baixa) e texto em PT-BR.
import type { Achado, CodigoAchado, Membro, PermissaoMembro, Squad, ModoEsforco } from "./tipos";
import {
  CLIS_CATALOGO,
  CLIS_COM_INTAKE,
  CLI_AUTO,
  ESCOPOS_SQUAD,
  ESFORCOS_CONHECIDOS,
  LIMITES_SQUAD,
  NIVEIS_RIGIDEZ,
  PADRAO_SLUG,
  PAPEIS_SQUAD,
  PERMISSOES_MEMBRO,
  VARIAVEIS_PROMPT,
  caminhoPromptDe,
} from "./tipos";

export type Gravidade = "alta" | "media" | "baixa";
export interface AchadoValidacao extends Achado {
  gravidade: Gravidade;
}

export interface ContextoValidacao {
  /** ids de CLI instaladas; ausente = não verifica (`cli_nao_instalada` só com workspace). */
  clisInstaladas?: readonly string[] | null;
  /** níveis de esforço nativos por CLI (`NIVEIS_POR_CLI`, A2); ausente = só confere contra o conjunto conhecido. */
  niveisEsforco?: (cli: string) => readonly string[] | null;
  /** como a CLI recebe o esforço; `indicativo`/`nenhum` gera aviso (D-204). */
  modoEsforco?: (cli: string) => ModoEsforco | null;
  /** catálogo de skills conhecidas (Fase 7) ou lista embarcada; ausente = não verifica. */
  skillsConhecidas?: ReadonlySet<string> | null;
  /** catálogo/Loja de MCPs; ausente = não verifica. */
  mcpsConhecidos?: ReadonlySet<string> | null;
  /** `max_parallel_panes` global (padrão 8). */
  maxParallelPanes?: number;
  /** permissão efetiva do workspace; membro mais permissivo gera aviso (D-232). */
  permissaoWorkspace?: PermissaoMembro | null;
  /** true ao GRAVAR: squad de fábrica é somente leitura (`fabrica_somente_leitura`). */
  paraGravar?: boolean;
}

const GRAVIDADE: Record<CodigoAchado, Gravidade> = {
  sem_orquestrador: "alta",
  orquestrador_duplicado: "alta",
  sem_revisor: "alta",
  poucos_membros: "alta",
  muitos_membros: "alta",
  slug_invalido: "alta",
  slug_duplicado: "alta",
  cli_desconhecida: "alta",
  cli_sem_intake: "alta",
  cli_nao_instalada: "media",
  modelo_invalido: "alta",
  esforco_invalido: "alta",
  esforco_indicativo: "baixa",
  faixa_invalida: "alta",
  variavel_desconhecida: "alta",
  prompt_grande: "alta",
  prompt_com_segredo: "alta",
  skill_desconhecida: "media",
  mcp_desconhecido: "media",
  limite_invalido: "alta",
  revisor_igual_ao_executor: "media",
  fabrica_somente_leitura: "alta",
  membro_sem_prompt: "alta",
  permissao_acima_do_workspace: "media",
};

function achado(severidade: Achado["severidade"], codigo: CodigoAchado, caminho: string, mensagem: string): AchadoValidacao {
  return { severidade, codigo, caminho, mensagem, gravidade: GRAVIDADE[codigo] };
}
const erro = (c: CodigoAchado, caminho: string, m: string): AchadoValidacao => achado("erro", c, caminho, m);
const aviso = (c: CodigoAchado, caminho: string, m: string): AchadoValidacao => achado("aviso", c, caminho, m);

/** Mesma regra de `MODELO_VALIDO` de `terminais/catalogo.ts` (não exportada lá). */
const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const NOME_LISTA = /^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,99}$/;
const ORDEM_PERMISSAO: Record<PermissaoMembro, number> = { seguro: 0, equilibrado: 1, automatico: 2 };
const FAIXAS_VALIDAS: readonly string[] = ["topo", "alto", "medio", "rapido"];

export function validarSlug(slug: unknown, caminho = "slug"): AchadoValidacao[] {
  if (typeof slug === "string" && PADRAO_SLUG.test(slug)) return [];
  return [erro("slug_invalido", caminho, "O identificador deve usar só letras minúsculas, números e hífen (até 40 caracteres), começando por letra ou número.")];
}

/** Nomes `{{...}}` encontrados no texto (sem repetição, na ordem). Texto entre chaves duplas que não é nome simples sai como está. */
export function extrairVariaveis(texto: string): string[] {
  const vistos = new Set<string>();
  for (const m of texto.matchAll(/\{\{([^{}]*)\}\}/g)) vistos.add((m[1] ?? "").trim());
  return [...vistos];
}

const PADROES_SEGREDO: readonly RegExp[] = [
  // chave privada INTEIRA (cabeçalho, corpo e fim; sem o fim, até o fim do texto): redigir só o cabeçalho deixaria o corpo
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bAIza[0-9A-Za-z_-]{35,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
  /\bAPI_?KEY\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{8,}/i,
  /\b(?:secret|password|passwd|senha|token|api[_-]?key|chave)\s*[:=]\s*["']?(?=[A-Za-z0-9/+_.-]*\d)[A-Za-z0-9/+_.-]{12,}/i,
];
export const pareceSegredo = (texto: string): boolean => PADROES_SEGREDO.some((p) => p.test(texto));

/**
 * Caminho absoluto de MÁQUINA em texto livre: POSIX com raiz conhecida (inclui `file://`), unidade do Windows ou UNC (`\\host\share`). O
 * lookbehind evita `src/etc/x`, `./tmp` e `../var`. Único lugar desta regra: o prompt, a exportação e a importação usam o mesmo.
 */
export const CAMINHO_ABSOLUTO_DE_MAQUINA = /(?<![\w.~-])(?:[A-Za-z]:[\\/]|\\\\[^\s\\/]+\\|\/(?:Users|home|root|var|private|tmp|opt|etc|mnt|Volumes|srv|usr|Applications|Library|System|proc|dev|run|nix|snap|bin|sbin)\/)[^\s"'`<>)\]]*/g;
export const contemCaminhoAbsoluto = (texto: string): boolean => new RegExp(CAMINHO_ABSOLUTO_DE_MAQUINA.source).test(texto);
/** Percorre os VALORES de texto de um objeto (não o JSON: a barra invertida escapada do JSON esconderia `C:\\` e UNC). */
export function contemCaminhoAbsolutoEmValores(valor: unknown, profundidade = 0): boolean {
  if (typeof valor === "string") return contemCaminhoAbsoluto(valor);
  if (profundidade > 12 || valor === null || typeof valor !== "object") return false;
  return Object.values(valor as Record<string, unknown>).some((v) => contemCaminhoAbsolutoEmValores(v, profundidade + 1));
}

const MARCA_REDIGIDO = "[segredo omitido]";
/** Troca o que parece segredo por uma marca (objetivo digitado na caixa de prompt: nunca vai ao banco, ao brief nem ao Pane com segredo). */
export function redigirSegredos(texto: string): string {
  return PADROES_SEGREDO.reduce((t, p) => t.replace(new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`), MARCA_REDIGIDO), texto);
}

const bytesDe = (texto: string): number => Buffer.byteLength(texto, "utf8");

/** Valida o texto do prompt de um membro (já sem frontmatter). `caminho` identifica o membro, ex.: `membros[2].prompt`. */
export function validarPrompt(texto: string, caminho = "prompt"): AchadoValidacao[] {
  const r: AchadoValidacao[] = [];
  if (texto.trim() === "") r.push(erro("membro_sem_prompt", caminho, "O prompt do membro está vazio."));
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(texto)) r.push(erro("membro_sem_prompt", caminho, "O prompt tem caracteres de controle ou binários; use só texto."));
  const bytes = bytesDe(texto);
  if (bytes > LIMITES_SQUAD.prompt_max_bytes) r.push(erro("prompt_grande", caminho, `O prompt tem ${bytes} bytes; o limite é ${LIMITES_SQUAD.prompt_max_bytes} (16 KiB).`));
  for (const nome of extrairVariaveis(texto)) {
    if (!(VARIAVEIS_PROMPT as readonly string[]).includes(nome)) {
      r.push(erro("variavel_desconhecida", caminho, `Variável desconhecida {{${nome.slice(0, 40)}}}. Permitidas: ${VARIAVEIS_PROMPT.map((v) => `{{${v}}}`).join(", ")}.`));
    }
  }
  if (pareceSegredo(texto)) r.push(erro("prompt_com_segredo", caminho, "O prompt parece conter um segredo (chave, token ou senha). Remova; use variáveis de ambiente no repositório."));
  return r;
}

function validarLimitesDe(o: { tempo_min: number | null; tokens: number | null }, caminho: string, r: AchadoValidacao[]): void {
  const t = o.tempo_min;
  if (t !== null && !(Number.isInteger(t) && t >= 1 && t <= LIMITES_SQUAD.tempo_min_max)) r.push(erro("limite_invalido", `${caminho}.tempo_min`, "O orçamento de tempo deve ser um inteiro de 1 a 1440 minutos, ou vazio."));
  const k = o.tokens;
  if (k !== null && !(Number.isInteger(k) && k >= 1)) r.push(erro("limite_invalido", `${caminho}.tokens`, "O orçamento de tokens deve ser um inteiro positivo, ou vazio."));
}

function validarListaPermitida(lista: readonly string[], caminho: string, conhecidos: ReadonlySet<string> | null | undefined, codigo: "skill_desconhecida" | "mcp_desconhecido", r: AchadoValidacao[]): void {
  if (lista.length > LIMITES_SQUAD.lista_permitidos_max) r.push(erro("limite_invalido", caminho, `No máximo ${LIMITES_SQUAD.lista_permitidos_max} itens.`));
  const vistos = new Set<string>();
  lista.forEach((nome, i) => {
    const c = `${caminho}[${i}]`;
    if (typeof nome !== "string" || !NOME_LISTA.test(nome)) {
      r.push(erro("limite_invalido", c, "Nome inválido (use letras, números e : . _ - /)."));
      return;
    }
    if (vistos.has(nome)) return;
    vistos.add(nome);
    if (conhecidos != null && !conhecidos.has(nome)) {
      r.push(aviso(codigo, c, codigo === "skill_desconhecida" ? `A skill "${nome}" não existe no catálogo; ela será ignorada (deny-by-default).` : `O MCP "${nome}" não existe no catálogo nem na Loja; ele será ignorado.`));
    }
  });
}

/** Valida um membro isolado. `caminho` ex.: `membros[2]`. A composição da squad (1 orquestrador etc.) é do `validarSquad`. */
export function validarMembro(m: Membro, ctx: ContextoValidacao = {}, caminho = "membros[0]"): AchadoValidacao[] {
  const r: AchadoValidacao[] = [];
  r.push(...validarSlug(m.slug, `${caminho}.slug`));
  if (!(PAPEIS_SQUAD as readonly string[]).includes(m.papel)) r.push(erro("limite_invalido", `${caminho}.papel`, "O papel deve ser orchestrator, scout, executor ou reviewer."));
  if (typeof m.rotulo !== "string" || m.rotulo.trim().length < 1 || m.rotulo.length > LIMITES_SQUAD.rotulo_max) r.push(erro("limite_invalido", `${caminho}.rotulo`, `O rótulo deve ter de 1 a ${LIMITES_SQUAD.rotulo_max} caracteres.`));
  if (typeof m.descricao !== "string" || m.descricao.length > LIMITES_SQUAD.descricao_membro_max) r.push(erro("limite_invalido", `${caminho}.descricao`, `A descrição do membro deve ter até ${LIMITES_SQUAD.descricao_membro_max} caracteres.`));
  if (m.prompt !== caminhoPromptDe(m.slug)) r.push(erro("membro_sem_prompt", `${caminho}.prompt`, `O prompt do membro precisa estar em ${caminhoPromptDe(String(m.slug))}.`));

  const cli = m.perfil.cli;
  const cliOk = cli === CLI_AUTO || (CLIS_CATALOGO as readonly string[]).includes(cli);
  if (!cliOk) r.push(erro("cli_desconhecida", `${caminho}.perfil.cli`, `A CLI "${String(cli).slice(0, 30)}" não é conhecida. Use ${CLIS_CATALOGO.join(", ")} ou auto.`));
  else if (m.papel === "orchestrator" && cli !== CLI_AUTO && !(CLIS_COM_INTAKE as readonly string[]).includes(cli)) {
    r.push(erro("cli_sem_intake", `${caminho}.perfil.cli`, `O orquestrador precisa de uma CLI com contrato de intake (${CLIS_COM_INTAKE.join(", ")}); "${cli}" não tem. Sugestão: claude.`));
  }
  if (cliOk && cli !== CLI_AUTO && ctx.clisInstaladas != null && !ctx.clisInstaladas.includes(cli)) {
    r.push(aviso("cli_nao_instalada", `${caminho}.perfil.cli`, `A CLI "${cli}" não está instalada ou habilitada; o pré-voo sugere uma substituta.`));
  }
  if (m.perfil.modelo !== null && m.perfil.modelo !== "default" && !MODELO_VALIDO.test(m.perfil.modelo)) {
    r.push(erro("modelo_invalido", `${caminho}.perfil.modelo`, "Nome de modelo inválido (use letras, números e . _ : / @ -, sem espaço e sem começar por hífen)."));
  }
  if (!FAIXAS_VALIDAS.includes(m.perfil.faixa)) r.push(erro("faixa_invalida", `${caminho}.perfil.faixa`, "A faixa deve ser topo, alto, medio ou rapido."));
  const esf = m.perfil.esforco;
  if (esf !== null) {
    const nativos = cliOk && cli !== CLI_AUTO ? (ctx.niveisEsforco?.(cli) ?? null) : null;
    const neutro = (["baixo", "medio", "alto"] as readonly string[]).includes(esf);
    if (!ESFORCOS_CONHECIDOS.includes(esf)) r.push(erro("esforco_invalido", `${caminho}.perfil.esforco`, `Nível de esforço "${esf.slice(0, 30)}" desconhecido.`));
    else if (!neutro && nativos !== null && nativos.length > 0 && !nativos.includes(esf)) {
      r.push(erro("esforco_invalido", `${caminho}.perfil.esforco`, `A CLI "${cli}" não aceita o nível "${esf}". Aceitos: ${nativos.join(", ")}.`));
    } else {
      const modo = cliOk && cli !== CLI_AUTO ? (ctx.modoEsforco?.(cli) ?? null) : null;
      if (modo === "indicativo" || modo === "nenhum") r.push(aviso("esforco_indicativo", `${caminho}.perfil.esforco`, `A CLI "${cli}" não recebe esforço por parâmetro; o nível entra só como instrução no prompt (indicativo).`));
    }
  }
  validarListaPermitida(m.skills_permitidas, `${caminho}.skills_permitidas`, ctx.skillsConhecidas, "skill_desconhecida", r);
  validarListaPermitida(m.mcps_permitidos, `${caminho}.mcps_permitidos`, ctx.mcpsConhecidos, "mcp_desconhecido", r);
  validarListaPermitida(m.hooks, `${caminho}.hooks`, null, "skill_desconhecida", r);

  const maxInst = m.papel === "orchestrator" ? 1 : LIMITES_SQUAD.instancias_max;
  if (!Number.isInteger(m.max_instancias) || m.max_instancias < LIMITES_SQUAD.instancias_min || m.max_instancias > maxInst) {
    r.push(erro("limite_invalido", `${caminho}.max_instancias`, m.papel === "orchestrator" ? "O orquestrador tem sempre 1 instância." : `As instâncias do membro devem ir de 1 a ${LIMITES_SQUAD.instancias_max}.`));
  }
  validarLimitesDe(m.orcamento, `${caminho}.orcamento`, r);
  if (m.orcamento.modo !== "soft" && m.orcamento.modo !== "rigido") r.push(erro("limite_invalido", `${caminho}.orcamento.modo`, 'O modo do orçamento é "soft" ou "rigido".'));
  if (m.rigidez !== null && !(NIVEIS_RIGIDEZ as readonly number[]).includes(m.rigidez)) r.push(erro("limite_invalido", `${caminho}.rigidez`, "A rigidez deve ser de 1 a 5 ou vazia (herda)."));
  if (m.permissao !== null) {
    if (!(PERMISSOES_MEMBRO as readonly string[]).includes(m.permissao)) r.push(erro("limite_invalido", `${caminho}.permissao`, "A permissão deve ser seguro, equilibrado, automatico ou vazia (herda)."));
    else if (ctx.permissaoWorkspace != null && ORDEM_PERMISSAO[m.permissao] > ORDEM_PERMISSAO[ctx.permissaoWorkspace]) {
      r.push(aviso("permissao_acima_do_workspace", `${caminho}.permissao`, `A permissão "${m.permissao}" do membro é mais permissiva que a do workspace ("${ctx.permissaoWorkspace}"); confirme ao salvar.`));
    }
  }
  return r;
}

/** Validação completa (estrutura + composição + cada membro). Pura; alvo: ≤ 5 ms por squad (P-201). */
export function validarSquad(s: Squad, ctx: ContextoValidacao = {}): AchadoValidacao[] {
  const r: AchadoValidacao[] = [];
  if (ctx.paraGravar === true && s.origem === "fabrica") r.push(erro("fabrica_somente_leitura", "origem", 'Squad de fábrica é somente leitura: use "Duplicar para editar".'));
  r.push(...validarSlug(s.slug));
  if (typeof s.nome !== "string" || s.nome.trim().length < 1 || s.nome.length > LIMITES_SQUAD.rotulo_max * 2) r.push(erro("limite_invalido", "nome", "O nome deve ter de 1 a 80 caracteres."));
  if (typeof s.descricao !== "string" || s.descricao.length > LIMITES_SQUAD.descricao_squad_max) r.push(erro("limite_invalido", "descricao", `A descrição deve ter até ${LIMITES_SQUAD.descricao_squad_max} caracteres.`));
  if (!(ESCOPOS_SQUAD as readonly string[]).includes(s.escopo)) r.push(erro("limite_invalido", "escopo", `O escopo deve ser um de: ${ESCOPOS_SQUAD.join(", ")}.`));
  if (s.rigidez_padrao !== null && !(NIVEIS_RIGIDEZ as readonly number[]).includes(s.rigidez_padrao)) r.push(erro("limite_invalido", "rigidez_padrao", "A rigidez padrão deve ser de 1 a 5 ou vazia."));
  const teto = ctx.maxParallelPanes ?? LIMITES_SQUAD.instancias_max;
  if (!Number.isInteger(s.max_instancias_paralelas) || s.max_instancias_paralelas < 1 || s.max_instancias_paralelas > teto) {
    r.push(erro("limite_invalido", "max_instancias_paralelas", `Os terminais paralelos da squad devem ir de 1 a ${teto} (limite global).`));
  }
  validarLimitesDe(s.orcamento, "orcamento", r);
  if (s.portoes !== null && (!Array.isArray(s.portoes) || s.portoes.some((p) => !["direction", "content", "build", "qa"].includes(p)))) r.push(erro("limite_invalido", "portoes", "Os portões pendentes devem ser um subconjunto de direction, content, build e qa."));

  const n = s.membros.length;
  if (n < LIMITES_SQUAD.membros_min) r.push(erro("poucos_membros", "membros", `A squad precisa de pelo menos ${LIMITES_SQUAD.membros_min} membros (orquestrador, revisor e um executor ou explorador); tem ${n}.`));
  if (n > LIMITES_SQUAD.membros_max) r.push(erro("muitos_membros", "membros", `A squad aceita no máximo ${LIMITES_SQUAD.membros_max} membros; tem ${n}.`));
  const orqs = s.membros.filter((m) => m.papel === "orchestrator").length;
  if (orqs === 0) r.push(erro("sem_orquestrador", "membros", "A squad precisa de exatamente 1 orquestrador; não tem nenhum."));
  if (orqs > 1) r.push(erro("orquestrador_duplicado", "membros", `A squad precisa de exatamente 1 orquestrador; tem ${orqs}.`));
  if (!s.membros.some((m) => m.papel === "reviewer")) r.push(erro("sem_revisor", "membros", "Sem revisor a Missão nunca conclui: inclua pelo menos 1 membro com papel revisor."));

  const slugs = new Map<string, number>();
  s.membros.forEach((m, i) => {
    const c = `membros[${i}]`;
    const anterior = slugs.get(m.slug);
    if (anterior !== undefined) r.push(erro("slug_duplicado", `${c}.slug`, `O identificador "${m.slug}" já é usado pelo membro ${anterior + 1}.`));
    else slugs.set(m.slug, i);
    if (typeof s.slug === "string" && typeof m.slug === "string" && s.slug.length + 1 + m.slug.length > LIMITES_SQUAD.agent_id_max) r.push(erro("slug_invalido", `${c}.slug`, `O identificador do agente (squad.membro) passa de ${LIMITES_SQUAD.agent_id_max} caracteres.`));
    r.push(...validarMembro(m, ctx, c));
  });

  // independência de revisão (D-21): revisor com o mesmo (cli, modelo) de um executor.
  const exec = s.membros.filter((m) => m.papel === "executor");
  s.membros.forEach((m, i) => {
    if (m.papel !== "reviewer") return;
    const igual = exec.find((e) => e.perfil.cli === m.perfil.cli && (e.perfil.modelo ?? "default") === (m.perfil.modelo ?? "default"));
    if (igual !== undefined) r.push(aviso("revisor_igual_ao_executor", `membros[${i}].perfil`, `O revisor usa a mesma CLI e modelo do executor "${igual.slug}"; prefira outro modelo ou provedor para uma revisão independente.`));
  });
  return r;
}

export const temErro = (achados: readonly Achado[]): boolean => achados.some((a) => a.severidade === "erro");
