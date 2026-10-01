import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { aoPedirTela } from "../estado/navegacao";
import { useTema } from "../estado/tema";
import { Menu } from "./Menu";
import { Rodape } from "./Rodape";
import { Topo } from "./Topo";
import { atualizarMontadas, TELAS, type TelaId } from "./telas";
import "./casca.css";

/** Casca + navegação por estado (sem roteador). Telas visitadas ficam montadas e ocultas (política em telas.ts). */
export function Navegacao({ inicial = "inicio" }: { inicial?: TelaId }) {
  const [ativa, setAtiva] = useState<TelaId>(inicial);
  const [montadas, setMontadas] = useState<TelaId[]>([inicial]);
  const [fixado, setFixado] = useState(false);
  const { efetivo, alternar } = useTema();
  const principal = useRef<HTMLElement>(null);

  const selecionar = useCallback((id: TelaId) => {
    setAtiva(id);
    setMontadas((m) => atualizarMontadas(m, id));
  }, []);
  useEffect(() => aoPedirTela(selecionar), [selecionar]);
  const fixar = useCallback(() => setFixado((f) => !f), []);
  const alternarTema = useCallback(() => void alternar(), [alternar]);

  return (
    <div className="casca" data-menu-fixado={fixado || undefined}>
      <a href="#conteudo" className="pular-link" onClick={(e) => { e.preventDefault(); principal.current?.focus(); }}>Pular para o conteúdo</a>
      <Menu ativa={ativa} fixado={fixado} aoSelecionar={selecionar} aoFixar={fixar} />
      <Topo tema={efetivo} aoAlternarTema={alternarTema} />
      <main id="conteudo" ref={principal} tabIndex={-1} className="casca-conteudo">
        {TELAS.filter((t) => montadas.includes(t.id)).map(({ id, Componente }) => (
          <div key={id} data-tela={id} className="tela" hidden={id !== ativa}>
            <Suspense fallback={<div className="tela-carregando" aria-busy="true" />}>
              <Componente />
            </Suspense>
          </div>
        ))}
      </main>
      <Rodape />
    </div>
  );
}
