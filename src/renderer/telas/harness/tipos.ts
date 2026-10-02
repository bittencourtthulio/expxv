import type { ApiAde } from "../../../compartilhado/ipc";
import type { ContextoPolitica } from "./validar";

export type ApiHarness = Partial<ApiAde["harness"]>;
export type ApiCofre = Partial<ApiAde["cofre"]>;
export type ApiLimitesParcial = Partial<ApiAde["limites"]>;

/** O que cada aba recebe da casca da tela. */
export interface PropsAba {
  api: ApiHarness | undefined;
  /** `null` = escopo global. */
  workspaceId: string | null;
  busca: string;
  /** muda quando algo foi gravado fora da aba (ex.: novo tipo, restaurar semente): força releitura. */
  versao: number;
  ctx: ContextoPolitica;
}
