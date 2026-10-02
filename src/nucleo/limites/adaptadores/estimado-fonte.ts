// Fonte do adaptador `estimado` sobre o banco local (Fase 10, T-10.22). Lê só o que já existe: tetos do dono (`conta_roteamento`), o último `reinicia_em` MEDIDO/manual de
// `limite_amostra` (nunca o do próprio estimado) e o consumo do AGREGADO por conta (`custo_agregado`, escopo `conta`), sem somar o bruto do ciclo inteiro. Só o dia em que o ciclo
// começou usa o bruto (`uso_registro`, índice por `ts`), porque o agregado é diário. Nenhum conteúdo de conversa: só contagens de tokens. Sem rede, sem escrita.
//
// "Tokens observados" = entrada + saída + escrita de cache. A LEITURA de cache fica de fora de propósito: ela domina o volume do Claude Code e quase não pesa na cota da assinatura;
// contá-la inflaria o `used_pct`. O número é uma ESTIMATIVA rotulada (`confianca: "estimado"`), nunca `medido`.
import type { Banco } from "../../banco/banco";
import type { FonteEstimativa } from "./estimado";

const DIA_MS = 86_400_000;
const diaDe = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const inicioDoDiaSeguinte = (ms: number): number => Date.parse(`${diaDe(ms)}T00:00:00.000Z`) + DIA_MS;
const SQL_PARCIAL = "SELECT SUM(tokens_entrada + tokens_saida + tokens_cache_escrita) AS n FROM uso_registro WHERE conta_id = ? AND ts >= ? AND ts < ?";
const SQL_CHEIOS = "SELECT SUM(tokens_entrada + tokens_saida + tokens_cache_escrita) AS n FROM custo_agregado WHERE escopo = 'conta' AND chave = ? AND dia >= ? AND dia <= ?";

export function criarFonteEstimativaDoBanco(d: { banco: Banco; agora: () => number }): FonteEstimativa {
  const { banco } = d;
  const consumoDesde = (contaId: string, desdeMs: number): number | null => {
    const agora = d.agora();
    if (!Number.isFinite(desdeMs) || desdeMs > agora) return null;
    // sem nenhum registro de uso da conta o consumo é DESCONHECIDO (null), não 0%
    const existe = banco.consultarUm<{ x: number }>("SELECT 1 AS x FROM custo_agregado WHERE escopo = 'conta' AND chave = ? LIMIT 1", [contaId]);
    if (existe === undefined) return null;
    const corte = inicioDoDiaSeguinte(desdeMs);
    // 1º dia (parcial): bruto desde o início do ciclo até a meia-noite; dias cheios seguintes: agregado
    const ateTs = new Date(Math.min(corte, agora + 1)).toISOString();
    const parcial = banco.consultarUm<{ n: number | null }>(SQL_PARCIAL, [contaId, new Date(desdeMs).toISOString(), ateTs])?.n ?? 0;
    let cheios = 0;
    if (corte <= agora) cheios = banco.consultarUm<{ n: number | null }>(SQL_CHEIOS, [contaId, diaDe(corte), diaDe(agora)])?.n ?? 0;
    return Number(parcial) + Number(cheios);
  };
  return {
    tetos(contaId) {
      const r = banco.consultarUm<{ a: number | null; b: number | null }>("SELECT teto_tokens_5h AS a, teto_tokens_semana AS b FROM conta_roteamento WHERE conta_id = ?", [contaId]);
      return { cinco_horas: r?.a ?? null, semana: r?.b ?? null };
    },
    consumo(contaId, ms) {
      return consumoDesde(contaId, d.agora() - ms);
    },
    consumoDesde,
    ultimoReset(contaId, kind) {
      const r = banco.consultarUm<{ t: string }>("SELECT reinicia_em AS t FROM limite_amostra WHERE conta_id = ? AND janela = ? AND balde = '' AND reinicia_em IS NOT NULL AND fonte <> 'estimado' ORDER BY ts DESC LIMIT 1", [contaId, kind]);
      const t = r === undefined ? Number.NaN : Date.parse(r.t);
      return Number.isFinite(t) ? t : null;
    },
  };
}
