// Fatia "adicionar workspace" do `window.ade` falso (só teste e verificação visual): respostas simples; testes e capturas sobrescrevem o que precisam.
import type { ApiAde } from "../../compartilhado/ipc";

export type FatiaAdicionar = Pick<ApiAde["workspaces"],
  "adicionarDestinoPadrao" | "adicionarEscolherPasta" | "adicionarAvaliarDestino" | "adicionarAbrirDestino" | "adicionarClonar" | "adicionarCancelarClone" | "adicionarBuscarProjetos" |
  "adicionarCancelarBusca" | "adicionarProjetoAchado" | "adicionarGhEstado" | "adicionarListarRepos" | "adicionarNovo" | "assinarAdicionarProgresso" | "assinarAdicionarProjetos">;

export function adicionarFalso(): FatiaAdicionar {
  return {
    adicionarDestinoPadrao: async () => ({ token: "d_falso123456", exibicao: "~/Developer" }),
    adicionarEscolherPasta: async () => null,
    adicionarAvaliarDestino: async (p) => ({ ok: true, situacao: "livre", caminho_exibicao: `~/Developer/${p.nome}`, motivo: null, sugestao: null, ja_workspace: false }),
    adicionarAbrirDestino: async () => null,
    adicionarClonar: async () => ({ ok: true, clone_id: "cl_falso123456" }),
    adicionarCancelarClone: async () => true,
    adicionarBuscarProjetos: async () => ({ busca_id: "bu_falso123456" }),
    adicionarCancelarBusca: async () => true,
    adicionarProjetoAchado: async () => null,
    adicionarGhEstado: async () => ({ instalado: false, autenticado: false, usuario: null }),
    adicionarListarRepos: async () => ({ ok: true, repos: [], truncado: false }),
    adicionarNovo: async () => ({ ok: false, erro: { codigo: "interno", mensagem: "falso", acao: null, sugestao: null } }),
    assinarAdicionarProgresso: () => () => undefined,
    assinarAdicionarProjetos: () => () => undefined,
  };
}
