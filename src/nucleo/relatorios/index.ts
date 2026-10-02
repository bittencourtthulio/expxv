// Núcleo da documentação e relatórios de entrega (Fase 19, ONDA 1): lógica pura sobre portas. Sem Electron, sem IPC, sem boot.
export * from "./servico";
export * from "./portas";
export * from "./erros";
export * from "./repos";
export { configPadrao, mesclarConfig } from "./config";
export { coletarFatos, hashFatos } from "./fatos/coletar";
export { montarBlocos } from "./redacao/deterministico";
export { verificarBlocos } from "./redacao/verificar";
export { lintarJargao } from "./redacao/jargao";
export { criarArmazenamento, refPacote } from "./exportar/armazenamento";
export { validarDestino } from "./exportar/destino";
