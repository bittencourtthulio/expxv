// Teste de saúde de um servidor MCP stdio (Fase 7B, T-07B.09): `initialize` + `notifications/initialized`
// + `tools/list`, com timeout duro (padrão 3 s), sem shell, ambiente 100% fornecido pelo chamador e a
// árvore de processos morta ao fim (sucesso, erro ou timeout). Não depende de Electron nem de rede.
// O stderr do servidor nunca sai daqui sem redação e nunca passa de 2 KB.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { PADROES_SEGREDO } from "./esquema";

export type EstadoSaude = "ok" | "lento" | "quebrado" | "sem_ferramentas" | "exige_variavel";

export type CodigoErroSaude =
  | "timeout" | "saida_invalida" | "processo_encerrou" | "protocolo_incompativel" | "nao_autorizado"
  | "erro_servidor" | "executavel_ausente";

export interface AlvoStdio {
  executavel: string;
  args: string[];
  /** Ambiente EXATO do filho (nada é herdado do processo atual). */
  env: Record<string, string>;
  cwd?: string;
}

export interface OpcoesSaude {
  /** Timeout duro do conjunto (padrão 3 000 ms). */
  timeoutMs?: number;
  /** Acima disso, mesmo respondendo, o estado é `lento` (padrão 1 500 ms). */
  limiarLentoMs?: number;
  /** Variáveis obrigatórias do servidor: faltando uma e falhando o teste ⇒ `exige_variavel`. */
  variaveisObrigatorias?: string[];
  /** Valores a redigir no stderr (além dos de variáveis com nome de segredo). */
  segredos?: string[];
}

export interface FerramentaVista { nome: string; descricao: string }

export interface ResultadoSaude {
  estado: EstadoSaude;
  latencia_ms: number;
  n_ferramentas: number;
  ferramentas: FerramentaVista[];
  erro_codigo: CodigoErroSaude | null;
  variaveis_faltando: string[];
  /** stderr redigido, ≤ 2 KB. Só para o log; nunca vai ao renderer. */
  stderr_redigido: string;
  servidor: { nome: string; versao: string } | null;
  /** pid do processo lançado (já morto ao retornar); útil para provar que não ficou órfão. */
  pid: number | null;
}

export const TIMEOUT_SAUDE_PADRAO_MS = 3000;
export const LIMIAR_LENTO_PADRAO_MS = 1500;
const MAX_STDERR = 2048;
const MAX_LINHA = 1024 * 1024;
const MAX_FERRAMENTAS = 200;
const VERSAO_PROTOCOLO = "2025-06-18";
const RE_NOME_SEGREDO = /(KEY|TOKEN|SECRET|PASS|PWD|CREDENTIAL)/i;

export class ErroSessao extends Error {
  readonly codigo: CodigoErroSaude;
  constructor(codigo: CodigoErroSaude, mensagem: string = codigo) {
    super(mensagem);
    this.name = "ErroSessao";
    this.codigo = codigo;
  }
}

/** Redige valores de segredo (conhecidos e por padrão) de um texto. */
export function redigir(texto: string, segredos: readonly string[] = []): string {
  let saida = texto;
  for (const s of segredos) if (s.length >= 4) saida = saida.split(s).join("••••");
  for (const p of PADROES_SEGREDO) saida = saida.replace(new RegExp(p.source, "g"), "••••");
  return saida;
}

