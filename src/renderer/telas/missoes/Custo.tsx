import type { CustoResumo } from "../../../compartilhado/custo";
import { explicarCusto, formatarCusto, LEGENDA_CUSTO } from "../../estado/custo-formato";

/**
 * Custo/tokens: valor desconhecido NUNCA vira "0". Com `resumo` (Fase 10) mostra "≥ US$ x" (incompleto), "≈ US$ x" (aproximado) e
 * "custo desconhecido"; com `valor` (legado) só o número ou o texto de desconhecido.
 */
export function Custo({ valor, unidade = "US$", resumo }: { valor?: number | null | undefined; unidade?: string; resumo?: Pick<CustoResumo, "usd" | "incompleto" | "aproximado"> & { fontes_ausentes?: string[] } | null }) {
  if (resumo !== undefined) {
    const texto = formatarCusto(resumo);
    const desconhecido = resumo === null || resumo.usd === null;
    return <span className={desconhecido ? "custo custo-desconhecido" : "custo"} title={resumo === null ? undefined : `${explicarCusto(resumo)}`}>{texto}{desconhecido ? null : <small> {LEGENDA_CUSTO}</small>}</span>;
  }
  if (typeof valor !== "number" || !Number.isFinite(valor)) return <span className="custo custo-desconhecido">custo desconhecido</span>;
  return <span className="custo">{unidade} {valor.toFixed(2)}</span>;
}
