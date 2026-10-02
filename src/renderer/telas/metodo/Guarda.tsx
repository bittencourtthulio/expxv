import type { ReactElement } from "react";
import { EstadoVazio } from "../../componentes/EstadoVazio";

/**
 * Os três estados que antecedem qualquer tela do Método (sem projeto, lendo, erro): iguais em Método e Trabalhos.
 * Devolve `null` quando já dá para mostrar o conteúdo.
 */
export function GuardaMetodo({ workspaceId, carregado, erro, aoQue }: { workspaceId: string | null; carregado: boolean; erro: string | null; aoQue: string }): ReactElement | null {
  if (!workspaceId) return <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto={`Abra uma pasta em Workspaces para ver ${aoQue}.`} />;
  if (!carregado) return <p className="met-suave" role="status">Lendo o projeto…</p>;
  if (erro) return <EstadoVazio icone="alerta" titulo="Não foi possível ler o método" texto={erro} />;
  return null;
}
