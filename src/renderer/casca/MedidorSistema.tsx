import { memo, useEffect } from "react";
import { tomDoUso } from "../../compartilhado/sistema";
import { Icone } from "../componentes/Icone";
import { usePopoverLimites } from "../estado/popover-limites";
import { storeSistema, useSistema, type StoreSistema } from "../estado/sistema";
import { ariaChip, sinalDoTom, textoPct, tomGeral } from "../estado/sistema-formato";
import { fecharPopoverLimites } from "../estado/popover-limites";
import { PopoverSistema } from "./PopoverSistema";
import "./sistema.css";

function Item({ rotulo, pct }: { rotulo: string; pct: number | undefined }) {
  return (
    <span className="sis-item" data-tom={pct === undefined ? "normal" : tomDoUso(pct)}>
      <span className="sis-rot">{rotulo}</span>
      <span className="sis-num">{textoPct(pct)}</span>
      <i className="sis-barra" aria-hidden="true"><b style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></i>
    </span>
  );
}

/**
 * Chip de CPU e RAM da máquina (D-530…), à direita do cabeçalho, ANTES do chip de consumo das CLIs. Mínimo: dois números + duas
 * minibarras de 3 px. Largura do cabeçalho (container query): cheio → só '23% · 61%' → só ícone (tooltip e aria-label com os números).
 * Região viva SEPARADA que só anuncia ao cruzar limiar (nunca por amostra). Clique abre o popover; oculto pela preferência = nada renderiza
 * e o main não amostra (zero timers).
 */
export const MedidorSistema = memo(function MedidorSistema({ store = storeSistema }: { store?: StoreSistema }) {
  const s = useSistema((e) => e, store);
  const limitesAberto = usePopoverLimites();
  useEffect(() => { void store.iniciar(); }, [store]);
  useEffect(() => { if (limitesAberto) store.fechar(); }, [limitesAberto, store]);
  if (!s.disponivel || !s.mostrar) return null;
  const a = s.amostra;
  const tom = tomGeral(a);
  const rotulo = ariaChip(a);
  return (
    <>
      <button
        type="button" className="sis-chip" data-tom={tom} aria-label={rotulo} aria-haspopup="dialog" aria-expanded={s.aberto} title={`${rotulo}. Clique para detalhes.`}
        onClick={() => { fecharPopoverLimites(); store.alternar(); }}
      >
        <span className="sis-icone"><Icone nome="cpu" />{sinalDoTom(tom) !== "" ? <span className="sis-sinal" aria-hidden="true">{sinalDoTom(tom)}</span> : null}</span>
        <Item rotulo="CPU" pct={a?.cpu} />
        <span className="sis-sep" aria-hidden="true">·</span>
        <Item rotulo="RAM" pct={a?.ram} />
      </button>
      <span className="sr-somente" role="status" aria-live="polite" aria-atomic="true">{s.anuncio}</span>
      <PopoverSistema store={store} />
    </>
  );
});
