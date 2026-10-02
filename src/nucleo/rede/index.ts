// Camada de rede do app (ÚNICO ponto de saída). Uso típico (main):
//   const consentimento = criarRegistroConsentimento();
//   consentimento.permitirHost("openrouter.ai");                // consentimento GRAVADO pelo dono
//   const token = consentimento.conceder("openrouter.ai");      // emitido dentro do manipulador IPC de um clique
//   const rede = criarClienteRede({ consentimento, scrub: cofre.scrubSincrono });
//   await rede.requisitar({ host: "openrouter.ai", caminho: "/api/v1/key", tokenDeConsentimento: token, cabecalhos: { authorization: `Bearer ${chave}` } });
export { criarClienteRede } from "./cliente-http";
export type { ClienteRede, MetodoHttp, OpcoesClienteRede, PedidoRede, ResolverProxy, RespostaRede, RespostaStream } from "./cliente-http";
export { criarRegistroConsentimento, normalizarHost } from "./consentimento";
export type { OpcoesToken, RegistroConsentimento, TokenConsentimento } from "./consentimento";
export { RedeErro } from "./erros";
export type { CodigoRede } from "./erros";
