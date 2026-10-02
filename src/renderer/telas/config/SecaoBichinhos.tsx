// Preferências globais do Bichinho (D-468): "Mostrar bichinhos" (padrão ligado) e "Silenciar animações". O store do bichinho vive no chunk lazy dele:
// aqui só se importa dinamicamente, então a tela de configurações não puxa o desenho nem a arte.
import { memo, useEffect, useId, useState } from "react";
import { movimentoReduzido } from "../../bichinho/hooks";
import type { StoreBichinho } from "../../bichinho/estado";

export const SecaoBichinhos = memo(function SecaoBichinhos({ carregar = () => import("../../bichinho/estado").then((m) => m.storeBichinho) }: { carregar?: () => Promise<StoreBichinho> }) {
  const [store, setStore] = useState<StoreBichinho | null>(null);
  const [, redesenhar] = useState(0);
  useEffect(() => {
    let cancelado = false;
    let solta: (() => void) | undefined;
    void carregar().then(async (s) => {
      await s.garantir([]);
      if (cancelado) return;
      setStore(s);
      solta = s.assinar(() => redesenhar((n) => n + 1));
    });
    return () => { cancelado = true; solta?.(); };
  }, [carregar]);
  const e = store?.obter();
  const idMin = useId();
  const passear = e?.passear ?? true;
  const reduzido = movimentoReduzido();
  return (
    <section className="cfg-secao" aria-label="Bichinhos">
      <h2>Bichinhos dos workspaces</h2>
      <p className="cfg-ajuda">Cada workspace tem um bichinho que reage às CLIs e cresce com os tokens e a base de conhecimento. Só contadores: nenhum conteúdo de conversa é lido.</p>
      <div className="cfg-linha" role="group" aria-label="Bichinhos">
        <button type="button" role="switch" aria-checked={e?.mostrar ?? true} className="botao" disabled={store === null} onClick={() => void store?.definirMostrar(!(e?.mostrar ?? true))}>{(e?.mostrar ?? true) ? "Mostrar bichinhos: ligado" : "Mostrar bichinhos: desligado"}</button>
        <button type="button" role="switch" aria-checked={e?.silenciar ?? false} className="botao" disabled={store === null} onClick={() => void store?.definirSilenciar(!(e?.silenciar ?? false))}>{(e?.silenciar ?? false) ? "Animações silenciadas" : "Silenciar animações"}</button>
      </div>
      <div className="cfg-linha" role="group" aria-label="Passeio dos bichinhos">
        <button type="button" role="switch" aria-checked={passear} className="botao" disabled={store === null} onClick={() => void store?.definirPassear(!passear)}>{passear ? "Bichinhos passeiam quando ociosos: ligado" : "Bichinhos passeiam quando ociosos: desligado"}</button>
        <label htmlFor={idMin} className="cfg-ajuda">Tempo de ociosidade antes do passeio (minutos)</label>
        <input id={idMin} type="number" min={1} max={30} step={1} inputMode="numeric" aria-label="Tempo de ociosidade antes do passeio" disabled={store === null || !passear} value={e?.ociosidadeMin ?? 3} onChange={(ev) => { const n = Number(ev.target.value); if (Number.isFinite(n) && ev.target.value !== "") void store?.definirOciosidadeMin(n); }} />
        <button type="button" role="switch" aria-checked={e?.travessuras ?? true} className="botao" disabled={store === null || !passear} onClick={() => void store?.definirTravessuras(!(e?.travessuras ?? true))}>{(e?.travessuras ?? true) ? "Bichinhos mexem nos elementos da tela (travessuras): ligado" : "Bichinhos mexem nos elementos da tela (travessuras): desligado"}</button>
      </div>
      <p className="cfg-ajuda">Sem mouse nem teclado pelo tempo escolhido, e só os bichinhos de workspaces sem agente trabalhando, eles saem para passear, brincar e dormir; qualquer movimento do mouse, tecla ou trabalho os traz de volta ao lugar. As travessuras só deslocam a aparência de ícones, selos e textos pequenos, nunca terminais, campos nem botões de confirmação, e tudo volta ao lugar na hora.{(reduzido || (e?.silenciar ?? false)) ? " Com “Reduzir movimento” do sistema ou “Silenciar animações”, os bichinhos não passeiam: ficam no posto em pose estática." : " Com “Reduzir movimento” do sistema ligado, eles não passeiam: ficam no posto em pose estática."}</p>
    </section>
  );
});
