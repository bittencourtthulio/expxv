// Onde moram os ativos da orquestração em cada modo de execução. No pacote, `gancho.mjs` e o
// `mcp-worker.js` precisam ficar FORA do asar (rodam como processo/thread separados) e os prompts são
// editáveis, então também vão para `app.asar.unpacked`. Em desenvolvimento, se o build ainda não copiou
// os ativos para `dist/` (scripts/copiar-ativos.mjs), cai nos arquivos de `src/`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AtivosDaOrquestracao } from "./orquestracao";

export function foraDoAsar(caminho: string): string {
  return caminho.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
}

export function resolverAtivos(o: { dirMain: string; empacotado: boolean; existe?: (caminho: string) => boolean }): AtivosDaOrquestracao {
  const existe = o.existe ?? existsSync;
  const dist = join(o.dirMain, "..");
  const src = join(o.dirMain, "..", "..", "src");
  const escolher = (relativo: string[]): string => {
    const empacotado = join(dist, ...relativo);
    return o.empacotado || existe(empacotado) ? empacotado : join(src, ...relativo);
  };
  const aplicar = (c: string): string => (o.empacotado ? foraDoAsar(c) : c);
  return {
    pastaDePrompts: aplicar(escolher(["nucleo", "orquestracao", "prompts"])),
    scriptGancho: aplicar(escolher(["nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"])),
    caminhoWorker: aplicar(join(dist, "main", "mcp-worker.js")),
  };
}
