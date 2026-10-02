import type { ReactNode } from "react";
import { Icone } from "../../componentes/Icone";
import { textoDoErro } from "./logica";

/** Carregando: linhas de esqueleto estáticas (sem pulso) com o texto para leitor de tela. */
export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="ag-carregando" role="status" aria-busy="true">
      <span>{texto}</span>
      <span className="ag-esq-linhas" aria-hidden="true"><span /><span /><span /></span>
    </div>
  );
}

/** Erro com o texto do `[codigo/subcodigo]` do IPC já traduzido. `bloco`: erro que impede a tela (sem dados nenhuns), com o que fazer. */
export function FaixaErro({ erro, aoTentar, bloco = false }: { erro: unknown; aoTentar?: () => void; bloco?: boolean }) {
  if (bloco) {
    return (
      <div className="ag-erro-bloco" role="alert">
        <Icone nome="aviso" className="ag-erro-icone" />
        <h2>Não foi possível carregar a gestão ágil</h2>
        <p className="ag-erro-motivo">{textoDoErro(erro)}</p>
        <p className="ag-meta">Confira se o projeto continua aberto em Workspaces e tente de novo. Os dados do método não são alterados por esta tela.</p>
        {aoTentar !== undefined && <button type="button" className="ag-btn" data-primario onClick={aoTentar}>Tentar de novo</button>}
      </div>
    );
  }
  return (
    <div className="ag-faixa" data-tom="erro" role="alert">
      <span>{textoDoErro(erro)}</span>
      {aoTentar !== undefined && <button type="button" onClick={aoTentar}>Tentar de novo</button>}
    </div>
  );
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <label className="ag-campo"><span>{rotulo}</span>{children}</label>;
}

/** Executa uma ação assíncrona guardando o erro (nada de window.alert). */
export async function executar<T>(fn: () => Promise<T>, aoErro: (e: unknown) => void): Promise<T | undefined> {
  try { return await fn(); } catch (e) { aoErro(e); return undefined; }
}
