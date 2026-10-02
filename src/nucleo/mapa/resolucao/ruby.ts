import type { ImportBruto } from "../tipos";
import { Acumulador, arquivosDe, dirnameRel, idArquivo, idExterno, relativoA, normalizarRel, type ArquivoParaResolver, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor Ruby (T-17.18). `require_relative` exata; `require` por load paths (`lib/`, `app/**`) heurística;
// constantes por convenção Zeitwerk (`Foo::BarBaz` -> `foo/bar_baz.rb`) heurística; gems do Gemfile -> externo.
// Convenções do extrator: ver extratores/ruby.ts (`require_relative` já traz `./`/`../`).

const STDLIB_RUBY = new Set(
  "json set date time yaml erb csv fileutils pathname tempfile logger optparse securerandom digest net/http uri open3 forwardable singleton ostruct benchmark bigdecimal stringio strscan timeout socket openssl zlib base64 English shellwords find pp io/console monitor observer thread etc rbconfig psych abbrev delegate weakref objspace ripper readline racc coverage".split(" "),
);

/** `FooBar` -> `foo_bar` (underscore do ActiveSupport, reimplementado). */
export function sublinhado(nome: string): string {
  return nome.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase();
}

export const resolvedorRuby: Resolvedor = {
  linguagens: ["ruby"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["ruby"]);
    const tem = (c: string): boolean => ctx.arquivos.has(c);

    // load paths e autoload paths (Rails: toda subpasta direta de app/)
    const raizes = new Set<string>(["lib", "", "app"]);
    for (const c of ctx.arquivos.keys()) {
      const m = /^((?:[^/]+\/)*app\/[^/]+)\//.exec(c);
      if (m !== null) raizes.add(m[1] as string);
      const l = /^((?:[^/]+\/)*lib)\//.exec(c);
      if (l !== null) raizes.add(l[1] as string);
    }
    const ordem = [...raizes].sort((a, b) => a.length - b.length);
    const gems = new Set<string>();
    for (const m of ctx.manifestos) if (m.tipo === "Gemfile") for (const d of m.deps) gems.add(d.nome);

    const sonda = (base: string): string | null => (base.endsWith(".rb") && tem(base) ? base : tem(`${base}.rb`) ? `${base}.rb` : null);

    // índice de constantes (qualificado `A.B` -> arquivo)
    const constantes = new Map<string, string>();
    for (const a of arquivos)
      for (const s of a.extracao.simbolos)
        if (s.tipo === "classe" && !constantes.has(s.qualificado)) constantes.set(s.qualificado, a.caminho);

    const resolverRequire = (a: ArquivoParaResolver, imp: ImportBruto): void => {
      const spec = imp.especificador;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const rel = relativoA(dirnameRel(a.caminho), spec);
        if (rel === null) return ac.perdido(a.caminho, imp, "fora_da_raiz");
        const f = sonda(rel);
        if (f !== null) return ac.ligar(a.caminho, imp, idArquivo(f), "exata");
        return ac.perdido(a.caminho, imp, "nao_encontrado");
      }
      if (spec.startsWith("/")) return ac.perdido(a.caminho, imp, "fora_da_raiz");
      for (const r of ordem) {
        const base = normalizarRel(r, spec);
        const f = base === null ? null : sonda(base);
        if (f !== null) return ac.ligar(a.caminho, imp, idArquivo(f), "heuristica");
      }
      const topo = spec.split("/")[0] as string;
      if (STDLIB_RUBY.has(spec) || STDLIB_RUBY.has(topo)) return ac.ligar(a.caminho, imp, idExterno("stdlib", topo), "exata");
      const gem = [...gems].find((g) => g === spec || g === topo || g.replace(/-/g, "/") === spec);
      if (gem !== undefined) return ac.ligar(a.caminho, imp, idExterno("gem", gem), "exata");
      ac.perdido(a.caminho, imp, "nao_encontrado");
    };

    const porConstante = (nome: string): string | null => {
      const limpo = nome.replace(/^::/, "");
      const q = limpo.replace(/::/g, ".");
      const direto = constantes.get(q);
      if (direto !== undefined) return direto;
      const caminho = limpo.split("::").map(sublinhado).join("/");
      for (const r of ordem) {
        const base = normalizarRel(r, caminho);
        const f = base === null ? null : sonda(base);
        if (f !== null) return f;
      }
      return null;
    };

    for (const a of arquivos) {
      for (const imp of a.extracao.imports) {
        if (imp.tipo === "dinamico" && imp.especificador === "") continue;
        resolverRequire(a, imp);
        // autoload :Foo, 'foo' já foi tratado como require do caminho
      }
      // constantes referenciadas (Zeitwerk)
      const visto = new Set<string>();
      const definidos = new Set(a.extracao.simbolos.map((s) => s.qualificado.split(".")[0] as string));
      const usar = (nome: string | null | undefined, linha: number): void => {
        if (nome === undefined || nome === null) return;
        const limpo = nome.replace(/\.new$/, "");
        if (!/^(::)?[A-Z]/.test(limpo) || limpo.includes("(") || visto.has(limpo)) return;
        const topo = limpo.split("::")[0] as string;
        if (definidos.has(topo)) return;
        visto.add(limpo);
        const f = porConstante(limpo);
        if (f === null || f === a.caminho) return;
        ac.ligar(a.caminho, { especificador: limpo, tipo: "estatico", linha, so_tipo: false, nomes: [] }, idArquivo(f), "heuristica");
      };
      for (const h of a.extracao.herancas ?? []) usar(h.base, h.linha);
      for (const c of a.extracao.chamadas ?? []) {
        usar(c.receptor, c.linha);
        if (c.tipo !== "chamada") usar(c.alvo, c.linha);
      }
    }
    return ac.resultado();
  },
};
