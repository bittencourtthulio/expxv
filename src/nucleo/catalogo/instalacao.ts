// Instalação de skills por symlink/cópia, atômica, SEMPRE no escopo global da CLI e SÓ por ação explícita (T-07.14/15, D-41).
// Nunca sobrescreve (`conflito`), nunca segue fonte fora das raízes conhecidas, nunca remove diretório real do usuário sem lixeira.
import { randomBytes } from "node:crypto";
import { cp, lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, symlink, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { CliCatalogo, ResultadoInstalar } from "../../compartilhado/catalogo";
import { nomeValido } from "./normalizar";
import { dentroDe, sha256 } from "./raizes";

export interface FsInstalacao {
  symlink(alvo: string, caminho: string, tipo?: "dir" | "junction"): Promise<void>;
  rename(de: string, para: string): Promise<void>;
  rm(caminho: string, opcoes: { recursive?: boolean; force?: boolean }): Promise<void>;
  unlink(caminho: string): Promise<void>;
  mkdir(caminho: string, opcoes: { recursive: true }): Promise<unknown>;
  lstat(caminho: string): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
  stat(caminho: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  readlink(caminho: string): Promise<string>;
  realpath(caminho: string): Promise<string>;
  readFile(caminho: string): Promise<Buffer>;
  copiarPasta(de: string, para: string): Promise<void>;
}

const MAX_COPIA = 20 * 1024 * 1024;

export const fsReal: FsInstalacao = {
  symlink: (a, c, t) => symlink(a, c, t),
  rename,
  rm: (c, o) => rm(c, o),
  unlink,
  mkdir: (c, o) => mkdir(c, o),
  lstat,
  stat,
  readlink,
  realpath,
  readFile: (c) => readFile(c),
  // cópia sem seguir symlink e sem arquivo > 20 MB
  copiarPasta: (de, para) =>
    cp(de, para, {
      recursive: true,
      dereference: false,
      filter: async (origem) => {
        try {
          const l = await lstat(origem);
          if (l.isSymbolicLink()) return false;
          if (l.isFile()) return (await stat(origem)).size <= MAX_COPIA;
          return true;
        } catch {
          return false;
        }
      },
    }),
};

/** Pasta global de skills de cada CLI (relativa à casa). `gemini` não tem. */
export const RAIZ_GLOBAL_SKILLS: Readonly<Record<CliCatalogo, string | null>> = {
  claude: ".claude/skills",
  codex: ".codex/skills",
  opencode: ".config/opencode/skills",
  gemini: null,
  portatil: ".agents/skills",
};

export interface PedidoInstalar {
  /** pasta da skill (contém `SKILL.md`), absoluta */
  fonteAbs: string;
  /** pasta global de skills da CLI de destino, absoluta */
  raizDestinoAbs: string;
  modo: "symlink" | "copia";
  /** casa + raízes de workspace (já resolvidas) */
  raizesConhecidas: readonly string[];
  plataforma?: NodeJS.Platform;
  fs?: FsInstalacao;
}

const tmpNome = (destino: string): string => `${destino}.tmp-${randomBytes(4).toString("hex")}`;
const ehPermissao = (e: unknown): boolean => typeof e === "object" && e !== null && ["EPERM", "EACCES", "ENOTSUP"].includes((e as { code?: string }).code ?? "");

async function mesmoDestino(fs: FsInstalacao, link: string, fonteReal: string): Promise<boolean> {
  try {
    return (await fs.realpath(link)) === fonteReal;
  } catch {
    return false;
  }
}

export async function instalar(p: PedidoInstalar): Promise<ResultadoInstalar & { metodo?: "symlink" | "copia" }> {
  const fs = p.fs ?? fsReal;
  const nome = basename(p.fonteAbs);
  if (!nomeValido(nome)) return { estado: "erro", caminho_rel: null, codigo: "nome_invalido" };
  let fonteReal: string;
  try {
    fonteReal = await fs.realpath(p.fonteAbs);
  } catch {
    return { estado: "erro", caminho_rel: null, codigo: "fonte_ausente" };
  }
  try {
    if (!(await fs.stat(join(fonteReal, "SKILL.md"))).isFile()) throw new Error("x");
  } catch {
    return { estado: "erro", caminho_rel: null, codigo: "fonte_sem_skill" };
  }
  if (!p.raizesConhecidas.some((r) => dentroDe(r, fonteReal))) return { estado: "erro", caminho_rel: null, codigo: "fonte_fora_das_raizes" };
  const destino = join(p.raizDestinoAbs, nome);
  if (!dentroDe(p.raizDestinoAbs, destino)) return { estado: "erro", caminho_rel: null, codigo: "destino_invalido" };

  try {
    const l = await fs.lstat(destino);
    if (l.isSymbolicLink() && (await mesmoDestino(fs, destino, fonteReal))) return { estado: "ja_instalado", caminho_rel: nome, codigo: null };
    return { estado: "conflito", caminho_rel: nome, codigo: "destino_existe" };
  } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") return { estado: "erro", caminho_rel: null, codigo: "destino_ilegivel" };
  }

  const tmp = tmpNome(destino);
  let metodo: "symlink" | "copia" = p.modo;
  try {
    await fs.mkdir(p.raizDestinoAbs, { recursive: true });
    if (p.modo === "symlink") {
      try {
        await fs.symlink(fonteReal, tmp, "dir");
      } catch (e) {
        if (!ehPermissao(e) || (p.plataforma ?? process.platform) !== "win32") throw e;
        // Windows sem privilégio: junction; sem junction, cópia
        try {
          await fs.symlink(fonteReal, tmp, "junction");
        } catch (e2) {
          if (!ehPermissao(e2)) throw e2;
          await fs.copiarPasta(fonteReal, tmp);
          metodo = "copia";
        }
      }
    } else {
      await fs.copiarPasta(fonteReal, tmp);
    }
    await fs.rename(tmp, destino);
    // smoke: o destino precisa ler o SKILL.md
    if (!(await fs.stat(join(destino, "SKILL.md"))).isFile()) throw new Error("smoke");
    return { estado: "instalado", caminho_rel: nome, codigo: null, metodo };
  } catch {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await fs.unlink(tmp).catch(() => undefined);
    return { estado: "erro", caminho_rel: null, codigo: "falha_ao_instalar" };
  }
}

export interface PedidoDesinstalar {
  /** caminho absoluto do que foi instalado (pasta da skill no destino) */
  destinoAbs: string;
  raizDestinoAbs: string;
  modo: "remover_criado" | "lixeira";
  criado_pelo_app: boolean;
  metodo: "nativo" | "symlink" | "copia";
  /** hash do SKILL.md registrado (cópia: só remove se não foi editada) */
  hash_registrado: string | null;
  origem: string;
  plugin: string | null;
  /** `shell.trashItem` no main */
  lixeira?: (abs: string) => Promise<void>;
  fs?: FsInstalacao;
}

export async function desinstalar(p: PedidoDesinstalar): Promise<{ ok: boolean; codigo: string | null }> {
  const fs = p.fs ?? fsReal;
  if (p.origem === "metodo") return { ok: false, codigo: "gerenciado_pelo_metodo" };
  if (p.plugin !== null) return { ok: false, codigo: "gerenciado_pelo_plugin" };
  if (!dentroDe(p.raizDestinoAbs, p.destinoAbs) || p.destinoAbs === p.raizDestinoAbs) return { ok: false, codigo: "destino_invalido" };
  let l;
  try {
    l = await fs.lstat(p.destinoAbs);
  } catch {
    return { ok: true, codigo: null };
  }
  if (p.modo === "remover_criado") {
    if (!p.criado_pelo_app) return { ok: false, codigo: "nao_criado_pelo_app" };
    if (l.isSymbolicLink()) {
      if (p.metodo !== "symlink") return { ok: false, codigo: "divergente" };
      await fs.unlink(p.destinoAbs);
      return { ok: true, codigo: null };
    }
    if (p.metodo !== "copia" || !l.isDirectory()) return { ok: false, codigo: "divergente" };
    try {
      const atual = sha256(await fs.readFile(join(p.destinoAbs, "SKILL.md")));
      if (p.hash_registrado === null || atual !== p.hash_registrado) return { ok: false, codigo: "editada_use_lixeira" };
    } catch {
      return { ok: false, codigo: "divergente" };
    }
    await fs.rm(p.destinoAbs, { recursive: true, force: true });
    return { ok: true, codigo: null };
  }
  if (p.lixeira === undefined) return { ok: false, codigo: "lixeira_indisponivel" };
  try {
    await p.lixeira(p.destinoAbs);
    return { ok: true, codigo: null };
  } catch {
    return { ok: false, codigo: "lixeira_falhou" };
  }
}

