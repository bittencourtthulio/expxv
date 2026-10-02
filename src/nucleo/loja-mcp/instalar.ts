// Execução da instalação isolada (Fase 7B, T-07B.11..15). Roda as AÇÕES que o plano mostrou ao consentimento
// (mesma fonte: `acoesDeInstalacao`), SEMPRE em `<userData>/mcp/.tmp/<id>-<ulid>/`, com ambiente por allowlist
// (sem NPM_TOKEN, HOME/cache dentro do .tmp, registro fixo), sem shell, sem global, sem sudo. Verifica a
// integridade do pacote raiz e só então move atômico para `<userData>/mcp/<id>/`. Qualquer falha apaga o
// .tmp e deixa o estado anterior intacto. Rede só pelo executor/`baixar` injetados (testes usam falsos).

import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { montarAmbienteServidor } from "./ambiente";
import type { EntradaMcp } from "./esquema";
import { motivoNaoInstalavel } from "./esquema";
import type { Executor } from "./executor";
import { conferirIntegridade, conferirLock, ErroIntegridade } from "./integridade";
import { acoesDeInstalacao, type AcaoInstalacao } from "./plano";

export type CodigoInstalacao =
  | "nao_instalavel" | "pasta_invalida" | "executavel_ausente" | "falha_instalacao" | "timeout" | "cancelado"
  | "integridade_divergente" | "lock_ausente" | "lock_divergente" | "binario_ausente" | "download_indisponivel" | "saida_excessiva" | "url_invalida";

export interface BinariosMcp { npm?: string; node?: string; uv?: string; docker?: string }

export interface OpcoesInstalar {
  entrada: EntradaMcp;
  userData: string;
  executor: Executor;
  /** Registro npm (padrão: o oficial). Os testes apontam para um registro local. */
  registroNpm?: string;
  /** Pasta dos locks curados (`<id>.package-lock.json`, `<id>.requirements.txt`). */
  locksDir?: string;
  binarios?: BinariosMcp;
  /** Download HTTPS (só `binario`). Ausente ⇒ `download_indisponivel`. */
  baixar?: (url: string, sinal?: AbortSignal) => Promise<Uint8Array>;
  ulid?: () => string;
  sinal?: AbortSignal;
  aoProgresso?: (p: { passo: 3 | 4 | 5; rotulo: string }) => void;
  timeoutMs?: number;
  plataforma?: NodeJS.Platform;
  /** Origem do PATH para localizar npm/uv (padrão: o do processo + pastas comuns). */
  pathOrigem?: string;
}

export type ResultadoInstalar =
  | { ok: true; pasta: string | null; integridade: string | null; promovido: boolean; confirmar: () => Promise<void>; desfazer: () => Promise<void> }
  | { ok: false; codigo: CodigoInstalacao; detalhe: string };

const ULID = (): string => randomBytes(8).toString("hex");
const RE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PASTAS_COMUNS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/** Procura um executável no PATH informado (+ pastas comuns). `null` se não achar. Só leitura de disco. */
export function localizarExecutavel(nome: string, pathOrigem: string = process.env["PATH"] ?? "", plataforma: NodeJS.Platform = process.platform): string | null {
  const dirs = [...pathOrigem.split(plataforma === "win32" ? ";" : delimiter), ...(plataforma === "win32" ? [] : PASTAS_COMUNS)].filter(Boolean);
  const exts = plataforma === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const d of dirs) for (const x of exts) {
    const c = join(d, nome + x);
    try { accessSync(c, constants.X_OK); return c; } catch { /* próximo */ }
  }
  return null;
}

/** Garante que `destino` fique dentro de `<userData>/mcp` (realpath da raiz; sem `..`). */
export async function pastaIsolada(userData: string, id: string): Promise<string> {
  if (!RE_ID.test(id)) throw new Error("id inválido");
  const raiz = join(userData, "mcp");
  await mkdir(raiz, { recursive: true });
  const real = await realpath(raiz);
  const destino = join(real, id);
  const rel = relative(real, destino);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("pasta fora de userData/mcp");
  return destino;
}

const falha = (codigo: CodigoInstalacao, detalhe: string): ResultadoInstalar => ({ ok: false, codigo, detalhe });

