// "Abrir agente…" (modo livre, T-14.17): conversa direta com UM membro de squad num Pane avulso (sem Missão, sem portões).
import { useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { AgenteResumo, SquadResumo } from "../../../compartilhado/squads";
import { LIMITES_SQUAD } from "../../../compartilhado/squads";
import { Dialogo } from "../../componentes/Dialogo";
import { descreverPapel } from "./rascunho";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PropsAbrirAgente {
  api: ApiAde["agentes"] | undefined;
  squads: readonly SquadResumo[];
  squadInicial: string | null;
  workspaceId: string | null;
  aoFechar: () => void;
  aoAberto: (paneId: string) => void;
}

export function DialogoAbrirAgente({ api, squads, squadInicial, workspaceId, aoFechar, aoAberto }: PropsAbrirAgente) {
  const [squad, setSquad] = useState<string>(squadInicial ?? squads[0]?.slug ?? "");
  const [agentes, setAgentes] = useState<AgenteResumo[] | null>(null);
  const [agente, setAgente] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (api === undefined || squad === "") { setAgentes([]); return undefined; }
    let vivo = true;
    setAgentes(null);
    api.listar(squad)
      .then((l) => { if (vivo) { setAgentes(l); setAgente(l[0]?.agent_id ?? ""); } })
      .catch((e: unknown) => { if (vivo) { setAgentes([]); setErro(`Não foi possível listar os agentes: ${msg(e)}`); } });
    return () => { vivo = false; };
  }, [api, squad]);

  const excedeu = [...objetivo].length > LIMITES_SQUAD.objetivo_max;
  const rotuloDoAgente = (a: AgenteResumo): string => `${a.rotulo} · ${descreverPapel(a.papel)} · ${a.perfil.cli}${a.perfil.modelo !== null ? ` / ${a.perfil.modelo}` : ""}${a.vivos > 0 ? ` (${a.vivos} aberto)` : ""}`;
  const agenteEscolhido = (agentes ?? []).find((a) => a.agent_id === agente);
  const abrir = async (): Promise<void> => {
    if (api === undefined || workspaceId === null || agente === "") return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.abrirPane({ workspace_id: workspaceId, agent_id: agente, ...(objetivo.trim() === "" ? {} : { objetivo }) });
      aoAberto(r.pane_id);
    } catch (e) { setErro(`Não foi possível abrir o agente: ${msg(e)}`); setOcupado(false); }
  };

  return (
    <Dialogo titulo="Abrir agente" aoFechar={aoFechar} largura={520}>
      <p className="sq-vazio">Abre um terminal avulso com o modelo, o prompt e a permissão do agente escolhido. Sem Missão e sem portões: é uma conversa direta.</p>
      {workspaceId === null ? <p role="alert" className="aviso-caixa">Abra um workspace para abrir um agente.</p> : null}
      <label className="campo">Squad
        <select value={squad} onChange={(e) => setSquad(e.target.value)}>
          {squads.map((s) => <option key={s.slug} value={s.slug}>{s.nome}</option>)}
        </select>
      </label>
      <label className="campo">Agente
        <select value={agente} disabled={agentes === null || agentes.length === 0} title={agenteEscolhido === undefined ? undefined : rotuloDoAgente(agenteEscolhido)} onChange={(e) => setAgente(e.target.value)}>
          {(agentes ?? []).map((a) => <option key={a.agent_id} value={a.agent_id}>{rotuloDoAgente(a)}</option>)}
        </select>
      </label>
      <label className="campo">Primeira mensagem (opcional)
        <textarea value={objetivo} aria-invalid={excedeu} onChange={(e) => setObjetivo(e.target.value)} />
        {excedeu ? <span role="alert" className="campo-erro">No máximo {LIMITES_SQUAD.objetivo_max} caracteres.</span> : null}
      </label>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado || workspaceId === null || agente === "" || excedeu} onClick={() => void abrir()}>{ocupado ? "Abrindo…" : "Abrir agente"}</button>
      </div>
    </Dialogo>
  );
}
