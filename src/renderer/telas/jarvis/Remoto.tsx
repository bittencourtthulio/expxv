import { useCallback, useEffect, useRef, useState } from "react";
import { PERMISSOES_REMOTAS, TEXTO_CONSENTIMENTO_REMOTO, TEXTO_CONSENTIMENTO_REMOTO_VERSAO, type ApiRemoto, type DispositivoVisao, type ErroLigarRemoto, type EstadoRemoto, type PermissaoRemota, type TransporteRemoto } from "../../../compartilhado/jarvis";
import { ItemLista } from "../../componentes/ItemLista";
import { codigoVisivel, contagemRegressiva, enderecoDeParear, EXPLICACAO_PERMISSAO, PALAVRA_DIRETA, podeConfirmarPermissao, resumoTransporte, ROTULO_ACAO, ROTULO_PERMISSAO, tempoRelativo } from "./logica";

const ERRO_LIGAR: Record<ErroLigarRemoto, string> = {
  sem_rede_privada: "Nenhuma rede privada encontrada. Conecte-se a uma rede local (Wi-Fi de casa ou do escritório) e tente de novo.",
  porta_ocupada: "A porta escolhida está ocupada. Escolha outra nas opções avançadas.",
  consentimento_ausente: "Marque que entendeu o aviso para ligar.",
  ja_ligado: "O controle remoto já está ligado.",
  falhou: "Não foi possível ligar o controle remoto agora.",
};