export async function instalarServidor(o: OpcoesInstalar): Promise<ResultadoInstalar> {
  const e = o.entrada;
  const plataforma = o.plataforma ?? process.platform;
  if (motivoNaoInstalavel(e)) return falha("nao_instalavel", motivoNaoInstalavel(e)!);
  const metodo = e.instalacao.metodo;
  if (metodo === "remoto") {
    if (!e.url || !/^https:\/\//.test(e.url)) return falha("url_invalida", "servidor remoto exige https://");
    return { ok: true, pasta: null, integridade: null, promovido: false, confirmar: async () => undefined, desfazer: async () => undefined };
  }
  let destino: string;
  try { destino = await pastaIsolada(o.userData, e.id); } catch (x) { return falha("pasta_invalida", (x as Error).message); }
  const mcp = dirname(destino);
  const tmpId = `${e.id}-${(o.ulid ?? ULID)()}`;
  const tmp = join(mcp, ".tmp", tmpId);
  const limpar = async (): Promise<void> => { await rm(tmp, { recursive: true, force: true }); };
  const timeoutMs = o.timeoutMs ?? 5 * 60_000;
  try {
    await mkdir(join(tmp, "home"), { recursive: true });
    await mkdir(join(tmp, "cache"), { recursive: true });
    await writeFile(join(tmp, ".npmrc-vazio"), "", { mode: 0o600 });
    const acoes = acoesDeInstalacao(e, { userData: o.userData, plataforma, tmpId });
    const resultadoPreparo = await prepararArquivos(o, e, tmp);
    if (resultadoPreparo) { await limpar(); return resultadoPreparo; }

    const bin = (nome: string): string | null => {
      const dado = (o.binarios as Record<string, string | undefined> | undefined)?.[nome];
      return dado ?? localizarExecutavel(nome, o.pathOrigem, plataforma);
    };
    const pathExtra = [...new Set([o.binarios?.node, o.binarios?.npm, o.binarios?.uv].filter((x): x is string => !!x && isAbsolute(x)).map((x) => dirname(x)))];
    for (const nome of ["node", "npm", "uv"]) { const l = bin(nome); if (l && isAbsolute(l)) pathExtra.push(dirname(l)); }

    for (const a of acoes) {
      if (o.sinal?.aborted) { await limpar(); return falha("cancelado", "instalação cancelada"); }
      const r = await executarAcao(o, e, a, tmp, bin, [...new Set(pathExtra)], timeoutMs, plataforma);
      if (r) { await limpar(); return r; }
    }
    o.aoProgresso?.({ passo: 4, rotulo: "verificando integridade" });
    const verif = await verificarResultado(e, tmp, plataforma);
    if (verif) { await limpar(); return verif; }

    o.aoProgresso?.({ passo: 5, rotulo: "promovendo a instalação" });
    // Promoção atômica: a pasta antiga (se houver) vai para .old e só some em `confirmar()`.
    let antiga: string | null = null;
    if (existsSync(destino)) {
      antiga = join(mcp, ".old", tmpId);
      await mkdir(dirname(antiga), { recursive: true });
      await rename(destino, antiga);
    }
    try { await rename(tmp, destino); } catch (x) {
      if (antiga) await rename(antiga, destino).catch(() => undefined);
      await limpar();
      return falha("falha_instalacao", `não foi possível mover a instalação: ${(x as NodeJS.ErrnoException).code ?? "erro"}`);
    }
    const integ = e.instalacao.integridade ?? null;
    return {
      ok: true, pasta: destino, integridade: integ, promovido: true,
      confirmar: async () => { if (antiga) await rm(antiga, { recursive: true, force: true }); },
      desfazer: async () => {
        await rm(destino, { recursive: true, force: true });
        if (antiga) await rename(antiga, destino);
      },
    };
  } catch (x) {
    await limpar();
    return falha("falha_instalacao", (x as Error).message);
  }
}

/** package.json mínimo + lock curado (nível forte) ou requirements. Devolve falha ou `null`. */
async function prepararArquivos(o: OpcoesInstalar, e: EntradaMcp, tmp: string): Promise<ResultadoInstalar | null> {
  const i = e.instalacao;
  if (i.metodo === "npm") {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "mcp-isolado", private: true, version: "0.0.0", dependencies: { [i.pacote!]: i.versao } }), { mode: 0o600 });
    if (i.lock_sha256) {
      const lock = o.locksDir ? join(o.locksDir, `${e.id}.package-lock.json`) : null;
      if (!lock || !existsSync(lock)) return falha("lock_ausente", `lock curado ausente para ${e.id}`);
      const conteudo = await readFile(lock);
      try { conferirLock(conteudo, i.lock_sha256); } catch { return falha("lock_divergente", "o lock curado não bate com o hash do catálogo"); }
      await copyFile(lock, join(tmp, "package-lock.json"));
    }
  } else if (i.metodo === "uvx" && i.lock_sha256) {
    const req = o.locksDir ? join(o.locksDir, `${e.id}.requirements.txt`) : null;
    if (!req || !existsSync(req)) return falha("lock_ausente", `requirements curado ausente para ${e.id}`);
    const conteudo = await readFile(req);
    try { conferirLock(conteudo, i.lock_sha256); } catch { return falha("lock_divergente", "o requirements curado não bate com o hash do catálogo"); }
    await copyFile(req, join(tmp, "requirements.txt"));
  }
  return null;
}

