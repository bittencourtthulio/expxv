// Tipos locais da tela Consumo (aditivos): a API de limites vista como "pode faltar" (histórico, previsão, eficiência e alertas
// dependem de tabelas ainda sem manipulador no main; ver docs/ade/pedidos/9-ui-pedidos.md).
import type { ApiAde } from "../../../compartilhado/ipc";

export type { AccountUsage, AmostraLimite } from "../../../compartilhado/limites";
export type ApiLimitesLike = Partial<ApiAde["limites"]>;
export type ApiHarnessLike = Partial<ApiAde["harness"]>;
