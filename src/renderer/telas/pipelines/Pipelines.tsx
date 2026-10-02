// Tela "Pipelines do método" (Fase 16, T-16.32): UMA linha de controles (abas) e o painel da aba. Lazy e pré-carregada em ocioso (ver `carga.ts`).
import { useEffect, useState, useSyncExternalStore } from "react";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { storeMaestro, useMaestro, type StoreMaestro } from "../../estado/maestro";
import { storeWorkspaces } from "../../estado/workspaces";
import { Intencao } from "./Intencao";
import { PainelPipeline } from "./PainelPipeline";
import { Etapas } from "./Etapas";
import { RigidezAba } from "./RigidezAba";
import { Provedores } from "./Provedores";
import "./pipelines.css";

export type AbaPipelines = "pipeline" | "intencao" | "etapas" | "rigidez" | "provedores";
const ABAS_BASE: ReadonlyArray<ItemSubNav<AbaPipelines>> = [
  { id: "pipeline", rotulo: "Pipeline", icone: "pipelines" },
  { id: "intencao", rotulo: "Intenção", icone: "chat" },
  { id: "etapas", rotulo: "Etapas", icone: "metodo" },
  { id: "rigidez", rotulo: "Rigidez", icone: "harness" },
  { id: "provedores", rotulo: "Provedores", icone: "provedores" },
];
const BASE = "pipelines";

export function TelaPipelines({ store = storeMaestro, abaInicial = "pipeline" }: { store?: StoreMaestro; abaInicial?: AbaPipelines }) {
  const [aba, setAba] = useState<AbaPipelines>(abaInicial);
  const ws = useSyncExternalStore(storeWorkspaces.assinar, () => storeWorkspaces.obter().atual?.id ?? null);
  const s = useMaestro(store);
  useEffect(() => { void store.definirWorkspace(ws); }, [store, ws]);
  // um plano novo (paleta, atalho do painel) leva à aba Intenção; ao executar, volta ao acompanhamento
  const temPlano = s.plano !== null;
  useEffect(() => { if (temPlano) setAba("intencao"); }, [temPlano, s.plano?.plano.id]);
  useEffect(() => { if (s.selecionadoId !== null && !temPlano) setAba("pipeline"); }, [s.selecionadoId, temPlano]);

  const ativos = s.ativos?.length ?? 0;
  return (
    <section className="pipelines" data-modo="cheia" aria-label="Pipelines do método">
     <SubNavegacao itens={ABAS_BASE} ativo={aba} onMudar={setAba} rotulo="Seções dos pipelines" base={BASE} recolhivel classePainel="pl-painel" barra={
      <div className="pl-barra"><span className="pl-contagem" aria-live="polite">{ativos === 0 ? "nenhum pipeline ativo" : `${ativos} ativo${ativos === 1 ? "" : "s"}`}</span></div>
     }>
        {aba === "pipeline" ? <PainelPipeline store={store} workspaceId={ws} aoIrParaIntencao={() => setAba("intencao")} /> : null}
        {aba === "intencao" ? <Intencao store={store} workspaceId={ws} aoExecutado={() => setAba("pipeline")} /> : null}
        {aba === "etapas" ? <Etapas workspaceId={ws} /> : null}
        {aba === "rigidez" ? <RigidezAba workspaceId={ws} /> : null}
        {aba === "provedores" ? <Provedores /> : null}
     </SubNavegacao>
    </section>
  );
}
