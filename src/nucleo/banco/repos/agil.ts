// Repositórios SQLite da gestão ágil (Fase 18, T-18.02): implementam `BancoAgil` (nucleo/agil/repos.ts) sobre as tabelas `agil_*` (migration 0011).
// Cada coleção é WRITE-THROUGH com cache em memória: o núcleo é síncrono e relê coleções inteiras (`valores()`) com frequência; o cache evita
// reparse de JSON, e quem escreve nessas tabelas é só este processo. Escrita = SQL primeiro (falha não suja o cache) e depois o mapa.
// `transacao` usa o `Banco.transacao` (BEGIN IMMEDIATE / SAVEPOINT); se lançar, TODOS os caches são descartados e relidos do disco (rollback coerente).
// Upsert por `ON CONFLICT DO UPDATE` (nunca REPLACE: REPLACE apagaria filhos por CASCADE). Valores nunca são mutados no lugar.
import type {
  Classificacao, ConfigAgil, EpicoAgil, Estimativa, EventoAgil, EventoRetrabalho, FatoTask, ItemAgil, MembroAgil, SprintAgil, SprintItemAgil, TaskRetrabalho,
} from "../../../compartilhado/agil";
import type {
  BancoAgil, CerimoniaRegistro, Colecao, DemoRegistro, ErroEstimativaRegistro, RegistroAuditoria, ResultadoDodRegistro, RetroAcao, RetroItem, SnapshotMetrica,
} from "../../agil/repos";
import type { Banco, Declaracao, Linha, Valor } from "../banco";

type Tipo = "t" | "n" | "b" | "bn" | "j" | "jn";
interface Col<T> { c: string; f: keyof T & string; t: Tipo }
const col = <T>(f: keyof T & string, t: Tipo = "t", c: string = f): Col<T> => ({ c, f, t });

function codificar(t: Tipo, v: unknown): Valor {
  if (t === "b") return v ? 1 : 0;
  if (t === "bn") return v === null || v === undefined ? null : v ? 1 : 0;
  if (t === "j") return JSON.stringify(v ?? null);
  if (t === "jn") return v === null || v === undefined ? null : JSON.stringify(v);
  if (v === undefined) return null;
  return v as Valor;
}
function decodificar(t: Tipo, v: unknown): unknown {
  if (t === "b") return Number(v) === 1;
  if (t === "bn") return v === null || v === undefined ? null : Number(v) === 1;
  if (t === "j") return JSON.parse(String(v));
  if (t === "jn") return v === null || v === undefined ? null : JSON.parse(String(v));
  return v ?? null;
}

interface Espec<T> {
  tabela: string;
  colunas: Col<T>[];
  /** colunas da chave primária (nomes de coluna). */
  pk: string[];
  /** chave do cache a partir do valor lido (o mesmo formato que o núcleo usa em `set`). */
  chaveDe: (v: T) => string;
  /** colunas extras que não vêm do valor (ex.: `atualizado_em`). */
  extras?: (v: T) => Record<string, Valor>;
  /** monta o valor a partir da linha (padrão: pelas colunas). */
  doLinha?: (l: Linha) => T;
  /** ordem estável do carregamento. */
  ordem?: string;
  /** efeito colateral após gravar/apagar (ex.: aliases do membro). */
  aposGravar?: (banco: Banco, v: T) => void;
  aposApagar?: (banco: Banco, v: T) => void;
  /** pós-processamento da lista carregada (ex.: juntar aliases). */
  aoCarregar?: (banco: Banco, valores: T[]) => void;
}

/** coleção com cache; `invalidar()` força releitura. */
export interface ColecaoSqlite<T> extends Colecao<T> { invalidar(): void }

