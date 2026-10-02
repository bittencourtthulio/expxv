import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ApiMapa, ConfiancaIpc, EntradaMapa, FluxoMapaIpc } from "../../../compartilhado/mapa";
import { VirtualLista } from "../../componentes/VirtualLista";
import { Carregando, FaixaErro } from "./comum";
import { ALTURA_NO, layoutFluxo, type FormaNo, type NoPosicionado } from "./layout-camadas";

interface PropsLista { itens: readonly EntradaMapa[]; selecionada: string | null; aoEscolher: (id: string) => void; rotulo?: string }

/** Lista de entradas (rotas, CLI, jobs…) com busca local; virtualizada. Serve às abas Entradas e Fluxo. */
export function ListaEntradas({ itens, selecionada, aoEscolher, rotulo = "Entradas do sistema" }: PropsLista) {
  const [q, setQ] = useState("");
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t === "" ? itens : itens.filter((e) => `${e.chave} ${e.caminho} ${e.subtipo} ${e.framework}`.toLowerCase().includes(t));
  }, [itens, q]);
  return (
    <div className="mp-lista-entradas">
      <input type="search" aria-label="Filtrar entradas" placeholder="Filtrar entradas" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtradas.length === 0 ? <p className="mp-vazio">{itens.length === 0 ? "Nenhuma entrada detectada neste projeto." : "Nada encontrado para o filtro."}</p> : (
        <VirtualLista
          itens={filtradas}
          alturaItem={38}
          rotulo={rotulo}
          chave={(e) => e.id}
          renderItem={(e) => (
            <button type="button" className="mp-item mp-item-dupla" aria-current={e.id === selecionada ? "true" : undefined} onClick={() => aoEscolher(e.id)}>
              <span><span className="mp-selo">{e.subtipo}</span> {e.chave}{e.confianca === "heuristica" ? <span className="mp-meta"> · heurística</span> : null}</span>
              <span className="mp-meta">{e.caminho}:{e.linha} · {e.framework}</span>
            </button>
          )}
        />
      )}
    </div>
  );
}

function Forma({ n, selecionado, aoClicar }: { n: NoPosicionado; selecionado: boolean; aoClicar: () => void }) {
  const props = { className: "mp-fl-forma", "data-forma": n.forma, "data-ciclo": n.em_ciclo ? "" : undefined, "data-tracejado": n.tracejado ? "" : undefined, "data-selecionado": selecionado ? "" : undefined, strokeDasharray: n.tracejado ? "4 3" : undefined };
  const { x, y, w, h } = n;
  const formas: Record<FormaNo, ReactElement> = {
    pilula: <rect {...props} x={x} y={y} width={w} height={h} rx={h / 2} />,
    retangulo: <rect {...props} x={x} y={y} width={w} height={h} rx={4} />,
    arquivo: <rect {...props} x={x} y={y} width={w} height={h} rx={2} />,
    cilindro: <path {...props} d={`M${x} ${y + 5}a${w / 2} 5 0 0 1 ${w} 0v${h - 10}a${w / 2} 5 0 0 1 -${w} 0Z`} />,
    hexagono: <polygon {...props} points={`${x + 10},${y} ${x + w - 10},${y} ${x + w},${y + h / 2} ${x + w - 10},${y + h} ${x + 10},${y + h} ${x},${y + h / 2}`} />,
  };
  return (
    <g role="button" tabIndex={0} aria-label={`${n.rotulo}${n.tracejado ? " (alcançado por heurística)" : ""}${n.em_ciclo ? " (em ciclo)" : ""}`} aria-pressed={selecionado} className="mp-fl-no" onClick={aoClicar} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoClicar(); } }}>
      {formas[n.forma]}
      <text className="mp-fl-texto" x={x + 8} y={y + ALTURA_NO / 2 + 4}>{n.rotulo.length > 22 ? `${n.rotulo.slice(0, 21)}…` : n.rotulo}</text>
      {n.tabelas.length > 0 && <text className="mp-fl-tab" x={x + 8} y={y + ALTURA_NO + 10}>{n.tabelas.map((t) => `▤ ${t}`).join("  ").slice(0, 28)}</text>}
    </g>
  );
}

