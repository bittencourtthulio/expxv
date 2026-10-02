// Aba "Lista": equivalente acessível do grafo. Virtualizada; ↑/↓ percorrem a lista, → vai ao primeiro vizinho, ← volta ao nó anterior,
// Enter abre o detalhe. Só a linha atual entra na ordem do Tab (roving tabindex).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ArestaGrafo, NoGrafo } from "../../../compartilhado/conhecimento";
import { VirtualLista } from "../../componentes/VirtualLista";
import { corDoTipo, rotuloDoTipo, vizinhosDe } from "./logica";

export const ALTURA_LINHA_NO = 26;

export interface PropsListaNos {
  nos: readonly NoGrafo[];
  arestas: readonly ArestaGrafo[];
  selecionadoId: string | null;
  aoSelecionar: (id: string) => void;
  alturaPadrao?: number;
}

export function ListaNos({ nos, arestas, selecionadoId, aoSelecionar, alturaPadrao }: PropsListaNos) {
  const ordenados = useMemo(() => [...nos].sort((a, b) => b.peso - a.peso || a.rotulo.localeCompare(b.rotulo, "pt-BR")), [nos]);
  const historico = useRef<string[]>([]);
  const [focoId, setFocoId] = useState<string | null>(null);
  const [rolar, setRolar] = useState<{ indice: number; n: number } | undefined>(undefined);
  const pedirFoco = useRef(false);
  const atual = focoId ?? selecionadoId ?? ordenados[0]?.id ?? null;

  useEffect(() => {
    if (!pedirFoco.current || atual === null) return;
    const el = document.getElementById(`con-no-${atual}`);
    if (el !== null) { pedirFoco.current = false; el.focus(); }
  });

  const ir = (id: string, guardar: boolean): void => {
    if (guardar && atual !== null && atual !== id) historico.current.push(atual);
    const i = ordenados.findIndex((n) => n.id === id);
    pedirFoco.current = true;
    setFocoId(id);
    if (i >= 0) setRolar((r) => ({ indice: Math.max(0, i - 2), n: (r?.n ?? 0) + 1 }));
    aoSelecionar(id);
  };
  const aoTeclar = (e: KeyboardEvent<HTMLElement>, i: number): void => {
    const alvo = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? ordenados.length - 1 : null;
    if (alvo !== null) {
      e.preventDefault();
      const n = ordenados[Math.max(0, Math.min(ordenados.length - 1, alvo))];
      if (n !== undefined) ir(n.id, false);
      return;
    }
    const n = ordenados[i];
    if (n === undefined) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const viz = vizinhosDe(n.id, arestas).find((id) => ordenados.some((x) => x.id === id));
      if (viz !== undefined) ir(viz, true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const volta = historico.current.pop();
      if (volta !== undefined) ir(volta, false);
    }
  };

  if (ordenados.length === 0) return <div className="con-vazio" role="status">Nenhum nó com os filtros atuais.</div>;
  return (
    <div className="con-lista">
      <VirtualLista
        itens={ordenados}
        alturaItem={ALTURA_LINHA_NO}
        {...(alturaPadrao !== undefined ? { alturaPadrao } : {})}
        rotulo="Nós do grafo de conhecimento"
        chave={(n) => n.id}
        rolarPara={rolar}
        renderItem={(n, i) => (
          <button
            type="button"
            id={`con-no-${n.id}`}
            className="con-linha"
            tabIndex={n.id === atual ? 0 : -1}
            aria-current={n.id === selecionadoId ? "true" : undefined}
            onClick={() => ir(n.id, true)}
            onKeyDown={(e) => aoTeclar(e, i)}
          >
            <span className="con-ponto" style={{ background: corDoTipo(n.tipo) }} aria-hidden="true" />
            <span className="suave">{rotuloDoTipo(n.tipo)}</span>
            <span>{n.rotulo}</span>
            <span className="suave">{n.ultimo_em.slice(0, 10)}</span>
          </button>
        )}
      />
    </div>
  );
}
