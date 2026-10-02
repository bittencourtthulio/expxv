import { builtinModules } from "node:module";
import type { Manifesto } from "../manifestos";
import type { ImportBruto, Linguagem } from "../tipos";
import {
  Acumulador,
  arquivosDe,
  dirnameRel,
  extensaoDe,
  idArquivo,
  idExterno,
  lerJsonc,
  normalizarRel,
  relativoA,
  type ArquivoParaResolver,
  type ContextoResolucao,
  type Resolvedor,
  type ResultadoResolucao,
} from "./comum";

// Resolvedor de imports JS/TS (T-17.16). Reimplementado a partir das regras do TypeScript (relativos com sondagem
// de extensão, troca ESM `.js` -> `.ts`, `tsconfig` com `paths`/`baseUrl`/`extends`/`references`, workspaces,
// `exports` básico). Alias de bundler não avaliado => `heuristica` por sufixo único. NADA é executado.

const LINGUAGENS_TS: readonly Linguagem[] = ["typescript", "javascript", "tsx", "jsx"];
const EXTENSOES_FONTE = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const TROCA_ESM: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};
const ATIVOS = new Set([".css", ".scss", ".sass", ".less", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".md", ".txt", ".html", ".wasm", ".node", ".yaml", ".yml", ".graphql", ".gql", ".mp3", ".mp4"]);
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "").split("/")[0] as string));
const PREFIXOS_ALIAS = ["@/", "~/", "#", "$lib/", "$app/", "@@/"];

export interface ConfigTs {
  /** Arquivo `tsconfig` que originou a configuração efetiva. */
  arquivo: string;
  /** Pasta (relativa à raiz) contra a qual `paths` casa. */
  baseUrl: string | null;
  paths: Array<{ padrao: string; alvos: string[] }>;
  /** Pasta de resolução dos `paths` quando não há `baseUrl`. */
  pastaPaths: string;
  references: string[];
  /** `files: []` sem `include` (config "solução"). */
  solucao: boolean;
  avisos: string[];
}

type Json = Record<string, unknown>;

class LeitorTsconfig {
  private readonly cache = new Map<string, ConfigTs | null>();
  constructor(private readonly ler: (c: string) => string | null) {}

  carregar(arquivo: string, visitados: Set<string> = new Set()): ConfigTs | null {
    if (visitados.has(arquivo)) return null; // ciclo de `extends`
    if (visitados.size === 0 && this.cache.has(arquivo)) return this.cache.get(arquivo) ?? null;
    const texto = this.ler(arquivo);
    const j = texto === null ? null : (lerJsonc(texto) as Json | null);
    if (j === null || typeof j !== "object") {
      if (visitados.size === 0) this.cache.set(arquivo, null);
      return null;
    }
    visitados.add(arquivo);
    const pasta = dirnameRel(arquivo);
    const cfg: ConfigTs = { arquivo, baseUrl: null, paths: [], pastaPaths: pasta, references: [], solucao: false, avisos: [] };
    const ext = j.extends;
    for (const e of Array.isArray(ext) ? ext : ext === undefined ? [] : [ext]) {
      if (typeof e !== "string") continue;
      if (!e.startsWith(".")) {
        cfg.avisos.push(`extends de pacote ignorado: ${e}`);
        continue;
      }
      let alvo = relativoA(pasta, e);
      if (alvo === null) continue;
      if (!alvo.endsWith(".json")) alvo += ".json";
      const pai = this.carregar(alvo, visitados);
      if (pai !== null) {
        cfg.baseUrl = pai.baseUrl;
        cfg.paths = pai.paths;
        cfg.pastaPaths = pai.pastaPaths;
        cfg.avisos.push(...pai.avisos);
      }
    }
    const co = (j.compilerOptions ?? {}) as Json;
    if (typeof co.baseUrl === "string") cfg.baseUrl = relativoA(pasta, co.baseUrl);
    if (co.paths !== null && typeof co.paths === "object") {
      cfg.paths = Object.entries(co.paths as Json).map(([padrao, alvos]) => ({ padrao, alvos: (Array.isArray(alvos) ? alvos : []).filter((a): a is string => typeof a === "string") }));
      cfg.pastaPaths = pasta;
    }
    if (Array.isArray(j.references))
      for (const r of j.references) {
        const p = typeof (r as Json).path === "string" ? relativoA(pasta, (r as Json).path as string) : null;
        if (p !== null) cfg.references.push(p.endsWith(".json") ? p : `${p}/tsconfig.json`);
      }
    cfg.solucao = Array.isArray(j.files) && j.files.length === 0 && j.include === undefined;
    visitados.delete(arquivo);
    if (visitados.size === 0) this.cache.set(arquivo, cfg);
    return cfg;
  }
}

