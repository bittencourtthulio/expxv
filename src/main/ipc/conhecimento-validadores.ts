// Validadores estritos dos canais `conhecimento:*`, `chat:*` e `rag:*` (Fase 15, onda 2). Reconstroem o valor (não repassam o que
// receberam), recusam campo extra e NUNCA aceitam caminho absoluto, `cwd` nem credencial embutida em URL: o renderer só manda ids,
// enums, instantes, textos limitados e caminhos RELATIVOS ao workspace. Segredo do backend entra só em `campos_secretos`.
import { TIPOS_DOCUMENTO, TIPOS_NO, TIPOS_APRENDIZADO } from "../../compartilhado/conhecimento";
import type { AlvoEsquecer } from "../../compartilhado/conhecimento-api";
import { validarUrlBackend } from "../../nucleo/conhecimento/backend/url";
import { vIdMissao, vIdWorkspace, vOuNulo, vRotulo, vTextoLivre } from "./comum-dominio";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNumero, vObjetoOpc, vRegistro, vSemCaminhoNemUrl, vVerdadeiro, vListaMin, type ValidadoresDaFamilia } from "./validar-harness";
import { vInstante } from "./validar-harness";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

// ---------------------------------------------------------------------------------------------------------------- comuns
/** Ids do conhecimento: uuid5, `apr_…`, `col_…`, `agg:<tipo>`, ids de nó/chunk. Nunca caminho. */
export const vIdRag = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,79}$/ });
/** Ids locais do chat (`conv_…`, `msg_…`, `plano_…`) e das migrações (`mig_…`). */
export const vIdLocalRag = vTexto({ min: 1, max: 64, padrao: /^[a-z]{2,8}_[0-9a-z]{10,40}$/ });

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

/** Caminho RELATIVO ao workspace: sem raiz, sem unidade, sem `..`, sem barra invertida, sem `~`. */
export const vCaminhoRelativo: Validador<string> = (v) => {
  const r = vTexto({ min: 1, max: 300 })(v);
  if (!r.ok) return r;
  const t = r.valor;
  if (CONTROLE.test(t) || t.startsWith("/") || t.startsWith("~") || /^[A-Za-z]:/.test(t) || t.includes("\\") || t.split("/").includes("..")) return falha("caminho relativo inválido");
  return ok(t);
};

const REF_LOGICA = /^[a-z_]{2,16}:[A-Za-z0-9._#-]{1,160}$/;
/** Origem de documento: caminho relativo OU referência lógica (`commit:<sha>`, `task:T-03.02`, `sessao:<id>`). */
export const vOrigemOuRef: Validador<string> = (v) => {
  if (typeof v === "string" && REF_LOGICA.test(v)) return ok(v);
  return vCaminhoRelativo(v);
};

const vModeloSeguro = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9._:/@+-]{1,80}$/ });
const vEsforco = vTexto({ min: 1, max: 40, padrao: /^[A-Za-z0-9._-]{1,40}$/ });
const vTiposDoc = vLista(vEnum(TIPOS_DOCUMENTO), TIPOS_DOCUMENTO.length);
const vModeloEmbedding = vTexto({ min: 1, max: 100, padrao: /^(?:hash-256-v1|ollama:[A-Za-z0-9._/@-]{1,80}(?::\d{1,5})?|onnx:[A-Za-z0-9._/@-]{1,80}(?::\d{1,5})?)$/ });

/** Exatamente UMA chave dentre `chaves`, com o validador dela. */
function vUmDentre<T>(opcoes: Record<string, Validador<unknown>>): Validador<T> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
    const chaves = Object.keys(v);
    if (chaves.length !== 1) return falha("informe exatamente um alvo");
    const chave = chaves[0] as string;
    const val = opcoes[chave];
    if (val === undefined) return falha(`campo desconhecido: ${chave}`);
    const r = val((v as Record<string, unknown>)[chave]);
    return r.ok ? ok({ [chave]: r.valor } as T) : falha(`${chave}: ${r.erro}`);
  };
}

