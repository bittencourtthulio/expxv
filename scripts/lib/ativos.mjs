// Ativos que o `tsc` não emite e que o app lê em tempo de execução: prompts editáveis (.md) e o script
// de hook por Pane (`gancho.mjs`, roda como processo separado). Cópia idempotente de `src/` para `dist/`.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

export const ATIVOS = [
  { de: "src/nucleo/orquestracao/prompts", para: "dist/nucleo/orquestracao/prompts", extensoes: [".md"] },
  { de: "src/nucleo/orquestracao/hooks/scripts", para: "dist/nucleo/orquestracao/hooks/scripts", extensoes: [".mjs"] },
];

/** Copia cada ativo para o destino. Devolve os caminhos de destino (relativos à raiz). Origem ausente é erro. */
export function copiarAtivos(raiz, ativos = ATIVOS) {
  const copiados = [];
  for (const { de, para, extensoes } of ativos) {
    const origem = join(raiz, de);
    if (!existsSync(origem)) throw new Error(`ativo ausente: ${de}`);
    const nomes = readdirSync(origem).filter((n) => extensoes.includes(extname(n)));
    if (nomes.length === 0) throw new Error(`nenhum ativo ${extensoes.join("/")} em ${de}`);
    mkdirSync(join(raiz, para), { recursive: true });
    for (const nome of nomes) {
      copyFileSync(join(origem, nome), join(raiz, para, nome));
      copiados.push(join(para, nome));
    }
  }
  return copiados;
}
