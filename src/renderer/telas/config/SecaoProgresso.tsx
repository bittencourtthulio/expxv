// "Mostrar painel de progresso na área de terminais" (D-660…; chave `progresso_painel_mostrar`, padrão LIGADO). Desligado, o painel some e o app nem assina os
// eventos de progresso. O store é o mesmo do painel (a preferência vive no main via `app:config_*`).
import { memo, useEffect } from "react";
import { storeProgresso, useProgresso, type StoreProgresso } from "../../estado/progresso";

export const SecaoProgresso = memo(function SecaoProgresso({ store = storeProgresso }: { store?: StoreProgresso }) {
  const ligado = useProgresso((e) => e.ciclo.ligado, store);
  useEffect(() => { void store.iniciar(); }, [store]); // lê a preferência salva (idempotente)
  return (
    <section className="cfg-secao" aria-label="Painel de progresso">
      <h2>Painel de progresso</h2>
      <p className="cfg-ajuda">Quando uma pipeline do método (runx, sprintx, prodx…) começa, abre uma lista estreita à direita dos terminais, marca cada etapa que termina e fecha sozinha ao fim. Só rótulos das etapas: nenhum conteúdo de conversa é lido.</p>
      <button type="button" role="switch" aria-checked={ligado} className="botao" onClick={() => void store.definirLigado(!ligado)}>
        {ligado ? "Mostrar painel de progresso na área de terminais: ligado" : "Mostrar painel de progresso na área de terminais: desligado"}
      </button>
    </section>
  );
});
