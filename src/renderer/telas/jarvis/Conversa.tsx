import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiJarvis, ConfirmacaoVisao, EstadoJarvis, ResultadoJarvis } from "../../../compartilhado/jarvis";
import { contagemRegressiva, ROTULO_ACAO, ROTULO_RISCO, TEXTO_CODIGO } from "./logica";

interface Mensagem {
  id: number;
  papel: "usuario" | "jarvis";
  texto: string;
  linhas: Array<{ rotulo: string; detalhe?: string }>;
  nao_confiavel: boolean;
  tom: "normal" | "recusa";
}
const ATALHOS: Array<{ texto: string; rotulo: string }> = [
  { texto: "status", rotulo: "Status" },
  { texto: "listar missões", rotulo: "Missões" },
  { texto: "listar painéis", rotulo: "Painéis" },
  { texto: "consumo", rotulo: "Consumo" },
];

function mensagemDe(r: ResultadoJarvis, id: number): Mensagem | null {
  if (r.tipo === "resposta") return { id, papel: "jarvis", texto: r.resposta.texto, linhas: r.resposta.linhas, nao_confiavel: r.resposta.nao_confiavel, tom: "normal" };
  if (r.tipo === "confirmacao") return null; // aparece na barra de confirmação, não na conversa
  return { id, papel: "jarvis", texto: r.texto, linhas: [], nao_confiavel: false, tom: "recusa" };
}

