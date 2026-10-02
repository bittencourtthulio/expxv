// Canais `squads:*` e `agentes:*` (Fase 14): validadores estritos (T-14.01) e manipuladores (T-14.09 serviço, T-14.10 portabilidade,
// T-14.16 execução, T-14.17 modo livre, T-14.21 prompt). Todos os canais têm manipulador; a lista
// `CANAIS_SQUADS_SEM_MANIPULADOR_AINDA` em squads.test.ts está vazia e o teste falha se ela mentir.
// O renderer nunca envia caminho absoluto, `cwd`, userData nem URL: identificadores são slugs/ids, e o texto do
// prompt só atravessa por `agentes:prompt_*` (≤ 16 KiB, só variáveis do conjunto fechado).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { FAIXAS } from "../../compartilhado/harness";
import { PORTOES_MISSAO } from "../../compartilhado/dominio";
import {
  ARQUIVOS_EXECUCAO,
  ESCOPOS_SQUAD,
  ESFORCOS_CONHECIDOS,
  LIMITES_SQUAD,
  ORIGENS_SQUAD,
  PADRAO_SLUG,
  PAPEIS_SQUAD,
  PERMISSOES_MEMBRO,
  VARIAVEIS_PROMPT,
  caminhoPromptDe,
  type Membro,
  type NivelRigidez,
  type Squad,
} from "../../compartilhado/squads";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../nucleo/dominio";
import { ErroMcp } from "../../nucleo/mcp/erros";
import { ErroDeSquad } from "../../nucleo/squads/erros";
import { FormatoInvalidoError, VersaoMaiorError } from "../../nucleo/squads/formato";
import { LojaError } from "../../nucleo/squads/loja";
import type { LigacaoSquads } from "../squads";
import { vIdWorkspace, vRotulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNulavel, vObjetoOpc, vSemCaminhoNemUrl, vTextoUsuario, type ValidadoresDaFamilia } from "./validar-harness";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

/** Validação cruzada depois da estrutural: devolve o motivo da recusa ou `null`. */
function refinar<T>(base: Validador<T>, regra: (v: T) => string | null): Validador<T> {
  return (v) => {
    const r = base(v);
    if (!r.ok) return r;
    const motivo = regra(r.valor);
    return motivo === null ? r : falha(motivo);
  };
}

// ---- primitivas ----
export const vSlug = vTexto({ min: 1, max: LIMITES_SQUAD.slug_max, padrao: PADRAO_SLUG });
/** `<squad>.<membro>` (≤ 80). */
export const vAgentId = vTexto({ min: 3, max: LIMITES_SQUAD.agent_id_max, padrao: /^[a-z0-9][a-z0-9-]{0,39}\.[a-z0-9][a-z0-9-]{0,39}$/ });
const vHash = vTexto({ min: 64, max: 64, padrao: /^[0-9a-f]{64}$/ });
const vNomeSquad = vSemCaminhoNemUrl({ min: 1, max: 80 });
export const vCli = vTexto({ min: 1, max: 32, padrao: /^(?:auto|[a-z][a-z0-9-]{0,31})$/ });
const vModelo: Validador<string> = refinar(vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/ }), (m) => (m.includes("..") || m.includes("//") ? "modelo inválido" : null));
const vEsforco = vEnum(ESFORCOS_CONHECIDOS);
const vFaixa = vEnum(FAIXAS);
const vRigidez: Validador<NivelRigidez> = (v) => {
  const r = vInteiro({ min: 1, max: 5 })(v);
  return r.ok ? ok(r.valor as NivelRigidez) : falha("nível de rigidez fora de 1..5");
};
const vNomePermitido = vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9:_.-]{0,63}$/ });
const vListaUnica = (max: number): Validador<string[]> =>
  refinar(vLista(vNomePermitido, max), (l) => (new Set(l).size === l.length ? null : "itens repetidos"));
