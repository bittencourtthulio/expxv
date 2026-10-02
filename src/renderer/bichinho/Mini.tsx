// <BichinhoMini workspaceId=… />: o bichinho de um workspace em ~36 px, para o card do painel de workspaces (e qualquer lista). Reage ao estado DAQUELE
// workspace, mesmo se ele não for o ativo. Lazy por natureza: quem importa este arquivo por `import()` não paga nada no boot.
import { useEffect, useRef, type ReactNode } from "react";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../estado/workspaces";
import { Figura } from "./Figura";
import { Casinha, useCasa, useForaDoPosto } from "./passeio/casa";
import { storeBichinho, useBichinhos, type StoreBichinho } from "./estado";
import { dicaDoBichinho } from "./util";
import "./bichinho.css";

export interface PropsMini { workspaceId: string; store?: StoreBichinho; nomeProjeto?: string; workspaces?: StoreWorkspaces }

export default function BichinhoMini({ workspaceId, store = storeBichinho, nomeProjeto, workspaces = storeWorkspaces }: PropsMini): ReactNode {
  const { visoes, subiu, nasceu, mostrar, silenciar, disponivel } = useBichinhos(store);
  const { recentes } = useWorkspaces(workspaces);
  useEffect(() => { void store.garantir([workspaceId]); }, [store, workspaceId]);
  const miniRef = useRef<HTMLSpanElement>(null);
  const chave = `card:${workspaceId}`;
  useCasa(chave, workspaceId, miniRef);
  const fora = useForaDoPosto(chave);
  const visao = visoes.get(workspaceId);
  if (!mostrar || !disponivel || visao === undefined) return null;
  const nome = nomeProjeto ?? recentes.find((w) => w.id === workspaceId)?.nome ?? null;
  return <span ref={miniRef} className="bi-mini" title={dicaDoBichinho(visao)}>{fora ? <Casinha /> : <Figura visao={visao} nomeProjeto={nome} subiu={subiu.has(workspaceId)} nasceu={nasceu.has(workspaceId)} silenciar={silenciar} />}</span>;
}
export { BichinhoMini };
