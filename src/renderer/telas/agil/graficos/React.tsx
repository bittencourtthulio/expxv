// Emissor React da árvore `NoSvg` (a mesma que `paraString` serializa): a saída das duas precisa ser idêntica (snapshot em svg.test).
import { createElement, type ReactElement, type ReactNode } from "react";
import type { NoSvg } from "../../../../compartilhado/svg";

const ESPECIAIS: Readonly<Record<string, string>> = { class: "className", tabindex: "tabIndex" };
export function nomeReact(attr: string): string {
  const e = ESPECIAIS[attr];
  if (e !== undefined) return e;
  if (attr.startsWith("aria-") || attr.startsWith("data-") || !attr.includes("-")) return attr;
  return attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function NoReact({ no, chave }: { no: NoSvg | string; chave?: string | number }): ReactElement | string {
  if (typeof no === "string") return no;
  const props: Record<string, unknown> = chave === undefined ? {} : { key: chave };
  if (no.a) for (const [k, v] of Object.entries(no.a)) if (v !== undefined) props[nomeReact(k)] = v;
  const filhos: ReactNode[] = (no.c ?? []).map((c, i) => (typeof c === "string" ? c : createElement(NoReact, { key: i, no: c })));
  return createElement(no.t, props, ...filhos);
}
