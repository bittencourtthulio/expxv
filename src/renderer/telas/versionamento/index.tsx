import "./versionamento.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiVcs, AlvoVcs, EstadoVcs } from "../../../compartilhado/vcs";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import type { NomeIcone } from "../../componentes/Icone";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { storeMissoes, useMissoes, type StoreMissoes } from "../../estado/missoes";
import { storeVcs, type StoreVcs } from "../../estado/vcs";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { Barra } from "./Barra";
import { Branches } from "./Branches";
import { Conflitos } from "./Conflitos";
import { Ctx, mensagemDe, type AbaVcs, type CtxVcs } from "./contexto";
import { Historico } from "./Historico";
import { Mudancas } from "./Mudancas";
import { PRs } from "./Forge";
import { aoPedirVcs } from "../../estado/vcs-acoes";

export interface PropsTelaVersionamento {
  api?: ApiVcs | undefined;
  workspaces?: StoreWorkspaces;
  missoes?: StoreMissoes;
  store?: StoreVcs;
}

const ABAS: Array<[AbaVcs, string]> = [["mudancas", "Mudanças"], ["branches", "Branches"], ["historico", "Histórico"], ["prs", "PRs"], ["conflitos", "Conflitos"]];
const ICONE_ABA: Record<AbaVcs, NomeIcone> = { mudancas: "versionamento", branches: "ramo", historico: "desfazer", prs: "subir", conflitos: "alerta" };

export function TelaVersionamento({ api = ade()?.vcs, workspaces = storeWorkspaces, missoes = storeMissoes, store = storeVcs }: PropsTelaVersionamento) {
  const { atual } = useWorkspaces(workspaces);
  const { itens } = useMissoes(missoes);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaVcs>("mudancas");
  const [estado, setEstado] = useState<EstadoVcs | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [commitAberto, setCommitAberto] = useState<{ hash: string; n: number } | null>(null);
  const geracao = useRef(0);
  const nAbrir = useRef(0);

  const ws = atual?.id ?? null;
  const mis = missionId;
  // identidade estável: os filhos usam `alvo` em dependências de efeitos
  const alvo: AlvoVcs | null = useMemo(() => (ws === null ? null : { workspace_id: ws, mission_id: mis }), [ws, mis]);
  useEffect(() => { setMissionId(null); setEstado(null); }, [ws]);

  const carregar = useCallback(async (): Promise<void> => {
    if (api === undefined || ws === null) return;
    const minha = ++geracao.current;
    try {
      const e = await api.estado({ workspace_id: ws, mission_id: mis }, false);
      if (minha === geracao.current) { setEstado(e); setErroCarga(null); }
    } catch (e) { if (minha === geracao.current) setErroCarga(mensagemDe(e)); }
  }, [api, ws, mis]);

  // observa a árvore enquanto a tela está montada; recarrega o estado completo (coalescido) a cada `vcs:mudou`
  useEffect(() => {
    if (api === undefined || ws === null) return undefined;
    void carregar();
    const solta = store.observar({ workspace_id: ws, mission_id: mis });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancelar = api.assinar((e) => {
      if (e.workspace_id !== ws || e.mission_id !== mis) return;
      if (timer === null) timer = setTimeout(() => { timer = null; void carregar(); }, 60);
    });
    return () => { solta(); cancelar(); if (timer !== null) clearTimeout(timer); };
  }, [api, ws, mis, store, carregar]);

  // pedidos da paleta (commit, fetch…): a tela dona trata
  useEffect(() => aoPedirVcs((p) => { if (p === "abrir-prs") setAba("prs"); else if (p === "branches" || p === "stash") setAba("branches"); else setAba("mudancas"); }), []);

  const rodar = useCallback(async <T,>(f: () => Promise<T>): Promise<T | undefined> => {
    setErro(null);
    setOcupado(true);
    try { return await f(); } catch (e) { setErro(mensagemDe(e)); return undefined; } finally { setOcupado(false); }
  }, []);
  const avisar = useCallback((t: string) => setAviso(t), []);
  const missao = useMemo(() => itens.find((m) => m.id === mis) ?? null, [itens, mis]);

  if (api === undefined) return <EstadoVazio icone="versionamento" titulo="Versionamento indisponível" texto="Esta tela só funciona dentro do aplicativo." />;
  if (atual === null || alvo === null) return <EstadoVazio icone="workspaces" titulo="Abra um workspace primeiro" texto="O versionamento mostra o repositório do workspace atual." />;
  if (estado === null) return <div className="vc-tela" data-modo="cheia" aria-busy="true">{erroCarga !== null ? <p role="alert" className="erro-caixa">{erroCarga}</p> : <div className="vc-vazio">Lendo o repositório…</div>}</div>;
  if (estado.tipo === "nenhum") return <EstadoVazio icone="versionamento" titulo="Sem repositório" texto={estado.mensagem ?? "Esta pasta não está sob git nem SVN. Rode `git init` num terminal para começar."} />;

  const ctx: CtxVcs = {
    api, alvo, estado, recarregar: carregar, rodar, avisar, missao,
    abrirCommit: (hash) => { nAbrir.current++; setCommitAberto({ hash, n: nAbrir.current }); setAba("historico"); },
    irPara: setAba,
  };
  const abas = estado.tipo === "svn" ? ABAS.filter(([id]) => id !== "prs") : ABAS;
  const conflitos = estado.status.contagens.conflitos;
  return (
    <Ctx.Provider value={ctx}>
      <div className="vc-tela" data-modo="cheia" data-tipo={estado.tipo}>
        <Barra missoes={itens} aoTrocarArvore={setMissionId} ocupado={ocupado} />
        {estado.mensagem !== null ? <p className="vc-aviso vc-faixa" role="note">{estado.mensagem}</p> : null}
        {estado.tipo === "git-svn" ? <p className="vc-aviso vc-faixa" role="note">Repositório git-svn tratado como git. `git svn dcommit` nunca roda sem confirmação.</p> : null}
        {erro !== null ? <p className="erro-caixa vc-faixa" role="alert">{erro} <button type="button" className="vc-mini" onClick={() => setErro(null)}>Fechar</button></p> : null}
        <SubNavegacao
          base="vc" rotulo="Versionamento" recolhivel classePainel="vc-painel sem-pad" ativo={aba} onMudar={setAba}
          itens={abas.map(([id, rotulo]) => ({ id, rotulo, icone: ICONE_ABA[id], ...(id === "mudancas" && estado.status.arquivos.length > 0 ? { selo: estado.status.arquivos.length } : id === "conflitos" && conflitos > 0 ? { selo: conflitos } : {}) }))}
          barra={<span className="vc-aviso-vivo" role="status" aria-live="polite">{aviso ?? ""}</span>}
        >
          {aba === "mudancas" ? <Mudancas /> : aba === "branches" ? <Branches /> : aba === "historico" ? <Historico abrir={commitAberto} /> : aba === "prs" ? <PRs /> : <Conflitos />}
        </SubNavegacao>
      </div>
    </Ctx.Provider>
  );
}

export default function Tela() {
  return <TelaVersionamento />;
}
