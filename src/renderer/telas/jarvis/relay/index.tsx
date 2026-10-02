import { useEffect, useState } from "react";
import type { ApiRelay, ConfigRelay } from "../../../../compartilhado/relay";
import type { ApiRemoto } from "../../../../compartilhado/jarvis";
import { EstadoVazio } from "../../../componentes/EstadoVazio";
import { useEstadoRelay } from "../../../estado/relay";
import { AcessoRemotoRelay } from "./AcessoRemotoRelay";
import { RelayDispositivos } from "./RelayDispositivos";
import { RelayGuia } from "./RelayGuia";
import { RelayPareamento } from "./RelayPareamento";

/** Aba «Relay (experimental)»: carregada por `lazy` (chunk próprio); nada de rede ao abrir. */
export function AbaRelay({ api, remoto }: { api: ApiRelay | undefined; remoto?: ApiRemoto | undefined }) {
  const { estado, erro, recarregar } = useEstadoRelay(api);
  const [config, setConfig] = useState<ConfigRelay | null>(null);
  useEffect(() => {
    if (api === undefined) return;
    void api.configObter().then(setConfig, () => undefined);
  }, [api, estado?.ligado]);
  if (api === undefined) return <EstadoVazio icone="chat" titulo="Relay indisponível" texto="Esta janela não está ligada ao app. Abra o app para configurar o relay." />;
  if (erro !== null && estado === null)
    return (
      <div>
        <p role="alert" className="jarvis-erro">{erro}</p>
        <button type="button" className="jarvis-botao" onClick={() => void recarregar()}>Tentar de novo</button>
      </div>
    );
  if (estado === null || config === null) return <p className="jarvis-nota" role="status" aria-busy="true">Carregando…</p>;
  return (
    <div className="jarvis-remoto">
      <AcessoRemotoRelay api={api} estado={estado} config={config} aoMudar={() => void recarregar()} />
      <RelayPareamento api={api} ligado={estado.ligado} aoMudar={() => void recarregar()} aoEventoRemoto={remoto === undefined ? undefined : (cb) => remoto.assinar(cb)} />
      <RelayDispositivos api={api} versao={`${estado.situacao}|${estado.dispositivos}`} />
      <RelayGuia />
    </div>
  );
}
export default AbaRelay;
