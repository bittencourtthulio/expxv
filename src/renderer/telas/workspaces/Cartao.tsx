import { useState } from "react";
import type { Workspace, WorktreeInfo } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { AVISO_AUTOMATICO, AVISO_SEGURO, ROTULO_ACESSO } from "./textos";

export interface PropsCartao {
  ws: Workspace;
  atual: boolean;
  aoUsar: () => void;
  aoRemover: () => void;
  aoPermissao: (p: "seguro" | "automatico") => void;
  carregarWorktrees: () => Promise<WorktreeInfo[]>;
}

export function Cartao({ ws, atual, aoUsar, aoRemover, aoPermissao, carregarWorktrees }: PropsCartao) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);
  const verWorktrees = () => { if (worktrees === null) void carregarWorktrees().then(setWorktrees); else setWorktrees(null); };
  const grupo = `perm-${ws.id}`;
  return (
    <li className="ws-cartao" data-atual={atual || undefined}>
      <div className="ws-cabecalho">
        <div className="ws-titulo">
          <strong>{ws.nome}</strong>
          {atual ? <Badge tom="destaque">Atual</Badge> : null}
          <Badge tom={ws.e_git ? "sucesso" : "neutro"}>{ws.e_git ? "git" : "sem git"}</Badge>
          <Badge tom={ws.acesso_externo === "nenhum" ? "neutro" : "aviso"}>{ROTULO_ACESSO[ws.acesso_externo]}</Badge>
        </div>
        <div className="ws-acoes">
          {!atual ? <button type="button" className="botao botao-primario" onClick={aoUsar}>Usar</button> : null}
          {ws.e_git ? <button type="button" className="botao" aria-expanded={worktrees !== null} onClick={verWorktrees}>Worktrees</button> : null}
          <button type="button" className="botao botao-perigo" onClick={aoRemover}>Remover da lista</button>
        </div>
      </div>
      <code className="ws-raiz">{ws.raiz}</code>
      <div role="radiogroup" aria-label={`Permissão de ${ws.nome}`} className="ws-permissao">
        {(["seguro", "automatico"] as const).map((p) => (
          <label key={p} className="ws-radio">
            <input type="radio" name={grupo} checked={ws.permissao === p} onChange={() => { if (ws.permissao !== p) aoPermissao(p); }} />
            {p === "seguro" ? "Seguro" : "Automático"}
          </label>
        ))}
      </div>
      {ws.permissao === "automatico" ? <p role="note" className="aviso-caixa"><strong>Atenção. </strong>{AVISO_AUTOMATICO}</p> : <p className="ws-nota">{AVISO_SEGURO}</p>}
      {worktrees !== null ? (
        <ul className="ws-worktrees" aria-label="Worktrees">
          {worktrees.length === 0 ? <li>Nenhum worktree encontrado.</li> : null}
          {worktrees.map((w) => (
            <li key={w.caminho}>
              <code>{w.caminho}</code> <span>{w.branch ?? "(sem branch)"}</span>
              {w.principal ? <Badge>principal</Badge> : null}
              {w.sujo === null ? null : <Badge tom={w.sujo ? "aviso" : "sucesso"}>{w.sujo ? "alterações locais" : "limpo"}</Badge>}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
