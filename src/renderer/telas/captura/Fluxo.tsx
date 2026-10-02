// Fluxo de captura (Fase 11): orquestra os pedidos (paleta, menu, atalho) -> avisos e permissões com diálogo próprio -> imagem congelada -> seleção -> editor/galeria. Lazy: só carrega no
// primeiro pedido. Permissão do SO só depois do diálogo explicativo; negada vira instrução clara (Ajustes do Sistema ou captura da janela do app, que não precisa de permissão).
import "./captura.css";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import type { ApiCaptura, ApiVoz, FonteCaptura, ResultadoRegiaoIniciar, RetanguloLogico } from "../../../compartilhado/captura";
import { ade } from "../../ade";
import type { PedidoCaptura } from "../../estado/captura-acoes";
import { assinarPaneEmFoco, paneEmFoco } from "../../estado/foco-pane";
import { storeWorkspaces } from "../../estado/workspaces";
import { Editor } from "./Editor";
import { mensagemDeCaptura, paraDataUrl } from "./logica";
import { Painel } from "./Painel";
import { SeletorRegiao } from "./SeletorRegiao";

interface Props {
  pedido: PedidoCaptura;
  /** muda a cada pedido (o mesmo pedido pode repetir). */
  serial: number;
  api?: ApiCaptura | undefined;
  voz?: ApiVoz | undefined;
  workspaceId?: () => string | null;
}

interface Dialogo { titulo: string; corpo: ReactNode; botoes: { rotulo: string; valor: string; primario?: boolean }[]; resolver(valor: string): void }
interface Congelada { token: string; src: string; largura: number; altura: number; fonte: FonteCaptura }

const TOAST_MS = 3_500;