interface Props { api: ApiMapa; ws: string; versao: number; entradaId: string | null; entradas: readonly EntradaMapa[]; minConfianca: ConfiancaIpc | null; aoEscolherEntrada: (id: string) => void; aoSelecionarNo: (id: string) => void; noSelecionado: string | null }

/** Fluxograma de uma entrada: árvore esquerda -> direita, até 300 nós, em SVG; tracejado = heurística. */
export function VisaoFluxo({ api, ws, versao, entradaId, entradas, minConfianca, aoEscolherEntrada, aoSelecionarNo, noSelecionado }: Props) {
  const [fluxo, setFluxo] = useState<FluxoMapaIpc | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [colapsados, setColapsados] = useState<ReadonlySet<string>>(new Set());
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (entradaId === null) { setFluxo(null); return; }
    let vivo = true;
    setFluxo(null);
    setErro(null);
    setColapsados(new Set());
    void api.fluxo(ws, entradaId, 6, minConfianca ?? undefined).then((f) => { if (vivo) setFluxo(f); }, (e: unknown) => { if (vivo) setErro(e); });
    return () => { vivo = false; };
  }, [api, ws, versao, entradaId, minConfianca, tentativa]);

  const layout = useMemo(() => (fluxo === null ? null : layoutFluxo(fluxo, colapsados)), [fluxo, colapsados]);
  const alternar = (id: string): void => setColapsados((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="mp-fluxo">
      <ListaEntradas itens={entradas} selecionada={entradaId} aoEscolher={aoEscolherEntrada} />
      <div className="mp-fluxo-area">
        {entradaId === null ? <p className="mp-vazio">Escolha uma entrada (rota, comando, job) para ver o fluxograma das chamadas até as tabelas.</p>
          : erro !== null ? <FaixaErro erro={erro} aoTentar={() => setTentativa((t) => t + 1)} />
          : fluxo === null || layout === null ? <Carregando texto="Calculando o fluxo…" />
          : (
            <>
              <div className="mp-grafo-info" role="status">
                <span>{layout.nos.length} nós · {fluxo.tabelas.length} tabelas · {fluxo.externos.length} externos{fluxo.truncado ? " · truncado (profundidade ou 300 nós)" : ""}{layout.ocultos > 0 ? ` · ${layout.ocultos} ocultos` : ""}</span>
                <span className="mp-legenda"><i className="mp-leg-tracejado" aria-hidden="true" /> heurística · pílula entrada · retângulo função · cilindro tabela · hexágono externo</span>
              </div>
              <div className="mp-fluxo-rolagem">
                <svg width={layout.largura + 20} height={layout.altura + 28} viewBox={`-10 -10 ${layout.largura + 20} ${layout.altura + 28}`} role="group" aria-label="Fluxograma da entrada">
                  {layout.arestas.map((a, i) => {
                    const mx = (a.x0 + a.x1) / 2;
                    return (
                      <g key={i} role="img" aria-label={`${a.tracejado ? "heurística: " : ""}${a.de} chama ${a.para}`}>
                        <path className="mp-fl-aresta" data-tracejado={a.tracejado ? "" : undefined} data-retorno={a.retorno ? "" : undefined} strokeDasharray={a.tracejado || a.retorno ? "4 3" : undefined} d={`M${a.x0} ${a.y0}C${mx} ${a.y0} ${mx} ${a.y1} ${a.x1} ${a.y1}`} fill="none" />
                      </g>
                    );
                  })}
                  {layout.nos.map((n) => (
                    <g key={n.id}>
                      <Forma n={n} selecionado={noSelecionado === n.id} aoClicar={() => aoSelecionarNo(n.id)} />
                      {n.filhos > 0 && (
                        <g role="button" tabIndex={0} aria-label={`${n.colapsado ? "Expandir" : "Recolher"} ${n.rotulo}`} className="mp-fl-toggle" onClick={() => alternar(n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(n.id); } }}>
                          <circle cx={n.x + n.w + 1} cy={n.y + n.h / 2} r={7} />
                          <text x={n.x + n.w + 1} y={n.y + n.h / 2 + 3.5} textAnchor="middle">{n.colapsado ? "+" : "−"}</text>
                        </g>
                      )}
                    </g>
                  ))}
                </svg>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