function colecao<T>(banco: Banco, e: Espec<T>): ColecaoSqlite<T> {
  let mapa: Map<string, T> | null = null;
  let upsert: Declaracao | null = null;
  let apagar: Declaracao | null = null;
  const nomes = (v: T): { cols: string[]; vals: Valor[] } => {
    const cols = e.colunas.map((c) => c.c);
    const vals = e.colunas.map((c) => codificar(c.t, (v as Record<string, unknown>)[c.f]));
    for (const [k, x] of Object.entries(e.extras?.(v) ?? {})) { cols.push(k); vals.push(x); }
    return { cols, vals };
  };
  const carregar = (): Map<string, T> => {
    if (mapa) return mapa;
    const m = new Map<string, T>();
    const linhas = banco.consultar(`SELECT * FROM ${e.tabela}${e.ordem ? ` ORDER BY ${e.ordem}` : ""}`);
    const vs = linhas.map((l) => (e.doLinha ? e.doLinha(l) : (Object.fromEntries(e.colunas.map((c) => [c.f, decodificar(c.t, l[c.c])])) as T)));
    e.aoCarregar?.(banco, vs);
    for (const v of vs) m.set(e.chaveDe(v), v);
    mapa = m;
    return m;
  };
  return {
    get: (k) => carregar().get(k),
    valores: () => [...carregar().values()],
    set(k, v) {
      const m = carregar();
      const { cols, vals } = nomes(v);
      if (!upsert) {
        const ph = cols.map(() => "?").join(",");
        const sets = cols.filter((c) => !e.pk.includes(c)).map((c) => `${c}=excluded.${c}`);
        const sql = `INSERT INTO ${e.tabela} (${cols.join(",")}) VALUES (${ph}) ON CONFLICT (${e.pk.join(",")}) ${sets.length ? `DO UPDATE SET ${sets.join(",")}` : "DO NOTHING"}`;
        upsert = banco.preparar(sql);
      }
      upsert.executar(vals);
      e.aposGravar?.(banco, v);
      m.set(k, v);
    },
    delete(k) {
      const m = carregar();
      const v = m.get(k);
      if (v === undefined) return false;
      const { cols, vals } = nomes(v);
      if (!apagar) apagar = banco.preparar(`DELETE FROM ${e.tabela} WHERE ${e.pk.map((c) => `${c}=?`).join(" AND ")}`);
      apagar.executar(e.pk.map((c) => vals[cols.indexOf(c)] as Valor));
      e.aposApagar?.(banco, v);
      m.delete(k);
      return true;
    },
    invalidar() { mapa = null; },
  };
}

// ------------------------------------------------------------------ especificações por tabela
const tsAgora = (): string => new Date().toISOString();

