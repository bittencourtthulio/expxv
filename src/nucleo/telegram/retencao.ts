// Retenção das tabelas do Telegram (T-20.03): `update_visto` 48 h (dedupe), auditoria 90 d, entradas 30 d (o SQL real apaga `mensagem_entrada` e,
// em cascata, os nonces). Job ocioso 1x/dia.
import type { RepoTelegram } from "./repo";

const H = 3_600_000;
export function executarRetencaoTelegram(repo: RepoTelegram, agora: number): { vistos: number; auditoria: number; entradas: number } {
  return {
    vistos: repo.apagarVistosAntesDe(new Date(agora - 48 * H).toISOString()),
    auditoria: repo.apagarAuditoriaAntesDe(new Date(agora - 90 * 24 * H).toISOString()),
    entradas: repo.apagarEntradasAntesDe(new Date(agora - 30 * 24 * H).toISOString()),
  };
}
