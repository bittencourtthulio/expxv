// Canais `maestro:*`, `pipelines:*` e `rigidez:*` (Fase 16, T-16.01): validadores ESTRITOS (campo extra, tipo errado, texto > 4 000, nível fora de 1..5, etapa fora do
// catálogo, justificativa < 20, caminho/URL/`cwd`/chave no payload, `confirmar_plano=0` sem `confirmado`) e os manipuladores que delegam à `LigacaoMaestro`
// (src/main/maestro.ts). O renderer nunca envia caminho absoluto, cwd, userData, URL nem chave: só ids, enums, níveis e o texto do pedido. Segredo não existe
// nestes canais. Erros nominais atravessam como `<codigo>: <mensagem>`; qualquer outro vira texto genérico (nunca vaza caminho de máquina).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { FAIXAS } from "../../compartilhado/harness";
import { ACOES_DO_PIPELINE, ETAPA_IDS, INTENCOES, MODOS_EXECUCAO, NIVEIS_RIGIDEZ, PIPELINES_IDS, TEXTO_PEDIDO_MAX, VIAS_DO_RENDERER, type EtapaConfig, type NivelRigidez } from "../../compartilhado/maestro";
import type { LigacaoMaestro } from "../maestro";
import { sanearErroDeMaestro } from "../maestro";
import { vIdMissao, vIdPane, vIdTrabalho, vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNulavel, vNumero, vTextoUsuario, type ValidadoresDaFamilia } from "./validar-harness";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
function refinar<T>(base: Validador<T>, regra: (v: T) => string | null): Validador<T> {
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    const motivo = regra(r.valor);
    return motivo === null ? r : falha(motivo);
  };
}

// ---------------------------------------------------------------- primitivas
export const JUSTIFICATIVA_MIN_CHARS = 20;
const vRigidez: Validador<NivelRigidez> = (v) => {
  const r = vInteiro({ min: 1, max: 5 })(v);
  return r.ok && (NIVEIS_RIGIDEZ as readonly number[]).includes(r.valor) ? ok(r.valor as NivelRigidez) : falha("nível de rigidez fora de 1..5");
};
export const vIdPipeline = vTexto({ min: 5, max: 64, padrao: /^mpl_[A-Za-z0-9]{4,56}$/ });
const vIdPrevia = vTexto({ min: 8, max: 64, padrao: /^previa_[A-Za-z0-9_]{2,50}$/ });
const vEtapaId = vEnum(ETAPA_IDS);
const vCaminhoRelativo = vTexto({ min: 1, max: 200 });
const relativoSeguro = (rel: string): boolean => !rel.includes("..") && !rel.startsWith("/") && !rel.includes("\\") && !rel.includes("\0") && !/^[A-Za-z]:/.test(rel) && !/[\u0000-\u001f\u007f]/.test(rel);
const vArquivoRelativo: Validador<string> = refinar(vCaminhoRelativo, (t) => (relativoSeguro(t) ? null : "caminho não permitido neste campo"));
const vJustificativa: Validador<string> = refinar(vTextoUsuario(500), (t) => (t.trim().length >= JUSTIFICATIVA_MIN_CHARS ? null : `justificativa precisa de ao menos ${JUSTIFICATIVA_MIN_CHARS} caracteres`));
/** A frase digitada de confirmação (`baixar`): curta, sem controle. */
const vConfirmacaoDigitada = vTexto({ min: 1, max: 40, padrao: /^[^\u0000-\u001f\u007f]+$/ });
const vTextoPedido: Validador<string> = refinar(vTextoUsuario(TEXTO_PEDIDO_MAX, 1), (t) => (t.trim() === "" ? "pedido vazio" : null));
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const MODELO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const vModelo: Validador<string> = refinar(vTexto({ min: 1, max: 100, padrao: MODELO }), (m) => (m.includes("..") || m.includes("//") ? "modelo inválido" : null));
const vCli = vTexto({ min: 1, max: 20, padrao: /^(?:auto|[a-z][a-z0-9-]{0,19})$/ });
const vEsforco = vTexto({ min: 1, max: 20, padrao: /^[a-z][a-z0-9_-]{0,19}$/ });
const vAgenteId = vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/ });
const vSkill = vTexto({ min: 1, max: 41, padrao: SLUG });