const itens: Espec<ItemAgil> = {
  tabela: "agil_item", pk: ["id"], chaveDe: (v) => v.id, ordem: "ordem, id",
  colunas: [
    col("id"), col("workspace_id"), col("origem"), col("trabalho_id"), col("task_ref"), col("epico_id"), col("titulo"), col("descricao"), col("criterios", "j", "criterios_json"),
    col("estado_ade"), col("valor", "n"), col("urgencia", "n"), col("reducao_risco", "n"), col("moscow"), col("ordem", "n"), col("dono_membro_id"), col("par_membro_id"),
    col("visibilidade_cliente"), col("resumo_cliente"), col("resumo_cliente_origem"), col("changelog_tipo"), col("origem_ref", "jn", "origem_ref_json"), col("descartado_motivo"),
    col("orfao", "b"), col("criado_em"), col("atualizado_em"),
  ],
};
const epicos: Espec<EpicoAgil> = {
  tabela: "agil_epico", pk: ["id"], chaveDe: (v) => v.id, ordem: "ordem, id",
  colunas: [col("id"), col("workspace_id"), col("titulo"), col("descricao"), col("estado"), col("ordem", "n"), col("criado_em"), col("atualizado_em")],
};
const estimativas: Espec<Estimativa> = {
  tabela: "agil_estimativa", pk: ["id"], chaveDe: (v) => v.id, ordem: "item_id, versao",
  colunas: [
    col("id"), col("item_id"), col("versao", "n"), col("pontos", "n"), col("rotulo"), col("escala_id"), col("min_h", "n"), col("max_h", "n"), col("origem"), col("motor"),
    col("confianca", "n"), col("fatores", "j", "fatores_json"), col("estado"), col("ativa", "b"), col("nota"), col("criado_em"),
  ],
};
const classificacoes: Espec<Classificacao> = {
  tabela: "agil_classificacao", pk: ["id"], chaveDe: (v) => v.id, ordem: "item_id, versao",
  colunas: [
    col("id"), col("item_id"), col("versao", "n"), col("categoria"), col("risco"), col("criticidade"), col("tipo_task"), col("risco_fatores", "j", "risco_fatores_json"),
    col("origem"), col("motor"), col("confianca", "n"), col("estado"), col("ativa", "b"), col("criado_em"),
  ],
};
const sprints: Espec<SprintAgil> = {
  tabela: "agil_sprint", pk: ["id"], chaveDe: (v) => v.id, ordem: "inicio, id",
  colunas: [
    col("id"), col("workspace_id"), col("nome"), col("meta"), col("inicio"), col("fim"), col("estado"), col("capacidade_pontos", "n"), col("compromisso_pontos", "n"), col("iniciada_em"),
    col("fechada_em"), col("versao_lancamento"), col("resumo_fechamento", "jn", "resumo_fechamento_json"), col("criado_em"), col("atualizado_em"),
  ],
};
const sprintItens: Espec<SprintItemAgil> = {
  tabela: "agil_sprint_item", pk: ["sprint_id", "item_id"], chaveDe: (v) => `${v.sprint_id}|${v.item_id}`, ordem: "sprint_id, adicionado_em, item_id",
  colunas: [
    col("sprint_id"), col("item_id"), col("adicionado_em"), col("removido_em"), col("pontos_compromisso", "n"), col("no_compromisso_inicial", "b"), col("motivo"), col("resultado"),
  ],
};
const membros: Espec<MembroAgil> = {
  tabela: "agil_membro", pk: ["id"], chaveDe: (v) => v.id, ordem: "id",
  colunas: [col("id"), col("workspace_id"), col("tipo"), col("rotulo"), col("squad_id"), col("horas_dia", "n"), col("fator_foco", "n"), col("pontos_sprint_fixo", "n"), col("ativo", "b")],
  extras: () => ({ criado_em: tsAgora(), atualizado_em: tsAgora() }),
  aposGravar(banco, v) {
    banco.executar("DELETE FROM agil_membro_alias WHERE membro_id = ?", [v.id]);
    for (const a of v.aliases) banco.executar("INSERT OR IGNORE INTO agil_membro_alias (membro_id, tipo, valor) VALUES (?,?,?)", [v.id, a.tipo, a.valor]);
  },
  aoCarregar(banco, valores) {
    const por = new Map<string, MembroAgil["aliases"]>();
    for (const l of banco.consultar<{ membro_id: string; tipo: MembroAgil["aliases"][number]["tipo"]; valor: string }>("SELECT membro_id, tipo, valor FROM agil_membro_alias ORDER BY rowid")) {
      const lista = por.get(l.membro_id) ?? [];
      lista.push({ tipo: l.tipo, valor: l.valor });
      por.set(l.membro_id, lista);
    }
    for (const v of valores) v.aliases = por.get(v.id) ?? [];
  },
  doLinha: (l) => ({
    id: String(l["id"]), workspace_id: String(l["workspace_id"]), tipo: l["tipo"] as MembroAgil["tipo"], rotulo: String(l["rotulo"]), squad_id: (l["squad_id"] as string | null) ?? null,
    horas_dia: (l["horas_dia"] as number | null) ?? null, fator_foco: Number(l["fator_foco"]), pontos_sprint_fixo: (l["pontos_sprint_fixo"] as number | null) ?? null, ativo: Number(l["ativo"]) === 1, aliases: [],
  }),
};
const fatos: Espec<FatoTask> = {
  tabela: "agil_fato_task", pk: ["workspace_id", "trabalho_id", "task_ref"], chaveDe: (v) => `${v.workspace_id}|${v.trabalho_id}|${v.task_ref}`, ordem: "workspace_id, trabalho_id, task_ref",
  colunas: [
    col("workspace_id"), col("trabalho_id"), col("task_ref"), col("titulo"), col("fase"), col("depende_de", "j", "depende_de_json"), col("criterio_aceite"), col("tipo_task"), col("status_visto"),
    col("iniciada_em"), col("concluida_em"), col("concluida_ts_precisa", "b"), col("duracao_obs_ms", "n"), col("bloqueada_ms", "n"), col("reaberturas", "n"), col("reabertas_em", "j", "reabertas_em_json"),
    col("retrabalho_ms", "n"), col("qa_reprovacoes", "n"), col("suite_final"), col("agente"), col("membro_id"), col("arquivos", "j", "arquivos_json"), col("tdd_primeiro", "bn"),
    col("vermelho_antes", "bn"), col("commits", "j", "commits_json"), col("validada_em"), col("tem_rastro", "b"), col("intervalos", "j", "intervalos_json"), col("primeiro_evento_em"),
    col("declarados", "j", "declarados_json"), col("versao_origem"), col("atualizado_em"),
  ],
};
const eventosRetrabalho: Espec<EventoRetrabalho> = {
  tabela: "agil_retrabalho_evento", pk: ["id"], chaveDe: (v) => v.id, ordem: "detectado_em, id",
  colunas: [
    col("id"), col("workspace_id"), col("trabalho_id"), col("task_ref"), col("item_id"), col("fonte"), col("forca"), col("natureza"), col("evidencia", "j", "evidencia_json"),
    col("chave_dedupe"), col("ocorrido_em"), col("detectado_em"), col("confirmado_por"), col("motivo"), col("ativo", "b"),
  ],
};
const retrabalhoTasks: Espec<TaskRetrabalho> = {
  tabela: "agil_retrabalho_task", pk: ["workspace_id", "trabalho_id", "task_ref"], chaveDe: (v) => `${v.workspace_id}|${v.trabalho_id}|${v.task_ref}`, ordem: "workspace_id, trabalho_id, task_ref",
  colunas: [col("workspace_id"), col("trabalho_id"), col("task_ref"), col("situacao"), col("eventos_defeito", "n"), col("eventos_pendentes", "n"), col("janela_ate"), col("calculado_em")],
};
const cerimonias: Espec<CerimoniaRegistro> = {
  tabela: "agil_cerimonia", pk: ["id"], chaveDe: (v) => v.id, ordem: "data, id",
  colunas: [
    col("id"), col("workspace_id"), col("sprint_id"), col("tipo"), col("data"), col("formato"), col("conteudo", "j", "conteudo_json"), col("gerada_de_fatos_em"), col("editada", "b"), col("criado_em"), col("atualizado_em"),
  ],
};
const retroItens: Espec<RetroItem> = {
  tabela: "agil_retro_item", pk: ["id"], chaveDe: (v) => v.id, ordem: "criado_em, id",
  colunas: [col("id"), col("cerimonia_id"), col("coluna"), col("texto"), col("votos", "n"), col("dado", "jn", "dado_json"), col("autor_membro_id"), col("criado_em")],
};
const retroAcoes: Espec<RetroAcao> = {
  tabela: "agil_retro_acao", pk: ["id"], chaveDe: (v) => v.id, ordem: "criado_em, id",
  colunas: [
    col("id"), col("cerimonia_id"), col("texto"), col("dono_membro_id"), col("prazo"), col("estado"), col("item_id"), col("concluida_em"), col("criado_em"), col("vencida_notificada", "b"),
  ],
};
const erros: Espec<ErroEstimativaRegistro> = {
  tabela: "agil_erro_estimativa", pk: ["item_id"], chaveDe: (v) => v.item_id, ordem: "registrado_em, item_id",
  colunas: [
    col("item_id"), col("estimativa_id"), col("pontos_previstos", "n"), col("categoria"), col("observado_ms", "n"), col("real_h", "n"), col("ref_ms_por_ponto", "n"), col("razao", "n"), col("registrado_em"),
  ],
};
const snapshots: Espec<SnapshotMetrica> = {
  tabela: "agil_metrica_snapshot", pk: ["workspace_id", "escopo", "chave", "dia", "metrica"], chaveDe: (v) => `${v.workspace_id}|${v.escopo}|${v.chave}|${v.dia}|${v.metrica}`, ordem: "workspace_id, dia, metrica",
  colunas: [col("workspace_id"), col("escopo"), col("chave"), col("dia"), col("metrica"), col("valor", "n")],
};
const dodResultados: Espec<ResultadoDodRegistro> = {
  tabela: "agil_dod_resultado", pk: ["item_id", "criterio"], chaveDe: (v) => `${v.item_id}|${v.criterio}`, ordem: "item_id, criterio",
  colunas: [col("item_id"), col("criterio"), col("estado"), col("fonte"), col("em")],
};
const demos: Espec<DemoRegistro> = {
  tabela: "agil_demo", pk: ["sprint_id", "item_id"], chaveDe: (v) => `${v.sprint_id}|${v.item_id}`, ordem: "sprint_id, item_id",
  colunas: [col("sprint_id"), col("item_id"), col("resultado"), col("nota"), col("em")],
};
const eventos: Espec<EventoAgil & { seq: number }> = {
  tabela: "agil_evento", pk: ["seq"], chaveDe: (v) => String(v.seq), ordem: "seq",
  colunas: [
    col("seq", "n"), col("tipo"), col("workspace_id"), col("sprint_id"), col("trabalho_id"), col("task_ref"), col("pontos", "n"), col("duracao_observada_ms", "n"), col("tokens", "n"),
    col("quando"), col("dados", "j", "dados_json"),
  ],
};
const auditoria: Espec<RegistroAuditoria> = {
  tabela: "agil_auditoria", pk: ["seq"], chaveDe: (v) => String(v.seq), ordem: "seq",
  colunas: [col("seq", "n"), col("acao"), col("ator"), col("workspace_id"), col("alvo"), col("motivo"), col("quando")],
};

