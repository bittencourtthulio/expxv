import { memo, useEffect, useMemo } from "react";
import { abrirPopoverLimites } from "../estado/popover-limites";
import { formatarReinicio, janelaGargalo, nomeConta, resumoRodape, SEM_DADO, type ResumoRodape } from "../estado/limites-formato";
import { storeLimites, useLimites } from "../estado/limites";
import type { AccountUsage } from "../../compartilhado/limites";
import { agruparPorProvedor, infoProvedor } from "./provedores-visual";
import { LogoProvedor } from "./uso/LogoProvedor";

/** Máximo de contas inline no rodapé; o resto vira `+N` (abre o mesmo popover). */
export const MAX_CONTAS_INLINE = 4;

function textoReset(c: AccountUsage): string {
  const r = formatarReinicio(janelaGargalo(c)?.resets_at, Date.now());
  return r.relativo === null ? "" : ` · reinicia em ${r.relativo}`;
}

function Mini({ pct, tom }: { pct: number | null; tom: string }) {
  return (
    <span className="medidor-barra" data-tom={tom} aria-hidden="true">
      {pct === null ? null : <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />}
    </span>
  );
}

const Conta = memo(function Conta({ conta, resumo, ordinal }: { conta: AccountUsage; resumo: ResumoRodape; ordinal: number | null }) {
  const { estado } = resumo;
  const sinal = estado.sinal === "▲" || estado.sinal === "!" ? ` ${estado.sinal}` : "";
  return (
    <button
      type="button"
      className="medidor-conta"
      data-provedor={infoProvedor(conta.provider).id}
      data-tom={estado.tom}
      data-estimado={estado.estimado || undefined}
      data-velho={estado.velho || undefined}
      aria-label={resumo.aria}
      aria-haspopup="dialog"
      title={`${resumo.titulo}${textoReset(conta)}`}
      onClick={abrirPopoverLimites}
    >
      <LogoProvedor provedor={conta.provider} tamanho={15} />
      {ordinal !== null ? <span className="medidor-ordinal" aria-hidden="true">{ordinal}</span> : null}
      <span className="medidor-pct">{resumo.texto}{sinal}</span>
      {resumo.pct !== null || estado.tom === "semdado" ? <Mini pct={resumo.pct} tom={estado.tom} /> : null}
    </button>
  );
});

/** Rodapé de todas as páginas: uma linha, uma entrada por conta (logo + % do gargalo + minibarra), agrupadas por provedor. */
export const MedidorLimites = memo(function MedidorLimites() {
  const { contas, rotulos, disponivel, carregado } = useLimites();
  useEffect(() => { void storeLimites.iniciar(); }, []);
  const { grupos, resto } = useMemo(() => {
    const ordenadas = agruparPorProvedor(contas);
    let sobra = 0;
    let n = 0;
    const out = ordenadas.map((g) => {
      const visiveis = g.itens.filter(() => n++ < MAX_CONTAS_INLINE);
      sobra += g.itens.length - visiveis.length;
      return { ...g, visiveis };
    }).filter((g) => g.visiveis.length > 0);
    return { grupos: out, resto: sobra };
  }, [contas]);
  return (
    <div className="medidor-limites" role="group" aria-label="Cotas por conta">
      {!disponivel ? <span className="medidor-vazio">cotas indisponíveis</span>
        : carregado && contas.length === 0 ? <span className="medidor-vazio">sem contas · {SEM_DADO}</span>
        : grupos.map((g) => (
          <span key={g.provedor.id} className="medidor-grupo" role="group" aria-label={g.provedor.nome}>
            {g.visiveis.map((c) => (
              <Conta key={c.account_id} conta={c} ordinal={g.itens.length > 1 ? g.itens.indexOf(c) + 1 : null} resumo={resumoRodape(c, g.provedor.nome, nomeConta(c, rotulos[c.account_id]))} />
            ))}
          </span>
        ))}
      {resto > 0 ? <button type="button" className="medidor-conta medidor-mais" aria-label={`Mais ${resto} contas`} onClick={abrirPopoverLimites}>+{resto}</button> : null}
    </div>
  );
});
