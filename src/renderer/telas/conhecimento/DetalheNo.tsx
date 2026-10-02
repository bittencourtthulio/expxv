import { useState } from "react";
import type { DetalheNoGrafo } from "../../../compartilhado/conhecimento-api";
import { Badge } from "../../componentes/Badge";
import { Icone } from "../../componentes/Icone";
import { corDoTipo, linhaDeFonte, rotuloDoTipo } from "./logica";

export interface PropsDetalheNo {
  detalhe: DetalheNoGrafo | null;
  carregando: boolean;
  recolhido: boolean;
  aoAlternar: () => void;
  aoFechar: () => void;
  aoSelecionar: (id: string) => void;
  aoFocar: (id: string) => void;
  aoVerTrechos: (documentoId: string) => Promise<Array<{ id: string; trecho: string }> | null>;
  aoAbrirTela: (tela: "metodo" | "missoes") => void;
}

const TOM_ESTADO = { ativo: "sucesso", candidato: "aviso", arquivado: "neutro", rejeitado: "alerta" } as const;

/** Painel lateral de 320 px (recolhível). Todo texto vindo do índice é renderizado COMO texto. */
export function DetalheNo({ detalhe, carregando, recolhido, aoAlternar, aoFechar, aoSelecionar, aoFocar, aoVerTrechos, aoAbrirTela }: PropsDetalheNo) {
  const [trechos, setTrechos] = useState<Record<string, Array<{ id: string; trecho: string }> | "erro" | "carregando">>({});
  if (recolhido) {
    return (
      <aside className="con-detalhe" data-recolhido="true" aria-label="Detalhe do nó (recolhido)">
        <button type="button" className="con-icone-btn" aria-label="Expandir detalhe" title="Expandir detalhe" onClick={aoAlternar}><Icone nome="expandir" /></button>
      </aside>
    );
  }
  const abrir = async (id: string): Promise<void> => {
    setTrechos((t) => ({ ...t, [id]: "carregando" }));
    const r = await aoVerTrechos(id);
    setTrechos((t) => ({ ...t, [id]: r ?? "erro" }));
  };
  const n = detalhe?.no;
  return (
    <aside className="con-detalhe" aria-label="Detalhe do nó" aria-busy={carregando}>
      <div className="con-acoes-linha">
        <button type="button" className="con-icone-btn" aria-label="Recolher detalhe" title="Recolher detalhe" onClick={aoAlternar}><Icone nome="menos" /></button>
        <button type="button" className="con-icone-btn" aria-label="Fechar detalhe" title="Fechar detalhe (Esc)" onClick={aoFechar}><Icone nome="fechar" /></button>
      </div>
      {carregando && detalhe === null ? <p role="status">Carregando nó…</p> : null}
      {n === undefined || detalhe === null ? (carregando ? null : <p className="meta">Selecione um nó no grafo ou na lista para ver as fontes, os aprendizados e os vizinhos.</p>) : (
        <>
          <h2><span className="con-ponto" style={{ background: corDoTipo(n.tipo) }} aria-hidden="true" /> {n.rotulo}</h2>
          <p className="meta">{rotuloDoTipo(n.tipo)} · último uso {n.ultimo_em.slice(0, 10)}{n.mission_id !== null ? ` · missão ${n.mission_id}` : ""}</p>
          <div className="con-acoes-linha">
            <button type="button" className="con-mini" onClick={() => aoFocar(n.id)}>Focar vizinhança</button>
            {n.tipo === "task" || n.tipo === "ocorrencia" ? <button type="button" className="con-mini" onClick={() => aoAbrirTela("metodo")}>Ver no Método</button> : null}
            {n.tipo === "missao" ? <button type="button" className="con-mini" onClick={() => aoAbrirTela("missoes")}>Abrir Missões</button> : null}
          </div>
          <h3>Fontes</h3>
          {detalhe.fontes.length === 0 ? <p className="meta">Sem fonte indexada para este nó.</p> : (
            <ul>
              {detalhe.fontes.map((f) => {
                const t = trechos[f.documento_id];
                return (
                  <li key={f.documento_id}>
                    <strong>{f.titulo}</strong>
                    <div className="meta">{linhaDeFonte(f)}</div>
                    {t === undefined ? <button type="button" className="con-link" onClick={() => void abrir(f.documento_id)}>Ver trechos</button> : null}
                    {t === "carregando" ? <span role="status"> carregando…</span> : null}
                    {t === "erro" ? <span className="con-erro"> não foi possível ler os trechos</span> : null}
                    {Array.isArray(t) ? (t.length === 0 ? <div className="meta">Sem trechos.</div> : t.map((c) => <pre key={c.id} className="con-trecho">{c.trecho}</pre>)) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <h3>Aprendizados ligados</h3>
          {detalhe.aprendizados.length === 0 ? <p className="meta">Nenhum.</p> : (
            <ul>{detalhe.aprendizados.map((a) => <li key={a.id}><Badge tom={TOM_ESTADO[a.estado]}>{a.estado}</Badge> {a.titulo} <span className="meta">({a.tipo})</span></li>)}</ul>
          )}
          <h3>Vizinhos</h3>
          {detalhe.vizinhos.length === 0 ? <p className="meta">Sem vizinhos.</p> : (
            <ul>{detalhe.vizinhos.map((v) => <li key={v.id}><button type="button" className="con-link" onClick={() => aoSelecionar(v.id)}><span className="con-ponto" style={{ background: corDoTipo(v.tipo) }} aria-hidden="true" /> {v.rotulo}</button> <span className="meta">{rotuloDoTipo(v.tipo)}</span></li>)}</ul>
          )}
        </>
      )}
    </aside>
  );
}
