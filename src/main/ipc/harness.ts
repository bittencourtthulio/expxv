// Canais `harness:*` (Fase 9, T-09.01). SÓ validadores nesta onda; manipuladores nas ondas seguintes.
// Estritos: campo extra, tipo errado, faixa desconhecida, limiar_troca ≥ limiar_esgotamento, endpoint não-https e
// URL/caminho em campos de identificação são recusados ANTES de qualquer manipulador.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { ACOES_TROCA, FAIXAS, FAIXAS_MINIMAS_TROCA, FORMATOS_DECISOR, MODOS_DECISOR, MODOS_TROCA, PROPOSITOS_DECISAO } from "../../compartilhado/harness";
import { PAPEIS } from "../../nucleo/dominio/enums";
import { vIdConta, vIdMissao, vIdPane, vIdWorkspace } from "./comum-dominio";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import {
  hostDe,
  vEndpointHttps,
  vHost,
  vInstante,
  vListaMin,
  vNulavel,
  vNumero,
  vObjetoOpc,
  vParcial,
  vRegistro,
  vSemCaminhoNemUrl,
  vTextoUsuario,
  type ValidadoresDaFamilia,
} from "./validar-harness";

// ---- identificadores ----
const vProvedor = vTexto({ min: 1, max: 32, padrao: /^[a-z][a-z0-9_-]{0,31}$/ });
const vSlug = vTexto({ min: 1, max: 40, padrao: /^[a-z][a-z0-9-]{0,39}$/ });
const vNomeModelo: Validador<string> = (v) => {
  const r = vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9][A-Za-z0-9._:/+~@-]{0,99}$/ })(v);
  if (!r.ok) return r;
  return r.valor.includes("..") || r.valor.includes("//") ? { ok: false, erro: "modelo inválido" } : r;
};
const vEsforco = vTexto({ min: 1, max: 24, padrao: /^[a-z0-9_-]+$/ });
const vSkill = vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/ });
const vIdAgente = vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ });
const vIdTroca = vTexto({ min: 5, max: 64, padrao: /^trc_[0-9A-Za-z]{10,40}$/ });
const vCursor = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9_.:-]{1,80}$/ });
const vNomeCofreRef = vTexto({ min: 1, max: 64, padrao: /^[A-Z][A-Z0-9_]{0,63}$/ });
const vPapel = vEnum(PAPEIS);
const vFaixa = vEnum(FAIXAS);

// ---- estruturas ----
const vExecutor = vObjeto({
  provider: vProvedor,
  cli: vNulavel(vProvedor),
  model: vNulavel(vNomeModelo),
  effort: vNulavel(vEsforco),
  faixa: vNulavel(vFaixa),
});
const vModeloEquivalente = vObjeto({ modelo: vNulavel(vNomeModelo), esforco: vNulavel(vEsforco) });
const vTabelaEquivalencia = vRegistro(vProvedor, vParcial(FAIXAS, vLista(vModeloEquivalente, 12)), 32);

const vPoliticaEntrada = vObjeto({
  workspace_id: vNulavel(vIdWorkspace),
  task_type: vSlug,
  executor: vExecutor,
  alternativas: vLista(vExecutor, 10),
  fallback: vListaMin(vExecutor, 1, 10), // nunca vazio
  skills: vLista(vSkill, 20),
  agente: vNulavel(vIdAgente),
  conta_fixa_id: vNulavel(vIdConta),
  evitar_reservadas: vBooleano,
  habilitada: vBooleano,
});

const vConfigHarness: Validador<CanaisInvoke["harness:config_gravar"]["entrada"]> = (v) => {
  const r = vObjeto({
    workspace_id: vIdWorkspace,
    nivel: vInteiro({ min: 1, max: 4 }),
    modo_troca: vNulavel(vEnum(MODOS_TROCA)),
    limiar_troca_pct: vInteiro({ min: 50, max: 99 }),
    limiar_esgotamento_pct: vInteiro({ min: 51, max: 100 }),
    margem_troca_pontos: vInteiro({ min: 0, max: 50 }),
    troca_entre_provedores: vBooleano,
    faixa_minima_troca: vEnum(FAIXAS_MINIMAS_TROCA),
    max_saltos: vInteiro({ min: 1, max: 6 }),
    espera_ponto_seguro_s: vInteiro({ min: 30, max: 3600 }),
    piloto_edita_politica: vBooleano,
    injetar_cofre_no_env: vBooleano,
  })(v);
  if (!r.ok) return r;
  if (r.valor.limiar_troca_pct >= r.valor.limiar_esgotamento_pct) return { ok: false, erro: "limiar_troca_pct deve ser menor que limiar_esgotamento_pct" };
  return r;
};

