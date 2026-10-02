// Implementação em memória das portas de repositório (testes e fallback). `transacao` desfaz tudo se `fn` lançar.
import type { BancoAgil, Colecao } from "./repos";

class ColecaoMemoria<T> implements Colecao<T> {
  mapa = new Map<string, T>();
  get(k: string): T | undefined { return this.mapa.get(k); }
  set(k: string, v: T): void { this.mapa.set(k, v); }
  delete(k: string): boolean { return this.mapa.delete(k); }
  valores(): T[] { return [...this.mapa.values()]; }
}

export function criarBancoMemoria(): BancoAgil {
  const c = <T>() => new ColecaoMemoria<T>();
  const banco = {
    configs: c(), itens: c(), epicos: c(), estimativas: c(), classificacoes: c(), sprints: c(), sprintItens: c(), membros: c(), fatos: c(), versoes: c(),
    eventosRetrabalho: c(), retrabalhoTasks: c(), cerimonias: c(), retroItens: c(), retroAcoes: c(), erros: c(), snapshots: c(), dodResultados: c(), demos: c(),
    eventos: c(), auditoria: c(), chamadasIa: c(),
  } as unknown as BancoAgil;
  const todas = Object.values(banco).filter((x): x is ColecaoMemoria<unknown> => x instanceof ColecaoMemoria);
  let aberta = false;
  banco.transacao = <T>(fn: () => T): T => {
    if (aberta) return fn();
    const copias = todas.map((col) => new Map(col.mapa));
    aberta = true;
    try {
      return fn();
    } catch (e) {
      todas.forEach((col, i) => { col.mapa = copias[i] as Map<string, unknown>; });
      throw e;
    } finally {
      aberta = false;
    }
  };
  return banco;
}