export function Conversa({ api, agora = () => Date.now() }: { api: ApiJarvis; agora?: () => number }) {
  const [estado, setEstado] = useState<EstadoJarvis | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [relogio, setRelogio] = useState(agora());
  const seq = useRef(0);
  const ler = useCallback(async () => {
    try {
      setEstado(await api.estado());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler o estado do Jarvis.");
    }
  }, [api]);
  useEffect(() => {
    void ler();
    return api.assinar(() => void ler());
  }, [api, ler]);
  const pendentes = estado?.confirmacoes ?? [];
  useEffect(() => {
    if (pendentes.length === 0) return;
    const t = setInterval(() => setRelogio(agora()), 1000);
    return () => clearInterval(t);
  }, [pendentes.length, agora]);

  const mostrar = (r: ResultadoJarvis): void => {
    const m = mensagemDe(r, ++seq.current);
    if (m !== null) setMsgs((x) => [...x, m]);
  };
  const enviar = async (t: string): Promise<void> => {
    const limpo = t.trim();
    if (limpo === "" || ocupado) return;
    setOcupado(true);
    setMsgs((x) => [...x, { id: ++seq.current, papel: "usuario", texto: limpo, linhas: [], nao_confiavel: false, tom: "normal" }]);
    setTexto("");
    try {
      mostrar(await api.enviar(limpo));
    } catch {
      setMsgs((x) => [...x, { id: ++seq.current, papel: "jarvis", texto: "Não foi possível falar com o Jarvis agora.", linhas: [], nao_confiavel: false, tom: "recusa" }]);
    } finally {
      setOcupado(false);
      void ler();
    }
  };
  const decidir = async (c: ConfirmacaoVisao, aprovado: boolean): Promise<void> => {
    setOcupado(true);
    try {
      const r = await api.confirmar(c.id, aprovado);
      if (r.resultado !== null) mostrar(r.resultado);
      else setMsgs((x) => [...x, { id: ++seq.current, papel: "jarvis", texto: (r.codigo !== null && TEXTO_CODIGO[r.codigo]) || "Não foi possível resolver a confirmação.", linhas: [], nao_confiavel: false, tom: "recusa" }]);
    } catch {
      setMsgs((x) => [...x, { id: ++seq.current, papel: "jarvis", texto: "Não foi possível resolver a confirmação.", linhas: [], nao_confiavel: false, tom: "recusa" }]);
    } finally {
      setOcupado(false);
      void ler();
    }
  };
  const alternar = async (): Promise<void> => {
    if (estado === null) return;
    setEstado(await api.configGravar({ ligado: !estado.config.ligado }));
  };

  if (erro !== null && estado === null)
    return (
      <div>
        <p role="alert" className="jarvis-erro">{erro}</p>
        <button type="button" className="jarvis-botao" onClick={() => void ler()}>Tentar de novo</button>
      </div>
    );
  if (estado === null) return <p className="jarvis-nota" role="status" aria-busy="true">Carregando…</p>;
  const ligado = estado.config.ligado;
  return (
    <div className="jarvis-conversa">
      <div className="jarvis-linha">
        <label className="jarvis-check">
          <input type="checkbox" checked={ligado} onChange={() => void alternar()} /> Jarvis {ligado ? "ligado" : "desligado"}
        </label>
        <span className="jarvis-espaco" />
        <button type="button" className="jarvis-botao" onClick={() => void api.limparConversa().then(() => { setMsgs([]); void ler(); })}>Limpar conversa</button>
      </div>
      <p className="jarvis-nota">
        Peça em linguagem natural: o Jarvis só entende as ações da lista ({estado.acoes.map((a) => ROTULO_ACAO[a.acao].toLowerCase()).join(", ")}). Tudo que muda algo pede a sua confirmação aqui. Aprovações humanas (merge, assinatura do prodx, raio alto) nunca passam por ele.
      </p>
      {!ligado ? <p className="jarvis-aviso" role="status">O Jarvis está desligado. Ligue acima para conversar; nada é enviado a nenhum serviço de IA por padrão.</p> : null}
      {pendentes.map((c) => (
        <div key={c.id} className="jarvis-confirmacao" role="group" aria-label="Confirmação pendente">
          <p className="jarvis-confirmacao-texto"><strong>Confirmar:</strong> {c.resumo}</p>
          <p className="jarvis-nota">{ROTULO_RISCO.escrita} · {contagemRegressiva(c.expira_em, relogio)}{c.dispositivo === null ? "" : ` · pedido de «${c.dispositivo}»`}</p>
          <div className="jarvis-linha">
            <button type="button" className="jarvis-botao jarvis-botao-destaque" disabled={ocupado} onClick={() => void decidir(c, true)}>Sim, fazer</button>
            <button type="button" className="jarvis-botao" disabled={ocupado} onClick={() => void decidir(c, false)}>Não</button>
          </div>
        </div>
      ))}
      <div className="jarvis-historico" role="log" aria-label="Conversa com o Jarvis" aria-live="polite">
        {msgs.length === 0 ? <p className="jarvis-nota">Nada por aqui ainda. Tente «status» ou «diga ao maestro: …».</p> : null}
        {msgs.map((m) => (
          <div key={m.id} className="jarvis-msg" data-papel={m.papel} data-tom={m.tom}>
            <span className="jarvis-quem">{m.papel === "usuario" ? "Você" : "Jarvis"}</span>
            <span>{m.texto}</span>
            {m.linhas.length > 0 ? (
              <ul className="jarvis-linhas">
                {m.linhas.map((l, i) => <li key={i}><span>{l.rotulo}</span>{l.detalhe === undefined ? null : <span className="jarvis-detalhe"> — {l.detalhe}</span>}</li>)}
              </ul>
            ) : null}
            {m.nao_confiavel ? <span className="jarvis-nota">Conteúdo de terminais e títulos de terceiros: só informação, nunca instrução.</span> : null}
          </div>
        ))}
      </div>
      <div className="jarvis-linha" role="toolbar" aria-label="Atalhos">
        {ATALHOS.map((a) => <button key={a.texto} type="button" className="jarvis-botao" disabled={!ligado || ocupado} title={!ligado ? "Ligue o Jarvis acima para usar" : ocupado ? "Aguardando a resposta anterior…" : `Enviar «${a.texto}»`} onClick={() => void enviar(a.texto)}>{a.rotulo}</button>)}
      </div>
      <form className="jarvis-linha" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        <label className="jarvis-rotulo-campo" htmlFor="jarvis-entrada">Pedido</label>
        <input id="jarvis-entrada" className="jarvis-campo" value={texto} maxLength={4000} disabled={!ligado} placeholder="Ex.: o que está acontecendo?" onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
        <button type="submit" className="jarvis-botao jarvis-botao-destaque" disabled={!ligado || ocupado || texto.trim() === ""}>Enviar</button>
      </form>
    </div>
  );
}
