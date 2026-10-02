import { useEffect, useState } from "react";
import { aoPedirVcs } from "../../estado/vcs-acoes";
import type { Mission } from "../../../compartilhado/dominio";
import type { ResultadoLease, ResultadoPull } from "../../../compartilhado/vcs-tipos";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { useVcs } from "./contexto";
import { DialogoDigitar } from "./Dialogos";
import { PreferenciasVcs } from "./PreferenciasVcs";

export interface PropsBarra {
  missoes: readonly Mission[];
  aoTrocarArvore: (missionId: string | null) => void;
  ocupado: boolean;
}

/** Linha única de controles (D-32): árvore, branch + ahead/behind + sujo, ações de remoto/atualizar. */
export function Barra({ missoes, aoTrocarArvore, ocupado }: PropsBarra) {
  const { api, alvo, estado, rodar, recarregar, avisar } = useVcs();
  const s = estado.status;
  const ehSvn = estado.tipo === "svn";
  const [push, setPush] = useState(false);
  const [pull, setPull] = useState<ResultadoPull | null>(null);
  const [lease, setLease] = useState<ResultadoLease | null>(null);

  const buscar = async (): Promise<void> => {
    const r = await rodar(() => api.remoto(alvo, "fetch", { remoto: null, todos: true, podar: false }));
    if (r !== undefined) { avisar(`Fetch: ${r.atualizacoes} atualização(ões) em ${r.remotos.join(", ") || "nenhum remoto"}.`); await recarregar(); }
  };
  const simularPull = async (): Promise<void> => {
    const r = await rodar(() => api.remoto(alvo, "pull", { modo: null, remoto: null, ramo: null, simular: true }));
    if (r !== undefined) setPull(r);
  };
  const puxar = async (): Promise<void> => {
    setPull(null);
    const r = await rodar(() => api.remoto(alvo, "pull", { modo: null, remoto: null, ramo: null, simular: false }));
    if (r !== undefined) { avisar(r.resultado === "conflito" ? "Pull com conflitos: resolva na aba Conflitos." : `Pull: ${r.resultado}.`); await recarregar(); }
  };
  const enviar = async (): Promise<void> => {
    setPush(false);
    const r = await rodar(() => api.remoto(alvo, "push", { remoto: null, ramo: null }));
    if (r !== undefined) { avisar(r.atualizado ? `Enviado ${r.ramo} para ${r.remoto}${r.upstreamDefinido ? " (upstream definido)" : ""}.` : "Nada a enviar."); await recarregar(); }
  };
  const atualizarSvn = async (): Promise<void> => {
    const r = await rodar(() => api.svn(alvo, "atualizar", { revisao: null, caminhos: null }));
    if (r !== undefined) { avisar(`${r.resumo}${r.conflitos.length > 0 ? ` — ${r.conflitos.length} conflito(s)` : ""}`); await recarregar(); }
  };
  const abrirLease = async (): Promise<void> => {
    if (s.branch === null || s.upstream === null) return;
    const ramos = await rodar(() => api.ramos(alvo, "listar", { remotos: true }));
    const remoto = ramos?.find((r) => r.remoto && r.nome === s.upstream);
    if (remoto === undefined) { avisar("Não achei a referência do remoto para o lease; faça fetch antes."); return; }
    const r = await rodar(() => api.remoto(alvo, "lease", { remoto: null, ramo: s.branch as string, ref_esperada: remoto.hash, confirmacao: null, simular: true }));
    if (r !== undefined) setLease(r);
  };
  const forcar = async (): Promise<void> => {
    if (lease === null || s.branch === null) return;
    const l = lease;
    setLease(null);
    const r = await rodar(() => api.remoto(alvo, "lease", { remoto: null, ramo: l.ramo, ref_esperada: l.refEsperada, confirmacao: s.branch, simular: false }));
    if (r !== undefined) { avisar(r.enviado ? `Sobrescrito ${l.remoto}/${l.ramo} com lease.` : "O remoto mudou: nada foi sobrescrito."); await recarregar(); }
  };

  useEffect(() => aoPedirVcs((p) => { if (p === "fetch") void buscar(); else if (p === "pull") void simularPull(); else if (p === "push") setPush(true); }, ["fetch", "pull", "push"]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.workspace_id, alvo.mission_id]);

  const arvores = missoes.filter((m) => m.worktree !== null);
  const divergiu = s.ahead > 0 && s.behind > 0;
  const arvoreAtual = arvores.find((m) => m.id === alvo.mission_id);
  const rotuloArvore = arvoreAtual === undefined ? "Workspace" : `Missão · ${arvoreAtual.titulo}`;
  return (
    <div className="vc-barra" role="toolbar" aria-label="Controles do versionamento">
      <select className="vc-campo vc-seletor" aria-label="Árvore de trabalho" title={rotuloArvore} value={alvo.mission_id ?? ""} onChange={(e) => aoTrocarArvore(e.target.value === "" ? null : e.target.value)}>
        <option value="">Workspace</option>
        {arvores.map((m) => <option key={m.id} value={m.id}>Missão · {m.titulo}</option>)}
      </select>
      <span className="vc-barra-branch" title={ehSvn ? "Cópia de trabalho SVN" : "Branch atual"}>
        <Icone nome="ramo" />
        <strong>{s.branch ?? (ehSvn ? "SVN" : s.oid?.slice(0, 7) ?? "sem commits")}</strong>
        {s.upstream !== null ? <span className="vc-pasta">→ {s.upstream}</span> : null}
        {s.ahead > 0 ? <span className="vc-mais" title={`${s.ahead} commit(s) para enviar`}>↑{s.ahead}</span> : null}
        {s.behind > 0 ? <span className="vc-menos" title={`${s.behind} commit(s) para receber`}>↓{s.behind}</span> : null}
        {estado.resumo.sujo ? <span className="vc-sujo" title="Há mudanças não comitadas" aria-label="com mudanças">●</span> : null}
        {estado.ramo_protegido ? <span className="vc-protegido" title="Branch padrão: ações destrutivas pedem confirmação digitada e a automação não comita aqui">padrão</span> : null}
      </span>
      <span className="vc-espaco" />
      <button type="button" className="vc-icone" aria-label="Atualizar estado" title="Atualizar estado" disabled={ocupado} onClick={() => void recarregar()}><Icone nome="atualizar" /></button>
      {ehSvn ? (
        <button type="button" className="vc-icone" aria-label="Atualizar do servidor (svn update)" title="Atualizar do servidor (svn update)" onClick={() => void atualizarSvn()}><Icone nome="baixar" /></button>
      ) : (
        <>
          <button type="button" className="vc-icone" aria-label="Fetch" title="Fetch (busca do remoto sem alterar sua árvore)" onClick={() => void buscar()}><Icone nome="atualizar" /><span className="vc-icone-rotulo">fetch</span></button>
          <button type="button" className="vc-icone" aria-label="Pull" title="Pull (mostra o que entra antes)" disabled={s.upstream === null} onClick={() => void simularPull()}><Icone nome="baixar" /><span className="vc-icone-rotulo">pull</span></button>
          <button type="button" className="vc-icone" aria-label="Push" title="Push (pede confirmação)" disabled={s.branch === null} onClick={() => setPush(true)}><Icone nome="subir" /><span className="vc-icone-rotulo">push</span></button>
          {divergiu && !estado.ramo_protegido && s.branch !== null ? <button type="button" className="vc-mini vc-perigo" onClick={() => void abrirLease()} title="Sobrescrever o remoto (ação manual com confirmação digitada)">Forçar…</button> : null}
        </>
      )}
      <PreferenciasVcs />
      {push ? (
        <DialogoConfirmacao titulo="Enviar para o remoto?" rotuloConfirmar="Enviar (push)" texto={<>Enviar <strong>{s.ahead}</strong> commit(s) de <code>{s.branch}</code> para {s.upstream !== null ? <code>{s.upstream}</code> : "o remoto (um upstream será definido)"}. Nunca é push forçado.</>} aoCancelar={() => setPush(false)} aoConfirmar={() => void enviar()} />
      ) : null}
      {pull !== null ? (
        <Dialogo titulo="Receber do remoto (pull)" aoFechar={() => setPull(null)} largura={560}>
          <div className="dialogo-corpo">
            {pull.resultado === "ja-atualizado" || (pull.entrariam?.length ?? 0) === 0 ? <p>Você já está atualizado.</p> : (
              <>
                <p>{pull.entrariam?.length} commit(s) entram em <code>{s.branch}</code> (modo {pull.modoUsado}):</p>
                <ul className="vc-lista-simples">{pull.entrariam?.slice(0, 20).map((c) => <li key={c.hash}><code>{c.hashCurto}</code> {c.assunto} <span className="vc-pasta">{c.autor}</span></li>)}</ul>
              </>
            )}
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={() => setPull(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" disabled={(pull.entrariam?.length ?? 0) === 0} onClick={() => void puxar()}>Fazer pull</button>
          </div>
        </Dialogo>
      ) : null}
      {lease !== null && s.branch !== null ? (
        <DialogoDigitar titulo="Sobrescrever o remoto (force with lease)" esperado={s.branch} rotuloConfirmar="Sobrescrever remoto" aoCancelar={() => setLease(null)} aoConfirmar={() => void forcar()} texto={<>
          <p className="vc-aviso" role="alert">Isto reescreve a história publicada. Estes {lease.sobrescreveria.length} commit(s) do remoto serão perdidos para quem os baixou:</p>
          <ul className="vc-lista-simples">{lease.sobrescreveria.slice(0, 15).map((c) => <li key={c.hash}><code>{c.hashCurto}</code> {c.assunto} <span className="vc-pasta">{c.autor}</span></li>)}</ul>
          <p>O git recusa se o remoto mudou desde o que você viu.</p></>} />
      ) : null}
    </div>
  );
}
