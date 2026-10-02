import "./alertas.css";
import { indicadoresDeCanais } from "../estado/alertas-formato";
import { pedirAlertas } from "../estado/alertas-acoes";
import { storeAlertas, useAlertas, type StoreAlertas } from "../estado/alertas";

/** Rodapé de 26 px: canal externo ativo ou com problema, por forma E texto. Clique abre Alertas > Canais. */
export function IndicadorCanal({ store = storeAlertas }: { store?: StoreAlertas }) {
  const { canais } = useAlertas(store);
  const itens = indicadoresDeCanais(canais);
  if (itens.length === 0) return null;
  return (
    <>
      {itens.map((i) => (
        <button key={i.texto} type="button" className="rodape-item rodape-canal" data-tom={i.tom} title="Abrir os canais de alerta" onClick={() => pedirAlertas("canais")}>
          <span aria-hidden="true">{i.forma}</span> {i.texto}
        </button>
      ))}
    </>
  );
}