async function executarAcao(o: OpcoesInstalar, e: EntradaMcp, a: AcaoInstalacao, tmp: string, bin: (n: string) => string | null, pathExtra: string[], timeoutMs: number, plataforma: NodeJS.Platform): Promise<ResultadoInstalar | null> {
  if (a.tipo === "registrar") return null;
  if (a.tipo === "download") {
    o.aoProgresso?.({ passo: 3, rotulo: a.rotulo });
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(a.url)) return falha("url_invalida", "download só de github.com/<dono>/<repo>/releases/download/");
    if (!o.baixar) return falha("download_indisponivel", "sem meio de download configurado");
    let dados: Uint8Array;
    try { dados = await o.baixar(a.url, o.sinal); } catch { return o.sinal?.aborted ? falha("cancelado", "instalação cancelada") : falha("download_indisponivel", "download falhou"); }
    try { conferirIntegridade(dados, a.sha256); } catch (x) { return falha((x as ErroIntegridade).codigo === "integridade_divergente" ? "integridade_divergente" : "falha_instalacao", "sha256 do binário diverge do catálogo"); }
    await mkdir(a.destino, { recursive: true });
    const alvo = join(a.destino, plataforma === "win32" ? `${e.bin}.exe` : e.bin!);
    await writeFile(alvo, dados, { mode: 0o755 });
    await chmod(alvo, 0o755);
    return null;
  }
  o.aoProgresso?.({ passo: 3, rotulo: a.rotulo });
  const [nome, ...resto] = a.argv;
  const exe = nome ? bin(nome) : null;
  if (!exe) return falha("executavel_ausente", `${nome ?? "?"} não encontrado`);
  const base = montarAmbienteServidor({ origem: {}, plataforma, pathExtra, homeIsolado: join(tmp, "home") });
  const env: Record<string, string> = {
    ...base.variaveis,
    TMPDIR: join(tmp, "home"), TEMP: join(tmp, "home"), TMP: join(tmp, "home"),
    npm_config_cache: join(tmp, "cache"), npm_config_userconfig: join(tmp, ".npmrc-vazio"), npm_config_globalconfig: join(tmp, ".npmrc-vazio"),
    npm_config_registry: o.registroNpm ?? "https://registry.npmjs.org/", npm_config_update_notifier: "false", npm_config_fund: "false",
    UV_CACHE_DIR: join(tmp, "cache"), UV_PYTHON_INSTALL_DIR: join(tmp, "cache", "python"),
  };
  const r = await o.executor.rodar({ exe, args: resto, cwd: tmp, env, timeoutMs, ...(o.sinal ? { sinal: o.sinal } : {}) });
  if (r.abortado) return falha("cancelado", "instalação cancelada");
  if (r.timeout) return falha("timeout", `${nome} excedeu ${Math.round(timeoutMs / 1000)} s`);
  if (r.nao_iniciou) return falha("executavel_ausente", `${nome} não pôde ser iniciado`);
  if (r.excedeu_saida) return falha("saida_excessiva", `${nome} produziu saída demais`);
  if (r.codigo !== 0) return falha("falha_instalacao", `${nome} terminou com código ${r.codigo}`);
  return null;
}

/** Integridade do pacote raiz instalado + executável presente (dentro do .tmp, antes de promover). */
async function verificarResultado(e: EntradaMcp, tmp: string, plataforma: NodeJS.Platform): Promise<ResultadoInstalar | null> {
  const i = e.instalacao;
  const win = plataforma === "win32";
  if (i.metodo === "npm") {
    let integ: string | undefined;
    for (const arq of [join(tmp, "node_modules", ".package-lock.json"), join(tmp, "package-lock.json")]) {
      try {
        const j = JSON.parse(await readFile(arq, "utf8")) as { packages?: Record<string, { integrity?: string }> };
        integ = j.packages?.[`node_modules/${i.pacote}`]?.integrity;
        if (integ) break;
      } catch { /* tenta o próximo */ }
    }
    if (!integ || integ !== i.integridade) return falha("integridade_divergente", "a integridade do pacote instalado difere da do catálogo");
    try { await stat(join(tmp, "node_modules", ".bin", win ? `${e.bin}.cmd` : e.bin!)); } catch { return falha("binario_ausente", `executável ${e.bin} ausente após a instalação`); }
  } else if (i.metodo === "uvx") {
    const rel = win ? join("venv", "Scripts", `${e.bin}.exe`) : join("venv", "bin", e.bin!);
    try { await stat(join(tmp, rel)); } catch { return falha("binario_ausente", `executável ${e.bin} ausente após a instalação`); }
  } else if (i.metodo === "binario") {
    try { await stat(join(tmp, "bin", win ? `${e.bin}.exe` : e.bin!)); } catch { return falha("binario_ausente", `executável ${e.bin} ausente`); }
  }
  return null;
}
