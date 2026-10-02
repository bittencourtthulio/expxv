// Canais `custo:*` e `board:*` (Fase 10, T-10.01/T-10.11/T-10.13): validadores ESTRITOS (campo extra, tipo errado, escopo desconhecido, caminho absoluto, `limite > 200`,
// `teto_usd <= 0`, `confirmar` ausente) e manipuladores que delegam à `LigacaoCusto` (src/main/custo.ts). O renderer nunca envia caminho, cwd, valor de custo nem tokens:
// só ids, enums, datas, preços e filtros. Erros nominais atravessam como `<codigo>: <mensagem>`; qualquer outro vira texto genérico.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { AGRUPAR_CUSTO, COLUNAS_BOARD, ESCOPOS_CUSTO, SELOS_CARD, type ConfigBoard, type ConfigCusto, type FiltrosBoard } from "../../compartilhado/custo";
import { sanearErroDeCusto, type LigacaoCusto } from "../custo";
import { vIdConta, vIdMissao, vIdPane, vIdTrabalho, vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNulavel, vNumero, vObjetoOpc, type ValidadoresDaFamilia } from "./validar-harness";

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
const ID_TASK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const vIdTask = vTexto({ min: 1, max: 64, padrao: ID_TASK });
const vIdSprint = vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/ });
const vIdPreco = vTexto({ min: 1, max: 160, padrao: /^[A-Za-z0-9][A-Za-z0-9_.:/@*?-]{0,159}$/ });
/** Data `YYYY-MM-DD` ou ISO UTC com ms; instante inválido é recusado. */
const vData: Validador<string> = refinar(vTexto({ min: 10, max: 30, padrao: /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/ }), (t) => (Number.isFinite(Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t)) ? null : "data inválida"));
const vModelo = refinar(vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/ }), (m) => (m.includes("..") || m.includes("//") ? "modelo inválido" : null));
const vUsd = vNumero({ min: 0, max: 1_000_000 });
const vCursor = vTexto({ min: 1, max: 300, padrao: /^[^\u0000-\u001f\u007f]+$/ });

/** Chave de escopo: cada escopo tem a SUA forma (`card` = `ws|trabalho|task`, `trabalho` = `ws|trabalho`, os demais = um id gerado). Caminho nunca passa. */
const CHAVE_PARTES: Record<string, (n: number) => boolean> = { card: (n) => n === 3, trabalho: (n) => n === 2, missao: (n) => n === 1, workspace: (n) => n === 1, conta: (n) => n === 1, pane: (n) => n === 1 };
const vResumo: Validador<CanaisInvoke["custo:resumo"]["entrada"]> = (v) => {
  const r = vObjeto({ escopo: vEnum(ESCOPOS_CUSTO), chave: vTexto({ min: 1, max: 260, padrao: /^[A-Za-z0-9_.|-]+$/ }) })(v);
  if (!r.ok) return r;
  const { escopo, chave } = r.valor;
  const partes = chave.split("|");
  if (!(CHAVE_PARTES[escopo]?.(partes.length) ?? false)) return falha("chave incompatível com o escopo");
  const idOk: Record<string, Validador<string>> = { card: vIdTask, trabalho: vIdTrabalho, missao: vIdMissao, workspace: vIdWorkspace, conta: vIdConta, pane: vIdPane };
  const checks = escopo === "card" ? [vIdWorkspace(partes[0]), vIdTrabalho(partes[1]), vIdTask(partes[2])] : escopo === "trabalho" ? [vIdWorkspace(partes[0]), vIdTrabalho(partes[1])] : [(idOk[escopo] as Validador<string>)(partes[0])];
  return checks.every((c) => c.ok) ? ok({ escopo, chave }) : falha("chave inválida para o escopo");
};

const vFiltrosRelatorio = vObjetoOpc({}, { workspace_id: vIdWorkspace, mission_id: vIdMissao, trabalho_id: vIdTrabalho, conta_id: vIdConta, modelo: vTexto({ min: 0, max: 100, padrao: /^[A-Za-z0-9._:/@-]{0,100}$/ }) });
const vRelatorio: Validador<CanaisInvoke["custo:relatorio"]["entrada"]> = refinar(
  vObjetoOpc({ agrupar: vEnum(AGRUPAR_CUSTO), desde: vData, ate: vData }, { filtros: vFiltrosRelatorio, cursor: vNulavel(vCursor), limite: vInteiro({ min: 1, max: 200 }) }),
  (e) => (e.desde.slice(0, 10) > e.ate.slice(0, 10) ? "desde depois de ate" : Date.parse(e.ate.slice(0, 10)) - Date.parse(e.desde.slice(0, 10)) > 3660 * 86_400_000 ? "período longo demais" : null),
) as Validador<CanaisInvoke["custo:relatorio"]["entrada"]>;

