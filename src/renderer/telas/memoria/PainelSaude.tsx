import { useState } from "react";
import type { EscopoMemoria, EstadoMemoriaApp } from "../../../compartilhado/memoria";
import { ESCOPOS_MEMORIA } from "../../../compartilhado/memoria";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import type { StoreMemoria } from "../../estado/memoria";
import { pedirTela } from "../../estado/navegacao";
import { CartaoMemox } from "./CartaoMemox";
import { ROTULO_ESCOPO, agruparMetricas, confirmacaoConfere, formatarBytes, percentualTeto, textoRetencao, textoTeto } from "./logica";

export interface PropsSaude { store: StoreMemoria; estado: EstadoMemoriaApp | null; erro: string | null; nomeDoProjeto: string }

/** Painel de saúde: tamanho × teto, contagens, busca (FTS5), métricas (só números), exportar, limpar e o memox. */
export function PainelSaude({ store, estado, erro, nomeDoProjeto }: PropsSaude) {
  const [escopo, setEscopo] = useState<EscopoMemoria | "tudo">("tudo");
  const [apagar, setApagar] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  if (estado === null) return <section className="mem-secao mem-rolavel" aria-label="Saúde">{erro !== null ? <p role="alert" className="mem-erro">{erro}</p> : <p className="mem-vazio" role="status" aria-busy="true">Carregando…</p>}</section>;
  const c = estado.config;
  const pct = percentualTeto(estado.tamanho_bytes, c.teto_mb);
  const grupos = agruparMetricas(estado.metricas);
  const totalEscopo = escopo === "tudo" ? Object.values(estado.contagens).reduce((a, b) => a + b, 0) : estado.contagens[escopo] ?? 0;

  const confirmarApagar = async (): Promise<void> => {
    setOcupado(true);
    const r = await store.purgar(escopo, digitado);
    setOcupado(false);
    if (r === null) { setErroApagar("Não foi possível apagar: confira o nome digitado."); return; }
    setApagar(false); setDigitado(""); setErroApagar(null);
  };

  return (
    <section className="mem-secao mem-rolavel" aria-label="Saúde">
      <h2>Saúde da memória</h2>
      <div className="mem-grid-saude">
        <div className="mem-cartao">
          <strong>Tamanho</strong>
          <progress className="mem-progresso" max={100} value={pct} aria-label="Uso do teto de tamanho" {...(estado.aviso_teto ? { "data-aviso": "" } : {})} />
          <span>{textoTeto(estado.tamanho_bytes, c.teto_mb)}</span>
          {estado.aviso_teto ? <p role="status" className="mem-erro" style={{ color: "var(--aviso)" }}>Perto do teto: reduza a retenção, apague o que não precisa ou aumente o teto em Configurações.</p> : null}
        </div>
        <div className="mem-cartao">
          <strong>Entradas</strong>
          {ESCOPOS_MEMORIA.map((e) => <div key={e}>{ROTULO_ESCOPO[e]}: {estado.contagens[e] ?? 0}</div>)}
        </div>
        <div className="mem-cartao">
          <strong>Busca</strong>
          <span>{estado.fts5 ? "Índice FTS5 ativo" : "Modo simples (sem FTS5): funciona, só é mais lenta em bases grandes"}</span>
          <div>{c.embedding_modelo !== null ? `Semântica local: ${c.embedding_modelo}` : "Semântica: desligada"}</div>
        </div>
        <div className="mem-cartao">
          <strong>Política</strong>
          <div>Retenção: {textoRetencao(c.retencao_dias)}</div>
          <div>Brief: até {c.orcamento_brief_chars} caracteres</div>
          <div>{c.global_ativa ? (c.ativa ? "Coletando em Missões agênticas" : "Coleta desligada neste projeto") : "Memória desligada neste computador"}</div>
          <button type="button" className="mem-btn" onClick={() => pedirTela("config")}>Ajustes em Configurações</button>
        </div>
      </div>

      <h3>Métricas (só números, sem conteúdo)</h3>
      {grupos.length === 0 ? <p className="mem-nota">Sem métricas ainda: elas aparecem conforme a memória é usada.</p> : grupos.map((g) => (
        <div key={g.grupo}>
          <p className="mem-nota"><strong>{g.grupo}</strong></p>
          <div className="mem-metricas" role="list" aria-label={`Métricas de ${g.grupo}`}>
            {g.itens.flatMap((i) => [<span key={`${i.nome}-n`} role="listitem">{i.nome}</span>, <span key={`${i.nome}-v`} role="listitem">{i.valor}</span>])}
          </div>
        </div>
      ))}

      <h3>Exportar e limpar</h3>
      <div className="mem-linha-controles">
        <label htmlFor="mem-escopo-acao">Escopo</label>
        <select id="mem-escopo-acao" value={escopo} onChange={(e) => setEscopo(e.target.value as EscopoMemoria | "tudo")}>
          <option value="tudo">Tudo do projeto</option>
          {ESCOPOS_MEMORIA.filter((e) => e !== "usuario").map((e) => <option key={e} value={e}>{ROTULO_ESCOPO[e]}</option>)}
        </select>
        <button type="button" className="mem-btn" onClick={() => void store.exportar(escopo)}>Exportar…</button>
        <button type="button" className="mem-btn mem-perigo" disabled={totalEscopo === 0} onClick={() => { setApagar(true); setErroApagar(null); setDigitado(""); }}>Apagar…</button>
        <span className="mem-nota">{totalEscopo} {totalEscopo === 1 ? "entrada" : "entradas"} · {formatarBytes(estado.tamanho_bytes)} no total</span>
      </div>
      <p className="mem-nota">Exportar abre o diálogo de salvar do sistema: você escolhe o destino. O arquivo sai com segredos já mascarados.</p>

      <h3>Método</h3>
      <CartaoMemox memox={estado.memox} />

      {apagar ? (
        <DialogoConfirmacao titulo={escopo === "tudo" ? "Apagar a memória deste projeto?" : `Apagar a memória de ${ROTULO_ESCOPO[escopo]}?`} rotuloConfirmar="Apagar" perigoso ocupado={ocupado || !confirmacaoConfere(digitado, nomeDoProjeto)} aoCancelar={() => setApagar(false)} aoConfirmar={() => void confirmarApagar()}
          texto={(
            <>
              <p>Apaga {totalEscopo} {totalEscopo === 1 ? "entrada" : "entradas"} de <strong>{nomeDoProjeto}</strong>. Não dá para desfazer. Exporte antes se quiser guardar uma cópia.</p>
              <label htmlFor="mem-digitar-saude">Digite o nome do projeto para confirmar</label>
              <input id="mem-digitar-saude" className="mem-campo" value={digitado} autoComplete="off" onChange={(e) => setDigitado(e.target.value)} />
              {erroApagar !== null ? <p role="alert" className="mem-erro">{erroApagar}</p> : null}
            </>
          )} />
      ) : null}
    </section>
  );
}
