// Canais `alertas:*` e `canais:*` (Fase 20, T-20.02): validadores ESTRITOS (campo extra/ausente é erro) e registro. O renderer nunca define destino fixo de entrega, efemeridade,
// origem nem caminho: isso é do main. Erro nominal do núcleo chega como `Error` `<codigo>: <mensagem>` (ErroAlertasIpc); qualquer outro vira texto genérico (nunca stack, SQL nem caminho).
import { SEVERIDADES, TIPOS_ALERTA } from "../../compartilhado/alertas";
import type { NomeInvoke } from "../../compartilhado/ipc";
import { ErroAlertasIpc, type LigacaoAlertas } from "../alertas";
import { vOuNulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vInstante, vNumero, vObjetoOpc, vTextoUsuario } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]*$/;

export const vTipoAlerta: Validador<(typeof TIPOS_ALERTA)[number]> = vEnum(TIPOS_ALERTA);
export const vSeveridade = vEnum(SEVERIDADES);
export const vNivel = vEnum(["minimo", "padrao", "completo"] as const);
export const vTipoCanalModelo = vEnum(["so", "toast", "telegram", "webhook"] as const);
export const vIdAlerta = vTexto({ min: 1, max: 64, padrao: /^alt_[A-Za-z0-9_-]{6,40}$/ });
export const vIdRegra = vTexto({ min: 1, max: 64, padrao: /^reg_[A-Za-z0-9_-]{6,40}$/ });
export const vIdCanal = vTexto({ min: 1, max: 40, padrao: /^canal_[a-z0-9_]{2,30}$/ });
export const vIdWs = vTexto({ min: 1, max: 64, padrao: /^ws_[0-9A-Za-z]{10,40}$/ });
const vIdMissaoFiltro = vTexto({ min: 1, max: 64, padrao: /^mis_[0-9A-Za-z]{10,40}$/ });
const vHora = vTexto({ min: 5, max: 5, padrao: /^([01]\d|2[0-3]):[0-5]\d$/ });
const vNomeRegra = (v: unknown): Resultado<string> => {
  const r = vTexto({ min: 1, max: 80 })(v);
  if (!r.ok) return r;
  return SEM_CONTROLE.test(r.valor) ? r : falha("texto inválido");
};

const vFiltrosDaLista: Validador<{ estado?: "nao_lidos" | "todos" | "silenciados"; tipos?: Array<(typeof TIPOS_ALERTA)[number]>; severidade_min?: (typeof SEVERIDADES)[number]; workspace_id?: string; mission_id?: string; busca?: string }> = vObjetoOpc(
  {},
  { estado: vEnum(["nao_lidos", "todos", "silenciados"] as const), tipos: vLista(vTipoAlerta, 40), severidade_min: vSeveridade, workspace_id: vIdWs, mission_id: vIdMissaoFiltro, busca: vTextoUsuario(80) },
);

const vAlvoSilenciar: Validador<{ tipo: (typeof TIPOS_ALERTA)[number] } | { entidade_tipo: string; entidade_id: string }> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  if ("tipo" in v) return vObjeto({ tipo: vTipoAlerta })(v);
  return vObjeto({ entidade_tipo: vTexto({ min: 1, max: 30, padrao: /^[a-z_]+$/ }), entidade_id: vTexto({ min: 1, max: 120, padrao: /^[A-Za-z0-9._:|-]+$/ }) })(v);
};

const vMarcarLido: Validador<{ ids: string[] } | { todos: true; filtro?: Record<string, unknown> }> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  if ("ids" in v) {
    const r = vObjeto({ ids: vLista(vIdAlerta, 200) })(v);
    return r.ok ? ok({ ids: r.valor.ids }) : r;
  }
  const r = vObjetoOpc({ todos: (x) => (x === true ? ok(true as const) : falha("esperado true")) }, { filtro: vFiltrosDaLista })(v);
  return r.ok ? ok(r.valor as { todos: true; filtro?: Record<string, unknown> }) : r;
};

