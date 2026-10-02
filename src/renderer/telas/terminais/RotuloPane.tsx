// Rótulo do Pane (T-14.25): `#id · CLI · agente · missão`; `modelo · esforço (indicativo)` no hover e no foco (title + rótulo de
// acessibilidade). Pane sem agente mantém o rótulo do MVP. Sem tooltip posicionado: o cabeçalho do painel corta overflow.
import type { ReactElement } from "react";
import { textoDoPerfil, type PerfilNominal } from "./perfis-agentes";

export interface PropsRotuloPane {
  rotulo: string;
  perfil?: PerfilNominal | undefined;
  className?: string;
}

export function RotuloPane({ rotulo, perfil, className = "terminais-painel-rotulo" }: PropsRotuloPane): ReactElement {
  const detalhe = textoDoPerfil(perfil);
  if (detalhe === null) return <span className={className} title={rotulo}>{rotulo}</span>;
  return (
    <span className={className} tabIndex={0} title={`${rotulo}\n${detalhe}`} aria-label={`${rotulo}. ${detalhe}`} data-agente="">
      {rotulo}
    </span>
  );
}
