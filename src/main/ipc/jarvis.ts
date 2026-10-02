// Canais `jarvis:*` e `remoto:*` (Fase 13): validadores ESTRITOS (campo extra/ausente é erro) e registro. O renderer NUNCA define ator, origem, permissão nem destino: o main carimba.
// Texto de comando e confirmações de permissão são canais `sensivel` (o log do registro não imprime o payload). Erro do serviço volta como texto genérico (nunca stack/caminho).
import { ACOES_JARVIS, PERMISSOES_REMOTAS, type AcaoTipada } from "../../compartilhado/jarvis";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, vVazio, type Resultado, type Validador } from "./validar";
import { vObjetoOpc } from "./validar-harness";
import type { LigacaoJarvis } from "../jarvis";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });
const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const vNulavel = <T>(v: Validador<T>): Validador<T | null> => (x) => (x === null ? ok(null) : v(x));

const vId = vTexto({ min: 1, max: 64, padrao: /^[A-Za-z0-9._:#|-]+$/ });
const vTextoComando = vTexto({ min: 1, max: 4000 });
const vInstante = vTexto({ min: 20, max: 40, padrao: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/ });

export const vAcaoTipada: Validador<AcaoTipada> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const a = (v as { acao?: unknown }).acao;
  if (typeof a !== "string" || !(ACOES_JARVIS as readonly string[]).includes(a)) return falha("acao_fora_da_lista");
  switch (a) {
    case "status":
    case "listar_missoes":
    case "listar_paineis":
    case "consultar_consumo":
      return vObjeto({ acao: vEnum([a] as const) })(v) as Resultado<AcaoTipada>;
    case "abrir_pane":
      return vObjeto({ acao: vEnum(["abrir_pane"] as const), pane: vTexto({ min: 1, max: 41, padrao: /^#?[A-Za-z0-9._:|-]+$/ }) })(v) as Resultado<AcaoTipada>;
    case "enviar_prompt":
      return vObjeto({ acao: vEnum(["enviar_prompt"] as const), destino: vEnum(["maestro", "squad"] as const), squad: vNulavel(vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9._-]*$/ })), texto: vTexto({ min: 1, max: 4000 }) })(v) as Resultado<AcaoTipada>;
    case "aprovar_gate":
      return vObjeto({ acao: vEnum(["aprovar_gate"] as const), gate_id: vId, decisao: vEnum(["aprovar", "recusar"] as const) })(v) as Resultado<AcaoTipada>;
    default:
      return vObjeto({ acao: vEnum([a as "pausar"]), alvo: vTexto({ min: 1, max: 120 }) })(v) as Resultado<AcaoTipada>;
  }
};

const vInterface = vTexto({ min: 3, max: 45, padrao: /^(auto|[0-9a-fA-F:.]{3,45})$/ });
const vHost = vTexto({ min: 1, max: 130, padrao: /^[A-Za-z0-9.-]{1,120}(?::\d{1,5})?$/ });
const vPermissao = vEnum(PERMISSOES_REMOTAS);
const vPaginaDepois = vObjeto({ depois: vNulavel(vInstante) });

export const VALIDADORES_JARVIS = {
  "jarvis:estado": vVazio,
  "jarvis:config_gravar": vObjeto({ patch: vObjetoOpc({}, { ligado: vBooleano, llm_ligado: vBooleano, llm_consentimento: vBooleano, confirmacao_ttl_s: vInteiro({ min: 10, max: 120 }) }) }),
  "jarvis:enviar": vObjeto({ texto: vTextoComando }),
  "jarvis:acao": vObjeto({ acao: vAcaoTipada }),
  "jarvis:confirmar": vObjeto({ confirmacao_id: vTexto({ min: 6, max: 64, padrao: /^cnf_[A-Za-z0-9_-]+$/ }), aprovado: vBooleano }),
  "jarvis:historico": vPaginaDepois,
  "jarvis:limpar": vVazio,
  "remoto:estado": vVazio,
  "remoto:ligar": vObjeto({ transporte: vEnum(["lan", "loopback"] as const), interface: vInterface, consentimento_versao: vTexto({ min: 1, max: 30, padrao: /^[A-Za-z0-9._-]+$/ }) }),
  "remoto:desligar": vVazio,
  "remoto:config_gravar": vObjeto({ patch: vObjetoOpc({}, { interface: vInterface, porta: vInteiro({ min: 0, max: 65535 }), ocioso_min: vInteiro({ min: 1, max: 1440 }), validade_dispositivo_dias: vInteiro({ min: 1, max: 365 }), hosts_extras: vLista(vHost, 5), permitir_cgnat: vBooleano }) }),
  "remoto:parear_iniciar": vObjeto({ permissao: vPermissao }),
  "remoto:parear_cancelar": vVazio,
  "remoto:parear_confirmar_sas": vObjeto({ igual: vBooleano, confirmacao_permissao: vNulavel(vTexto({ min: 1, max: 20 })) }),
  "remoto:revogar": vObjeto({ dispositivo_id: vTexto({ min: 6, max: 64, padrao: /^dev_[A-Za-z0-9_-]+$/ }) }),
  "remoto:permissao_definir": vObjeto({ dispositivo_id: vTexto({ min: 6, max: 64, padrao: /^dev_[A-Za-z0-9_-]+$/ }), permissao: vPermissao, confirmacao: vNulavel(vTexto({ min: 1, max: 20 })) }),
  "remoto:aprovar_pedido": vObjeto({ pedido_id: vTexto({ min: 6, max: 64, padrao: /^cnf_[A-Za-z0-9_-]+$/ }), aprovado: vBooleano }),
  "remoto:panico": vVazio,
  "remoto:auditoria": vPaginaDepois,
} as const;

export type CanalJarvis = keyof typeof VALIDADORES_JARVIS;

export interface DependenciasIpcJarvis {
  registro: RegistroIpc;
  ligacao: () => LigacaoJarvis | null;
  aviso?: (m: string) => void;
}

export function registrarIpcJarvis(d: DependenciasIpcJarvis): void {
  const V = VALIDADORES_JARVIS;
  const R = (canal: CanalJarvis, fn: (p: Record<string, unknown>, l: LigacaoJarvis) => unknown): void => {
    d.registro.invoke(canal as never, V[canal] as never, (async (p: never) => {
      try {
        const l = d.ligacao();
        if (l === null) throw new Error("indisponível");
        return await fn((p ?? {}) as Record<string, unknown>, l);
      } catch (e) {
        d.aviso?.(`jarvis: ${e instanceof Error ? e.name : "erro"}`);
        throw new Error("falha ao executar a operação do Jarvis");
      }
    }) as never);
  };
  R("jarvis:estado", (_p, l) => l.jarvis.estado());
  R("jarvis:config_gravar", (p, l) => l.jarvis.configGravar(p["patch"] as never));
  R("jarvis:enviar", (p, l) => l.jarvis.enviar(p["texto"] as string));
  R("jarvis:acao", (p, l) => l.jarvis.acao(p["acao"] as AcaoTipada));
  R("jarvis:confirmar", (p, l) => l.jarvis.confirmar(p["confirmacao_id"] as string, p["aprovado"] as boolean));
  R("jarvis:historico", (p, l) => l.jarvis.historico(p["depois"] as string | null));
  R("jarvis:limpar", (_p, l) => l.jarvis.limparConversa());
  R("remoto:estado", (_p, l) => l.remoto.estado());
  R("remoto:ligar", (p, l) => l.remoto.ligar(p as never));
  R("remoto:desligar", (_p, l) => l.remoto.desligar());
  R("remoto:config_gravar", (p, l) => l.remoto.configGravar(p["patch"] as never));
  R("remoto:parear_iniciar", (p, l) => l.remoto.parearIniciar(p["permissao"] as never));
  R("remoto:parear_cancelar", (_p, l) => l.remoto.parearCancelar());
  R("remoto:parear_confirmar_sas", (p, l) => l.remoto.parearConfirmarSas(p as never));
  R("remoto:revogar", (p, l) => l.remoto.revogar(p["dispositivo_id"] as string));
  R("remoto:permissao_definir", (p, l) => l.remoto.permissaoDefinir(p as never));
  R("remoto:aprovar_pedido", (p, l) => l.remoto.aprovarPedido(p["pedido_id"] as string, p["aprovado"] as boolean));
  R("remoto:panico", (_p, l) => l.remoto.panico());
  R("remoto:auditoria", (p, l) => l.remoto.auditoria(p["depois"] as string | null));
}
