import type { ApiAde, CanaisEvento, CanaisInvoke, Cancelar, TemaPreferencia } from "../compartilhado/ipc";

type Tema = CanaisInvoke["app:tema_ler"]["saida"];

/** Subconjunto da API do preload que a casca usa (estrutural; exposto pelo preload como `window.ade`). */
export interface PonteApp {
  versao(): Promise<string>;
  tema: {
    ler(): Promise<Tema>;
    definir(preferencia: TemaPreferencia): Promise<Tema>;
    assinar(cb: (e: CanaisEvento["app:tema_mudou"]) => void): Cancelar;
  };
  perf: { marcar(nome: string): void };
  /** API dos terminais (contrato em compartilhado/terminais.ts). Opcional: ausente fora do Electron. */
  terminais?: ApiAde["terminais"];
}

/** API exposta pelo preload, ou undefined fora do Electron (testes, navegador). */
export function ponte(): PonteApp | undefined {
  return (globalThis as unknown as { ade?: PonteApp }).ade;
}
