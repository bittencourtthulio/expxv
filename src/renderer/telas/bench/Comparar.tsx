import { useEffect, useState } from "react";
import type { ApiBench, Comparacao, RascunhoPolitica } from "../../../compartilhado/bench";
import type { ApiAde } from "../../../compartilhado/ipc";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { avisar } from "../../estado/avisos";
import { SELO_TEXTO, barrasDeComposite, custoTexto, duracaoTexto, notaTexto, placarTexto, politicaDoRascunho, scoreTexto, textoExecutor } from "./logica";

export type PortaHarness = Pick<ApiAde["harness"], "gravarPolitica">;

/** Gráfico próprio em SVG (sem biblioteca): barras horizontais do score médio por alvo. Tem título, descrição e tabela equivalente logo abaixo. */
export function GraficoScore({ c }: { c: Comparacao }) {
  const barras = barrasDeComposite(c.agregado, 220);
  const altura = barras.length * 22 + 6;
  return (
    <svg role="img" aria-labelledby="bn-svg-t bn-svg-d" viewBox={`0 0 420 ${altura}`} className="bn-svg" width="100%" height={altura} preserveAspectRatio="xMinYMin meet">
      <title id="bn-svg-t">Score médio por alvo</title>
      <desc id="bn-svg-d">{barras.map((b) => `${b.alvo}: ${scoreTexto(b.valor)}`).join("; ")}</desc>
      {barras.map((b, i) => (
        <g key={b.alvo} transform={`translate(0 ${i * 22 + 3})`}>
          <text x="0" y="12" className="bn-svg-rotulo">{b.alvo.length > 26 ? `${b.alvo.slice(0, 25)}…` : b.alvo}</text>
          <rect x="150" y="2" width={Math.max(0, b.largura)} height="14" rx="2" className="bn-svg-barra" data-vazio={b.valor === null || undefined} />
          <text x={156 + Math.max(0, b.largura)} y="13" className="bn-svg-valor">{scoreTexto(b.valor)}{b.vitorias > 0 ? ` · ${b.vitorias} vitória(s)` : ""}</text>
        </g>
      ))}
    </svg>
  );
}

