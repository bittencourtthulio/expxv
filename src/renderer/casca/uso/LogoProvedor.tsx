import { memo } from "react";
import { infoProvedor } from "../provedores-visual";
import { GLIFOS } from "./glifos";

/** Logo do provedor (decorativa: o nome sempre vem em texto ao lado). Monocromática em `currentColor`; desconhecido = iniciais. */
export const LogoProvedor = memo(function LogoProvedor({ provedor, tamanho = 16 }: { provedor: string; tamanho?: number }) {
  const info = infoProvedor(provedor);
  if (info.logo === null) {
    return <span className="logo-provedor logo-provedor-iniciais" data-provedor={info.id} style={{ width: tamanho, height: tamanho, fontSize: Math.max(8, Math.round(tamanho * 0.5)) }} aria-hidden="true">{info.iniciais}</span>;
  }
  const g = GLIFOS[info.logo];
  return (
    <svg className="logo-provedor" data-provedor={info.id} width={tamanho} height={tamanho} viewBox={g.viewBox} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={g.d} {...(g.fillRule !== undefined ? { fillRule: g.fillRule } : {})} />
    </svg>
  );
});
