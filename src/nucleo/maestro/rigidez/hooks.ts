// T-16.19 · `.expx/hooks.json`: a ÚNICA escrita do ADE em área do método (exceção D-221), só por ação explícita do usuário.
// Leitura tolerante (JSON inválido ⇒ recusa e NADA é gravado); preserva `_comentario`, chaves desconhecidas e TODA chave definida pelo usuário;
// a marca `_<id do produto>` registra o que é do ADE; backup antes de cada escrita (20 últimos); escrita atômica (temp no mesmo diretório + rename);
// só se `.expx/` já existe (método instalado) — nunca cria a pasta; chaves de SEGURANÇA nunca são escritas (I8).
import { chmod, lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NivelRigidez } from "../../../compartilhado/maestro";
import type { ModoHook } from "../../metodo/hooks";
import { PRODUTO } from "../../produto";
import { HOOKS_MODO_LEGADO_BAIXO, HOOKS_POR_NIVEL, SEGURANCA } from "./matriz";

export const ARQUIVO_HOOKS = ".expx/hooks.json";
export const BACKUPS_MAX = 20;
const LIMITE_BYTES = 256 * 1024;
const MODOS: readonly string[] = ["aviso", "bloqueio", "desligado"];

export type MapaHooks = Record<string, ModoHook>;
export interface ChaveGerenciada {
  valor: ModoHook;
  anterior: ModoHook | null;
}
export interface MarcaDoAde {
  versao: 1;
  nivel: NivelRigidez;
  escrito_em: string;
  chaves: Record<string, ChaveGerenciada>;
}
/** Chave da marca do ADE no arquivo (derivada do id do produto: D-01). */
export const CHAVE_DA_MARCA = `_${PRODUTO.id}`;
export type ArquivoHooks = Record<string, unknown> & { hooks?: Record<string, unknown> };
const marcaDe = (a: ArquivoHooks): unknown => a[CHAVE_DA_MARCA];

/** Modos que o nível pede (só chaves do tipo MÉTODO; nunca segurança). Nível 3 = nascimento (vazio: o ADE remove o que gerenciava). */
export function hooksDoNivel(nivel: NivelRigidez, ctx: { legado: boolean } = { legado: false }): MapaHooks {
  const m: MapaHooks = { ...HOOKS_POR_NIVEL[nivel] };
  if (ctx.legado && nivel <= 2) for (const [k, v] of Object.entries(HOOKS_MODO_LEGADO_BAIXO)) if (m[k] === "desligado") m[k] = v;
  for (const s of SEGURANCA) delete m[s];
  return m;
}

export type LeituraHooks = { ok: true; arquivo: ArquivoHooks; existia: boolean } | { ok: false; erro: "hooks_json_invalido" };
export function lerHooksJson(texto: string | null): LeituraHooks {
  if (texto === null) return { ok: true, arquivo: {}, existia: false };
  try {
    const bruto: unknown = JSON.parse(texto.replace(/^﻿/, ""));
    if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return { ok: false, erro: "hooks_json_invalido" };
    const a = bruto as ArquivoHooks;
    if (a.hooks !== undefined && (typeof a.hooks !== "object" || a.hooks === null || Array.isArray(a.hooks))) return { ok: false, erro: "hooks_json_invalido" };
    return { ok: true, arquivo: a, existia: true };
  } catch {
    return { ok: false, erro: "hooks_json_invalido" };
  }
}

const modoDe = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "object" && v !== null && typeof (v as { modo?: unknown }).modo === "string" ? ((v as { modo: string }).modo) : null);
const marcaValida = (m: unknown): m is MarcaDoAde => typeof m === "object" && m !== null && typeof (m as MarcaDoAde).chaves === "object" && (m as MarcaDoAde).chaves !== null;

export interface ResultadoMescla {
  arquivo: ArquivoHooks;
  escritas: string[];
  removidas: string[];
  /** a chave é do usuário e o nível pediria outro valor. */
  preservadas: Array<{ nome: string; usuario: string; pedido: ModoHook }>;
  /** chaves que o ADE gerenciava mas o usuário editou depois: soltas, sem tocar. */
  soltas: string[];
  mudou: boolean;
}

