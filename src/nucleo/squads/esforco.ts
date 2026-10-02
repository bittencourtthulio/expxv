// T-14.05 · Esforço por CLI (D-204, P-230). PURO: sem I/O, sem relógio. Níveis normalizados + mapeamento por CLI
// para o mecanismo REAL (flag/config) quando confirmado, ou `indicativo` (instrução no prompt) quando não existe.
// Os dados vivem em `resources/squads/esforco-por-cli.json` (editável, versionado); `TABELA_ESFORCO_PADRAO` é o
// espelho embutido (um teste garante que os dois não divergem). Regra de ouro: NUNCA inventar flag — entrada não
// confirmada, CLI sem mecanismo ou flag ausente do `--help` detectado viram `indicativo`.
import { CLIS_CATALOGO } from "../../compartilhado/squads";

export const NIVEIS_ESFORCO = ["minimo", "baixo", "medio", "alto", "maximo"] as const;
export type NivelEsforco = (typeof NIVEIS_ESFORCO)[number];
export type TipoEsforco = "flag" | "config" | "indicativo";

export interface EntradaEsforcoCli {
  tipo: TipoEsforco;
  /** o mecanismo foi confirmado por `--help` local ou documentação pública? `false` => sempre `indicativo`. */
  confirmado: boolean;
  /** de onde veio a confirmação (ou por que não há). Só informativo. */
  fonte: string;
  /** `flag`: nome da flag, ex.: `--effort`. */
  flag?: string;
  /** `config`: chave passada por `-c chave="valor"`. */
  chave?: string;
  /** flag/trecho que deve aparecer no `--help` detectado para o mecanismo valer (cai para indicativo se faltar). */
  flag_help?: string;
  /** níveis nativos aceitos pela CLI (aceitos diretamente, sem normalizar). */
  niveis_nativos?: string[];
  /** nível normalizado → valor nativo. */
  mapa?: Partial<Record<NivelEsforco, string>>;
  nota?: string;
}
export interface TabelaEsforco {
  versao: number;
  clis: Record<string, EntradaEsforcoCli>;
}

export class CliDesconhecidaErro extends Error {
  readonly codigo = "cli_desconhecida";
  constructor(readonly cli: string) {
    super(`CLI desconhecida: ${cli}`);
    this.name = "CliDesconhecidaErro";
  }
}
export class EsforcoInvalidoErro extends Error {
  readonly codigo = "esforco_invalido";
  constructor(readonly cli: string, readonly nivel: string) {
    super(`Nível de esforço inválido para ${cli}: ${nivel}`);
    this.name = "EsforcoInvalidoErro";
  }
}

const SEM_MECANISMO = (fonte: string, nota?: string): EntradaEsforcoCli => ({ tipo: "indicativo", confirmado: false, fonte, ...(nota === undefined ? {} : { nota }) });

