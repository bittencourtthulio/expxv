import type { ImportBruto } from "../tipos";
import { Acumulador, arquivosDe, dirnameRel, idArquivo, idExterno, normalizarRel, relativoA, type ArquivoParaResolver, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor PHP (T-17.17). PSR-4 (`autoload` e `autoload-dev` do composer) -> arquivo `exata`; `classmap`/`files` e
// funções -> índice de símbolos (`heuristica`); `require` literal e `__DIR__ . '/x'` (o extrator já devolve `./x`)
// relativos ao arquivo; mesmo namespace implícito. Convenção de entrada: ver cabeçalho de extratores/php.ts.

const TIPOS_CLASSE = new Set(["classe", "interface", "trait", "enum"]);

interface Mapeamento {
  prefixo: string;
  pasta: string;
}

function limpar(fqn: string): string {
  return fqn.replace(/^\\/, "");
}

/** Namespace do arquivo: derivado do FQN do primeiro símbolo de topo (o extrator já qualifica com o namespace). */
function namespaceDe(a: ArquivoParaResolver): string | null {
  for (const s of a.extracao.simbolos) {
    const topo = s.qualificado.split(".")[0] as string;
    if (topo.includes("\\")) return topo.slice(0, topo.lastIndexOf("\\"));
    if (TIPOS_CLASSE.has(s.tipo) && !s.qualificado.includes(".")) return "";
  }
  return null;
}

export const resolvedorPhp: Resolvedor = {
  linguagens: ["php"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["php"]);
    const tem = (c: string): boolean => ctx.arquivos.has(c);

    const psr4: Mapeamento[] = [];
    for (const m of ctx.manifestos) if (m.tipo === "composer.json") for (const p of m.psr4) psr4.push({ prefixo: p.prefixo, pasta: p.pasta });
    psr4.sort((a, b) => b.prefixo.length - a.prefixo.length);

    // índices de símbolos (classmap/funções e "mesmo namespace")
    const classes = new Map<string, string>();
    const funcoes = new Map<string, string>();
    const nsDe = new Map<string, string>();
    for (const a of arquivos) {
      const ns = namespaceDe(a);
      if (ns !== null) nsDe.set(a.caminho, ns);
      for (const s of a.extracao.simbolos) {
        if (TIPOS_CLASSE.has(s.tipo) && !s.qualificado.includes(".") && !classes.has(s.qualificado)) classes.set(s.qualificado, a.caminho);
        else if (s.tipo === "funcao" && !s.qualificado.includes(".") && !funcoes.has(s.qualificado)) funcoes.set(s.qualificado, a.caminho);
      }
    }
    const porNamespace = new Map<string, Map<string, string>>();
    for (const [fqn, c] of classes) {
      const i = fqn.lastIndexOf("\\");
      const ns = i < 0 ? "" : fqn.slice(0, i);
      const m = porNamespace.get(ns) ?? new Map<string, string>();
      m.set(i < 0 ? fqn : fqn.slice(i + 1), c);
      porNamespace.set(ns, m);
    }

    const viaPsr4 = (fqn: string): string | null => {
      for (const { prefixo, pasta } of psr4) {
        if (!fqn.startsWith(prefixo)) continue;
        const resto = fqn.slice(prefixo.length).replace(/\\/g, "/");
        const cand = normalizarRel(pasta, `${resto}.php`);
        if (cand !== null && tem(cand)) return cand;
      }
      return null;
    };

    const externo = (fqn: string): string => {
      const [vendor, pacote] = fqn.split("\\") as [string, string | undefined];
      const nomeBase = vendor.toLowerCase();
      for (const m of ctx.manifestos) {
        if (m.tipo !== "composer.json") continue;
        const d = m.deps.find((x) => x.nome.startsWith(`${nomeBase}/`) && (pacote === undefined || x.nome.split("/")[1]?.replace(/-/g, "") === pacote.toLowerCase().replace(/-/g, "")))
          ?? m.deps.find((x) => x.nome.startsWith(`${nomeBase}/`));
        if (d !== undefined) return idExterno("composer", d.nome);
      }
      return idExterno("composer", nomeBase);
    };

    for (const a of arquivos) {
      const meuNs = nsDe.get(a.caminho) ?? null;
      const cobertos = new Set<string>();
      for (const imp of a.extracao.imports) {
        if (imp.tipo === "require") {
          resolverRequire(a, imp);
          continue;
        }
        const nome = imp.nomes[0]?.nome ?? "";
        const ehFuncao = nome.startsWith("function ");
        const ehConst = nome.startsWith("const ");
        const fqn = limpar(imp.especificador);
        const apelido = imp.nomes[0]?.alias ?? fqn.split("\\").pop() ?? "";
        cobertos.add(apelido);
        if (ehFuncao || ehConst) {
          const f = ehFuncao ? funcoes.get(fqn) : undefined;
          if (f !== undefined) ac.ligar(a.caminho, imp, idArquivo(f), "exata");
          else if (fqn.includes("\\") && psr4.some((p) => fqn.startsWith(p.prefixo))) ac.perdido(a.caminho, imp, "nao_encontrado");
          else ac.ligar(a.caminho, imp, fqn.includes("\\") ? externo(fqn) : idExterno("builtin", fqn), "exata");
          continue;
        }
        const p = viaPsr4(fqn);
        if (p !== null) {
          ac.ligar(a.caminho, imp, idArquivo(p), "exata");
          continue;
        }
        const idx = classes.get(fqn);
        if (idx !== undefined) {
          ac.ligar(a.caminho, imp, idArquivo(idx), "heuristica");
          continue;
        }
        if (psr4.some((m) => fqn.startsWith(m.prefixo))) {
          ac.perdido(a.caminho, imp, "nao_encontrado"); // namespace do projeto, classe inexistente
          continue;
        }
        ac.ligar(a.caminho, imp, fqn.includes("\\") ? externo(fqn) : idExterno("builtin", fqn), "exata");
      }

      // mesmo namespace sem `use`
      if (meuNs !== null) {
        const irmaos = porNamespace.get(meuNs);
        if (irmaos !== undefined) {
          const visto = new Set<string>();
          const usar = (nome: string | null | undefined, linha: number): void => {
            if (nome === undefined || nome === null || nome.startsWith("\\") || nome.startsWith("$") || nome.includes("\\")) return;
            const simples = nome.split(".")[0] as string;
            if (cobertos.has(simples) || visto.has(simples) || ["self", "static", "parent", "this", "?"].includes(simples)) return;
            const alvo = irmaos.get(simples);
            if (alvo === undefined || alvo === a.caminho) return;
            visto.add(simples);
            const fqn = meuNs === "" ? simples : `${meuNs}\\${simples}`;
            ac.ligar(a.caminho, { especificador: fqn, tipo: "estatico", linha, so_tipo: false, nomes: [{ nome: simples, alias: null }] }, idArquivo(alvo), "exata");
          };
          for (const h of a.extracao.herancas ?? []) usar(h.base, h.linha);
          for (const c of a.extracao.chamadas ?? []) {
            usar(c.tipo === "chamada" ? c.receptor : c.alvo, c.linha);
          }
        }
      }
    }

    function resolverRequire(a: ArquivoParaResolver, imp: ImportBruto): void {
      const spec = imp.especificador;
      if (/(^|\/)vendor\/autoload\.php$/.test(spec)) {
        ac.ignorados++;
        return;
      }
      const dir = dirnameRel(a.caminho);
      const rel = spec.startsWith("./") || spec.startsWith("../") ? relativoA(dir, spec) : relativoA(dir, spec);
      if (rel === null) return ac.perdido(a.caminho, imp, "fora_da_raiz");
      if (tem(rel)) return ac.ligar(a.caminho, imp, idArquivo(rel), "exata");
      const raiz = spec.startsWith("./") || spec.startsWith("../") ? null : relativoA("", spec);
      if (raiz !== null && tem(raiz)) return ac.ligar(a.caminho, imp, idArquivo(raiz), "heuristica");
      ac.perdido(a.caminho, imp, "nao_encontrado");
    }
    return ac.resultado();
  },
};