/** Sondagem de extensão sobre os arquivos indexados (pura). */
export function sondar(base: string, tem: (c: string) => boolean): string | null {
  const ext = extensaoDe(base);
  const troca = TROCA_ESM[ext];
  if (troca !== undefined) {
    const semExt = base.slice(0, -ext.length);
    for (const e of troca) if (tem(semExt + e)) return semExt + e;
  }
  if (ext !== "" && tem(base)) return base;
  for (const e of EXTENSOES_FONTE) if (tem(base + e)) return base + e;
  for (const e of EXTENSOES_FONTE) if (tem(`${base}/index${e}`)) return `${base}/index${e}`;
  return null;
}

function casarPadrao(padrao: string, spec: string): string | null {
  const i = padrao.indexOf("*");
  if (i < 0) return padrao === spec ? "" : null;
  const pre = padrao.slice(0, i);
  const pos = padrao.slice(i + 1);
  if (spec.length >= pre.length + pos.length && spec.startsWith(pre) && spec.endsWith(pos)) return spec.slice(pre.length, spec.length - pos.length);
  return null;
}

function nomePacote(spec: string): { pacote: string; sub: string } {
  const p = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  return { pacote: p.slice(0, n).join("/"), sub: p.slice(n).join("/") };
}

interface Workspace {
  nome: string;
  pasta: string;
  manifesto: Manifesto;
}

