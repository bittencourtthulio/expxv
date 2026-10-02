// T-16.14 · Matriz nível × etapa, parâmetros por nível e hooks por nível (DADOS; exaustivos por tipo: célula faltando não compila).
// Legenda (Fase 16 §g3): roda ● · reduzida ◐ · reforco ◆ · omitida ○ · humano H · substituida R (pelo pipeline `rapido`).
// `agrupa` = ⛓ (agrupada no terminal da etapa anterior); `confirma` = push/PR só com clique (em `automatico` dispensa).
import type { EtapaId, NivelRigidez, PipelineId } from "../../../compartilhado/maestro";
import type { ModoHook } from "../../metodo/hooks";

export type ModoCela = "roda" | "reduzida" | "reforco" | "omitida" | "humano" | "substituida";
export interface Cela {
  modo: ModoCela;
  agrupa?: boolean;
  /** avaliações independentes (nível 5 = 2). */
  avaliacoes?: number;
  confirma?: boolean;
  /** instrução de redução/reforço no despacho (linguagem natural). */
  nota?: string;
}

const roda = (extra: Partial<Cela> = {}): Cela => ({ modo: "roda", ...extra });
const red = (nota: string, agrupa = false): Cela => ({ modo: "reduzida", nota, ...(agrupa ? { agrupa: true } : {}) });
const ref = (nota: string, avaliacoes?: number): Cela => ({ modo: "reforco", nota, ...(avaliacoes === undefined ? {} : { avaliacoes }) });
const O: Cela = { modo: "omitida" };
const H: Cela = { modo: "humano" };
const S: Cela = { modo: "substituida" };
const R = roda();
type Linha = Record<NivelRigidez, Cela>;
const L = (n1: Cela, n2: Cela, n3: Cela, n4: Cela, n5: Cela): Linha => ({ 1: n1, 2: n2, 3: n3, 4: n4, 5: n5 });
const TODOS = (c: Cela): Linha => L(c, c, c, c, c);