/** `EtapaConfig` estrito (o mesmo formato do arquivo importado); `atualizado_por` não vem do renderer: o main carimba. */
const vEtapaConfig: Validador<EtapaConfig> = refinar(
  vObjeto({
    etapa_id: vEtapaId,
    perfil: vObjeto({ cli: vCli, modelo: vNulavel(vModelo), esforco: vNulavel(vEsforco), faixa: vEnum(FAIXAS), origem_modelo: vEnum(["cli", "openrouter"] as const), agente_id: vNulavel(vAgenteId) }),
    skills: vLista(vSkill, 40),
    modo_execucao: vEnum(MODOS_EXECUCAO),
    atualizado_por: vEnum(["usuario", "fabrica", "importado"] as const),
  }),
  (c) => (new Set(c.skills).size === c.skills.length ? null : "skills repetidas"),
) as Validador<EtapaConfig>;

const vContextoPedido = vObjeto({
  pane_id: vNulavel(vIdPane),
  mission_id: vNulavel(vIdMissao),
  trabalho_id: vNulavel(vIdTrabalho),
  arquivos: vLista(vArquivoRelativo, 20),
  trecho: vNulavel(vTextoUsuario(2000)),
});
const vConfigMaestro = vObjeto({
  confirmar_plano: vBooleano,
  hook_modo: vEnum(["desligado", "notificar", "encaminhar"] as const),
  hook_confianca_min: vNumero({ min: 0.5, max: 1 }),
  producao: vBooleano,
  branches_protegidas: vLista(vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9._*/-]{1,80}$/ }), 50),
  escrever_hooks: vBooleano,
  hooks_aplicar_ja: vBooleano,
  max_terminais: vInteiro({ min: 1, max: 8 }),
  fechar_concluidos: vBooleano,
  timeout_sem_progresso_min: vInteiro({ min: 5, max: 240 }),
  proposta_expira_min: vInteiro({ min: 5, max: 240 }),
});
const vWsOuNulo = vNulavel(vIdWorkspace);

export const VALIDADORES_MAESTRO = {
  "maestro:pedir": vObjeto({ workspace_id: vIdWorkspace, texto: vTextoPedido, contexto: vNulavel(vContextoPedido), via: vEnum(VIAS_DO_RENDERER), nivel_pedido: vNulavel(vRigidez), executar_direto: vNulavel(vBooleano) }),
  "maestro:confirmar": vObjeto({
    plano_id: vIdPipeline,
    nivel: vNulavel(vRigidez),
    etapas_desligadas: refinar(vLista(vEtapaId, 50), (l) => (new Set(l).size === l.length ? null : "etapas repetidas")),
    intencao: vNulavel(vEnum(INTENCOES)),
    justificativa: vNulavel(vJustificativa),
    confirmacao_digitada: vNulavel(vConfirmacaoDigitada),
  }),
  "maestro:cancelar": vObjeto({ id: vIdPipeline }),
  "maestro:pipelines_listar": vObjeto({ workspace_id: vIdWorkspace, so_ativos: vBooleano, limite: vInteiro({ min: 1, max: 100 }) }),
  "maestro:pipeline_detalhe": vObjeto({ id: vIdPipeline }),
  "maestro:pipeline_acao": vObjeto({ id: vIdPipeline, acao: vEnum(ACOES_DO_PIPELINE), etapa_id: vNulavel(vEtapaId) }),
  "maestro:recibos_listar": vObjeto({ workspace_id: vIdWorkspace, limite: vInteiro({ min: 1, max: 200 }) }),
  "maestro:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "maestro:config_gravar": refinar(vObjeto({ workspace_id: vIdWorkspace, config: vConfigMaestro, confirmado: vBooleano }), (e) => (!e.config.confirmar_plano && !e.confirmado ? "confirmar_plano=0 exige confirmado:true" : null)),
  "pipelines:catalogo": vObjeto({}),
  "pipelines:config_listar": vObjeto({ workspace_id: vWsOuNulo }),
  "pipelines:config_gravar": vObjeto({ workspace_id: vWsOuNulo, config: vEtapaConfig }),
  "pipelines:config_restaurar": vObjeto({ workspace_id: vWsOuNulo, etapa_id: vNulavel(vEtapaId) }),
  "pipelines:validar": vObjeto({ workspace_id: vWsOuNulo, configs: vLista(vEtapaConfig, 60) }),
  "pipelines:perfis_prontos": vObjeto({}),
  "pipelines:aplicar_pronto": vObjeto({ workspace_id: vWsOuNulo, pronto_id: vTexto({ min: 1, max: 40, padrao: /^[a-z][a-z0-9-]{0,39}$/ }), cli: vEnum(["manter", "auto"] as const) }),
  "pipelines:exportar": refinar(vObjeto({ workspace_id: vWsOuNulo, destino: vEnum(["repo", "arquivo"] as const) }), (e) => (e.destino === "repo" && e.workspace_id === null ? "workspace_id: obrigatório para destino repo" : null)),
  "pipelines:importar_previa": refinar(vObjeto({ workspace_id: vWsOuNulo, origem: vEnum(["repo", "arquivo"] as const) }), (e) => (e.origem === "repo" && e.workspace_id === null ? "workspace_id: obrigatório para origem repo" : null)),
  "pipelines:importar_confirmar": vObjeto({ previa_id: vIdPrevia, workspace_id: vWsOuNulo }),
  "rigidez:ler": vObjeto({ workspace_id: vIdWorkspace, mission_id: vNulavel(vIdMissao), plano_id: vNulavel(vIdPipeline) }),
  "rigidez:definir": refinar(
    vObjeto({
      workspace_id: vIdWorkspace,
      escopo: vEnum(["workspace", "missao", "pedido"] as const),
      mission_id: vNulavel(vIdMissao),
      plano_id: vNulavel(vIdPipeline),
      nivel: vRigidez,
      justificativa: vNulavel(vJustificativa),
      confirmacao_digitada: vNulavel(vConfirmacaoDigitada),
      aplicar_hooks_ja: vBooleano,
      voltar_ao_padrao: vBooleano,
    }),
    (e) => {
      if (e.escopo === "missao" && e.mission_id === null) return "mission_id: obrigatório no escopo missão";
      if (e.escopo === "pedido" && e.plano_id === null) return "plano_id: obrigatório no escopo pedido";
      return null;
    },
  ),
  "rigidez:matriz": vObjeto({}),
  "rigidez:previa_plano": vObjeto({ workspace_id: vIdWorkspace, pipeline_id: vEnum(PIPELINES_IDS), nivel: vRigidez }),
  "rigidez:hooks_estado": vObjeto({ workspace_id: vIdWorkspace, mission_id: vNulavel(vIdMissao) }),
  "rigidez:hooks_reverter": vObjeto({ workspace_id: vIdWorkspace, mission_id: vNulavel(vIdMissao) }),
} satisfies ValidadoresDaFamilia<"maestro:"> & ValidadoresDaFamilia<"pipelines:"> & ValidadoresDaFamilia<"rigidez:">;

