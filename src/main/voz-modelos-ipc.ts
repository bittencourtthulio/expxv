// Canais `voz:modelo*` (Fase 11, D-540 a D-549): validadores ESTRITOS e manipuladores da voz local embutida. O renderer envia só `modelo_id` (id do catálogo, formato fechado) e, no download,
// a versão do texto de consentimento que a pessoa viu; NUNCA URL, host, caminho, checksum nem tamanho. Quem decide o que baixar é o catálogo versionado, no main.
import type { NomeInvoke } from "../compartilhado/ipc";
import type { PedidoBaixarModelo } from "../compartilhado/voz-local";
import type { RegistroIpc } from "./ipc/registro";
import { vBooleano, vObjeto, vTexto, vVazio, type Validador } from "./ipc/validar";
import { ErroVozModelosIpc, type ServicoVozModelos } from "./voz-modelos";

export const vIdModelo = vTexto({ min: 1, max: 64, padrao: /^[a-z0-9][a-z0-9.-]{0,63}$/ });
const vAceite = vTexto({ min: 1, max: 40, padrao: /^[0-9A-Za-z.-]+$/ });

export const VALIDADORES_VOZ_MODELOS = {
  "voz:modelos_listar": vVazio,
  "voz:modelo_baixar": vObjeto({ modelo_id: vIdModelo, aceite_versao: vAceite, ativar: vBooleano }) as Validador<PedidoBaixarModelo>,
  "voz:modelo_pausar": vObjeto({ modelo_id: vIdModelo }),
  "voz:modelo_retomar": vObjeto({ modelo_id: vIdModelo }),
  "voz:modelo_cancelar": vObjeto({ modelo_id: vIdModelo }),
  "voz:modelo_apagar": vObjeto({ modelo_id: vIdModelo }),
  "voz:modelo_ativar": vObjeto({ modelo_id: vIdModelo }),
  "voz:modelo_autoteste": vObjeto({ modelo_id: vIdModelo }),
};

export type CanalVozModelos = keyof typeof VALIDADORES_VOZ_MODELOS;

export interface DependenciasIpcVozModelos {
  registro: RegistroIpc;
  servico: () => ServicoVozModelos | Promise<ServicoVozModelos>;
  aviso?: (mensagem: string) => void;
}

export function registrarIpcVozModelos(d: DependenciasIpcVozModelos): void {
  const V = VALIDADORES_VOZ_MODELOS;
  type P = Record<string, unknown>;
  const R = (canal: CanalVozModelos, fn: (p: P, s: ServicoVozModelos) => unknown): void => {
    d.registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        return await fn((p ?? {}) as P, await d.servico());
      } catch (e) {
        if (e instanceof ErroVozModelosIpc) throw e;
        d.aviso?.(`voz-modelos: ${e instanceof Error ? e.constructor.name : "erro"}`); // nunca a mensagem: pode citar caminho
        throw new Error("[indisponivel] Falha interna na voz local.");
      }
    }) as never);
  };
  R("voz:modelos_listar", (_p, s) => s.listar());
  R("voz:modelo_baixar", (p, s) => s.baixar(p as unknown as PedidoBaixarModelo));
  R("voz:modelo_pausar", (p, s) => s.pausar(p["modelo_id"] as string));
  R("voz:modelo_retomar", (p, s) => s.retomar(p["modelo_id"] as string));
  R("voz:modelo_cancelar", (p, s) => s.cancelar(p["modelo_id"] as string));
  R("voz:modelo_apagar", (p, s) => s.apagar(p["modelo_id"] as string));
  R("voz:modelo_ativar", (p, s) => s.ativar(p["modelo_id"] as string));
  R("voz:modelo_autoteste", (p, s) => s.autoteste(p["modelo_id"] as string));
}
