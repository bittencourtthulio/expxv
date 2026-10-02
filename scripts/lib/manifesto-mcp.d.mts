export const SEED_MCP: string;
export const MANIFESTO_MCP: string;
export function gerarManifestoMcp(raiz: string): string;
export function conferirManifestoMcp(raiz: string): "ok" | "ausente" | "adulterado";