export const MATRIZ_RIGIDEZ: Readonly<Record<EtapaId, Linha>> = {
  "memox.consultar": L(O, O, R, R, ref("inclua regressões por arquivo")),
  "prodx.p1": TODOS(R),
  "prodx.p0": L(O, O, O, O, R),
  "prodx.p25": L(O, red("densidade mvp"), R, ref("rode prodx-existe isolado em avaliador separado"), ref("idem, e prodx-produto se o PRODUTO.md for provisório")),
  "prodx.assinatura": TODOS(H),
  "prodx.briefing": TODOS(R),
  "legadox.perfil": TODOS(R),
  "legadox.raio": L(R, R, R, ref("raio com evidência de chamadores"), ref("raio com evidência de chamadores e histórico")),
  "legadox.caracterizar": L(O, O, R, R, R),
  "legadox.divida": L(O, O, O, R, R),
  "legadox.manual": L(O, O, O, R, R),
  "runx.e1": L(S, red("causa condensada", true), R, ref("investigador; reprodução exigida"), ref("investigador; reprodução exigida")),
  "runx.e2": L(S, red("1 sprint, 1 fase, 2 tasks", true), R, R, ref("revisor-testes no plano")),
  "runx.e3": L(S, red("TDD mínimo: regressão e subconjunto", true), R, ref("revisor-testes por task"), ref("revisor-testes por task em segundo provedor; casos de borda")),
  "runx.e4": L(O, red("QA enxuto, em terminal separado"), R, ref("avaliador em provedor diferente do E3"), ref("dois QAs em provedores diferentes", 2)),
  "runx.e5": L(O, O, R, R, R),
  "sprintx.f1": L(S, red("base mínima: só o que o plano precisa tocar", true), R, ref("investigador na base"), ref("investigador na base")),
  "sprintx.f2": L(S, red("densidade mvp, forma autonomo", true), R, ref("densidade completo, forma entrevista"), ref("densidade profundo, forma entrevista")),
  "sprintx.f3": L(S, red("plano condensado: 1 sprint", true), R, R, ref("plano com casos de borda")),
  "sprintx.f35": L(O, O, O, O, R),
  "sprintx.f4": L(S, red("orquestrador condensado", true), R, R, R),
  "sprintx.f5": L(O, red("auditoria enxuta: só achados ALTA, 1 rodada"), R, ref("auditor-plano e revisor-testes; reaudite até SIM"), ref("duas auditorias em provedores diferentes; reaudite até SIM", 2)),
  "sprintx.f6": L(S, red("TDD mínimo: um teste por task e subconjunto"), R, ref("revisor-testes por task"), ref("revisor-testes por task em segundo provedor; casos de borda")),
  "stackx.detectar": TODOS(R),
  "stackx.check": L(O, O, O, R, ref("conferência cruzada")),
  "stackx.atualizar": TODOS(R),
  "designx.cartography": TODOS(R),
  "designx.audit": L(O, O, O, R, ref("auditoria cruzada")),
  "mergex.check": L(O, R, R, ref("portão estrito: n/a só com justificativa"), ref("portão estrito e segunda opinião")),
  "mergex.atencao": L(O, O, R, ref("atenção com raio e faixas"), ref("atenção com raio e faixas")),
  "mergex.qa": L(O, O, R, R, R),
  "mergex.pr": L(O, roda({ confirma: true }), roda({ confirma: true }), roda({ confirma: true }), roda({ confirma: true })),
  "mergex.revisar": TODOS(H),
  "buildx.condutor": L(red("autonomo, densidade mvp, até 1 ciclo de recursão, validação enxuta"), red("autonomo, densidade mvp, até 2 ciclos de recursão"), R, ref("modo briefing (1 rodada), densidade completo, até 3 ciclos, mergex por feature com atenção e pacote do QA"), ref("modo briefing, densidade profundo, ciclos até o teto, stackx-check e designx-audit por feature, validação completa e segunda validação em outro provedor")),
  "onboarding.executar": TODOS(R),
  "rapido.executar": L(R, O, O, O, O),
  "consulta.rag": TODOS(R),
};

/** Ajustes por pipeline (a mesma etapa pode ter célula própria: ex.: `prodx.p0` é o núcleo do pipeline prodx). */
export const SOBRESCRITAS_POR_PIPELINE: Readonly<Partial<Record<PipelineId, Partial<Record<EtapaId, Linha>>>>> = {
  prodx: { "prodx.p0": TODOS(R) },
  mergex: { "mergex.check": TODOS(R), "mergex.pr": TODOS(roda({ confirma: true })) },
  rapido: { "rapido.executar": TODOS(R) },
  stackx: { "stackx.check": L(O, O, O, R, ref("conferência cruzada")) },
};

/** Célula efetiva (pipeline > matriz). */
export function celaDe(pipeline: PipelineId, etapa: EtapaId, nivel: NivelRigidez): Cela {
  return SOBRESCRITAS_POR_PIPELINE[pipeline]?.[etapa]?.[nivel] ?? MATRIZ_RIGIDEZ[etapa][nivel];
}

