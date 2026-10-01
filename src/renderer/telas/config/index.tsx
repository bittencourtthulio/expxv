import "./config.css";
import { useEffect } from "react";
import { Pagina } from "../../componentes/Pagina";
import { storeConfig, type StoreConfig } from "../../estado/config";
import {
  SecaoAtalhos, SecaoCor, SecaoDiagnostico, SecaoLimitePaineis, SecaoNotificacoes, SecaoPermissao, SecaoScrollback, SecaoSobre, SecaoTema,
} from "./Secoes";

export function TelaConfig({ store = storeConfig }: { store?: StoreConfig }) {
  useEffect(() => { void store.iniciar(); }, [store]);
  return (
    <Pagina titulo="Configurações" subtitulo="Tema, cor, limites e atalhos.">
      <div className="cfg-secoes">
        <SecaoTema />
        <SecaoCor store={store} />
        <SecaoScrollback store={store} />
        <SecaoLimitePaineis store={store} />
        <SecaoPermissao store={store} />
        <SecaoNotificacoes store={store} />
        <SecaoAtalhos />
        <SecaoDiagnostico />
        <SecaoSobre />
      </div>
    </Pagina>
  );
}

export default function Tela() {
  return <TelaConfig />;
}
