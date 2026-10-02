import { useEffect, useRef } from "react";
import { Icone } from "../../componentes/Icone";
import type { MensagemPedido, StoreExecucaoMetodo } from "../../estado/execucao-metodo";
import { EXEMPLOS_PEDIDO } from "./pedido-gestos";

const hora = (em: number): string => new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
/** Id curto e legível do Pane (nunca o UUID inteiro). */
export const nomeDoPane = (id: string | null): string => (id === null ? "Pane" : `Pane ${id.replace(/^pane[-_]?/i, "").slice(0, 6)}`);

function Troca({ m, store }: { m: MensagemPedido; store: StoreExecucaoMetodo }) {
  return (
    <li className="ped-troca">
      <div className="ped-bolha" data-testid="mensagem-pedido">
        <span className="ped-bolha-gesto">{m.rotulo}</span>
        {m.pedido !== null ? <p>{m.pedido}</p> : <p className="ped-bolha-sem">Sem texto: o comando roda como está.</p>}
        <time dateTime={new Date(m.em).toISOString()}>{hora(m.em)}</time>
      </div>
      <article className="ped-resposta" aria-label={`Resposta do ADE ao pedido ${m.rotulo}`}>
        <header>
          <i aria-hidden="true"><Icone nome="executar" /></i>
          <b>Enviado ao agente em {nomeDoPane(m.paneId)}</b>
          <span className="met-chip" data-modo="ok">entregue</span>
        </header>
        {m.comando !== null ? <code className="ped-resposta-cmd">{m.comando}</code> : null}
        <button type="button" className="ped-link" onClick={() => store.irAoTerminalDe(m)}>Ir para o terminal</button>
      </article>
    </li>
  );
}

interface Props {
  mensagens: readonly MensagemPedido[];
  store: StoreExecucaoMetodo;
  /** exemplos clicáveis do estado vazio */
  aoEscolherExemplo: (i: number) => void;
}

/** Histórico de pedidos desta sessão como conversa: o pedido da pessoa à direita (bolha) e a resposta do ADE à esquerda (cartão). */
export function Conversa({ mensagens, store, aoEscolherExemplo }: Props) {
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = fim.current; if (el) el.scrollTop = el.scrollHeight; }, [mensagens.length]);
  if (mensagens.length === 0) {
    return (
      <div className="ped-historico ped-historico-vazio" ref={fim}>
        <div className="ped-boas-vindas">
          <h2>Peça, e o agente começa</h2>
          <p>Descreva o que você quer no campo abaixo. O comando exato do método aparece antes de enviar, e cada pedido enviado fica registrado aqui.</p>
          <div className="ped-exemplos" role="group" aria-label="Exemplos de pedido">
            <span className="met-suave">Comece por um exemplo:</span>
            {EXEMPLOS_PEDIDO.map((ex, i) => <button key={ex.texto} type="button" className="ped-exemplo" onClick={() => aoEscolherExemplo(i)} title={ex.texto}>{ex.rotulo}</button>)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="ped-historico" ref={fim} tabIndex={0} role="log" aria-label="Pedidos desta sessão" aria-live="off">
      <ol className="ped-trocas">{mensagens.map((m) => <Troca key={m.id} m={m} store={store} />)}</ol>
    </div>
  );
}