const vIdPrevia = vTexto({ min: 8, max: 64, padrao: /^[A-Za-z0-9_-]{8,64}$/ });
const vIdExecucao = vTexto({ min: 1, max: 64, padrao: /^sqx_[0-9A-Za-z]{10,40}$/ });
/** Unidade da atualização de fábrica: slug de membro ou `@squad` (os campos da própria squad). */
const vUnidadeDeFabrica = vTexto({ min: 1, max: LIMITES_SQUAD.slug_max, padrao: /^(?:@squad|[a-z0-9][a-z0-9-]{0,39})$/ });
/** Nome de pasta da lixeira: `<slug>-<AAAAMMDDHHMMSS>-<hex>` (nunca caminho). */
const vNomeDaLixeira = vTexto({ min: 1, max: 100, padrao: /^[a-z0-9][a-z0-9-]{0,99}$/ });
const vObjetivo = refinar(vTextoUsuario(LIMITES_SQUAD.objetivo_max, 1), (t) => (t.trim() === "" ? "objetivo vazio" : null));

/** Texto do prompt do membro: ≤ 16 KiB (bytes), sem NUL/controle (salvo \n \r \t) e só variáveis do conjunto fechado. */
export const vPromptTexto: Validador<string> = (v) => {
  if (typeof v !== "string") return falha("esperado texto");
  if (v.length === 0) return falha("texto curto demais");
  if (Buffer.byteLength(v, "utf8") > LIMITES_SQUAD.prompt_max_bytes) return falha("prompt maior que 16 KiB");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) return falha("texto inválido");
  for (const m of v.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const nome = (m[1] ?? "").trim();
    if (!(VARIAVEIS_PROMPT as readonly string[]).includes(nome)) return falha(`variável desconhecida: ${nome.slice(0, 40)}`);
  }
  return ok(v);
};

// ---- Squad ----
const vOrcamento = vObjeto({
  tempo_min: vNulavel(vInteiro({ min: 1, max: LIMITES_SQUAD.tempo_min_max })),
  tokens: vNulavel(vInteiro({ min: 1, max: 1_000_000_000 })),
  modo: vEnum(["soft", "rigido"] as const),
});
const vPerfil = vObjeto({ cli: vCli, modelo: vNulavel(vModelo), esforco: vNulavel(vEsforco), faixa: vFaixa });
const vMembro: Validador<Membro> = refinar(
  vObjeto({
    slug: vSlug,
    papel: vEnum(PAPEIS_SQUAD),
    rotulo: vSemCaminhoNemUrl({ min: 1, max: LIMITES_SQUAD.rotulo_max }),
    descricao: vTextoUsuario(LIMITES_SQUAD.descricao_membro_max),
    prompt: vTexto({ min: 1, max: 60, padrao: /^membros\/[a-z0-9][a-z0-9-]{0,39}\.md$/ }),
    perfil: vPerfil,
    skills_permitidas: vListaUnica(LIMITES_SQUAD.lista_permitidos_max),
    mcps_permitidos: vListaUnica(LIMITES_SQUAD.lista_permitidos_max),
    hooks: vListaUnica(LIMITES_SQUAD.lista_permitidos_max),
    max_instancias: vInteiro({ min: LIMITES_SQUAD.instancias_min, max: LIMITES_SQUAD.instancias_max }),
    orcamento: vOrcamento,
    rigidez: vNulavel(vRigidez),
    permissao: vNulavel(vEnum(PERMISSOES_MEMBRO)),
  }),
  (m) => {
    if (m.prompt !== caminhoPromptDe(m.slug)) return "prompt: o caminho precisa ser membros/<slug>.md";
    if (m.papel === "orchestrator" && m.max_instancias !== 1) return "orquestrador tem sempre 1 instância";
    return null;
  },
);

