import { useEffect, useRef, useState } from "react";
import type { AvaliacaoDestino, DestinoPai } from "../../../compartilhado/workspaces-adicionar";

/** Pasta de destino (pai): mostra o caminho mascarado (`~/…`), abre o seletor nativo e, se marcado, guarda como "pasta de projetos". */
export function CampoDestino({ destino, erro, aoEscolher, desabilitado = false, titulo = true }: { destino: DestinoPai | null; erro: string | null; aoEscolher: (lembrar: boolean) => void; desabilitado?: boolean; titulo?: boolean }) {
  const [lembrar, setLembrar] = useState(false);
  return (
    <div className="aw-bloco">
      {titulo ? <h4 id="aw-destino-rotulo">Pasta de destino</h4> : null}
      <div className="aw-destino" role="group" {...(titulo ? { "aria-labelledby": "aw-destino-rotulo" } : { "aria-label": "Pasta de destino" })}>
        <span className="aw-destino-caminho" title={destino?.exibicao ?? ""}>{destino?.exibicao ?? "Carregando…"}</span>
        <button type="button" className="botao" disabled={desabilitado || destino === null} onClick={() => aoEscolher(lembrar)}>Escolher pasta…</button>
      </div>
      <label className="aw-marca">
        <input type="checkbox" checked={lembrar} disabled={desabilitado} onChange={(e) => setLembrar(e.target.checked)} />
        <span>Usar como minha pasta de projetos<small>Fica sugerida da próxima vez. Vale a partir da próxima escolha.</small></span>
      </label>
      {erro !== null ? <p role="alert" className="campo-erro">{erro}</p> : null}
    </div>
  );
}

/** Situação do nome escolhido dentro do destino: livre, vazio, ocupado (sugestão / abrir a existente) ou inválido. */
export function AvisoDestino({ a, nome, aoUsarSugestao, aoAbrirExistente }: { a: AvaliacaoDestino | null; nome: string; aoUsarSugestao: () => void; aoAbrirExistente: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ocupado = a?.situacao === "ocupado";
  // o aviso de colisão aparece onde o dono está olhando: se estiver atrás do rodapé fixo, rola até ele
  useEffect(() => { if (ocupado) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [ocupado, a?.caminho_exibicao]);
  if (a === null || nome.trim() === "") return null;
  if (a.situacao === "ocupado") {
    return (
      <div ref={ref} className="aw-aviso" role="alert">
        <p><strong>{a.caminho_exibicao}</strong> já existe e não está vazia. Nada será sobrescrito.</p>
        <div className="aw-acoes">
          {a.sugestao !== null ? <button type="button" className="botao" onClick={aoUsarSugestao}>Usar “{a.sugestao}”</button> : null}
          <button type="button" className="botao" onClick={aoAbrirExistente}>{a.ja_workspace ? "Abrir a existente (já é workspace)" : "Abrir a existente"}</button>
        </div>
      </div>
    );
  }
  if (!a.ok) return <p role="alert" className="campo-erro">{a.motivo ?? "Destino inválido."}</p>;
  return <p className="aw-nota">{a.situacao === "vazio" ? "A pasta já existe e está vazia; será usada: " : "Será criada em "}<span className="aw-mono">{a.caminho_exibicao}</span></p>;
}
