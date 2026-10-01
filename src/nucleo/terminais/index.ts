// Núcleo dos terminais: PTY, sessões, daemon e validadores de IPC (Fase 1).
// `AdaptadorNodePty` carrega o node-pty só no primeiro spawn, então importar este índice é barato.
export * from "./lancamento";
export * from "./ambiente";
export * from "./osc";
export * from "./sessoes";
export * from "./adaptador-node-pty";
export * from "./guardiao";
export * from "./ipc-validadores";
