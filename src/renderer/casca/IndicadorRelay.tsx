import { ade } from "../ade";
import { useEstadoRelay } from "../estado/relay";
import { pedirJarvis } from "../estado/jarvis-acoes";
import { indicadorRelay } from "../telas/jarvis/relay/relay-logica";
import type { ApiRelay } from "../../compartilhado/relay";

/** Rodapé de 26 px: `● relay · N` só com o relay ligado (forma E texto). A leitura é barata: sem relay ligado o main não carrega nada. Clique abre a aba Relay. */
export function IndicadorRelay({ api = ade()?.relay }: { api?: ApiRelay | undefined }) {
  const { estado } = useEstadoRelay(api);
  const i = indicadorRelay(estado);
  if (i === null) return null;
  return (
    <button type="button" className="rodape-item rodape-canal" data-tom={i.tom === "ok" ? "ok" : i.tom === "erro" ? "erro" : "aviso"} title="Abrir o relay (experimental)" onClick={() => pedirJarvis("relay")}>
      <span aria-hidden="true">{i.forma}</span> {i.texto}
    </button>
  );
}
