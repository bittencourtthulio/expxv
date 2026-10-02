import "./componentes.css";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../estado/workspaces";
import { Icone } from "./Icone";
import { DecoracaoVcs } from "./DecoracaoVcs";
import { useContagemTerminais } from "../estado/terminais-contagem";
import type { StoreTerminais } from "../estado/terminais";
import { storeVisaoTerminais } from "../estado/terminais-visao";
import { pedirTela } from "../estado/navegacao";
import { storeAdicionarWorkspace } from "../estado/adicionar-workspace";
import { idsConhecidos } from "../telas/terminais/por-workspace";

/** Seletor de workspace do topo: atual, recentes e "Abrir pasta…". Trocar não bloqueia a UI. */
export function SeletorWorkspace({ store = storeWorkspaces, terminais }: { store?: StoreWorkspaces; terminais?: StoreTerminais }) {
  const { atual, recentes } = useWorkspaces(store);
  const [aberto, setAberto] = useState(false);
  // D-570/D-571: contagem discreta de terminais por workspace e o grupo "Sem projeto (N)" (só quando existe)
  const conhecidos = useMemo(() => idsConhecidos(atual, recentes), [atual, recentes]);
  const contagem = useContagemTerminais(conhecidos, terminais);
  const raiz = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (raiz.current !== null && !raiz.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  // ao abrir, o foco vai ao item atual (ou ao primeiro); ao fechar por Esc/escolha, volta ao botão
  useEffect(() => {
    if (!aberto) return;
    const itens = raiz.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    (raiz.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? itens?.[0])?.focus();
  }, [aberto]);
  const fechar = () => { setAberto(false); gatilho.current?.focus(); };
  const escolher = (id: string) => { fechar(); storeVisaoTerminais.sairDeSemProjeto(); if (id !== atual?.id) void store.definirAtual(id); };
  const verSemProjeto = () => { fechar(); storeVisaoTerminais.entrarEmSemProjeto(); pedirTela("terminais"); };
  // D-600: "Adicionar workspace…" abre o modal (pasta, clonar, novo); o diálogo nativo direto segue em ⌘O / menu "Abrir pasta…"
  const abrir = () => { fechar(); storeAdicionarWorkspace.abrir("pasta"); };
  const teclar = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); fechar(); return; }
    if (!aberto) return;
    const itens = [...(raiz.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLElement);
    const ir = e.key === "ArrowDown" ? (i + 1) % itens.length : e.key === "ArrowUp" ? (i - 1 + itens.length) % itens.length : e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : -1;
    if (ir >= 0 && itens.length > 0) { e.preventDefault(); itens[ir]?.focus(); }
  };

  return (
    <div className="seletor-ws" ref={raiz} onKeyDown={teclar} onBlur={(e) => { if (aberto && !raiz.current?.contains(e.relatedTarget as Node | null)) setAberto(false); }}>
      <button ref={gatilho} type="button" className="topo-workspace" title="Workspace atual" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <Icone nome="pasta" />
        <span className="seletor-ws-rotulo">{atual?.nome ?? "Nenhum workspace"}</span>
      </button>
      {atual !== null ? <DecoracaoVcs alvo={{ workspace_id: atual.id, mission_id: null }} className="vc-deco-seletor" /> : null}
      {aberto ? (
        <div className="seletor-ws-lista" role="menu" aria-label="Workspaces">
          {recentes.length === 0 ? <p style={{ margin: "6px 10px", fontSize: 13 }}>Nenhum workspace recente.</p> : null}
          {recentes.map((w) => (
            <button key={w.id} type="button" role="menuitemradio" aria-checked={w.id === atual?.id} className="seletor-ws-item" onClick={() => escolher(w.id)}>
              <span>{w.nome}{(contagem.porWorkspace.get(w.id) ?? 0) > 0 ? <em className="seletor-ws-n" aria-label={`${contagem.porWorkspace.get(w.id)} terminais`}>{contagem.porWorkspace.get(w.id)}</em> : null}</span>
              <small>{w.raiz}</small>
            </button>
          ))}
          {contagem.semProjeto > 0 ? <button type="button" role="menuitem" className="seletor-ws-item" onClick={verSemProjeto}><span>Sem projeto ({contagem.semProjeto})</span></button> : null}
          <button type="button" role="menuitem" className="seletor-ws-item" onClick={abrir}><span>Adicionar workspace…</span></button>
        </div>
      ) : null}
    </div>
  );
}
