import { storeExecucaoMetodo, useExecucaoMetodo, type StoreExecucaoMetodo } from "../estado/execucao-metodo";
import "./faixa-executando.css";

/** Faixa discreta no topo da tela Terminais depois de um disparo do Método: o que está rodando e como voltar (o rascunho do pedido fica guardado). */
export function FaixaExecutando({ workspaceId, store = storeExecucaoMetodo }: { workspaceId: string | null; store?: StoreExecucaoMetodo }) {
  const { execucao } = useExecucaoMetodo(store);
  if (execucao === null || execucao.workspaceId !== workspaceId) return null;
  return (
    <div className="faixa-exec" role="status" aria-live="polite" data-faixa-executando>
      <p className="faixa-exec-texto">
        <b>Executando: {execucao.rotulo}</b>
        {execucao.resumo !== null ? <> — “{execucao.resumo}”</> : null}
      </p>
      <button type="button" className="faixa-exec-botao" onClick={() => store.voltarAoMetodo()}>Voltar ao Método</button>
      <button type="button" className="faixa-exec-botao" aria-label="Dispensar a faixa" onClick={() => store.dispensar()}>Dispensar</button>
    </div>
  );
}