function sanearDescricao(valor: unknown, max: number): string {
  if (typeof valor !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return valor.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Mata a árvore do processo (grupo no POSIX, `taskkill /T` no Windows). Idempotente. */
export function matarArvore(filho: ChildProcess): void {
  const pid = filho.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    try { filho.kill("SIGKILL"); } catch { /* já morreu */ }
  }
}

interface Pendente { resolver: (v: unknown) => void; rejeitar: (e: Error) => void }

/** Sessão JSON-RPC (NDJSON) com um servidor MCP por stdio. */
export class SessaoStdio {
  readonly filho: ChildProcess;
  private proximoId = 1;
  private readonly pendentes = new Map<number, Pendente>();
  private buffer = "";
  private falha: ErroSessao | null = null;
  private stderrBruto = "";
  private encerrado: Promise<void>;

  constructor(alvo: AlvoStdio) {
    this.filho = spawn(alvo.executavel, alvo.args, {
      env: alvo.env, cwd: alvo.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32", windowsHide: true,
    });
    this.encerrado = new Promise<void>((resolve) => { this.filho.once("close", () => resolve()); this.filho.once("error", () => resolve()); });
    this.filho.stdout!.setEncoding("utf8");
    this.filho.stdout!.on("data", (pedaco: string) => this.aoStdout(pedaco));
    this.filho.stderr!.setEncoding("utf8");
    this.filho.stderr!.on("data", (pedaco: string) => { if (this.stderrBruto.length < MAX_STDERR * 2) this.stderrBruto += pedaco; });
    this.filho.stdin!.on("error", () => { /* EPIPE: o exit/close reporta */ });
    this.filho.once("error", (e: NodeJS.ErrnoException) => this.falhar(new ErroSessao(e.code === "ENOENT" || e.code === "EACCES" ? "executavel_ausente" : "processo_encerrou", e.code)));
    this.filho.once("exit", () => this.falhar(new ErroSessao("processo_encerrou")));
  }

  get stderr(): string { return this.stderrBruto; }

  private falhar(e: ErroSessao): void {
    if (this.falha) return;
    this.falha = e;
    for (const p of this.pendentes.values()) p.rejeitar(e);
    this.pendentes.clear();
  }

  private aoStdout(pedaco: string): void {
    this.buffer += pedaco;
    if (this.buffer.length > MAX_LINHA && !this.buffer.includes("\n")) { this.falhar(new ErroSessao("saida_invalida", "linha longa demais")); return; }
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const linha = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (linha === "") continue;
      let msg: unknown;
      try { msg = JSON.parse(linha); } catch { this.falhar(new ErroSessao("saida_invalida", "linha não é JSON")); return; }
      if (typeof msg !== "object" || msg === null || Array.isArray(msg) || (msg as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
        this.falhar(new ErroSessao("saida_invalida", "mensagem não é JSON-RPC 2.0"));
        return;
      }
      const m = msg as { id?: unknown; result?: unknown; error?: { code?: number; message?: string } };
      if (typeof m.id !== "number") continue; // notificação ou pedido do servidor: ignorados
      const p = this.pendentes.get(m.id);
      if (!p) continue;
      this.pendentes.delete(m.id);
      if (m.error) {
        const texto = String(m.error.message ?? "");
        p.rejeitar(new ErroSessao(/unauthori[sz]ed|forbidden|\b40[13]\b|invalid[^a-z]*(api)?[^a-z]*(key|token)|chave invalida/i.test(texto) ? "nao_autorizado" : "erro_servidor", texto.slice(0, 200)));
      } else p.resolver(m.result);
    }
  }

  pedir(method: string, params: unknown = {}): Promise<unknown> {
    if (this.falha) return Promise.reject(this.falha);
    const id = this.proximoId++;
    return new Promise<unknown>((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver, rejeitar });
      this.filho.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notificar(method: string, params: unknown = {}): void {
    if (this.falha) return;
    this.filho.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  /** Fecha o stdin e mata a árvore; resolve quando o processo saiu (≤ 500 ms de espera). */
  async encerrar(): Promise<void> {
    try { this.filho.stdin!.end(); } catch { /* já fechado */ }
    matarArvore(this.filho);
    await Promise.race([this.encerrado, new Promise<void>((r) => setTimeout(r, 500))]);
  }
}

/** Handshake MCP (initialize + notifications/initialized). Devolve o `serverInfo`. */
export async function handshake(sessao: SessaoStdio): Promise<{ nome: string; versao: string }> {
  const r = await sessao.pedir("initialize", {
    protocolVersion: VERSAO_PROTOCOLO, capabilities: {}, clientInfo: { name: "loja-mcp-saude", version: "1.0.0" },
  });
  const o = r as { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown } } | null;
  if (!o || typeof o.protocolVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.protocolVersion) || o.protocolVersion < "2024-11-05" || typeof o.serverInfo !== "object" || o.serverInfo === null)
    throw new ErroSessao("protocolo_incompativel");
  sessao.notificar("notifications/initialized");
  return { nome: sanearDescricao(o.serverInfo.name, 80), versao: sanearDescricao(o.serverInfo.version, 40) };
}

/** `tools/list` com paginação (até 200 ferramentas). */
export async function listarFerramentas(sessao: SessaoStdio): Promise<FerramentaVista[]> {
  const todas: FerramentaVista[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = (await sessao.pedir("tools/list", cursor ? { cursor } : {})) as { tools?: unknown; nextCursor?: unknown } | null;
    if (!r || !Array.isArray(r.tools)) throw new ErroSessao("protocolo_incompativel");
    for (const t of r.tools as Array<{ name?: unknown; description?: unknown }>) {
      if (todas.length >= MAX_FERRAMENTAS) return todas;
      if (typeof t?.name === "string") todas.push({ nome: sanearDescricao(t.name, 128), descricao: sanearDescricao(t.description, 300) });
    }
    if (typeof r.nextCursor !== "string" || r.nextCursor === "") break;
    cursor = r.nextCursor;
  }
  return todas;
}

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  const prazo = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ErroSessao("timeout")), ms); });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(t));
}