const vNumeroMundo = vNumero({ min: -1_000_000, max: 1_000_000 });

// ---------------------------------------------------------------------------------------------------------------- conhecimento:*
export const VALIDADORES_CONHECIMENTO = {
  "conhecimento:estado": vObjeto({ workspace_id: vIdWorkspace }),
  "conhecimento:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "conhecimento:config_gravar": vObjetoOpc(
    { workspace_id: vIdWorkspace },
    {
      ativo: vBooleano,
      consulta_obrigatoria: vEnum(["off", "aviso", "bloqueio"] as const),
      contexto_chars: vInteiro({ min: 500, max: 6000 }),
      hook_prompt: vBooleano,
      indexar_codigo: vBooleano,
      indexar_transcricoes: vBooleano,
      aprendizado_modo: vEnum(["deterministico", "assistido"] as const),
      retencao_transcricao_dias: vInteiro({ min: 7, max: 730 }),
      chat_execucao: vEnum(["confirmar", "reversiveis", "total"] as const),
    },
  ),
  "conhecimento:buscar": vObjeto({
    workspace_id: vIdWorkspace,
    consulta: vTextoLivre(300, 1),
    modo: vEnum(["hibrido", "lexical", "semantico"] as const),
    tipos: vOuNulo(vTiposDoc),
    desde: vOuNulo(vInstante),
    limite: vInteiro({ min: 1, max: 30 }),
    escopo: vEnum(["projeto", "missao", "usuario", "equipe"] as const),
  }),
  "conhecimento:contexto_previa": vObjeto({
    workspace_id: vIdWorkspace,
    tarefa: vTextoLivre(2000, 1),
    arquivos: vLista(vCaminhoRelativo, 20),
    orcamento_chars: vInteiro({ min: 500, max: 6000 }),
  }),
  "conhecimento:documentos_listar": vObjeto({
    workspace_id: vIdWorkspace,
    tipo: vOuNulo(vEnum(TIPOS_DOCUMENTO)),
    mission_id: vOuNulo(vIdMissao),
    busca: vOuNulo(vTextoLivre(200)),
    depois: vOuNulo(vTexto({ min: 1, max: 12, padrao: /^\d{1,7}$/ })),
    limite: vInteiro({ min: 1, max: 200 }),
  }),
  "conhecimento:documento_detalhe": vObjeto({ workspace_id: vIdWorkspace, documento_id: vIdRag }),
  "conhecimento:reindexar": vObjeto({ workspace_id: vIdWorkspace, fonte: vEnum(["docs", "codigo", "git", "transcricoes", "tudo"] as const) }),
  "conhecimento:esquecer": vObjeto({
    workspace_id: vIdWorkspace,
    alvo: vUmDentre<AlvoEsquecer>({ documento_id: vIdRag, origem: vOrigemOuRef, mission_id: vIdMissao, pane_id: vTexto({ min: 1, max: 64, padrao: /^pane_[0-9A-Za-z]{10,40}$/ }), tipo: vEnum(TIPOS_DOCUMENTO), antes_de: vInstante }),
  }),
  "conhecimento:purgar": vObjeto({ workspace_id: vIdWorkspace, confirmacao: vTextoLivre(300, 1) }),
  "conhecimento:importar_historico": vObjeto({ workspace_id: vIdWorkspace, cli: vEnum(["claude", "codex", "opencode"] as const), consentimento: vVerdadeiro }),
  "conhecimento:exportar": vObjeto({ workspace_id: vIdWorkspace }),
  "conhecimento:grafo_subgrafo": vObjeto({
    workspace_id: vIdWorkspace,
    tipos: vOuNulo(vLista(vEnum(TIPOS_NO), TIPOS_NO.length)),
    desde: vOuNulo(vInstante),
    mission_id: vOuNulo(vIdMissao),
    foco_no_id: vOuNulo(vIdRag),
    max_nos: vInteiro({ min: 10, max: 5000 }),
  }),
  "conhecimento:grafo_no": vObjeto({ workspace_id: vIdWorkspace, no_id: vIdRag }),
  "conhecimento:grafo_posicoes_gravar": vObjeto({ workspace_id: vIdWorkspace, posicoes: vLista(vObjeto({ id: vIdRag, x: vNumeroMundo, y: vNumeroMundo }), 5000) }),
  "conhecimento:aprendizados_listar": vObjeto({
    workspace_id: vIdWorkspace,
    estado: vOuNulo(vEnum(["candidato", "ativo", "arquivado", "rejeitado"] as const)),
    tipo: vOuNulo(vEnum(TIPOS_APRENDIZADO)),
    busca: vOuNulo(vTextoLivre(200)),
    depois: vOuNulo(vTexto({ min: 1, max: 12, padrao: /^\d{1,7}$/ })),
    limite: vInteiro({ min: 1, max: 200 }),
  }),
  "conhecimento:aprendizado_atualizar": vObjetoOpc({ workspace_id: vIdWorkspace, id: vIdRag, acao: vEnum(["ativar", "arquivar", "rejeitar", "editar"] as const) }, { texto: vTextoLivre(1000, 1) }),
  "conhecimento:feedback": vObjetoOpc(
    { workspace_id: vIdWorkspace, alvo_tipo: vEnum(["chunk", "documento", "aprendizado"] as const), alvo_id: vIdRag, valor: vEnum(["util", "inutil", "errado"] as const) },
    { nota: vTextoLivre(200) },
  ),
  "conhecimento:destilar_missao": vObjeto({ workspace_id: vIdWorkspace, mission_id: vIdMissao }),
  "conhecimento:modelos": vObjeto({ workspace_id: vIdWorkspace }),
  "conhecimento:modelo_definir": vObjeto({ workspace_id: vIdWorkspace, modelo: vModeloEmbedding }),
} satisfies ValidadoresDaFamilia<"conhecimento:">;