// ---- coleções de forma própria (valor não carrega a chave inteira) ----
function colecaoConfig(banco: Banco): ColecaoSqlite<ConfigAgil> {
  let mapa: Map<string, ConfigAgil> | null = null;
  const carregar = (): Map<string, ConfigAgil> => {
    if (mapa) return mapa;
    mapa = new Map(banco.consultar<{ workspace_id: string; json: string }>("SELECT workspace_id, json FROM agil_config").map((l) => [l.workspace_id, JSON.parse(l.json) as ConfigAgil]));
    return mapa;
  };
  return {
    get: (k) => carregar().get(k),
    valores: () => [...carregar().values()],
    set(k, v) {
      const m = carregar();
      banco.executar("INSERT INTO agil_config (workspace_id, json, atualizado_em) VALUES (?,?,?) ON CONFLICT (workspace_id) DO UPDATE SET json=excluded.json, atualizado_em=excluded.atualizado_em", [k, JSON.stringify(v), tsAgora()]);
      m.set(k, v);
    },
    delete(k) {
      const m = carregar();
      if (!m.has(k)) return false;
      banco.executar("DELETE FROM agil_config WHERE workspace_id = ?", [k]);
      m.delete(k);
      return true;
    },
    invalidar() { mapa = null; },
  };
}