/** Espelho embutido de `resources/squads/esforco-por-cli.json`. Só entra o que `--help` local ou documentação pública confirmou. */
export const TABELA_ESFORCO_PADRAO: TabelaEsforco = {
  versao: 1,
  clis: {
    claude: {
      tipo: "flag",
      confirmado: true,
      fonte: "`claude --help` local: --effort <level> (low, medium, high, xhigh, max)",
      flag: "--effort",
      flag_help: "--effort",
      niveis_nativos: ["low", "medium", "high", "xhigh", "max"],
      mapa: { minimo: "low", baixo: "low", medio: "medium", alto: "high", maximo: "max" },
    },
    codex: {
      tipo: "config",
      confirmado: true,
      fonte: "`codex --help` local: -c, --config <key=value>; chave model_reasoning_effort presente no binário e na documentação pública do Codex",
      chave: "model_reasoning_effort",
      flag_help: "--config",
      niveis_nativos: ["minimal", "low", "medium", "high", "xhigh"],
      mapa: { minimo: "minimal", baixo: "low", medio: "medium", alto: "high", maximo: "xhigh" },
    },
    aider: {
      tipo: "flag",
      confirmado: true,
      fonte: "documentação pública do aider (opções: --reasoning-effort); CLI não instalada nesta máquina, não verificada por --help local",
      flag: "--reasoning-effort",
      flag_help: "--reasoning-effort",
      niveis_nativos: ["low", "medium", "high"],
      mapa: { minimo: "low", baixo: "low", medio: "medium", alto: "high", maximo: "high" },
    },
    opencode: SEM_MECANISMO("`opencode --help` local: --variant existe só em `opencode run` (valores dependem do provedor); sessão interativa sem flag de esforço", "usa instrução no prompt"),
    kilo: SEM_MECANISMO("`kilo --help` local: --variant existe só em `kilo run` (valores dependem do provedor); sessão interativa sem flag de esforço", "usa instrução no prompt"),
    gemini: SEM_MECANISMO("nenhum parâmetro de esforço confirmado; CLI não instalada nesta máquina", "usa instrução no prompt"),
    qwen: SEM_MECANISMO("nenhum parâmetro de esforço confirmado; CLI não instalada nesta máquina", "usa instrução no prompt"),
    grok: SEM_MECANISMO("`grok --help` local 1.0.46: --reasoning-effort <EFFORT> (alias --effort) existe, mas a ajuda não lista os níveis (a documentação instalada cita none..max e cada modelo aceita só os que anuncia): indicativo até o dono confirmar", "usa instrução no prompt"),
  },
};

// ---- normalização ----
const NATIVO_PARA_NIVEL: Readonly<Record<string, NivelEsforco>> = {
  minimal: "minimo",
  low: "baixo",
  medium: "medio",
  high: "alto",
  xhigh: "maximo",
  max: "maximo",
};
const ehNivel = (v: string): v is NivelEsforco => (NIVEIS_ESFORCO as readonly string[]).includes(v);

/** `minimo..maximo` ou nome nativo conhecido (`low`, `xhigh`…) → nível normalizado; `null` se desconhecido. */
export function normalizarNivel(nivel: string): NivelEsforco | null {
  if (ehNivel(nivel)) return nivel;
  return NATIVO_PARA_NIVEL[nivel] ?? null;
}

/** Mapa neutro (D-204): faixa → esforço sugerido. Usado por receitas e UI; nunca aplicado sem o membro pedir. */
export function esforcoSugeridoDaFaixa(faixa: "topo" | "alto" | "medio" | "rapido"): NivelEsforco {
  return faixa === "topo" || faixa === "alto" ? "alto" : faixa === "medio" ? "medio" : "baixo";
}

const TEXTO_INDICATIVO: Readonly<Record<NivelEsforco, string>> = {
  minimo: "faça o mínimo necessário para o pedido, sem explorar além dele",
  baixo: "seja direto e objetivo; explore pouco e entregue rápido",
  medio: "equilibre rapidez e cuidado; confira o essencial antes de entregar",
  alto: "verifique mais, explore alternativas, revise antes de entregar",
  maximo: "raciocine a fundo, considere casos de borda e alternativas e revise tudo duas vezes antes de entregar",
};

/** Instrução (PT-BR) injetada no prompt quando o esforço não tem mecanismo real. Sem dado do usuário. */
export function textoIndicativo(nivel: NivelEsforco): string {
  return `## Nível de esforço desejado: ${nivel} — ${TEXTO_INDICATIVO[nivel]}`;
}

export interface ResultadoEsforco {
  tipo: TipoEsforco;
  /** argumentos separados (sem shell) — só `flag`/`config`. */
  argv?: string[];
  /** instrução para o prompt — só `indicativo`. */
  texto?: string;
  /** `true` só quando há mecanismo real confirmado. `indicativo` nunca é confiável (selo na UI). */
  confiavel: boolean;
  nivel: NivelEsforco;
  /** valor nativo enviado à CLI (`flag`/`config`). */
  nivel_nativo: string | null;
  /** motivo da queda para `indicativo` (flag não detectada, entrada não confirmada…). */
  aviso?: string;
}

