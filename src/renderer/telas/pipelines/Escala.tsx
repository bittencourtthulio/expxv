// Escala de rigidez (Relâmpago … Total): régua de cinco marcas com o nível em destaque. Compartilhada pelo plano (Intenção) e pela aba Rigidez.
import type { NivelRigidez } from "../../../compartilhado/maestro";
import { NIVEIS, NOMES_NIVEL, valorTexto } from "./logica";

export function EscalaDeRigidez({ nivel, onNivel, rotulo, nomes, efeitos, desabilitado }: {
  nivel: NivelRigidez;
  onNivel: (n: NivelRigidez) => void;
  /** Nome acessível do grupo. */
  rotulo: string;
  nomes?: Partial<Record<NivelRigidez, string>>;
  /** Texto curto sob cada marca (ex.: "5 rodam"). */
  efeitos?: Partial<Record<NivelRigidez, string>>;
  desabilitado?: boolean;
}) {
  return (
    <div className="pl-escala" role="radiogroup" aria-label={rotulo}>
      {NIVEIS.map((n) => {
        const nome = nomes?.[n] ?? NOMES_NIVEL[n];
        return (
          <button key={n} type="button" role="radio" aria-checked={n === nivel} aria-label={`${n} · ${nome}`} title={valorTexto(n, nome)} className="pl-escala-nivel" data-ate={n <= nivel || undefined} data-atual={n === nivel || undefined} disabled={desabilitado} onClick={() => onNivel(n)}>
            <span className="pl-escala-marca" aria-hidden="true" />
            <span className="pl-escala-nome" aria-hidden="true"><span className="pl-escala-num">{n}</span> {nome}</span>
            {efeitos?.[n] !== undefined ? <span className="pl-escala-efeito" aria-hidden="true">{efeitos[n]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