const partir = (k: string): [string, string] => { const i = k.indexOf("|"); return i < 0 ? [k, ""] : [k.slice(0, i), k.slice(i + 1)]; };

function colecaoVersoes(banco: Banco): ColecaoSqlite<string> {
  let mapa: Map<string, string> | null = null;
  const carregar = (): Map<string, string> => {
    if (mapa) return mapa;
    mapa = new Map(banco.consultar<{ workspace_id: string; trabalho_id: string; versao_origem: string }>("SELECT * FROM agil_versao_trabalho").map((l) => [`${l.workspace_id}|${l.trabalho_id}`, l.versao_origem]));
    return mapa;
  };
  return {
    get: (k) => carregar().get(k),
    valores: () => [...carregar().values()],
    set(k, v) {
      const m = carregar();
      const [ws, tr] = partir(k);
      banco.executar("INSERT INTO agil_versao_trabalho (workspace_id, trabalho_id, versao_origem) VALUES (?,?,?) ON CONFLICT (workspace_id, trabalho_id) DO UPDATE SET versao_origem=excluded.versao_origem", [ws, tr, v]);
      m.set(k, v);
    },
    delete(k) {
      const m = carregar();
      if (!m.has(k)) return false;
      const [ws, tr] = partir(k);
      banco.executar("DELETE FROM agil_versao_trabalho WHERE workspace_id = ? AND trabalho_id = ?", [ws, tr]);
      m.delete(k);
      return true;
    },
    invalidar() { mapa = null; },
  };
}

