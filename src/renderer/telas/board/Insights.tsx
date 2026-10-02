import { memo, useEffect, useState } from "react";
import type { BoardModelo, CardBoard, LinhaRelatorio } from "../../../compartilhado/custo";
import { ade } from "../../ade";
import { formatarCusto, formatarValorUsd } from "../../estado/custo-formato";
import { COLUNAS_BOARD } from "./rotulos";

const DIA = 86_400_000;
export interface Insight { id: string; rotulo: string; texto: string }

/** Top N cards por custo conhecido (puro). Card sem preço nunca entra como "caro" nem como zero. */
export function maioresCards(modelo: BoardModelo, n = 5): CardBoard[] {
  const todos = COLUNAS_BOARD.flatMap((c) => modelo.colunas[c]).filter((c) => c.custo.usd !== null && c.custo.usd > 0);
  return todos.sort((a, b) => (b.custo.usd ?? 0) - (a.custo.usd ?? 0)).slice(0, n);
}
export const textoModelos = (linhas: readonly LinhaRelatorio[]): string =>
  linhas.slice(0, 4).map((l) => `${l.rotulo || "modelo desconhecido"} ${formatarCusto(l.custo)}`).join(" · ");

/** Faixa recolhível de 1 linha por insight; some quando não há dado. O custo do decisor fica SEMPRE separado dos cards. */
export const Insights = memo(function Insights({ modelo, workspaceId }: { modelo: BoardModelo; workspaceId: string }) {
  const [aberto, setAberto] = useState(false);
  const [extra, setExtra] = useState<Insight[]>([]);
  useEffect(() => {
    if (!aberto) return undefined;
    let vivo = true;
    const agora = new Date();
    const desde = new Date(agora.getTime() - 7 * DIA).toISOString();
    const ate = agora.toISOString();
    void (async () => {
      const lista: Insight[] = [];
      try {
        const api = ade()?.custo;
        if (api?.relatorio !== undefined) {
          const m = await api.relatorio({ agrupar: "modelo", desde, ate, filtros: { workspace_id: workspaceId }, limite: 10 });
          if (m.linhas.length > 0) lista.push({ id: "modelo", rotulo: "Gasto por modelo (7 d)", texto: textoModelos(m.linhas) });
          const d = await api.relatorio({ agrupar: "dia", desde, ate, filtros: { workspace_id: workspaceId }, limite: 10 });
          const dias = d.linhas.filter((l) => l.custo.usd !== null);
          if (dias.length >= 2) {
            const prim = dias[0]!.custo.usd ?? 0;
            const ult = dias[dias.length - 1]!.custo.usd ?? 0;
            lista.push({ id: "tendencia", rotulo: "Tendência da semana", texto: `${dias.length} dias com uso; do primeiro ao último dia ${ult > prim ? "▲ subiu" : ult < prim ? "▼ caiu" : "= estável"} (${formatarValorUsd(prim)} → ${formatarValorUsd(ult)}).` });
          }
        }
      } catch { /* sem relatório: os outros insights seguem */ }
      try {
        const h = ade()?.harness;
        if (h?.listarDecisoes !== undefined) {
          const r = await h.listarDecisoes({ desde, limite: 1 });
          if (r.totais.consultas > 0) lista.push({ id: "decisor", rotulo: "Custo do decisor (fora dos cards)", texto: `${r.totais.custo_usd === null ? "custo desconhecido" : `US$ ${r.totais.custo_usd.toFixed(4)}`} em ${r.totais.consultas} consultas${r.totais.custo_desconhecido > 0 ? ` (${r.totais.custo_desconhecido} sem custo conhecido)` : ""}.` });
        }
      } catch { /* sem decisor */ }
      if (vivo) setExtra(lista);
    })();
    return () => { vivo = false; };
  }, [aberto, workspaceId]);

  const top = maioresCards(modelo);
  const itens: Insight[] = [...extra];
  if (top.length > 0) itens.splice(1, 0, { id: "cards", rotulo: "Maiores cards", texto: top.map((c) => `${c.task_id} ${formatarCusto(c.custo)}`).join(" · ") });
  return (
    <div className="bd-insights">
      <button type="button" className="bd-insights-btn" aria-expanded={aberto} aria-controls="bd-insights-corpo" onClick={() => setAberto((a) => !a)}>{aberto ? "▾" : "▸"} Insights de custo</button>
      {aberto ? (
        <ul id="bd-insights-corpo" className="bd-lista bd-insights-lista" aria-label="Insights de custo">
          {itens.length === 0 ? <li className="bd-nota">Sem dados de custo ainda: eles aparecem quando houver uso observado das CLIs.</li> : itens.map((i) => <li key={i.id}><strong>{i.rotulo}</strong><span>{i.texto}</span></li>)}
        </ul>
      ) : null}
    </div>
  );
});