/** Mescla puro: nunca altera a entrada. */
export function mesclar(atual: ArquivoHooks, pedido: MapaHooks, meta: { nivel: NivelRigidez; agora: string }): ResultadoMescla {
  const hooks: Record<string, unknown> = { ...(atual.hooks ?? {}) };
  const gerenciadas: Record<string, ChaveGerenciada> = (() => { const m = marcaDe(atual); return marcaValida(m) ? { ...m.chaves } : {}; })();
  const escritas: string[] = [];
  const removidas: string[] = [];
  const soltas: string[] = [];
  const preservadas: ResultadoMescla["preservadas"] = [];

  // 1. chaves antes gerenciadas que o usuário editou: soltas
  for (const [nome, g] of Object.entries(gerenciadas)) {
    if (modoDe(hooks[nome]) !== g.valor) {
      delete gerenciadas[nome];
      soltas.push(nome);
    }
  }
  // 2. aplica o pedido
  for (const [nome, modo] of Object.entries(pedido)) {
    if ((SEGURANCA as readonly string[]).includes(nome) || !MODOS.includes(modo)) continue;
    const existe = nome in hooks;
    const nossa = nome in gerenciadas;
    if (existe && !nossa) {
      const u = modoDe(hooks[nome]) ?? "?";
      if (u !== modo) preservadas.push({ nome, usuario: u, pedido: modo });
      continue;
    }
    if (!existe || modoDe(hooks[nome]) !== modo) {
      hooks[nome] = modo;
      escritas.push(nome);
    }
    gerenciadas[nome] = { valor: modo, anterior: gerenciadas[nome]?.anterior ?? null };
  }
  // 3. nossas que o nível não pede mais: removidas (restaura `anterior` se havia)
  for (const [nome, g] of Object.entries(gerenciadas)) {
    if (nome in pedido && !(SEGURANCA as readonly string[]).includes(nome)) continue;
    if (g.anterior !== null) hooks[nome] = g.anterior;
    else delete hooks[nome];
    delete gerenciadas[nome];
    removidas.push(nome);
  }
  const resultado: ArquivoHooks = { ...atual };
  if (Object.keys(hooks).length > 0 || atual.hooks !== undefined) resultado.hooks = hooks;
  if (Object.keys(gerenciadas).length > 0) resultado[CHAVE_DA_MARCA] = { versao: 1, nivel: meta.nivel, escrito_em: meta.agora, chaves: gerenciadas } satisfies MarcaDoAde;
  else delete resultado[CHAVE_DA_MARCA];
  const mudou = JSON.stringify(resultado) !== JSON.stringify(atual);
  return { arquivo: resultado, escritas, removidas, preservadas, soltas, mudou };
}

/** Reverte: remove só as chaves cujo valor ainda é o que o ADE escreveu; as editadas pelo usuário são soltas sem tocar. */
export function reverterMescla(atual: ArquivoHooks): ResultadoMescla {
  const marca = marcaDe(atual);
  if (!marcaValida(marca)) return { arquivo: atual, escritas: [], removidas: [], preservadas: [], soltas: [], mudou: false };
  const hooks: Record<string, unknown> = { ...(atual.hooks ?? {}) };
  const removidas: string[] = [];
  const soltas: string[] = [];
  for (const [nome, g] of Object.entries(marca.chaves)) {
    if (modoDe(hooks[nome]) === g.valor) {
      if (g.anterior !== null) hooks[nome] = g.anterior;
      else delete hooks[nome];
      removidas.push(nome);
    } else soltas.push(nome);
  }
  const resultado: ArquivoHooks = { ...atual, hooks };
  delete resultado[CHAVE_DA_MARCA];
  return { arquivo: resultado, escritas: [], removidas, preservadas: [], soltas, mudou: true };
}