function colecaoChamadasIa(banco: Banco): ColecaoSqlite<number> {
  let mapa: Map<string, number> | null = null;
  const carregar = (): Map<string, number> => {
    if (mapa) return mapa;
    mapa = new Map(banco.consultar<{ workspace_id: string; dia: string; n: number }>("SELECT * FROM agil_chamada_ia").map((l) => [`${l.workspace_id}|${l.dia}`, Number(l.n)]));
    return mapa;
  };
  return {
    get: (k) => carregar().get(k),
    valores: () => [...carregar().values()],
    set(k, v) {
      const m = carregar();
      const [ws, dia] = partir(k);
      banco.executar("INSERT INTO agil_chamada_ia (workspace_id, dia, n) VALUES (?,?,?) ON CONFLICT (workspace_id, dia) DO UPDATE SET n=excluded.n", [ws, dia, v]);
      m.set(k, v);
    },
    delete(k) {
      const m = carregar();
      if (!m.has(k)) return false;
      const [ws, dia] = partir(k);
      banco.executar("DELETE FROM agil_chamada_ia WHERE workspace_id = ? AND dia = ?", [ws, dia]);
      m.delete(k);
      return true;
    },
    invalidar() { mapa = null; },
  };
}

// ---- checklists manuais (fora do `BancoAgil`: o núcleo recebe as marcas como `Map` em `avaliarChecklist`) ----
export interface MarcaChecklist { sprint_id: string; codigo: string; grupo: "xp" | "lean" | "dod" | "dor"; estado: "ok" | "atencao" | "falha" | "na" | "indeterminado"; nota: string | null }
export interface RepoChecklistAgil {
  listar(sprintId: string): MarcaChecklist[];
  gravar(m: MarcaChecklist): void;
}
export function criarRepoChecklistAgil(banco: Banco): RepoChecklistAgil {
  return {
    listar: (sprintId) => banco.consultar<MarcaChecklist>("SELECT sprint_id, codigo, grupo, estado, nota FROM agil_checklist WHERE sprint_id = ? AND fonte = 'manual' ORDER BY codigo", [sprintId]),
    gravar: (m) => void banco.executar(
      "INSERT INTO agil_checklist (sprint_id, codigo, grupo, estado, fonte, nota) VALUES (?,?,?,?, 'manual', ?) ON CONFLICT (sprint_id, codigo) DO UPDATE SET grupo=excluded.grupo, estado=excluded.estado, fonte='manual', nota=excluded.nota",
      [m.sprint_id, m.codigo, m.grupo, m.estado, m.nota],
    ),
  };
}

export interface BancoAgilSqlite extends BancoAgil {
  /** descarta os caches (ex.: workspace removido com CASCADE); a próxima leitura vai ao disco. */
  invalidar(): void;
  checklists: RepoChecklistAgil;
  capacidades: RepoCapacidadeAgil;
}

