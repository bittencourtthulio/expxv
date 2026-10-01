import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, accessSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, extname, isAbsolute, join, resolve } from "node:path";
import type { CodigoDeteccao, FerramentaDetectada, FerramentaId, ModoLancamento } from "../../compartilhado/terminais";
import { CATALOGO_TERMINAIS, recursosDaFerramenta } from "./catalogo";

export type { CodigoDeteccao, FerramentaDetectada, ModoLancamento };
export type Plataforma = "darwin" | "win32" | "linux";

export interface ExecutavelResolvido {
  ferramenta_id: FerramentaId;
  caminho: string;
  modo_lancamento: ModoLancamento;
}

export interface OpcoesDeteccao {
  plataforma?: Plataforma;
  path?: string;
  pathext?: string;
  diretorios_convencionais?: readonly string[];
  registro?: RegistroExecutaveis;
}

/** Diretórios onde as CLIs costumam morar mesmo fora do PATH de um app GUI (homebrew, local, volta, bun, todas as versões do nvm; Windows: Programs e npm). */
export function diretoriosConvencionais(plataforma: Plataforma, contexto: { casa?: string; env?: NodeJS.ProcessEnv } = {}): string[] {
  const casa = contexto.casa ?? homedir();
  const env = contexto.env ?? process.env;
  if (plataforma === "win32") {
    return [
      env["LOCALAPPDATA"] ? join(env["LOCALAPPDATA"], "Programs") : "",
      env["APPDATA"] ? join(env["APPDATA"], "npm") : "",
    ].filter(Boolean);
  }
  let nvm: string[] = [];
  try {
    nvm = readdirSync(join(casa, ".nvm", "versions", "node"), { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => join(casa, ".nvm", "versions", "node", item.name, "bin"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // a versão mais nova primeiro
  } catch { /* nvm é opcional */ }
  const base = [join(casa, ".local", "bin"), join(casa, ".volta", "bin"), join(casa, ".bun", "bin"), ...nvm];
  return plataforma === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin", ...base] : ["/usr/local/bin", ...base];
}

function extensoes(plataforma: Plataforma, pathext: string | undefined): string[] {
  if (plataforma !== "win32") return [""];
  return (pathext ?? ".COM;.EXE;.BAT;.CMD;.PS1").split(";").filter(Boolean).map((e) => e.toLowerCase());
}

function modoDoCaminho(caminho: string): ModoLancamento {
  const ext = extname(caminho).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") return "cmd_wrapper";
  if (ext === ".ps1") return "powershell_wrapper";
  return "direto";
}

function inspecionar(caminho: string, plataforma: Plataforma): "ok" | "sem_permissao" | "ausente" {
  try {
    if (!statSync(caminho).isFile()) return "ausente";
    if (plataforma !== "win32") accessSync(caminho, constants.X_OK);
    return "ok";
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code;
    return codigo === "EACCES" ? "sem_permissao" : "ausente";
  }
}

/** O renderer só conhece o `executavel_id` opaco; o caminho fica aqui, no main. */
export class RegistroExecutaveis {
  readonly #itens = new Map<string, ExecutavelResolvido>();
  readonly #chaves = new Map<string, string>();
  readonly #plataforma: Plataforma;
  readonly #criarId: () => string;

  constructor(opcoes: { plataforma?: Plataforma; criar_id?: () => string } = {}) {
    this.#plataforma = opcoes.plataforma ?? process.platform as Plataforma;
    this.#criarId = opcoes.criar_id ?? (() => `exe_${randomUUID().replaceAll("-", "")}`);
  }

  /** O mesmo executável (ferramenta + caminho + modo) reaproveita o id: detectar de novo não invalida o que a UI já tem. */
  adicionar(item: ExecutavelResolvido): string {
    const chave = `${item.ferramenta_id}|${item.modo_lancamento}|${item.caminho}`;
    const existente = this.#chaves.get(chave);
    if (existente !== undefined) return existente;
    const id = this.#criarId();
    this.#itens.set(id, item);
    this.#chaves.set(chave, id);
    return id;
  }

  selecionar(caminho: string, ferramenta_id: FerramentaId):
    | { ok: true; executavel_id: string }
    | { ok: false; erro_codigo: "arquivo_ausente" | "sem_permissao" | "caminho_invalido"; mensagem: string } {
    if (!isAbsolute(caminho) || caminho.includes("\0")) return { ok: false, erro_codigo: "caminho_invalido", mensagem: "Selecione um caminho absoluto válido." };
    const estado = inspecionar(caminho, this.#plataforma);
    if (estado === "ausente") return { ok: false, erro_codigo: "arquivo_ausente", mensagem: "O executável selecionado não existe." };
    if (estado === "sem_permissao") return { ok: false, erro_codigo: "sem_permissao", mensagem: "O arquivo selecionado não tem permissão de execução." };
    const real = realpathSync(caminho);
    return { ok: true, executavel_id: this.adicionar({ ferramenta_id, caminho: real, modo_lancamento: modoDoCaminho(real) }) };
  }

  obter(id: string): ExecutavelResolvido | undefined {
    return this.#itens.get(id);
  }

  limpar(): void {
    this.#itens.clear();
    this.#chaves.clear();
  }
}

/** Varredura síncrona (PATH, depois diretórios convencionais). Não executa nada; `versao` fica null (veja `DetectorFerramentas`). */
export function detectarFerramentas(opcoes: OpcoesDeteccao = {}): FerramentaDetectada[] {
  const plataforma = opcoes.plataforma ?? process.platform as Plataforma;
  const dirsPath = (opcoes.path ?? process.env["PATH"] ?? "").split(delimiter).filter(Boolean).map((p) => resolve(p));
  const dirs = [...new Set([...dirsPath, ...(opcoes.diretorios_convencionais ?? diretoriosConvencionais(plataforma))])];
  const exts = extensoes(plataforma, opcoes.pathext ?? process.env["PATHEXT"]);
  const registro = opcoes.registro ?? new RegistroExecutaveis({ plataforma });

  return CATALOGO_TERMINAIS.map((ferramenta): FerramentaDetectada => {
    const base = { id: ferramenta.id, nome: ferramenta.nome, descricao: ferramenta.descricao, recursos: recursosDaFerramenta(ferramenta.id), versao: null };
    if (!ferramenta.mapeada) return { ...base, instalado: false, executavel_id: null, modo_lancamento: null, erro_codigo: "nao_mapeado" };
    let semPermissao = false;
    for (const dir of dirs) {
      for (const nome of ferramenta.executaveis) {
        for (const ext of exts) {
          const candidato = join(dir, plataforma === "win32" && extname(nome) === "" ? `${nome}${ext}` : nome);
          const estado = inspecionar(candidato, plataforma);
          if (estado === "sem_permissao") semPermissao = true;
          if (estado === "ok") {
            const caminho = realpathSync(candidato);
            const modo_lancamento = modoDoCaminho(caminho);
            const executavel_id = registro.adicionar({ ferramenta_id: ferramenta.id, caminho, modo_lancamento });
            return { ...base, instalado: true, executavel_id, modo_lancamento, erro_codigo: null };
          }
        }
      }
    }
    return { ...base, instalado: false, executavel_id: null, modo_lancamento: null, erro_codigo: semPermissao ? "sem_permissao" : "ausente" };
  });
}

// ---------------------------------------------------------------- versão

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const VERSAO = /\d+\.\d+(?:\.\d+)?(?:[-+.\w]*)/;

export interface OpcoesVersao { timeout_ms?: number; plataforma?: Plataforma }

function executar(arquivo: string, argumentos: string[], opcoes: { timeout_ms: number; verbatim?: boolean }): Promise<string | null> {
  return new Promise((resolver) => {
    try {
      const filho = execFile(arquivo, argumentos, {
        timeout: opcoes.timeout_ms, killSignal: "SIGKILL", maxBuffer: 16 * 1024, windowsHide: true, encoding: "utf8",
        windowsVerbatimArguments: opcoes.verbatim === true, env: { ...process.env, NO_COLOR: "1", CI: "1" },
      }, (erro, stdout) => resolver(erro === null ? stdout : null));
      filho.stdin?.end();
    } catch { resolver(null); }
  });
}

/**
 * Lê a versão com `--version`: sem shell, timeout curto (2 s), saída limitada. `null` em qualquer falha.
 * Wrappers do Windows só passam por cmd.exe/powershell.exe com o caminho já validado (sem aspas nem controle).
 */
export async function lerVersao(caminho: string, modo: ModoLancamento, opcoes: OpcoesVersao = {}): Promise<string | null> {
  const plataforma = opcoes.plataforma ?? process.platform as Plataforma;
  const timeout_ms = opcoes.timeout_ms ?? 2_000;
  if (!isAbsolute(caminho) && plataforma !== "win32") return null;
  if (/["\u0000-\u001f]/.test(caminho)) return null;
  let bruto: string | null;
  if (modo === "direto") bruto = await executar(caminho, ["--version"], { timeout_ms });
  else if (plataforma !== "win32") return null;
  else if (modo === "cmd_wrapper") bruto = await executar("cmd.exe", ["/d", "/s", "/c", `""${caminho}" --version"`], { timeout_ms, verbatim: true });
  else bruto = await executar("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", caminho, "--version"], { timeout_ms });
  if (bruto === null) return null;
  const linha = bruto.replace(ANSI, "").split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "");
  if (linha === undefined) return null;
  const achada = VERSAO.exec(linha);
  return (achada?.[0] ?? linha).slice(0, 80);
}

// ---------------------------------------------------------------- detector com cache

export interface OpcoesDetector extends OpcoesDeteccao {
  lerVersao?: (caminho: string, modo: ModoLancamento) => Promise<string | null>;
  timeout_versao_ms?: number;
}

/**
 * Detecção completa (varredura + versão) com cache. `invalidar()` é chamado pelo main no foco da janela:
 * a próxima `detectar()` varre de novo, mas a versão só é relida se o arquivo mudou (mtime).
 */
export class DetectorFerramentas {
  readonly registro: RegistroExecutaveis;
  readonly #opcoes: OpcoesDetector;
  readonly #versoes = new Map<string, { mtime: number; versao: string }>();
  #cache: Promise<FerramentaDetectada[]> | null = null;

  constructor(opcoes: OpcoesDetector = {}) {
    this.#opcoes = opcoes;
    this.registro = opcoes.registro ?? new RegistroExecutaveis(opcoes.plataforma === undefined ? {} : { plataforma: opcoes.plataforma });
  }

  detectar(): Promise<FerramentaDetectada[]> {
    if (this.#cache === null) {
      const varredura = this.#varrer();
      this.#cache = varredura;
      varredura.catch(() => { if (this.#cache === varredura) this.#cache = null; });
    }
    return this.#cache;
  }

  invalidar(): void {
    this.#cache = null;
  }

  async #varrer(): Promise<FerramentaDetectada[]> {
    const base = detectarFerramentas({ ...this.#opcoes, registro: this.registro });
    const ler = this.#opcoes.lerVersao
      ?? ((caminho: string, modo: ModoLancamento) => lerVersao(caminho, modo, { ...(this.#opcoes.timeout_versao_ms === undefined ? {} : { timeout_ms: this.#opcoes.timeout_versao_ms }), ...(this.#opcoes.plataforma === undefined ? {} : { plataforma: this.#opcoes.plataforma }) }));
    const ler_uma = async (f: FerramentaDetectada): Promise<FerramentaDetectada> => {
      const item = f.executavel_id === null ? undefined : this.registro.obter(f.executavel_id);
      if (item === undefined || f.id === "terminal") return f;
      let mtime = 0;
      try { mtime = statSync(item.caminho).mtimeMs; } catch { /* some entre a varredura e agora */ }
      const guardada = this.#versoes.get(item.caminho);
      if (guardada !== undefined && guardada.mtime === mtime) return { ...f, versao: guardada.versao };
      const versao = await ler(item.caminho, item.modo_lancamento).catch(() => null);
      if (versao !== null) this.#versoes.set(item.caminho, { mtime, versao });
      return { ...f, versao };
    };
    // Cada `--version` é um spawn, e o spawn da primeira execução de um binário bloqueia o event loop do main
    // (P-12). Sai um por turno do loop, em vez de uma rajada de N na mesma volta; continuam concorrentes.
    const resultados: Array<Promise<FerramentaDetectada>> = [];
    for (const f of base) {
      resultados.push(ler_uma(f));
      await new Promise<void>((resolver) => setImmediate(resolver));
    }
    return Promise.all(resultados);
  }
}

// ---------------------------------------------------------------- PATH do shell de login

export interface OpcoesPathDeLogin {
  plataforma?: Plataforma;
  /** shell a consultar; `null` pula direto para o fallback. Padrão: `$SHELL`, senão zsh (macOS) ou sh. */
  shell?: string | null;
  path_atual?: string;
  diretorios_convencionais?: readonly string[];
  timeout_ms?: number;
}

const INI = "__CAMINHO_INI__";
const FIM = "__CAMINHO_FIM__";

function unico(lista: string[]): string[] {
  return [...new Set(lista)];
}

/**
 * Apps GUI do macOS não herdam o PATH do terminal. Pergunta ao shell de login da pessoa (`$SHELL -ilc`, timeout 3 s,
 * script fixo: nenhuma entrada externa entra na linha de comando) e junta ao PATH atual; se falhar, o fallback é o
 * PATH atual mais os diretórios convencionais. Devolve uma string de PATH pronta para o ambiente das sessões.
 */
export async function resolverPathDoShellDeLogin(opcoes: OpcoesPathDeLogin = {}): Promise<string> {
  const plataforma = opcoes.plataforma ?? process.platform as Plataforma;
  const atual = opcoes.path_atual ?? process.env["PATH"] ?? "";
  if (plataforma === "win32") return atual;
  const dirsAtuais = atual.split(delimiter).filter(Boolean);
  const fallback = (): string => unico([...dirsAtuais, ...(opcoes.diretorios_convencionais ?? diretoriosConvencionais(plataforma))]).join(delimiter);
  const shell = opcoes.shell === undefined ? (process.env["SHELL"] ?? (plataforma === "darwin" ? "/bin/zsh" : "/bin/sh")) : opcoes.shell;
  if (shell === null || !isAbsolute(shell) || /[\u0000-\u001f]/.test(shell)) return fallback();
  const valor = basename(shell) === "fish" ? "(string join : $PATH)" : '"$PATH"';
  const script = `printf '${INI}%s${FIM}' ${valor}`;
  const saida = await executar(shell, ["-ilc", script], { timeout_ms: opcoes.timeout_ms ?? 3_000 });
  if (saida === null) return fallback();
  const inicio = saida.lastIndexOf(INI);
  const fim = saida.indexOf(FIM, inicio + INI.length);
  if (inicio < 0 || fim < 0) return fallback();
  const doLogin = saida.slice(inicio + INI.length, fim).split(delimiter).filter((p) => p !== "" && isAbsolute(p));
  return doLogin.length === 0 ? fallback() : unico([...doLogin, ...dirsAtuais]).join(delimiter);
}