// ---------------------------------------------------------------- parâmetros por nível (g4)
export interface ParametrosDoNivel {
  pipeline_bug_feature: "rapido" | "condensado" | "metodo" | "reforcado" | "total";
  densidade: "mvp" | "padrao" | "completo" | "profundo" | null;
  forma: "autonomo" | "entrevista" | null;
  auditoria_rodadas: number | null;
  auditoria_reauditoria: number | null;
  qa_voltas_max: number | null;
  testes: "piso" | "regressao_por_task" | "dois_por_task" | "com_revisor_testes" | "revisor_em_segundo_provedor";
  avaliador_outro_provedor: "nao" | "recomendado" | "obrigatorio";
  subagentes_de_veredito: string[];
  hooks_de_metodo: "desligados_piso_aviso" | "escopo_verde_aviso" | "nascimento" | "promovidos" | "quase_todos_bloqueio";
  portao_mergex: "nenhum" | "pronto_bloqueado" | "completo" | "estrito" | "estrito_segunda_opiniao";
  consulta_rag: "nao" | "sim" | "sim_com_regressoes";
  max_terminais: number;
  agrupa_etapas: boolean;
  fecha_trabalho: boolean;
  reaproveita_terminal: boolean;
}
export const PARAMETROS_POR_NIVEL: Readonly<Record<NivelRigidez, ParametrosDoNivel>> = {
  1: { pipeline_bug_feature: "rapido", densidade: null, forma: null, auditoria_rodadas: null, auditoria_reauditoria: null, qa_voltas_max: null, testes: "piso", avaliador_outro_provedor: "nao", subagentes_de_veredito: [], hooks_de_metodo: "desligados_piso_aviso", portao_mergex: "nenhum", consulta_rag: "nao", max_terminais: 1, agrupa_etapas: false, fecha_trabalho: false, reaproveita_terminal: false },
  2: { pipeline_bug_feature: "condensado", densidade: "mvp", forma: "autonomo", auditoria_rodadas: 1, auditoria_reauditoria: 0, qa_voltas_max: 1, testes: "regressao_por_task", avaliador_outro_provedor: "recomendado", subagentes_de_veredito: [], hooks_de_metodo: "escopo_verde_aviso", portao_mergex: "pronto_bloqueado", consulta_rag: "nao", max_terminais: 2, agrupa_etapas: true, fecha_trabalho: false, reaproveita_terminal: true },
  3: { pipeline_bug_feature: "metodo", densidade: "padrao", forma: "entrevista", auditoria_rodadas: 1, auditoria_reauditoria: 2, qa_voltas_max: 2, testes: "dois_por_task", avaliador_outro_provedor: "recomendado", subagentes_de_veredito: [], hooks_de_metodo: "nascimento", portao_mergex: "completo", consulta_rag: "sim", max_terminais: 4, agrupa_etapas: false, fecha_trabalho: true, reaproveita_terminal: false },
  4: { pipeline_bug_feature: "reforcado", densidade: "completo", forma: "entrevista", auditoria_rodadas: 3, auditoria_reauditoria: 3, qa_voltas_max: 3, testes: "com_revisor_testes", avaliador_outro_provedor: "obrigatorio", subagentes_de_veredito: ["auditor-plano", "revisor-testes", "qa", "revisor-diff"], hooks_de_metodo: "promovidos", portao_mergex: "estrito", consulta_rag: "sim", max_terminais: 4, agrupa_etapas: false, fecha_trabalho: true, reaproveita_terminal: false },
  5: { pipeline_bug_feature: "total", densidade: "profundo", forma: "entrevista", auditoria_rodadas: 4, auditoria_reauditoria: 4, qa_voltas_max: 4, testes: "revisor_em_segundo_provedor", avaliador_outro_provedor: "obrigatorio", subagentes_de_veredito: ["auditor-plano", "revisor-testes", "qa", "revisor-diff", "segunda-opiniao"], hooks_de_metodo: "quase_todos_bloqueio", portao_mergex: "estrito_segunda_opiniao", consulta_rag: "sim_com_regressoes", max_terminais: 6, agrupa_etapas: false, fecha_trabalho: true, reaproveita_terminal: false },
};