const vPreco = refinar(
  vObjetoOpc(
    { padrao: vIdPreco, entrada_por_mtok: vUsd, saida_por_mtok: vUsd },
    { cache_escrita_por_mtok: vNulavel(vUsd), cache_leitura_por_mtok: vNulavel(vUsd), familia: vNulavel(vTexto({ min: 1, max: 40, padrao: /^[a-z][a-z0-9_-]{0,39}$/ })) },
  ),
  (p) => (p.padrao.includes("..") ? "padrão inválido" : null),
) as Validador<CanaisInvoke["custo:preco_gravar"]["entrada"]>;

const vConfigCusto: Validador<ConfigCusto> = vObjeto({
  cambio_brl: vNulavel(vNumero({ min: 0.01, max: 1000 })),
  alertar_preco_ausente: vBooleano,
  teto_padrao_missao_usd: vNulavel(vNumero({ min: 0.01, max: 1_000_000 })),
  ler_transcripts: vBooleano,
  retencao_bruta_dias: vInteiro({ min: 7, max: 3650 }),
  aviso_teto_pct: vNulavel(vNumero({ min: 1, max: 100 })),
}) as Validador<ConfigCusto>;

const vFiltrosBoard: Validador<FiltrosBoard> = vObjetoOpc(
  { workspace_id: vIdWorkspace },
  {
    trabalho_ids: vLista(vIdTrabalho, 50),
    mission_id: vIdMissao,
    colunas: vLista(vEnum(COLUNAS_BOARD), 6),
    selos: vLista(vEnum(SELOS_CARD), 5),
    modelo: vModelo,
    com_custo: vBooleano,
    busca: vTexto({ min: 0, max: 100, padrao: /^[^\u0000-\u001f\u007f]*$/ }),
    agrupar: vEnum(["nenhum", "trabalho", "fase"] as const),
    ordenar: vEnum(["plano", "custo", "recente"] as const),
    mostrar_descartados: vBooleano,
  },
) as Validador<FiltrosBoard>;
const vDetalhe = vObjeto({ workspace_id: vIdWorkspace, trabalho_id: vIdTrabalho, task_id: vIdTask });
const vConfigBoard: Validador<ConfigBoard> = (v) => {
  const r = vObjetoOpc({ wip: (x) => (typeof x === "object" && x !== null && !Array.isArray(x) ? ok(x as Record<string, unknown>) : falha("esperado objeto")) }, { bloquear_ao_estourar_teto: (x) => (typeof x === "boolean" ? ok(x) : falha("esperado booleano")) })(v);
  if (!r.ok) return r;
  const wip: ConfigBoard["wip"] = {};
  for (const [k, val] of Object.entries(r.valor.wip)) {
    if (!(COLUNAS_BOARD as readonly string[]).includes(k)) return falha(`coluna desconhecida: ${k}`);
    if (val === null) continue;
    const n = vInteiro({ min: 1, max: 999 })(val);
    if (!n.ok) return falha(`wip.${k}: ${n.erro}`);
    wip[k as keyof ConfigBoard["wip"]] = n.valor;
  }
  return ok(r.valor.bloquear_ao_estourar_teto === true ? { wip, bloquear_ao_estourar_teto: true } : { wip });
};

