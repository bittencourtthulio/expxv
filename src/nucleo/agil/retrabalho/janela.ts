// T-18.21 (D-183): janela de observação do retrabalho. De `concluida_em` até o maior entre (fechamento da sprint ágil, veredito do QA do trabalho),
// com TETO `janela_retrabalho_dias`. Referências anteriores a `concluida_em` não encerram a janela (não observam nada): vale o teto. Sem referência: o teto.
import { ms, isoDe } from "../util";

const DIA = 86_400_000;
export interface JanelaRetrabalho { inicio: string; fim: string; teto: string }

export function janelaRetrabalho(concluidaEm: string, ref: { sprint_fechada_em: string | null; qa_emitido_em: string | null }, janelaDias: number): JanelaRetrabalho | null {
  const c = ms(concluidaEm);
  if (c === null) return null;
  const teto = c + janelaDias * DIA;
  const candidatos = [ms(ref.sprint_fechada_em), ms(ref.qa_emitido_em)].filter((x): x is number => x !== null && x > c);
  const fim = candidatos.length > 0 ? Math.min(teto, Math.max(...candidatos)) : teto;
  return { inicio: isoDe(c), fim: isoDe(fim), teto: isoDe(teto) };
}