/** Forma da squad; a composição (revisor, ≥ 3 membros, CLI com intake…) é do `validarSquad` (T-14.04) e vira achado. */
const vSquadForma: Validador<Squad> = refinar(
  vObjeto({
    slug: vSlug,
    nome: vNomeSquad,
    descricao: vTextoUsuario(LIMITES_SQUAD.descricao_squad_max),
    escopo: vEnum(ESCOPOS_SQUAD),
    rigidez_padrao: vNulavel(vRigidez),
    max_instancias_paralelas: vInteiro({ min: LIMITES_SQUAD.instancias_min, max: LIMITES_SQUAD.instancias_max }),
    orcamento: vOrcamento,
    portoes: vNulavel(vLista(vEnum(PORTOES_MISSAO), PORTOES_MISSAO.length)),
    fabrica: vNulavel(vObjeto({ id: vSlug, versao: vInteiro({ min: 1, max: 100000 }) })),
    origem: vEnum(ORIGENS_SQUAD),
    membros: vLista(vMembro, LIMITES_SQUAD.membros_max),
  }),
  (s) => {
    const slugs = s.membros.map((m) => m.slug);
    if (new Set(slugs).size !== slugs.length) return "membros: slug repetido";
    if (s.membros.some((m) => s.slug.length + 1 + m.slug.length > LIMITES_SQUAD.agent_id_max)) return "agent_id passa de 80 caracteres";
    if (s.portoes !== null && new Set(s.portoes).size !== s.portoes.length) return "portoes: itens repetidos";
    return null;
  },
);

/** Gravar exige EXATAMENTE 1 orquestrador (CT-14.01: nenhuma escrita sem ele). */
const vSquadGravavel: Validador<Squad> = refinar(vSquadForma, (s) => {
  const n = s.membros.filter((m) => m.papel === "orchestrator").length;
  return n === 1 ? null : `squad precisa de exatamente 1 orquestrador (tem ${n})`;
});

const vSlugEntrada = vObjeto({ slug: vSlug });
const vAgentEntrada = vObjeto({ agent_id: vAgentId });