export type CanalMaestro = keyof typeof VALIDADORES_MAESTRO;

/** Manipuladores puros (testáveis sem IPC): um por canal; erro do domínio/núcleo sai saneado. */
export function criarManipuladoresMaestro(l: LigacaoMaestro) {
  const cuidar = async <T>(f: () => T | Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      throw sanearErroDeMaestro(e);
    }
  };
  type E<C extends CanalMaestro> = CanaisInvoke[C]["entrada"];
  return {
    "maestro:pedir": (p: E<"maestro:pedir">) => cuidar(() => l.pedir(p)),
    "maestro:confirmar": (p: E<"maestro:confirmar">) => cuidar(() => l.confirmar(p)),
    "maestro:cancelar": (p: E<"maestro:cancelar">) => cuidar(() => l.cancelar(p.id)),
    "maestro:pipelines_listar": (p: E<"maestro:pipelines_listar">) => cuidar(() => l.listarPipelines(p)),
    "maestro:pipeline_detalhe": (p: E<"maestro:pipeline_detalhe">) => cuidar(() => l.detalhe(p.id)),
    "maestro:pipeline_acao": (p: E<"maestro:pipeline_acao">) => cuidar(() => l.acao(p)),
    "maestro:recibos_listar": (p: E<"maestro:recibos_listar">) => cuidar(() => l.listarRecibos(p)),
    "maestro:config_ler": (p: E<"maestro:config_ler">) => cuidar(() => l.lerConfig(p.workspace_id)),
    "maestro:config_gravar": (p: E<"maestro:config_gravar">) => cuidar(() => l.gravarConfig(p)),
    "pipelines:catalogo": () => cuidar(() => l.catalogo()),
    "pipelines:config_listar": (p: E<"pipelines:config_listar">) => cuidar(() => l.listarConfigEtapas(p.workspace_id)),
    "pipelines:config_gravar": (p: E<"pipelines:config_gravar">) => cuidar(() => l.gravarConfigEtapa(p)),
    "pipelines:config_restaurar": (p: E<"pipelines:config_restaurar">) => cuidar(() => l.restaurarConfig(p)),
    "pipelines:validar": (p: E<"pipelines:validar">) => cuidar(() => l.validar(p.workspace_id, p.configs)),
    "pipelines:perfis_prontos": () => cuidar(() => l.perfisProntos()),
    "pipelines:aplicar_pronto": (p: E<"pipelines:aplicar_pronto">) => cuidar(() => l.aplicarPronto(p)),
    "pipelines:exportar": (p: E<"pipelines:exportar">) => cuidar(() => l.exportar(p)),
    "pipelines:importar_previa": (p: E<"pipelines:importar_previa">) => cuidar(() => l.importarPrevia(p)),
    "pipelines:importar_confirmar": (p: E<"pipelines:importar_confirmar">) => cuidar(() => l.importarConfirmar(p)),
    "rigidez:ler": (p: E<"rigidez:ler">) => cuidar(() => l.lerRigidez(p)),
    "rigidez:definir": (p: E<"rigidez:definir">) => cuidar(() => l.definirRigidez(p)),
    "rigidez:matriz": () => cuidar(() => l.matriz()),
    "rigidez:previa_plano": (p: E<"rigidez:previa_plano">) => cuidar(() => l.previaPlano(p)),
    "rigidez:hooks_estado": (p: E<"rigidez:hooks_estado">) => cuidar(() => l.hooksEstado(p)),
    "rigidez:hooks_reverter": (p: E<"rigidez:hooks_reverter">) => cuidar(() => l.hooksReverter(p)),
  };
}