export const VALIDADORES_CUSTO = {
  "custo:resumo": vResumo,
  "custo:relatorio": vRelatorio,
  "custo:estimativa": vObjetoOpc({}, { workspace_id: vIdWorkspace, task_type: vTexto({ min: 1, max: 60, padrao: /^[a-z][a-z0-9_-]{0,59}$/ }), trabalho_id: vIdTrabalho, task_id: vIdTask }) as Validador<CanaisInvoke["custo:estimativa"]["entrada"]>,
  "custo:previsao_missao": vObjeto({ mission_id: vIdMissao }),
  "custo:previsao_periodo": refinar(vObjeto({ workspace_id: vIdWorkspace, inicio: vData, fim: vData }), (e) => (e.inicio.slice(0, 10) > e.fim.slice(0, 10) ? "inicio depois de fim" : null)),
  "custo:sprint": vObjeto({ workspace_id: vIdWorkspace, sprint_id: vIdSprint }),
  "custo:fontes": vObjetoOpc({}, { workspace_id: vIdWorkspace }) as Validador<CanaisInvoke["custo:fontes"]["entrada"]>,
  "custo:precos_listar": vObjeto({}) as Validador<Record<string, never>>,
  "custo:preco_gravar": vPreco,
  "custo:preco_apagar": vObjeto({ id: vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9_]{1,80}$/ }) }),
  "custo:reprecificar": vObjetoOpc({}, { desde: vData, simular: vBooleano }) as Validador<CanaisInvoke["custo:reprecificar"]["entrada"]>,
  "custo:config_ler": vObjeto({}) as Validador<Record<string, never>>,
  "custo:config_gravar": vConfigCusto,
  "custo:teto_gravar": vObjeto({ mission_id: vIdMissao, teto_usd: vNulavel(vNumero({ min: 0.01, max: 1_000_000 })) }),
  "custo:reindexar": vObjetoOpc({}, { workspace_id: vIdWorkspace }) as Validador<CanaisInvoke["custo:reindexar"]["entrada"]>,
  "custo:diagnostico": vObjeto({}) as Validador<Record<string, never>>,
} satisfies ValidadoresDaFamilia<"custo:">;

export const VALIDADORES_BOARD = {
  "board:snapshot": vObjeto({ filtros: vFiltrosBoard }),
  "board:card_detalhe": vDetalhe,
  "board:abrir_arquivo": vDetalhe,
  "board:delegar_card": vObjeto({ workspace_id: vIdWorkspace, trabalho_id: vIdTrabalho, task_id: vIdTask, mission_id: vIdMissao, confirmar: (v) => (v === true ? ok(true as const) : falha("confirmar:true é obrigatório")) }),
  "board:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "board:config_gravar": vObjeto({ workspace_id: vIdWorkspace, config: vConfigBoard }),
} satisfies ValidadoresDaFamilia<"board:">;

export type CanalCusto = keyof typeof VALIDADORES_CUSTO | keyof typeof VALIDADORES_BOARD;
export const CANAIS_CUSTO_E_BOARD = [...Object.keys(VALIDADORES_CUSTO), ...Object.keys(VALIDADORES_BOARD)] as CanalCusto[];

/** Manipuladores puros (testáveis sem IPC): um por canal; erro do núcleo/domínio sai saneado. */
export function criarManipuladoresCusto(l: LigacaoCusto) {
  const cuidar = async <T>(f: () => T | Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      throw sanearErroDeCusto(e);
    }
  };
  type E<C extends CanalCusto> = CanaisInvoke[C]["entrada"];
  return {
    "custo:resumo": (p: E<"custo:resumo">) => cuidar(() => l.resumo(p)),
    "custo:relatorio": (p: E<"custo:relatorio">) => cuidar(() => l.relatorio(p)),
    "custo:estimativa": (p: E<"custo:estimativa">) => cuidar(() => l.estimativa(p)),
    "custo:previsao_missao": (p: E<"custo:previsao_missao">) => cuidar(() => l.previsaoMissao(p.mission_id)),
    "custo:previsao_periodo": (p: E<"custo:previsao_periodo">) => cuidar(() => l.previsaoPeriodo(p.workspace_id, p.inicio, p.fim)),
    "custo:sprint": (p: E<"custo:sprint">) => cuidar(() => l.custoSprint(p.workspace_id, p.sprint_id)),
    "custo:fontes": (p: E<"custo:fontes">) => cuidar(() => l.fontes(p.workspace_id)),
    "custo:precos_listar": () => cuidar(() => l.precosListar()),
    "custo:preco_gravar": (p: E<"custo:preco_gravar">) => cuidar(() => l.precoGravar(p)),
    "custo:preco_apagar": (p: E<"custo:preco_apagar">) => cuidar(() => l.precoApagar(p.id)),
    "custo:reprecificar": (p: E<"custo:reprecificar">) => cuidar(() => l.reprecificar(p)),
    "custo:config_ler": () => cuidar(() => l.configLer()),
    "custo:config_gravar": (p: E<"custo:config_gravar">) => cuidar(() => l.configGravar(p)),
    "custo:teto_gravar": (p: E<"custo:teto_gravar">) => cuidar(() => l.tetoGravar(p.mission_id, p.teto_usd)),
    "custo:reindexar": (p: E<"custo:reindexar">) => cuidar(() => l.reindexar(p.workspace_id)),
    "custo:diagnostico": () => cuidar(() => l.diagnostico()),
    "board:snapshot": (p: E<"board:snapshot">) => cuidar(() => l.board().snapshot(p.filtros)),
    "board:card_detalhe": (p: E<"board:card_detalhe">) => cuidar(() => l.board().cardDetalhe(p)),
    "board:abrir_arquivo": (p: E<"board:abrir_arquivo">) => cuidar(() => l.board().abrirArquivo(p)),
    "board:delegar_card": (p: E<"board:delegar_card">) => cuidar(() => l.board().delegar(p)),
    "board:config_ler": (p: E<"board:config_ler">) => cuidar(() => l.board().configLer(p.workspace_id)),
    "board:config_gravar": (p: E<"board:config_gravar">) => cuidar(() => l.board().configGravar(p.workspace_id, p.config)),
  };
}