export const VALIDADORES_SQUADS = {
  "squads:listar": vObjetoOpc({}, { busca: vRotulo(LIMITES_SQUAD.busca_max), origem: vEnum(ORIGENS_SQUAD) }),
  "squads:obter": vSlugEntrada,
  "squads:gravar": vObjeto({ squad: vSquadGravavel, hash_esperado: vNulavel(vHash) }),
  // validação AO VIVO de rascunho: só a forma; "sem orquestrador" volta como achado, não como recusa de IPC
  "squads:validar": vObjeto({ squad: vSquadForma, workspace_id: vNulavel(vIdWorkspace) }),
  "squads:duplicar": vObjetoOpc({ slug: vSlug }, { novo_slug: vSlug, novo_nome: vNomeSquad }),
  "squads:apagar": refinar(vObjeto({ slug: vSlug, confirmar_slug: vSlug }), (e) => (e.slug === e.confirmar_slug ? null : "confirmar_slug diferente do slug")),
  "squads:fabrica_atualizacao": vSlugEntrada,
  "squads:fabrica_aplicar": refinar(
    vObjetoOpc({ slug: vSlug, membros: vLista(vUnidadeDeFabrica, LIMITES_SQUAD.membros_max + 1) }, { sobrescrever_editados: vLista(vUnidadeDeFabrica, LIMITES_SQUAD.membros_max + 1) }),
    (e) => (e.sobrescrever_editados !== undefined && !e.sobrescrever_editados.every((m) => e.membros.includes(m)) ? "sobrescrever_editados precisa estar em membros" : null),
  ),
  "squads:fabrica_diff": vObjeto({ slug: vSlug, membro: vUnidadeDeFabrica }),
  "squads:lixeira_listar": vObjeto({}),
  "squads:lixeira_restaurar": vObjeto({ nome: vNomeDaLixeira }),
  "squads:execucao_arquivo": vObjeto({ execucao_id: vIdExecucao, arquivo: vEnum(ARQUIVOS_EXECUCAO) }),
  "squads:preflight": vObjeto({ slug: vSlug, workspace_id: vIdWorkspace }),
  "squads:enviar_prompt": vObjeto({
    workspace_id: vIdWorkspace,
    squad_slug: vSlug,
    objetivo: vObjetivo,
    plano_antes: vNulavel(vBooleano),
    rigidez: vNulavel(vRigidez),
    max_paralelos: vNulavel(vInteiro({ min: LIMITES_SQUAD.instancias_min, max: LIMITES_SQUAD.instancias_max })),
  }),
  "squads:execucoes_listar": vObjetoOpc({ workspace_id: vIdWorkspace, limite: vInteiro({ min: 1, max: LIMITES_SQUAD.execucoes_limite_max }) }, { cursor: vIdExecucao }),
  "squads:exportar": refinar(vObjetoOpc({ slug: vSlug, destino: vEnum(["repo", "arquivo"] as const) }, { workspace_id: vIdWorkspace }), (e) =>
    e.destino === "repo" && e.workspace_id === undefined ? "workspace_id: obrigatório para destino repo" : null,
  ),
  "squads:importar_previa": refinar(
    vObjetoOpc({ origem: vEnum(["repo", "arquivo"] as const) }, { workspace_id: vIdWorkspace, nome: vSlug }),
    (e) => {
      if (e.origem === "repo" && (e.workspace_id === undefined || e.nome === undefined)) return "workspace_id e nome: obrigatórios para origem repo";
      if (e.origem === "arquivo" && (e.workspace_id !== undefined || e.nome !== undefined)) return "origem arquivo usa só o seletor nativo do main";
      return null;
    },
  ),
  "squads:importar_confirmar": vObjetoOpc({ previa_id: vIdPrevia }, { slug: vSlug }),
  "agentes:listar": vObjetoOpc({}, { squad: vSlug }),
  "agentes:prompt_ler": vAgentEntrada,
  "agentes:prompt_gravar": vObjeto({ agent_id: vAgentId, texto: vPromptTexto, hash_esperado: vHash }),
  "agentes:prompt_previa": refinar(
    vObjetoOpc(
      { agent_id: vNulavel(vAgentId) },
      {
        texto: vPromptTexto,
        exemplo: vObjeto({ objetivo: vTextoUsuario(LIMITES_SQUAD.objetivo_max), arquivos: vLista(vSemCaminhoNemUrl({ min: 1, max: 200 }), 50) }),
      },
    ),
    (e) => (e.agent_id === null && e.texto === undefined ? "nada para pré-visualizar (agent_id ou texto)" : null),
  ),
  "agentes:prompt_restaurar": vAgentEntrada,
  "agentes:perfil_opcoes": vObjeto({ cli: vCli }),
  "agentes:abrir_pane": vObjetoOpc({ workspace_id: vIdWorkspace, agent_id: vAgentId }, { objetivo: vObjetivo }),
} satisfies ValidadoresDaFamilia<"squads:"> & ValidadoresDaFamilia<"agentes:">;

export type CanalSquads = keyof typeof VALIDADORES_SQUADS;

// ---------------------------------------------------------------- manipuladores (T-14.09, T-14.10, T-14.16, T-14.21)

/**
 * Erro que o renderer pode ver: os NOMINAIS (loja, execução, formato, domínio, MCP) passam com a mensagem; qualquer outra coisa
 * (ex.: `ENOENT` com caminho absoluto) vira texto genérico, para nunca vazar caminho de máquina.
 */
export function sanearErroDeSquads(e: unknown): Error {
  if (e instanceof LojaError || e instanceof ErroDeSquad || e instanceof ErroMcp || e instanceof FormatoInvalidoError || e instanceof VersaoMaiorError || e instanceof NaoEncontradoErro || e instanceof ValorInvalidoErro) return e;
  return new Error("falha ao executar a operação de squads");
}