export interface DependenciasIpcMaestro {
  registro: RegistroIpc;
  ligacao: LigacaoMaestro;
}

/** Registra os 25 canais (um manipulador por canal). */
export function registrarIpcMaestro(d: DependenciasIpcMaestro): void {
  const m = criarManipuladoresMaestro(d.ligacao);
  const V = VALIDADORES_MAESTRO;
  const r = d.registro;
  r.invoke("maestro:pedir", V["maestro:pedir"], (e) => m["maestro:pedir"](e));
  r.invoke("maestro:confirmar", V["maestro:confirmar"], (e) => m["maestro:confirmar"](e));
  r.invoke("maestro:cancelar", V["maestro:cancelar"], (e) => m["maestro:cancelar"](e));
  r.invoke("maestro:pipelines_listar", V["maestro:pipelines_listar"], (e) => m["maestro:pipelines_listar"](e));
  r.invoke("maestro:pipeline_detalhe", V["maestro:pipeline_detalhe"], (e) => m["maestro:pipeline_detalhe"](e));
  r.invoke("maestro:pipeline_acao", V["maestro:pipeline_acao"], (e) => m["maestro:pipeline_acao"](e));
  r.invoke("maestro:recibos_listar", V["maestro:recibos_listar"], (e) => m["maestro:recibos_listar"](e));
  r.invoke("maestro:config_ler", V["maestro:config_ler"], (e) => m["maestro:config_ler"](e));
  r.invoke("maestro:config_gravar", V["maestro:config_gravar"], (e) => m["maestro:config_gravar"](e));
  r.invoke("pipelines:catalogo", V["pipelines:catalogo"], () => m["pipelines:catalogo"]());
  r.invoke("pipelines:config_listar", V["pipelines:config_listar"], (e) => m["pipelines:config_listar"](e));
  r.invoke("pipelines:config_gravar", V["pipelines:config_gravar"], (e) => m["pipelines:config_gravar"](e));
  r.invoke("pipelines:config_restaurar", V["pipelines:config_restaurar"], (e) => m["pipelines:config_restaurar"](e));
  r.invoke("pipelines:validar", V["pipelines:validar"], (e) => m["pipelines:validar"](e));
  r.invoke("pipelines:perfis_prontos", V["pipelines:perfis_prontos"], () => m["pipelines:perfis_prontos"]());
  r.invoke("pipelines:aplicar_pronto", V["pipelines:aplicar_pronto"], (e) => m["pipelines:aplicar_pronto"](e));
  r.invoke("pipelines:exportar", V["pipelines:exportar"], (e) => m["pipelines:exportar"](e));
  r.invoke("pipelines:importar_previa", V["pipelines:importar_previa"], (e) => m["pipelines:importar_previa"](e));
  r.invoke("pipelines:importar_confirmar", V["pipelines:importar_confirmar"], (e) => m["pipelines:importar_confirmar"](e));
  r.invoke("rigidez:ler", V["rigidez:ler"], (e) => m["rigidez:ler"](e));
  r.invoke("rigidez:definir", V["rigidez:definir"], (e) => m["rigidez:definir"](e));
  r.invoke("rigidez:matriz", V["rigidez:matriz"], () => m["rigidez:matriz"]());
  r.invoke("rigidez:previa_plano", V["rigidez:previa_plano"], (e) => m["rigidez:previa_plano"](e));
  r.invoke("rigidez:hooks_estado", V["rigidez:hooks_estado"], (e) => m["rigidez:hooks_estado"](e));
  r.invoke("rigidez:hooks_reverter", V["rigidez:hooks_reverter"], (e) => m["rigidez:hooks_reverter"](e));
}
