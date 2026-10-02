import { memo, useEffect } from "react";
import { storeLimites, useLimites } from "../estado/limites";
import { textoChipGeral } from "../estado/limites-formato";
import { alternarPopoverLimites } from "../estado/popover-limites";
import { PopoverLimites } from "./PopoverLimites";
import { LogoProvedor } from "./uso/LogoProvedor";

/** Chip da cota geral no topo (pior caso + folga média + cobertura); clique/Enter abre o popover. */
export const CotaGeralTopo = memo(function CotaGeralTopo() {
  const { geral, rotulos, disponivel, contas } = useLimites();
  useEffect(() => { void storeLimites.iniciar(); }, []);
  if (!disponivel) return null;
  const chip = textoChipGeral(geral, rotulos);
  const provedorPior = geral?.pior == null ? null : contas.find((c) => c.account_id === geral.pior!.conta_id)?.provider ?? null;
  const sinal = chip.estado.sinal === "▲" || chip.estado.sinal === "!" ? ` ${chip.estado.sinal}` : "";
  return (
    <>
      <button type="button" className="cota-chip" data-tom={chip.estado.tom} data-estimado={chip.estado.estimado || undefined} aria-label={chip.aria} aria-haspopup="dialog" title={chip.aria} onClick={alternarPopoverLimites}>
        {provedorPior !== null ? <LogoProvedor provedor={provedorPior} tamanho={14} /> : null}
        <span className="cota-chip-texto">{chip.texto}{sinal}</span>
      </button>
      <PopoverLimites />
    </>
  );
});