export type DependenciasManipuladoresSquads = Pick<LigacaoSquads, "servico" | "portabilidade" | "execucao" | "atualizarClis" | "abrirAgente">;

/** Manipuladores puros (testáveis sem IPC). */
export function criarManipuladoresSquads(l: DependenciasManipuladoresSquads) {
  const { servico, portabilidade, execucao } = l;
  const cuidar = async <T>(f: () => T | Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      throw sanearErroDeSquads(e);
    }
  };
  return {
    "squads:listar": (p: CanaisInvoke["squads:listar"]["entrada"]) => cuidar(() => servico.listar(p)),
    "squads:obter": (p: { slug: string }) => cuidar(() => servico.obter(p.slug)),
    "squads:gravar": (p: CanaisInvoke["squads:gravar"]["entrada"]) => cuidar(() => servico.gravar(p)),
    "squads:validar": (p: CanaisInvoke["squads:validar"]["entrada"]) =>
      cuidar(async () => {
        if (p.workspace_id !== null) await l.atualizarClis();
        return servico.validar(p.squad, p.workspace_id);
      }),
    "squads:duplicar": (p: CanaisInvoke["squads:duplicar"]["entrada"]) => cuidar(() => servico.duplicar(p)),
    "squads:apagar": (p: CanaisInvoke["squads:apagar"]["entrada"]) => cuidar(() => servico.apagar(p)),
    "squads:fabrica_atualizacao": (p: { slug: string }) => cuidar(() => servico.fabricaAtualizacao(p.slug)),
    "squads:fabrica_aplicar": (p: CanaisInvoke["squads:fabrica_aplicar"]["entrada"]) => cuidar(() => servico.fabricaAplicar(p)),
    "squads:fabrica_diff": (p: CanaisInvoke["squads:fabrica_diff"]["entrada"]) => cuidar(() => servico.fabricaDiff(p)),
    "squads:lixeira_listar": () => cuidar(() => servico.listarLixeira()),
    "squads:lixeira_restaurar": (p: CanaisInvoke["squads:lixeira_restaurar"]["entrada"]) => cuidar(() => servico.restaurarDaLixeira(p.nome)),
    "squads:execucao_arquivo": (p: CanaisInvoke["squads:execucao_arquivo"]["entrada"]) => cuidar(() => execucao.lerArquivo(p)),
    "squads:preflight": (p: CanaisInvoke["squads:preflight"]["entrada"]) => cuidar(() => execucao.preflight(p)),
    "squads:enviar_prompt": (p: CanaisInvoke["squads:enviar_prompt"]["entrada"]) => cuidar(() => execucao.enviarPrompt(p)),
    "squads:execucoes_listar": (p: CanaisInvoke["squads:execucoes_listar"]["entrada"]) => cuidar(() => execucao.listarExecucoes(p)),
    "squads:exportar": (p: CanaisInvoke["squads:exportar"]["entrada"]) => cuidar(() => portabilidade.exportar(p)),
    "squads:importar_previa": (p: CanaisInvoke["squads:importar_previa"]["entrada"]) => cuidar(() => portabilidade.importarPrevia(p)),
    "squads:importar_confirmar": (p: CanaisInvoke["squads:importar_confirmar"]["entrada"]) => cuidar(() => portabilidade.importarConfirmar(p)),
    "agentes:listar": (p: { squad?: string }) => cuidar(() => servico.listarAgentes(p.squad)),
    "agentes:prompt_ler": (p: { agent_id: string }) => cuidar(() => servico.lerPrompt(p.agent_id)),
    "agentes:prompt_gravar": (p: CanaisInvoke["agentes:prompt_gravar"]["entrada"]) => cuidar(() => servico.gravarPrompt(p)),
    "agentes:prompt_previa": (p: CanaisInvoke["agentes:prompt_previa"]["entrada"]) => cuidar(() => servico.previaPrompt(p)),
    "agentes:prompt_restaurar": (p: { agent_id: string }) => cuidar(() => servico.restaurarPrompt(p.agent_id)),
    "agentes:perfil_opcoes": (p: { cli: string }) =>
      cuidar(async () => {
        await l.atualizarClis();
        return servico.perfilOpcoes(p.cli);
      }),
    "agentes:abrir_pane": (p: CanaisInvoke["agentes:abrir_pane"]["entrada"]) => cuidar(() => l.abrirAgente(p)),
  };
}