/**
 * Testa um servidor MCP stdio. Nunca lança: todo problema vira `estado` + `erro_codigo`.
 * `ok` ≤ limiar; `lento` acima do limiar ou estourando o timeout; `quebrado` em erro de protocolo/saída/processo;
 * `sem_ferramentas` quando `tools/list` vem vazio; `exige_variavel` quando falha faltando variável obrigatória.
 */
export async function testarServidor(alvo: AlvoStdio, opcoes: OpcoesSaude = {}): Promise<ResultadoSaude> {
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_SAUDE_PADRAO_MS;
  const limiar = opcoes.limiarLentoMs ?? LIMIAR_LENTO_PADRAO_MS;
  const faltando = (opcoes.variaveisObrigatorias ?? []).filter((n) => !alvo.env[n]);
  const segredos = [...(opcoes.segredos ?? []), ...Object.entries(alvo.env).filter(([k, v]) => RE_NOME_SEGREDO.test(k) && v.length >= 4).map(([, v]) => v)];
  const inicio = performance.now();
  const sessao = new SessaoStdio(alvo);
  const pid = sessao.filho.pid ?? null;
  const base = { variaveis_faltando: [] as string[], servidor: null as ResultadoSaude["servidor"], pid };
  let servidor: ResultadoSaude["servidor"] = null;
  try {
    const ferramentas = await comPrazo((async () => { servidor = await handshake(sessao); return listarFerramentas(sessao); })(), timeoutMs);
    const latencia = Math.round(performance.now() - inicio);
    const estado: EstadoSaude = ferramentas.length === 0 ? "sem_ferramentas" : latencia > limiar ? "lento" : "ok";
    await sessao.encerrar();
    return { ...base, servidor, estado, latencia_ms: latencia, n_ferramentas: ferramentas.length, ferramentas, erro_codigo: null, stderr_redigido: redigir(sessao.stderr, segredos).slice(0, MAX_STDERR) };
  } catch (e) {
    const codigo: CodigoErroSaude = e instanceof ErroSessao ? e.codigo : "erro_servidor";
    const latencia = Math.round(performance.now() - inicio);
    await sessao.encerrar();
    let estado: EstadoSaude = codigo === "timeout" ? "lento" : "quebrado";
    if (faltando.length > 0 && codigo !== "timeout" && codigo !== "executavel_ausente") estado = "exige_variavel";
    return {
      ...base, servidor, estado, latencia_ms: latencia, n_ferramentas: 0, ferramentas: [], erro_codigo: codigo,
      variaveis_faltando: estado === "exige_variavel" ? faltando : [],
      stderr_redigido: redigir(sessao.stderr, segredos).slice(0, MAX_STDERR),
    };
  }
}
