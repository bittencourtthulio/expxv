// Canais `workspaces:*` (T-02.03). Remetente autorizado e payload validado (estrito) ANTES do serviço.
// O renderer pode pedir "abrir esta pasta" (ou o diálogo, com `caminho: null`), mas nunca fornece `cwd`
// de sessão: quem resolve o cwd é o main, pelo id do workspace.
import { PERMISSOES } from "../../nucleo/dominio";
import type { ServicoWorkspaces } from "../../nucleo/workspaces/servico";
import { vIdWorkspace, vOuNulo, vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vEnum, vObjeto, vVazio } from "./validar";

export const VALIDADORES_WORKSPACES = {
  estado: vVazio,
  abrir: vObjeto({ caminho: vOuNulo(vTextoLivre(4_096, 1)) }),
  definirAtual: vObjeto({ workspace_id: vIdWorkspace }),
  remover: vObjeto({ workspace_id: vIdWorkspace }),
  definirPermissao: vObjeto({ workspace_id: vIdWorkspace, permissao: vEnum(PERMISSOES) }),
  worktrees: vObjeto({ workspace_id: vIdWorkspace }),
} as const;

export interface DependenciasIpcWorkspaces {
  registro: RegistroIpc;
  servico: Pick<ServicoWorkspaces, "estado" | "abrir" | "definirAtual" | "remover" | "definirPermissao" | "worktrees">;
  /** Avisa que o estado mudou (o main emite `workspaces:mudou` coalescido). */
  aoMudar?: () => void;
}

export function registrarIpcWorkspaces(d: DependenciasIpcWorkspaces): void {
  const { registro, servico } = d;
  const V = VALIDADORES_WORKSPACES;
  const avisar = <T>(r: T): T => {
    d.aoMudar?.();
    return r;
  };
  registro.invoke("workspaces:estado", V.estado, () => servico.estado());
  registro.invoke("workspaces:abrir", V.abrir, async ({ caminho }) => avisar(await servico.abrir(caminho)));
  registro.invoke("workspaces:definir_atual", V.definirAtual, async ({ workspace_id }) => avisar(await servico.definirAtual(workspace_id)));
  registro.invoke("workspaces:remover", V.remover, async ({ workspace_id }) => avisar(await servico.remover(workspace_id)));
  registro.invoke("workspaces:definir_permissao", V.definirPermissao, async ({ workspace_id, permissao }) => avisar(await servico.definirPermissao(workspace_id, permissao)));
  registro.invoke("workspaces:worktrees", V.worktrees, ({ workspace_id }) => servico.worktrees(workspace_id));
}
