import { Acumulador, arquivosDe, dirnameRel, extensaoDe, idArquivo, idExterno, lerJsonc, normalizarRel, relativoA, semExtensao, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor C/C++ (T-17.18). `#include "a/b.h"`: relativo ao arquivo -> diretórios de include do
// `compile_commands.json` (lido como texto, nunca executado) -> raiz -> pastas `include/` por convenção (heurística);
// `<x>` -> `externo sistema` salvo se achado nos includes do projeto; par `.h` <-> `.c/.cpp` por mesmo nome (heurística).

const CABECALHOS = new Set([".h", ".hpp", ".hh", ".hxx"]);

/** Diretórios `-I`/`-isystem`/`-iquote` de um compile_commands.json, relativos à raiz do workspace. */
export function includesDeCompileCommands(texto: string | null, raizAbsoluta?: string): string[] {
  if (texto === null) return [];
  const j = lerJsonc(texto);
  if (!Array.isArray(j)) return [];
  const saida = new Set<string>();
  for (const e of j as Array<Record<string, unknown>>) {
    const dir = typeof e.directory === "string" ? e.directory : "";
    const args: string[] = Array.isArray(e.arguments) ? (e.arguments as unknown[]).filter((x): x is string => typeof x === "string") : typeof e.command === "string" ? e.command.split(/\s+/) : [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as string;
      let d: string | null = null;
      const m = /^-(?:I|isystem|iquote)(.*)$/.exec(a);
      if (m !== null) d = m[1] !== "" ? (m[1] as string) : (args[++i] ?? null);
      if (d === null) continue;
      let abs = d.startsWith("/") || dir === "" ? d : `${dir}/${d}`;
      if (raizAbsoluta !== undefined && abs.startsWith(`${raizAbsoluta}/`)) abs = abs.slice(raizAbsoluta.length + 1);
      else if (raizAbsoluta !== undefined && abs === raizAbsoluta) abs = "";
      else if (abs.startsWith("/")) continue; // fora da raiz do workspace
      const n = normalizarRel(abs);
      if (n !== null) saida.add(n);
    }
  }
  return [...saida];
}

export const resolvedorCpp: Resolvedor = {
  linguagens: ["c", "cpp"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["c", "cpp"]);
    const tem = (c: string): boolean => ctx.arquivos.has(c);
    const incs = includesDeCompileCommands(ctx.lerTexto?.("compile_commands.json") ?? ctx.lerTexto?.("build/compile_commands.json") ?? null, ctx.raiz);
    // convenção: pastas `include` em qualquer nível
    const convencao = new Set<string>(["include", "inc", "src"]);
    for (const c of ctx.arquivos.keys()) {
      const m = /^((?:[^/]+\/)*(?:include|inc))\//.exec(c);
      if (m !== null) convencao.add(m[1] as string);
    }

    for (const a of arquivos) {
      for (const imp of a.extracao.imports) {
        const spec = imp.especificador;
        const sistema = spec.startsWith("<");
        const nome = sistema ? spec.slice(1, -1) : spec;
        const dir = dirnameRel(a.caminho);
        let achado: string | null = null;
        let conf: "exata" | "heuristica" = "exata";
        if (!sistema) {
          const rel = relativoA(dir, nome);
          if (rel !== null && tem(rel)) achado = rel;
        }
        if (achado === null)
          for (const d of incs) {
            const c = normalizarRel(d, nome);
            if (c !== null && tem(c)) {
              achado = c;
              break;
            }
          }
        if (achado === null && !sistema) {
          const c = normalizarRel(nome);
          if (c !== null && tem(c)) {
            achado = c;
            conf = "heuristica";
          }
        }
        if (achado === null && !sistema)
          for (const d of convencao) {
            const c = normalizarRel(d, nome);
            if (c !== null && tem(c)) {
              achado = c;
              conf = "heuristica";
              break;
            }
          }
        if (achado !== null) {
          ac.ligar(a.caminho, imp, idArquivo(achado), conf);
          continue;
        }
        if (sistema) {
          ac.ligar(a.caminho, imp, idExterno("sistema", nome), "exata");
          continue;
        }
        if (nome.startsWith("/") || nome.split("/").includes("..") && normalizarRel(dir, nome) === null) {
          ac.perdido(a.caminho, imp, "fora_da_raiz");
          continue;
        }
        // `#include "x.h"` de biblioteca instalada: sem como saber; listado, nunca omitido
        ac.perdido(a.caminho, imp, "nao_encontrado");
      }
    }

    // par cabeçalho <-> implementação por mesmo nome (fonte -> cabeçalho)
    const cabecalhos = new Map<string, string[]>();
    for (const a of arquivos) {
      if (!CABECALHOS.has(extensaoDe(a.caminho))) continue;
      const stem = semExtensao(a.caminho.slice(a.caminho.lastIndexOf("/") + 1));
      const l = cabecalhos.get(stem) ?? [];
      l.push(a.caminho);
      cabecalhos.set(stem, l);
    }
    for (const a of arquivos) {
      if (CABECALHOS.has(extensaoDe(a.caminho))) continue;
      const stem = semExtensao(a.caminho.slice(a.caminho.lastIndexOf("/") + 1));
      const cands = cabecalhos.get(stem) ?? [];
      if (cands.length !== 1) continue; // ambíguo: não chuta
      ac.aresta(a.caminho, 1, idArquivo(cands[0] as string), "heuristica");
    }
    return ac.resultado();
  },
};
