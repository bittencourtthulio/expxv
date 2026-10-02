// Canais `agil:*` (Fase 18, onda 2): validadores estritos e manipuladores. O renderer NUNCA envia caminho, `userData` nem `ator`: estes canais SÃO a ação humana
// (o main grava `ator: "humano"`). Todo pedido leva `workspace_id` e o serviço confere o dono de cada id citado (vazamento entre workspaces = falha). Erro de regra do núcleo
// chega ao renderer como `Error` com a mensagem `[codigo/subcodigo] texto`; qualquer outro erro vira texto genérico (nunca stack, SQL nem caminho).
import type { ConfigAgil, FiltrosAgil, FiltrosBacklog } from "../../compartilhado/agil";
import type { NomeInvoke } from "../../compartilhado/ipc";
import { ErroAgil } from "../../nucleo/agil/erros";
import { vIdTrabalho, vIdWorkspace, vOuNulo, vRotulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vJson, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNumero, vObjetoOpc, type ValidadoresDaFamilia } from "./validar-harness";
import type { ServicoAgil } from "../agil";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const idAgil = (prefixo: string): Validador<string> => vTexto({ min: 1, max: 64, padrao: new RegExp(`^${prefixo}_[0-9a-zA-Z]{10,40}$`) });
const vIdItem = idAgil("it");
const vIdSprint = idAgil("spr");
const vIdEpico = idAgil("epi");
const vIdMembro = idAgil("mbr");
const vIdCerimonia = idAgil("cer");
const vIdAcao = idAgil("rta");
const vIdRetroItem = idAgil("rti");
const vIdEventoRetrabalho = idAgil("rtb");
const vData: Validador<string> = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? { ok: true, valor: v } : falha("esperado data AAAA-MM-DD"));
const vTaskRef = vTexto({ min: 1, max: 40, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/ });
const vMoscow = vEnum(["must", "should", "could", "wont"] as const);
const vRisco = vEnum(["baixo", "medio", "alto", "critico"] as const);
const vCriticidade = vEnum(["baixa", "media", "alta", "critica"] as const);
const vEstadoDecisao = vEnum(["aceita", "ajustada", "travada"] as const);
const vNota10 = vInteiro({ min: 1, max: 10 });
const vTextoCurto = (max: number, min = 0): Validador<string> => vTextoLivre(max, min);
/** referência de linha da daily: `trabalho/task`, id de item ou texto curto sem controle. */
const vRef = vRotulo(200);

const CHAVES_CONFIG: readonly (keyof ConfigAgil)[] = [
  "escala_id", "escalas", "categorias", "pontos_base_tipo", "risco_pesos", "risco_faixas", "termos_sensiveis", "categorias_criticas", "dod", "dor", "wip", "estimativa_modo",
  "estimativa_max_chamadas_dia", "estimativa_lote", "perfil_estimador", "confianca_aceite_lote", "janela_retrabalho_dias", "dias_uteis", "feriados", "limiares_saude", "padroes_teste",
  "natureza", "buffer_planejamento", "horas_dia_padrao", "fator_foco_padrao", "commit_grande_linhas", "fechar_automatico", "amostra_minima",
];
/** nenhum texto da configuração pode ser caminho absoluto, URL ou ter controle (a config nunca grava caminho). */
function textosLimpos(v: unknown, prof = 0): boolean {
  if (prof > 6) return false;
  if (typeof v === "string") return !/[\u0000-\u001f\u007f]/.test(v) && !/^([\\/~]|[A-Za-z]:[\\/])/.test(v) && !/[a-z][a-z0-9+.-]*:\/\//i.test(v) && v.length <= 400;
  if (Array.isArray(v)) return v.length <= 200 && v.every((x) => textosLimpos(x, prof + 1));
  if (typeof v === "object" && v !== null) return Object.entries(v).length <= 200 && Object.entries(v).every(([k, x]) => k.length <= 80 && textosLimpos(x, prof + 1));
  return true;
}
const vConfigParcial: Validador<Partial<ConfigAgil>> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  for (const k of Object.keys(v)) if (!(CHAVES_CONFIG as readonly string[]).includes(k)) return falha(`campo desconhecido: ${k}`);
  const j = vJson(64 * 1024)(v);
  if (!j.ok) return j;
  if (!textosLimpos(j.valor)) return falha("a configuração não aceita caminho, URL nem texto de controle");
  return { ok: true, valor: j.valor as Partial<ConfigAgil> };
};