// ---------------------------------------------------------------- hooks por nível (g5)
export const HOOKS_PISO = ["task-so-fecha-verde", "regressao-antes-do-fix"] as const;
export const HOOKS_ESCOPO = ["escopo-da-ocorrencia", "escopo-da-task", "arvore-limpa-antes-da-suite", "task-reivindicada", "uma-ocorrencia-por-arvore"] as const;
export const HOOKS_PLANO = ["causa-antes-do-plano", "sem-placeholder-no-plano", "raio-antes-do-plano", "caracterizacao-antes", "orcamento-de-mudanca", "reversao-declarada", "sem-colateral"] as const;
export const HOOKS_ENTREGA = ["commit-por-task", "arquivo-fora-do-plano", "pr-so-com-portao"] as const;
export const HOOKS_QUALIDADE = ["tdd-teste-antes", "aderencia", "sem-convencoes", "sem-jargao-no-uso", "designx-audit", "designx-token-check"] as const;
/** Hooks de segurança: o ADE NUNCA escreve estas chaves, em nível algum (I8). */
export const SEGURANCA = ["segredo-no-commit", "sem-segredo", "git-perigoso", "branch-limpa", "zona-de-risco", "aprovacao-em-raio-alto", "designx-cartografa"] as const;
/** Grupo do legadox (modo legado nos níveis 1–2 fica em `aviso`). */
export const HOOKS_LEGADOX = ["raio-antes-do-plano", "caracterizacao-antes", "orcamento-de-mudanca", "reversao-declarada", "sem-colateral"] as const;
export const PISO_HOOKS = HOOKS_PISO;

type MapaHooks = Record<string, ModoHook>;
function aplicar(m: MapaHooks, nomes: readonly string[], modo: ModoHook): void {
  for (const n of nomes) m[n] = modo;
}
function hooksDoNivelBase(nivel: NivelRigidez): MapaHooks {
  const m: MapaHooks = {};
  if (nivel === 3) return m; // nascimento: o ADE remove o que gerenciava
  aplicar(m, HOOKS_PISO, nivel <= 2 ? "aviso" : "bloqueio");
  if (nivel === 1) {
    aplicar(m, HOOKS_ESCOPO, "desligado");
    aplicar(m, HOOKS_PLANO, "desligado");
    aplicar(m, HOOKS_ENTREGA, "desligado");
    aplicar(m, HOOKS_QUALIDADE, "desligado");
  } else if (nivel === 2) {
    aplicar(m, HOOKS_ESCOPO, "aviso");
    m["uma-ocorrencia-por-arvore"] = "desligado";
    aplicar(m, HOOKS_PLANO, "desligado");
    aplicar(m, HOOKS_ENTREGA, "desligado");
    aplicar(m, HOOKS_QUALIDADE, "desligado");
  } else {
    aplicar(m, HOOKS_ESCOPO, "aviso");
    aplicar(m, ["escopo-da-ocorrencia", "escopo-da-task"], "bloqueio");
    aplicar(m, HOOKS_PLANO, nivel === 5 ? "bloqueio" : "aviso");
    if (nivel === 4) aplicar(m, ["causa-antes-do-plano", "sem-placeholder-no-plano", "raio-antes-do-plano", "caracterizacao-antes"], "bloqueio");
    aplicar(m, HOOKS_ENTREGA, "aviso");
    aplicar(m, nivel === 5 ? ["pr-so-com-portao", "arquivo-fora-do-plano"] : ["pr-so-com-portao"], "bloqueio");
    aplicar(m, HOOKS_QUALIDADE, "aviso");
    m["tdd-teste-antes"] = "bloqueio";
  }
  return m;
}
export const HOOKS_POR_NIVEL: Readonly<Record<NivelRigidez, Readonly<MapaHooks>>> = { 1: hooksDoNivelBase(1), 2: hooksDoNivelBase(2), 3: hooksDoNivelBase(3), 4: hooksDoNivelBase(4), 5: hooksDoNivelBase(5) };
/** Modo legado nos níveis 1–2: o grupo do legadox sobe de `desligado` para `aviso`. */
export const HOOKS_MODO_LEGADO_BAIXO: Readonly<MapaHooks> = Object.fromEntries(HOOKS_LEGADOX.map((n) => [n, "aviso" as ModoHook]));
