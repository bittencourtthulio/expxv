import "./jarvis.css";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ApiJarvis, ApiRemoto } from "../../../compartilhado/jarvis";
import type { ApiRelay } from "../../../compartilhado/relay";
import { ade } from "../../ade";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { SubNavegacao } from "../../componentes/SubNavegacao";
import { aoPedirJarvis } from "../../estado/jarvis-acoes";
import { Auditoria } from "./Auditoria";
import { Conversa } from "./Conversa";
import { ABAS_JARVIS, type AbaJarvis } from "./logica";
import { Remoto } from "./Remoto";

// aba Relay: chunk próprio (P-160); nada é carregado nem consultado até a aba abrir
const AbaRelay = lazy(() => import("./relay"));

export interface PropsTelaJarvis {
  jarvis?: ApiJarvis | undefined;
  remoto?: ApiRemoto | undefined;
  relay?: ApiRelay | undefined;
  abaInicial?: AbaJarvis;
}

export function TelaJarvis({ jarvis = ade()?.jarvis, remoto = ade()?.remoto, relay = ade()?.relay, abaInicial = "conversa" }: PropsTelaJarvis) {
  const [aba, setAba] = useState<AbaJarvis>(abaInicial);
  useEffect(() => aoPedirJarvis((p) => setAba(p.aba)), []);
  if (jarvis === undefined || remoto === undefined) return <EstadoVazio icone="chat" titulo="Jarvis indisponível" texto="Esta janela não está ligada ao app. Abra o app para conversar com o Jarvis e configurar o controle remoto." />;
  return (
    <section className="jarvis-tela" data-modo="leitura" data-largura="larga" aria-label="Jarvis e controle remoto" data-tela-jarvis="">
     <SubNavegacao itens={ABAS_JARVIS} ativo={aba} onMudar={setAba} rotulo="Seções do Jarvis" base="jarvis" recolhivel classePainel="jarvis-corpo">
        {aba === "conversa" ? <Conversa api={jarvis} /> : aba === "remoto" ? <Remoto api={remoto} /> : aba === "relay" ? <Suspense fallback={<p className="jarvis-nota" role="status" aria-busy="true">Carregando…</p>}><AbaRelay api={relay} remoto={remoto} /></Suspense> : <Auditoria jarvis={jarvis} remoto={remoto} />}
     </SubNavegacao>
    </section>
  );
}
export default TelaJarvis;
