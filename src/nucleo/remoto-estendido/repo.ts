// Repositório do relay (T-22.03): `relay_canal` (estado por dispositivo; o SEGREDO vive no cofre, nunca aqui) e `relay_evento` (auditoria própria, 30 dias, sem conteúdo, sem IP, sem canal_id).
import { randomBytes } from "node:crypto";
import type { TipoEventoRelay, TransporteDispositivo } from "../../compartilhado/relay";
import type { Banco } from "../banco/banco";

export const RETENCAO_EVENTOS_MS = 30 * 86_400_000;
export interface LinhaCanal {
  dispositivo_id: string;
  transporte: "relay" | "ambos";
  epoca_ultima: number;
  registrado_em: string;
  revogado_em: string | null;
  ultimo_visto_em: string | null;
}
export interface EventoRelayLinha {
  id: string;
  tipo: TipoEventoRelay;
  dispositivo_id: string | null;
  motivo: string | null;
  criado_em: string;
}
export interface RepoRelay {
  obter(dispositivoId: string): LinhaCanal | null;
  listar(): LinhaCanal[];
  registrar(dispositivoId: string, epoca: number, transporte?: "relay" | "ambos"): void;
  atualizarEpoca(dispositivoId: string, epoca: number): void;
  marcarRevogado(dispositivoId: string): void;
  tocarVisto(dispositivoId: string): void;
  transporteDe(dispositivoId: string): TransporteDispositivo;
  evento(tipo: TipoEventoRelay, dispositivoId?: string | null, motivo?: string | null): void;
  eventos(limite?: number): EventoRelayLinha[];
  /** apaga eventos mais velhos que a retenção; devolve quantos. */
  purgar(): number;
}

export function criarRepoRelay(d: { banco: Pick<Banco, "executar" | "consultar" | "consultarUm">; relogio: { agora(): number }; bytes?: (n: number) => Buffer }): RepoRelay {
  const iso = (): string => new Date(d.relogio.agora()).toISOString();
  const ids = d.bytes ?? randomBytes;
  return {
    obter: (id) => d.banco.consultarUm<LinhaCanal>("SELECT * FROM relay_canal WHERE dispositivo_id = ?", [id]) ?? null,
    listar: () => d.banco.consultar<LinhaCanal>("SELECT * FROM relay_canal ORDER BY registrado_em"),
    registrar(id, epoca, transporte = "relay") {
      d.banco.executar("INSERT INTO relay_canal (dispositivo_id, transporte, epoca_ultima, registrado_em, revogado_em, ultimo_visto_em) VALUES (?,?,?,?,NULL,NULL) ON CONFLICT(dispositivo_id) DO UPDATE SET transporte = excluded.transporte, epoca_ultima = excluded.epoca_ultima, revogado_em = NULL", [id, transporte, epoca, iso()]);
    },
    atualizarEpoca: (id, epoca) => void d.banco.executar("UPDATE relay_canal SET epoca_ultima = ? WHERE dispositivo_id = ?", [epoca, id]),
    marcarRevogado: (id) => void d.banco.executar("UPDATE relay_canal SET revogado_em = ? WHERE dispositivo_id = ? AND revogado_em IS NULL", [iso(), id]),
    tocarVisto: (id) => void d.banco.executar("UPDATE relay_canal SET ultimo_visto_em = ? WHERE dispositivo_id = ?", [iso(), id]),
    transporteDe(id) {
      const l = d.banco.consultarUm<{ transporte: "relay" | "ambos" }>("SELECT transporte FROM relay_canal WHERE dispositivo_id = ?", [id]);
      return l === undefined ? "lan" : l.transporte;
    },
    evento(tipo, dispositivoId = null, motivo = null) {
      d.banco.executar("INSERT INTO relay_evento (id, tipo, dispositivo_id, motivo, criado_em) VALUES (?,?,?,?,?)", [`rev_${ids(9).toString("base64url")}`, tipo, dispositivoId, motivo === null ? null : motivo.slice(0, 80), iso()]);
    },
    eventos: (limite = 100) => d.banco.consultar<EventoRelayLinha>("SELECT * FROM relay_evento ORDER BY criado_em DESC, id DESC LIMIT ?", [Math.min(Math.max(1, limite), 500)]),
    purgar() {
      const corte = new Date(d.relogio.agora() - RETENCAO_EVENTOS_MS).toISOString();
      return d.banco.executar("DELETE FROM relay_evento WHERE criado_em < ?", [corte]).alteracoes;
    },
  };
}
