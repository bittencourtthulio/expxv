// Botão de ditado na linha única de controles dos Terminais (Fase 11, T-11.13; D-32: 22 px, sem salto de layout). Estados por FORMA e `aria-label` (nunca só cor): ocioso (contorno),
// gravando (preenchido + anel + barra de nível), processando (giro), erro (`!`). Segurar o botão também grava (pointerdown/up). Sem motor: abre a configuração em vez de gravar.
import "./voz.css";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ade } from "../../ade";
import { pedirConfiguracoes } from "../../estado/navegacao";
import { usarDitado, type OpcoesDitado } from "../../voz/usarDitado";
import { rotuloDoAtalho, rotuloDoBotao } from "../../voz/logica";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const TOAST_MS = 2_500;

function Glifo({ estado }: { estado: "ocioso" | "gravando" | "processando" | "erro" }): ReactElement {
  if (estado === "processando") return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="voz-giro"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="22 12" strokeLinecap="round" /></svg>;
  if (estado === "erro") return <span className="voz-erro-sinal" aria-hidden="true">!</span>;
  const cheio = estado === "gravando";
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill={cheio ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function BotaoVoz({ sessaoId, opcoes }: { sessaoId: string | null; opcoes?: Partial<OpcoesDitado> }): ReactElement | null {
  const [toast, setToast] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [atalho, setAtalho] = useState<string | null>(null);
  const avisar = useCallback((m: string) => {
    if (m === "") return;
    setToast(m);
    if (temporizador.current !== null) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => { if (temporizador.current !== null) clearTimeout(temporizador.current); }, []);
  const c = usarDitado({ sessaoId, aoAvisar: avisar, aoConfigurar: () => pedirConfiguracoes("voz"), ...opcoes });
  useEffect(() => { void ade()?.voz.estado().then((e) => setAtalho(rotuloDoAtalho(e.atalho, EH_MAC))).catch(() => undefined); }, []);
  if (opcoes?.api === undefined && ade()?.voz === undefined) return null; // fora do Electron não há voz

  const rotulo = rotuloDoBotao(c.estado, atalho);
  return (
    <span className="voz-raiz">
      <button
        type="button"
        className="terminais-icone voz-botao"
        data-estado={c.estado}
        aria-label={rotulo}
        title={rotulo}
        aria-pressed={c.estado === "gravando"}
        disabled={c.estado === "processando"}
        onPointerDown={(e) => { if (e.button === 0) void c.comecar("segurar"); }}
        onPointerUp={() => void c.terminar()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); void c.alternar(); } }}
      >
        <Glifo estado={c.estado} />
        {c.estado === "gravando" ? <span className="voz-nivel" aria-hidden="true" style={{ transform: `scaleX(${Math.min(1, c.nivel * 6)})` }} /> : null}
      </button>
      <span className="voz-toast" role="status" aria-live="polite">{toast ?? ""}</span>
      {c.primeiroUso ? (
        <div className="dialogo-fundo" role="presentation">
          <div className="dialogo voz-dialogo" role="dialog" aria-modal="true" aria-labelledby="voz-primeiro-uso">
            <h2 className="dialogo-titulo" id="voz-primeiro-uso">Usar o microfone para ditar</h2>
            <div className="dialogo-corpo">
              <p><b>O que será usado:</b> o microfone, só enquanto você segura o atalho ou o botão, para transformar a fala em texto no terminal em foco.</p>
              <p><b>O que não acontece:</b> nenhum áudio é gravado em disco e nada é enviado pela internet sem o seu aceite expresso, por serviço e por endereço. O texto vai ao terminal sem Enter.</p>
              <p><b>Como desfazer:</b> Ajustes do Sistema, Privacidade e Segurança, Microfone; ou escolha “nenhum” motor em Configurações.</p>
            </div>
            <div className="dialogo-acoes">
              <button type="button" className="terminais-botao" onClick={c.recusarPrimeiroUso}>Agora não</button>
              <button type="button" className="terminais-botao terminais-botao-primario" data-foco-inicial autoFocus onClick={() => void c.confirmarPrimeiroUso()}>Continuar</button>
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
