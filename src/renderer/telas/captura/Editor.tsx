// Editor de anotação (Fase 11, T-11.18): Canvas 2D sem dependência. Seta, caneta vermelha, retângulo, texto, desfazer/refazer. Autosave a cada 10 s SÓ se houver mudança; salva ao copiar o caminho,
// ao anexar e ao fechar. O original é preservado pelo main (`.orig`) na primeira gravação. Barra única de 28 px; atalhos: 1-4 ferramentas, ⌘/Ctrl+Z desfaz, ⇧⌘/Ctrl+Z refaz, Esc fecha.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ApiCaptura } from "../../../compartilhado/captura";
import { adicionar, desenhar, desfazer, historicoVazio, refazer, temMudanca, type Ctx2D, type Ferramenta, type Forma, type Historico, type Ponto } from "./anotacoes";
import { mensagemDeCaptura, paraDataUrl } from "./logica";

export const AUTOSAVE_MS = 10_000;
const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface Props {
  api: ApiCaptura;
  capturaId: string;
  workspaceId: string | null;
  /** Pane em foco (destino do anexo); `null` desabilita o botão. */
  paneEmFoco: string | null;
  aoFechar(): void;
  aoAvisar(mensagem: string): void;
  /** testes: carrega a imagem sem decodificar de verdade. */
  carregarImagem?: (src: string) => Promise<{ width: number; height: number; origem: CanvasImageSource }>;
}

const FERRAMENTAS: readonly { id: Ferramenta; rotulo: string; tecla: string }[] = [
  { id: "seta", rotulo: "Seta", tecla: "1" }, { id: "caneta", rotulo: "Caneta", tecla: "2" }, { id: "retangulo", rotulo: "Retângulo", tecla: "3" }, { id: "texto", rotulo: "Texto", tecla: "4" },
];

function carregarPadrao(src: string): Promise<{ width: number; height: number; origem: CanvasImageSource }> {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => ok({ width: img.naturalWidth, height: img.naturalHeight, origem: img });
    img.onerror = () => erro(new Error("imagem inválida"));
    img.src = src;
  });
}

