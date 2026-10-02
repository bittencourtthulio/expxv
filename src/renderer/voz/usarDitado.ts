// Hook do ditado (Fase 11, T-11.11/T-11.13): segurar-para-falar DENTRO do app (keydown/keyup do documento, interceptado ANTES do xterm; `repeat` ignorado), alternar pelo botão ou pelo
// atalho global, cancelar com Esc/blur/troca de Pane/pagehide. O microfone só existe entre `iniciar` e `parar`/`cancelar` (P-49). Tudo passa pela API tipada `window.ade.voz`.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiVoz, DisparoVoz, EstadoVoz, EventoVozIpc } from "../../compartilhado/captura";
import { ade } from "../ade";
import { abrirCaptura, ErroAudio, type OpcoesCaptura, type SessaoAudio } from "./capturaAudio";
import { ehAtalho, levaAConfiguracao, mensagemDeErro, pertenceAoAtalho, type EstadoBotao } from "./logica";

export interface OpcoesDitado {
  /** Pane em foco (o main revalida). `null` = nenhum terminal. */
  sessaoId: string | null;
  api?: ApiVoz | undefined;
  abrir?: (op: OpcoesCaptura) => Promise<SessaoAudio>;
  mac?: boolean;
  /** abre Configurações → Voz e captura (sem motor, consentimento ausente, chave recusada). */
  aoConfigurar?: () => void;
  /** toast compacto de uma linha. */
  aoAvisar?: (mensagem: string) => void;
}

