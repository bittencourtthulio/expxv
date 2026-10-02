import { useState } from "react";
import type { Workspace, WorktreeInfo } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { ItemLista, type SeloLista } from "../../componentes/ItemLista";
import { LinhaAprovacaoDoProjeto } from "../terminais/aprovacao-workers";
import { AVISO_AUTOMATICO, AVISO_SEGURO, ROTULO_ACESSO } from "./textos";

export interface PropsCartao {
  ws: Workspace;
  atual: boolean;
  aoUsar: () => void;
  aoRemover: () => void;
  aoPermissao: (p: "seguro" | "automatico") => void;
  carregarWorktrees: () => Promise<WorktreeInfo[]>;
}

/** Linha de workspace no padrão único de listas (D-694): nome ≫ caminho ≫ selos, UMA ação estável ("Usar");
 *  permissão, worktrees e remoção ficam no miolo do item, abaixo da linha. */
export function Cartao({ ws, atual, aoUsar, aoRemover, aoPermissao, carregarWorktrees }: PropsCartao) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);
  const verWorktrees = () => { if (worktrees === null) void carregarWorktrees().then(setWorktrees); else setWorktrees(null); };
  const grupo = `perm-${ws.id}`;
  const selos: SeloLista[] = [
    { texto: ws.e_git ? "git" : "sem git", tom: ws.e_git ? "sucesso" : "neutro" },
    { texto: ROTULO_ACESSO[ws.acesso_externo], tom: ws.acesso_externo === "nenhum" ? "neutro" : "aviso" },
  ];
  if (atual) selos.unshift({ texto: "Atual", tom: "destaque" });
  return (
    <li className="ws-item" data-atual={atual || undefined}>
      <ItemLista
        titulo={ws.nome}
        descricao={ws.raiz}
        selos={selos}
        selecionado={atual}
        estado={ws.permissao === "automatico" ? "automático" : "seguro"}
        acao={atual
          ? <span className="ws-em-uso" title="Este é o workspace aberto agora">Em uso</span>
          : <button type="button" className="botao botao-primario" onClick={aoUsar}>Usar</button>}
      />
      <div className="ws-detalhes">
        <div className="ws-detalhes-linha">
          <div role="radiogroup" aria-label={`Permissão de ${ws.nome}`} className="ws-permissao">
            {(["seguro", "automatico"] as const).map((p) => (
              <label key={p} className="ws-radio">
                <input type="radio" name={grupo} checked={ws.permissao === p} onChange={() => { if (ws.permissao !== p) aoPermissao(p); }} />
                {p === "seguro" ? "Seguro" : "Automático"}
              </label>
            ))}
          </div>
          <div className="ws-acoes">
            {ws.e_git ? <button type="button" className="botao" aria-expanded={worktrees !== null} onClick={verWorktrees}>Worktrees</button> : null}
            <button type="button" className="botao botao-perigo" onClick={aoRemover}>Remover da lista</button>
          </div>
        </div>
        {ws.permissao === "automatico" ? <p role="note" className="aviso-caixa"><strong>Atenção. </strong>{AVISO_AUTOMATICO}</p> : <p className="ws-nota">{AVISO_SEGURO}</p>}
        <LinhaAprovacaoDoProjeto workspaceId={ws.id} nome={ws.nome} />
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
      </div>
    </li>
  );
}
