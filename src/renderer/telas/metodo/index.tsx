import { useEffect, useId, useState } from "react";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { Pagina } from "../../componentes/Pagina";
import { storeMetodo, useMetodo, type StoreMetodo } from "../../estado/metodo";
import { Pedido } from "./Pedido";
import { Instalacao } from "./Instalacao";
import { GuardaMetodo } from "./Guarda";
import { Saude } from "./Saude";
import { useAvancarGeracao } from "./ContextoProjeto";
import { storeSuite, useSuite } from "../../estado/suite";
import { Violacoes } from "./Violacoes";
import "./metodo.css";

type Aba = "pedido" | "violacoes" | "instalacao" | "saude";
const ABAS: readonly ItemSubNav<Aba>[] = [
  { id: "pedido", rotulo: "Pedido", icone: "chat" }, { id: "violacoes", rotulo: "Violações", icone: "alerta" }, { id: "instalacao", rotulo: "Instalação", icone: "baixar" }, { id: "saude", rotulo: "Saúde", icone: "harness" },
];

export default function Tela({ store = storeMetodo }: { store?: StoreMetodo }) {
  const { workspaceId, indice, carregado, erro } = useMetodo(store);
  const [aba, setAba] = useState<Aba>("pedido");
  // o modal de instalação pede "ajustar módulos": a tela abre na aba Instalação, onde mora a seção "Módulos da suíte", e leva o foco até ela (consome o pedido)
  const pedidoAba = useSuite().metodoAba;
  useEffect(() => {
    if (pedidoAba !== "modulos") return;
    setAba("instalacao");
    storeSuite.limparAbaMetodo();
    const t = setTimeout(() => document.querySelector<HTMLElement>('[aria-label="Módulos da suíte"]')?.scrollIntoView?.({ block: "start" }), 50);
    return () => clearTimeout(t);
  }, [pedidoAba]);
  const base = useId();
  useEffect(() => store.iniciar(), [store]);
  // a sequência "Gerar o que falta" segue andando em qualquer aba enquanto a tela está aberta (o arquivo apareceu no índice → dispara o próximo)
  useAvancarGeracao(workspaceId, indice);

  const subtitulo = "Peça uma feature, um bug ou um projeto ao agente e acompanhe o envio.";
  const guarda = GuardaMetodo({ workspaceId, carregado, erro, aoQue: "o método" });
  if (guarda !== null || !workspaceId) return <Pagina modo="painel" largura="total" titulo="Método" subtitulo={subtitulo}>{guarda}</Pagina>;
  if (!indice) {
    return (
      <Pagina modo="painel" largura="total" titulo="Método" subtitulo={subtitulo}>
        <div className="met-pedido-solo">
          <p className="met-suave">Esta pasta ainda não tem docs do método. Isso é normal em um projeto novo: o primeiro pedido cria a pasta docs/.</p>
          <Pedido key={workspaceId} workspaceId={workspaceId} indice={null} />
        </div>
      </Pagina>
    );
  }
  return (
    <Pagina modo="painel" largura="total" titulo="Método" subtitulo={subtitulo}>
      <SubNavegacao
        base={base} rotulo="Seções do método" ativo={aba} onMudar={setAba} classePainel={aba === "pedido" ? "met-corpo met-corpo-chat" : "met-corpo"}
        itens={ABAS.map((a) => (a.id === "violacoes" && indice.violacoes.length > 0 ? { ...a, selo: indice.violacoes.length } : a))}
      >
      {aba === "pedido" ? <Pedido key={workspaceId} workspaceId={workspaceId} indice={indice} /> : null}
      {aba === "violacoes" ? <div className="met-caixa-lista"><Violacoes violacoes={indice.violacoes} /></div> : null}
      {aba === "instalacao" ? <Instalacao indice={indice} workspaceId={workspaceId} /> : null}
      {aba === "saude" ? <Saude indice={indice} /> : null}
      </SubNavegacao>
    </Pagina>
  );
}