export const resolvedorTs: Resolvedor = {
  linguagens: LINGUAGENS_TS,
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const tem = (c: string): boolean => ctx.arquivos.has(c);
    const leitor = new LeitorTsconfig(ctx.lerTexto ?? (() => null));
    const workspaces = new Map<string, Workspace>();
    for (const m of ctx.manifestos) if (m.tipo === "package.json" && m.nome !== null) workspaces.set(m.nome, { nome: m.nome, pasta: m.pasta, manifesto: m });
    const cacheConfig = new Map<string, ConfigTs | null>();
    const indiceSufixo = construirSufixos(ctx.arquivos);

    const configDe = (arquivo: string): ConfigTs | null => {
      const pasta = dirnameRel(arquivo);
      if (cacheConfig.has(pasta)) return cacheConfig.get(pasta) ?? null;
      let achada: ConfigTs | null = null;
      let dir = pasta;
      for (;;) {
        const cand = dir === "" ? "tsconfig.json" : `${dir}/tsconfig.json`;
        const cfg = leitor.carregar(cand);
        if (cfg !== null) {
          if (cfg.solucao || (cfg.references.length > 0 && cfg.paths.length === 0 && cfg.baseUrl === null)) {
            // solução: procura entre as referências a que contém o arquivo
            const ref = cfg.references.map((r) => leitor.carregar(r)).find((c) => c !== null && (dirnameRel(c.arquivo) === "" || arquivo.startsWith(`${dirnameRel(c.arquivo)}/`)));
            achada = ref ?? cfg;
          } else achada = cfg;
          break;
        }
        if (dir === "") break;
        dir = dirnameRel(dir);
      }
      cacheConfig.set(pasta, achada);
      return achada;
    };

    const externo = (pacote: string): string => (BUILTINS.has(pacote) ? idExterno("stdlib", pacote) : idExterno("npm", pacote));

    const viaWorkspace = (spec: string): { arq: string | null; exata: boolean } | null => {
      const { pacote, sub } = nomePacote(spec);
      const ws = workspaces.get(pacote);
      if (ws === undefined) return null;
      const raiz = ws.pasta;
      const junta = (rel: string): string | null => normalizarRel(raiz, rel);
      if (sub !== "") {
        for (const [rel, exata] of [[sub, true], [`src/${sub}`, false]] as const) {
          const b = junta(rel);
          const r = b === null ? null : sondar(b, tem);
          if (r !== null) return { arq: r, exata };
        }
        return { arq: null, exata: false };
      }
      const candidatos: Array<[string | null, boolean]> = [];
      for (const alvo of [ws.manifesto.main, ...ws.manifesto.exports_alvos]) {
        if (alvo === null) continue;
        candidatos.push([junta(alvo), true]);
        candidatos.push([junta(alvo.replace(/^\.?\/?(dist|lib|build|out)\//, "src/")), false]);
      }
      candidatos.push([junta("src/index"), false], [junta("index"), false]);
      for (const [b, exata] of candidatos) {
        if (b === null) continue;
        const r = sondar(b.replace(/\.(d\.ts|map)$/, ""), tem);
        if (r !== null) return { arq: r, exata };
      }
      return { arq: null, exata: false };
    };

    const resolverImport = (a: ArquivoParaResolver, imp: ImportBruto): void => {
      const tipo = imp.tipo === "reexport" ? "reexporta" : "importa";
      let spec = imp.especificador.replace(/[?#].*$/, "");
      if (imp.tipo === "dinamico" && spec === "") return;
      const ext = extensaoDe(spec);
      const pasta = dirnameRel(a.caminho);

      if (spec.startsWith("node:")) {
        ac.ligar(a.caminho, imp, idExterno("stdlib", spec.slice(5).split("/")[0] as string), "exata", tipo);
        return;
      }
      // relativo
      if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
        const b = relativoA(pasta, spec);
        if (b === null) return ac.perdido(a.caminho, imp, "fora_da_raiz");
        const r = sondar(b, tem);
        if (r !== null) return ac.ligar(a.caminho, imp, idArquivo(r), "exata", tipo);
        if (ATIVOS.has(ext) || ctx.existe?.(b) === true) {
          ac.ignorados++;
          return;
        }
        return ac.perdido(a.caminho, imp, "nao_encontrado");
      }
      if (spec.startsWith("/")) return ac.perdido(a.caminho, imp, "fora_da_raiz");
      if (spec.startsWith("data:") || /^[a-z][a-z0-9+.-]*:/i.test(spec)) {
        ac.ignorados++;
        return;
      }

      const cfg = configDe(a.caminho);
      // paths do tsconfig (o padrão mais específico = prefixo mais longo vence)
      let casouPadrao = false;
      if (cfg !== null) {
        const ordenados = [...cfg.paths].sort((x, y) => y.padrao.indexOf("*") - x.padrao.indexOf("*") || y.padrao.length - x.padrao.length);
        for (const { padrao, alvos } of ordenados) {
          const cap = casarPadrao(padrao, spec);
          if (cap === null) continue;
          casouPadrao = true;
          for (const alvo of alvos) {
            const b = normalizarRel(cfg.baseUrl ?? cfg.pastaPaths, alvo.replace("*", cap));
            const r = b === null ? null : sondar(b, tem);
            if (r !== null) return ac.ligar(a.caminho, imp, idArquivo(r), "exata", tipo);
          }
        }
        if (cfg.baseUrl !== null) {
          const b = normalizarRel(cfg.baseUrl, spec);
          const r = b === null ? null : sondar(b, tem);
          if (r !== null) return ac.ligar(a.caminho, imp, idArquivo(r), "exata", tipo);
        }
      }
      if (casouPadrao) return ac.perdido(a.caminho, imp, "nao_encontrado"); // casou um alias do tsconfig mas o alvo não existe: não vira pacote npm
      // workspaces
      const ws = viaWorkspace(spec);
      if (ws !== null) {
        if (ws.arq !== null) return ac.ligar(a.caminho, imp, idArquivo(ws.arq), ws.exata ? "exata" : "heuristica", tipo);
        return ac.perdido(a.caminho, imp, "nao_encontrado");
      }
      // alias de bundler (não avaliado): sufixo único
      if (PREFIXOS_ALIAS.some((p) => spec.startsWith(p))) {
        const resto = spec.replace(/^(@@?\/|~\/|#|\$lib\/|\$app\/)/, "");
        const achados = indiceSufixo.achar(resto);
        if (achados.length === 1) return ac.ligar(a.caminho, imp, idArquivo(achados[0] as string), "heuristica", tipo);
        return ac.perdido(a.caminho, imp, achados.length > 1 ? "ambiguo" : "nao_encontrado");
      }
      // pacote externo
      const { pacote } = nomePacote(spec);
      spec = pacote;
      ac.ligar(a.caminho, imp, externo(pacote), "exata", tipo);
    };

    for (const a of arquivosDe(ctx, LINGUAGENS_TS))
      for (const imp of a.extracao.imports) {
        if (imp.tipo === "dinamico" && imp.especificador === "") continue;
        resolverImport(a, imp);
      }
    return ac.resultado();
  },
};

/** Índice por sufixo de caminho sem extensão (`a/b/c` casa `x/a/b/c.ts` e `x/a/b/c/index.ts`). */
function construirSufixos(arquivos: ReadonlyMap<string, ArquivoParaResolver>): { achar(resto: string): string[] } {
  const porSufixo = new Map<string, Set<string>>();
  for (const c of arquivos.keys()) {
    if (!EXTENSOES_FONTE.includes(extensaoDe(c))) continue;
    const semExt = c.slice(0, c.length - extensaoDe(c).length);
    const bases = [semExt];
    if (/\/index$/.test(semExt)) bases.push(semExt.replace(/\/index$/, ""));
    for (const b of bases) {
      const partes = b.split("/");
      for (let i = 0; i < partes.length; i++) {
        const suf = partes.slice(i).join("/");
        let s = porSufixo.get(suf);
        if (s === undefined) porSufixo.set(suf, (s = new Set()));
        s.add(c);
      }
    }
  }
  return {
    achar(resto: string): string[] {
      const k = resto.replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
      return [...(porSufixo.get(k) ?? [])].sort();
    },
  };
}