const vFiltrosBacklog: Validador<Partial<FiltrosBacklog>> = (v) => {
  const r = vObjetoOpc({}, {
    texto: vOuNulo(vTextoLivre(200)), epico_id: vOuNulo(vIdEpico), estado_fluxo: vOuNulo(vEnum(["backlog", "pronto", "em_andamento", "concluida", "validada", "orfao"] as const)),
    categoria: vOuNulo(vRotulo(60)), risco: vOuNulo(vRisco), criticidade: vOuNulo(vCriticidade), sprint_id: vOuNulo(vIdSprint), sem_estimativa: vOuNulo(vBooleano),
  })(v);
  return r as Resultado<Partial<FiltrosBacklog>>;
};
const vFiltrosPainel: Validador<Partial<FiltrosAgil>> = (v) =>
  vObjetoOpc({}, { sprint_id: vOuNulo(vIdSprint), membro_id: vOuNulo(vIdMembro), agente: vOuNulo(vRotulo(80)), squad_id: vOuNulo(vRotulo(80)), de: vOuNulo(vData), ate: vOuNulo(vData) })(v) as Resultado<Partial<FiltrosAgil>>;

const vVoto: Validador<1 | -1> = (v) => (v === 1 || v === -1 ? { ok: true, valor: v } : falha("esperado 1 ou -1"));
const vCriterios = vLista(vTextoCurto(300, 1), 10);

