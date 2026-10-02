// Formatação PURA do painel de progresso (sem catálogo, sem React): contagem "3/9", duração curta e o texto do resumo final.
import type { ItemProgresso, Progresso } from "../../compartilhado/progresso";

/** O que foi feito sobre o que se aplica (etapas puladas ficam fora dos dois lados). */
export function contagem(p: Pick<Progresso, "itens">): { feitos: number; total: number } {
  const aplicaveis = p.itens.filter((i) => i.estado !== "pulado");
  return { feitos: aplicaveis.filter((i) => i.estado === "concluido").length, total: aplicaveis.length };
}

/** "42 s", "4 min", "1 h 05 min". */
export function formatarDuracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** A etapa em destaque agora: a que roda; senão a que espera você; senão a que falhou; senão a primeira pendente. */
export function itemAtual(p: Pick<Progresso, "itens">): ItemProgresso | null {
  return p.itens.find((i) => i.estado === "em_andamento") ?? p.itens.find((i) => i.estado === "aguardando") ?? p.itens.find((i) => i.estado === "falhou") ?? p.itens.find((i) => i.estado === "pendente") ?? null;
}

/** Linha do resumo final: "Concluído: 9/9 em 4 min" ou "Parou na etapa X: falhou". Honesto: sem duração medida, sem "em …". */
export function resumoDoProgresso(p: Pick<Progresso, "itens" | "resultado" | "iniciado_em" | "fim_em">): string {
  const { feitos, total } = contagem(p);
  const dur = p.fim_em !== null && p.iniciado_em > 0 && p.fim_em >= p.iniciado_em ? ` em ${formatarDuracao(p.fim_em - p.iniciado_em)}` : "";
  switch (p.resultado) {
    case "concluido":
      return `Concluído: ${feitos}/${total}${dur}`;
    case "falhou": {
      const f = p.itens.find((i) => i.estado === "falhou");
      return f === undefined ? `Parou: falhou (${feitos}/${total})` : `Parou na etapa ${f.rotulo}: falhou`;
    }
    case "cancelado":
      return `Encerrado: ${feitos}/${total}`;
    case "aguardando": {
      const a = p.itens.find((i) => i.estado === "aguardando");
      return a === undefined ? `Aguardando você (${feitos}/${total})` : `Aguardando você: ${a.rotulo}`;
    }
    default:
      return `Em andamento: ${feitos}/${total}`;
  }
}