export default function Fluxo({ pedido, serial, api = ade()?.captura, voz = ade()?.voz, workspaceId = () => storeWorkspaces.obter().atual?.id ?? null }: Props): ReactElement | null {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [congelada, setCongelada] = useState<Congelada | null>(null);
  const [painel, setPainel] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [versao, setVersao] = useState(0);
  const [gravando, setGravando] = useState(false);
  const pane = useSyncExternalStore(assinarPaneEmFoco, paneEmFoco, () => null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocupado = useRef(false);

  const avisar = useCallback((m: string) => {
    setToast(m);
    if (temporizador.current !== null) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setToast(""), TOAST_MS);
  }, []);
  useEffect(() => () => { if (temporizador.current !== null) clearTimeout(temporizador.current); }, []);

  const perguntar = useCallback((titulo: string, corpo: ReactNode, botoes: Dialogo["botoes"]): Promise<string> => new Promise((ok) => {
    setDialogo({ titulo, corpo, botoes, resolver: (v) => { setDialogo(null); ok(v); } });
  }), []);

  // eventos do main: lista de capturas muda; fim da gravação por quadros (limite, erro ou parada)
  useEffect(() => {
    if (api === undefined) return;
    return api.assinar((e) => {
      if (e.tipo === "mudou") setVersao((v) => v + 1);
      else if (e.tipo === "quadros_fim") {
        setGravando(false);
        avisar(e.motivo === "erro" ? mensagemDeCaptura("indisponivel", e.instrucao ?? undefined) : e.captura_id === null ? "Gravação encerrada sem quadros." : `Gravação de quadros salva${e.motivo === "limite" ? " (limite atingido)" : ""}.`);
      }
    });
  }, [api, avisar]);

  // Esc para a gravação por quadros
  useEffect(() => {
    if (!gravando || api === undefined) return;
    const k = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); void api.quadrosParar(); } };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [gravando, api]);

  /** aviso de primeira captura (fica local, pode conter segredos) e, para a tela, a permissão do SO; devolve a fonte a usar ou `null` se a pessoa desistiu. */
  const preparar = useCallback(async (a: ApiCaptura, fonte: FonteCaptura): Promise<FonteCaptura | null> => {
    const est = await a.estado();
    if (!est.aviso_visto) {
      const r = await perguntar("Antes da primeira captura", (
        <>
          <p>A imagem fica <b>só neste computador</b>, numa pasta ignorada pelo git. Nada é enviado pela internet.</p>
          <p>Ela pode conter dados sensíveis que estiverem na tela. Anexar ao terminal é sempre ação sua, e o app nunca apaga uma captura sozinho.</p>
        </>
      ), [{ rotulo: "Agora não", valor: "nao" }, { rotulo: "Entendi", valor: "sim", primario: true }]);
      if (r !== "sim") return null;
      await a.configGravar({ aviso_visto: true });
    }
    if (fonte !== "tela") return fonte;
    const abrirAjustes = async (): Promise<void> => { await voz?.abrirAjustes("tela"); };
    if (est.tela === "indeterminada" && est.plataforma === "mac") {
      const r = await perguntar("Permitir gravação de tela", (
        <>
          <p><b>O que será usado:</b> a Gravação de Tela do macOS, só quando você captura uma região.</p>
          <p><b>O que não acontece:</b> nenhum vídeo, nenhum envio, nenhuma gravação contínua. Só a imagem que você selecionar é salva, aqui.</p>
          <p><b>Como desfazer:</b> Ajustes do Sistema, Privacidade e Segurança, Gravação de Tela. Depois de conceder, reabra o app.</p>
        </>
      ), [{ rotulo: "Agora não", valor: "nao" }, { rotulo: "Continuar", valor: "sim", primario: true }]);
      if (r !== "sim") return null;
      const p = await a.pedirTela();
      if (p.estado !== "concedida") {
        const o = await perguntar("Reabra o app depois de conceder", <p>O macOS só aplica a permissão de Gravação de Tela depois que o app é reaberto. Enquanto isso, a captura da <b>janela do app</b> funciona sem permissão.</p>, [{ rotulo: "Fechar", valor: "fechar" }, { rotulo: "Abrir Ajustes do Sistema", valor: "ajustes", primario: true }]);
        if (o === "ajustes") await abrirAjustes();
        return null;
      }
      return fonte;
    }
    if (est.tela === "negada" || est.tela === "restrita") {
      const o = await perguntar("Gravação de tela sem permissão", (
        <p>{est.tela === "restrita" ? "A gravação de tela está restrita neste computador (política do sistema)." : "O app não tem permissão de Gravação de Tela."} Libere em Ajustes do Sistema, Privacidade e Segurança, Gravação de Tela, e <b>reabra o app</b>. A captura da janela do app não precisa dessa permissão.</p>
      ), [{ rotulo: "Fechar", valor: "fechar" }, { rotulo: "Capturar a janela do app", valor: "janela" }, { rotulo: "Abrir Ajustes do Sistema", valor: "ajustes", primario: true }]);
      if (o === "ajustes") await abrirAjustes();
      return o === "janela" ? "janela_app" : null;
    }
    return fonte;
  }, [perguntar, voz]);

  const executar = useCallback(async (a: ApiCaptura, p: PedidoCaptura): Promise<void> => {
    const ws = workspaceId();
    if (p === "galeria") { setPainel(true); return; }
    if (p === "quadros-parar") { const r = await a.quadrosParar(); if (r.captura_id === null) avisar(mensagemDeCaptura("nao_gravando")); return; }
    if (p === "janela") {
      if ((await preparar(a, "janela_app")) === null) return;
      const r = await a.janelaInteira(ws);
      if (r.ok) setEditando(r.captura_id); else avisar(mensagemDeCaptura(r.codigo, r.instrucao));
      return;
    }
    const fonteBase: FonteCaptura = p.endsWith("janela") ? "janela_app" : "tela";
    if (p.startsWith("quadros")) {
      if ((await a.estado()).gravando_quadros) { await a.quadrosParar(); return; } // o mesmo atalho para
      const fonte = await preparar(a, fonteBase);
      if (fonte === null) return;
      const est = await a.estado();
      const r = await a.quadrosIniciar(fonte, est.fps_padrao, ws);
      if (r.ok) { setGravando(true); avisar(`Gravando quadros a ${est.fps_padrao} fps. Esc ou o mesmo atalho para parar.`); } else avisar(mensagemDeCaptura(r.codigo, r.instrucao));
      return;
    }
    const fonte = await preparar(a, fonteBase);
    if (fonte === null) return;
    const r: ResultadoRegiaoIniciar = await a.regiaoIniciar(fonte);
    if (!r.ok) { avisar(mensagemDeCaptura(r.codigo, r.instrucao)); return; }
    setCongelada({ token: r.token, src: paraDataUrl(r.imagem, "jpeg"), largura: r.largura, altura: r.altura, fonte });
  }, [avisar, preparar, workspaceId]);

  // cada pedido novo (serial) roda uma vez, sem sobrepor outro em andamento
  const ultimo = useRef(-1);
  useEffect(() => {
    if (api === undefined || ultimo.current === serial) return;
    ultimo.current = serial;
    if (ocupado.current) return;
    ocupado.current = true;
    void executar(api, pedido).catch((e: unknown) => avisar(e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "Captura indisponível agora.")).finally(() => { ocupado.current = false; });
  }, [api, pedido, serial, executar, avisar]);

  const confirmar = useCallback(async (sel: RetanguloLogico) => {
    const c = congelada;
    setCongelada(null);
    if (c === null || api === undefined) return;
    const r = await api.regiaoConfirmar(c.token, sel, workspaceId()).catch((e: unknown) => ({ ok: false as const, codigo: "indisponivel" as const, instrucao: e instanceof Error ? e.message.replace(/^\[[a-z_]+\] /, "") : "" }));
    if (r.ok) setEditando(r.captura_id); else if (r.codigo !== "selecao_pequena") avisar(mensagemDeCaptura(r.codigo, r.instrucao));
  }, [api, avisar, congelada, workspaceId]);
  const cancelar = useCallback(() => {
    const c = congelada;
    setCongelada(null);
    if (c !== null) void api?.regiaoCancelar(c.token).catch(() => undefined); // libera a imagem congelada no main
  }, [api, congelada]);

  if (api === undefined) return null;
  return (
    <>
      {congelada !== null ? <SeletorRegiao src={congelada.src} largura={congelada.largura} altura={congelada.altura} aoConfirmar={(s) => void confirmar(s)} aoCancelar={cancelar} /> : null}
      {dialogo !== null ? (
        <div className="dialogo-fundo" role="presentation">
          <div className="dialogo cap-dialogo" role="dialog" aria-modal="true" aria-labelledby="cap-dialogo-titulo">
            <h2 className="dialogo-titulo" id="cap-dialogo-titulo">{dialogo.titulo}</h2>
            <div className="dialogo-corpo">{dialogo.corpo}</div>
            <div className="dialogo-acoes">
              {dialogo.botoes.map((b) => (
                <button key={b.valor} type="button" className={`terminais-botao${b.primario === true ? " terminais-botao-primario" : ""}`} autoFocus={b.primario === true} onClick={() => dialogo.resolver(b.valor)}>{b.rotulo}</button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {painel ? <Painel api={api} workspaceId={workspaceId()} paneEmFoco={pane} aoFechar={() => setPainel(false)} aoEditar={setEditando} aoAvisar={avisar} versao={versao} /> : null}
      {editando !== null ? <Editor api={api} capturaId={editando} workspaceId={workspaceId()} paneEmFoco={pane} aoFechar={() => { setEditando(null); setPainel(true); }} aoAvisar={avisar} /> : null}
      <span className="cap-toast" role="status" aria-live="polite">{toast}</span>
    </>
  );
}