export const VALIDADORES_AGIL = {
  "agil:estado": vObjeto({ workspace_id: vIdWorkspace }),
  "agil:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "agil:config_gravar": vObjeto({ workspace_id: vIdWorkspace, config: vConfigParcial }),
  "agil:consentimento_ia": vObjeto({ workspace_id: vIdWorkspace, consentido: vBooleano }),
  "agil:sincronizar": vObjetoOpc({ workspace_id: vIdWorkspace }, { forcar: vBooleano }),
  "agil:membro_listar": vObjeto({ workspace_id: vIdWorkspace }),
  "agil:membro_gravar": vObjeto({
    workspace_id: vIdWorkspace,
    membro: vObjetoOpc({ tipo: vEnum(["humano", "agente"] as const), rotulo: vRotulo(80) }, {
      id: vIdMembro, squad_id: vOuNulo(vRotulo(80)), horas_dia: vOuNulo(vNumero({ min: 0.1, max: 24 })), fator_foco: vNumero({ min: 0.05, max: 1 }), pontos_sprint_fixo: vOuNulo(vNumero({ min: 0, max: 1000 })), ativo: vBooleano,
      aliases: vLista(vObjeto({ tipo: vEnum(["agente", "sessao", "email", "login"] as const), valor: vRotulo(120) }), 20),
    }),
  }),
  "agil:backlog_listar": vObjetoOpc({ workspace_id: vIdWorkspace }, { filtros: vFiltrosBacklog, ordenar: vEnum(["ordem", "wsjf", "valor_esforco"] as const), cursor: vOuNulo(vTexto({ min: 1, max: 12, padrao: /^\d{1,9}$/ })), limite: vInteiro({ min: 1, max: 200 }) }),
  "agil:item_ler": vObjeto({ workspace_id: vIdWorkspace, item_id: vIdItem }),
  "agil:item_criar": vObjeto({
    workspace_id: vIdWorkspace,
    item: vObjetoOpc({ titulo: vTextoCurto(300, 1) }, { descricao: vOuNulo(vTextoCurto(4000)), criterios: vCriterios, epico_id: vOuNulo(vIdEpico), origem: vEnum(["ade", "issue", "retro", "ocorrencia"] as const) }),
  }),
  "agil:item_atualizar": vObjeto({
    workspace_id: vIdWorkspace, item_id: vIdItem,
    campos: vObjetoOpc({}, {
      titulo: vTextoCurto(300, 1), descricao: vOuNulo(vTextoCurto(4000)), criterios: vCriterios, epico_id: vOuNulo(vIdEpico), valor: vOuNulo(vNota10), urgencia: vOuNulo(vNota10), reducao_risco: vOuNulo(vNota10),
      moscow: vOuNulo(vMoscow), dono_membro_id: vOuNulo(vIdMembro), par_membro_id: vOuNulo(vIdMembro), visibilidade_cliente: vEnum(["auto", "sim", "nao"] as const), resumo_cliente: vOuNulo(vTextoCurto(2000)),
      changelog_tipo: vOuNulo(vEnum(["added", "changed", "deprecated", "removed", "fixed", "security"] as const)), estado_ade: vEnum(["backlog", "refinado", "pronto"] as const),
    }),
  }),
  "agil:item_descartar": vObjeto({ workspace_id: vIdWorkspace, item_id: vIdItem, motivo: vTextoCurto(300, 3) }),
  "agil:item_reordenar": vObjeto({ workspace_id: vIdWorkspace, item_id: vIdItem, antes_id: vOuNulo(vIdItem) }),
  "agil:item_promover": vObjeto({ workspace_id: vIdWorkspace, item_id: vIdItem, destino: vEnum(["prodx", "sprintx", "runx"] as const) }),
  "agil:item_vincular": vObjetoOpc({ workspace_id: vIdWorkspace, item_id: vIdItem, trabalho_id: vOuNulo(vIdTrabalho) }, { task_ref: vOuNulo(vTaskRef) }),
  "agil:epico_listar": vObjeto({ workspace_id: vIdWorkspace }),
  "agil:epico_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, titulo: vTextoCurto(200, 1) }, { id: vIdEpico, descricao: vOuNulo(vTextoCurto(2000)), estado: vEnum(["aberto", "concluido", "arquivado"] as const) }),
  "agil:epico_apagar": vObjeto({ workspace_id: vIdWorkspace, epico_id: vIdEpico }),
  "agil:estimar": vObjeto({ workspace_id: vIdWorkspace, item_ids: (v) => (v === "sem_estimativa" ? { ok: true, valor: "sem_estimativa" as const } : vLista(vIdItem, 500)(v)) }),
  "agil:estimativa_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, item_id: vIdItem }, { pontos: vNumero({ min: 0.01, max: 1000 }), rotulo: vRotulo(20), estado: vEstadoDecisao, nota: vOuNulo(vTextoCurto(400)) }),
  "agil:classificacao_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, item_id: vIdItem }, { categoria: vRotulo(60), risco: vRisco, criticidade: vCriticidade, estado: vEstadoDecisao }),
  "agil:estimativa_aceitar_lote": vObjetoOpc({ workspace_id: vIdWorkspace, item_ids: vLista(vIdItem, 500) }, { confianca_min: vNumero({ min: 0, max: 1 }) }),
  "agil:sprint_listar": vObjeto({ workspace_id: vIdWorkspace }),
  "agil:sprint_criar": vObjeto({
    workspace_id: vIdWorkspace,
    sprint: vObjetoOpc({ nome: vTextoCurto(120, 1), inicio: vData, fim: vData }, { meta: vOuNulo(vTextoCurto(400)), capacidade_pontos: vOuNulo(vNumero({ min: 0, max: 10_000 })) }),
  }),
  "agil:sprint_atualizar": vObjeto({
    workspace_id: vIdWorkspace, sprint_id: vIdSprint,
    campos: vObjetoOpc({}, { nome: vTextoCurto(120, 1), meta: vOuNulo(vTextoCurto(400)), inicio: vData, fim: vData, capacidade_pontos: vOuNulo(vNumero({ min: 0, max: 10_000 })) }),
  }),
  "agil:sprint_iniciar": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint }),
  "agil:sprint_cancelar": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint }),
  "agil:sprint_item_mover": vObjetoOpc({ workspace_id: vIdWorkspace, sprint_id: vIdSprint, item_id: vIdItem, acao: vEnum(["adicionar", "remover"] as const) }, { motivo: vOuNulo(vTextoCurto(300)) }),
  "agil:sprint_fechar": vObjetoOpc({ workspace_id: vIdWorkspace, sprint_id: vIdSprint, destino_pendentes: vEnum(["backlog", "proxima", "descartar"] as const) }, { versao_lancamento: vOuNulo(vRotulo(60)) }),
  "agil:capacidade_ler": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint }),
  "agil:capacidade_gravar": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint, membro_id: vIdMembro, ausencias_dias: vNumero({ min: 0, max: 366 }) }),
  "agil:planejamento_sugerir": vObjetoOpc({ workspace_id: vIdWorkspace, sprint_id: vOuNulo(vIdSprint) }, { buffer: vNumero({ min: 0, max: 0.9 }) }),
  "agil:daily_gerar": vObjetoOpc({ workspace_id: vIdWorkspace }, { sprint_id: vOuNulo(vIdSprint) }),
  "agil:daily_salvar": vObjeto({ workspace_id: vIdWorkspace, cerimonia_id: vIdCerimonia, observacoes: vLista(vObjeto({ ref: vRef, observacao: vTextoCurto(400) }), 200) }),
  "agil:review_ler": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint }),
  "agil:review_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, sprint_id: vIdSprint, item_id: vIdItem, resultado: vEnum(["aceito", "ajustar", "rejeitado"] as const) }, { nota: vOuNulo(vTextoCurto(400)), devolver: vBooleano }),
  "agil:retro_ler": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint }),
  "agil:retro_item_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, cerimonia_id: vIdCerimonia }, { coluna: vRotulo(40), texto: vTextoCurto(400, 1), item_id: vIdRetroItem, voto: vVoto }),
  "agil:retro_acao_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, cerimonia_id: vIdCerimonia }, { texto: vTextoCurto(400, 1), dono_membro_id: vOuNulo(vIdMembro), prazo: vOuNulo(vData), acao_id: vIdAcao, estado: vEnum(["aberta", "feita", "cancelada"] as const) }),
  "agil:retro_acao_para_item": vObjeto({ workspace_id: vIdWorkspace, acao_id: vIdAcao }),
  "agil:retrabalho_listar": vObjetoOpc({ workspace_id: vIdWorkspace }, { limite: vInteiro({ min: 1, max: 200 }) }),
  "agil:retrabalho_marcar": vObjetoOpc(
    { workspace_id: vIdWorkspace, trabalho_id: vIdTrabalho, task_ref: vTaskRef, acao: vEnum(["marcar_retrabalho", "marcar_primeira", "confirmar", "descartar", "natureza"] as const), motivo: vTextoCurto(400, 5) },
    { evento_id: vIdEventoRetrabalho, natureza: vEnum(["defeito", "escopo", "ruido", "pendente"] as const) },
  ),
  "agil:painel": vObjetoOpc({ workspace_id: vIdWorkspace }, { filtros: vFiltrosPainel }),
  "agil:previsao": vObjetoOpc({ workspace_id: vIdWorkspace }, { filtros: vFiltrosPainel, iteracoes: vInteiro({ min: 100, max: 20_000 }) }),
  "agil:praticas": vObjetoOpc({ workspace_id: vIdWorkspace }, { sprint_id: vOuNulo(vIdSprint) }),
  "agil:checklist_gravar": vObjetoOpc({ workspace_id: vIdWorkspace, sprint_id: vIdSprint, codigo: vRotulo(60), estado: vEnum(["ok", "atencao", "falha", "na", "indeterminado"] as const) }, { nota: vOuNulo(vTextoCurto(400)) }),
  "agil:exportar": vObjetoOpc({ workspace_id: vIdWorkspace, tipo: vEnum(["backlog", "metricas", "retro", "daily"] as const), formato: vEnum(["csv", "md", "json"] as const) }, { sprint_id: vOuNulo(vIdSprint) }),
} satisfies ValidadoresDaFamilia<"agil:">;

