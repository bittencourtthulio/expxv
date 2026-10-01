// @ts-nocheck
import type { Config } from "./config";
import { formatar as fmt, validar } from "./util";
import Logger, * as ferramentas from "./logger";
import "./efeitos";

/** Serviço principal de pedidos. */
export class Servico extends Base implements Auditavel, Cobravel {
  private readonly segredo = "valor-que-nao-pode-vazar";
  #interno = 1;

  constructor(private readonly cfg: Config) {
    super();
  }

  /** Lista os pedidos ativos do cliente. */
  async listar(id: string, modo = "ativo"): Promise<string[]> {
    if (!validar(id) || modo === "x") {
      throw new Error("id inválido");
    }
    for (const p of this.itens) {
      if (p.ativo && p.valor > 0) fmt(p);
    }
    this.auditar(id);
    return Logger.formatar(id);
  }

  protected auditar(id: string): void {
    try {
      new Registro().gravar(id);
    } catch (e) {}
  }

  #oculto(): void {}

  static criar(): Servico {
    return new Servico({} as Config);
  }
}

export function calcular(a: number, b: number): number {
  return a > b ? a - b : b - a;
}

export const dobro = (n: number) => n * 2;

export const LIMITE = 10;

function interna(x: number): number {
  function aninhada(y: number): number {
    if (y) return y;
    return 0;
  }
  return aninhada(x) + ferramentas.soma(x);
}

export interface Auditavel extends Base2 {
  auditar(id: string): void;
}

export type Id = string | number;

export enum Estado {
  Ativo,
  Inativo,
}

export abstract class Base3 {}

export { interna as publica };
