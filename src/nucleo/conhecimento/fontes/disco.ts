// Leitura de disco para as fontes (docs e código): porta injetável + implementação Node. Somente LEITURA; nunca escreve em docs/
// nem em .expx/ (D-04, D-47). Caminhos sempre relativos à raiz; denylist aplicada ANTES de abrir o arquivo.
import { execFile } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ARQUIVO_CODIGO_MAX_BYTES } from "../constantes";
import { caminhoProibido, relativizar } from "../seguranca";

export interface ArquivoInfo {
  rel: string;
  mtime_ms: number;
  tamanho: number;
}

export interface PortaDisco {
  /** markdown/texto sob os prefixos (ex.: `docs`), recursivo, sem seguir symlink. */
  listarDocs(prefixos: readonly string[]): Promise<ArquivoInfo[]>;
  /** arquivos versionados (`git ls-files`); vazio se não for repositório git. */
  listarVersionados(): Promise<string[]>;
  info(rel: string): Promise<ArquivoInfo | null>;
  ler(rel: string, maxBytes?: number): Promise<string | null>;
}

const BINARIOS = /\.(?:png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|wav|exe|dll|so|dylib|node|wasm|class|jar|sqlite|db|lock|min\.js|min\.css|map)$/i;
const LOCKS = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$/;
const GERADOS = /(?:^|\/)(?:dist|build|out|coverage|node_modules|vendor|\.next|\.git|target)\//;

/** Candidato a indexação de código: não proibido, não binário, não lock, não gerado/minificado. */
export function codigoIndexavel(rel: string): boolean {
  return !caminhoProibido(rel) && !BINARIOS.test(rel) && !LOCKS.test(rel) && !GERADOS.test(rel) && !/\.min\.[a-z]+$/i.test(rel) && !/\.(?:snap|svg)$/i.test(rel);
}

async function* andar(raiz: string, rel: string, profundidade: number): AsyncGenerator<string> {
  if (profundidade > 12) return;
  let itens: import("node:fs").Dirent[];
  try {
    itens = await readdir(join(raiz, rel), { withFileTypes: true });
  } catch {
    return;
  }
  itens.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const it of itens) {
    const r = rel === "" ? it.name : `${rel}/${it.name}`;
    if (it.isSymbolicLink() || caminhoProibido(r)) continue;
    if (it.isDirectory()) {
      if (it.name === "node_modules" || it.name === ".git") continue;
      yield* andar(raiz, r, profundidade + 1);
    } else if (it.isFile()) yield r;
  }
}

export function criarDiscoNode(raiz: string): PortaDisco {
  const abs = (rel: string): string | null => {
    const r = relativizar(rel, raiz);
    return r === null ? null : join(raiz, r);
  };
  return {
    async listarDocs(prefixos) {
      const saida: ArquivoInfo[] = [];
      for (const p of prefixos) {
        for await (const rel of andar(raiz, p, 0)) {
          if (!/\.(?:md|mdx|markdown|txt)$/i.test(rel)) continue;
          try {
            const st = await stat(join(raiz, rel));
            saida.push({ rel, mtime_ms: Math.floor(st.mtimeMs), tamanho: st.size });
          } catch {
            /* sumiu no meio */
          }
        }
      }
      return saida;
    },
    listarVersionados() {
      return new Promise((resolve) => {
        execFile("git", ["ls-files", "-z"], { cwd: raiz, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024, timeout: 20_000, windowsHide: true }, (erro, stdout) => {
          if (erro) return resolve([]);
          resolve(String(stdout).split("\0").filter((s) => s !== ""));
        });
      });
    },
    async info(rel) {
      const a = abs(rel);
      if (a === null || caminhoProibido(rel)) return null;
      try {
        const st = await stat(a);
        return st.isFile() ? { rel, mtime_ms: Math.floor(st.mtimeMs), tamanho: st.size } : null;
      } catch {
        return null;
      }
    },
    async ler(rel, maxBytes = ARQUIVO_CODIGO_MAX_BYTES) {
      const a = abs(rel);
      if (a === null || caminhoProibido(rel)) return null;
      try {
        const fh = await open(a, "r");
        try {
          const st = await fh.stat();
          if (!st.isFile() || st.size > maxBytes) return null;
          const buf = Buffer.alloc(st.size);
          await fh.read(buf, 0, st.size, 0);
          if (buf.includes(0)) return null; // binário
          return buf.toString("utf8");
        } finally {
          await fh.close();
        }
      } catch {
        return null;
      }
    },
  };
}
