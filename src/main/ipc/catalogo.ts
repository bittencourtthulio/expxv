// Canais `catalogo:*` (Fase 7, T-07.12): validadores estritos + registro. O renderer NUNCA envia caminho: só `item_id`, `cli`, `escopo` e ids de workspace.
// Erros nominais (`ErroCatalogo`) passam; o resto vira texto genérico (nunca caminho de máquina).
import { CLIS_CATALOGO, TIPOS_CATALOGO } from "../../compartilhado/catalogo";
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { ErroCatalogo, type ServicoCatalogo } from "../../nucleo/catalogo/servico";
import { vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNulavel, type ValidadoresDaFamilia } from "./validar-harness";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

const vItemId = vTexto({ min: 5, max: 40, padrao: /^cat_[0-9A-Za-z]{10,36}$/ });
const vCli = vEnum(CLIS_CATALOGO);
const vTipo = vEnum(TIPOS_CATALOGO);
const vEscopo = vEnum(["global", "projeto"] as const);
const vWsOuNulo = vNulavel(vIdWorkspace);
/** Nome de skill ou `grupo:<id>`; nunca caminho. */
const vNomeSkill = vTexto({ min: 1, max: 80, padrao: /^(grupo:)?[A-Za-z0-9][A-Za-z0-9:._ -]{0,78}$/ });
const vNomeServidor = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9][A-Za-z0-9:._ -]{0,78}$/ });
const vNomeEmbarcada = vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9-]{0,63}$/ });
const vAceitoTrue: Validador<true> = (v) => (v === true ? ok(true) : falha("confirmação exigida: confirmado deve ser true"));
const vListaOuNula = <T>(i: Validador<T>, max: number): Validador<T[] | null> => (v) => (v === null ? ok(null) : vLista(i, max)(v));
const vAlvoValor = vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/ });

export const VALIDADORES_CATALOGO = {
  "catalogo:varrer": vObjeto({ workspace_id: vWsOuNulo, tipos: vListaOuNula(vTipo, 8), clis: vListaOuNula(vCli, 5) }),
  "catalogo:listar": vObjeto({ tipo: vTipo, workspace_id: vWsOuNulo }),
  "catalogo:detalhe": vObjeto({ item_id: vItemId }),
  "catalogo:instalar": vObjeto({ item_id: vItemId, de_cli: vCli, para_cli: vCli, modo: vEnum(["symlink", "copia"] as const) }),
  "catalogo:desinstalar": vObjeto({ item_id: vItemId, cli: vCli, escopo: vEscopo, workspace_id: vWsOuNulo, modo: vEnum(["remover_criado", "lixeira"] as const) }),
  "catalogo:limpar_ausentes": vObjeto({ tipo: vTipo }),
  "catalogo:remover_do_catalogo": vObjeto({ item_id: vItemId }),
  "catalogo:revelar": vObjeto({ item_id: vItemId, cli: vCli, escopo: vEscopo, workspace_id: vWsOuNulo }),
  "catalogo:verificar_mcp": vObjeto({ item_id: vItemId, confirmado: vAceitoTrue }),
  "catalogo:politica_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "catalogo:politica_gravar": vObjeto({
    workspace_id: vIdWorkspace, alvo_tipo: vEnum(["papel", "agente", "missao"] as const), alvo_valor: vAlvoValor,
    skills: vLista(vNomeSkill, 200), mcp_do_usuario: vEnum(["nenhum", "lista"] as const), servidores_mcp: vLista(vNomeServidor, 100),
  }),
  "catalogo:politica_previa": vObjeto({
    workspace_id: vIdWorkspace, modo: vEnum(["livre", "squad", "agentico"] as const), papel: vEnum(["piloto", "executor", "explorador", "revisor"] as const),
    agente_id: vNulavel(vAlvoValor), mission_id: vNulavel(vAlvoValor), cli: vCli,
  }),
  "catalogo:saude": vObjeto({ workspace_id: vWsOuNulo }),
  "catalogo:embarcadas_estado": vObjeto({}),
  "catalogo:embarcadas_instalar": vObjeto({ nome: vNulavel(vNomeEmbarcada), cli: vCli }),
  "catalogo:embarcadas_opt_out": vObjeto({ nome: vNomeEmbarcada, cli: vCli, valor: vBooleano }),
} satisfies ValidadoresDaFamilia<"catalogo:">;

export type CanalCatalogo = keyof typeof VALIDADORES_CATALOGO;

const CODIGOS_PUBLICOS = new Set(["confirmacao_exigida", "skill_invalida"]);
export function sanearErroCatalogo(e: unknown): Error {
  if (e instanceof ErroCatalogo && CODIGOS_PUBLICOS.has(e.codigo)) return e;
  return new Error("falha ao executar a operação do catálogo");
}

export type ProvedorServicoCatalogo = () => ServicoCatalogo | Promise<ServicoCatalogo>;

