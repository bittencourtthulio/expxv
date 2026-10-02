import { textoDoErro } from "./logica";

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return <div className="rl-carregando" role="status" aria-busy="true">{texto}</div>;
}

/** Faixa de erro com o texto já traduzido do `[codigo]` do IPC (nada de caminho nem stack). */
export function FaixaErro({ erro, aoTentar }: { erro: unknown; aoTentar?: () => void }) {
  return (
    <div className="rl-faixa" data-tom="erro" role="alert">
      <span>{textoDoErro(erro)}</span>
      {aoTentar !== undefined && <button type="button" onClick={aoTentar}>Tentar de novo</button>}
    </div>
  );
}
