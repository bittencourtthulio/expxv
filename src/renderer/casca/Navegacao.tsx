import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlertas } from "../estado/alertas";
import { aoPedirTela } from "../estado/navegacao";
import { usePainelFixado } from "../estado/painel-workspaces";
import { useTema } from "../estado/tema";
import type { Selos } from "../estado/menu-grupos";
import { LimiteDeErro } from "../componentes/LimiteDeErro";
import { Menu } from "./Menu";
import { Rodape } from "./Rodape";
import { Topo } from "./Topo";
import { atualizarMontadas, TELAS, type TelaId } from "./telas";
import "./casca.css";

/** Painel de workspaces: só carrega (e só consulta o main) quando fixado. */
const PainelWorkspaces = lazy(() => import("./PainelWorkspaces"));

/** Casca + navegação por estado (sem roteador). Telas visitadas ficam montadas e ocultas (política em telas.ts). */
export function Navegacao({ inicial = "inicio" }: { inicial?: TelaId }) {
  const [ativa, setAtiva] = useState<TelaId>(inicial);
  const [montadas, setMontadas] = useState<TelaId[]>([inicial]);
  const [fixado, setFixado] = useState(false);
  const { efetivo, alternar } = useTema();
  const [sinal, setSinal] = useState(0);
  const { contagem } = useAlertas();
  const selos = useMemo<Selos>(() => (contagem.nao_lidos > 0 ? { alertas: { valor: contagem.nao_lidos, critico: contagem.criticos > 0 } } : {}), [contagem.nao_lidos, contagem.criticos]);
  const principal = useRef<HTMLElement>(null);
  const painelFixado = usePainelFixado();

  const selecionar = useCallback((id: TelaId) => {
    setAtiva(id);
    setSinal((s) => s + 1);
    setMontadas((m) => atualizarMontadas(m, id));
  }, []);
  useEffect(() => aoPedirTela(selecionar), [selecionar]);
  const fixar = useCallback(() => setFixado((f) => !f), []);
  const alternarTema = useCallback(() => void alternar(), [alternar]);

  return (
    <div className="casca" data-menu-fixado={fixado || undefined} data-painel-ws={painelFixado || undefined}>
      <a href="#conteudo" className="pular-link" onClick={(e) => { e.preventDefault(); principal.current?.focus(); }}>Pular para o conteúdo</a>
      <Menu ativa={ativa} fixado={fixado} aoSelecionar={selecionar} aoFixar={fixar} selos={selos} sinalRevelar={sinal} />
      {painelFixado ? (
        <Suspense fallback={<aside className="painel-ws-carregando" aria-label="Workspaces" aria-busy="true" />}>
          <PainelWorkspaces />
        </Suspense>
      ) : null}
      <Topo tema={efetivo} aoAlternarTema={alternarTema} tela={ativa} />
      <main id="conteudo" ref={principal} tabIndex={-1} className="casca-conteudo">
        {TELAS.filter((t) => montadas.includes(t.id)).map(({ id, rotulo, Componente }) => (
          <div key={id} data-tela={id} className="tela" hidden={id !== ativa}>
            <LimiteDeErro nome={rotulo}>
              <Suspense fallback={<div className="tela-carregando" aria-busy="true" />}>
                <Componente />
              </Suspense>
            </LimiteDeErro>
          </div>
        ))}
      </main>
      <Rodape />
    </div>
  );
}