export interface DependenciasIpcCusto {
  registro: RegistroIpc;
  ligacao: LigacaoCusto;
}

/** Registra os 22 canais (um manipulador por canal). Nada de banco nem processo aqui: só validadores e delegação preguiçosa. */
export function registrarIpcCusto(d: DependenciasIpcCusto): void {
  const m = criarManipuladoresCusto(d.ligacao);
  const r = d.registro;
  r.invoke("custo:resumo", VALIDADORES_CUSTO["custo:resumo"], (e) => m["custo:resumo"](e));
  r.invoke("custo:relatorio", VALIDADORES_CUSTO["custo:relatorio"], (e) => m["custo:relatorio"](e));
  r.invoke("custo:estimativa", VALIDADORES_CUSTO["custo:estimativa"], (e) => m["custo:estimativa"](e));
  r.invoke("custo:previsao_missao", VALIDADORES_CUSTO["custo:previsao_missao"], (e) => m["custo:previsao_missao"](e));
  r.invoke("custo:previsao_periodo", VALIDADORES_CUSTO["custo:previsao_periodo"], (e) => m["custo:previsao_periodo"](e));
  r.invoke("custo:sprint", VALIDADORES_CUSTO["custo:sprint"], (e) => m["custo:sprint"](e));
  r.invoke("custo:fontes", VALIDADORES_CUSTO["custo:fontes"], (e) => m["custo:fontes"](e));
  r.invoke("custo:precos_listar", VALIDADORES_CUSTO["custo:precos_listar"], () => m["custo:precos_listar"]());
  r.invoke("custo:preco_gravar", VALIDADORES_CUSTO["custo:preco_gravar"], (e) => m["custo:preco_gravar"](e));
  r.invoke("custo:preco_apagar", VALIDADORES_CUSTO["custo:preco_apagar"], (e) => m["custo:preco_apagar"](e));
  r.invoke("custo:reprecificar", VALIDADORES_CUSTO["custo:reprecificar"], (e) => m["custo:reprecificar"](e));
  r.invoke("custo:config_ler", VALIDADORES_CUSTO["custo:config_ler"], () => m["custo:config_ler"]());
  r.invoke("custo:config_gravar", VALIDADORES_CUSTO["custo:config_gravar"], (e) => m["custo:config_gravar"](e));
  r.invoke("custo:teto_gravar", VALIDADORES_CUSTO["custo:teto_gravar"], (e) => m["custo:teto_gravar"](e));
  r.invoke("custo:reindexar", VALIDADORES_CUSTO["custo:reindexar"], (e) => m["custo:reindexar"](e));
  r.invoke("custo:diagnostico", VALIDADORES_CUSTO["custo:diagnostico"], () => m["custo:diagnostico"]());
  r.invoke("board:snapshot", VALIDADORES_BOARD["board:snapshot"], (e) => m["board:snapshot"](e));
  r.invoke("board:card_detalhe", VALIDADORES_BOARD["board:card_detalhe"], (e) => m["board:card_detalhe"](e));
  r.invoke("board:abrir_arquivo", VALIDADORES_BOARD["board:abrir_arquivo"], (e) => m["board:abrir_arquivo"](e));
  r.invoke("board:delegar_card", VALIDADORES_BOARD["board:delegar_card"], (e) => m["board:delegar_card"](e));
  r.invoke("board:config_ler", VALIDADORES_BOARD["board:config_ler"], (e) => m["board:config_ler"](e));
  r.invoke("board:config_gravar", VALIDADORES_BOARD["board:config_gravar"], (e) => m["board:config_gravar"](e));
}
