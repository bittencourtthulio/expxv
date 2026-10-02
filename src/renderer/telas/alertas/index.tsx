import "../../casca/alertas.css";
import "./alertas.css";
import { useEffect, useMemo, useState } from "react";
import type { ApiAlertas, MetaTipoVisao } from "../../../compartilhado/alertas";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { aoPedirAlertas, type AbaAlertas } from "../../estado/alertas-acoes";
import { useWorkspaces } from "../../estado/workspaces";
import { Auditoria } from "./Auditoria";
import { Canais } from "./Canais";
import { Lista } from "./Lista";
import { ABAS_ALERTAS } from "./logica";
import { Modelos } from "./Modelos";
import { Regras } from "./Regras";

export interface PropsTelaAlertas { api?: ApiAlertas | undefined; abaInicial?: AbaAlertas }

export function TelaAlertas({ api = ade()?.alertas, abaInicial = "alertas" }: PropsTelaAlertas) {
  const [aba, setAba] = useState<AbaAlertas>(abaInicial);
  const [catalogo, setCatalogo] = useState<MetaTipoVisao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ws = useWorkspaces();
  const workspaces = useMemo(() => {
    const todos = [...(ws.atual === null ? [] : [ws.atual]), ...ws.recentes];
    return [...new Map(todos.map((w) => [w.id, { id: w.id, nome: w.nome }])).values()];
  }, [ws.atual, ws.recentes]);
  useEffect(() => aoPedirAlertas((p) => setAba(p.aba)), []);
  useEffect(() => {
    if (api === undefined) return;
    let vivo = true;
    void api.catalogo().then((c) => { if (vivo) setCatalogo(c); }, (e) => { if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível ler o catálogo de alertas."); });
    return () => { vivo = false; };
  }, [api]);

  if (api === undefined) return <EstadoVazio icone="alerta" titulo="Alertas indisponíveis" texto="Esta janela não está ligada ao app. Abra o app para ver os alertas e configurar o Telegram." />;
  return (
    <section className="alertas-tela" data-modo="leitura" data-largura="larga" aria-label="Alertas">
     <SubNavegacao itens={ABAS_ALERTAS} ativo={aba} onMudar={setAba} rotulo="Seções dos alertas" base="alertas" recolhivel classePainel="alertas-corpo">
        {erro !== null ? <p role="alert" className="alertas-erro">{erro}</p>
          : catalogo === null ? <p className="alertas-nota" role="status" aria-busy="true">Carregando…</p>
          : aba === "alertas" ? <Lista api={api} catalogo={catalogo} workspaces={workspaces} />
          : aba === "regras" ? <Regras api={api} catalogo={catalogo} aoAbrirCanais={() => setAba("canais")} />
          : aba === "canais" ? <Canais api={api} workspaces={workspaces} />
          : aba === "modelos" ? <Modelos api={api} catalogo={catalogo} />
          : <Auditoria api={api} />}
     </SubNavegacao>
    </section>
  );
}
export default TelaAlertas;
