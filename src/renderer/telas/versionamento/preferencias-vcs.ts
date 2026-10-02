import type { ApiAde } from "../../../compartilhado/ipc";

/** Chaves de `app:config_*` do versionamento (as mesmas que o main lê em `src/main/vcs.ts`). Ambas DESLIGADAS por padrão. */
export const PREF_FETCH_FUNDO = "vcs_fetch_segundo_plano";
export const PREF_PR_INICIO = "vcs_pr_inicio";

export type ApiConfig = ApiAde["config"];

/** Só `true` literal liga; qualquer outra coisa (ausente, texto, número) é desligado. */
export async function lerPreferencia(config: ApiConfig | undefined, chave: string): Promise<boolean> {
  if (config === undefined) return false;
  try {
    return (await config.ler(chave)) === true;
  } catch {
    return false;
  }
}
