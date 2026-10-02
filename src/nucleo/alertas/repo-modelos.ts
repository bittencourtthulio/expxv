// Modelos (templates) editados pelo usuário. Sem linha = vale o padrão embutido (`templates-padrao.ts`). `corpos()` alimenta `OpcoesMensagem.corpos`.
import type { NivelTemplate, TipoAlerta, TipoCanal } from "../../compartilhado/alertas";

export interface ModeloGravado {
  tipo: TipoAlerta;
  canal_tipo: TipoCanal;
  nivel: NivelTemplate;
  corpo: string;
  editado: boolean;
  atualizado_em: string;
}
export interface RepoModelos {
  listar(): ModeloGravado[];
  gravar(m: { tipo: TipoAlerta; canal_tipo: TipoCanal; nivel: NivelTemplate; corpo: string }): ModeloGravado;
  /** volta ao padrão embutido (apaga a linha). */
  restaurar(tipo: TipoAlerta, canal_tipo: TipoCanal, nivel: NivelTemplate): void;
  /** chave `${tipo}|${canal_tipo}|${nivel}`. */
  corpos(): ReadonlyMap<string, string>;
}

export function criarRepoModelosMemoria(agora: () => number = Date.now): RepoModelos {
  const linhas = new Map<string, ModeloGravado>();
  const k = (t: string, c: string, n: string): string => `${t}|${c}|${n}`;
  return {
    listar: () => [...linhas.values()].sort((a, b) => (k(a.tipo, a.canal_tipo, a.nivel) < k(b.tipo, b.canal_tipo, b.nivel) ? -1 : 1)).map((m) => ({ ...m })),
    gravar(m) {
      const r: ModeloGravado = { ...m, editado: true, atualizado_em: new Date(agora()).toISOString() };
      linhas.set(k(m.tipo, m.canal_tipo, m.nivel), r);
      return { ...r };
    },
    restaurar: (t, c, n) => void linhas.delete(k(t, c, n)),
    corpos: () => new Map([...linhas].map(([chave, m]) => [chave, m.corpo])),
  };
}
