import "./config.css";
import { useEffect, useState, type ReactElement } from "react";
import { aoPedirSecaoConfig, consumirSecaoConfigPedida } from "../../estado/navegacao";
import { Pagina } from "../../componentes/Pagina";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { storeConfig, type StoreConfig } from "../../estado/config";
import {
  SecaoAtalhos, SecaoCor, SecaoDiagnostico, SecaoLimitePaineis, SecaoNotificacoes, SecaoPermissao, SecaoScrollback, SecaoSobre, SecaoTema,
} from "./Secoes";
import { SecaoBichinhos } from "./SecaoBichinhos";
import { SecaoMemoria } from "./SecaoMemoria";
import { SecaoProgresso } from "./SecaoProgresso";
import { SecaoModulosPadrao } from "./SecaoModulosPadrao";
import { SecaoVozCaptura } from "./SecaoVozCaptura";
import { SecaoAprovacaoWorkers } from "../terminais/aprovacao-workers";

export type SecaoConfig = "tema" | "cor" | "scrollback" | "limite" | "permissao" | "aprovacao_workers" | "notificacoes" | "atalhos" | "memoria" | "modulos" | "voz" | "diagnostico" | "sobre";
export const SECOES_CONFIG: ReadonlyArray<ItemSubNav<SecaoConfig>> = [
  { id: "tema", rotulo: "Tema", icone: "lua", grupo: "Aparência" },
  { id: "cor", rotulo: "Cor de destaque", icone: "sol", grupo: "Aparência" },
  { id: "scrollback", rotulo: "Histórico do terminal", icone: "terminais", grupo: "Terminais" },
  { id: "limite", rotulo: "Limite de painéis", icone: "dividirLado", grupo: "Terminais" },
  { id: "permissao", rotulo: "Permissão das CLIs", icone: "harness", grupo: "Terminais" },
  { id: "aprovacao_workers", rotulo: "Aprovações dos workers", icone: "harness", grupo: "Terminais" },
  { id: "notificacoes", rotulo: "Notificações", icone: "alerta", grupo: "Avisos e atalhos" },
  { id: "atalhos", rotulo: "Atalhos", icone: "codigo", grupo: "Avisos e atalhos" },
  { id: "memoria", rotulo: "Memória", icone: "memoria", grupo: "Recursos" },
  { id: "modulos", rotulo: "Módulos da suíte", icone: "metodo", grupo: "Recursos" },
  { id: "voz", rotulo: "Voz e captura", icone: "chat", grupo: "Recursos" },
  { id: "diagnostico", rotulo: "Diagnóstico", icone: "aviso", grupo: "Sistema" },
  { id: "sobre", rotulo: "Sobre", icone: "ajuda", grupo: "Sistema" },
];

function Secao({ id, store }: { id: SecaoConfig; store: StoreConfig }): ReactElement {
  switch (id) {
    case "tema": return <><SecaoTema /><SecaoBichinhos /></>;
    case "cor": return <SecaoCor store={store} />;
    case "scrollback": return <SecaoScrollback store={store} />;
    case "limite": return <><SecaoLimitePaineis store={store} /><SecaoProgresso /></>;
    case "permissao": return <SecaoPermissao store={store} />;
    case "aprovacao_workers": return <SecaoAprovacaoWorkers />;
    case "notificacoes": return <SecaoNotificacoes store={store} />;
    case "atalhos": return <SecaoAtalhos />;
    case "memoria": return <SecaoMemoria />;
    case "modulos": return <SecaoModulosPadrao />;
    case "voz": return <SecaoVozCaptura />;
    case "diagnostico": return <SecaoDiagnostico />;
    case "sobre": return <SecaoSobre />;
  }
}

export function TelaConfig({ store = storeConfig, secaoInicial = "tema" }: { store?: StoreConfig; secaoInicial?: SecaoConfig }) {
  useEffect(() => { void store.iniciar(); }, [store]);
  const [secao, setSecao] = useState<SecaoConfig>(() => consumirSecaoConfigPedida() ?? secaoInicial);
  // já montada (visitada antes): o pedido chega pelo ouvinte e o pendente é descartado
  useEffect(() => aoPedirSecaoConfig((s) => { consumirSecaoConfigPedida(); setSecao(s); }), []);
  return (
    <Pagina modo="leitura" largura="padrao" titulo="Configurações" subtitulo="Tema, cor, limites e atalhos.">
      <SubNavegacao base="cfg" rotulo="Seções das configurações" itens={SECOES_CONFIG} ativo={secao} onMudar={setSecao} recolhivel classePainel="cfg-painel">
        <div className="cfg-secoes"><Secao id={secao} store={store} /></div>
      </SubNavegacao>
    </Pagina>
  );
}

export default function Tela() {
  return <TelaConfig />;
}
