import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { detectarLinguagem } from "../../../src/nucleo/mapa/linguagens";
import { extrairArquivo } from "../../../src/nucleo/mapa/extratores/registro";
import { lerManifesto, type Manifesto } from "../../../src/nucleo/mapa/manifestos";
import type { ArquivoParaResolver, ContextoResolucao } from "../../../src/nucleo/mapa/resolucao/comum";
import { RAIZ_FIXTURES_MAPA } from "./comparar";

// Monta o ContextoResolucao de uma pasta de fixtures (extrai de verdade com os extratores) para os testes dos resolvedores.

function listar(dir: string, raiz: string, saida: string[]): void {
  for (const nome of readdirSync(dir).sort()) {
    const p = join(dir, nome);
    if (nome === "node_modules" || nome === ".git") continue;
    if (statSync(p).isDirectory()) listar(p, raiz, saida);
    else saida.push(relative(raiz, p).split("\\").join("/"));
  }
}

export async function montarContexto(pasta: string, extrasLinguagens?: (c: string) => boolean): Promise<{ ctx: ContextoResolucao; raiz: string; arquivos: string[] }> {
  const raiz = join(RAIZ_FIXTURES_MAPA, pasta);
  const todos: string[] = [];
  listar(raiz, raiz, todos);
  const arquivos = new Map<string, ArquivoParaResolver>();
  const manifestos: Manifesto[] = [];
  for (const c of todos) {
    const texto = readFileSync(join(raiz, c), "utf8");
    const m = lerManifesto(c, texto);
    if (m !== null) manifestos.push(m);
    const ling = detectarLinguagem(c, texto.split("\n")[0]);
    if (ling === null || ling === "outra") continue;
    if (extrasLinguagens !== undefined && !extrasLinguagens(c)) continue;
    arquivos.set(c, { caminho: c, linguagem: ling, extracao: await extrairArquivo(texto, ling, c) });
  }
  const lerTexto = (c: string): string | null => (existsSync(join(raiz, c)) ? readFileSync(join(raiz, c), "utf8") : null);
  return { ctx: { arquivos, manifestos, lerTexto, existe: (c) => existsSync(join(raiz, c)) }, raiz, arquivos: todos };
}