export function criarManipuladoresCatalogo(provedor: ProvedorServicoCatalogo) {
  const com = async <T>(f: (s: ServicoCatalogo) => T | Promise<T>): Promise<T> => {
    try {
      return await f(await provedor());
    } catch (e) {
      throw sanearErroCatalogo(e);
    }
  };
  type E<C extends CanalCatalogo> = CanaisInvoke[C]["entrada"];
  return {
    "catalogo:varrer": (p: E<"catalogo:varrer">) => com((s) => ({ varredura_id: s.varrer(p, "tela").varredura_id })),
    "catalogo:listar": (p: E<"catalogo:listar">) => com((s) => s.listar(p)),
    "catalogo:detalhe": (p: E<"catalogo:detalhe">) => com((s) => s.detalhe(p.item_id)),
    "catalogo:instalar": (p: E<"catalogo:instalar">) => com((s) => s.instalar(p)),
    "catalogo:desinstalar": (p: E<"catalogo:desinstalar">) => com((s) => s.desinstalar(p)),
    "catalogo:limpar_ausentes": (p: E<"catalogo:limpar_ausentes">) => com((s) => s.limparAusentes(p.tipo)),
    "catalogo:remover_do_catalogo": (p: E<"catalogo:remover_do_catalogo">) => com((s) => s.removerDoCatalogo(p.item_id)),
    "catalogo:revelar": (p: E<"catalogo:revelar">) => com((s) => s.revelar(p)),
    "catalogo:verificar_mcp": (p: E<"catalogo:verificar_mcp">) => com((s) => s.verificarMcp(p.item_id, p.confirmado)),
    "catalogo:politica_ler": (p: E<"catalogo:politica_ler">) => com((s) => s.politicaLer(p.workspace_id)),
    "catalogo:politica_gravar": (p: E<"catalogo:politica_gravar">) => com((s) => s.politicaGravar(p)),
    "catalogo:politica_previa": (p: E<"catalogo:politica_previa">) => com((s) => s.politicaPrevia(p)),
    "catalogo:saude": (p: E<"catalogo:saude">) => com((s) => s.saude(p.workspace_id)),
    "catalogo:embarcadas_estado": () => com((s) => s.embarcadasEstado()),
    "catalogo:embarcadas_instalar": (p: E<"catalogo:embarcadas_instalar">) => com((s) => s.embarcadasInstalar(p.nome, p.cli)),
    "catalogo:embarcadas_opt_out": (p: E<"catalogo:embarcadas_opt_out">) => com((s) => s.embarcadasOptOut(p.nome, p.cli, p.valor)),
  };
}

export interface DependenciasIpcCatalogo {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (worker, manifesto e banco só no primeiro uso) */
  servico: ProvedorServicoCatalogo;
}

/** Registra os 16 canais. Não cria worker nem lê disco: isso é do primeiro uso. */
export function registrarIpcCatalogo(d: DependenciasIpcCatalogo): void {
  const m = criarManipuladoresCatalogo(d.servico);
  const V = VALIDADORES_CATALOGO;
  const r = d.registro;
  r.invoke("catalogo:varrer", V["catalogo:varrer"], (e) => m["catalogo:varrer"](e));
  r.invoke("catalogo:listar", V["catalogo:listar"], (e) => m["catalogo:listar"](e));
  r.invoke("catalogo:detalhe", V["catalogo:detalhe"], (e) => m["catalogo:detalhe"](e));
  r.invoke("catalogo:instalar", V["catalogo:instalar"], (e) => m["catalogo:instalar"](e));
  r.invoke("catalogo:desinstalar", V["catalogo:desinstalar"], (e) => m["catalogo:desinstalar"](e));
  r.invoke("catalogo:limpar_ausentes", V["catalogo:limpar_ausentes"], (e) => m["catalogo:limpar_ausentes"](e));
  r.invoke("catalogo:remover_do_catalogo", V["catalogo:remover_do_catalogo"], (e) => m["catalogo:remover_do_catalogo"](e));
  r.invoke("catalogo:revelar", V["catalogo:revelar"], (e) => m["catalogo:revelar"](e));
  r.invoke("catalogo:verificar_mcp", V["catalogo:verificar_mcp"], (e) => m["catalogo:verificar_mcp"](e));
  r.invoke("catalogo:politica_ler", V["catalogo:politica_ler"], (e) => m["catalogo:politica_ler"](e));
  r.invoke("catalogo:politica_gravar", V["catalogo:politica_gravar"], (e) => m["catalogo:politica_gravar"](e));
  r.invoke("catalogo:politica_previa", V["catalogo:politica_previa"], (e) => m["catalogo:politica_previa"](e));
  r.invoke("catalogo:saude", V["catalogo:saude"], (e) => m["catalogo:saude"](e));
  r.invoke("catalogo:embarcadas_estado", V["catalogo:embarcadas_estado"], () => m["catalogo:embarcadas_estado"]());
  r.invoke("catalogo:embarcadas_instalar", V["catalogo:embarcadas_instalar"], (e) => m["catalogo:embarcadas_instalar"](e));
  r.invoke("catalogo:embarcadas_opt_out", V["catalogo:embarcadas_opt_out"], (e) => m["catalogo:embarcadas_opt_out"](e));
}
