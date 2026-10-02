import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiRelay, PareamentoRelayAberto, SasRelayVisao } from "../../../../compartilhado/relay";
import { ERRO_PAREAR_RELAY, TEXTO_FIM_PAREAMENTO, agrupar4, contagemRegressiva } from "./relay-logica";
import { gerarQr, qrParaCaminho } from "./qr";

const visivel = (expiraEm: string, agora: number): boolean => Date.parse(expiraEm) > agora;

/** Parear celular: QR (SVG local) + código; o código some ao expirar, usar, cancelar ou concluir e NÃO reaparece. O SAS só aparece quando o celular chegou; a decisão é aqui. */
export function RelayPareamento({ api, ligado, aoMudar, aoEventoRemoto, agora = () => Date.now() }: { api: ApiRelay; ligado: boolean; aoMudar: () => void; aoEventoRemoto?: ((cb: () => void) => () => void) | undefined; agora?: () => number }) {
  const [aberto, setAberto] = useState<PareamentoRelayAberto | null>(null);
  const [sas, setSas] = useState<SasRelayVisao | null>(null);
  const [relogio, setRelogio] = useState(agora());
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const queimado = useRef(false); // o código já foi usado/decidido/cancelado: nunca volta
  const [, forcar] = useState(0);
  const sessaoAberta = aberto !== null;

  const consultar = async (): Promise<void> => {
    try {
      const v = await api.parearSas();
      setSas(v);
      if (v.situacao === "aguardando_decisao") queimado.current = true;
      if (v.situacao === "concluido" || v.situacao === "negado" || v.situacao === "expirado" || v.situacao === "fechado") {
        if (v.situacao !== "fechado") setMsg(TEXTO_FIM_PAREAMENTO[v.situacao] ?? null);
        queimado.current = true;
        setAberto(null);
        aoMudar();
      }
    } catch {
      setErro("Não foi possível ler o pareamento.");
    }
  };
  useEffect(() => {
    if (!sessaoAberta) return undefined;
    const t = setInterval(() => {
      setRelogio(agora());
      void consultar();
    }, 1000);
    const parar = aoEventoRemoto?.(() => void consultar());
    return () => {
      clearInterval(t);
      parar?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoAberta]);
  useEffect(() => {
    if (!ligado && aberto !== null) {
      queimado.current = true;
      setAberto(null);
    }
  }, [ligado, aberto]);
  // expirou: some (e fecha do lado do host pelo próprio TTL)
  useEffect(() => {
    if (aberto !== null && !visivel(aberto.expira_em, relogio) && sas?.situacao !== "aguardando_decisao") {
      queimado.current = true;
      setAberto(null);
      setMsg(TEXTO_FIM_PAREAMENTO.expirado ?? null);
      void api.parearDecidir(false).catch(() => undefined);
    }
  }, [aberto, relogio, sas, api]);

  const abrir = async (): Promise<void> => {
    setOcupado(true);
    setErro(null);
    setMsg(null);
    try {
      const r = await api.parearIniciar();
      if ("erro" in r) setErro(ERRO_PAREAR_RELAY[r.erro]);
      else {
        queimado.current = false;
        setSas(null);
        setRelogio(agora());
        setAberto(r);
      }
    } catch {
      setErro("Não foi possível abrir o pareamento.");
    } finally {
      setOcupado(false);
      forcar((x) => x + 1);
    }
  };
  const decidir = async (permitir: boolean): Promise<void> => {
    setOcupado(true);
    try {
      queimado.current = true;
      await api.parearDecidir(permitir);
      if (!permitir) {
        setAberto(null);
        setMsg(TEXTO_FIM_PAREAMENTO.negado ?? null);
      } else setMsg("Permitido. Aguardando o celular concluir…");
    } catch {
      setErro("Não foi possível enviar a decisão.");
    } finally {
      setOcupado(false);
      void consultar();
    }
  };

  const decisao = sas?.situacao === "aguardando_decisao" && sas.sas !== null;
  const mostrarCodigo = aberto !== null && !queimado.current && !decisao && visivel(aberto.expira_em, relogio);
  const qr = useMemo(() => {
    if (!mostrarCodigo || aberto === null || aberto.qr === "") return null;
    try {
      return qrParaCaminho(gerarQr(aberto.qr));
    } catch {
      return null;
    }
  }, [mostrarCodigo, aberto]);

  return (
    <section aria-labelledby="relay-parear" className="jarvis-bloco">
      <h2 id="relay-parear">Parear celular</h2>
      {erro !== null ? <p role="alert" className="jarvis-erro">{erro}</p> : null}
      {msg !== null ? <p role="status" className="jarvis-nota">{msg}</p> : null}
      {aberto === null ? (
        <div className="jarvis-linha">
          <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={!ligado || ocupado} onClick={() => void abrir()}>Parear celular</button>
          {!ligado ? <span className="jarvis-nota">Ligue o relay para parear.</span> : <span className="jarvis-nota">O celular entra só com leitura. A decisão é sempre aqui.</span>}
        </div>
      ) : (
        <>
          {mostrarCodigo ? (
            <div data-testid="pareamento-codigo">
              {qr !== null ? (
                <svg role="img" aria-label="QR Code para parear o celular" viewBox={`0 0 ${qr.lado} ${qr.lado}`} width={168} height={168} shapeRendering="crispEdges" style={{ background: "white" }}>
                  <path d={qr.caminho} fill="black" />
                </svg>
              ) : <p className="jarvis-nota">Sem endereço do app no celular configurado: digite o código e o endereço do relay no app do celular.</p>}
              <p className="jarvis-codigo" aria-label="Código de pareamento">{aberto.codigo}</p>
              <p className="jarvis-nota" role="status">{contagemRegressiva(aberto.expira_em, relogio)} · o código vale uma vez</p>
            </div>
          ) : null}
          <p className="jarvis-nota">Impressão digital deste computador (compare com a do celular):</p>
          <p className="jarvis-detalhe" aria-label="Impressão digital do computador">{agrupar4(aberto.impressao_host)}</p>
          <p className="jarvis-nota">App do celular esperado: {aberto.impressao_cliente_esperada === null ? "compare com o que o celular mostra na Configuração." : agrupar4(aberto.impressao_cliente_esperada)}</p>
          {decisao ? (
            <div className="jarvis-confirmacao" role="group" aria-label="Conferir o número">
              <p className="jarvis-confirmacao-texto">O mesmo número aparece no celular?</p>
              <p className="jarvis-sas" aria-label="Número de confirmação">{sas?.sas}</p>
              <div className="jarvis-linha">
                <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={ocupado} onClick={() => void decidir(true)}>Permitir</button>
                <button type="button" className="jarvis-botao jarvis-botao-perigo" disabled={ocupado} onClick={() => void decidir(false)}>Recusar</button>
              </div>
            </div>
          ) : (
            <div className="jarvis-linha">
              <span className="jarvis-nota" role="status">Aguardando o celular…</span>
              <button type="button" className="jarvis-botao" disabled={ocupado} onClick={() => void decidir(false)}>Cancelar</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