// ---------------------------------------------------------------- efeitos (porta)
export interface PortaArquivosHooks {
  /** `.expx/` existe (método instalado)? */
  existeExpx(): Promise<boolean>;
  ler(): Promise<string | null>;
  escreverAtomico(texto: string): Promise<void>;
  /** grava o conteúdo anterior e devolve o caminho RELATIVO do backup. */
  gravarBackup(texto: string, ts: string): Promise<string>;
}
export interface OpcoesAplicarHooks {
  legado?: boolean;
  /** `maestro.escrever_hooks` (padrão ligado). */
  escrever_hooks?: boolean;
  /** há etapa em andamento no cwd e o usuário não pediu "aplicar já": vale a partir da próxima etapa. */
  agendar?: boolean;
  agora?: () => Date;
}
export interface ResultadoAplicarHooks {
  escrito: boolean;
  agendado: boolean;
  arquivo: string | null;
  aviso: string | null;
  erro: "hooks_json_invalido" | null;
  escritas: string[];
  removidas: string[];
  preservadas: ResultadoMescla["preservadas"];
  soltas: string[];
  backup: string | null;
}
const nada = (extra: Partial<ResultadoAplicarHooks>): ResultadoAplicarHooks => ({ escrito: false, agendado: false, arquivo: null, aviso: null, erro: null, escritas: [], removidas: [], preservadas: [], soltas: [], backup: null, ...extra });
const serializar = (a: ArquivoHooks): string => `${JSON.stringify(a, null, 2)}\n`;
const tsDe = (d: Date): string => d.toISOString().replace(/[:.]/g, "-");

export async function aplicarHooks(porta: PortaArquivosHooks, nivel: NivelRigidez, opcoes: OpcoesAplicarHooks = {}): Promise<ResultadoAplicarHooks> {
  if (opcoes.escrever_hooks === false) return nada({ aviso: "A escrita de hooks está desligada: o nível controla só etapas e instruções." });
  if (opcoes.agendar === true) return nada({ agendado: true, aviso: "Os hooks valem a partir da próxima etapa." });
  if (!(await porta.existeExpx())) return nada({ aviso: "O método não está instalado neste diretório (.expx/ ausente): nada foi criado." });
  const texto = await porta.ler();
  const lido = lerHooksJson(texto);
  if (!lido.ok) return nada({ erro: lido.erro, aviso: "hooks.json inválido: nada foi gravado. Corrija o arquivo e tente de novo." });
  const agora = (opcoes.agora ?? (() => new Date()))();
  const m = mesclar(lido.arquivo, hooksDoNivel(nivel, { legado: opcoes.legado === true }), { nivel, agora: agora.toISOString() });
  const avisoPreservadas = m.preservadas.length > 0 ? `Preservadas (definidas por você): ${m.preservadas.map((p) => `${p.nome}=${p.usuario} (o nível pediria ${p.pedido})`).join("; ")}.` : null;
  if (!m.mudou) return nada({ arquivo: ARQUIVO_HOOKS, aviso: avisoPreservadas ?? "Os hooks já estavam no estado do nível.", preservadas: m.preservadas, soltas: m.soltas });
  let backup: string | null = null;
  if (texto !== null) backup = await porta.gravarBackup(texto, tsDe(agora));
  await porta.escreverAtomico(serializar(m.arquivo));
  return nada({ escrito: true, arquivo: ARQUIVO_HOOKS, aviso: avisoPreservadas, escritas: m.escritas, removidas: m.removidas, preservadas: m.preservadas, soltas: m.soltas, backup });
}

export async function reverterHooks(porta: PortaArquivosHooks, opcoes: { agora?: () => Date } = {}): Promise<ResultadoAplicarHooks & { revertidas: string[] }> {
  if (!(await porta.existeExpx())) return { ...nada({ aviso: "O método não está instalado neste diretório." }), revertidas: [] };
  const texto = await porta.ler();
  if (texto === null) return { ...nada({ aviso: "Não há hooks.json." }), revertidas: [] };
  const lido = lerHooksJson(texto);
  if (!lido.ok) return { ...nada({ erro: lido.erro, aviso: "hooks.json inválido: nada foi gravado." }), revertidas: [] };
  const r = reverterMescla(lido.arquivo);
  if (!r.mudou) return { ...nada({ arquivo: ARQUIVO_HOOKS, aviso: "Nada do ADE para reverter." }), revertidas: [] };
  const agora = (opcoes.agora ?? (() => new Date()))();
  const backup = await porta.gravarBackup(texto, tsDe(agora));
  await porta.escreverAtomico(serializar(r.arquivo));
  return { ...nada({ escrito: true, arquivo: ARQUIVO_HOOKS, removidas: r.removidas, soltas: r.soltas, backup }), revertidas: r.removidas };
}

