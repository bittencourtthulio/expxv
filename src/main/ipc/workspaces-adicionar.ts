// Canais `workspaces:adicionar_*` (D-600…): validadores ESTRITOS (campo a campo, nada extra) e manipuladores que delegam ao serviço (src/main/workspaces-adicionar.ts).
// NENHUM caminho de destino é aceito do renderer: só tokens de pasta que o main emitiu (diálogo nativo ou pasta de projetos) e ids de achados. A URL é texto livre
// aqui e é validada de verdade no serviço (`analisarOrigemGit`). Erros nominais viram `{ ok: false, erro }`; o resto, texto genérico.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { TEMPLATES_PROJETO } from "../../compartilhado/workspaces-adicionar";
import { ErroAdicionarNucleo } from "../../nucleo/workspaces/adicionar/erros";
import type { ServicoAdicionar } from "../workspaces-adicionar";
import { vTextoLivre } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vObjeto, vTexto, vVazio, type Validador } from "./validar";

type Entradas = { [K in keyof CanaisInvoke as K extends `workspaces:adicionar_${string}` ? K : never]: Validador<CanaisInvoke[K]["entrada"]> };

const vToken = vTexto({ min: 3, max: 40, padrao: /^d_[A-Za-z0-9_-]{6,36}$/ });
const vNome = vTextoLivre(200);
const vIdBusca = vTexto({ min: 3, max: 40, padrao: /^bu_[A-Za-z0-9_-]{6,36}$/ });
const vIdClone = vTexto({ min: 3, max: 40, padrao: /^cl_[A-Za-z0-9_-]{6,36}$/ });
const vIdAchado = vTexto({ min: 4, max: 40, padrao: /^ach_[A-Za-z0-9_-]{6,36}$/ });
const vBranchOuNulo: Validador<string | null> = (v) => (v === null ? { ok: true, valor: null } : vTextoLivre(250)(v));

const vPedidoDestino = vObjeto({ destino_token: vToken, nome: vNome });

export const VALIDADORES_ADICIONAR = {
  "workspaces:adicionar_destino_padrao": vVazio,
  "workspaces:adicionar_escolher_pasta": vObjeto({ lembrar: vBooleano }),
  "workspaces:adicionar_avaliar_destino": vPedidoDestino,
  "workspaces:adicionar_abrir_destino": vPedidoDestino,
  "workspaces:adicionar_clonar_iniciar": vObjeto({
    entrada: vTextoLivre(2_500),
    permitir_local: vBooleano,
    destino_token: vToken,
    nome: vNome,
    branch: vBranchOuNulo,
    raso: vBooleano,
    submodulos: vBooleano,
    consentimento: vBooleano,
  }),
  "workspaces:adicionar_clonar_cancelar": vObjeto({ clone_id: vIdClone }),
  "workspaces:adicionar_projetos_buscar": vVazio,
  "workspaces:adicionar_projetos_cancelar": vObjeto({ busca_id: vIdBusca }),
  "workspaces:adicionar_projeto_achado": vObjeto({ achado_id: vIdAchado }),
  "workspaces:adicionar_gh_estado": vObjeto({ forcar: vBooleano }),
  "workspaces:adicionar_repos_listar": vObjeto({ consentimento: vBooleano }),
  "workspaces:adicionar_novo_criar": vObjeto({
    nome: vNome,
    destino_token: vToken,
    git: vBooleano,
    gitignore: vBooleano,
    commit_inicial: vBooleano,
    readme: vBooleano,
    template: vEnum(TEMPLATES_PROJETO),
    instalar_suite: vBooleano,
  }),
} as unknown as Entradas;

export function sanearErroAdicionar(erro: unknown): Error {
  return erro instanceof ErroAdicionarNucleo ? new Error(erro.message) : new Error("Não foi possível concluir a ação.");
}

export interface DependenciasIpcAdicionar {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (nada no boot). */
  servico: ServicoAdicionar | (() => ServicoAdicionar);
}

export function registrarIpcAdicionar(d: DependenciasIpcAdicionar): void {
  const { registro } = d;
  const V = VALIDADORES_ADICIONAR;
  const s = (): ServicoAdicionar => (typeof d.servico === "function" ? d.servico() : d.servico);
  const guardar = <T>(fn: (x: ServicoAdicionar) => T | Promise<T>): Promise<T> => Promise.resolve().then(() => fn(s())).catch((e: unknown) => { throw sanearErroAdicionar(e); });
  registro.invoke("workspaces:adicionar_destino_padrao", V["workspaces:adicionar_destino_padrao"], () => guardar((x) => x.destinoPadrao()));
  registro.invoke("workspaces:adicionar_escolher_pasta", V["workspaces:adicionar_escolher_pasta"], ({ lembrar }) => guardar((x) => x.escolherPasta(lembrar)));
  registro.invoke("workspaces:adicionar_avaliar_destino", V["workspaces:adicionar_avaliar_destino"], (p) => guardar((x) => x.avaliarDestino(p)));
  registro.invoke("workspaces:adicionar_abrir_destino", V["workspaces:adicionar_abrir_destino"], (p) => guardar((x) => x.abrirDestinoExistente(p)));
  registro.invoke("workspaces:adicionar_clonar_iniciar", V["workspaces:adicionar_clonar_iniciar"], (p) => guardar((x) => x.iniciarClone(p)));
  registro.invoke("workspaces:adicionar_clonar_cancelar", V["workspaces:adicionar_clonar_cancelar"], ({ clone_id }) => guardar((x) => x.cancelarClone(clone_id)));
  registro.invoke("workspaces:adicionar_projetos_buscar", V["workspaces:adicionar_projetos_buscar"], () => guardar((x) => x.buscarProjetos()));
  registro.invoke("workspaces:adicionar_projetos_cancelar", V["workspaces:adicionar_projetos_cancelar"], ({ busca_id }) => guardar((x) => x.cancelarBusca(busca_id)));
  registro.invoke("workspaces:adicionar_projeto_achado", V["workspaces:adicionar_projeto_achado"], ({ achado_id }) => guardar((x) => x.adicionarAchado(achado_id)));
  registro.invoke("workspaces:adicionar_gh_estado", V["workspaces:adicionar_gh_estado"], ({ forcar }) => guardar((x) => x.estadoGh(forcar)));
  registro.invoke("workspaces:adicionar_repos_listar", V["workspaces:adicionar_repos_listar"], ({ consentimento }) => guardar((x) => x.listarRepos(consentimento)));
  registro.invoke("workspaces:adicionar_novo_criar", V["workspaces:adicionar_novo_criar"], (p) => guardar((x) => x.criarNovo(p)));
}