export interface OpcoesEsforco {
  tabela?: TabelaEsforco;
  /** texto do `--help` (ou conjunto de flags) detectado; `null`/ausente = não detectado (vale a tabela). */
  flagsDetectadas?: ReadonlySet<string> | string | null;
}

function temFlag(detectadas: ReadonlySet<string> | string, flag: string): boolean {
  return typeof detectadas === "string" ? detectadas.includes(flag) : detectadas.has(flag);
}

function indicativo(nivel: NivelEsforco, aviso?: string): ResultadoEsforco {
  return { tipo: "indicativo", texto: textoIndicativo(nivel), confiavel: false, nivel, nivel_nativo: null, ...(aviso === undefined ? {} : { aviso }) };
}

/**
 * Pura. `nivel` aceita os 5 normalizados ou um nome nativo. Nível desconhecido => `EsforcoInvalidoErro`; CLI fora da
 * tabela => `CliDesconhecidaErro`. Nunca devolve argumento que comece com `-` além da própria flag da tabela.
 */
export function esforcoParaCli(cli: string, nivel: string, opcoes: OpcoesEsforco = {}): ResultadoEsforco {
  const tabela = opcoes.tabela ?? TABELA_ESFORCO_PADRAO;
  const entrada = Object.hasOwn(tabela.clis, cli) ? tabela.clis[cli] : undefined;
  if (entrada === undefined) throw new CliDesconhecidaErro(cli);
  const normalizado = normalizarNivel(nivel);
  if (normalizado === null) throw new EsforcoInvalidoErro(cli, nivel);

  if (entrada.tipo === "indicativo") return indicativo(normalizado);
  if (!entrada.confirmado) return indicativo(normalizado, `mecanismo de esforço de ${cli} não confirmado; usando instrução no prompt`);
  const detectadas = opcoes.flagsDetectadas;
  if (detectadas !== null && detectadas !== undefined && entrada.flag_help !== undefined && !temFlag(detectadas, entrada.flag_help)) {
    return indicativo(normalizado, `${cli} não lista ${entrada.flag_help} no --help; usando instrução no prompt`);
  }
  // nome nativo da própria CLI vale como está; senão o mapa do nível normalizado
  const nativo = entrada.niveis_nativos?.includes(nivel) === true ? nivel : entrada.mapa?.[normalizado];
  if (nativo === undefined) return indicativo(normalizado, `${cli} não mapeia o nível ${normalizado}; usando instrução no prompt`);
  if (entrada.tipo === "flag" && entrada.flag !== undefined) return { tipo: "flag", argv: [entrada.flag, nativo], confiavel: true, nivel: normalizado, nivel_nativo: nativo };
  if (entrada.tipo === "config" && entrada.chave !== undefined) return { tipo: "config", argv: ["-c", `${entrada.chave}=${JSON.stringify(nativo)}`], confiavel: true, nivel: normalizado, nivel_nativo: nativo };
  return indicativo(normalizado, `entrada de ${cli} incompleta; usando instrução no prompt`);
}

/** Níveis oferecidos pela CLI na UI (`agentes:perfil_opcoes`): nativos se há mecanismo confiável, senão os 5 normalizados. */
export function niveisDaCli(cli: string, tabela: TabelaEsforco = TABELA_ESFORCO_PADRAO): { niveis: string[]; modo: TipoEsforco } {
  const e = Object.hasOwn(tabela.clis, cli) ? tabela.clis[cli] : undefined;
  if (e === undefined) throw new CliDesconhecidaErro(cli);
  if (e.tipo !== "indicativo" && e.confirmado) return { niveis: [...(e.niveis_nativos ?? [])], modo: e.tipo };
  return { niveis: [...NIVEIS_ESFORCO], modo: "indicativo" };
}

