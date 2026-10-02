// Log do relay (T-22.08, AX-23): SEM payload, SEM canal, SEM IP cru. Cada linha é `{minuto, ev, ip}` com `ev` de uma lista fechada e `ip` = hash curto com SAL DIÁRIO guardado só em
// memória (amanhã o mesmo IP vira outro identificador: sem correlação de longo prazo). Retenção: só a saída padrão do processo; nenhum arquivo.
import { createHash, randomBytes } from "node:crypto";

export const EVENTOS_LOG = ["iniciado", "encerrado", "host_registrado", "cliente_conectado", "recusado", "limite", "conexao", "desconexao", "erro_servidor", "healthz"] as const;
export type EventoLog = (typeof EVENTOS_LOG)[number];

export interface Log {
  registrar(ev: EventoLog, ip?: string): void;
  /** identificador anônimo do IP para HOJE. */
  anonimo(ip: string): string;
}
export function criarLog(o: { agora: () => number; saida: (linha: string) => void; bytes?: (n: number) => Buffer }): Log {
  const bytes = o.bytes ?? randomBytes;
  let dia = -1;
  let sal: Buffer = Buffer.alloc(0);
  const salDeHoje = (): Buffer => {
    const d = Math.floor(o.agora() / 86_400_000);
    if (d !== dia) {
      dia = d;
      sal = bytes(16);
    }
    return sal;
  };
  const anonimo = (ip: string): string => createHash("sha256").update(salDeHoje()).update(ip).digest("hex").slice(0, 8);
  return {
    anonimo,
    registrar(ev, ip) {
      if (!(EVENTOS_LOG as readonly string[]).includes(ev)) return;
      o.saida(JSON.stringify({ minuto: Math.floor(o.agora() / 60_000), ev, ...(ip === undefined ? {} : { ip: anonimo(ip) }) }));
    },
  };
}
