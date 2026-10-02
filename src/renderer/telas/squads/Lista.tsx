import { useEffect, useMemo, useRef, useState } from "react";
import type { SquadResumo } from "../../../compartilhado/squads";
import { VirtualLista } from "../../componentes/VirtualLista";
import { agruparLista } from "../../estado/squads";

export const ALTURA_LINHA_SQUAD = 24;

type Linha = { k: "g"; rotulo: string; n: number } | { k: "s"; s: SquadResumo };

export interface PropsLista {
  itens: readonly SquadResumo[];
  selecionada: string | null;
  aoSelecionar: (slug: string) => void;
  /** a lista já chegou (evita piscar o vazio). */
  carregado: boolean;
}

/** Selos pequenos (10 px): sempre texto, nunca só cor. */
function Selos({ s }: { s: SquadResumo }) {
  return (
    <span className="sq-selos">
      {s.origem === "fabrica" ? <span className="sq-selo">fábrica</span> : null}
      {s.origem === "importada" ? <span className="sq-selo">importada</span> : null}
      {s.atualizacao_de_fabrica ? <span className="sq-selo" data-tom="destaque">atualização</span> : null}
      {!s.valida ? <span className="sq-selo" data-tom="alerta">inválida</span> : null}
      {s.em_uso ? <span className="sq-selo" data-tom="aviso">em uso</span> : null}
    </span>
  );
}

/** Coluna esquerda (220 px): dois grupos virtualizados; ↑/↓ movem o destaque e Enter seleciona. */
export function ListaSquads({ itens, selecionada, aoSelecionar, carregado }: PropsLista) {
  const linhas = useMemo<Linha[]>(() => agruparLista(itens).flatMap((g) => [{ k: "g" as const, rotulo: g.rotulo, n: g.itens.length }, ...g.itens.map((s) => ({ k: "s" as const, s }))]), [itens]);
  const squads = useMemo(() => linhas.filter((l): l is Extract<Linha, { k: "s" }> => l.k === "s").map((l) => l.s.slug), [linhas]);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [rolar, setRolar] = useState<{ indice: number; n: number } | undefined>(undefined);
  const ativo = destaque !== null && squads.includes(destaque) ? destaque : (selecionada !== null && squads.includes(selecionada) ? selecionada : null);
  const tabbable = ativo ?? squads[0] ?? null; // roving tabindex: uma só linha entra na ordem de Tab
  const pedirFoco = useRef(false);
  useEffect(() => {
    if (!pedirFoco.current || ativo === null) return;
    pedirFoco.current = false;
    document.getElementById(`sq-item-${ativo}`)?.focus();
  }, [ativo, rolar]);

  const mover = (delta: number): void => {
    if (squads.length === 0) return;
    const i = squads.indexOf(ativo ?? tabbable ?? "");
    const prox = squads[Math.min(squads.length - 1, Math.max(0, i + delta))] as string;
    pedirFoco.current = true;
    setDestaque(prox);
    setRolar((r) => ({ indice: Math.max(0, linhas.findIndex((l) => l.k === "s" && l.s.slug === prox) - 2), n: (r?.n ?? 0) + 1 }));
  };
  const aoTeclar = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
    else if (e.key === "Enter" && ativo !== null) { e.preventDefault(); aoSelecionar(ativo); }
  };

  if (!carregado) return <div className="sq-lista" aria-busy="true" />;
  if (squads.length === 0) return <p className="sq-lista-vazia" role="status">Nenhuma squad encontrada.</p>;

  return (
    <div className="sq-lista" role="group" aria-label="Squads" onKeyDown={aoTeclar}>
      <VirtualLista
        itens={linhas}
        alturaItem={ALTURA_LINHA_SQUAD}
        rotulo="Lista de squads"
        chave={(l) => (l.k === "g" ? `g:${l.rotulo}` : `s:${l.s.slug}`)}
        rolarPara={rolar}
        renderItem={(l) =>
          l.k === "g" ? (
            <div className="sq-grupo">{l.rotulo} <span>{l.n}</span></div>
          ) : (
            <button
              type="button"
              id={`sq-item-${l.s.slug}`}
              className="sq-item"
              tabIndex={tabbable === l.s.slug ? 0 : -1}
              aria-current={selecionada === l.s.slug ? "true" : undefined}
              data-ativo={ativo === l.s.slug || undefined}
              title={`${l.s.nome} · ${l.s.membros} membros · ${l.s.clis.join(", ")}`}
              onClick={() => { setDestaque(l.s.slug); aoSelecionar(l.s.slug); }}
            >
              <span className="sq-item-nome">{l.s.nome}</span>
              <Selos s={l.s} />
            </button>
          )
        }
      />
    </div>
  );
}