export interface ControleDitado {
  estado: EstadoBotao;
  nivel: number;
  /** o aviso de primeiro uso do microfone precisa ser mostrado antes de gravar. */
  primeiroUso: boolean;
  /** botão: segurar (pointerdown) / soltar (pointerup). */
  comecar(disparo?: DisparoVoz): Promise<void>;
  terminar(): Promise<void>;
  alternar(): Promise<void>;
  cancelar(): Promise<void>;
  /** o diálogo de primeiro uso foi aceito ("Continuar"): grava o aceite, chama o diálogo do SO e já começa. */
  confirmarPrimeiroUso(): Promise<void>;
  recusarPrimeiroUso(): void;
}

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function usarDitado(op: OpcoesDitado): ControleDitado {
  const api = op.api ?? ade()?.voz;
  const mac = op.mac ?? EH_MAC;
  const [estado, setEstado] = useState<EstadoBotao>("ocioso");
  const [nivel, setNivel] = useState(0);
  const [primeiroUso, setPrimeiroUso] = useState(false);
  const ref = useRef({ audio: null as SessaoAudio | null, gravando: false, soltou: false, abrindo: false, disparo: "segurar" as DisparoVoz, estadoVoz: null as EstadoVoz | null });
  const opRef = useRef(op);
  opRef.current = op;

  const avisar = useCallback((m: string) => opRef.current.aoAvisar?.(m), []);

  const fecharAudio = useCallback(async () => {
    const a = ref.current.audio;
    ref.current.audio = null;
    await a?.parar();
  }, []);

  const cancelar = useCallback(async () => {
    const r = ref.current;
    const havia = r.gravando || r.abrindo || r.audio !== null;
    r.gravando = false;
    r.soltou = true;
    await fecharAudio();
    if (havia || estado === "processando") await api?.cancelar();
    setNivel(0);
    setEstado("ocioso");
  }, [api, fecharAudio, estado]);

  const iniciar = useCallback(async (disparo: DisparoVoz, aposPrimeiroUso = false) => {
    const r = ref.current;
    const sessaoId = opRef.current.sessaoId;
    if (api === undefined || r.gravando || r.abrindo) return;
    r.abrindo = true;
    r.soltou = false;
    r.disparo = disparo;
    try {
      const ev = await api.estado();
      r.estadoVoz = ev;
      if (!ev.motor_pronto || (ev.motor === "http_compativel" && !ev.consentimento)) { avisar(mensagemDeErro(ev.motor === "nenhum" ? "motor_ausente" : "consentimento_ausente")); opRef.current.aoConfigurar?.(); return; }
      if (!aposPrimeiroUso && !ev.aviso_microfone_visto) { setPrimeiroUso(true); return; } // o Chromium só libera o microfone depois deste aviso (permissões do main)
      if (ev.microfone === "negada" || ev.microfone === "restrita") { avisar(mensagemDeErro("microfone_negado")); opRef.current.aoConfigurar?.(); return; }
      if (sessaoId === null) { avisar(mensagemDeErro("sem_terminal_em_foco")); return; }
      const ini = await api.iniciar(sessaoId, disparo);
      if (!ini.ok) {
        if (ini.codigo !== null) { avisar(mensagemDeErro(ini.codigo)); if (levaAConfiguracao(ini.codigo)) opRef.current.aoConfigurar?.(); }
        return;
      }
      r.gravando = true;
      setEstado("gravando");
      try {
        r.audio = await (opRef.current.abrir ?? abrirCaptura)({
          aoBloco: (seq, dados) => { if (ref.current.gravando) api.audio(seq, dados); },
          aoNivel: (n) => setNivel(n),
        });
      } catch (e) {
        r.gravando = false;
        await api.cancelar();
        setEstado("ocioso");
        avisar(mensagemDeErro(e instanceof ErroAudio ? e.codigo : "microfone_indisponivel"));
        return;
      }
      if (r.soltou) { // a pessoa soltou enquanto o microfone abria: encerra já
        r.gravando = false;
        await fecharAudio();
        setEstado("processando");
        await api.parar();
      }
    } finally {
      r.abrindo = false;
    }
  }, [api, avisar, fecharAudio]);

  const terminar = useCallback(async () => {
    const r = ref.current;
    if (api === undefined) return;
    r.soltou = true;
    if (!r.gravando) return;
    if (r.audio === null && r.abrindo) return; // o microfone ainda abre: `iniciar` encerra assim que abrir
    r.gravando = false;
    setNivel(0);
    setEstado("processando");
    await fecharAudio(); // fecha o microfone e entrega o último bloco ANTES de pedir a transcrição
    await api.parar();
  }, [api, fecharAudio]);

  const comecar = useCallback(async (disparo: DisparoVoz = "segurar") => { await iniciar(disparo); }, [iniciar]);
  const alternar = useCallback(async () => { if (ref.current.gravando) await terminar(); else await iniciar("alternar"); }, [iniciar, terminar]);

  const confirmarPrimeiroUso = useCallback(async () => {
    setPrimeiroUso(false);
    if (api === undefined) return;
    await api.configGravar({ aviso_microfone_visto: true });
    const r = await api.pedirMicrofone(); // o diálogo do SO só aparece aqui, depois do aviso do app
    if (r.estado === "negada" || r.estado === "restrita") { avisar(mensagemDeErro("microfone_negado")); opRef.current.aoConfigurar?.(); return; }
    await iniciar("segurar", true);
  }, [api, avisar, iniciar]);

  // eventos do main: estado, texto, erro, aviso e atalho global de alternar
  useEffect(() => {
    if (api === undefined) return;
    return api.assinar((e: EventoVozIpc) => {
      if (e.tipo === "estado") {
        if (e.ditado === "ocioso" && !ref.current.gravando) setEstado("ocioso");
        else if (e.ditado === "transcrevendo" || e.ditado === "injetando") setEstado("processando");
        else if (e.ditado === "erro") setEstado("erro");
        else if (e.ditado === "gravando") setEstado("gravando");
      } else if (e.tipo === "erro") {
        avisar(mensagemDeErro(e.codigo));
        if (levaAConfiguracao(e.codigo)) opRef.current.aoConfigurar?.();
      } else if (e.tipo === "texto" && !e.injetada) avisar(mensagemDeErro(e.codigo));
      else if (e.tipo === "aviso") avisar("Fala cortada em 120 s.");
      else if (e.tipo === "atalho") void alternar();
    });
  }, [api, avisar, alternar]);

  // teclado: segurar-para-falar no documento, antes do xterm (fase de captura)
  useEffect(() => {
    if (api === undefined) return;
    let atalho = "Command+Shift+Space";
    void api.estado().then((s) => { atalho = s.atalho; ref.current.estadoVoz = s; }).catch(() => undefined);
    const baixo = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && (ref.current.gravando || ref.current.abrindo)) { e.preventDefault(); e.stopPropagation(); void cancelar(); return; }
      if (!ehAtalho(e, atalho, mac)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // auto-repeat não reinicia
      if (ref.current.estadoVoz?.disparo === "alternar") void alternar(); else void comecar("segurar");
    };
    const cima = (e: KeyboardEvent): void => {
      if (ref.current.disparo !== "segurar" || !(ref.current.gravando || ref.current.abrindo)) return;
      if (pertenceAoAtalho(e, atalho)) void terminar();
    };
    document.addEventListener("keydown", baixo, true);
    document.addEventListener("keyup", cima, true);
    return () => { document.removeEventListener("keydown", baixo, true); document.removeEventListener("keyup", cima, true); };
  }, [api, mac, alternar, comecar, terminar, cancelar]);

  // perda de foco, aba oculta, janela fechando, cancelamento do ponteiro: cancelam (nunca deixam o microfone aberto)
  useEffect(() => {
    const parar = (): void => { if (ref.current.gravando || ref.current.abrindo || ref.current.audio !== null) void cancelar(); };
    const oculto = (): void => { if (document.visibilityState === "hidden") parar(); };
    window.addEventListener("blur", parar);
    window.addEventListener("pagehide", parar);
    document.addEventListener("visibilitychange", oculto);
    document.addEventListener("pointercancel", parar);
    return () => {
      window.removeEventListener("blur", parar);
      window.removeEventListener("pagehide", parar);
      document.removeEventListener("visibilitychange", oculto);
      document.removeEventListener("pointercancel", parar);
    };
  }, [cancelar]);

  // troca de Pane durante a fala = cancelar
  const sessaoAnterior = useRef(op.sessaoId);
  useEffect(() => {
    if (sessaoAnterior.current !== op.sessaoId && (ref.current.gravando || ref.current.abrindo)) void cancelar();
    sessaoAnterior.current = op.sessaoId;
  }, [op.sessaoId, cancelar]);

  // desmontar fecha o microfone
  useEffect(() => () => { void ref.current.audio?.parar(); ref.current.audio = null; ref.current.gravando = false; }, []);

  return { estado, nivel, primeiroUso, comecar, terminar, alternar, cancelar, confirmarPrimeiroUso, recusarPrimeiroUso: () => setPrimeiroUso(false) };
}