// ---------------------------------------------------------------------------------------------------------------- chat:*
export const VALIDADORES_CHAT = {
  "chat:conversas_listar": vObjeto({ workspace_id: vIdWorkspace }),
  "chat:conversa_criar": vObjeto({ workspace_id: vIdWorkspace, modo: vEnum(["perguntar", "orquestrar"] as const), titulo: vOuNulo(vRotulo(120)), mission_alvo_id: vOuNulo(vIdMissao), indexar: vBooleano }),
  "chat:conversa_ler": vObjeto({ conversa_id: vIdLocalRag }),
  "chat:conversa_apagar": vObjeto({ conversa_id: vIdLocalRag }),
  "chat:perfil_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "chat:perfil_gravar": vObjetoOpc(
    { workspace_id: vIdWorkspace, cli: vEnum(["claude", "codex", "opencode", "gemini"] as const), modelo: vOuNulo(vModeloSeguro), esforco: vOuNulo(vEsforco), faixa: vEnum(["rapido", "medio", "profundo"] as const) },
    { agente_id: vOuNulo(vIdRag) },
  ),
  "chat:enviar": vObjeto({ conversa_id: vIdLocalRag, texto: vTextoLivre(8000, 1), modo: vEnum(["perguntar", "orquestrar"] as const), mission_alvo_id: vOuNulo(vIdMissao) }),
  "chat:parar": vObjeto({ mensagem_id: vIdLocalRag }),
  "chat:plano_decidir": vObjetoOpc(
    { plano_id: vIdLocalRag, decisao: vEnum(["aprovar", "cancelar", "editar"] as const) },
    {
      ajuste: vObjetoOpc({}, { titulo: vRotulo(120), cli: vEnum(["claude", "codex", "opencode", "gemini"] as const), modelo: vOuNulo(vModeloSeguro), esforco: vOuNulo(vEsforco), prompt: vTextoLivre(20_000, 1) }),
    },
  ),
  "chat:plano_parar": vObjeto({ plano_id: vIdLocalRag }),
} satisfies ValidadoresDaFamilia<"chat:">;