const vSilencioDef = vObjetoOpc({}, { inicio: vHora, fim: vHora, dias: vLista(vInteiro({ min: 0, max: 6 }), 7), excecao_critico: vBooleano });
const vRegra: Validador<unknown> = vObjetoOpc(
  { nome: vNomeRegra, ativa: vBooleano, tipos: vLista((v) => (v === "*" ? ok("*" as const) : vTipoAlerta(v)), 40), canal_id: vIdCanal, filtros: vObjetoOpc({}, { workspace_ids: vLista(vIdWs, 50), mission_ids: vLista(vIdMissaoFiltro, 50), severidade_min: vSeveridade, sp_min: vNumero({ min: 0, max: 1000 }), so_atrasadas: vBooleano }), silencio: vSilencioDef, agrupamento: vObjetoOpc({ modo: vEnum(["imediato", "lote", "digest"] as const) }, { janela_s: vInteiro({ min: 1, max: 3600 }), max: vInteiro({ min: 1, max: 100 }), hora_digest: vHora }), nivel: vNivel },
  // `efemera_ate`, `origem` e `chat_ref` só podem chegar vazios: a regra efêmera de pedido remoto é criada pelo main
  { id: vIdRegra, efemera_ate: (v) => (v === null ? ok(null) : falha("o renderer não define efemeridade")), origem: vEnum(["usuario", "padrao"] as const), chat_ref: (v) => (v === null ? ok(null) : falha("o renderer não define destino fixo")) },
);

const vSilencioGlobal: Validador<unknown> = vObjeto({ janela: vSilencioDef, temporario_ate: vOuNulo(vInstante), temporario_incluir_criticos: vBooleano });
const vCorpo = vTexto({ min: 1, max: 2000 });
const vModeloChave = { tipo: vTipoAlerta, canal_tipo: vTipoCanalModelo, nivel: vNivel };
const vConfigPatch: Validador<unknown> = (v) => {
  const r = vObjetoOpc(
    {},
    {
      ligado: vBooleano,
      retencao_dias: vInteiro({ min: 7, max: 365 }),
      pane_aguardando_min: vInteiro({ min: 0, max: 1440 }),
      ocultar_titulos_externos: vBooleano,
      atraso: vObjetoOpc({}, { fator: vNumero({ min: 1, max: 10 }), folga_min: vNumero({ min: 0, max: 1440 }), minimo_amostras: vInteiro({ min: 1, max: 50 }), tabela_pontos_min: (x) => {
        if (typeof x !== "object" || x === null || Array.isArray(x)) return falha("esperado objeto");
        const saida: Record<string, number> = {};
        for (const [k, val] of Object.entries(x)) {
          if (!/^\d{1,3}$/.test(k) || typeof val !== "number" || !Number.isFinite(val) || val < 1 || val > 10_080) return falha("tabela de pontos inválida");
          saida[k] = val;
        }
        return Object.keys(saida).length > 30 ? falha("tabela grande demais") : ok(saida);
      } }),
      digest: vObjetoOpc({}, { diario: vObjetoOpc({}, { ligado: vBooleano, hora: vHora }), sprint: vObjetoOpc({}, { ligado: vBooleano }) }),
    },
  )(v);
  return r;
};

export const VALIDADORES_ALERTAS = {
  "alertas:catalogo": vObjeto({}),
  "alertas:listar": vObjetoOpc({}, { estado: vEnum(["nao_lidos", "todos", "silenciados"] as const), tipos: vLista(vTipoAlerta, 40), severidade_min: vSeveridade, workspace_id: vIdWs, mission_id: vIdMissaoFiltro, busca: vTextoUsuario(80), depois_id: vOuNulo(vIdAlerta), limite: vInteiro({ min: 1, max: 100 }) }),
  "alertas:contar": vObjeto({}),
  "alertas:marcar_lido": vMarcarLido,
  "alertas:silenciar": vObjeto({ alvo: vAlvoSilenciar, ate: vOuNulo(vInstante) }),
  "alertas:regras_listar": vObjeto({}),
  "alertas:regra_gravar": vRegra,
  "alertas:regra_apagar": vObjeto({ id: vIdRegra }),
  "alertas:regra_preset": vObjeto({ preset: vEnum(["tudo_no_app", "atrasadas_e_erros_no_telegram", "resumo_diario", "tarefas_do_telegram"] as const), canal_id: vIdCanal }),
  "alertas:silencio_ler": vObjeto({}),
  "alertas:silencio_gravar": vSilencioGlobal,
  "alertas:modelos_listar": vObjeto({}),
  "alertas:modelo_gravar": vObjeto({ ...vModeloChave, corpo: vCorpo }),
  "alertas:modelo_restaurar": vObjeto(vModeloChave),
  "alertas:modelo_prever": vObjeto({ ...vModeloChave, corpo: vCorpo }),
  "alertas:config_ler": vObjeto({}),
  "alertas:config_gravar": vObjeto({ patch: vConfigPatch }),
  "alertas:abrir_entidade": vObjeto({ alerta_id: vIdAlerta }),
  "canais:listar": vObjeto({}),
  "canais:consentir": vObjeto({ canal_id: vIdCanal, versao_texto: vTexto({ min: 1, max: 20, padrao: /^[A-Za-z0-9._-]+$/ }), hash_texto: vTexto({ min: 64, max: 64, padrao: /^[0-9a-f]{64}$/ }) }),
  "canais:ligar_saida": vObjeto({ canal_id: vIdCanal }),
  "canais:desligar_saida": vObjeto({ canal_id: vIdCanal }),
  "canais:teste_envio": vObjeto({ canal_id: vIdCanal }),
} as const;

