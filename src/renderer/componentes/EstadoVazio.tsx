import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone";

/** Estado vazio sempre diz o que aconteceu e qual o próximo passo. */
export function EstadoVazio({ icone, titulo, texto, children }: { icone: NomeIcone; titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div className="estado-vazio" role="status">
      <Icone nome={icone} className="estado-vazio-icone" />
      <h2>{titulo}</h2>
      <p>{texto}</p>
      {children}
    </div>
  );
}
