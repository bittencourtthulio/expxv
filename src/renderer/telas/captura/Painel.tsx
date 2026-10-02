// Galeria compacta de capturas (Fase 11, T-11.18/T-11.20): miniaturas de 64 px carregadas só quando visíveis, paginação por cursor, anexar ao Pane (sem Enter), copiar caminho, inserir o prompt de
// quadros e remover (lixeira do sistema, com confirmação inline). Estados vazio, carregando e erro dizem o próximo passo. Nada é apagado sem clique.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ApiCaptura, ItemCaptura } from "../../../compartilhado/captura";
import { paraDataUrl, rotuloDaCaptura } from "./logica";

interface Props {
  api: ApiCaptura;
  workspaceId: string | null;
  paneEmFoco: string | null;
  aoFechar(): void;
  aoEditar(id: string): void;
  aoAvisar(mensagem: string): void;
  /** muda quando há captura criada/editada/removida (recarrega a lista). */
  versao: number;
}

const limpar = (e: unknown, padrao: string): string => (e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : padrao);

function Miniatura({ api, item, workspaceId }: { api: ApiCaptura; item: ItemCaptura; workspaceId: string | null }): ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const no = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (item.tipo !== "imagem") return;
    let vivo = true;
    const carregar = (): void => {
      void api.ler(item.id, workspaceId).then((r) => { if (vivo) setSrc(paraDataUrl(r.bytes, r.tipo)); }).catch(() => undefined);
    };
    if (typeof IntersectionObserver === "undefined" || no.current === null) { carregar(); return () => { vivo = false; }; }
    const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { obs.disconnect(); carregar(); } });
    obs.observe(no.current);
    return () => { vivo = false; obs.disconnect(); };
  }, [api, item.id, item.tipo, workspaceId]);
  return (
    <span ref={no} className="cap-mini" aria-hidden="true">
      {src !== null ? <img src={src} alt="" width={64} height={40} /> : <i>{item.tipo === "quadros" ? "▦" : ""}</i>}
    </span>
  );
}

export function Painel({ api, workspaceId, paneEmFoco, aoFechar, aoEditar, aoAvisar, versao }: Props): ReactElement {
  const [itens, setItens] = useState<ItemCaptura[] | null>(null);
  const [proximo, setProximo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const carregar = useCallback(async (depois: string | null) => {
    try {
      const p = await api.listar(workspaceId, depois);
      setItens((atual) => (depois === null ? p.itens : [...(atual ?? []), ...p.itens]));
      setProximo(p.proximo);
      setErro(null);
    } catch (e) {
      setErro(limpar(e, "Não foi possível listar as capturas."));
      setItens((a) => a ?? []);
    }
  }, [api, workspaceId]);
  useEffect(() => { void carregar(null); }, [carregar, versao]);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [aoFechar]);

  const anexar = async (i: ItemCaptura): Promise<void> => {
    if (paneEmFoco === null) return;
    try {
      const r = i.tipo === "quadros" ? await api.anexarQuadrosAoPane(i.id, workspaceId, paneEmFoco) : await api.anexarAoPane(i.id, workspaceId, paneEmFoco);
      aoAvisar(`Escrito no terminal: ${r.caminhos[0] ?? ""}`);
    } catch (e) { aoAvisar(limpar(e, "Não foi possível anexar.")); }
  };
  const copiar = async (i: ItemCaptura): Promise<void> => {
    try { await api.copiarCaminho(i.id, workspaceId); aoAvisar("Caminho copiado."); } catch (e) { aoAvisar(limpar(e, "Não foi possível copiar.")); }
  };
  const remover = async (i: ItemCaptura): Promise<void> => {
    setRemovendo(null);
    try { await api.remover(i.id, workspaceId); setItens((a) => (a ?? []).filter((x) => x.id !== i.id)); aoAvisar("Enviada para a lixeira do sistema."); } catch (e) { aoAvisar(limpar(e, "Não foi possível remover.")); }
  };

  return (
    <aside className="cap-painel" aria-label="Capturas">
      <header className="cap-painel-topo">
        <h2>Capturas</h2>
        <button type="button" className="cap-ferr" onClick={aoFechar} aria-label="Fechar capturas">Fechar</button>
      </header>
      <p className="cap-aviso">Ficam só neste computador e podem conter segredos. Anexar ao terminal é ação sua.</p>
      {itens === null ? <p role="status" className="cap-estado">Carregando…</p> : null}
      {erro !== null ? <p role="alert" className="cap-estado cap-estado-erro">{erro}</p> : null}
      {itens !== null && itens.length === 0 && erro === null ? <p className="cap-estado">Nenhuma captura ainda. Use a paleta (⌘K) e escolha “Capturar região da tela”.</p> : null}
      <ul className="cap-lista">
        {(itens ?? []).map((i) => (
          <li key={i.id} className="cap-item">
            <Miniatura api={api} item={i} workspaceId={workspaceId} />
            <span className="cap-info">
              <b>{rotuloDaCaptura(i.id)}</b>
              <small>{i.tipo === "quadros" ? `${i.quadros ?? 0} quadros · ${i.fps ?? "?"} fps` : `${i.largura ?? "?"}x${i.altura ?? "?"}${i.anotada ? " · anotada" : ""}`}</small>
            </span>
            <span className="cap-acoes">
              {i.tipo === "imagem" ? <button type="button" className="cap-ferr" onClick={() => aoEditar(i.id)}>Editar</button> : null}
              <button type="button" className="cap-ferr" disabled={paneEmFoco === null} title={paneEmFoco === null ? "Abra e foque um terminal" : "Escrever no terminal em foco (sem Enter)"} onClick={() => void anexar(i)}>{i.tipo === "quadros" ? "Inserir prompt" : "Anexar"}</button>
              <button type="button" className="cap-ferr" onClick={() => void copiar(i)}>Copiar caminho</button>
              {removendo === i.id ? (
                <>
                  <button type="button" className="cap-ferr cap-perigo" onClick={() => void remover(i)}>Confirmar</button>
                  <button type="button" className="cap-ferr" onClick={() => setRemovendo(null)}>Não</button>
                </>
              ) : <button type="button" className="cap-ferr" aria-label={`Remover captura ${rotuloDaCaptura(i.id)}`} onClick={() => setRemovendo(i.id)}>Remover</button>}
            </span>
          </li>
        ))}
      </ul>
      {proximo !== null ? <button type="button" className="cap-ferr cap-mais" onClick={() => void carregar(proximo)}>Carregar mais</button> : null}
    </aside>
  );
}
