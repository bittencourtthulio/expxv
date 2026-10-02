// Retenção (T-20.03): alertas 90 d (configurável), entregas 30 d. Job ocioso de 1x/dia; cada repositório apaga em lote pequeno (o SQL real limita a
// <= 50 ms por lote). As tabelas do Telegram têm a sua em `telegram/retencao.ts`.
import type { ConfigAlertas } from "../../compartilhado/alertas";
import type { RepoAlertas, RepoEntregas } from "./portas";

export const RETENCAO_ENTREGAS_DIAS = 30;
const DIA = 86_400_000;

export function executarRetencao(repos: { alertas: RepoAlertas; entregas: RepoEntregas }, agora: number, cfg: Pick<ConfigAlertas, "retencao_dias">): { alertas: number; entregas: number } {
  const iso = (dias: number): string => new Date(agora - dias * DIA).toISOString();
  return { entregas: repos.entregas.apagarAntesDe(iso(RETENCAO_ENTREGAS_DIAS)), alertas: repos.alertas.apagarAntesDe(iso(cfg.retencao_dias)) };
}
