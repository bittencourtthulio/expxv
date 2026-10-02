import { Acumulador, arquivosDe, dirnameRel, idArquivo, idExterno, type ArquivoParaResolver, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor Rust (T-17.18). `mod x;` -> `x.rs`/`x/mod.rs` (exata); `use crate/super/self` sobre a árvore de módulos
// derivada dos CAMINHOS (raiz do crate = `lib.rs`/`main.rs`); `use dep::…` -> `externo cargo` (ou outro crate do
// workspace). Módulos inline (`mod x { … }`) e macros não são conhecidos (limite declarado).

const RAIZES = ["lib.rs", "main.rs"];
const ESTD = new Set(["std", "core", "alloc", "proc_macro", "test"]);

interface Crate {
  raiz: string; // caminho do lib.rs/main.rs
  pasta: string; // pasta da raiz
  nome: string | null;
  modulos: Map<string, string>; // "a::b" -> arquivo
}

/** Caminho de módulo (`a::b`) de um arquivo dentro de um crate; `null` se não é módulo deste crate. */
export function caminhoDeModulo(arquivo: string, pastaRaiz: string): string[] | null {
  const rel = pastaRaiz === "" ? arquivo : arquivo.startsWith(`${pastaRaiz}/`) ? arquivo.slice(pastaRaiz.length + 1) : null;
  if (rel === null || !rel.endsWith(".rs")) return null;
  const partes = rel.slice(0, -3).split("/");
  const ultimo = partes[partes.length - 1] as string;
  if (partes.length === 1 && (ultimo === "lib" || ultimo === "main")) return [];
  if (ultimo === "mod") partes.pop();
  return partes;
}

export const resolvedorRust: Resolvedor = {
  linguagens: ["rust"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const arquivos = arquivosDe(ctx, ["rust"]);
    const tem = (c: string): boolean => ctx.arquivos.has(c);

    // crates: pastas que contêm lib.rs ou main.rs (raiz do crate)
    const crates: Crate[] = [];
    for (const a of arquivos) {
      const base = a.caminho.slice(a.caminho.lastIndexOf("/") + 1);
      if (!RAIZES.includes(base)) continue;
      const pasta = dirnameRel(a.caminho);
      let c = crates.find((x) => x.pasta === pasta);
      if (c === undefined) {
        const man = ctx.manifestos.find((m) => m.tipo === "Cargo.toml" && (m.pasta === "" ? pasta === "src" : pasta === `${m.pasta}/src`));
        c = { raiz: a.caminho, pasta, nome: man?.nome?.replace(/-/g, "_") ?? null, modulos: new Map() };
        crates.push(c);
      }
      if (base === "lib.rs") c.raiz = a.caminho; // lib prevalece como raiz para `crate::`
    }
    crates.sort((a, b) => b.pasta.length - a.pasta.length);
    const crateDe = (arquivo: string): Crate | null => crates.find((c) => arquivo.startsWith(`${c.pasta}/`)) ?? null;
    for (const c of crates)
      for (const a of arquivos) {
        if (crateDe(a.caminho) !== c) continue;
        const cm = caminhoDeModulo(a.caminho, c.pasta);
        if (cm !== null) c.modulos.set(cm.join("::"), a.caminho);
      }

    /** Resolve o prefixo mais longo de `segs` que é módulo do crate. */
    const resolverModulo = (c: Crate, segs: readonly string[]): { arquivo: string; consumidos: number } | null => {
      for (let n = segs.length; n >= 0; n--) {
        const f = c.modulos.get(segs.slice(0, n).join("::"));
        if (f !== undefined) return { arquivo: f, consumidos: n };
      }
      return null;
    };

    const filho = (c: Crate, pai: readonly string[], nome: string): string | null => c.modulos.get([...pai, nome].join("::")) ?? null;

    for (const a of arquivos) {
      const c = crateDe(a.caminho);
      const meuMod = c === null ? null : caminhoDeModulo(a.caminho, c.pasta);
      for (const imp of a.extracao.imports) {
        const tipo = imp.tipo === "reexport" ? "reexporta" : "importa";
        const spec = imp.especificador;
        // `mod x;`
        if (spec.startsWith("mod:")) {
          const nome = spec.slice(4);
          const base = a.caminho.slice(a.caminho.lastIndexOf("/") + 1);
          const dir = base === "mod.rs" || RAIZES.includes(base) ? dirnameRel(a.caminho) : `${dirnameRel(a.caminho)}/${base.slice(0, -3)}`.replace(/^\//, "");
          const cands = [`${dir}/${nome}.rs`, `${dir}/${nome}/mod.rs`].map((x) => x.replace(/^\//, ""));
          const achado = cands.find(tem);
          if (achado !== undefined) ac.ligar(a.caminho, imp, idArquivo(achado), "exata", tipo);
          else ac.perdido(a.caminho, imp, "nao_encontrado");
          continue;
        }
        const segs = spec.split("::").filter(Boolean);
        const primeiro = segs[0] ?? "";
        if (ESTD.has(primeiro)) {
          ac.ligar(a.caminho, imp, idExterno("stdlib", primeiro), "exata", tipo);
          continue;
        }
        let alvoCrate: Crate | null = c;
        let caminhoMod: string[] | null = null;
        if (primeiro === "crate") caminhoMod = segs.slice(1);
        else if (primeiro === "self" && meuMod !== null) caminhoMod = [...meuMod, ...segs.slice(1)];
        else if (primeiro === "super" && meuMod !== null) {
          let atual = [...meuMod];
          let i = 0;
          while (segs[i] === "super") {
            if (atual.length === 0) {
              caminhoMod = null;
              i = -1;
              break;
            }
            atual = atual.slice(0, -1);
            i++;
          }
          if (i >= 0) caminhoMod = [...atual, ...segs.slice(i)];
          else {
            ac.perdido(a.caminho, imp, "fora_da_raiz");
            continue;
          }
        } else if (c !== null && meuMod !== null && filho(c, meuMod, primeiro) !== null) caminhoMod = segs; // `use modulo_irmao::x` (2015/atalho)
        else if (c !== null && filho(c, [], primeiro) !== null && meuMod?.length === 0) caminhoMod = segs;
        else {
          // outro crate do workspace?
          const outro = crates.find((x) => x.nome !== null && x.nome === primeiro && x !== c);
          if (outro !== undefined) {
            alvoCrate = outro;
            caminhoMod = segs.slice(1);
          } else {
            ac.ligar(a.caminho, imp, idExterno("cargo", primeiro.replace(/_/g, "-")), "exata", tipo);
            continue;
          }
        }
        if (alvoCrate === null || caminhoMod === null) {
          ac.perdido(a.caminho, imp, "nao_encontrado");
          continue;
        }
        const r = resolverModulo(alvoCrate, caminhoMod);
        if (r === null) {
          ac.perdido(a.caminho, imp, "nao_encontrado");
          continue;
        }
        ac.ligar(a.caminho, imp, idArquivo(r.arquivo), "exata", tipo);
        // `use a::{b, c}`: cada nome pode ser submódulo
        if (r.consumidos === caminhoMod.length) {
          for (const n of imp.nomes) {
            if (n.nome === "self" || n.nome === "*") continue;
            const sub = filho(alvoCrate, caminhoMod, n.nome);
            if (sub !== null) ac.aresta(a.caminho, imp.linha, idArquivo(sub), "exata", tipo);
          }
        }
      }
    }
    return ac.resultado();
  },
};

