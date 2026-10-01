// Registro curto de eventos de domínio no banco (auditoria com retenção de 30 dias; 05-CONTRATOS §1).
import type { Banco } from "../banco";
import { novoId } from "../banco/repos/comum";
import { agora } from "../banco/tempo";

export function registrarEventoDominio(banco: Banco, tipo: string, payload: Record<string, unknown>): void {
  banco.executar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES (?,?,?,?)", [novoId("evento", "evt"), tipo, JSON.stringify(payload), agora()]);
}
