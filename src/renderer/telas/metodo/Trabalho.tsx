import { lazy, Suspense, useId, useState } from "react";
import type { Fase, Trabalho as DadosTrabalho } from "../../../nucleo/metodo/tipos";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { VirtualLista } from "../../componentes/VirtualLista";
import { AcoesMetodo } from "./AcoesMetodo";
import { Quadro } from "./Quadro";
import { Rastro } from "./Rastro";
import { Sinaleira } from "./Sinaleira";
import { Violacoes } from "./Violacoes";
import { ROTULO_STATUS_TASK, ROTULO_STATUS_TRABALHO, formatarDuracao, rotuloEstagio, rotuloVeredito } from "./util";

// O grafo é um chunk à parte: só baixa quando a aba é aberta.
const Grafo = lazy(() => import("./Grafo"));

type Aba = "plano" | "quadro" | "grafo" | "rastro";
const ABAS: readonly ItemSubNav<Aba>[] = [
  { id: "plano", rotulo: "Plano", icone: "catalogo" }, { id: "quadro", rotulo: "Quadro", icone: "missoes" }, { id: "grafo", rotulo: "Grafo", icone: "grafo" }, { id: "rastro", rotulo: "Rastro", icone: "desfazer" },
];

function FaseItem({ fase }: { fase: Fase }) {
  const [aberta, setAberta] = useState(false);
  const feitas = fase.tasks.filter((t) => t.status === "concluida").length;
  const linha = (t: Fase["tasks"][number]) => (
    <div className="met-task" data-status={t.status}>
      <b>{t.id}</b><span>{t.titulo}</span><span className="met-chip">{ROTULO_STATUS_TASK[t.status]}</span>
      <span className="met-suave">{t.duracao_observada_ms !== null ? `duração observada: ${formatarDuracao(t.duracao_observada_ms)}` : ""}</span>
    </div>
  );
  return (
    <div className="met-fase">
      <button type="button" aria-expanded={aberta} onClick={() => setAberta(!aberta)}>
        <span aria-hidden="true">{aberta ? "▾" : "▸"}</span> {fase.id} · {fase.titulo} <span className="met-suave">({feitas}/{fase.tasks.length} · {ROTULO_STATUS_TRABALHO[fase.status]})</span>
      </button>
      {aberta ? (fase.tasks.length > 60
        ? <div className="met-fase-tasks"><VirtualLista itens={fase.tasks} alturaItem={30} alturaPadrao={300} rotulo={`Tasks da fase ${fase.id}`} chave={(t) => t.id} renderItem={linha} /></div>
        : <div className="met-fase-tasks">{fase.tasks.map((t) => <div key={t.id}>{linha(t)}</div>)}</div>) : null}
    </div>
  );
}

function Plano({ t }: { t: DadosTrabalho }) {
  const abertos = t.bloqueios.filter((b) => b.aberto);
  return (
    <div className="met-plano">
      <section aria-label="Sprints, fases e tasks">
        <h3>Sprints, fases e tasks</h3>
        {t.sprints.length === 0 ? <p className="met-suave">Sem plano de sprints ainda.</p> : t.sprints.map((s) => (
          <div key={s.id} className="met-sprint">
            <h4>{s.id} · {s.titulo}</h4>
            {s.fases.map((f) => <FaseItem key={f.id} fase={f} />)}
          </div>
        ))}
      </section>
      <section aria-label="Bloqueios abertos">
        <h3>Bloqueios abertos</h3>
        {abertos.length === 0 ? <p className="met-suave">Nenhum bloqueio aberto.</p> : <ul>{abertos.map((b) => <li key={b.id}><b>{b.id}</b>{b.task ? ` (${b.task})` : ""}: {b.descricao}</li>)}</ul>}
      </section>
      <section aria-label="Violações">
        <h3>Violações deste trabalho</h3>
        <div className="met-caixa-lista"><Violacoes violacoes={t.violacoes} /></div>
      </section>
      <section aria-label="Vereditos">
        <h3>Vereditos</h3>
        <ul>
          <li>Auditoria: <b>{rotuloVeredito(t.veredito_auditoria)}</b></li>
          <li>QA: <b>{rotuloVeredito(t.veredito_qa)}</b></li>
          {t.prodx ? <li>Veredito prodx: <b>{t.prodx.veredito ?? "sem veredito"}</b> · {t.prodx.assinado ? "assinado" : "aguarda assinatura humana"}</li> : null}
        </ul>
      </section>
      <section aria-label="Entrega">
        <h3>Entrega</h3>
        {t.entrega ? (
          <ul>
            <li>Branch: <code>{t.entrega.branch ?? "—"}</code></li>
            <li>Portão: <b>{t.entrega.portao ?? "não verificado"}</b></li>
            <li>PR: {t.entrega.pr_url ? <code>{t.entrega.pr_url}</code> : "não aberto"}{t.entrega.pr_estado ? ` (${t.entrega.pr_estado})` : ""}</li>
            <li>{t.entrega.commits} commit(s)</li>
          </ul>
        ) : <p className="met-suave">Ainda sem entrega registrada.</p>}
      </section>
    </div>
  );
}

export function Trabalho({ workspaceId, trabalho }: { workspaceId: string; trabalho: DadosTrabalho }) {
  const [aba, setAba] = useState<Aba>("plano");
  const base = useId();
  return (
    <div className="met-detalhe">
      <header className="met-detalhe-topo">
        <div>
          <span className="met-chip">{trabalho.ferramenta}</span>
          <h2>{trabalho.titulo}</h2>
          <p className="met-suave">{rotuloEstagio(trabalho.estagio)} · {ROTULO_STATUS_TRABALHO[trabalho.status]}{trabalho.worktree ? ` · worktree ${trabalho.worktree}` : ""}</p>
        </div>
        <Sinaleira sinaleira={trabalho.sinaleira} />
      </header>
      <AcoesMetodo workspaceId={workspaceId} trabalho={trabalho} />
      <SubNavegacao base={base} rotulo="Visões do trabalho" className="subnav-aninhada" classePainel="met-painel" itens={ABAS} ativo={aba} onMudar={setAba}>
        {aba === "plano" ? <Plano t={trabalho} /> : null}
        {aba === "quadro" ? <Quadro trabalho={trabalho} /> : null}
        {aba === "grafo" ? <Suspense fallback={<p className="met-suave">Carregando o grafo…</p>}><Grafo trabalho={trabalho} /></Suspense> : null}
        {aba === "rastro" ? <Rastro workspaceId={workspaceId} trabalhoId={trabalho.id} /> : null}
      </SubNavegacao>
    </div>
  );
}
