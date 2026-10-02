// Núcleo da gestão ágil (Fase 18, ONDA 1): lógica pura sobre portas. Sem Electron, sem IPC, sem boot.
export * from "./agil";
export * from "./erros";
export * from "./portas";
export * from "./repos";
export { criarBancoMemoria } from "./memoria";
export * from "./eventos";
export * from "./consultas";
export * from "./exportar";
export { configPadrao } from "./config/padroes";
export { mesclarConfig, validarConfig, lerConfig } from "./config/validar";
export { ESCALAS } from "./config/escalas";
export { extrairFatos } from "./fatos/extrair";
export { sincronizar, varrerOrfaos } from "./fatos/sincronizar";
export { montarFonte, qaDeArtefato, commitsDeEntrega, versaoOrigem } from "./fatos/fonte";
export { estimarHeuristica } from "./estimativa/heuristica";
export { montarPainel, criarPainelComCache } from "./metricas/painel";
export { preverTermino } from "./metricas/previsao";
export { processarRetrabalho } from "./retrabalho/processar";