const vContaConfig = vObjetoOpc(
  {
    conta_id: vIdConta,
    reservada_modelos: vLista(vNomeModelo, 30),
    reservada_papeis: vLista(vPapel, PAPEIS.length),
    workspaces_fixados: vLista(vIdWorkspace, 50),
  },
  { teto_tokens_5h: vNulavel(vInteiro({ min: 1, max: 1_000_000_000_000 })), teto_tokens_semana: vNulavel(vInteiro({ min: 1, max: 1_000_000_000_000 })) },
);

/** O consentimento do decisor casa com o endpoint (ou com `openrouter.ai` no modo jev_openrouter) e é obrigatório ao ligar. */
const vDecisorGravar: Validador<CanaisInvoke["harness:decisor_gravar"]["entrada"]> = (v) => {
  const r = vObjeto({
    habilitado: vBooleano,
    modo: vEnum(MODOS_DECISOR),
    formato: vEnum(FORMATOS_DECISOR),
    endpoint: vNulavel(vEndpointHttps),
    cabecalho_chave: vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9-]+$/ }),
    prefixo_chave: vNulavel(vTexto({ min: 1, max: 20, padrao: /^[\x20-\x7e]+$/ })),
    modelo: vNulavel(vNomeModelo),
    conta_openrouter_id: vNulavel(vIdConta),
    chave_ref: vNulavel(vNomeCofreRef),
    usar_para: vObjeto({ task_type: vBooleano, modelo_esforco: vBooleano, intencao: vBooleano }),
    confianca_minima: vNumero({ min: 0, max: 1 }),
    timeout_ms: vInteiro({ min: 200, max: 10_000 }),
    custo_por_decisao_usd: vNulavel(vNumero({ min: 0, max: 1000 })),
    alerta_diario: vInteiro({ min: 1, max: 1_000_000 }),
    consentimento: vNulavel(vObjeto({ host: vHost, modo: vEnum(MODOS_DECISOR) })),
  })(v);
  if (!r.ok) return r;
  const c = r.valor;
  const precisaEndpoint = c.modo === "jev_direto" || c.modo === "openai_compat";
  if (precisaEndpoint && c.endpoint === null) return { ok: false, erro: "endpoint: obrigatório neste modo" };
  if (!precisaEndpoint && c.endpoint !== null) return { ok: false, erro: "endpoint: não se aplica ao modo jev_openrouter" };
  if (c.modo !== "jev_direto" && c.modelo === null) return { ok: false, erro: "modelo: obrigatório neste modo" };
  if (c.modo === "jev_openrouter" && c.conta_openrouter_id === null) return { ok: false, erro: "conta_openrouter_id: obrigatório neste modo" };
  if (c.habilitado && c.consentimento === null) return { ok: false, erro: "consentimento: obrigatório para habilitar o decisor" };
  if (c.consentimento !== null) {
    if (c.consentimento.modo !== c.modo) return { ok: false, erro: "consentimento: modo diferente do configurado" };
    const hostEsperado = precisaEndpoint ? hostDe(c.endpoint as string) : "openrouter.ai";
    if (c.consentimento.host.toLowerCase() !== hostEsperado) return { ok: false, erro: "consentimento: host diferente do destino" };
  }
  return r;
};

