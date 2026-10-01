import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rename, writeFile, mkdir, rm } from "node:fs/promises";

/**
 * Preferências pequenas do app (tema, config simples) em um JSON em `<userData>`. Fica FORA do banco
 * porque o tema precisa ser lido no boot, antes da janela, sem esperar o SQLite (P-01).
 * Escrita atômica (temp + rename). Leitura síncrona só no boot.
 */

export type MapaPreferencias = Record<string, unknown>;

export interface Preferencias {
  lerSync(): MapaPreferencias;
  obter(chave: string): unknown;
  definir(chave: string, valor: unknown): Promise<void>;
}

export function criarPreferencias(pastaDados: string): Preferencias {
  const arquivo = join(pastaDados, "preferencias.json");
  let cache: MapaPreferencias | null = null;
  let fila: Promise<void> = Promise.resolve();

  function carregar(): MapaPreferencias {
    if (cache !== null) return cache;
    try {
      const bruto = JSON.parse(readFileSync(arquivo, "utf8")) as unknown;
      // sem protótipo: a chave `__proto__` é um dado como outro qualquer (AUD-28)
      cache = Object.assign(Object.create(null) as MapaPreferencias, typeof bruto === "object" && bruto !== null && !Array.isArray(bruto) ? bruto : {});
    } catch {
      cache = Object.create(null) as MapaPreferencias;
    }
    return cache;
  }

  return {
    lerSync: () => ({ ...carregar() }),
    obter: (chave) => carregar()[chave] ?? null,
    definir(chave, valor) {
      const atual = carregar();
      const tinha = Object.hasOwn(atual, chave);
      const anterior = atual[chave];
      atual[chave] = valor;
      const conteudo = JSON.stringify(atual, null, 2);
      // AUD-07: a fila nunca fica rejeitada (uma falha não envenena as próximas); cada escrita devolve o SEU resultado
      const escrita = fila.then(async () => {
        const temporario = `${arquivo}.${process.pid}.tmp`;
        try {
          await mkdir(dirname(arquivo), { recursive: true });
          await writeFile(temporario, conteudo, { mode: 0o600 });
          await rename(temporario, arquivo);
        } catch (erro) {
          await rm(temporario, { force: true }).catch(() => undefined);
          // o cache não pode dizer que gravou o que não gravou (a menos que outra escrita já tenha trocado o valor)
          if (cache !== null && cache[chave] === valor) {
            if (tinha) cache[chave] = anterior;
            else delete cache[chave];
          }
          throw erro;
        }
      });
      fila = escrita.catch(() => undefined);
      return escrita;
    },
  };
}

/** Versão síncrona de gravação, só para teste e encerramento. */
export function gravarPreferenciasSync(pastaDados: string, mapa: MapaPreferencias): void {
  mkdirSync(pastaDados, { recursive: true });
  const arquivo = join(pastaDados, "preferencias.json");
  const temporario = `${arquivo}.${process.pid}.tmp`;
  writeFileSync(temporario, JSON.stringify(mapa, null, 2), { mode: 0o600 });
  renameSync(temporario, arquivo);
}
