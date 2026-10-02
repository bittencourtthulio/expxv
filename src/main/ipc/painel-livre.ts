// Canais `painel_livre:*` (D-420 a D-427): validadores estritos e registro. O renderer manda só ids do app (workspace, sessão, id de ferramenta) e booleanos: nunca
// `cwd`, caminho de executável, token nem texto livre. Quem decide permissão, limite e Missão é o main (`painel-livre.ts`/`orquestracao.ts`); erro que volta é NOMINAL.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { vIdSessao } from "../../nucleo/terminais/ipc-validadores";
import { sanearErroDePainelLivre, type PainelLivre } from "../painel-livre";
import { vIdPane, vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { NIVEIS_APROVACAO_WORKER } from "../../compartilhado/aprovacao-workers";
import { vBooleano, vEnum, vObjeto, vTexto, type Validador } from "./validar";
import { vObjetoOpc, type ValidadoresDaFamilia } from "./validar-harness";

/** id de ferramenta do catálogo de terminais: slug simples (nunca caminho, `auto` nem executável). */
const vFerramenta = vTexto({ min: 1, max: 32, padrao: /^[a-z][a-z0-9-]{0,31}$/ });

/** `null` = padrão global; senão o id de um workspace do app (nunca texto livre). */
const vWorkspaceOuNulo: Validador<string | null> = (v) => (v === null ? { ok: true, valor: null } : vIdWorkspace(v));

export const VALIDADORES_PAINEL_LIVRE = {
  "painel_livre:aprovacao": vObjetoOpc(
    { workspace_id: vWorkspaceOuNulo },
    { nivel: vEnum(NIVEIS_APROVACAO_WORKER), confirmacao: vTexto({ min: 0, max: 40 }), permitir_raiz: vBooleano, confiavel: vBooleano, herdar: vBooleano },
  ),
  "painel_livre:aprovacao_pane": vObjeto({ pane_id: vIdPane }),
  "painel_livre:preferencia": vObjetoOpc({ workspace_id: vIdWorkspace }, { ativa: vBooleano, orquestrador_edita: vBooleano, fechar_workers: vBooleano }),
  "painel_livre:ponte_grok": vObjeto({ workspace_id: vIdWorkspace, acao: vEnum(["estado", "aplicar", "remover"] as const) }),
  "painel_livre:abrir": vObjeto({ workspace_id: vIdWorkspace, ferramenta_id: vFerramenta, orquestrar: vBooleano }),
  "painel_livre:orquestrar": vObjeto({ workspace_id: vIdWorkspace, sessao_id: vIdSessao, ligar: vBooleano }),
} satisfies ValidadoresDaFamilia<"painel_livre:">;

export interface DependenciasIpcPainelLivre {
  registro: RegistroIpc;
  painel: PainelLivre;
}

/** Roda e sanea: erro nominal passa com a mensagem; o resto vira texto genérico. */
async function cuidar<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw sanearErroDePainelLivre(e);
  }
}

export function registrarIpcPainelLivre(d: DependenciasIpcPainelLivre): void {
  const V = VALIDADORES_PAINEL_LIVRE;
  d.registro.invoke("painel_livre:preferencia", V["painel_livre:preferencia"], (e: CanaisInvoke["painel_livre:preferencia"]["entrada"]) => cuidar(() => d.painel.preferencia(e)));
  d.registro.invoke("painel_livre:aprovacao", V["painel_livre:aprovacao"], (e: CanaisInvoke["painel_livre:aprovacao"]["entrada"]) => cuidar(() => d.painel.aprovacao(e)));
  d.registro.invoke("painel_livre:aprovacao_pane", V["painel_livre:aprovacao_pane"], (e: CanaisInvoke["painel_livre:aprovacao_pane"]["entrada"]) => cuidar(() => d.painel.aprovacaoDoPane(e)));
  d.registro.invoke("painel_livre:ponte_grok", V["painel_livre:ponte_grok"], (e: CanaisInvoke["painel_livre:ponte_grok"]["entrada"]) => cuidar(() => d.painel.ponteGrok(e)));
  d.registro.invoke("painel_livre:abrir", V["painel_livre:abrir"], (e: CanaisInvoke["painel_livre:abrir"]["entrada"]) => cuidar(() => d.painel.abrir(e)));
  d.registro.invoke("painel_livre:orquestrar", V["painel_livre:orquestrar"], (e: CanaisInvoke["painel_livre:orquestrar"]["entrada"]) => cuidar(() => d.painel.orquestrar(e)));
}
