// Canais `telegram:*` (Fase 20, T-20.02/T-20.33). Validadores estritos; `telegram:token_testar`, `telegram:token_salvar` e `telegram:autorizado_config` (PIN) são CANAIS SENSÍVEIS
// (ver `CANAIS_SENSIVEIS`): o registro nunca imprime o payload nem o motivo da recusa deles. O módulo do Telegram só é carregado (import dinâmico, dentro de `ligacao.telegram()`) quando um
// canal que EXIGE o serviço é chamado; `telegram:estado` e a leitura de auditoria também carregam o serviço porque o assistente precisa do estado vivo (poller/pareamento).
import type { NomeInvoke } from "../../compartilhado/ipc";
import { ErroAlertasIpc, type LigacaoAlertas } from "../alertas";
import { vOuNulo } from "./comum-dominio";
import { paraErroIpcAlertas, vIdWs } from "./alertas";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });

const vToken: Validador<string> = vTexto({ min: 1, max: 100 }); // o FORMATO é conferido no núcleo (nem chega à rede se errado)
const vPedidoId = vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9_-]+$/ });
const vIdAutorizado = vTexto({ min: 1, max: 64, padrao: /^aut_[A-Za-z0-9_-]{6,40}$/ });
const vModo = vEnum(["consulta", "aprovar", "direto"] as const);
const vPlanoId = vTexto({ min: 1, max: 80, padrao: /^[A-Za-z0-9_-]+$/ });
const vHash = vTexto({ min: 64, max: 64, padrao: /^[0-9a-f]{64}$/ });
const vUserId = vInteiro({ min: 1, max: Number.MAX_SAFE_INTEGER });
const vPin: Validador<string | null> = (v) => (v === null ? ok(null) : typeof v === "string" && v.length >= 4 && v.length <= 32 && !/[\u0000-\u001f]/.test(v) ? ok(v) : falha("PIN inválido"));

export const VALIDADORES_TELEGRAM = {
  "telegram:estado": vObjeto({}),
  "telegram:token_testar": vObjeto({ token: vOuNulo(vToken) }),
  "telegram:token_salvar": vObjeto({ token: vToken }),
  "telegram:token_remover": vObjeto({}),
  "telegram:webhook_limpar": vObjeto({}),
  "telegram:comandos_configurar": vObjeto({}),
  "telegram:parear_iniciar": vObjeto({}),
  "telegram:parear_cancelar": vObjeto({}),
  "telegram:parear_decidir": vObjeto({ pedido_id: vPedidoId, permitir: vBooleano }),
  "telegram:autorizado_config": vObjetoOpc(
    { id: vIdAutorizado, patch: vObjetoOpc({}, { modo_padrao: vModo, texto_livre: vBooleano, workspaces: vLista(vObjeto({ workspace_id: vIdWs, modo: vModo, padrao: vBooleano }), 50), pin: vPin }) },
    { confirmacao: vTexto({ max: 20 }) },
  ),
  "telegram:autorizado_revogar": vObjeto({ id: vIdAutorizado }),
  "telegram:nao_autorizado_listar": vObjeto({}),
  "telegram:nao_autorizado_bloquear": vObjeto({ user_id: vUserId }),
  "telegram:entrada_ligar": vObjeto({ ligada: vBooleano }),
  "telegram:retomar": vObjeto({}),
  "telegram:panico": vObjeto({ parar_execucoes: vBooleano }),
  "telegram:plano_decidir_desktop": vObjeto({ plano_id: vPlanoId, decisao: vEnum(["aprovar", "cancelar"] as const), args_hash: vHash }),
  "telegram:auditoria_listar": vObjetoOpc({ depois: vOuNulo(vTexto({ min: 1, max: 40 })) }, { limite: vInteiro({ min: 1, max: 100 }) }),
  "telegram:auditoria_exportar": vObjeto({}),
} as const;

export type CanalTelegram = keyof typeof VALIDADORES_TELEGRAM;

export interface DependenciasIpcTelegram {
  registro: RegistroIpc;
  ligacao: () => LigacaoAlertas | null;
  aviso?: (m: string) => void;
}

export function registrarIpcTelegram(d: DependenciasIpcTelegram): void {
  const V = VALIDADORES_TELEGRAM;
  const R = (canal: CanalTelegram, fn: (p: Record<string, unknown>, l: LigacaoAlertas) => unknown): void => {
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
  R("telegram:estado", (_p, l) => l.telegramEstado());
  R("telegram:token_testar", async (p, l) => (await l.telegram()).tokenTestar(p["token"] as string | null));
  R("telegram:token_salvar", async (p, l) => (await l.telegram()).tokenSalvar(p["token"] as string));
  R("telegram:token_remover", async (_p, l) => (await l.telegram()).tokenRemover());
  R("telegram:webhook_limpar", async (_p, l) => (await l.telegram()).webhookLimpar());
  R("telegram:comandos_configurar", async (_p, l) => (await l.telegram()).comandosConfigurar());
  R("telegram:parear_iniciar", async (_p, l) => (await l.telegram()).parearIniciar());
  R("telegram:parear_cancelar", async (_p, l) => (await l.telegram()).parearCancelar());
  R("telegram:parear_decidir", async (p, l) => (await l.telegram()).parearDecidir(p["pedido_id"] as string, p["permitir"] as boolean));
  R("telegram:autorizado_config", async (p, l) => (await l.telegram()).autorizadoConfig(p as never));
  R("telegram:autorizado_revogar", async (p, l) => (await l.telegram()).autorizadoRevogar(p["id"] as string));
  R("telegram:nao_autorizado_listar", async (_p, l) => (await l.telegram()).naoAutorizadoListar());
  R("telegram:nao_autorizado_bloquear", async (p, l) => (await l.telegram()).naoAutorizadoBloquear(p["user_id"] as number));
  R("telegram:entrada_ligar", async (p, l) => (await l.telegram()).entradaLigar(p["ligada"] as boolean));
  R("telegram:retomar", async (_p, l) => (await l.telegram()).retomar());
  R("telegram:panico", async (p, l) => (await l.telegram()).panico(p["parar_execucoes"] as boolean));
  R("telegram:plano_decidir_desktop", async (p, l) => (await l.telegram()).planoDecidirDesktop(p as never));
  R("telegram:auditoria_listar", async (p, l) => (await l.telegram()).auditoriaListar((p["depois"] as string | null) ?? null, (p["limite"] as number | undefined) ?? 50));
  R("telegram:auditoria_exportar", async (_p, l) => (await l.telegram()).auditoriaExportar());
}
