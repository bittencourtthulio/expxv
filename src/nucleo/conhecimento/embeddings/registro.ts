// Registro de provedores por id; o modelo ativo é por coleção. Provedor ativo indisponível → piso `hash-256-v1` com `degradado`.
import { MODELO_HASH_ID } from "../constantes";
import { criarProvedorHash } from "./hash";
import type { ProvedorEmbedding } from "./provedor";

export interface Escolha {
  provedor: ProvedorEmbedding;
  /** true quando o modelo pedido está fora e o piso entrou no lugar (a consulta marca `degradado`). */
  degradado: boolean;
}

export class RegistroEmbeddings {
  private readonly mapa = new Map<string, ProvedorEmbedding>();
  constructor() {
    this.registrar(criarProvedorHash());
  }
  registrar(p: ProvedorEmbedding): void {
    this.mapa.set(p.id, p);
  }
  remover(id: string): void {
    if (id !== MODELO_HASH_ID) this.mapa.delete(id);
  }
  obter(id: string): ProvedorEmbedding | undefined {
    return this.mapa.get(id);
  }
  ids(): string[] {
    return [...this.mapa.keys()];
  }
  /** Escolhe o provedor do modelo ativo da coleção; sem ele (ou fora do ar) usa o piso. Nunca lança. */
  async escolher(modeloAtivo: string): Promise<Escolha> {
    const p = this.mapa.get(modeloAtivo);
    if (p) {
      try {
        if (await p.disponivel()) return { provedor: p, degradado: false };
      } catch {
        /* cai no piso */
      }
    }
    return { provedor: this.mapa.get(MODELO_HASH_ID) as ProvedorEmbedding, degradado: modeloAtivo !== MODELO_HASH_ID };
  }
}
