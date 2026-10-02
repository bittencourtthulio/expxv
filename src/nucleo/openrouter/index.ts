// OpenRouter (Fase 9): cliente tipado sobre a rede injetada, adaptadores de CLI, tradução modelo→faixa e serviço.
export { criarClienteOpenRouter, HOST_OPENROUTER, precoPorMtok, traduzirModeloDaApi } from "./cliente";
export type { ClienteOpenRouter, DestinoOpenRouter, InfoChave, InfoCreditos, ModeloDaApiOr } from "./cliente";
export { OpenRouterErro } from "./erros";
export type { CodigoOpenRouter } from "./erros";
export { ADAPTADORES_CLI, CLIS_PREFERIDAS_PADRAO, adaptadorDaCli, clisUtilizaveis, modeloSeguroParaArgv } from "./adaptadores";
export type { AdaptadorCliOpenRouter, EntradaMontagem, LancamentoMontado } from "./adaptadores";
export { LIMIARES_FAIXA_POR_PRECO_SAIDA, sugerirFaixa } from "./modelos";
export { CHAVE_CONFIG_OPENROUTER, lerConfigOpenRouter } from "./config";
export type { ConfigOpenRouter } from "./config";
export { criarServicoOpenRouter, nomeCofreDaConta, INTERVALO_CLIQUE_SALDO_MS } from "./servico";
export type { DependenciasServicoOpenRouter, LancamentoOpenRouter, PedidoPreparo, ResumoOpenRouter, ServicoOpenRouter } from "./servico";
