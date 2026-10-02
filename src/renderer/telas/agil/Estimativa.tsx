import { useState } from "react";
import type { ItemDetalheAgil } from "../../../compartilhado/agil";
import { avisar } from "../../estado/avisos";
import { Campo } from "./comum";
import type { CtxAgil } from "./contexto";
import { formatarPontos, textoDoErro, textoOrigemEstimativa } from "./logica";

/**
 * Estimativa do item: pontos ATIVOS com origem, confiança, fatores explicados e versões. A heurística já veio na hora; a IA só roda por clique,
 * depois do consentimento explícito (o texto das tasks vai ao provedor da CLI do usuário). Nada sobrescreve decisão humana.
 * Teclado: com o foco na seção, `A` aceita, `T` trava (fora de campos de texto); os botões são nativos.
 */
export function Estimativa({ ctx, d, aoMudar }: { ctx: CtxAgil; d: ItemDetalheAgil; aoMudar: () => void }) {
  const ativa = d.estimativas.find((e) => e.ativa) ?? null;
  const [ajuste, setAjuste] = useState(ativa?.pontos == null ? "" : String(ativa.pontos));
  const [explicarIa, setExplicarIa] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ia = ctx.estado?.ia ?? null;
  const itemId = d.item.id;

  const gravar = async (estado: "aceita" | "ajustada" | "travada", pontos?: number): Promise<void> => {
    setOcupado(true);
    try {
      const r = await ctx.api.estimativaGravar(ctx.ws, { item_id: itemId, estado, ...(pontos !== undefined ? { pontos } : ativa?.pontos != null ? { pontos: ativa.pontos } : {}) });
      if (r.ajustado_a_escala) avisar("O valor foi ajustado ao mais próximo da escala.", "info");
      aoMudar(); ctx.recarregar();
    } catch (e) { avisar(textoDoErro(e), "erro"); } finally { setOcupado(false); }
  };
  const estimar = async (): Promise<void> => {
    setOcupado(true);
    try {
      const r = await ctx.api.estimar(ctx.ws, [itemId]);
      avisar(r.job_id !== null ? "Heurística aplicada; a IA vai sugerir em segundo plano." : r.ia.motivo_sem_ia !== null ? `Heurística aplicada (sem IA: ${r.ia.motivo_sem_ia}).` : "Heurística aplicada.", "sucesso");
      aoMudar(); ctx.recarregar();
    } catch (e) { avisar(textoDoErro(e), "erro"); } finally { setOcupado(false); }
  };
  const autorizar = async (): Promise<void> => {
    try { await ctx.api.consentimentoIa(ctx.ws, true); setExplicarIa(false); ctx.recarregar(); await estimar(); } catch (e) { avisar(textoDoErro(e), "erro"); }
  };
  const tecla = (e: React.KeyboardEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest("input, textarea, select") !== null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "a" && ativa?.estado === "sugerida") { e.preventDefault(); void gravar("aceita"); }
    else if (e.key === "t" && ativa !== null) { e.preventDefault(); void gravar("travada"); }
  };
  const numero = Number(ajuste.replace(",", "."));
  const ajusteValido = ajuste.trim() !== "" && Number.isFinite(numero) && numero >= 0;

  return (
    <section className="ag-secao" aria-label="Estimativa" onKeyDown={tecla}>
      <h4>Story points</h4>
      <p className="ag-linha">
        <strong className="ag-grande">{formatarPontos(ativa?.pontos ?? null)}</strong>
        {ativa?.rotulo != null && <span> ({ativa.rotulo})</span>}
        <span className="ag-meta"> · {textoOrigemEstimativa(ativa?.origem ?? null, ativa?.confianca ?? null)}{ativa !== null ? ` · ${ativa.estado}` : ""}{ativa !== null ? ` · motor ${ativa.motor}` : ""}</span>
      </p>
      {ativa?.nota != null && ativa.nota !== "" && <p className="ag-meta">{ativa.nota}</p>}
      {ativa !== null && ativa.fatores.length > 0 && (
        <ul className="ag-fatores" aria-label="Fatores da estimativa">
          {ativa.fatores.map((f, i) => <li key={i}><span aria-hidden="true">{f.direcao === "sobe" ? "▲" : "▼"}</span> <strong>{f.fator}</strong>: {f.evidencia}</li>)}
        </ul>
      )}
      <div className="ag-acoes-linha">
        <button type="button" className="ag-btn" disabled={ocupado || ativa?.estado !== "sugerida"} onClick={() => void gravar("aceita")} aria-keyshortcuts="A">Aceitar sugestão</button>
        <button type="button" className="ag-btn" disabled={ocupado || ativa === null || ativa.estado === "travada"} onClick={() => void gravar("travada")} aria-keyshortcuts="T">Travar</button>
        <button type="button" className="ag-btn" disabled={ocupado} onClick={() => (ia?.consentimento === true ? void estimar() : setExplicarIa(true))}>Estimar com IA</button>
      </div>
      <div className="ag-acoes-linha">
        <Campo rotulo="Ajustar pontos"><input type="text" inputMode="decimal" value={ajuste} onChange={(e) => setAjuste(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ajusteValido) void gravar("ajustada", numero); }} /></Campo>
        <button type="button" className="ag-btn" disabled={ocupado || !ajusteValido} onClick={() => void gravar("ajustada", numero)}>Ajustar</button>
      </div>
      {explicarIa && (
        <div className="ag-faixa" data-tom="info" role="group" aria-label="Consentimento para estimar com IA">
          <p>Para estimar com IA, o <strong>texto das tasks</strong> (título, critérios e descrição, sem código nem caminhos) é enviado ao provedor da CLI que você usa. Nada é enviado sem a sua autorização, e você confirma cada sugestão antes de ela valer.</p>
          <div className="ag-acoes-linha">
            <button type="button" className="ag-btn" data-primario onClick={() => void autorizar()}>Autorizar e estimar</button>
            <button type="button" className="ag-btn" onClick={() => setExplicarIa(false)}>Agora não</button>
          </div>
        </div>
      )}
      {d.estimativas.length > 1 && (
        <details className="ag-versoes">
          <summary>Versões ({d.estimativas.length})</summary>
          <ol>
            {[...d.estimativas].sort((a, b) => b.versao - a.versao).map((e) => (
              <li key={e.id}>v{e.versao}: {formatarPontos(e.pontos)} · {e.origem === "humano" ? "pessoa" : "IA"} ({e.motor}) · {e.estado}{e.ativa ? " · ativa" : ""}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
