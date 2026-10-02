import type { ImportBruto } from "../tipos";
import { Acumulador, arquivosDe, idArquivo, idExterno, manifestoMaisProximo, type ArquivoParaResolver, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor C# (T-17.17). `using Namespace` -> arquivos que declaram o namespace (`heuristica`), afinado pela busca do
// TIPO usado entre os `using` (único => `exata`); `using static`/alias apontam para o tipo; namespace do próprio arquivo
// e dos pais é implícito; `ProjectReference` do .csproj limita o alcance. Convenções do extrator: ver extratores/csharp.ts.

const MAX_ALVOS = 50;
const TIPOS = new Set(["classe", "interface", "struct", "enum"]);

interface Tipo {
  fqn: string;
  nome: string;
  arquivo: string;
  ns: string;
}

/** Tipos de topo de um arquivo (os que não estão aninhados em outro tipo do mesmo arquivo). */
export function tiposDoArquivo(a: ArquivoParaResolver): Tipo[] {
  const tipos = a.extracao.simbolos.filter((s) => TIPOS.has(s.tipo)).map((s) => s.qualificado.replace(/~\d+$/, ""));
  const topo: Tipo[] = [];
  for (const q of tipos) {
    if (tipos.some((o) => o !== q && q.startsWith(`${o}.`))) continue;
    const i = q.lastIndexOf(".");
    topo.push({ fqn: q, nome: q.slice(i + 1), arquivo: a.caminho, ns: i < 0 ? "" : q.slice(0, i) });
  }
  return topo;
}

function namespacesPai(ns: string): string[] {
  const partes = ns.split(".").filter(Boolean);
  const r: string[] = [];
  for (let n = partes.length; n >= 1; n--) r.push(partes.slice(0, n).join("."));
  return r;
}

export const resolvedorCsharp: Resolvedor = {
  linguagens: ["csharp"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["csharp"]);
    const porFqn = new Map<string, Tipo>();
    const porNs = new Map<string, Tipo[]>();
    const nsDoArquivo = new Map<string, string>();
    for (const a of arquivos)
      for (const t of tiposDoArquivo(a)) {
        if (!porFqn.has(t.fqn)) porFqn.set(t.fqn, t);
        const l = porNs.get(t.ns) ?? [];
        l.push(t);
        porNs.set(t.ns, l);
        if (!nsDoArquivo.has(a.caminho)) nsDoArquivo.set(a.caminho, t.ns);
      }

    // alcance por projeto (ProjectReference, fechamento transitivo)
    const csprojs = ctx.manifestos.filter((m) => m.tipo === "csproj");
    const alcance = new Map<string, Set<string>>();
    const refs = (arquivo: string): Set<string> => {
      const ini = arquivo;
      const c = alcance.get(ini);
      if (c !== undefined) return c;
      const r = new Set<string>([ini]);
      const fila = [ini];
      while (fila.length > 0) {
        const m = csprojs.find((x) => x.arquivo === fila.pop());
        for (const ref of m?.referencias ?? []) if (!r.has(ref)) { r.add(ref); fila.push(ref); }
      }
      alcance.set(ini, r);
      return r;
    };
    const projetoDe = (c: string): string | null => manifestoMaisProximo(csprojs, "csproj", c)?.arquivo ?? null;
    const alcancavel = (de: string, para: string): boolean => {
      const a = projetoDe(de);
      const b = projetoDe(para);
      return a === null || b === null || a === b || refs(a).has(b);
    };
    const conf = (de: string, para: string): "exata" | "heuristica" => (alcancavel(de, para) ? "exata" : "heuristica");

    const externoDe = (ns: string): string => {
      const topo = ns.split(".")[0] as string;
      if (topo === "System") return idExterno("stdlib", ns.split(".").slice(0, 2).join("."));
      for (const m of ctx.manifestos) {
        if (m.tipo !== "csproj") continue;
        const d = m.deps.filter((x) => ns === x.nome || ns.startsWith(`${x.nome}.`)).sort((x, y) => y.nome.length - x.nome.length)[0];
        if (d !== undefined) return idExterno("nuget", d.nome);
      }
      return idExterno("nuget", ns.split(".").slice(0, 2).join("."));
    };

    for (const a of arquivos) {
      const meuNs = nsDoArquivo.get(a.caminho) ?? "";
      const e = a.extracao;
      // nomes de tipo usados (simples), com a primeira linha de uso
      const usados = new Map<string, number>();
      const usar = (nome: string | null | undefined, linha: number): void => {
        if (nome === undefined || nome === null) return;
        const simples = nome.replace(/<.*$/, "").split(".")[0] as string;
        if (/^[A-Z]/.test(simples) && !usados.has(simples)) usados.set(simples, linha);
      };
      for (const h of e.herancas ?? []) {
        usar(h.base, h.linha);
        usar(h.classe, h.linha);
      }
      for (const c of e.chamadas ?? []) {
        usar(c.receptor, c.linha);
        if (c.tipo !== "chamada") usar(c.alvo, c.linha);
      }

      const nsVisiveis: string[] = [];
      const aliasTipo = new Map<string, Tipo>();
      const alvosPorNome = new Map<string, Tipo[]>();
      const registrar = (ns: string): void => {
        for (const t of porNs.get(ns) ?? []) {
          const l = alvosPorNome.get(t.nome) ?? [];
          if (!l.some((x) => x.fqn === t.fqn)) l.push(t);
          alvosPorNome.set(t.nome, l);
        }
      };
      for (const ns of namespacesPai(meuNs)) registrar(ns);
      registrar("");

      const imports: ImportBruto[] = [...e.imports];
      // 1) tipos de using static / alias
      for (const imp of imports) {
        const spec = imp.especificador;
        const ehStatic = imp.nomes.some((n) => n.nome === "static");
        const alias = imp.nomes.find((n) => n.nome === "*" && n.alias !== null)?.alias ?? null;
        if (ehStatic || alias !== null) {
          const t = porFqn.get(spec);
          if (t !== undefined) {
            ac.ligar(a.caminho, imp, idArquivo(t.arquivo), conf(a.caminho, t.arquivo));
            if (alias !== null) aliasTipo.set(alias, t);
            continue;
          }
          if (alias !== null && porNs.has(spec)) {
            ac.ligarMuitos(a.caminho, imp, (porNs.get(spec) as Tipo[]).slice(0, MAX_ALVOS).map((x) => idArquivo(x.arquivo)), "heuristica");
            continue;
          }
          ac.ligar(a.caminho, imp, externoDe(spec), "exata");
          continue;
        }
        if (porNs.has(spec)) nsVisiveis.push(spec);
      }
      for (const ns of nsVisiveis) registrar(ns);

      // 2) using Namespace
      const jaLigado = new Set<string>();
      for (const imp of imports) {
        const spec = imp.especificador;
        if (imp.nomes.some((n) => n.nome === "static" || (n.nome === "*" && n.alias !== null))) continue;
        const tipos = porNs.get(spec);
        if (tipos === undefined) {
          // namespace do projeto sem tipos aqui, ou externo
          const doProjeto = [...porNs.keys()].some((k) => k === spec || k.startsWith(`${spec}.`));
          if (doProjeto) ac.ligar(a.caminho, imp, null, "heuristica");
          else ac.ligar(a.caminho, imp, externoDe(spec), "exata");
          continue;
        }
        const casados = tipos.filter((t) => usados.has(t.nome) && t.arquivo !== a.caminho);
        if (casados.length > 0) {
          const unicos = casados.filter((t) => (alvosPorNome.get(t.nome) ?? []).length === 1);
          const alvos = casados.map((t) => idArquivo(t.arquivo));
          const exata = unicos.length === casados.length && casados.every((t) => alcancavel(a.caminho, t.arquivo));
          ac.ligarMuitos(a.caminho, imp, alvos, exata ? "exata" : "heuristica");
          for (const t of casados) jaLigado.add(t.fqn);
        } else {
          const todos = tipos.filter((t) => t.arquivo !== a.caminho).slice(0, MAX_ALVOS);
          ac.ligarMuitos(a.caminho, imp, todos.map((t) => idArquivo(t.arquivo)), "heuristica");
        }
      }

      // 3) namespace próprio/pai implícito + alias: tipos usados sem `using`
      for (const [nome, linha] of usados) {
        const viaAlias = aliasTipo.get(nome);
        if (viaAlias !== undefined) continue;
        const cands = (alvosPorNome.get(nome) ?? []).filter((t) => !jaLigado.has(t.fqn) && t.arquivo !== a.caminho);
        const proprios = cands.filter((t) => meuNs === t.ns || meuNs.startsWith(`${t.ns}.`) || t.ns === "");
        if (proprios.length !== 1) continue;
        const t = proprios[0] as Tipo;
        ac.ligar(a.caminho, { especificador: t.ns === "" ? t.nome : t.ns, tipo: "estatico", linha, so_tipo: false, nomes: [] }, idArquivo(t.arquivo), conf(a.caminho, t.arquivo));
        jaLigado.add(t.fqn);
      }
    }
    return ac.resultado();
  },
};