export type CanalAgil = keyof typeof VALIDADORES_AGIL;

/** erro de regra do núcleo => `Error` com a mensagem `[codigo/subcodigo] texto` (o renderer lê); qualquer outro vira texto genérico (nunca stack/SQL/caminho). */
export function paraErroIpc(e: unknown, aviso?: (m: string) => void): Error {
  if (e instanceof ErroAgil) return new Error(`[${e.code}${e.subcode ? `/${e.subcode}` : ""}] ${e.message}`);
  aviso?.(`gestão ágil: ${e instanceof Error ? e.message : String(e)}`);
  return new Error("[unavailable] Falha interna na gestão ágil.");
}

export interface DependenciasIpcAgil {
  registro: RegistroIpc;
  /** leitura preguiçosa: o serviço só nasce na primeira chamada (nada no boot). */
  servico: () => ServicoAgil | Promise<ServicoAgil>;
  aviso?: (mensagem: string) => void;
}

export function registrarIpcAgil(d: DependenciasIpcAgil): void {
  const { registro } = d;
  const V = VALIDADORES_AGIL;
  type P = Record<string, unknown> & { workspace_id: string };
  /** registra um canal já com a tradução de erro; o serviço nasce na primeira chamada (nada no boot). */
  const R = (canal: CanalAgil, fn: (p: P, s: ServicoAgil) => unknown): void => {
    registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        return await fn(p as unknown as P, await d.servico());
      } catch (e) {
        throw paraErroIpc(e, d.aviso);
      }
    }) as never);
  };
  R("agil:estado", (p, s) => s.estado(p.workspace_id));
  R("agil:config_ler", (p, s) => s.configLer(p.workspace_id));
  R("agil:config_gravar", (p, s) => s.configGravar(p.workspace_id, p["config"]));
  R("agil:consentimento_ia", (p, s) => s.consentimentoIa(p.workspace_id, p["consentido"] as boolean));
  R("agil:sincronizar", (p, s) => s.sincronizar(p.workspace_id, p["forcar"] === true));
  R("agil:membro_listar", (p, s) => s.membroListar(p.workspace_id));
  R("agil:membro_gravar", (p, s) => s.membroGravar(p.workspace_id, p["membro"] as never));
  R("agil:backlog_listar", (p, s) => s.backlogListar(p.workspace_id, { ...(p["filtros"] === undefined ? {} : { filtros: p["filtros"] as never }), ...(p["ordenar"] === undefined ? {} : { ordenar: p["ordenar"] as never }), cursor: (p["cursor"] as string | null | undefined) ?? null, limite: (p["limite"] as number | undefined) ?? 100 }));
  R("agil:item_ler", (p, s) => s.itemLer(p.workspace_id, p["item_id"] as string));
  R("agil:item_criar", (p, s) => s.itemCriar(p.workspace_id, p["item"] as never));
  R("agil:item_atualizar", (p, s) => s.itemAtualizar(p.workspace_id, p["item_id"] as string, p["campos"] as never));
  R("agil:item_descartar", (p, s) => s.itemDescartar(p.workspace_id, p["item_id"] as string, p["motivo"] as string));
  R("agil:item_reordenar", (p, s) => s.itemReordenar(p.workspace_id, p["item_id"] as string, p["antes_id"] as string | null));
  R("agil:item_promover", (p, s) => s.itemPromover(p.workspace_id, p["item_id"] as string, p["destino"] as never));
  R("agil:item_vincular", (p, s) => s.itemVincular(p.workspace_id, p["item_id"] as string, p["trabalho_id"] as string | null, (p["task_ref"] as string | null | undefined) ?? null));
  R("agil:epico_listar", (p, s) => s.epicoListar(p.workspace_id));
  R("agil:epico_gravar", (p, s) => { const { workspace_id, ...e } = p; return s.epicoGravar(workspace_id, e as never); });
  R("agil:epico_apagar", (p, s) => s.epicoApagar(p.workspace_id, p["epico_id"] as string));
  R("agil:estimar", (p, s) => s.estimar(p.workspace_id, p["item_ids"] as never));
  R("agil:estimativa_gravar", (p, s) => { const { workspace_id, ...e } = p; return s.estimativaGravar(workspace_id, e as never); });
  R("agil:classificacao_gravar", (p, s) => { const { workspace_id, ...e } = p; return s.classificacaoGravar(workspace_id, e as never); });
  R("agil:estimativa_aceitar_lote", (p, s) => s.estimativaAceitarLote(p.workspace_id, p["item_ids"] as string[], p["confianca_min"] as number | undefined));
  R("agil:sprint_listar", (p, s) => s.sprintListar(p.workspace_id));
  R("agil:sprint_criar", (p, s) => s.sprintCriar(p.workspace_id, p["sprint"] as never));
  R("agil:sprint_atualizar", (p, s) => s.sprintAtualizar(p.workspace_id, p["sprint_id"] as string, p["campos"] as never));
  R("agil:sprint_iniciar", (p, s) => s.sprintIniciar(p.workspace_id, p["sprint_id"] as string));
  R("agil:sprint_cancelar", (p, s) => s.sprintCancelar(p.workspace_id, p["sprint_id"] as string));
  R("agil:sprint_item_mover", (p, s) => s.sprintItemMover(p.workspace_id, p["sprint_id"] as string, p["item_id"] as string, p["acao"] as never, (p["motivo"] as string | null | undefined) ?? null));
  R("agil:sprint_fechar", (p, s) => s.sprintFechar(p.workspace_id, p["sprint_id"] as string, p["destino_pendentes"] as never, (p["versao_lancamento"] as string | null | undefined) ?? null));
  R("agil:capacidade_ler", (p, s) => s.capacidadeLer(p.workspace_id, p["sprint_id"] as string));
  R("agil:capacidade_gravar", (p, s) => s.capacidadeGravar(p.workspace_id, p["sprint_id"] as string, p["membro_id"] as string, p["ausencias_dias"] as number));
  R("agil:planejamento_sugerir", (p, s) => s.planejamentoSugerir(p.workspace_id, p["sprint_id"] as string | null, p["buffer"] as number | undefined));
  R("agil:daily_gerar", (p, s) => s.dailyGerar(p.workspace_id, (p["sprint_id"] as string | null | undefined) ?? null));
  R("agil:daily_salvar", (p, s) => s.dailySalvar(p.workspace_id, p["cerimonia_id"] as string, p["observacoes"] as never));
  R("agil:review_ler", (p, s) => s.reviewLer(p.workspace_id, p["sprint_id"] as string));
  R("agil:review_gravar", (p, s) => s.reviewGravar(p.workspace_id, p["sprint_id"] as string, p["item_id"] as string, p["resultado"] as never, (p["nota"] as string | null | undefined) ?? null, p["devolver"] === true));
  R("agil:retro_ler", (p, s) => s.retroLer(p.workspace_id, p["sprint_id"] as string));
  R("agil:retro_item_gravar", (p, s) => s.retroItemGravar(p.workspace_id, p["cerimonia_id"] as string, { ...(p["coluna"] !== undefined ? { coluna: p["coluna"] as string } : {}), ...(p["texto"] !== undefined ? { texto: p["texto"] as string } : {}), ...(p["item_id"] !== undefined ? { item_id: p["item_id"] as string } : {}), ...(p["voto"] !== undefined ? { voto: p["voto"] as 1 | -1 } : {}) }));
  R("agil:retro_acao_gravar", (p, s) => s.retroAcaoGravar(p.workspace_id, p["cerimonia_id"] as string, { ...(p["texto"] !== undefined ? { texto: p["texto"] as string } : {}), ...(p["dono_membro_id"] !== undefined ? { dono_membro_id: p["dono_membro_id"] as string | null } : {}), ...(p["prazo"] !== undefined ? { prazo: p["prazo"] as string | null } : {}), ...(p["acao_id"] !== undefined ? { acao_id: p["acao_id"] as string } : {}), ...(p["estado"] !== undefined ? { estado: p["estado"] as never } : {}) }));
  R("agil:retro_acao_para_item", (p, s) => s.retroAcaoParaItem(p.workspace_id, p["acao_id"] as string));
  R("agil:retrabalho_listar", (p, s) => s.retrabalhoListar(p.workspace_id, (p["limite"] as number | undefined) ?? 100));
  R("agil:retrabalho_marcar", (p, s) => { const { workspace_id, ...x } = p; return s.retrabalhoMarcar(workspace_id, x as never); });
  R("agil:painel", (p, s) => s.painel(p.workspace_id, p["filtros"] as never));
  R("agil:previsao", (p, s) => s.previsao(p.workspace_id, p["filtros"] as never, p["iteracoes"] as number | undefined));
  R("agil:praticas", (p, s) => s.praticas(p.workspace_id, (p["sprint_id"] as string | null | undefined) ?? null));
  R("agil:checklist_gravar", (p, s) => s.checklistGravar(p.workspace_id, p["sprint_id"] as string, p["codigo"] as string, p["estado"] as never, (p["nota"] as string | null | undefined) ?? null));
  R("agil:exportar", (p, s) => s.exportar(p.workspace_id, p["tipo"] as never, p["formato"] as never, (p["sprint_id"] as string | null | undefined) ?? null));
}
