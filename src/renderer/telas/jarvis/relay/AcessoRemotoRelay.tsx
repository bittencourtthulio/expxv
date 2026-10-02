import { useState } from "react";
import { TEXTO_CONSENTIMENTO_RELAY, TEXTO_CONSENTIMENTO_RELAY_VERSAO, type ApiRelay, type ConfigRelay, type EstadoRelay } from "../../../../compartilhado/relay";
import { ERRO_LIGAR_RELAY, SITUACAO_RELAY, erroDeUrl } from "./relay-logica";

/** Estado, consentimento versionado, reconhecimento «experimental», ligar/desligar e pânico. Nada liga sozinho; reiniciar o app deixa desligado. */
export function AcessoRemotoRelay({ api, estado, config, aoMudar }: { api: ApiRelay; estado: EstadoRelay; config: ConfigRelay; aoMudar: () => void }) {
  const [url, setUrl] = useState(config.url);
  const [leu, setLeu] = useState(false);
  const [ciente, setCiente] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [panicoPedido, setPanicoPedido] = useState(false);
  const s = SITUACAO_RELAY[estado.situacao];
  const erroUrl = url === "" ? null : erroDeUrl(url);
  const pode = leu && ciente && erroDeUrl(url) === null && !ocupado;

  const rodar = async (f: () => Promise<void>): Promise<void> => {
    setOcupado(true);
    setAviso(null);
    try {
      await f();
    } catch {
      setAviso("Não foi possível concluir a operação.");
    } finally {
      setOcupado(false);
      aoMudar();
    }
  };
  const ligar = (): Promise<void> =>
    rodar(async () => {
      await api.configDefinir({ url: url.trim(), consentimento_versao: TEXTO_CONSENTIMENTO_RELAY_VERSAO, reconhecimento_experimental: true });
      const r = await api.ligar();
      if (!r.ok) setAviso(ERRO_LIGAR_RELAY[r.motivo ?? "falhou"]);
      else {
        setLeu(false);
        setCiente(false);
      }
    });

  return (
    <section aria-labelledby="relay-estado" className="jarvis-bloco">
      <p className="jarvis-aviso-destaque" role="note">EXPERIMENTAL. A criptografia deste acesso remoto não passou por revisão externa. Use só com o seu próprio relay e desligue quando não precisar. Ele nasce desligado e volta desligado ao reiniciar o app.</p>
      {aviso !== null ? <p role="alert" className="jarvis-erro">{aviso}</p> : null}
      <h2 id="relay-estado">Relay: <span data-estado={estado.situacao} role="status" aria-live="polite"><span aria-hidden="true">{s.forma}</span> {s.texto}</span></h2>
      {!estado.ligado ? (
        <>
          <div className="jarvis-linha">
            <label htmlFor="relay-url" className="jarvis-rotulo-campo">Endereço do seu relay</label>
            <input id="relay-url" className="jarvis-campo" inputMode="url" autoComplete="off" spellCheck={false} placeholder="wss://relay.seudominio.com" value={url} aria-invalid={erroUrl !== null} aria-describedby={erroUrl === null ? undefined : "relay-url-erro"} onChange={(e) => setUrl(e.target.value)} />
          </div>
          {erroUrl !== null ? <p id="relay-url-erro" className="jarvis-nota" role="status">{erroUrl}</p> : null}
          <fieldset className="jarvis-fieldset">
            <legend>O que o relay vê e o que não vê</legend>
            <p className="jarvis-nota">O relay VÊ:</p>
            <ul className="jarvis-linhas">{TEXTO_CONSENTIMENTO_RELAY.ve.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="jarvis-nota">O relay NÃO vê:</p>
            <ul className="jarvis-linhas">{TEXTO_CONSENTIMENTO_RELAY.naoVe.map((t) => <li key={t}>{t}</li>)}</ul>
          </fieldset>
          <label className="jarvis-check"><input type="checkbox" checked={leu} onChange={(e) => setLeu(e.target.checked)} /> Li o que o relay vê e o que não vê.</label>
          <label className="jarvis-check"><input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} /> {TEXTO_CONSENTIMENTO_RELAY.reconhecimento}</label>
          <div className="jarvis-linha">
            <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={!pode} onClick={() => void ligar()}>Ligar relay</button>
          </div>
        </>
      ) : (
        <>
          <p className="jarvis-nota">Relay: <span className="jarvis-detalhe">{estado.url}</span> · {estado.dispositivos} celular{estado.dispositivos === 1 ? "" : "es"} pareado{estado.dispositivos === 1 ? "" : "s"}</p>
          <div className="jarvis-linha">
            <button type="button" className="jarvis-botao" disabled={ocupado} onClick={() => void rodar(async () => void (await api.desligar()))}>Desligar relay</button>
            {panicoPedido ? (
              <>
                <button type="button" className="jarvis-botao jarvis-botao-perigo" disabled={ocupado} onClick={() => void rodar(async () => { await api.panico(); setPanicoPedido(false); })}>Confirmar pânico: fechar tudo e revogar todos</button>
                <button type="button" className="jarvis-botao" onClick={() => setPanicoPedido(false)}>Cancelar</button>
              </>
            ) : <button type="button" data-sem-travessura className="jarvis-botao jarvis-botao-perigo" onClick={() => setPanicoPedido(true)}>Pânico</button>}
          </div>
        </>
      )}
    </section>
  );
}
