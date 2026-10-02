// Canais `relay:*` (Fase 22): validadores ESTRITOS (campo extra/ausente é erro; `experimental` e `habilitado` nunca vêm do renderer como autoridade) e registro. `permissao_inicial` só aceita
// `leitura` (AX-28). `relay:parear_iniciar` e `relay:parear_sas` são canais `sensivel` (código, QR e SAS nunca vão a log). O main carimba tudo; a decisão humana é sempre no desktop (D-21).
import { validarConfigRelayParcial, type ConfigRelay } from "../../compartilhado/relay";
import type { LigacaoRelay } from "../relay";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vObjeto, vTexto, vVazio, type Resultado, type Validador } from "./validar";

const vConfigParcial: Validador<Partial<ConfigRelay>> = (x): Resultado<Partial<ConfigRelay>> => {
  const r = validarConfigRelayParcial(x);
  return r.ok ? { ok: true, valor: r.valor } : { ok: false, erro: r.erro };
};

export const VALIDADORES_RELAY = {
  "relay:estado": vVazio,
  "relay:config_obter": vVazio,
  "relay:config_definir": vConfigParcial,
  "relay:ligar": vVazio,
  "relay:desligar": vVazio,
  "relay:parear_iniciar": vObjeto({ permissao_inicial: vEnum(["leitura"] as const) }),
  "relay:parear_sas": vVazio,
  "relay:parear_decidir": vObjeto({ permitir: vBooleano }),
  "relay:dispositivos": vVazio,
  "relay:revogar": vObjeto({ dispositivo_id: vTexto({ min: 6, max: 64, padrao: /^dev_[A-Za-z0-9_-]+$/ }) }),
  "relay:panico": vVazio,
} as const;
export type CanalRelay = keyof typeof VALIDADORES_RELAY;

export interface DependenciasIpcRelay {
  registro: RegistroIpc;
  ligacao: () => LigacaoRelay | null;
  aviso?: (m: string) => void;
}

export function registrarIpcRelay(d: DependenciasIpcRelay): void {
  const V = VALIDADORES_RELAY;
  const R = (canal: CanalRelay, fn: (p: unknown, l: LigacaoRelay) => unknown): void => {
    d.registro.invoke(canal as never, V[canal] as never, (async (p: never) => {
      try {
        const l = d.ligacao();
        if (l === null) throw new Error("indisponível");
        return await fn(p, l);
      } catch (e) {
        d.aviso?.(`relay: ${e instanceof Error ? e.name : "erro"}`); // nunca a mensagem: pode citar URL ou código
        throw new Error("falha ao executar a operação do relay");
      }
    }) as never);
  };
  R("relay:estado", (_p, l) => l.api.estado());
  R("relay:config_obter", (_p, l) => l.api.configObter());
  R("relay:config_definir", (p, l) => l.api.configDefinir(p as Partial<ConfigRelay>));
  R("relay:ligar", (_p, l) => l.api.ligar());
  R("relay:desligar", (_p, l) => l.api.desligar());
  R("relay:parear_iniciar", (_p, l) => l.api.parearIniciar());
  R("relay:parear_sas", (_p, l) => l.api.parearSas());
  R("relay:parear_decidir", (p, l) => l.api.parearDecidir((p as { permitir: boolean }).permitir));
  R("relay:dispositivos", (_p, l) => l.api.dispositivos());
  R("relay:revogar", (p, l) => l.api.revogar((p as { dispositivo_id: string }).dispositivo_id));
  R("relay:panico", (_p, l) => l.api.panico());
}
