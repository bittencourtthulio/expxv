import { useId, useState } from "react";
import { moduloDoGesto } from "../../../nucleo/suite/modulos";
import { Icone } from "../../componentes/Icone";
import { GESTOS_MAIS, GESTOS_PRINCIPAIS, defDoGestoPedido, type DefGestoPedido } from "./pedido-gestos";

interface Props {
  gesto: string;
  aoEscolher: (gesto: string) => void;
  desligados: ReadonlySet<string>;
}

function Opcao({ g, ativo, off, aoEscolher }: { g: DefGestoPedido; ativo: boolean; off: boolean; aoEscolher: (g: string) => void }) {
  return (
    <label className="ped-gesto" data-ativo={ativo || undefined} data-desligado={off || undefined}>
      <input type="radio" name="gesto-pedido" value={g.gesto} checked={ativo} onChange={() => aoEscolher(g.gesto)} />
      <span className="ped-gesto-nome">{g.rotulo}{off ? <span className="met-chip" data-modo="aviso">módulo desligado</span> : null}</span>
      <span className="ped-gesto-explica">{g.explica}</span>
      <code className="ped-gesto-skill">/expx:{g.skill}</code>
    </label>
  );
}

/** Lista de gestos: os principais sempre à vista; os de contexto ficam atrás de "Mais" (abrem sozinhos quando um deles está escolhido). */
export function GestosLista({ gesto, aoEscolher, desligados }: Props) {
  const [maisAberto, setMaisAberto] = useState(false);
  const idMais = useId();
  const ehMais = GESTOS_MAIS.some((g) => g.gesto === gesto);
  const def = defDoGestoPedido(gesto);
  const off = (g: DefGestoPedido): boolean => { const m = moduloDoGesto(g.gesto, null); return m !== null && desligados.has(m); };
  return (
    <>
      <div role="radiogroup" aria-label="O que fazer com o pedido" className="ped-lista">
        {GESTOS_PRINCIPAIS.map((g) => <Opcao key={g.gesto} g={g} ativo={gesto === g.gesto} off={off(g)} aoEscolher={(x) => { aoEscolher(x); setMaisAberto(false); }} />)}
      </div>
      <button type="button" className="met-botao ped-mais" aria-expanded={maisAberto || ehMais} aria-controls={idMais} onClick={() => setMaisAberto((v) => !v)}>
        Mais{ehMais ? `: ${def.rotulo}` : ""}
      </button>
      {maisAberto || ehMais ? (
        <div id={idMais} role="radiogroup" aria-label="Mais gestos" className="ped-lista ped-lista-mais">
          {GESTOS_MAIS.map((g) => <Opcao key={g.gesto} g={g} ativo={gesto === g.gesto} off={off(g)} aoEscolher={aoEscolher} />)}
        </div>
      ) : null}
    </>
  );
}

/** No estreito (< 1100 px) a coluna vira uma faixa acima do composer: mostra o gesto atual e abre a lista sob demanda. */
export function FaixaGestos({ gesto, aoEscolher, desligados }: Props) {
  const [aberta, setAberta] = useState(false);
  const idPainel = useId();
  const def = defDoGestoPedido(gesto);
  return (
    <div className="ped-faixa">
      <button type="button" className="ped-faixa-botao" aria-expanded={aberta} aria-controls={idPainel} onClick={() => setAberta((v) => !v)}>
        <span className="ped-faixa-rotulo">O que você quer fazer?</span>
        <b>{def.rotulo}</b>
        <code>/expx:{def.skill}</code>
        <span className="ped-faixa-trocar">{aberta ? "Fechar" : "Trocar"}<Icone nome={aberta ? "chevronBaixo" : "chevron"} /></span>
      </button>
      {aberta ? <div id={idPainel} className="ped-faixa-painel"><GestosLista gesto={gesto} aoEscolher={(g) => { aoEscolher(g); setAberta(false); }} desligados={desligados} /></div> : null}
    </div>
  );
}
