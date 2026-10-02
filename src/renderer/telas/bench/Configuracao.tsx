import { useState } from "react";
import type { AlvoDisponivel, AlvoEditavel, ApiBench, CliBench, PrecoBench } from "../../../compartilhado/bench";
import { CLIS_BENCH } from "../../../compartilhado/bench";
import { Dialogo } from "../../componentes/Dialogo";
import { ESFORCOS_POR_CLI } from "./logica";

export interface ContaMin { id: string; rotulo: string; provedor: string }

/** Alvos: CLI × modelo × esforço × conta DEDICADA. O esforço é parâmetro do alvo (flag/env), nunca texto de prompt. */
export function DialogoAlvos({ api, alvos, contas, aoFechar, aoSalvo }: { api: ApiBench; alvos: readonly AlvoDisponivel[]; contas: readonly ContaMin[]; aoFechar: () => void; aoSalvo: () => void }) {
  const [linhas, setLinhas] = useState<AlvoEditavel[]>(() => alvos.map((a) => ({ provedor: a.provedor, modelo: a.modelo, esforco: a.esforco, cli: a.cli, conta_id: a.conta_id, rotulo: a.rotulo })));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const mudar = (i: number, p: Partial<AlvoEditavel>): void => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const salvar = async (): Promise<void> => {
    setOcupado(true); setErro(null);
    try { await api.alvosSalvar(linhas.map((l) => ({ ...l, provedor: l.cli, rotulo: null }))); aoSalvo(); aoFechar(); } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar os alvos."); } finally { setOcupado(false); }
  };
  return (
    <Dialogo titulo="Alvos do Bench" aoFechar={aoFechar} largura={760}>
      <div className="dialogo-corpo">
        <p className="bn-meta">Cada alvo roda com uma <strong>conta dedicada</strong> (crie uma em Provedores e entre nela uma vez pelo terminal). Nunca use a conta pessoal em uso: o Bench roda código gerado por IA.</p>
        {contas.length === 0 && <p role="status" className="bn-bloqueio">Nenhuma conta de provedor. Crie uma conta dedicada em Provedores para habilitar os alvos.</p>}
        <table className="bn-tabela" aria-label="Alvos">
          <thead><tr><th scope="col">CLI</th><th scope="col">Modelo</th><th scope="col">Esforço</th><th scope="col">Conta dedicada</th><th scope="col"><span className="bn-so-leitor">Remover</span></th></tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>
                <td><select aria-label={`CLI do alvo ${i + 1}`} value={l.cli} onChange={(e) => mudar(i, { cli: e.target.value as CliBench, esforco: null, conta_id: null })}>{CLIS_BENCH.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                <td><input aria-label={`Modelo do alvo ${i + 1}`} value={l.modelo} onChange={(e) => mudar(i, { modelo: e.target.value.trim() })} placeholder="id do modelo" spellCheck={false} /></td>
                <td><select aria-label={`Esforço do alvo ${i + 1}`} value={l.esforco ?? ""} onChange={(e) => mudar(i, { esforco: e.target.value === "" ? null : e.target.value })}><option value="">padrão da CLI</option>{ESFORCOS_POR_CLI[l.cli].map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                <td><select aria-label={`Conta do alvo ${i + 1}`} value={l.conta_id ?? ""} onChange={(e) => mudar(i, { conta_id: e.target.value === "" ? null : e.target.value })}><option value="">escolha…</option>{contas.filter((c) => c.provedor === l.cli).map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}</select></td>
                <td><button type="button" className="bn-btn" aria-label={`Remover o alvo ${i + 1}`} onClick={() => setLinhas((x) => x.filter((_, j) => j !== i))}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="bn-btn" onClick={() => setLinhas((l) => [...l, { provedor: "claude", modelo: "", esforco: null, cli: "claude", conta_id: null, rotulo: null }])}>Adicionar alvo</button>
        {erro !== null && <p role="alert" className="bn-erro">{erro}</p>}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado || linhas.some((l) => l.modelo === "")} onClick={() => void salvar()}>Salvar alvos</button>
      </div>
    </Dialogo>
  );
}

/** Preços (USD por milhão de tokens). Sem preço cadastrado e sem relatório da CLI, o custo é "desconhecido" — nunca zero. */
export function DialogoPrecos({ api, precos, aoFechar, aoSalvo }: { api: ApiBench; precos: readonly PrecoBench[]; aoFechar: () => void; aoSalvo: () => void }) {
  const [linhas, setLinhas] = useState<Array<{ provedor: string; modelo: string; entrada: string; saida: string; cache: string }>>(() => precos.map((p) => ({ provedor: p.provedor, modelo: p.modelo, entrada: String(p.preco_in_mtok), saida: String(p.preco_out_mtok), cache: p.preco_cache_mtok === null ? "" : String(p.preco_cache_mtok) })));
  const [erro, setErro] = useState<string | null>(null);
  const mudar = (i: number, p: Partial<(typeof linhas)[number]>): void => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const salvar = async (): Promise<void> => {
    const n = (t: string): number => Number(t.replace(",", "."));
    const lista: PrecoBench[] = [];
    for (const l of linhas) {
      const e = n(l.entrada), s = n(l.saida), c = l.cache.trim() === "" ? null : n(l.cache);
      if (l.modelo.trim() === "" || !Number.isFinite(e) || !Number.isFinite(s) || e < 0 || s < 0 || (c !== null && (!Number.isFinite(c) || c < 0))) { setErro("Confira os preços: números não negativos e modelo preenchido."); return; }
      lista.push({ provedor: l.provedor, modelo: l.modelo.trim(), preco_in_mtok: e, preco_out_mtok: s, preco_cache_mtok: c, vale_desde: new Date().toISOString() });
    }
    try { await api.precosGravar(lista); aoSalvo(); aoFechar(); } catch (x) { setErro(x instanceof Error ? x.message : "Falha ao salvar os preços."); }
  };
  return (
    <Dialogo titulo="Preços (USD por milhão de tokens)" aoFechar={aoFechar} largura={720}>
      <div className="dialogo-corpo">
        <p className="bn-meta">Preços novos valem para as próximas execuções; o que já rodou fica com o preço de então.</p>
        <table className="bn-tabela" aria-label="Preços">
          <thead><tr><th scope="col">Provedor</th><th scope="col">Modelo</th><th scope="col">Entrada</th><th scope="col">Saída</th><th scope="col">Cache</th><th scope="col"><span className="bn-so-leitor">Remover</span></th></tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>
                <td><input aria-label={`Provedor ${i + 1}`} value={l.provedor} onChange={(e) => mudar(i, { provedor: e.target.value.trim() })} /></td>
                <td><input aria-label={`Modelo ${i + 1}`} value={l.modelo} onChange={(e) => mudar(i, { modelo: e.target.value })} spellCheck={false} /></td>
                <td><input aria-label={`Entrada ${i + 1}`} inputMode="decimal" value={l.entrada} onChange={(e) => mudar(i, { entrada: e.target.value })} style={{ width: 70 }} /></td>
                <td><input aria-label={`Saída ${i + 1}`} inputMode="decimal" value={l.saida} onChange={(e) => mudar(i, { saida: e.target.value })} style={{ width: 70 }} /></td>
                <td><input aria-label={`Cache ${i + 1}`} inputMode="decimal" value={l.cache} onChange={(e) => mudar(i, { cache: e.target.value })} style={{ width: 70 }} placeholder="opcional" /></td>
                <td><button type="button" className="bn-btn" aria-label={`Remover o preço ${i + 1}`} onClick={() => setLinhas((x) => x.filter((_, j) => j !== i))}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="bn-btn" onClick={() => setLinhas((l) => [...l, { provedor: "claude", modelo: "", entrada: "", saida: "", cache: "" }])}>Adicionar preço</button>
        {erro !== null && <p role="alert" className="bn-erro">{erro}</p>}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" onClick={() => void salvar()}>Salvar preços</button>
      </div>
    </Dialogo>
  );
}
