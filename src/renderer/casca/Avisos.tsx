import { memo, useEffect } from "react";
import { storeAvisos, useAvisos, type StoreAvisos } from "../estado/avisos";
import { storeHarnessPane } from "../estado/harness-pane";
import "./limites.css";

/** Toasts da casca: região viva educada; erro usa `alert`. Também liga os eventos de troca do harness (uma vez). */
export const Avisos = memo(function Avisos({ store = storeAvisos, ligarHarness = true }: { store?: StoreAvisos; ligarHarness?: boolean }) {
  const lista = useAvisos(store);
  useEffect(() => { if (ligarHarness) void storeHarnessPane.iniciar(); }, [ligarHarness]);
  return (
    <div className="avisos" role="region" aria-label="Avisos">
      {lista.map((a) => (
        <div key={a.id} className="aviso-toast" data-tom={a.tom} role={a.tom === "erro" ? "alert" : "status"}>
          <span>{a.texto}</span>
          {a.acao !== undefined ? <button type="button" className="botao-mini" onClick={() => { a.acao?.executar(); store.fechar(a.id); }}>{a.acao.rotulo}</button> : null}
          <button type="button" className="botao-mini" aria-label="Dispensar aviso" onClick={() => store.fechar(a.id)}>×</button>
        </div>
      ))}
    </div>
  );
});
