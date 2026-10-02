import { useEffect, useState } from "react";
import type { PraticasAgil } from "../../../compartilhado/agil";
import { avisar } from "../../estado/avisos";
import { Carregando, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { formatarDuracao, formatarPercentual, textoDoErro } from "./logica";

const ESTADO_TXT: Record<string, string> = { ok: "OK", atencao: "Atenção", falha: "Falha", na: "N/A", indeterminado: "Indeterminado" };

/** Qualidade: índice de retrabalho com a faixa ir..ir_max, de primeira, contadores honestos (em observação, indeterminado), XP, Lean e checklists. */
export function Qualidade({ ctx }: { ctx: CtxAgil }) {
  const [pr, setPr] = useState<PraticasAgil | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const r = ctx.painel?.retrabalho ?? null;
  const sid = ctx.filtros.sprint_id;
  const carregar = (): void => { void ctx.api.praticas(ctx.ws, sid).then((x) => { setPr(x); setErro(null); }, (e: unknown) => setErro(e)); };
  useEffect(carregar, [ctx.api, ctx.ws, sid, ctx.painel?.gerado_em]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcar = (codigo: string, grupo: PraticasAgil["checklists"][number]["grupo"], estado: PraticasAgil["checklists"][number]["estado"]): void => {
    const alvo = pr?.sprint_id ?? sid;
    if (alvo === null) { avisar("Escolha uma sprint nos filtros para marcar o checklist.", "aviso"); return; }
    void ctx.api.checklistGravar(ctx.ws, alvo, codigo, estado, null).then(carregar, (e) => avisar(textoDoErro(e), "erro"));
    void grupo;
  };
  if (r === null) return <Carregando />;
  const faixa = r.ir === null ? "—" : r.ir_max !== null && r.ir_max !== r.ir ? `${formatarPercentual(r.ir)} a ${formatarPercentual(r.ir_max)}` : formatarPercentual(r.ir);
  return (
    <div className="ag-qualidade">
      <section className="ag-secao" aria-label="Retrabalho">
        <h4>Retrabalho</h4>
        <dl className="ag-numeros">
          <div><dt>Índice de retrabalho</dt><dd>{faixa}</dd></div>
          <div><dt>De primeira</dt><dd>{formatarPercentual(r.first_time_right)}</dd></div>
          <div><dt>Tasks avaliáveis</dt><dd>{r.avaliaveis}</dd></div>
          <div><dt>Em observação</dt><dd>{r.em_observacao}</dd></div>
          <div><dt>Indeterminadas</dt><dd>{r.indeterminado}</dd></div>
          <div><dt>Mudanças de escopo</dt><dd>{r.escopo_eventos}</dd></div>
          <div><dt>Pontos retrabalhados</dt><dd>{r.pontos_retrabalhados ?? "—"}</dd></div>
          <div><dt>Horas de retrabalho (mínimo)</dt><dd>{r.horas_obs_retrabalho_min ?? "—"}</dd></div>
        </dl>
        <p className="ag-meta">O índice só considera tasks fora da janela de observação. A faixa mostra o mínimo (eventos confirmados) e o máximo (incluindo os pendentes de confirmação). O número vem do rastro, do QA e do git, nunca de autorrelato.</p>
      </section>
      {erro !== null && <FaixaErro erro={erro} aoTentar={carregar} />}
      {pr === null ? (erro === null ? <Carregando /> : null) : (
        <>
          <section className="ag-secao" aria-label="Práticas XP">
            <h4>Práticas XP</h4>
            <table className="ag-tab-simples"><thead><tr><th scope="col">Prática</th><th scope="col">Valor</th><th scope="col">Estado</th><th scope="col">Amostra</th><th scope="col">Detalhe</th></tr></thead>
              <tbody>{pr.xp.map((m) => <tr key={m.codigo} data-estado={m.estado}><th scope="row">{m.codigo}</th><td>{m.valor === null ? "—" : formatarPercentual(m.valor)}</td><td>{ESTADO_TXT[m.estado]}</td><td>{m.amostra}</td><td>{m.detalhe}</td></tr>)}</tbody></table>
          </section>
          <section className="ag-secao" aria-label="Lean">
            <h4>Lean: desperdícios</h4>
            <dl className="ag-numeros">
              <div><dt>Espera (bloqueios)</dt><dd>{formatarDuracao(pr.lean.espera_ms)}</dd></div>
              <div><dt>Retrabalho</dt><dd>{formatarPercentual(pr.lean.retrabalho_ir)}</dd></div>
              <div><dt>Trabalho parcial</dt><dd>{pr.lean.trabalho_parcial}</dd></div>
              <div><dt>Troca de contexto (média)</dt><dd>{pr.lean.troca_de_contexto.media ?? "—"}</dd></div>
              <div><dt>Descartes após início</dt><dd>{pr.lean.descartes_apos_inicio}</dd></div>
              <div><dt>Defeitos escapados</dt><dd>{pr.lean.defeitos_escapados ?? "—"}</dd></div>
            </dl>
          </section>
          <section className="ag-secao" aria-label="Checklists">
            <h4>Checklists</h4>
            <ul className="ag-checklist">
              {pr.checklists.map((c) => (
                <li key={c.codigo} data-estado={c.estado}>
                  <span className="ag-chk-nome">[{c.grupo.toUpperCase()}] {c.descricao}</span>
                  <span className="ag-meta">{ESTADO_TXT[c.estado]} · {c.fonte === "auto" ? "automático" : "manual"}{c.nota ? ` · ${c.nota}` : ""}</span>
                  {c.fonte === "manual" || c.estado === "indeterminado" ? (
                    <select aria-label={`Estado de ${c.descricao}`} value={c.estado} onChange={(e) => marcar(c.codigo, c.grupo, e.target.value as typeof c.estado)}>
                      {Object.entries(ESTADO_TXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
