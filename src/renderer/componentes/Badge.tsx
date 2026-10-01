import "./componentes.css";
import type { ReactNode } from "react";

export type TomBadge = "neutro" | "destaque" | "sucesso" | "aviso" | "alerta";

/** Etiqueta pequena de estado. Sempre com texto (nunca só cor). */
export function Badge({ tom = "neutro", children }: { tom?: TomBadge; children: ReactNode }) {
  return <span className="badge" data-tom={tom}>{children}</span>;
}
