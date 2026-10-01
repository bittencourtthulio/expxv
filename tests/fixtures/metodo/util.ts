import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const criados: string[] = [];

export function criarTmp(prefixo = "metodo-"): string {
  const d = mkdtempSync(join(tmpdir(), prefixo));
  criados.push(d);
  return d;
}

export function limparTmps(): void {
  while (criados.length) {
    const d = criados.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
}