export interface EstadoDosHooks {
  arquivo: string;
  presente: boolean;
  invalido: boolean;
  gerenciadas: string[];
  nivel_aplicado: NivelRigidez | null;
}
export async function estadoDosHooks(porta: PortaArquivosHooks): Promise<EstadoDosHooks> {
  const texto = await porta.ler();
  if (texto === null) return { arquivo: ARQUIVO_HOOKS, presente: false, invalido: false, gerenciadas: [], nivel_aplicado: null };
  const l = lerHooksJson(texto);
  if (!l.ok) return { arquivo: ARQUIVO_HOOKS, presente: true, invalido: true, gerenciadas: [], nivel_aplicado: null };
  const m = marcaDe(l.arquivo);
  return { arquivo: ARQUIVO_HOOKS, presente: true, invalido: false, gerenciadas: marcaValida(m) ? Object.keys(m.chaves) : [], nivel_aplicado: marcaValida(m) ? m.nivel : null };
}

// ---------------------------------------------------------------- adaptador de disco (Node)
/** `true` se o caminho existe e é link simbólico (o ADE nunca segue nem substitui link: o alvo pode estar fora da raiz). */
const ehLink = async (caminho: string): Promise<boolean> => {
  try {
    return (await lstat(caminho)).isSymbolicLink();
  } catch {
    return false;
  }
};
export class CaminhoInseguroErro extends Error {
  constructor(readonly caminho: string) {
    super(`${caminho} é um link simbólico: o ADE não escreve através dele`);
    this.name = "CaminhoInseguroErro";
  }
}
/** Marcador que `lerHooksJson` recusa como JSON inválido: com `hooks.json` em link simbólico, nada é gravado. */
const MARCA_LINK = "{ link simbólico }";

export function criarPortaArquivosHooksNode(raiz: string): PortaArquivosHooks {
  const dir = join(raiz, ".expx");
  const alvo = join(dir, "hooks.json");
  return {
    async existeExpx() {
      try {
        // `.expx` em link simbólico (possivelmente para fora da raiz) conta como "método não instalado": nada é criado nem escrito
        return (await stat(dir)).isDirectory() && !(await ehLink(dir));
      } catch {
        return false;
      }
    },
    async ler() {
      try {
        if ((await ehLink(dir)) || (await ehLink(alvo))) return MARCA_LINK;
        const info = await stat(alvo);
        if (!info.isFile() || info.size > LIMITE_BYTES) return "{ arquivo grande demais }";
        return await readFile(alvo, "utf8");
      } catch {
        return null;
      }
    },
    async escreverAtomico(texto) {
      if ((await ehLink(dir)) || (await ehLink(alvo))) throw new CaminhoInseguroErro(".expx/hooks.json");
      let modo = 0o644;
      try {
        modo = (await stat(alvo)).mode & 0o777;
      } catch {
        /* arquivo novo */
      }
      const tmp = join(dir, `.hooks.json.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
      try {
        await writeFile(tmp, texto, { encoding: "utf8", mode: modo });
        await chmod(tmp, modo);
        await rename(tmp, alvo);
      } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
      }
    },
    async gravarBackup(texto, ts) {
      const rel = `${PRODUTO.pastaNoProjeto}/maestro/backup`;
      if (await ehLink(join(raiz, PRODUTO.pastaNoProjeto))) throw new CaminhoInseguroErro(PRODUTO.pastaNoProjeto);
      const pasta = join(raiz, rel);
      await mkdir(pasta, { recursive: true });
      const nome = `hooks-${ts}.json`;
      await writeFile(join(pasta, nome), texto, "utf8");
      const todos = (await readdir(pasta)).filter((n) => /^hooks-.*\.json$/.test(n)).sort();
      for (const velho of todos.slice(0, Math.max(0, todos.length - BACKUPS_MAX))) await unlink(join(pasta, velho)).catch(() => undefined);
      return `${rel}/${nome}`;
    },
  };
}
