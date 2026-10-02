import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import type { LeitorProjeto } from "./analises/externas";
import { ehArquivoSensivel } from "./sensiveis";

// Leitor SOMENTE LEITURA confinado à raiz do workspace (T-17.21, auditoria do mapa). É o único jeito de a fase derivada
// (resolvedores, manifestos, cobertura, licenças) tocar o disco do projeto analisado:
//  - recusa caminho absoluto, byte NUL, `..` que sai da raiz e qualquer arquivo de ambiente/chave (`sensiveis.ts`);
//  - recusa symlink cujo destino (realpath) fica FORA da raiz; nunca segue link para `/etc` etc.;
//  - teto de bytes por leitura (padrão 2 MB) e de entradas por listagem;
//  - nunca executa nada, nunca usa shell.

export const TETO_LEITURA_PADRAO = 2_000_000;
const TETO_LISTAGEM = 20_000;

/** Caminho relativo seguro (com `/`), ou `null`. */
export function caminhoRelativoSeguro(rel: unknown): string | null {
  if (typeof rel !== "string" || rel === "" || rel.length > 4096 || rel.includes("\0")) return null;
  const c = rel.replace(/\\/g, "/");
  if (c.startsWith("/") || /^[A-Za-z]:\//.test(c) || isAbsolute(rel)) return null;
  const partes: string[] = [];
  for (const p of c.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (partes.length === 0) return null;
      partes.pop();
    } else partes.push(p);
  }
  return partes.length === 0 ? null : partes.join("/");
}

export interface LeitorConfinado extends LeitorProjeto {
  existe(caminho: string): boolean;
  /** Raiz absoluta (já resolvida por realpath). */
  readonly raiz: string;
}

export interface OpcoesLeitorConfinado {
  tetoBytes?: number;
}

export function criarLeitorConfinado(raizAbs: string, op: OpcoesLeitorConfinado = {}): LeitorConfinado {
  let raiz = raizAbs;
  try {
    raiz = realpathSync(raizAbs);
  } catch {
    /* raiz inexistente: toda leitura falha */
  }
  const teto = op.tetoBytes ?? TETO_LEITURA_PADRAO;
  const prefixo = raiz.endsWith(sep) ? raiz : raiz + sep;

  /** Caminho absoluto confinado, ou `null`. Resolve symlinks e confere que continuam dentro da raiz. */
  function resolver(rel: string): string | null {
    const seguro = caminhoRelativoSeguro(rel);
    if (seguro === null) return null;
    if (ehArquivoSensivel(seguro)) return null;
    const abs = join(raiz, ...seguro.split("/"));
    try {
      const real = realpathSync(abs);
      if (real !== raiz && !real.startsWith(prefixo)) return null;
      if (ehArquivoSensivel(real)) return null;
      return real;
    } catch {
      return null;
    }
  }

  return {
    raiz,
    ler(caminho: string): string | null {
      const abs = resolver(caminho);
      if (abs === null) return null;
      try {
        const st = statSync(abs);
        if (!st.isFile() || st.size > teto) return null;
        return readFileSync(abs, "utf8");
      } catch {
        return null;
      }
    },
    existe(caminho: string): boolean {
      const abs = resolver(caminho);
      if (abs === null) return false;
      return existsSync(abs);
    },
    listar(pasta: string): string[] {
      const rel = pasta === "" || pasta === "." ? "" : (caminhoRelativoSeguro(pasta) ?? null);
      if (rel === null) return [];
      const abs = rel === "" ? raiz : resolver(rel);
      if (abs === null) return [];
      try {
        if (!lstatSync(abs).isDirectory() && !statSync(abs).isDirectory()) return [];
        return readdirSync(abs)
          .filter((n) => !ehArquivoSensivel(n))
          .slice(0, TETO_LISTAGEM);
      } catch {
        return [];
      }
    },
  };
}