export type CanalAlertas = keyof typeof VALIDADORES_ALERTAS;

/** o texto de uma falha NÃO nominal nunca vaza (SQL, caminho, stack). */
export function paraErroIpcAlertas(e: unknown, aviso?: (m: string) => void): Error {
  if (e instanceof ErroAlertasIpc) return e;
  aviso?.(`alertas: ${e instanceof Error ? e.name : "erro"}`);
  return new ErroAlertasIpc("unavailable", "falha ao executar a operação de alertas");
}

export interface DependenciasIpcAlertas {
  registro: RegistroIpc;
  ligacao: () => LigacaoAlertas | null;
  aviso?: (m: string) => void;
}

export function registrarIpcAlertas(d: DependenciasIpcAlertas): void {
  const V = VALIDADORES_ALERTAS;
  const R = (canal: CanalAlertas, fn: (p: Record<string, unknown>, l: LigacaoAlertas) => unknown): void => {
    d.registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        const l = d.ligacao();
        if (l === null) throw new ErroAlertasIpc("unavailable", "alertas indisponíveis");
        return await fn(p as unknown as Record<string, unknown>, l);
      } catch (e) {
        throw paraErroIpcAlertas(e, d.aviso);
      }
    }) as never);
  };
  R("alertas:catalogo", (_p, l) => l.catalogo());
  R("alertas:listar", (p, l) => l.listar({ ...p, depois_id: (p["depois_id"] as string | null | undefined) ?? null } as never));
  R("alertas:contar", (_p, l) => l.contar());
  R("alertas:marcar_lido", (p, l) => (Array.isArray(p["ids"]) ? l.marcarLido(p["ids"] as string[]) : l.marcarTodosLidos(p["filtro"] as never)));
  R("alertas:silenciar", (p, l) => l.silenciar(p["alvo"] as never, p["ate"] as string | null));
  R("alertas:regras_listar", (_p, l) => l.regrasListar());
  R("alertas:regra_gravar", (p, l) => l.regraGravar(p as never));
  R("alertas:regra_apagar", (p, l) => l.regraApagar(p["id"] as string));
  R("alertas:regra_preset", (p, l) => l.regraPreset(p["preset"] as never, p["canal_id"] as string));
  R("alertas:silencio_ler", (_p, l) => l.silencioLer());
  R("alertas:silencio_gravar", (p, l) => l.silencioGravar(p as never));
  R("alertas:modelos_listar", (_p, l) => l.modelosListar());
  R("alertas:modelo_gravar", (p, l) => l.modeloGravar(p as never));
  R("alertas:modelo_restaurar", (p, l) => l.modeloRestaurar(p as never));
  R("alertas:modelo_prever", (p, l) => l.modeloPrever(p as never));
  R("alertas:config_ler", (_p, l) => l.configLer());
  R("alertas:config_gravar", (p, l) => l.configGravar(p["patch"] as never));
  R("alertas:abrir_entidade", (p, l) => l.abrirEntidade(p["alerta_id"] as string));
  R("canais:listar", (_p, l) => l.canaisListar());
  R("canais:consentir", (p, l) => l.canalConsentir(p["canal_id"] as string, p["versao_texto"] as string, p["hash_texto"] as string));
  R("canais:ligar_saida", (p, l) => l.canalLigarSaida(p["canal_id"] as string));
  R("canais:desligar_saida", (p, l) => l.canalDesligarSaida(p["canal_id"] as string));
  R("canais:teste_envio", (p, l) => l.canalTesteEnvio(p["canal_id"] as string));
}

