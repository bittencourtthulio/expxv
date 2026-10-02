import "./vcs-deco.css";
import type { AlvoVcs } from "../../compartilhado/vcs";
import { textoResumo, useResumoVcs, type StoreVcs, storeVcs } from "../estado/vcs";
import { Icone } from "./Icone";

/** Branch + sujo + ahead/behind em texto curto (T-06.33). Sem repositório não mostra nada. */
export function DecoracaoVcs({ alvo, store = storeVcs, className = "" }: { alvo: AlvoVcs | null; store?: StoreVcs; className?: string }) {
  const r = useResumoVcs(alvo, store);
  if (r === null || r.tipo === "nenhum") return null;
  const longo = `${r.tipo === "svn" ? "Cópia de trabalho SVN" : "Branch"} ${r.branch ?? "destacado"}${r.sujo ? ", com mudanças" : ", limpo"}${r.ahead > 0 ? `, ${r.ahead} à frente` : ""}${r.behind > 0 ? `, ${r.behind} atrás` : ""}`;
  return (
    <span className={`vc-deco ${className}`.trim()} data-sujo={r.sujo || undefined} title={longo} aria-label={longo} role="status">
      <Icone nome="ramo" className="vc-deco-icone" />
      <span className="vc-deco-texto">{textoResumo(r)}</span>
    </span>
  );
}
