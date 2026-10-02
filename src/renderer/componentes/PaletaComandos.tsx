import "./paleta.css";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { criarIndice } from "../busca-fuzzy";
import { criarAcoesDom, montarComandos, textoDeBusca, type Comando } from "../estado/paleta";
import { useMetodo } from "../estado/metodo";
import { storeTema, useTema } from "../estado/tema";
import { storeWorkspaces, useWorkspaces } from "../estado/workspaces";
import { chaveAlvo, storeVcs } from "../estado/vcs";

const MAX_VISIVEIS = 50;

export interface PropsPaleta {
  comandos: readonly Comando[];
  aoFechar: () => void;
}

/**
 * Paleta de comandos: role="dialog" + combobox/listbox. Abre com o foco já no campo (layout effect,
 * sem esperar pintura), foco preso no campo, Esc fecha e devolve o foco a quem estava antes.
 * Setas movem a seleção, Enter executa, Home/End pulam para o primeiro/último.
 */
export function PaletaComandos({ comandos, aoFechar }: PropsPaleta) {
  const idLista = useId();
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [consulta, setConsulta] = useState("");
  const [indice, setIndice] = useState(0);
  const indiceBusca = useMemo(() => criarIndice(comandos, textoDeBusca), [comandos]);
  const visiveis = useMemo(() => indiceBusca.buscar(consulta, MAX_VISIVEIS), [indiceBusca, consulta]);

  useLayoutEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    campo.current?.focus();
    return () => { if (anterior?.isConnected) anterior.focus(); };
  }, []);

  useEffect(() => {
    lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [indice, visiveis]);

  const executar = (c: Comando | undefined) => {
    if (c === undefined) return;
    aoFechar();
    c.executar();
  };

  const aoTeclar = (e: React.KeyboardEvent) => {
    const n = visiveis.length;
    switch (e.key) {
      case "Escape": e.preventDefault(); e.stopPropagation(); aoFechar(); break;
      case "ArrowDown": e.preventDefault(); if (n > 0) setIndice((i) => (i + 1) % n); break;
      case "ArrowUp": e.preventDefault(); if (n > 0) setIndice((i) => (i - 1 + n) % n); break;
      case "Home": e.preventDefault(); setIndice(0); break;
      case "End": e.preventDefault(); setIndice(Math.max(0, n - 1)); break;
      case "Enter": e.preventDefault(); executar(visiveis[indice]); break;
      case "Tab": e.preventDefault(); break; // foco preso: o campo é o único foco
    }
  };

  const ativo = visiveis[indice];
  return createPortal(
    <div className="paleta-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Paleta de comandos" onKeyDown={aoTeclar}>
        <input
          ref={campo}
          className="paleta-campo"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={idLista}
          aria-activedescendant={ativo ? `${idLista}-${indice}` : undefined}
          aria-autocomplete="list"
          aria-label="Buscar ou executar comando"
          placeholder="Buscar ou executar comando"
          autoComplete="off"
          spellCheck={false}
          value={consulta}
          onChange={(e) => { setConsulta(e.target.value); setIndice(0); }}
        />
        <ul ref={lista} id={idLista} className="paleta-lista" role="listbox" aria-label="Comandos">
          {visiveis.map((c, i) => (
            <li
              key={c.id}
              id={`${idLista}-${i}`}
              role="option"
              aria-selected={i === indice}
              className="paleta-item"
              onMouseMove={() => { if (i !== indice) setIndice(i); }}
              onClick={() => executar(c)}
            >
              <span className="paleta-grupo">{c.grupo}</span>
              <span className="paleta-titulo">{c.titulo}</span>
              {c.detalhe !== undefined && <small className="paleta-detalhe">{c.detalhe}</small>}
              {c.atalho !== undefined && <kbd>{c.atalho}</kbd>}
            </li>
          ))}
        </ul>
        <div role="status" className={visiveis.length === 0 ? "paleta-vazio" : "sr-somente"}>
          {visiveis.length === 0 ? "Nenhum comando encontrado. Tente outra palavra." : `${visiveis.length} ${visiveis.length === 1 ? "comando" : "comandos"}`}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Paleta ligada aos stores reais (é o que o chunk lazy carrega). */
export function PaletaConectada({ aoFechar }: { aoFechar: () => void }) {
  const ws = useWorkspaces();
  const { efetivo } = useTema();
  const { indice } = useMetodo();
  const resumo = ws.atual === null ? null : (storeVcs.obter().resumos[chaveAlvo({ workspace_id: ws.atual.id, mission_id: null })] ?? null);
  const comandos = useMemo(
    () => montarComandos({
      mac: EH_MAC,
      workspaceAtual: ws.atual === null ? null : { id: ws.atual.id, nome: ws.atual.nome },
      recentes: ws.recentes.map((w) => ({ id: w.id, nome: w.nome })),
      trabalhos: (indice?.trabalhos ?? []).map((t) => ({ id: t.id, titulo: t.titulo, tipo: t.tipo, estagio: t.estagio })),
      temaEfetivo: efetivo,
      vcs: resumo === null ? null : { tipo: resumo.tipo, sujo: resumo.sujo, staged: resumo.staged, ahead: resumo.ahead, behind: resumo.behind, operacao: resumo.operacao !== null },
      acoes: criarAcoesDom({
        abrirProjeto: () => void storeWorkspaces.abrir(null),
        alternarTema: () => void storeTema.alternar(),
        irParaWorkspace: (id) => void storeWorkspaces.definirAtual(id),
      }),
    }),
    [ws.atual, ws.recentes, efetivo, indice, resumo],
  );
  return <PaletaComandos comandos={comandos} aoFechar={aoFechar} />;
}