export function Remoto({ api, agora = () => Date.now() }: { api: ApiRemoto; agora?: () => number }) {
  const [e, setE] = useState<EstadoRemoto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [relogio, setRelogio] = useState(agora());
  const [transporte, setTransporte] = useState<TransporteRemoto>("lan");
  const [interfaceIp, setInterfaceIp] = useState("auto");
  const [ciente, setCiente] = useState(false);
  const [permissaoPar, setPermissaoPar] = useState<PermissaoRemota>("leitura");
  const [codigo, setCodigo] = useState<{ codigo: string; expira_em: string } | null>(null);
  const [palavra, setPalavra] = useState("");
  const [panicoPedido, setPanicoPedido] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const ler = useCallback(async () => {
    try {
      setE(await api.estado());
      setErro(null);
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível ler o estado do controle remoto.");
    }
  }, [api]);
  useEffect(() => {
    void ler();
    return api.assinar(() => void ler());
  }, [api, ler]);
  useEffect(() => {
    const t = setInterval(() => setRelogio(agora()), 1000);
    return () => clearInterval(t);
  }, [agora]);
  const ligado = e?.transporte.ligado === true;
  // o código aparece UMA vez e some ao expirar (ou ao ser usado: a janela deixa de existir no estado)
  const viuPareando = useRef(false);
  useEffect(() => {
    if (e?.transporte.pareando === true) viuPareando.current = true;
    // some ao expirar, ao ser usado ou cancelado (a janela do servidor fechou depois de ter sido vista aberta)
    if (codigo !== null && (!codigoVisivel(codigo.expira_em, relogio) || (viuPareando.current && e?.transporte.pareando === false))) {
      viuPareando.current = false;
      setCodigo(null);
    }
  }, [codigo, relogio, e?.transporte.pareando]);

  const rodar = async (f: () => Promise<unknown>): Promise<void> => {
    setOcupado(true);
    setAviso(null);
    try {
      await f();
    } catch {
      setAviso("Não foi possível concluir a operação.");
    } finally {
      setOcupado(false);
      void ler();
    }
  };

  if (erro !== null && e === null)
    return (
      <div>
        <p role="alert" className="jarvis-erro">{erro}</p>
        <button type="button" className="jarvis-botao" onClick={() => void ler()}>Tentar de novo</button>
      </div>
    );
  if (e === null) return <p className="jarvis-nota" role="status" aria-busy="true">Carregando…</p>;
  const privadas = e.interfaces.filter((i) => i.privado);
  const endereco = enderecoDeParear(e.transporte);

  const ligar = (): Promise<void> =>
    rodar(async () => {
      const r = await api.ligar({ transporte, interface: interfaceIp, consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO });
      if ("erro" in r) setAviso(ERRO_LIGAR[r.erro]);
    });
  const parear = (): Promise<void> =>
    rodar(async () => {
      const r = await api.parearIniciar(permissaoPar);
      if ("erro" in r) setAviso(ERRO_LIGAR[r.erro]);
      else {
        viuPareando.current = false;
        setCodigo(r);
      }
    });
  const mostrarCodigo = codigo !== null && codigoVisivel(codigo.expira_em, relogio);

  return (
    <div className="jarvis-remoto">
      <p className="jarvis-aviso-destaque" role="note">
        Só use em rede confiável. O celular não consegue provar a página que recebe, então alguém que controle a rede pode tentar enganá-lo. O servidor nasce desligado, não liga sozinho ao abrir o app e fecha ao sair.
      </p>
      {aviso !== null ? <p role="alert" className="jarvis-erro">{aviso}</p> : null}

      <section aria-labelledby="remoto-estado" className="jarvis-bloco">
        <h2 id="remoto-estado">Servidor local: <span data-estado={ligado ? "ligado" : "desligado"}>{resumoTransporte(e.transporte)}</span></h2>
        {!ligado ? (
          <>
            <fieldset className="jarvis-fieldset">
              <legend>Como ligar</legend>
              <label className="jarvis-check"><input type="radio" name="transporte" checked={transporte === "lan"} onChange={() => setTransporte("lan")} /> Rede local com HTTPS (celular na mesma Wi-Fi)</label>
              <label className="jarvis-check"><input type="radio" name="transporte" checked={transporte === "loopback"} onChange={() => setTransporte("loopback")} /> Só neste computador (para o seu próprio túnel)</label>
            </fieldset>
            {transporte === "lan" ? (
              privadas.length === 0 ? (
                <p className="jarvis-nota" role="status">Nenhuma rede privada encontrada. Conecte-se a uma rede local (Wi-Fi de casa ou do escritório) para ligar.</p>
              ) : (
                <div className="jarvis-linha">
                  <label htmlFor="remoto-interface" className="jarvis-rotulo-campo">Interface</label>
                  <select id="remoto-interface" className="jarvis-campo" value={interfaceIp} onChange={(x) => setInterfaceIp(x.target.value)}>
                    <option value="auto">Automática</option>
                    {privadas.map((i) => <option key={i.ip} value={i.ip}>{i.nome} ({i.ip})</option>)}
                  </select>
                </div>
              )
            ) : null}
            <label className="jarvis-check"><input type="checkbox" checked={ciente} onChange={(x) => setCiente(x.target.checked)} /> Entendi: {TEXTO_CONSENTIMENTO_REMOTO}</label>
            <div className="jarvis-linha">
              <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={!ciente || ocupado || (transporte === "lan" && privadas.length === 0)}
                title={!ciente ? "Marque o \"Entendi\" acima para ligar" : transporte === "lan" && privadas.length === 0 ? "Nenhuma rede privada encontrada: conecte-se a uma rede local (Wi-Fi) e tente de novo" : "Liga o servidor do controle remoto"}
                onClick={() => void ligar()}>Ligar controle remoto</button>
            </div>
          </>
        ) : (
          <div className="jarvis-linha">
            <button type="button" className="jarvis-botao" disabled={ocupado} onClick={() => void rodar(() => api.desligar())}>Desligar controle remoto</button>
            {panicoPedido ? (
              <>
                <button type="button" className="jarvis-botao jarvis-botao-perigo" disabled={ocupado} onClick={() => void rodar(async () => { await api.panico(); setPanicoPedido(false); setCodigo(null); })}>Confirmar pânico: desligar e revogar todos</button>
                <button type="button" className="jarvis-botao" onClick={() => setPanicoPedido(false)}>Cancelar</button>
              </>
            ) : <button type="button" data-sem-travessura className="jarvis-botao jarvis-botao-perigo" onClick={() => setPanicoPedido(true)}>Pânico</button>}
          </div>
        )}
        {e.transporte.ultimo_erro !== null && !ligado ? <p className="jarvis-nota">Última tentativa: {ERRO_LIGAR[e.transporte.ultimo_erro as ErroLigarRemoto] ?? "falhou"}</p> : null}
      </section>

      {e.pendentes.length > 0 ? (
        <section aria-labelledby="remoto-pedidos" className="jarvis-bloco">
          <h2 id="remoto-pedidos">Pedidos de dispositivos aguardando você</h2>
          {e.pendentes.map((p) => (
            <div key={p.id} className="jarvis-confirmacao" role="group" aria-label={`Pedido de ${p.dispositivo}`}>
              <p className="jarvis-confirmacao-texto"><strong>{p.dispositivo}</strong> pede: {p.resumo}</p>
              <p className="jarvis-nota">{ROTULO_ACAO[p.acao]} · {contagemRegressiva(p.expira_em, relogio)}</p>
              <div className="jarvis-linha">
                <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={ocupado} onClick={() => void rodar(() => api.aprovarPedido(p.id, true))}>Aprovar</button>
                <button type="button" className="jarvis-botao" disabled={ocupado} onClick={() => void rodar(() => api.aprovarPedido(p.id, false))}>Negar</button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {ligado ? (
        <section aria-labelledby="remoto-parear" className="jarvis-bloco">
          <h2 id="remoto-parear">Parear um dispositivo</h2>
          {e.sas !== null ? (
            <div className="jarvis-confirmacao" role="group" aria-label="Conferir o código de segurança">
              <p>Confira: o celular mostra os mesmos seis dígitos?</p>
              <p className="jarvis-sas" aria-label={`Código de segurança ${e.sas.split("").join(" ")}`}>{e.sas}</p>
              {permissaoPar === "mensagem_direta" ? (
                <div className="jarvis-linha">
                  <label htmlFor="remoto-permitir" className="jarvis-rotulo-campo">Digite {PALAVRA_DIRETA} para liberar mensagem direta</label>
                  <input id="remoto-permitir" className="jarvis-campo" value={palavra} onChange={(x) => setPalavra(x.target.value)} autoComplete="off" />
                </div>
              ) : null}
              <div className="jarvis-linha">
                <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={ocupado || !podeConfirmarPermissao(permissaoPar, palavra)} onClick={() => void rodar(async () => { await api.parearConfirmarSas({ igual: true, confirmacao_permissao: permissaoPar === "mensagem_direta" ? palavra : null }); setPalavra(""); setCodigo(null); })}>São iguais: permitir</button>
                <button type="button" className="jarvis-botao" disabled={ocupado} onClick={() => void rodar(async () => { await api.parearConfirmarSas({ igual: false, confirmacao_permissao: null }); setPalavra(""); })}>Diferentes: negar</button>
              </div>
            </div>
          ) : mostrarCodigo && codigo !== null ? (
            <div className="jarvis-confirmacao" role="group" aria-label="Código de pareamento">
              <p>No celular, abra <strong>{endereco ?? "o endereço do servidor"}</strong>, aceite o aviso do certificado e digite:</p>
              <p className="jarvis-codigo" aria-label={`Código ${codigo.codigo.split("").join(" ")}`}>{codigo.codigo}</p>
              <p className="jarvis-nota">Aparece só uma vez e vale uma vez · {contagemRegressiva(codigo.expira_em, relogio)}</p>
              <button type="button" className="jarvis-botao" onClick={() => void rodar(async () => { await api.parearCancelar(); setCodigo(null); })}>Cancelar pareamento</button>
            </div>
          ) : (
            <div className="jarvis-linha">
              <label htmlFor="remoto-perm-par" className="jarvis-rotulo-campo">Permissão inicial</label>
              <select id="remoto-perm-par" className="jarvis-campo" value={permissaoPar} onChange={(x) => setPermissaoPar(x.target.value as PermissaoRemota)}>
                {PERMISSOES_REMOTAS.map((p) => <option key={p} value={p}>{ROTULO_PERMISSAO[p]}</option>)}
              </select>
              <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={ocupado} onClick={() => void parear()}>Gerar código</button>
            </div>
          )}
          <p className="jarvis-nota">{EXPLICACAO_PERMISSAO[permissaoPar]}</p>
        </section>
      ) : null}

      <section aria-labelledby="remoto-disp" className="jarvis-bloco">
        <h2 id="remoto-disp">Dispositivos pareados</h2>
        {e.dispositivos.length === 0 ? (
          <p className="jarvis-nota" role="status">Nenhum dispositivo pareado. Ligue o servidor e gere um código para parear o celular.</p>
        ) : (
          <ul className="jarvis-lista">
            {e.dispositivos.map((d) => (
              <LinhaDispositivo key={d.id} d={d} agora={relogio} ocupado={ocupado} aoRevogar={() => void rodar(() => api.revogar(d.id))} aoPermissao={(permissao, confirmacao) => void rodar(async () => { const r = await api.permissaoDefinir({ dispositivo_id: d.id, permissao, confirmacao }); if (r === null) setAviso("A permissão não mudou. Para mensagem direta, digite PERMITIR."); })} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LinhaDispositivo({ d, agora, ocupado, aoRevogar, aoPermissao }: { d: DispositivoVisao; agora: number; ocupado: boolean; aoRevogar(): void; aoPermissao(p: PermissaoRemota, confirmacao: string | null): void }) {
  const [palavra, setPalavra] = useState("");
  const [alvo, setAlvo] = useState<PermissaoRemota>(d.permissao);
  const revogado = d.revogado_em !== null;
  return (
    <li data-revogado={revogado ? "sim" : "nao"}>
      <ItemLista
        densa
        titulo={d.nome}
        descricao={revogado ? "revogado" : d.conectado ? "conectado agora" : `último uso ${tempoRelativo(d.ultimo_uso_em, agora)}`}
        {...(revogado ? {} : {
          selos: [{ texto: ROTULO_PERMISSAO[d.permissao] }],
          acao: <button type="button" className="botao" disabled={ocupado} aria-label={`Revogar ${d.nome}`} onClick={aoRevogar}>Revogar</button>,
        })}
      />
      {revogado ? null : (
        <div className="jarvis-linha jarvis-dispositivo-form">
          <label htmlFor={`perm-${d.id}`} className="jarvis-rotulo-campo">Permissão de {d.nome}</label>
          <select id={`perm-${d.id}`} className="jarvis-campo" value={alvo} onChange={(x) => setAlvo(x.target.value as PermissaoRemota)}>
            {PERMISSOES_REMOTAS.map((p) => <option key={p} value={p}>{ROTULO_PERMISSAO[p]}</option>)}
          </select>
          {alvo === "mensagem_direta" && d.permissao !== "mensagem_direta" ? (
            <>
              <label htmlFor={`perm-palavra-${d.id}`} className="jarvis-rotulo-campo">Digite {PALAVRA_DIRETA}</label>
              <input id={`perm-palavra-${d.id}`} className="jarvis-campo" value={palavra} onChange={(x) => setPalavra(x.target.value)} autoComplete="off" />
            </>
          ) : null}
          <button type="button" className="jarvis-botao" disabled={ocupado || alvo === d.permissao || !podeConfirmarPermissao(alvo, palavra)} title={alvo === d.permissao ? "A permissão já é esta" : alvo === "mensagem_direta" && !podeConfirmarPermissao(alvo, palavra) ? `Digite ${PALAVRA_DIRETA} para confirmar` : undefined} onClick={() => aoPermissao(alvo, alvo === "mensagem_direta" ? palavra : null)}>Aplicar</button>
        </div>
      )}
    </li>
  );
}
