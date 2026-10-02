import "./publicar.css";
import { lazy, Suspense, useEffect, useMemo, type ReactElement } from "react";
import { decidirBotoes, type BotaoPublicar } from "../../nucleo/vcs/publicar/visibilidade";
import type { TipoPublicacao } from "../../compartilhado/vcs-publicar";
import { Icone } from "../componentes/Icone";
import { storePublicar, usePublicar, type StorePublicar } from "../estado/vcs-publicar";
import { storeVcs, useResumoVcs, type StoreVcs } from "../estado/vcs";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../estado/workspaces";
import type { TelaId } from "./telas";

// O diálogo só entra no JS quando alguém clica.
const DialogoPublicar = lazy(() => import("./DialogoPublicar"));
const DialogoAtualizar = lazy(() => import("./DialogoAtualizar"));

type AcaoBotao = TipoPublicacao | "atualizar";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌘⇧U / Ctrl+Shift+U = Commit e push ("up"); ⌘⇧Y / Ctrl+Shift+Y = Enviar PR. Livres: ⌘⇧K é o Chat, ⌘⇧G o Conhecimento, ⌘K a paleta e ⌘⇧D/L/M/E o terminal. */
export function tipoDoAtalho(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac: boolean = MAC): TipoPublicacao | null {
  if (!e.shiftKey || e.altKey) return null;
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return null;
  const k = e.key.toLowerCase();
  return k === "u" ? "commit_push" : k === "y" ? "pr" : null;
}

function Botao({ tipo, b, aoClicar }: { tipo: AcaoBotao; b: BotaoPublicar; aoClicar: (t: AcaoBotao) => void }): ReactElement {
  const desabilitado = !b.habilitado;
  const clicavel = !desabilitado || b.abreMesmoDesabilitado === true;
  const nome = `${b.rotulo}${b.badge === null ? "" : ` (${b.badge})`}${desabilitado ? `, indisponível: ${b.tooltip}` : ""}`;
  return (
    <button
      type="button"
      className="topo-workspace topo-pub-botao"
      data-acao={tipo}
      data-desabilitado={desabilitado || undefined}
      data-com-contagem={b.badge !== null || undefined}
      aria-disabled={desabilitado}
      aria-label={nome}
      title={b.tooltip}
      onClick={() => { if (clicavel) aoClicar(tipo); }}
    >
      <Icone nome={tipo === "pr" ? "ramo" : tipo === "atualizar" ? "baixar" : "subir"} />
      <span className="topo-pub-rotulo">{b.rotulo}</span>
      {b.badge !== null ? <span className="topo-pub-badge" aria-hidden="true">{b.badge}</span> : null}
    </button>
  );
}

/**
 * "Commit e push" e "Enviar PR" no grupo ESQUERDO do cabeçalho, logo à direita do Executar. Só na tela Terminais, em repositório git com `origin` no GitHub.
 * Clicar NÃO executa git: abre o diálogo de confirmação e entrega uma instrução ao agente (D-630..D-639). "Atualizar" (D-693) é o único que roda git aqui: `git pull --ff-only` pelo executor do VCS, depois do diálogo. Em cabeçalho estreito viram só ícone (tooltip completo).
 */
export function BotoesPublicar({ tela, store = storePublicar, vcs = storeVcs, workspaces = storeWorkspaces }: { tela: TelaId; store?: StorePublicar; vcs?: StoreVcs; workspaces?: StoreWorkspaces }): ReactElement | null {
  const ui = usePublicar(store);
  const ws = useWorkspaces(workspaces).atual?.id ?? null;
  const naTela = tela === "terminais";
  const observar = ws !== null && (naTela || ui.seguindo);
  const resumo = useResumoVcs(observar ? { workspace_id: ws, mission_id: null } : null, vcs);
  const chave = resumo === null ? "" : [resumo.branch, resumo.oid, resumo.sujo, resumo.staged, resumo.nao_staged, resumo.nao_rastreados, resumo.ahead, resumo.behind, resumo.operacao].join("|");

  useEffect(() => { store.definirWorkspace(ws); }, [store, ws]);
  useEffect(() => { if (observar) void store.atualizar(); }, [store, observar, chave]);

  const b = useMemo(() => decidirBotoes({ tela, fatos: ui.fatos, atualizando: ui.atualizando }), [tela, ui.fatos, ui.atualizando]);
  const visivel = b.commit.visivel;
  useEffect(() => { store.definirBotoes(visivel ? b : null); }, [store, b, visivel]);

  useEffect(() => {
    if (!visivel) return;
    const f = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat) return;
      const t = tipoDoAtalho(e);
      if (t === null) return;
      e.preventDefault();
      e.stopPropagation();
      if ((t === "pr" ? b.pr : b.commit).habilitado) void store.abrir(t);
    };
    window.addEventListener("keydown", f, true);
    return () => window.removeEventListener("keydown", f, true);
  }, [store, visivel, b]);

  const anuncio = ui.faixa?.texto ?? "";
  if (!visivel && ui.dialogo === null && ui.atualizar === null) return <span className="pub-anuncio" role="status" aria-live="polite">{naTela ? anuncio : ""}</span>;
  return (
    <div className="topo-publicar" role="group" aria-label="Publicar no GitHub" data-ocupado={ui.dialogo !== null || ui.atualizar !== null ? "" : undefined}>
      {visivel ? (
        <>
          <Botao tipo="commit_push" b={b.commit} aoClicar={() => void store.abrir("commit_push")} />
          <Botao tipo="pr" b={b.pr} aoClicar={() => void store.abrir("pr")} />
          <Botao tipo="atualizar" b={b.atualizar} aoClicar={() => void store.abrirAtualizar()} />
        </>
      ) : null}
      <span className="pub-anuncio" role="status" aria-live="polite">{anuncio}</span>
      {ui.faixa !== null && naTela ? (
        <div className="pub-faixa" data-tipo={ui.faixa.tipo}>
          <Icone nome={ui.faixa.tipo === "pr" || ui.faixa.tipo === "merge" ? "ramo" : "subir"} />
          <span>{ui.faixa.texto}</span>
          {ui.faixa.sessaoId !== null ? <button type="button" className="botao-mini" onClick={() => store.focarAgente()}>Acompanhar</button> : null}
          <button type="button" className="botao-mini pub-faixa-fechar" aria-label="Dispensar aviso" onClick={() => store.dispensarFaixa()}>×</button>
        </div>
      ) : null}
      {ui.dialogo !== null ? (
        <Suspense fallback={null}>
          <DialogoPublicar store={store} />
        </Suspense>
      ) : null}
      {ui.atualizar !== null ? (
        <Suspense fallback={null}>
          <DialogoAtualizar store={store} />
        </Suspense>
      ) : null}
    </div>
  );
}
