/** Custo/tokens: valor desconhecido NUNCA vira "0". */
export function Custo({ valor, unidade = "US$" }: { valor: number | null | undefined; unidade?: string }) {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return <span className="custo custo-desconhecido">custo desconhecido</span>;
  return <span className="custo">{unidade} {valor.toFixed(2)}</span>;
}
