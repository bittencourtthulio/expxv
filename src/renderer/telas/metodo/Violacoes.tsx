import type { Violacao } from "../../../nucleo/metodo/tipos";
import { VirtualLista } from "../../componentes/VirtualLista";
import { textoViolacao } from "./util";

export function Violacoes({ violacoes }: { violacoes: readonly Violacao[] }) {
  if (violacoes.length === 0) return <p className="met-suave" role="status">Nenhuma violação de regra do método.</p>;
  return (
    <VirtualLista
      itens={violacoes} alturaItem={64} alturaPadrao={420} rotulo="Violações" chave={(v, i) => `${v.trabalho_id}-${v.tipo}-${v.alvo}-${i}`}
      renderItem={(v) => (
        <div className="met-violacao">
          <b>{textoViolacao(v.tipo)}</b>
          <span>{v.trabalho_id} · {v.alvo}</span>
          <span className="met-suave">{v.detalhe} <code>{v.arquivo}</code></span>
        </div>
      )}
    />
  );
}
