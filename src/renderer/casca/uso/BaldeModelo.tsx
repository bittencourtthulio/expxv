import { memo } from "react";
import type { BaldeModelo as Balde } from "../../../compartilhado/limites";
import { ariaBarra, estadoCota, formatarPct, formatarReinicio, SEM_DADO } from "../../estado/limites-formato";
import { rotuloModelo } from "../provedores-visual";
import { BarraUso } from "./BarraJanela";

/** Uma linha por modelo. Com `balde` mostra barra e %; só com `valor` (custo observado) mostra o valor, sem barra inventada. */
export const BaldeModelo = memo(function BaldeModelo({ nome, balde, valor, provedor, conta, agora }: {
  nome: string; balde?: Balde; valor?: string; provedor: string; conta: string; agora?: number;
}) {
  const rotulo = rotuloModelo(nome);
  if (balde === undefined) {
    return (
      <div className="uso-modelo uso-modelo-valor">
        <span className="uso-modelo-nome" title={nome}>{rotulo}</span>
        <span className="uso-pct">{valor ?? SEM_DADO}</span>
      </div>
    );
  }
  const esgotado = (balde.used_pct ?? 0) >= 100;
  const e = estadoCota(balde.used_pct);
  const r = formatarReinicio(balde.resets_at, agora);
  const sinal = e.sinal === "▲" || e.sinal === "!" ? ` ${e.sinal}` : "";
  return (
    <div className="uso-modelo" data-tom={e.tom} data-esgotado={esgotado || undefined} title={`${rotulo} · ${r.texto}`}>
      <span className="uso-modelo-nome" title={nome}>{rotulo}</span>
      <BarraUso pct={balde.used_pct} tom={e.tom} rotulo={ariaBarra({ provedor, conta, escopo: `modelo ${rotulo}`, pct: balde.used_pct, reinicio: r })} />
      <span className="uso-pct">{balde.used_pct === null ? SEM_DADO : formatarPct(balde.used_pct)}{sinal}{esgotado ? " esgotado" : ""}</span>
    </div>
  );
});
