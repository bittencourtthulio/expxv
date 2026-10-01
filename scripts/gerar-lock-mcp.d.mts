export const REGISTRO_NPM_PADRAO: string;
export const REGISTRO_PYPI_PADRAO: string;
export function nomeNpmNaUrl(pacote: string): string;
export function argvNpmLock(o: { pacote: string; versao: string; registro: string; dir: string }): string[];
export function argvUvCompile(o: { entrada: string; saida: string; registro: string }): string[];
export function normalizarLockNpm(texto: string, id: string): string;

export interface ExecutorLock { (o: { pacote: string; versao: string; registro: string; id: string }): Promise<string> }

export interface OpcoesGerarLocks {
  seed: string;
  locks: string;
  relatorio?: string;
  seedEmbarcado?: string;
  executar?: boolean;
  atualizarSeed?: boolean;
  ids?: string[];
  registroNpm?: string;
  registroPypi?: string;
  fetch?: typeof fetch;
  executorNpm?: ExecutorLock;
  executorPython?: ExecutorLock;
}

export interface ItemLock {
  id: string;
  metodo: string;
  pacote: string;
  versao: string;
  arquivo: string;
  url_registro: string;
  lock_sha256: string | null;
  integridade: "ok" | "divergente" | "nao_conferida";
  status: "dry_run" | "gerado" | "erro";
  detalhe: string;
}

export function gerarLocks(o: OpcoesGerarLocks): Promise<{ executou: boolean; itens: ItemLock[]; relatorio: string; seedAtualizado: unknown }>;
export function lerArgumentos(argv: string[]): Record<string, any>;