export function Editor({ api, capturaId, workspaceId, paneEmFoco, aoFechar, aoAvisar, carregarImagem = carregarPadrao }: Props): ReactElement {
  const tela = useRef<HTMLCanvasElement>(null);
  const base = useRef<{ width: number; height: number; origem: CanvasImageSource } | null>(null);
  const [hist, setHist] = useState<Historico>(historicoVazio());
  const histRef = useRef(hist);
  histRef.current = hist;
  const [ferramenta, setFerramenta] = useState<Ferramenta>("seta");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunhoEstado] = useState<Forma | null>(null);
  const rascunhoRef = useRef<Forma | null>(null);
  const setRascunho = (f: Forma | null): void => { rascunhoRef.current = f; setRascunhoEstado(f); }; // ref: o ponteiro pode disparar várias vezes antes do próximo render
  const [texto, setTexto] = useState<{ em: Ponto; valor: string } | null>(null);
  const gravado = useRef(0); // quantas formas já estão no arquivo (autosave só com mudança)

  const pintar = useCallback((extra: Forma | null) => {
    const c = tela.current;
    const b = base.current;
    const ctx = c?.getContext("2d") as unknown as (Ctx2D & { drawImage(i: CanvasImageSource, x: number, y: number): void }) | null | undefined;
    if (c === null || c === undefined || b === null || ctx === null || ctx === undefined) return;
    ctx.drawImage(b.origem, 0, 0);
    desenhar(ctx, extra === null ? histRef.current.formas : [...histRef.current.formas, extra], 1);
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { bytes, tipo } = await api.ler(capturaId, workspaceId);
        const img = await carregarImagem(paraDataUrl(bytes, tipo));
        if (!vivo) return;
        base.current = img;
        const c = tela.current;
        if (c !== null) { c.width = img.width; c.height = img.height; }
        setCarregando(false);
      } catch (e) {
        if (vivo) { setErro(e instanceof Error ? mensagemDeCaptura("captura_inexistente", e.message.replace(/^\[[a-z_]+\] /, "")) : "Não foi possível abrir a captura."); setCarregando(false); }
      }
    })();
    return () => { vivo = false; };
  }, [api, capturaId, workspaceId, carregarImagem]);

  useEffect(() => { if (!carregando) pintar(rascunho); }, [carregando, hist, rascunho, pintar]);

  const salvar = useCallback(async (): Promise<boolean> => {
    const formas = histRef.current.formas;
    if (!temMudanca(histRef.current) || formas.length === gravado.current) return true; // sem mudança não regrava
    const c = tela.current;
    if (c === null) return true;
    pintar(null);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob((b) => ok(b), "image/png"));
    if (blob === null) { aoAvisar("Não foi possível gerar a imagem editada."); return false; }
    try {
      await api.salvarEdicao(capturaId, workspaceId, new Uint8Array(await blob.arrayBuffer()));
      gravado.current = formas.length;
      return true;
    } catch (e) {
      aoAvisar(e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "Não foi possível salvar a edição.");
      return false;
    }
  }, [api, aoAvisar, capturaId, pintar, workspaceId]);

  // autosave a cada 10 s só se houver mudança desde a última gravação
  useEffect(() => {
    const t = setInterval(() => { if (histRef.current.formas.length !== gravado.current) void salvar(); }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [salvar]);

  const fechar = useCallback(async () => { await salvar(); aoFechar(); }, [salvar, aoFechar]);

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (texto !== null) return;
      const mod = EH_MAC ? e.metaKey : e.ctrlKey;
      if (e.key === "Escape") { e.preventDefault(); void fechar(); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); setHist((h) => (e.shiftKey ? refazer(h) : desfazer(h))); return; }
      const f = FERRAMENTAS.find((x) => x.tecla === e.key);
      if (f !== undefined && !mod && !e.altKey) setFerramenta(f.id);
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [fechar, texto]);

  const ponto = (e: { clientX: number; clientY: number }): Ponto => {
    const c = tela.current;
    const r = c?.getBoundingClientRect();
    if (c === null || c === undefined || r === undefined || r.width === 0) return { x: e.clientX, y: e.clientY };
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };

  const confirmarTexto = (): void => {
    if (texto !== null) setHist((h) => adicionar(h, { tipo: "texto", em: texto.em, texto: texto.valor }));
    setTexto(null);
  };

  const anexar = async (): Promise<void> => {
    if (paneEmFoco === null) return;
    if (!(await salvar())) return;
    try { const r = await api.anexarAoPane(capturaId, workspaceId, paneEmFoco); aoAvisar(`Anexada: ${r.caminhos[0] ?? ""}`); } catch (e) { aoAvisar(e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "Não foi possível anexar."); }
  };
  const copiar = async (): Promise<void> => {
    if (!(await salvar())) return;
    try { await api.copiarCaminho(capturaId, workspaceId); aoAvisar("Caminho copiado."); } catch (e) { aoAvisar(e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "Não foi possível copiar."); }
  };

  return (
    <div className="dialogo-fundo cap-editor-fundo" role="presentation">
      <div className="cap-editor" role="dialog" aria-modal="true" aria-label="Editor de captura">
        <div className="cap-barra" role="toolbar" aria-label="Ferramentas de anotação">
          {FERRAMENTAS.map((f) => (
            <button key={f.id} type="button" className="cap-ferr" aria-pressed={ferramenta === f.id} title={`${f.rotulo} (${f.tecla})`} onClick={() => setFerramenta(f.id)}>{f.rotulo}</button>
          ))}
          <span className="cap-sep" aria-hidden="true" />
          <button type="button" className="cap-ferr" disabled={hist.formas.length === 0} onClick={() => setHist(desfazer)} title={`Desfazer (${EH_MAC ? "⌘Z" : "Ctrl+Z"})`}>Desfazer</button>
          <button type="button" className="cap-ferr" disabled={hist.refazer.length === 0} onClick={() => setHist(refazer)} title={`Refazer (${EH_MAC ? "⇧⌘Z" : "Ctrl+Shift+Z"})`}>Refazer</button>
          <span className="cap-sep" aria-hidden="true" />
          <button type="button" className="cap-ferr" disabled={paneEmFoco === null} title={paneEmFoco === null ? "Abra e foque um terminal para anexar" : "Anexar ao terminal em foco (sem Enter)"} onClick={() => void anexar()}>Anexar ao Pane</button>
          <button type="button" className="cap-ferr" onClick={() => void copiar()}>Copiar caminho</button>
          <button type="button" className="cap-ferr cap-fechar" onClick={() => void fechar()} aria-label="Fechar editor">Fechar</button>
        </div>
        <div className="cap-palco">
          {carregando ? <p role="status" className="cap-estado">Abrindo captura…</p> : null}
          {erro !== null ? <p role="alert" className="cap-estado cap-estado-erro">{erro}</p> : null}
          <canvas
            ref={tela}
            className="cap-canvas"
            aria-label="Imagem da captura. Use o mouse para anotar."
            hidden={carregando || erro !== null}
            onPointerDown={(e) => {
              if (e.button !== 0 || texto !== null) return;
              const p = ponto(e);
              if (ferramenta === "texto") { setTexto({ em: p, valor: "" }); return; }
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setRascunho(ferramenta === "caneta" ? { tipo: "caneta", pontos: [p] } : { tipo: ferramenta, de: p, para: p });
            }}
            onPointerMove={(e) => {
              const r = rascunhoRef.current;
              if (r === null) return;
              const p = ponto(e);
              setRascunho(r.tipo === "caneta" ? { ...r, pontos: [...r.pontos, p] } : r.tipo === "texto" ? r : { ...r, para: p });
            }}
            onPointerUp={() => { const r = rascunhoRef.current; if (r !== null) { setHist((h) => adicionar(h, r)); setRascunho(null); } }}
          />
          {texto !== null ? (
            <form className="cap-texto" onSubmit={(e) => { e.preventDefault(); confirmarTexto(); }}>
              <input autoFocus aria-label="Texto da anotação" maxLength={200} value={texto.valor} onChange={(e) => setTexto({ ...texto, valor: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setTexto(null); } }} />
              <button type="submit" className="cap-ferr">Adicionar</button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
