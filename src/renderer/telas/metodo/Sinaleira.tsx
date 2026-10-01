import type { Sinaleira as DadosSinaleira } from "../../../nucleo/metodo/tipos";
import { ROTULO_COR } from "./util";

/** Sinaleira: cor + anel + glifo + motivo em texto. A cor nunca é o único sinal. */
export function Sinaleira({ sinaleira, compacta = false }: { sinaleira: DadosSinaleira; compacta?: boolean }) {
  const info = ROTULO_COR[sinaleira.cor];
  return (
    <span className="met-sin" data-cor={sinaleira.cor} role="group" aria-label={`Sinaleira ${info.rotulo.toLowerCase()}: ${sinaleira.motivo}`}>
      <i aria-hidden="true">{info.glifo}</i>
      {compacta ? <b>{info.rotulo}</b> : <span className="met-sin-texto"><b>{info.rotulo}</b> · {sinaleira.motivo}</span>}
    </span>
  );
}