export function SugestaoHarness({ api, harness, copiar }: { api: ApiBench; harness: PortaHarness | undefined; copiar: (t: string) => Promise<void> }) {
  const [dados, setDados] = useState<{ rascunho: RascunhoPolitica[]; avisos: string[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicar, setAplicar] = useState<RascunhoPolitica | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const gerar = async (): Promise<void> => {
    setErro(null);
    try { setDados(await api.exportarPolitica(null)); } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao gerar a sugestão."); }
  };
  const confirmar = async (): Promise<void> => {
    if (aplicar === null || harness === undefined) return;
    setOcupado(true);
    try {
      await harness.gravarPolitica(politicaDoRascunho(aplicar));
      avisar(`Política do harness para "${aplicar.task_type}" atualizada.`, "sucesso");
      setAplicar(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "O harness recusou a política."); setAplicar(null); } finally { setOcupado(false); }
  };
  return (
    <section className="bn-sugestao" aria-label="Sugestão para o harness">
      <h4>Sugestão para o harness (opcional)</h4>
      <p className="bn-meta">O Bench só SUGERE: nada muda no harness sozinho. Você revisa, aplica com confirmação ou copia o JSON.</p>
      <button type="button" className="bn-btn" onClick={() => void gerar()}>Gerar sugestão</button>
      {erro !== null && <p role="alert" className="bn-erro">{erro}</p>}
      {dados !== null && (
        <>
          {dados.rascunho.length === 0 && <p className="bn-meta">Sem sugestão: ainda não há dados suficientes por atividade.</p>}
          <ul className="bn-lista-sug">
            {dados.rascunho.map((r) => (
              <li key={r.task_type}>
                <strong>{r.task_type}</strong> ← {textoExecutor(r.executor)}{r.alternativas.length > 0 ? ` (alternativas: ${r.alternativas.map(textoExecutor).join(", ")})` : ""} <span className="bn-meta">atividade “{r.atividade}”, {r.evidencia.length} resultado(s)</span>
                <span className="bn-acoes-linha">
                  {harness !== undefined && <button type="button" className="bn-btn" onClick={() => setAplicar(r)}>Aplicar ao Harness…</button>}
                  <button type="button" className="bn-btn" onClick={() => void copiar(JSON.stringify(politicaDoRascunho(r), null, 2)).then(() => avisar("JSON copiado.", "info"))}>Copiar JSON</button>
                </span>
              </li>
            ))}
          </ul>
          {dados.avisos.length > 0 && <ul className="bn-avisos">{dados.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </>
      )}
      {aplicar !== null && (
        <DialogoConfirmacao titulo="Aplicar ao Harness" rotuloConfirmar="Aplicar política" ocupado={ocupado} aoCancelar={() => setAplicar(null)} aoConfirmar={() => void confirmar()}
          texto={<><p>Isto grava a política <strong>global</strong> do harness para <strong>{aplicar.task_type}</strong> com o executor <strong>{textoExecutor(aplicar.executor)}</strong>, substituindo a atual.</p><p className="bn-meta">Você pode restaurar a semente da política na tela Harness.</p></>} />
      )}
    </section>
  );
}

export function Comparar({ api, alvos, tarefas, harness, copiar, pedido }: { api: ApiBench; alvos: string[]; tarefas: string[] | null; harness: PortaHarness | undefined; copiar: (t: string) => Promise<void>; pedido: number }) {
  const [agrupar, setAgrupar] = useState<"tarefa" | "atividade">("tarefa");
  const [c, setC] = useState<Comparacao | { erro: "nao_comparavel" } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  useEffect(() => {
    if (alvos.length < 2) { setC(null); return; }
    let vivo = true;
    setCarregando(true); setErro(null);
    void api.comparar(alvos, tarefas, agrupar).then((x) => { if (vivo) setC(x); }, (e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : "Falha ao comparar."); }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [api, alvos, tarefas, agrupar, pedido]);

  if (alvos.length < 2) return <p className="bn-vazio" role="status">Escolha ao menos 2 alvos em “Alvos” para comparar.</p>;
  if (carregando && c === null) return <p className="bn-vazio" role="status">Comparando…</p>;
  if (erro !== null) return <p role="alert" className="bn-erro">{erro}</p>;
  if (c === null) return null;
  if ("erro" in c) return <p className="bn-vazio" role="status">Não comparável: não há tarefa com resultado de todos os alvos na mesma versão. Rode a bateria para os alvos que faltam (só eles rodam).</p>;
  return (
    <div className="bn-comparar">
      <div className="bn-cab-cmp">
        <p className="bn-veredito"><strong>Veredito:</strong> {c.veredito}</p>
        <p className="bn-meta">Placar: {placarTexto(c)}</p>
        <p className="bn-selos">{c.selos.map((s) => <span key={s} className="bn-selo">{SELO_TEXTO[s]}</span>)}</p>
        <label className="bn-campo bn-campo-linha">Agrupar por
          <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as "tarefa" | "atividade")}><option value="tarefa">tarefa</option><option value="atividade">atividade</option></select>
        </label>
      </div>
      <GraficoScore c={c} />
      <table className="bn-tabela" aria-label="Comparação por tarefa">
        <thead>
          <tr><th scope="col">{agrupar === "tarefa" ? "Tarefa" : "Atividade"}</th>{c.alvos.map((a) => <th key={a} scope="col">{a}</th>)}</tr>
        </thead>
        <tbody>
          {c.linhas.map((l) => (
            <tr key={`${l.tarefa}-${l.versao}`}>
              <th scope="row">{l.tarefa}{l.versao > 0 ? <span className="bn-meta"> v{l.versao}</span> : null}</th>
              {l.celulas.map((x) => (
                <td key={x.alvo} data-vencedor={x.vencedor || undefined}>
                  {x.resultado_id === null && x.composite === null && x.qualidade === null ? "—" : (
                    <>
                      <div>{x.vencedor ? <strong>venceu · </strong> : null}score {scoreTexto(x.composite)}</div>
                      <div className="bn-meta">nota {notaTexto(x.qualidade)} · {custoTexto(x.custo_usd)} · {duracaoTexto(x.duracao_s)}{x.tokens_out === null ? "" : ` · ${Math.round(x.tokens_out)} tok saída`}</div>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th scope="row">Média</th>{c.agregado.map((a) => <td key={a.alvo}>score {scoreTexto(a.composite_medio)} · {custoTexto(a.custo_total_usd)} · {duracaoTexto(a.duracao_media_s)}</td>)}</tr>
        </tfoot>
      </table>
      <SugestaoHarness api={api} harness={harness} copiar={copiar} />
    </div>
  );
}
