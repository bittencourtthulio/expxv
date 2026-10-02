import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolverChamadas, type ResultadoChamadas } from "./chamadas";
import { extrairArquivo } from "./extratores/registro";
import { construirGrafo, type GrafoMemoria } from "./grafo/memoria";
import { aplicarLocks, ehLock, ehManifesto, lerLock, lerManifesto, type Lock, type Manifesto } from "./manifestos";
import { resolvedorCpp } from "./resolucao/cpp";
import { resolvedorCsharp } from "./resolucao/csharp";
import { resolvedorGo } from "./resolucao/go";
import { resolvedorJava } from "./resolucao/java";
import { resolvedorPhp } from "./resolucao/php";
import { resolvedorPython } from "./resolucao/python";
import { resolvedorRuby } from "./resolucao/ruby";
import { resolvedorRust } from "./resolucao/rust";
import { resolvedorTs } from "./resolucao/ts";
import { resolverTodos, type ArquivoParaResolver, type Resolvedor, type ResultadoResolucao } from "./resolucao/comum";
import { ehArquivoSensivel } from "./sensiveis";
import type { Extracao } from "./tipos";
import { varrerTudo, type OpcoesVarredura } from "./varredura";

// Pipeline em memória do mapa (T-17.21, parte pura): varredura -> extração -> manifestos -> resolução de imports ->
// resolução de chamadas -> grafo. Não grava no armazém, não usa worker, não escreve nada no projeto (somente leitura).
// O serviço com pool, incremental e `versao_mapa` (T-17.21 completa) entra na onda de integração.

export const RESOLVEDORES_PADRAO: readonly Resolvedor[] = [resolvedorTs, resolvedorPython, resolvedorJava, resolvedorCsharp, resolvedorPhp, resolvedorGo, resolvedorRuby, resolvedorRust, resolvedorCpp];

export interface OpcoesAnaliseMemoria {
  varredura?: OpcoesVarredura;
  resolvedores?: readonly Resolvedor[];
  /** Extrai também linguagens `outra` (degradado). Padrão: só as com gramática. */
  incluirDegradadas?: boolean;
}

export interface MapaEmMemoria {
  arquivos: Map<string, ArquivoParaResolver & { extracao: Extracao }>;
  falhas: Array<{ caminho: string; erro: string }>;
  manifestos: Manifesto[];
  resolucao: ResultadoResolucao;
  chamadas: ResultadoChamadas;
  grafoImports: GrafoMemoria;
  ms: { varredura: number; extracao: number; resolucao: number; chamadas: number };
}

export async function analisarEmMemoria(raiz: string, opcoes: OpcoesAnaliseMemoria = {}): Promise<MapaEmMemoria> {
  const t0 = performance.now();
  const { arquivos: varridos } = await varrerTudo(raiz, opcoes.varredura);
  const t1 = performance.now();
  const arquivos = new Map<string, ArquivoParaResolver & { extracao: Extracao }>();
  const falhas: Array<{ caminho: string; erro: string }> = [];
  const manifestos: Manifesto[] = [];
  const locks: Lock[] = [];
  for (const v of varridos) {
    if (ehArquivoSensivel(v.caminho)) continue;
    try {
      if (v.categoria === "codigo") {
        if (v.linguagem === "outra" && opcoes.incluirDegradadas !== true) continue;
        const texto = await readFile(join(raiz, v.caminho), "utf8");
        const extracao = await extrairArquivo(texto, v.linguagem, v.caminho, { hash: v.hash });
        arquivos.set(v.caminho, { caminho: v.caminho, linguagem: v.linguagem, extracao });
      } else if (v.categoria === "manifesto" || ehManifesto(v.caminho)) {
        const m = lerManifesto(v.caminho, await readFile(join(raiz, v.caminho), "utf8"));
        if (m !== null) manifestos.push(m);
      } else if (ehLock(v.caminho)) {
        const l = lerLock(v.caminho, await readFile(join(raiz, v.caminho), "utf8"));
        if (l !== null) locks.push(l);
      }
    } catch (e) {
      falhas.push({ caminho: v.caminho, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  aplicarLocks(manifestos, locks);
  const t2 = performance.now();
  const lerTexto = (c: string): string | null => {
    if (ehArquivoSensivel(c) || c.startsWith("/") || c.split("/").includes("..")) return null;
    try {
      return readFileSync(join(raiz, c), "utf8");
    } catch {
      return null;
    }
  };
  const existe = (c: string): boolean => {
    if (c.startsWith("/") || c.split("/").includes("..")) return false;
    return existsSync(join(raiz, c));
  };
  const resolucao = resolverTodos(opcoes.resolvedores ?? RESOLVEDORES_PADRAO, { arquivos, manifestos, raiz, lerTexto, existe });
  const t3 = performance.now();
  const chamadas = resolverChamadas({ arquivos, ligacoes: resolucao.ligacoes });
  const t4 = performance.now();
  const grafoImports = construirGrafo(
    [...arquivos.keys()].map((c) => `arq:${c}`),
    resolucao.arestas.map((a) => ({ de: a.de, para: a.para, tipo: a.tipo, confianca: a.confianca, peso: a.peso })),
  );
  return { arquivos, falhas, manifestos, resolucao, chamadas, grafoImports, ms: { varredura: t1 - t0, extracao: t2 - t1, resolucao: t3 - t2, chamadas: t4 - t3 } };
}