// ---- validação da tabela editável ----
export interface ErroTabelaEsforco {
  campo: string;
  motivo: string;
}
const FLAG_OK = /^--[a-z][a-z0-9-]{0,39}$/;
const CHAVE_OK = /^[a-z_][a-z0-9_.]{0,63}$/;
const VALOR_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validarTabelaEsforco(bruto: unknown): { ok: true; valor: TabelaEsforco } | { ok: false; erros: ErroTabelaEsforco[] } {
  const erros: ErroTabelaEsforco[] = [];
  if (!ehObj(bruto) || !ehObj(bruto.clis) || typeof bruto.versao !== "number") return { ok: false, erros: [{ campo: "", motivo: "esperado { versao, clis }" }] };
  const clis: Record<string, EntradaEsforcoCli> = {};
  for (const [cli, e] of Object.entries(bruto.clis)) {
    const c = `clis.${cli}`;
    if (!(CLIS_CATALOGO as readonly string[]).includes(cli)) { erros.push({ campo: c, motivo: "CLI fora do catálogo" }); continue; }
    if (!ehObj(e)) { erros.push({ campo: c, motivo: "esperado objeto" }); continue; }
    const n0 = erros.length;
    if (e.tipo !== "flag" && e.tipo !== "config" && e.tipo !== "indicativo") erros.push({ campo: `${c}.tipo`, motivo: "flag|config|indicativo" });
    if (typeof e.confirmado !== "boolean") erros.push({ campo: `${c}.confirmado`, motivo: "esperado booleano" });
    if (typeof e.fonte !== "string" || e.fonte.length === 0) erros.push({ campo: `${c}.fonte`, motivo: "esperado texto (origem da confirmação)" });
    if (e.tipo === "flag" && (typeof e.flag !== "string" || !FLAG_OK.test(e.flag))) erros.push({ campo: `${c}.flag`, motivo: "flag inválida" });
    if (e.tipo === "config" && (typeof e.chave !== "string" || !CHAVE_OK.test(e.chave))) erros.push({ campo: `${c}.chave`, motivo: "chave inválida" });
    if (e.flag_help !== undefined && (typeof e.flag_help !== "string" || e.flag_help.length > 40 || /\s/.test(e.flag_help))) erros.push({ campo: `${c}.flag_help`, motivo: "texto curto sem espaço" });
    if (e.niveis_nativos !== undefined && (!Array.isArray(e.niveis_nativos) || e.niveis_nativos.some((v) => typeof v !== "string" || !VALOR_OK.test(v)))) erros.push({ campo: `${c}.niveis_nativos`, motivo: "valores inválidos" });
    if (e.tipo !== "indicativo") {
      if (!ehObj(e.mapa)) erros.push({ campo: `${c}.mapa`, motivo: "esperado objeto" });
      else for (const n of NIVEIS_ESFORCO) {
        const v = e.mapa[n];
        if (typeof v !== "string" || !VALOR_OK.test(v)) erros.push({ campo: `${c}.mapa.${n}`, motivo: "valor nativo ausente ou inválido (não pode começar com '-')" });
      }
    }
    if (erros.length === n0) clis[cli] = e as unknown as EntradaEsforcoCli;
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valor: { versao: bruto.versao, clis } };
}

/** Texto do JSON editável → tabela. Ausente/corrompido/inválido => padrão embutido + avisos (nunca lança). */
export function carregarTabelaEsforco(texto: string | null): { tabela: TabelaEsforco; avisos: string[] } {
  if (texto === null) return { tabela: TABELA_ESFORCO_PADRAO, avisos: [] };
  let bruto: unknown;
  try { bruto = JSON.parse(texto); } catch { return { tabela: TABELA_ESFORCO_PADRAO, avisos: ["esforco-por-cli.json ilegível; usando a tabela embutida"] }; }
  const r = validarTabelaEsforco(bruto);
  if (!r.ok) return { tabela: TABELA_ESFORCO_PADRAO, avisos: r.erros.map((e) => `esforco-por-cli.json: ${e.campo} ${e.motivo}`) };
  // CLIs que o arquivo omitiu continuam com o padrão embutido
  return { tabela: { versao: r.valor.versao, clis: { ...TABELA_ESFORCO_PADRAO.clis, ...r.valor.clis } }, avisos: [] };
}