// ---------------------------------------------------------------------------------------------------------------- rag:*
const PROVEDORES = ["qdrant", "supabase", "upstash", "pinecone"] as const;
const vProvedor = vEnum(PROVEDORES);
const vColecaoRemota = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9_.-]{1,80}$/ });
/** Segredo do formulário: texto simples, sem quebra de linha (iria para cabeçalho), limitado. */
const vSegredo: Validador<string> = (v) => {
  const r = vTexto({ min: 1, max: 2000 })(v);
  if (!r.ok) return r;
  return /[\r\n\0]/.test(r.valor) ? falha("valor inválido") : r;
};
const vCampoSecreto = vTexto({ min: 1, max: 40, padrao: /^[a-z][a-z0-9_]{0,39}$/ });
/** URL do backend: https obrigatório (http só em loopback/rede privada), sem credencial embutida; a regra é a do núcleo. */
const vUrlBackend: Validador<string> = (v) => {
  const r = vTexto({ min: 1, max: 500 })(v);
  if (!r.ok) return r;
  if (CONTROLE.test(r.valor) || /\s/.test(r.valor)) return falha("URL inválida");
  const u = validarUrlBackend(r.valor);
  return u.ok ? ok(r.valor.trim()) : falha("URL inválida");
};
const camposConfigurar = {
  workspace_id: vIdWorkspace,
  provedor: vProvedor,
  url: vUrlBackend,
  colecao_remota: vColecaoRemota,
  campos_secretos: vRegistro(vCampoSecreto, vSegredo, 8),
  modo: vEnum(["local", "espelho", "compartilhado"] as const),
  tipos: vListaMin(vEnum(TIPOS_DOCUMENTO), 1, TIPOS_DOCUMENTO.length),
};
const vConfigurar = vObjetoOpc(camposConfigurar, { equipe_id: vSemCaminhoNemUrl({ min: 1, max: 80 }), autor: vSemCaminhoNemUrl({ min: 1, max: 80 }) });

const vTestar: Validador<unknown> = (v) => {
  if (typeof v === "object" && v !== null && "usar_salvo" in v) return vObjeto({ workspace_id: vIdWorkspace, usar_salvo: vVerdadeiro })(v);
  return vConfigurar(v);
};

const vHostConsent = vTexto({ min: 1, max: 253, padrao: /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i });

export const VALIDADORES_RAG = {
  "rag:backend_estado": vObjeto({ workspace_id: vIdWorkspace }),
  "rag:backend_provedores": vObjeto({}),
  "rag:backend_configurar": vConfigurar,
  "rag:backend_testar": vTestar as ValidadoresDaFamilia<"rag:">["rag:backend_testar"],
  "rag:backend_esquecer_segredo": vObjeto({ provedor: vProvedor }),
  "rag:migracao_previa": vObjeto({ workspace_id: vIdWorkspace, tipos: vListaMin(vEnum(TIPOS_DOCUMENTO), 1, TIPOS_DOCUMENTO.length) }),
  "rag:migracao_iniciar": vObjeto({
    workspace_id: vIdWorkspace,
    previa_id: vIdLocalRag,
    consentimento: vObjeto({ provedor: vProvedor, host: vHostConsent, colecao: vColecaoRemota, versao_politica: vInteiro({ min: 1, max: 1000 }) }),
  }),
  "rag:migracao_pausar": vObjeto({ migracao_id: vIdLocalRag }),
  "rag:migracao_retomar": vObjeto({ migracao_id: vIdLocalRag }),
  "rag:migracao_cancelar": vObjeto({ migracao_id: vIdLocalRag }),
  "rag:migracao_verificar": vObjeto({ migracao_id: vIdLocalRag }),
  "rag:voltar_para_local": vObjeto({ workspace_id: vIdWorkspace, baixar_do_remoto: vBooleano }),
  "rag:sincronizar": vObjeto({ workspace_id: vIdWorkspace }),
  "rag:remoto_apagar": vObjeto({ workspace_id: vIdWorkspace, confirmacao: vTextoLivre(120, 1) }),
} satisfies ValidadoresDaFamilia<"rag:">;
