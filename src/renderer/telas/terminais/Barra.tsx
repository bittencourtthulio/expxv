import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { FerramentaDetectada } from "../../../compartilhado/terminais";
import { Icone, type NomeIcone } from "../../componentes/Icone";
import { EH_MAC } from "./atalhos";
import { textoAguardando } from "./semaforo";
import type { Orientacao } from "./layout";

interface Props {
  /** as abas (a linha é UMA só: abas + controles). */
  children?: ReactNode;
  ferramentas: readonly FerramentaDetectada[] | null;
  abrindo: boolean;
  aguardando: number;
  /** há painel em foco para dividir/buscar. */
  temPainel: boolean;
  podeDividir: boolean;
  /** modo foco: a linha some e volta pela borda superior. */
  oculta: boolean;
  emFoco: boolean;
  aoAbrir(f: FerramentaDetectada): void;
  aoDetectarDeNovo(): void;
  aoDividir(o: Orientacao): void;
  aoBuscar(): void;
  /** leva ao primeiro painel que espera a pessoa. */
  aoIrParaAguardando(): void;
  aoAlternarFoco(): void;
  aoAbrirAjuda(): void;
  aoSairDoMouse(): void;
  /** "Orquestrar" na criação: novos painéis abrem já orquestrando (ausente = o controle não aparece). */
  orquestrarNovo?: boolean;
  aoAlternarOrquestrarNovo?(): void;
  /** controles extras discretos entre buscar e o contador (ex.: ditado por voz, Fase 11). */
  acoesExtras?: ReactNode;
}

const MOD = EH_MAC ? "⌘" : "Ctrl+Shift+";
const Ico = ({ nome, titulo, aoClicar, desabilitado, pressionado }: { nome: NomeIcone; titulo: string; aoClicar(): void; desabilitado?: boolean; pressionado?: boolean }): ReactElement => (
  <button type="button" className="terminais-icone" aria-label={titulo.replace(/ \(.*\)$/, "")} title={titulo} disabled={desabilitado} aria-pressed={pressionado} onClick={aoClicar}>
    <Icone nome={nome} />
  </button>
);

/** A ÚNICA linha de controles da tela (≈ 28 px): abas, `+` (menu de CLI), dividir, buscar, "N aguardando", foco e ajuda. */
export function Barra({ children, ferramentas, abrindo, aguardando, temPainel, podeDividir, oculta, emFoco, aoAbrir, aoDetectarDeNovo, aoDividir, aoBuscar, aoIrParaAguardando, aoAlternarFoco, aoAbrirAjuda, aoSairDoMouse, acoesExtras, orquestrarNovo = false, aoAlternarOrquestrarNovo }: Props): ReactElement {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent): void => { if (raiz.current !== null && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto]);
  const instaladas = (ferramentas ?? []).filter((f) => f.instalado);
  return (
    <div className="terminais-barra" data-oculta={oculta || undefined} onPointerLeave={aoSairDoMouse}>
      {children}
      <div className="terminais-nova" ref={raiz}>
        <button
          ref={botao}
          type="button"
          className="terminais-icone terminais-icone-destaque"
          aria-label="Nova sessão"
          title={abrindo ? "Abrindo…" : `Nova sessão (${MOD}N)`}
          aria-haspopup="menu"
          aria-expanded={aberto}
          aria-controls="terminais-menu-nova"
          disabled={abrindo}
          onClick={() => setAberto(!aberto)}
        >
          <Icone nome="mais" />
        </button>
        {aberto ? (
          <div
            id="terminais-menu-nova"
            className="terminais-menu"
            role="menu"
            aria-label="Escolher CLI ou ferramenta"
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== botao.current) setAberto(false); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setAberto(false); botao.current?.focus(); }
              const itens = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
              const i = itens.indexOf(document.activeElement as HTMLElement);
              if (e.key === "ArrowDown") { e.preventDefault(); itens[(i + 1) % itens.length]?.focus(); }
              if (e.key === "ArrowUp") { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length]?.focus(); }
            }}
          >
            {ferramentas === null ? <p className="terminais-menu-info" role="status">Detectando CLIs…</p> : null}
            {(ferramentas ?? []).map((f, i) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                className="terminais-menu-item"
                disabled={!f.instalado}
                autoFocus={i === (ferramentas ?? []).findIndex((x) => x.instalado)}
                onClick={() => { setAberto(false); botao.current?.focus(); aoAbrir(f); }}
              >
                <b>{f.nome}</b>
                <small>{f.instalado ? (f.versao !== null ? `${f.descricao} · v${f.versao}` : f.descricao) : "não instalada"}</small>
              </button>
            ))}
            <button type="button" role="menuitem" className="terminais-menu-item terminais-menu-rodape" onClick={() => { setAberto(false); botao.current?.focus(); aoDetectarDeNovo(); }}>
              <b>Detectar de novo</b>
              <small>{instaladas.length} de {(ferramentas ?? []).length} instaladas</small>
            </button>
          </div>
        ) : null}
      </div>
      {aoAlternarOrquestrarNovo !== undefined ? (
        <button type="button" role="switch" aria-checked={orquestrarNovo} className="terminais-icone terminais-chave" aria-label="Abrir novos painéis com Orquestrar neste painel" title="Orquestrar: novos painéis abrem já podendo abrir agentes como terminais na tela (pede permissão por projeto)" onClick={aoAlternarOrquestrarNovo}>
          Orquestrar
        </button>
      ) : null}
      <div className="terminais-acoes">
        <Ico nome="dividirLado" titulo={`Dividir lado a lado (${MOD}D)`} desabilitado={!temPainel || !podeDividir} aoClicar={() => aoDividir("vertical")} />
        <Ico nome="dividirCima" titulo={`Dividir em cima e embaixo (${EH_MAC ? "⌘⇧D" : "Ctrl+Shift+Alt+D"})`} desabilitado={!temPainel || !podeDividir} aoClicar={() => aoDividir("horizontal")} />
        <Ico nome="busca" titulo={`Buscar no terminal (${EH_MAC ? "⌘F" : "Ctrl+Shift+F"})`} desabilitado={!temPainel} aoClicar={aoBuscar} />
        {acoesExtras}
        {aguardando > 0 ? (
          <button type="button" className="terminais-aguardando" onClick={aoIrParaAguardando} title="Ir ao primeiro painel que espera você" aria-label={`${textoAguardando(aguardando)}. Ir ao primeiro painel.`}>
            <i aria-hidden="true">!</i>
            {aguardando} aguardando
          </button>
        ) : null}
        <Ico nome="expandir" titulo={`Modo foco (${EH_MAC ? "⌘⇧Enter" : "Ctrl+Shift+Enter"})`} desabilitado={!temPainel} pressionado={emFoco} aoClicar={aoAlternarFoco} />
        <Ico nome="ajuda" titulo="Atalhos de teclado" aoClicar={aoAbrirAjuda} />
      </div>
    </div>
  );
}
