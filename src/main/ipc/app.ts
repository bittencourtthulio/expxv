import type { TemaEfetivo, TemaPreferencia } from "../../compartilhado/ipc";
import type { MarcasPerf } from "../perf";
import type { Preferencias } from "../preferencias";
import { preferenciaValida, resolverTema } from "../tema";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vJson, vObjeto, vTexto, vVazio, type Validador } from "./validar";

const CHAVE_TEMA = "tema_preferencia";
const PADRAO_CHAVE = /^[a-z0-9_.-]+$/;
export const PREFIXOS_RESERVADOS = ["tema_", "sistema_"] as const;

/** Faixa por chave de ajuste conhecida (o renderer valida a mesma faixa; o main nunca confia nele). */
const vCorDestaque: Validador<unknown> = (v) => (v === null || (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) ? { ok: true, valor: v } : { ok: false, erro: "cor inválida" });
export const FAIXAS_CONFIG: Readonly<Record<string, Validador<unknown>>> = {
  terminal_scrollback: vInteiro({ min: 500, max: 50_000 }),
  limite_paineis: vInteiro({ min: 1, max: 64 }),
  permissao_padrao: vEnum(["seguro", "automatico"] as const),
  cor_destaque: vCorDestaque,
  notificacoes: vBooleano,
};

/** Lança se a chave é conhecida e o valor está fora da faixa; chaves desconhecidas passam. */
export function validarFaixaConfig(chave: string, valor: unknown): void {
  const v = FAIXAS_CONFIG[chave];
  if (v === undefined || !Object.hasOwn(FAIXAS_CONFIG, chave)) return;
  const r = v(valor);
  if (!r.ok) throw new Error(`valor fora da faixa para ${chave}: ${r.erro}`);
}

export const VALIDADORES_APP = {
  versao: vVazio,
  temaLer: vVazio,
  temaDefinir: vObjeto({ preferencia: vEnum(["claro", "escuro", "sistema"] as const) }),
  configLer: vObjeto({ chave: vTexto({ min: 1, max: 80, padrao: PADRAO_CHAVE }) }),
  configGravar: vObjeto({ chave: vTexto({ min: 1, max: 80, padrao: PADRAO_CHAVE }), valor: vJson(64 * 1024) }),
  perf: vVazio,
  marcaPerf: vObjeto({ nome: vTexto({ min: 1, max: 80, padrao: /^[a-zA-Z0-9_:.-]+$/ }) }),
} as const;

export interface DependenciasApp {
  registro: RegistroIpc;
  versao: string;
  preferencias: Preferencias;
  marcas: MarcasPerf;
  /** o SO está em modo escuro? */
  sistemaEscuro: () => boolean;
  /** aplica o tema efetivo (nativeTheme + fundo da janela) e avisa o renderer. */
  aoMudarTema: (estado: { preferencia: TemaPreferencia; efetivo: TemaEfetivo }) => void;
}

export function estadoDoTema(d: Pick<DependenciasApp, "preferencias" | "sistemaEscuro">): { preferencia: TemaPreferencia; efetivo: TemaEfetivo } {
  const preferencia = preferenciaValida(d.preferencias.obter(CHAVE_TEMA));
  return { preferencia, efetivo: resolverTema(preferencia, d.sistemaEscuro()) };
}

export function registrarIpcApp(d: DependenciasApp): void {
  const { registro } = d;
  registro.invoke("app:versao", VALIDADORES_APP.versao, () => d.versao);
  registro.invoke("app:tema_ler", VALIDADORES_APP.temaLer, () => estadoDoTema(d));
  registro.invoke("app:tema_definir", VALIDADORES_APP.temaDefinir, async ({ preferencia }) => {
    await d.preferencias.definir(CHAVE_TEMA, preferencia);
    const estado = estadoDoTema(d);
    d.aoMudarTema(estado);
    return estado;
  });
  registro.invoke("app:config_ler", VALIDADORES_APP.configLer, ({ chave }) => d.preferencias.obter(chave));
  registro.invoke("app:config_gravar", VALIDADORES_APP.configGravar, async ({ chave, valor }) => {
    if (PREFIXOS_RESERVADOS.some((p) => chave.startsWith(p))) throw new Error("chave reservada");
    validarFaixaConfig(chave, valor);
    await d.preferencias.definir(chave, valor);
    return { ok: true as const };
  });
  registro.invoke("app:perf", VALIDADORES_APP.perf, () => d.marcas.ler());
  registro.envio("app:marca_perf", VALIDADORES_APP.marcaPerf, ({ nome }) => d.marcas.marcar(`renderer:${nome}`));
}