const vContextoPerfil = vObjetoOpc(
  { workspace_id: vIdWorkspace, papel: vPapel, mission_id: vNulavel(vIdMissao) },
  { implementador_provedor: vNulavel(vProvedor), excluir: vLista(vProvedor, 16) },
);
const vPerfilAgente = vObjeto({
  agente_id: vNulavel(vIdAgente),
  provider: vProvedor,
  cli: vNulavel(vProvedor),
  modelo: vNulavel(vNomeModelo),
  esforco: vNulavel(vEsforco),
  faixa: vFaixa,
});
/** `{skill, etapa, ctx}` (Maestro) OU `{perfil, ctx}` (squads); misturar é erro. */
const vResolverPerfil: Validador<CanaisInvoke["harness:resolver_perfil"]["entrada"]> = (v) => {
  if (typeof v === "object" && v !== null && !Array.isArray(v) && "perfil" in v) {
    return vObjeto({ perfil: vPerfilAgente, ctx: vContextoPerfil })(v) as Resultado<CanaisInvoke["harness:resolver_perfil"]["entrada"]>;
  }
  return vObjeto({ skill: vSkill, etapa: vSkill, ctx: vContextoPerfil })(v) as Resultado<CanaisInvoke["harness:resolver_perfil"]["entrada"]>;
};

const vOpcaoIntencao = vObjetoOpc({ id: vSlugIntencao(), descricao: vTexto({ min: 1, max: 200 }) }, { palavras: vLista(vTexto({ min: 1, max: 40 }), 30) });
function vSlugIntencao(): Validador<string> {
  return vTexto({ min: 1, max: 40, padrao: /^[a-z][a-z0-9_-]{0,39}$/ });
}
const vContextoIntencao = vObjetoOpc(
  { workspace_id: vIdWorkspace },
  {
    opcoes: vListaMin(vOpcaoIntencao, 2, 20),
    trabalho_ativo: vNulavel(vObjeto({ tipo: vSlugIntencao(), estagio: vSlugIntencao() })),
    resumo_projeto: vNulavel(vTextoUsuario(500)),
  },
);

export const VALIDADORES_HARNESS = {
  "harness:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "harness:config_gravar": vConfigHarness,
  "harness:task_types_listar": vObjeto({}),
  "harness:task_types_gravar": vObjeto({
    slug: vSlug,
    categoria: vSlug,
    rotulo: vSemCaminhoNemUrl({ min: 1, max: 60 }),
    descricao: vNulavel(vTextoUsuario(300)),
  }),
  "harness:task_types_apagar": vObjeto({ slug: vSlug }),
  "harness:politica_listar": vObjeto({ workspace_id: vNulavel(vIdWorkspace) }),
  "harness:politica_gravar": vPoliticaEntrada,
  "harness:politica_restaurar_semente": vObjetoOpc({ workspace_id: vNulavel(vIdWorkspace) }, { task_type: vSlug }),
  "harness:equivalencia_ler": vObjeto({}),
  "harness:equivalencia_gravar": vObjeto({ provedores: vTabelaEquivalencia }),
  "harness:equivalencia_restaurar": vObjeto({}),
  "harness:recomendar": vObjeto({ workspace_id: vIdWorkspace, descricao: vTextoUsuario(2000, 1) }),
  "harness:decisoes_listar": vObjetoOpc({}, { desde: vInstante, proposito: vEnum(PROPOSITOS_DECISAO), cursor: vCursor, limite: vInteiro({ min: 1, max: 200 }) }),
  "harness:contas_config_listar": vObjeto({}),
  "harness:contas_config_gravar": vContaConfig,
  "harness:trocas_listar": vObjetoOpc({}, { desde: vInstante, cursor: vCursor, limite: vInteiro({ min: 1, max: 200 }) }),
  "harness:troca_decidir": vObjeto({ troca_id: vIdTroca, acao: vEnum(ACOES_TROCA) }),
  "harness:mover_pane": vObjetoOpc({ pane_id: vIdPane }, { conta_alvo_id: vIdConta }),
  "harness:decisor_ler": vObjeto({}),
  "harness:decisor_gravar": vDecisorGravar,
  "harness:decisor_testar": vObjetoOpc({}, { chave: vTexto({ min: 8, max: 512, padrao: /^[\x21-\x7e]+$/ }) }),
  "harness:classificar_intencao": vObjeto({ texto: vTextoUsuario(2000, 1), contexto: vContextoIntencao }),
  "harness:resolver_perfil": vResolverPerfil,
} satisfies ValidadoresDaFamilia<"harness:">;

export type CanalHarness = keyof typeof VALIDADORES_HARNESS;