export interface DependenciasIpcSquads {
  registro: RegistroIpc;
  ligacao: DependenciasManipuladoresSquads;
}

/** Registra os 25 canais (um manipulador por canal). */
export function registrarIpcSquads(d: DependenciasIpcSquads): void {
  const m = criarManipuladoresSquads(d.ligacao);
  const V = VALIDADORES_SQUADS;
  const r = d.registro;
  r.invoke("squads:listar", V["squads:listar"], (e) => m["squads:listar"](e));
  r.invoke("squads:obter", V["squads:obter"], (e) => m["squads:obter"](e));
  r.invoke("squads:gravar", V["squads:gravar"], (e) => m["squads:gravar"](e));
  r.invoke("squads:validar", V["squads:validar"], (e) => m["squads:validar"](e));
  r.invoke("squads:duplicar", V["squads:duplicar"], (e) => m["squads:duplicar"](e));
  r.invoke("squads:apagar", V["squads:apagar"], (e) => m["squads:apagar"](e));
  r.invoke("squads:fabrica_atualizacao", V["squads:fabrica_atualizacao"], (e) => m["squads:fabrica_atualizacao"](e));
  r.invoke("squads:fabrica_aplicar", V["squads:fabrica_aplicar"], (e) => m["squads:fabrica_aplicar"](e));
  r.invoke("squads:fabrica_diff", V["squads:fabrica_diff"], (e) => m["squads:fabrica_diff"](e));
  r.invoke("squads:lixeira_listar", V["squads:lixeira_listar"], () => m["squads:lixeira_listar"]());
  r.invoke("squads:lixeira_restaurar", V["squads:lixeira_restaurar"], (e) => m["squads:lixeira_restaurar"](e));
  r.invoke("squads:execucao_arquivo", V["squads:execucao_arquivo"], (e) => m["squads:execucao_arquivo"](e));
  r.invoke("squads:preflight", V["squads:preflight"], (e) => m["squads:preflight"](e));
  r.invoke("squads:enviar_prompt", V["squads:enviar_prompt"], (e) => m["squads:enviar_prompt"](e));
  r.invoke("squads:execucoes_listar", V["squads:execucoes_listar"], (e) => m["squads:execucoes_listar"](e));
  r.invoke("squads:exportar", V["squads:exportar"], (e) => m["squads:exportar"](e));
  r.invoke("squads:importar_previa", V["squads:importar_previa"], (e) => m["squads:importar_previa"](e));
  r.invoke("squads:importar_confirmar", V["squads:importar_confirmar"], (e) => m["squads:importar_confirmar"](e));
  r.invoke("agentes:listar", V["agentes:listar"], (e) => m["agentes:listar"](e));
  r.invoke("agentes:prompt_ler", V["agentes:prompt_ler"], (e) => m["agentes:prompt_ler"](e));
  r.invoke("agentes:prompt_gravar", V["agentes:prompt_gravar"], (e) => m["agentes:prompt_gravar"](e));
  r.invoke("agentes:prompt_previa", V["agentes:prompt_previa"], (e) => m["agentes:prompt_previa"](e));
  r.invoke("agentes:prompt_restaurar", V["agentes:prompt_restaurar"], (e) => m["agentes:prompt_restaurar"](e));
  r.invoke("agentes:perfil_opcoes", V["agentes:perfil_opcoes"], (e) => m["agentes:perfil_opcoes"](e));
  r.invoke("agentes:abrir_pane", V["agentes:abrir_pane"], (e) => m["agentes:abrir_pane"](e));
}
