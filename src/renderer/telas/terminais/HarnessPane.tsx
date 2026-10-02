import { useEffect, useState } from "react";
import { Icone } from "../../componentes/Icone";
import { avisar } from "../../estado/avisos";
import { descreverDestino, storeHarnessPane, TEXTO_PENSAMENTO_PERDIDO, useHarnessPane, type StoreHarnessPane } from "../../estado/harness-pane";
import { storeLimites, useLimites } from "../../estado/limites";
import { formatarPct } from "../../estado/limites-formato";

/** Recibo colapsável ("por que esta conta") e faixa de sugestão de troca: uma linha de 10 px, só quando há o que mostrar. */
export function FaixaHarness({ paneId, store = storeHarnessPane }: { paneId: string; store?: StoreHarnessPane }) {
  const { sugestoes, recibos, erro } = useHarnessPane(store);
  useEffect(() => { void store.iniciar(); }, [store]);
  const sug = sugestoes[paneId];
  const recibo = recibos[paneId];
  if (sug === undefined && recibo === undefined && erro === null) return null;
  return (
    <div className="harness-pane" data-pane={paneId}>
      {sug !== undefined ? (
        <div className="harness-pane-sugestao" role="status">
          <span>▲ conta {formatarPct(sug.consumo_origem_pct)} — sugerido: {descreverDestino(sug)}</span>
          <button type="button" aria-label="Aceitar a troca sugerida e mover" onClick={() => void store.decidir(sug.id, "aceitar")}>mover</button>
          <button type="button" aria-label="Ignorar a sugestão por 30 minutos" onClick={() => void store.decidir(sug.id, "adiar_30min")}>ignorar 30 min</button>
        </div>
      ) : null}
      {recibo !== undefined ? (
        <details className="harness-pane-recibo">
          <summary>Por que esta conta</summary>
          <p>{recibo}</p>
        </details>
      ) : null}
      {erro !== null ? <p role="alert" className="harness-pane-erro">{erro} <button type="button" aria-label="Dispensar erro" onClick={() => store.limparErro()}>×</button></p> : null}
    </div>
  );
}

/** Botão de ícone "mover" (20 px) com a lista de destinos e o aviso de "pensamento perdido". */
export function MoverPane({ paneId, rotulo, store = storeHarnessPane }: { paneId: string; rotulo: string; store?: StoreHarnessPane }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const { contas, rotulos } = useLimites();
  useEffect(() => { if (aberto) void storeLimites.iniciar(); }, [aberto]);
  const mover = async (alvo?: string) => {
    setOcupado(true);
    const r = await store.mover(paneId, alvo);
    setOcupado(false);
    if (r !== null) { setAberto(false); avisar(`Trabalho movido para ${r.para.provedor}${r.para.modelo !== null ? ` / ${r.para.modelo}` : ""}.`, "sucesso"); }
  };
  return (
    <span className="harness-mover">
      <button type="button" aria-label={`Mover ${rotulo} para outra conta`} title="Mover para outra conta ou modelo" aria-haspopup="dialog" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}><Icone nome="atualizar" /></button>
      {aberto ? (
        <div className="harness-mover-popover" role="dialog" aria-label={`Mover ${rotulo}`} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAberto(false); } }}>
          <p>{TEXTO_PENSAMENTO_PERDIDO}</p>
          <button type="button" disabled={ocupado} onClick={() => void mover(undefined)}>Melhor destino (automático)</button>
          {contas.map((c) => (
            <button key={c.account_id} type="button" disabled={ocupado} onClick={() => void mover(c.account_id)}>{rotulos[c.account_id] ?? c.account_id} · {c.provider}</button>
          ))}
          <button type="button" onClick={() => setAberto(false)}>Cancelar</button>
        </div>
      ) : null}
    </span>
  );
}
