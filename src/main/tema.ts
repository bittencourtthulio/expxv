import type { TemaEfetivo, TemaPreferencia } from "../compartilhado/ipc";

/** Resolve o tema efetivo. `sistema` segue o modo do SO. */
export function resolverTema(preferencia: TemaPreferencia, sistemaEscuro: boolean): TemaEfetivo {
  if (preferencia === "sistema") return sistemaEscuro ? "escuro" : "claro";
  return preferencia;
}

export function preferenciaValida(valor: unknown): TemaPreferencia {
  return valor === "claro" || valor === "escuro" || valor === "sistema" ? valor : "sistema";
}
