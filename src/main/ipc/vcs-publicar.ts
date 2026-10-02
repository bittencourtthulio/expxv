// Canais `vcs:publicar_*` (D-630..D-639): validadores ESTRITOS e registro. O renderer manda só ids do app, texto de formulário e escolhas: NUNCA caminho, URL de
// repositório, cwd, remoto, comando nem argumentos de git. Nome de branch passa por `validarNomeRamo` já aqui (o núcleo repete na montagem da instrução).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { LIMITES_PUBLICAR, type OpcoesPublicacao, type PedidoEnviarInstrucao, type PedidoPedirMerge, type TextoOuAgente } from "../../compartilhado/vcs-publicar";
import { vIdSessao } from "../../nucleo/terminais/ipc-validadores";
import { validarNomeRamo } from "../../nucleo/vcs/publicar/ramo";
import { vIdWorkspace, vOuNulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import type { VcsPublicar } from "../vcs-publicar";
import { sanearErro } from "../vcs";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

const vRamo: Validador<string> = (v) => {
  const r = validarNomeRamo(v);
  return r.ok ? { ok: true, valor: r.nome } : falha("nome de branch inválido");
};
/** id de ferramenta do catálogo de terminais: slug simples (nunca caminho nem executável). */
const vCli = vTexto({ min: 1, max: 32, padrao: /^[a-z][a-z0-9-]{0,31}$/ });
const vLogin = vTexto({ min: 1, max: 39, padrao: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/ });
const vTextoForm = (max: number): Validador<string> => (v) => {
  const r = vTexto({ max })(v);
  if (!r.ok) return r;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.valor) ? falha("texto inválido") : r;
};
const vTextoOuAgente = (max: number): Validador<TextoOuAgente> => vObjeto({ modo: vEnum(["agente", "manual"] as const), texto: vOuNulo(vTextoForm(max)) });

const vOpcoes: Validador<OpcoesPublicacao> = vObjeto({
  criar_ramo: vBooleano,
  nome_ramo: vOuNulo(vRamo),
  incluir_nao_rastreados: vBooleano,
  incluir_suite: vBooleano,
  mensagem: vTextoOuAgente(LIMITES_PUBLICAR.mensagem),
  pr: vOuNulo(vObjeto({
    titulo: vTextoOuAgente(LIMITES_PUBLICAR.titulo),
    descricao: vTextoOuAgente(LIMITES_PUBLICAR.descricao),
    rascunho: vBooleano,
    base: vOuNulo(vRamo),
    revisores: vLista(vLogin, LIMITES_PUBLICAR.revisores),
  })),
  confirmar_padrao: vOuNulo(vTexto({ max: 120, padrao: /^[A-Za-z0-9 ._/-]*$/ })),
}) as Validador<OpcoesPublicacao>;

export const VALIDADORES_VCS_PUBLICAR = {
  "vcs:publicar_estado": vObjeto({ workspace_id: vIdWorkspace, consultar_pr: vBooleano }),
  "vcs:publicar_preparar_commit_push": vObjeto({ workspace_id: vIdWorkspace, sessao_foco: vOuNulo(vIdSessao) }),
  "vcs:publicar_preparar_pr": vObjeto({ workspace_id: vIdWorkspace, sessao_foco: vOuNulo(vIdSessao) }),
  "vcs:publicar_enviar_instrucao": vObjeto({ workspace_id: vIdWorkspace, tipo: vEnum(["commit_push", "pr"] as const), opcoes: vOpcoes, sessao_foco: vOuNulo(vIdSessao), cli: vOuNulo(vCli), modo_painel: vEnum(["auto", "novo"] as const) }) as Validador<PedidoEnviarInstrucao>,
  "vcs:publicar_abrir_url": vObjeto({ workspace_id: vIdWorkspace, url: vTexto({ min: 1, max: 500 }) }),
  "vcs:publicar_buscar_remoto": vObjeto({ workspace_id: vIdWorkspace, forcar: vBooleano }),
  "vcs:publicar_preparar_atualizar": vObjeto({ workspace_id: vIdWorkspace, sessao_foco: vOuNulo(vIdSessao) }),
  "vcs:publicar_atualizar": vObjeto({ workspace_id: vIdWorkspace }),
  "vcs:publicar_pedir_merge": vObjeto({ workspace_id: vIdWorkspace, sessao_foco: vOuNulo(vIdSessao), cli: vOuNulo(vCli), modo_painel: vEnum(["auto", "novo"] as const) }) as Validador<PedidoPedirMerge>,
  "vcs:publicar_ignorar_suite": vObjeto({ workspace_id: vIdWorkspace }),
} as const;

export interface DependenciasIpcVcsPublicar {
  registro: RegistroIpc;
  publicar: VcsPublicar;
}

/** Erro que sobe ao renderer: PT-BR, sem caminho absoluto nem credencial. */
async function cuidar<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) { throw sanearErro(e, []); }
}

export function registrarIpcVcsPublicar({ registro, publicar }: DependenciasIpcVcsPublicar): void {
  const V = VALIDADORES_VCS_PUBLICAR;
  registro.invoke("vcs:publicar_estado", V["vcs:publicar_estado"], (p) => cuidar(() => publicar.estado(p)));
  registro.invoke("vcs:publicar_preparar_commit_push", V["vcs:publicar_preparar_commit_push"], (p) => cuidar(() => publicar.preparar("commit_push", p)));
  registro.invoke("vcs:publicar_preparar_pr", V["vcs:publicar_preparar_pr"], (p) => cuidar(() => publicar.preparar("pr", p)));
  registro.invoke("vcs:publicar_enviar_instrucao", V["vcs:publicar_enviar_instrucao"], (p) => cuidar(() => publicar.enviar(p as CanaisInvoke["vcs:publicar_enviar_instrucao"]["entrada"])));
  registro.invoke("vcs:publicar_abrir_url", V["vcs:publicar_abrir_url"], (p) => cuidar(() => publicar.abrirUrl(p)));
  registro.invoke("vcs:publicar_buscar_remoto", V["vcs:publicar_buscar_remoto"], (p) => cuidar(() => publicar.buscarRemoto(p)));
  registro.invoke("vcs:publicar_preparar_atualizar", V["vcs:publicar_preparar_atualizar"], (p) => cuidar(() => publicar.prepararAtualizar(p)));
  registro.invoke("vcs:publicar_atualizar", V["vcs:publicar_atualizar"], (p) => cuidar(() => publicar.atualizar(p)));
  registro.invoke("vcs:publicar_pedir_merge", V["vcs:publicar_pedir_merge"], (p) => cuidar(() => publicar.pedirMerge(p as CanaisInvoke["vcs:publicar_pedir_merge"]["entrada"])));
  registro.invoke("vcs:publicar_ignorar_suite", V["vcs:publicar_ignorar_suite"], (p) => cuidar(() => publicar.ignorarSuite(p)));
}
