import { useEffect, useState } from "react";
import { ade } from "../ade";
import { Dialogo } from "../componentes/Dialogo";
import { aoPedirPanicoTelegram } from "../estado/alertas-acoes";
import { storeAlertas, useAlertas, type StoreAlertas } from "../estado/alertas";
import type { ApiAlertas } from "../../compartilhado/alertas";

export const PASSOS_APOS_PANICO = [
  "O bot foi desligado e todos os pareamentos foram revogados.",
  "Agora rotacione o token no BotFather: abra /mybots, escolha o bot, API Token e Revoke current token (a página oficial cita também o comando /token).",
  "Para voltar a usar o Telegram será preciso refazer o pareamento.",
];

/** Confirmação do pânico "Parar tudo" (padrão: também parar as execuções iniciadas pelo Telegram). */
export function DialogoPanico({ aoFechar, api = ade()?.alertas }: { aoFechar: () => void; api?: ApiAlertas | undefined }) {
  const [parar, setParar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ revogados: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const executar = async (): Promise<void> => {
    if (api === undefined) { setErro("Telegram indisponível nesta janela."); return; }
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.telegram.panico(parar);
      if (r.ok) setResultado({ revogados: r.revogados }); else setErro("Não foi possível parar o bot. Tente de novo ou feche o app.");
    } catch { setErro("Não foi possível parar o bot. Tente de novo ou feche o app."); } finally { setOcupado(false); }
  };
  return (
    <Dialogo titulo="Parar tudo (pânico do Telegram)" aoFechar={aoFechar}>
      {resultado === null ? (
        <>
          <div className="dialogo-corpo">
            <p>Desliga a entrada e a saída do Telegram, revoga todos os pareamentos e cancela os planos pendentes. Nada é apagado.</p>
            <label className="alertas-check"><input type="checkbox" checked={parar} onChange={(e) => setParar(e.target.checked)} /> Parar também as execuções iniciadas pelo Telegram</label>
            {erro !== null ? <p role="alert" className="campo-erro">{erro}</p> : null}
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Cancelar</button>
            <button type="button" className="botao botao-perigo" disabled={ocupado} onClick={() => void executar()}>{ocupado ? "Parando…" : "Parar tudo"}</button>
          </div>
        </>
      ) : (
        <>
          <div className="dialogo-corpo" role="status">
            <p>Pânico executado: {resultado.revogados} {resultado.revogados === 1 ? "pareamento revogado" : "pareamentos revogados"}.</p>
            <ol>{PASSOS_APOS_PANICO.map((p) => <li key={p}>{p}</li>)}</ol>
          </div>
          <div className="dialogo-acoes"><button type="button" className="botao botao-primario" data-foco-inicial onClick={aoFechar}>Entendi</button></div>
        </>
      )}
    </Dialogo>
  );
}

/** Pedido de pareamento vindo do Telegram: diálogo global (aparece em qualquer tela). */
export function DialogoPareamento({ store = storeAlertas, api = ade()?.alertas }: { store?: StoreAlertas; api?: ApiAlertas | undefined }) {
  const { pedidoPareamento: p } = useAlertas(store);
  const [ocupado, setOcupado] = useState(false);
  if (p === null) return null;
  const decidir = async (permitir: boolean): Promise<void> => {
    setOcupado(true);
    try { await api?.telegram.parearDecidir(p.pedido_id, permitir); } catch { /* o estado vem pelo evento */ } finally { setOcupado(false); store.limparPareamento(); }
  };
  return (
    <Dialogo titulo="Parear a conta do Telegram" aoFechar={() => void decidir(false)}>
      <div className="dialogo-corpo">
        <p>Parear a conta Telegram &ldquo;{p.nome}&rdquo; (id {p.user_id})?</p>
        <p>O nome é só informativo: a decisão usa o id. Só permita se foi você quem enviou o código.</p>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial disabled={ocupado} onClick={() => void decidir(false)}>Negar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado} onClick={() => void decidir(true)}>Permitir</button>
      </div>
    </Dialogo>
  );
}

/** Um componente de casca que só renderiza algo quando há pedido de pareamento ou de pânico. */
export function DialogosAlertas({ store = storeAlertas, api = ade()?.alertas }: { store?: StoreAlertas; api?: ApiAlertas | undefined }) {
  const [panico, setPanico] = useState(false);
  useEffect(() => aoPedirPanicoTelegram(() => setPanico(true)), []);
  return (
    <>
      <DialogoPareamento store={store} api={api} />
      {panico ? <DialogoPanico aoFechar={() => setPanico(false)} api={api} /> : null}
    </>
  );
}
