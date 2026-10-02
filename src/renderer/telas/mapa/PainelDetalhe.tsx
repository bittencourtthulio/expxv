import { useEffect, useState } from "react";
import type { ApiMapa, NoDetalheMapa, RaioMapaIpc } from "../../../compartilhado/mapa";
import { BotaoCopiar, FaixaErro } from "./comum";
import { evidenciaCopiavel, formatarNumero } from "./logica";

interface Props {
  api: ApiMapa;
  ws: string;
  noId: string | null;
  versao: number;
  aberto: boolean;
  aoAlternar: () => void;
  aoSelecionar: (id: string) => void;
  /** Informa ao pai o arquivo sob análise (o Método ▾ usa na ação legadox_raio). */
  aoArquivo: (caminho: string | null) => void;
}

const n = (v: number | null, vazio = "desconhecido"): string => (v === null ? vazio : formatarNumero(v));

export function PainelDetalhe({ api, ws, noId, versao, aberto, aoAlternar, aoSelecionar, aoArquivo }: Props) {
  const [detalhe, setDetalhe] = useState<NoDetalheMapa | null>(null);
  const [raio, setRaio] = useState<RaioMapaIpc | null>(null);
  const [erro, setErro] = useState<unknown>(null);

  useEffect(() => {
    setDetalhe(null);
    setRaio(null);
    setErro(null);
    aoArquivo(null);
    if (noId === null || !aberto) return;
    let vivo = true;
    void api.no(ws, noId).then((d) => {
      if (!vivo) return;
      setDetalhe(d);
      const caminho = d?.caminho ?? null;
      if (d !== null && caminho !== null && d.tipo === "arquivo") {
        aoArquivo(caminho);
        void api.raio(ws, [caminho]).then((r) => { if (vivo) setRaio(r); }, (e: unknown) => { if (vivo) setErro(e); });
      }
    }, (e: unknown) => { if (vivo) setErro(e); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ws, noId, versao, aberto]);

  const a = detalhe?.arquivo ?? null;
  return (
    <aside className="mp-painel" data-aberto={aberto ? "" : undefined} aria-label="Detalhes do nó selecionado">
      <button type="button" className="mp-painel-alternar" aria-expanded={aberto} aria-label={aberto ? "Recolher detalhes" : "Abrir detalhes"} onClick={aoAlternar}>{aberto ? "›" : "‹"}</button>
      {aberto && (
        <div className="mp-painel-corpo">
          {noId === null ? <p className="mp-vazio">Selecione um arquivo ou símbolo no grafo, numa lista ou na busca.</p>
            : erro !== null ? <FaixaErro erro={erro} />
            : detalhe === null ? <p className="mp-vazio" role="status">Carregando detalhes…</p>
            : (
              <>
                <h3 className="mp-painel-titulo" title={detalhe.rotulo}>{detalhe.rotulo}</h3>
                {detalhe.caminho !== null && (
                  <p className="mp-meta"><code>{evidenciaCopiavel(detalhe.caminho, detalhe.linha_ini)}</code> <BotaoCopiar texto={evidenciaCopiavel(detalhe.caminho, detalhe.linha_ini)} rotulo="Copiar caminho e linha" /></p>
                )}
                {a !== null && (
                  <dl className="mp-dl">
                    <dt>Linguagem</dt><dd>{a.linguagem}{a.degradado ? " (modo degradado)" : ""}</dd>
                    <dt>Linhas</dt><dd>{n(a.loc)} ({n(a.loc_codigo)} de código)</dd>
                    <dt>Complexidade</dt><dd>máx. {n(a.complexidade_max)} · total {n(a.complexidade_total)}</dd>
                    <dt>Alterações</dt><dd>{n(a.churn_janela)} na janela · {n(a.churn_total)} no total</dd>
                    <dt>Autores</dt><dd>{n(a.autores_n)}</dd>
                    <dt>Teste</dt><dd>{a.e_teste ? "é um arquivo de teste" : a.cobertura_estado === null ? "desconhecido" : a.cobertura_estado}</dd>
                    <dt>Camada</dt><dd>{n(a.camada, "não inferida")}{a.ciclo_id !== null ? ` · ciclo ${a.ciclo_id}` : ""}</dd>
                  </dl>
                )}
                {detalhe.atributos !== null && typeof detalhe.atributos["a"] === "string" && <p className="mp-meta">Assinatura: <code>{detalhe.atributos["a"]}</code></p>}
                <h4>Chamadores ({detalhe.chamadores_total})</h4>
                {detalhe.chamadores.length === 0 ? <p className="mp-meta">Nenhum chamador encontrado.</p> : (
                  <ul className="mp-ev">{detalhe.chamadores.map((v) => (
                    <li key={`${v.id}${v.aresta}`}>
                      <button type="button" className="mp-link" onClick={() => aoSelecionar(v.id)}>{v.rotulo}</button> <span className="mp-meta">{v.aresta}{v.confianca === "heuristica" ? " · heurística" : ""}</span>
                      {v.evidencia !== null && <> <code>{v.evidencia}</code> <BotaoCopiar texto={v.evidencia} rotulo={`Copiar evidência ${v.evidencia}`} /></>}
                    </li>))}</ul>
                )}
                {detalhe.chamados_total > 0 && <p className="mp-meta">{detalhe.chamados_total} dependências diretas.</p>}
                {raio !== null && (
                  <section aria-label="Raio de impacto provisório" className="mp-raio">
                    <h4>Raio de impacto <span className="mp-selo" data-tom="aviso">provisório</span></h4>
                    <p>
                      Faixa <strong data-faixa={raio.faixa}>{raio.faixa}</strong> <span className="mp-selo" data-tom="aviso">provisório</span>
                      {raio.faixa_pior_caso !== raio.faixa && <span className="mp-meta"> · no pior caso {raio.faixa_pior_caso}</span>}
                    </p>
                    <ul className="mp-ev">{raio.sinais.map((s) => <li key={s.id}>{s.nome}: {s.valor}{s.pior_caso ? " (pior caso)" : ""} <span className="mp-meta">{s.metodo}</span></li>)}</ul>
                    {raio.pior_caso.length > 0 && <p className="mp-meta">Pior caso assumido: {raio.pior_caso.map((p) => p.motivo).join("; ")}.</p>}
                    <p className="mp-meta">{raio.nota}</p>
                  </section>
                )}
              </>
            )}
        </div>
      )}
    </aside>
  );
}
