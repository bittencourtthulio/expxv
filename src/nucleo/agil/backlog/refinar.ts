// T-18.12: refinamento. Fila "precisa de refino" pela Definição de Pronto-para-começar (DoR); quebra sugerida (> 13 pontos); duplicados prováveis por PortaRag
// (sem RAG: vazio). A DoR vem da config.
import type { ConfigAgil, ItemAgil } from "../../../compartilhado/agil";
import type { PortaRag } from "../portas";
import { jaccard } from "../util";

export interface ContextoDoR {
  item: ItemAgil;
  pontos: number | null;
  risco: string | null;
  /** dependências satisfeitas: true/false; null = não se aplica/desconhecido. */
  dependencias_ok: boolean | null;
  lacuna_aberta: boolean | null;
}
export interface ResultadoDoR { codigo: string; ok: boolean | null; motivo: string }

export function avaliarDoR(c: ContextoDoR, config: Pick<ConfigAgil, "dor">): ResultadoDoR[] {
  return config.dor.map((x): ResultadoDoR => {
    const r = (ok: boolean | null, motivo: string): ResultadoDoR => ({ codigo: x.codigo, ok, motivo });
    switch (x.codigo) {
      case "criterio_aceite": return c.item.criterios.some((k) => k.trim()) ? r(true, "critério de aceite presente") : r(false, "sem critério de aceite");
      case "estimado": return c.pontos !== null ? r(true, `${c.pontos} pontos`) : r(false, "sem estimativa");
      case "risco_classificado": return c.risco !== null ? r(true, `risco ${c.risco}`) : r(false, "risco não classificado");
      case "dependencias_ok": return c.dependencias_ok === null ? r(null, "sem dependências conhecidas") : c.dependencias_ok ? r(true, "dependências satisfeitas") : r(false, "dependência pendente");
      case "tamanho_ok": return c.pontos === null ? r(null, "sem estimativa") : c.pontos <= 13 ? r(true, "até 13 pontos") : r(false, `${c.pontos} pontos: quebrar`);
      case "sem_lacuna": return c.lacuna_aberta === null ? r(null, "lacunas desconhecidas") : c.lacuna_aberta ? r(false, "lacuna aberta") : r(true, "sem lacuna aberta");
      default: return r(null, "critério sem avaliador");
    }
  });
}

export const precisaDeRefino = (rs: readonly ResultadoDoR[]): boolean => rs.some((r) => r.ok === false);

export function filaDeRefino<T extends ContextoDoR>(itens: readonly T[], config: Pick<ConfigAgil, "dor">): { ctx: T; falhas: ResultadoDoR[] }[] {
  return itens
    .filter((c) => c.item.origem !== "metodo" && c.item.estado_ade !== "descartado")
    .map((ctx) => ({ ctx, falhas: avaliarDoR(ctx, config).filter((r) => r.ok === false) }))
    .filter((x) => x.falhas.length > 0)
    .sort((a, b) => a.ctx.item.ordem - b.ctx.item.ordem);
}

/** quebra sugerida para > 13 pontos: partes próximas da metade, em valores de Fibonacci. */
export function sugerirQuebra(pontos: number | null, teto = 13): number[] | null {
  if (pontos === null || pontos <= teto) return null;
  const fib = [1, 2, 3, 5, 8, 13];
  const partes: number[] = [];
  let resto = pontos;
  while (resto > 0 && partes.length < 6) {
    const p = [...fib].reverse().find((f) => f <= resto) ?? 1;
    partes.push(p);
    resto -= p;
  }
  return partes;
}

export async function duplicadosProvaveis(rag: PortaRag, ws: string, item: Pick<ItemAgil, "id" | "titulo">, limiar = 0.6): Promise<{ ref: string; titulo: string; similaridade: number }[]> {
  try {
    const achados = await rag.buscar(ws, item.titulo, { tipos: ["task"], limite: 5 });
    return achados.filter((a) => a.ref !== item.id && Math.max(a.similaridade, jaccard(item.titulo, a.titulo)) >= limiar).map((a) => ({ ref: a.ref, titulo: a.titulo, similaridade: a.similaridade }));
  } catch { return []; }
}
