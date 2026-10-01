import { useMemo, useState } from "react";
import type { Trabalho } from "../../../nucleo/metodo/tipos";
import { VirtualLista } from "../../componentes/VirtualLista";
import { Sinaleira } from "./Sinaleira";
import { ROTULO_STATUS_TRABALHO, rotuloEstagio } from "./util";

const FERRAMENTAS = ["todas", "sprintx", "runx", "prodx", "buildx"] as const;

export function Lista({ trabalhos, selecionado, aoSelecionar }: { trabalhos: readonly Trabalho[]; selecionado: string | null; aoSelecionar: (id: string) => void }) {
  const [filtro, setFiltro] = useState<(typeof FERRAMENTAS)[number]>("todas");
  const itens = useMemo(() => (filtro === "todas" ? trabalhos : trabalhos.filter((t) => t.ferramenta === filtro)), [trabalhos, filtro]);
  return (
    <div className="met-lista">
      <label className="met-filtro">
        Ferramenta
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
          {FERRAMENTAS.map((f) => <option key={f} value={f}>{f === "todas" ? "Todas" : f}</option>)}
        </select>
      </label>
      {itens.length === 0 ? <p className="met-suave">Nenhum trabalho de {filtro}.</p> : (
        <VirtualLista
          itens={itens} alturaItem={68} rotulo="Trabalhos do método" chave={(t) => t.id}
          renderItem={(t) => (
            <button type="button" className="met-linha-trab" aria-current={t.id === selecionado ? "true" : undefined} onClick={() => aoSelecionar(t.id)}>
              <span className="met-linha-topo">
                <span className="met-chip">{t.ferramenta}</span>
                <b className="met-titulo">{t.titulo}</b>
              </span>
              <span className="met-linha-meio">{rotuloEstagio(t.estagio)} · {ROTULO_STATUS_TRABALHO[t.status]}</span>
              <Sinaleira sinaleira={t.sinaleira} />
            </button>
          )}
        />
      )}
    </div>
  );
}
