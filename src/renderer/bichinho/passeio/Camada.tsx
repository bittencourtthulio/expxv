// Camada do passeio (D-650): `position: fixed; inset: 0; pointer-events: none`, UMA vez na casca, e só tem filhos enquanto algum bichinho passeia.
// Desenha o MESMO sprite (espécie, estágio, humor) em cada passeante; a posição é `transform` com transição CSS por trecho (calculada pelo controlador,
// nada por quadro). Decorativa (`aria-hidden`), nunca captura clique nem foco, z-index abaixo de diálogos, menus e popovers.
import { createElement, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { BichinhoSprite } from "../Sprite";
import { storeBichinho, type StoreBichinho } from "../estado";
import { controlePadrao, type ControlePasseio, type VistaPasseante } from "./controle";
import { ligarStore } from "./ligar";
import "./passeio.css";

function Props({ v }: { v: VistaPasseante }): ReactNode {
  const acao = v.fase === "fazendo_algo" ? v.acao : null;
  return (
    <>
      {acao === "bolinha" && <svg className="pb-prop pb-bola" viewBox="0 0 16 16" focusable="false"><ellipse className="pb-sombra-prop" cx="8" cy="15" rx="5" ry="1.4" /><circle className="pb-bola-corpo" cx="8" cy="8" r="5.5" /><path className="pb-bola-risco" d="M3.5 6.5 q4.5 2.5 9 0" /></svg>}
      {acao === "borboleta" && <svg className="pb-prop pb-borboleta" viewBox="0 0 20 16" focusable="false"><path className="pb-asa-a" d="M10 8 C4 0 0 4 3 8 C0 12 5 15 10 8z" /><path className="pb-asa-b" d="M10 8 C16 0 20 4 17 8 C20 12 15 15 10 8z" /></svg>}
      {acao === "cavar" && <svg className="pb-prop pb-terra" viewBox="0 0 24 12" focusable="false"><path className="pb-terra-monte" d="M2 11 Q7 2 12 11 Q16 4 22 11z" /></svg>}
      {v.carga && <svg className="pb-prop pb-maos" viewBox="0 0 30 12" focusable="false"><path className="pb-mao" d="M4 11 q1 -8 5 -8 M26 11 q-1 -8 -5 -8" /></svg>}
    </>
  );
}

function Passeante({ v, registrar }: { v: VistaPasseante; registrar: (chave: string, el: HTMLElement | null) => void }): ReactNode {
  return (
    <div
      ref={(el) => registrar(v.chave, el)}
      className="pb-passeante"
      data-passeante={v.chave}
      data-fase={v.fase}
      data-acao={v.acao ?? undefined}
      data-carga={v.carga || undefined}
      style={{ width: v.tam, height: v.tam, transform: `translate3d(${Math.round(v.x)}px, ${Math.round(v.y)}px, 0)`, transitionDuration: `${v.ms}ms` }}
    >
      <Props v={v} />
      <span className="pb-giro" data-dir={v.dir}>
        <span className="pb-corpo">
          <span className="bi-wrap" data-quieto={v.quieto || undefined}>
            <BichinhoSprite especie={v.especie} estagio={v.estagio} humor={v.humor} doente={v.doente} nivel={0} />
          </span>
        </span>
      </span>
    </div>
  );
}

export interface PropsCamada { controle?: ControlePasseio; store?: StoreBichinho }

export default function PasseioBichinhos({ controle = controlePadrao(), store = storeBichinho }: PropsCamada): ReactNode {
  const vistas = useSyncExternalStore(controle.assinar, controle.obterVistas);
  const refs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const parar = controle.iniciar();
    const soltar = ligarStore(controle, store);
    void store.garantir([]);
    controle.definirMedidor((chave) => { const el = refs.current.get(chave); if (el === undefined) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    return () => { controle.definirMedidor(null); soltar(); parar(); };
  }, [controle, store]);
  if (vistas.length === 0) return null;
  const registrar = (chave: string, el: HTMLElement | null): void => { if (el === null) refs.current.delete(chave); else refs.current.set(chave, el); };
  return createElement("div", { className: "pb-camada", "aria-hidden": "true", "data-passeio-camada": "", "data-testid": "passeio-camada" }, vistas.map((v) => <Passeante key={v.chave} v={v} registrar={registrar} />));
}
