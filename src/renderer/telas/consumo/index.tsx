import "../../casca/limites.css";
import "./consumo.css";
import { useEffect, useState } from "react";
import type { AlertaLimite } from "../../../compartilhado/limites";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { useCarga } from "../../estado/carga";
import { storeLimites, useLimites, type StoreLimites } from "../../estado/limites";
import { Icone } from "../../componentes/Icone";
import { useWorkspaces } from "../../estado/workspaces";
import { aoPedirCusto } from "../../estado/custo-acoes";
import { DetalhePorUso } from "./DetalhePorUso";
import { FontesPrecos } from "./FontesPrecos";
import { PrevisaoEficiencia } from "./PrevisaoEficiencia";
import { Trocas } from "./Trocas";
import type { ApiHarnessLike, ApiLimitesLike } from "./tipos";
import { VisaoGeral, type Agrupar, type Periodo } from "./VisaoGeral";

type AbaConsumo = "geral" | "previsao" | "trocas" | "detalhe" | "fontes";
const ABAS: ReadonlyArray<ItemSubNav<AbaConsumo>> = [
  { id: "geral", rotulo: "Visão geral", icone: "consumo" }, { id: "previsao", rotulo: "Previsão e eficiência", icone: "relatorios" }, { id: "trocas", rotulo: "Trocas", icone: "desfazer" },
  { id: "detalhe", rotulo: "Detalhe por uso", icone: "catalogo" }, { id: "fontes", rotulo: "Fontes e preços", icone: "loja" },
];
const AGRUPAMENTOS: ReadonlyArray<[Agrupar, string]> = [["conta", "Conta"], ["provedor", "Provedor"], ["modelo", "Modelo"], ["workspace", "Workspace"], ["missao", "Missão"], ["pane", "Pane"]];

export interface PropsTelaConsumo { store?: StoreLimites; apiLimites?: ApiLimitesLike | undefined; apiHarness?: ApiHarnessLike | undefined }

export function TelaConsumo({ store = storeLimites, apiLimites = ade()?.limites, apiHarness = ade()?.harness }: PropsTelaConsumo) {
  const { contas, rotulos, carregado, carregando, disponivel, erro } = useLimites(store);
  const wsAtual = useWorkspaces().atual?.id ?? null;
  const sprintsDoWorkspace = wsAtual === null || ade()?.relatorios?.sprints === undefined ? undefined : () => ade()!.relatorios.sprints(wsAtual).then((l) => l.map((s) => ({ id: s.id, nome: s.nome })));
  const [aba, setAba] = useState<AbaConsumo>("geral");
  const [periodo, setPeriodo] = useState<Periodo>("24h");
  const [agrupar, setAgrupar] = useState<Agrupar>("conta");
  const [filtro, setFiltro] = useState("");
  useEffect(() => { void store.iniciar(); }, [store]);
  useEffect(() => aoPedirCusto(["detalhe", "fontes"], (p) => { if (p === "detalhe") setAba("detalhe"); else if (p === "fontes") setAba("fontes"); }), []);
  const al = useCarga<AlertaLimite[]>(apiLimites?.alertas === undefined ? undefined : () => apiLimites.alertas!(), `al|${contas.map((c) => c.fetched_at).join()}`);

  return (
    <section className="consumo" data-modo="leitura" data-largura="larga" aria-label="Consumo">
     <SubNavegacao itens={ABAS} ativo={aba} onMudar={setAba} rotulo="Seções do consumo" base="consumo" recolhivel classePainel="consumo-corpo" barra={<>
      <div className="consumo-barra" role="toolbar" aria-label="Controles do consumo">
        <select aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          <option value="24h">24 h</option><option value="7d">7 dias</option><option value="30d">30 dias</option>
        </select>
        <select aria-label="Agrupar por" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
          {AGRUPAMENTOS.map(([v, r]) => <option key={v} value={v}>Agrupar: {r}</option>)}
        </select>
        <input type="search" aria-label="Filtrar contas" placeholder="Filtrar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <button type="button" className="botao-mini" disabled={carregando} aria-label="Atualizar limites" title="Atualizar limites" onClick={() => void store.atualizar()}><Icone nome="atualizar" /></button>
      </div>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
     </>}>
        {!disponivel ? <EstadoVazio icone="consumo" titulo="Limites indisponíveis" texto="Esta janela não está ligada ao app (ou o main não expõe os canais de limites). Abra o app para ver o consumo." />
          : !carregado ? <div aria-busy="true" className="consumo-nota">Lendo limites…</div>
          : aba === "geral" ? <VisaoGeral contas={contas} rotulos={rotulos} api={apiLimites} periodo={periodo} agrupar={agrupar} filtro={filtro} alertas={al.dados ?? []} />
          : aba === "previsao" ? <PrevisaoEficiencia contas={contas} rotulos={rotulos} api={apiLimites} alertas={al.dados ?? []} alertasEstado={al.estado} />
          : aba === "trocas" ? <Trocas api={apiHarness} />
          : aba === "detalhe" ? <DetalhePorUso workspaceId={wsAtual} sprints={sprintsDoWorkspace} />
          : <FontesPrecos workspaceId={wsAtual} />}
     </SubNavegacao>
    </section>
  );
}

export default function Tela() {
  return <TelaConsumo />;
}