export function criarBancoAgilSqlite(banco: Banco): BancoAgilSqlite {
  const c = {
    configs: colecaoConfig(banco),
    itens: colecao(banco, itens),
    epicos: colecao(banco, epicos),
    estimativas: colecao(banco, estimativas),
    classificacoes: colecao(banco, classificacoes),
    sprints: colecao(banco, sprints),
    sprintItens: colecao(banco, sprintItens),
    membros: colecao(banco, membros),
    fatos: colecao(banco, fatos),
    versoes: colecaoVersoes(banco),
    eventosRetrabalho: colecao(banco, eventosRetrabalho),
    retrabalhoTasks: colecao(banco, retrabalhoTasks),
    cerimonias: colecao(banco, cerimonias),
    retroItens: colecao(banco, retroItens),
    retroAcoes: colecao(banco, retroAcoes),
    erros: colecao(banco, erros),
    snapshots: colecao(banco, snapshots),
    dodResultados: colecao(banco, dodResultados),
    demos: colecao(banco, demos),
    eventos: colecao(banco, eventos),
    auditoria: colecao(banco, auditoria),
    chamadasIa: colecaoChamadasIa(banco),
  };
  const todas = Object.values(c) as ColecaoSqlite<unknown>[];
  const invalidar = (): void => todas.forEach((x) => x.invalidar());
  return {
    ...c,
    checklists: criarRepoChecklistAgil(banco),
    capacidades: criarRepoCapacidadeAgil(banco),
    invalidar,
    transacao<T>(fn: () => T): T {
      try {
        return banco.transacao(() => fn());
      } catch (e) {
        invalidar();
        throw e;
      }
    },
  };
}

// ---- capacidade por sprint/membro (ausências em dias úteis; fora do `BancoAgil`) ----
export interface RepoCapacidadeAgil {
  /** membro_id => ausências (dias úteis) da sprint. */
  listar(sprintId: string): Map<string, number>;
  gravar(sprintId: string, membroId: string, diasUteis: number, ausenciasDias: number): void;
}
export function criarRepoCapacidadeAgil(banco: Banco): RepoCapacidadeAgil {
  return {
    listar: (sprintId) => new Map(banco.consultar<{ membro_id: string; ausencias_dias: number }>("SELECT membro_id, ausencias_dias FROM agil_capacidade WHERE sprint_id = ?", [sprintId]).map((l) => [l.membro_id, Number(l.ausencias_dias)])),
    gravar: (sprintId, membroId, dias, aus) => void banco.executar(
      "INSERT INTO agil_capacidade (sprint_id, membro_id, dias_uteis, ausencias_dias, pontos, base) VALUES (?,?,?,?, NULL, 'sem_base') ON CONFLICT (sprint_id, membro_id) DO UPDATE SET dias_uteis=excluded.dias_uteis, ausencias_dias=excluded.ausencias_dias",
      [sprintId, membroId, dias, aus],
    ),
  };
}

export interface ExtrasAgil { checklists: RepoChecklistAgil; capacidades: RepoCapacidadeAgil }
/** versão em memória (testes e fallback) das tabelas que ficam fora do `BancoAgil`. */
export function criarExtrasAgilMemoria(): ExtrasAgil {
  const marcas = new Map<string, MarcaChecklist>();
  const caps = new Map<string, number>();
  return {
    checklists: {
      listar: (s) => [...marcas.values()].filter((m) => m.sprint_id === s).sort((a, b) => a.codigo.localeCompare(b.codigo)),
      gravar: (m) => void marcas.set(`${m.sprint_id}|${m.codigo}`, m),
    },
    capacidades: {
      listar: (s) => new Map([...caps.entries()].filter(([k]) => k.startsWith(`${s}|`)).map(([k, v]) => [k.slice(s.length + 1), v])),
      gravar: (s, m, _d, aus) => void caps.set(`${s}|${m}`, aus),
    },
  };
}
