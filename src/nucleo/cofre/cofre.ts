// Cofre de credenciais (Fase 9; D-59, P-29). `nucleo/**` não importa Electron: o cifrador entra por injeção (`MotorCofre`).
// Contrato de segurança (M14): o valor NUNCA vai para o renderer, para JSON em claro, log, argv, evento, ambiente de Pane
// ou mensagem de erro (erros citam só o NOME da entrada). `obter`/`usar`/`resolver` são só para código do main.
//
// Arquivo: `{versao, motor, mestra?, entradas[{id,nome,escopo,workspace_id,sensivel,cifrado_b64,criado_em,ultimo_uso_em}]}`,
// metadados em claro (listar não decifra), valor cifrado. 0600, escrita atômica (tmp + fsync + rename), tudo assíncrono.
// Abre sob demanda: nada é lido do disco até a primeira operação (leveza no boot).
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { BackendCofre, EntradaCofre, EscopoCofre, EstadoCofre, PedidoGravarCofre } from "../../compartilhado/harness";
import type { CabecalhoMestra, MotorCofre, MotorSenhaMestra } from "./cifrador";
import { CofreErro } from "./erros";
import { resolverPlaceholders } from "./placeholders";
import { criarScrubber, type Scrubber } from "./scrubber";

export const NOME_VALIDO = /^[A-Z][A-Z0-9_]{0,63}$/;
export const VALOR_MAX = 16 * 1024;
/** Bloqueio automático padrão do motor com senha-mestra (configurável; 0 = nunca). */
export const INATIVIDADE_PADRAO_MS = 15 * 60_000;

interface RegistroEntrada extends EntradaCofre {
  cifrado_b64: string;
  criado_em: string;
}
interface ArquivoCofre {
  versao: 1;
  motor: "safe_storage" | "senha_mestra";
  mestra?: CabecalhoMestra;
  entradas: RegistroEntrada[];
}

export interface Agendamento {
  cancelar(): void;
}
export interface OpcoesCofre {
  arquivo: string;
  motor: MotorCofre;
  /** 0 desliga. Só vale com senha-mestra. */
  inatividade_ms?: number;
  agora?: () => Date;
  agendar?: (fn: () => void, ms: number) => Agendamento;
  /** avisos (entrada adulterada ignorada…): só NOMES, nunca valores. */
  aviso?: (mensagem: string) => void;
  aoMudarEstado?: (estado: EstadoCofre) => void;
  gerarId?: () => string;
}

export interface ChaveEntrada {
  workspace_id?: string | null;
}

/** API ESTÁVEL do cofre. Consumidores do main (Loja de MCPs, OpenRouter, decisor) usam só isto. */
export interface Cofre {
  estado(): Promise<EstadoCofre>;
  /** Cria ou atualiza (mesmo nome+escopo+workspace = a mesma entrada). O valor atravessa uma vez e não volta. */
  guardar(pedido: PedidoGravarCofre): Promise<EntradaCofre>;
  /** Não decifra: funciona com o cofre bloqueado. */
  existe(nome: string, chave?: ChaveEntrada): Promise<boolean>;
  /** SÓ CÓDIGO DO MAIN, para uso imediato (não guarde, não logue). Workspace vence global. */
  obter(nome: string, chave?: ChaveEntrada): Promise<string>;
  /** Entrega o valor a `fn` e devolve o resultado; erros de `fn` saem com o valor removido (scrubber). Modo broker. */
  usar<T>(nome: string, fn: (valor: string) => Promise<T> | T, chave?: ChaveEntrada): Promise<T>;
  /** "Testar sem salvar": o valor vale só durante `fn`, nada vai a disco, e é scrubado das mensagens de erro. */
  usarSemSalvar<T>(valor: string, fn: (valor: string) => Promise<T> | T): Promise<T>;
  apagar(id: string): Promise<boolean>;
  /** Só metadados (nunca valor). */
  listar(): Promise<EntradaCofre[]>;
  /** `{{vault:NOME}}` → valor. Só para consumidores internos; o resultado nunca é exibido nem logado. */
  resolver(texto: string, chave?: ChaveEntrada): Promise<string>;
  /** Variáveis de ambiente para um Pane: SÓ entradas NÃO sensíveis e SÓ com `injetar` (padrão não). Bloqueado ⇒ `{}`. */
  ambienteDoPane(workspace_id: string | null, injetar: boolean): Promise<Record<string, string>>;
  /** Remove valores conhecidos (+ variantes) de um texto. Carrega os valores do cofre aberto na 1ª chamada. */
  scrub(texto: string): Promise<string>;
  /** Versão síncrona: só conhece os valores já carregados (guardar/obter/prepararScrubber). Para logs. */
  scrubSincrono(texto: string): string;
  prepararScrubber(): Promise<void>;
  definirSenhaMestra(senha: string): Promise<EstadoCofre>;
  desbloquear(senha: string): Promise<EstadoCofre>;
  bloquear(): Promise<EstadoCofre>;
  /** grava `ultimo_uso_em` pendente. */
  persistir(): Promise<void>;
  /** libera timers e valores em memória. */
  encerrar(): Promise<void>;
}

const ehMestra = (m: MotorCofre): m is MotorSenhaMestra => m.tipo === "senha_mestra";

function agendarPadrao(fn: () => void, ms: number): Agendamento {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return { cancelar: () => clearTimeout(t) };
}

async function escreverAtomico(arquivo: string, conteudo: string): Promise<void> {
  const dir = dirname(arquivo);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${arquivo}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const f = await open(tmp, "wx", 0o600);
  try {
    await f.writeFile(conteudo, "utf8");
    await f.datasync();
  } finally {
    await f.close();
  }
  try {
    await rename(tmp, arquivo);
    await chmod(arquivo, 0o600);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Motor registrado no arquivo (sem abrir o cofre), para o main escolher o motor certo na 1ª abertura. */
export async function lerMotorDoArquivo(arquivo: string): Promise<"safe_storage" | "senha_mestra" | null> {
  try {
    const j = JSON.parse(await readFile(arquivo, "utf8")) as Partial<ArquivoCofre>;
    return j.motor === "safe_storage" || j.motor === "senha_mestra" ? j.motor : null;
  } catch {
    return null;
  }
}

const ehRegistro = (e: unknown): e is RegistroEntrada => {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.id === "string" && /^cof_[0-9A-Za-z]{10,40}$/.test(r.id) &&
    typeof r.nome === "string" && NOME_VALIDO.test(r.nome) &&
    (r.escopo === "global" || r.escopo === "workspace") &&
    (r.workspace_id === null || typeof r.workspace_id === "string") &&
    (r.escopo === "workspace") === (typeof r.workspace_id === "string") &&
    typeof r.sensivel === "boolean" &&
    typeof r.cifrado_b64 === "string" && r.cifrado_b64.length > 0 &&
    typeof r.criado_em === "string" &&
    (r.ultimo_uso_em === null || typeof r.ultimo_uso_em === "string")
  );
};

const publica = (r: RegistroEntrada): EntradaCofre => ({
  id: r.id,
  nome: r.nome,
  escopo: r.escopo,
  workspace_id: r.workspace_id,
  sensivel: r.sensivel,
  ultimo_uso_em: r.ultimo_uso_em,
});
const contextoDe = (r: { id: string; nome: string }): string => `${r.id}|${r.nome}`;

export function criarCofre(op: OpcoesCofre): Cofre {
  const { motor } = op;
  const agora = op.agora ?? ((): Date => new Date());
  const agendar = op.agendar ?? agendarPadrao;
  const inatividade = op.inatividade_ms ?? INATIVIDADE_PADRAO_MS;
  const gerarId = op.gerarId ?? ((): string => `cof_${randomBytes(15).toString("base64url").replace(/[^0-9A-Za-z]/g, "x").slice(0, 20)}`);
  const scrubber: Scrubber = criarScrubber();

  let entradas: RegistroEntrada[] | null = null;
  let arquivoIlegivel = false;
  let carregando: Promise<void> | null = null;
  let sujo = false; // ultimo_uso_em pendente
  let fila: Promise<unknown> = Promise.resolve();
  let temporizador: Agendamento | null = null;
  let scrubberPronto = false;
  let incompativel = false; // arquivo criado com outro motor

  const serializar = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = fila.then(fn, fn);
    fila = p.catch(() => undefined);
    return p;
  };

  const backend = (): BackendCofre => (motor.estado().ok ? motor.tipo : motor.tipo === "senha_mestra" ? "senha_mestra" : "indisponivel");

  async function montarEstado(): Promise<EstadoCofre> {
    await carregar().catch(() => undefined);
    if (arquivoIlegivel) return { ok: false, backend: backend(), bloqueado: false, motivo: "arquivo_ilegivel" };
    if (incompativel) return { ok: false, backend: "indisponivel", bloqueado: false, motivo: "O arquivo do cofre foi criado por outro método de proteção. Restaure o método original." };
    const e = motor.estado();
    const r: EstadoCofre = { ok: e.ok, backend: backend(), bloqueado: e.bloqueado };
    if (e.motivo !== undefined) r.motivo = e.motivo;
    return r;
  }
  const notificar = async (): Promise<EstadoCofre> => {
    const e = await montarEstado();
    op.aoMudarEstado?.(e);
    return e;
  };

  function armarInatividade(): void {
    temporizador?.cancelar();
    temporizador = null;
    if (!ehMestra(motor) || inatividade <= 0 || !motor.desbloqueado()) return;
    temporizador = agendar(() => {
      void bloquear();
    }, inatividade);
  }

  function carregar(): Promise<void> {
    if (entradas !== null) return Promise.resolve();
    carregando ??= (async () => {
      let bruto: string | null = null;
      try {
        bruto = await readFile(op.arquivo, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          arquivoIlegivel = true;
          entradas = [];
          throw new CofreErro("arquivo_ilegivel");
        }
      }
      if (bruto === null) {
        entradas = [];
        if (ehMestra(motor)) motor.carregarCabecalho(null);
        return;
      }
      let j: Partial<ArquivoCofre>;
      try {
        j = JSON.parse(bruto) as Partial<ArquivoCofre>;
        if (typeof j !== "object" || j === null || !Array.isArray(j.entradas)) throw new Error("x");
      } catch {
        arquivoIlegivel = true;
        entradas = [];
        throw new CofreErro("arquivo_ilegivel");
      }
      const validas: RegistroEntrada[] = [];
      for (const e of j.entradas as unknown[]) {
        if (ehRegistro(e)) validas.push(e);
        else op.aviso?.("entrada do cofre ignorada: estrutura inválida");
      }
      if (j.motor !== undefined && j.motor !== motor.tipo && validas.length > 0) incompativel = true;
      entradas = validas;
      if (ehMestra(motor)) {
        const m = j.mestra;
        const ok = m !== undefined && m.kdf === "scrypt" && Number.isInteger(m.N) && Number.isInteger(m.r) && Number.isInteger(m.p) && typeof m.sal_b64 === "string" && typeof m.verificador_b64 === "string";
        motor.carregarCabecalho(ok ? m : null);
      }
    })();
    return carregando;
  }

  const pronto = async (): Promise<RegistroEntrada[]> => {
    await carregar();
    if (arquivoIlegivel) throw new CofreErro("arquivo_ilegivel");
    if (incompativel) throw new CofreErro("cofre_indisponivel");
    return entradas as RegistroEntrada[];
  };

  function exigirDesbloqueado(): void {
    const e = motor.estado();
    if (e.motivo === "senha_mestra_nao_definida") throw new CofreErro("senha_mestra_nao_definida");
    if (!e.ok) throw new CofreErro("cofre_indisponivel");
    if (e.bloqueado) throw new CofreErro("cofre_bloqueado");
  }

  async function gravarArquivo(): Promise<void> {
    const conteudo: ArquivoCofre = { versao: 1, motor: motor.tipo, entradas: entradas as RegistroEntrada[] };
    if (ehMestra(motor)) {
      const cab = motor.cabecalho();
      if (cab !== null) conteudo.mestra = cab;
    }
    await escreverAtomico(op.arquivo, `${JSON.stringify(conteudo, null, 1)}\n`);
    sujo = false;
  }

  const acha = (lista: RegistroEntrada[], nome: string, ws: string | null): RegistroEntrada | undefined =>
    (ws !== null ? lista.find((e) => e.nome === nome && e.escopo === "workspace" && e.workspace_id === ws) : undefined) ?? lista.find((e) => e.nome === nome && e.escopo === "global");

  function validarNome(nome: string): void {
    if (typeof nome !== "string" || !NOME_VALIDO.test(nome)) throw new CofreErro("nome_invalido");
  }

  async function decifrarEntrada(r: RegistroEntrada): Promise<string> {
    exigirDesbloqueado();
    try {
      const v = motor.decifrar(contextoDe(r), r.cifrado_b64);
      scrubber.adicionar(r.nome, v);
      return v;
    } catch (e) {
      if (e instanceof CofreErro && e.codigo !== "entrada_corrompida") throw e;
      op.aviso?.(`entrada do cofre ilegível ou adulterada: ${r.nome}`);
      throw new CofreErro("entrada_corrompida", r.nome);
    }
  }

  const limpar = (e: unknown): never => {
    if (e instanceof Error) {
      const limpo = new Error(scrubber.scrub(e.message));
      limpo.name = e.name;
      if (e instanceof CofreErro) throw e;
      throw limpo;
    }
    throw new Error("falha");
  };

  async function obter(nome: string, chave: ChaveEntrada = {}): Promise<string> {
    validarNome(nome);
    const lista = await pronto();
    exigirDesbloqueado();
    const r = acha(lista, nome, chave.workspace_id ?? null);
    if (r === undefined) throw new CofreErro("entrada_inexistente", nome);
    const v = await decifrarEntrada(r);
    r.ultimo_uso_em = agora().toISOString();
    sujo = true;
    armarInatividade();
    return v;
  }

  async function bloquear(): Promise<EstadoCofre> {
    if (ehMestra(motor)) {
      if (sujo && entradas !== null) await serializar(gravarArquivo).catch(() => undefined);
      motor.bloquear();
    }
    scrubber.limpar();
    scrubberPronto = false;
    temporizador?.cancelar();
    temporizador = null;
    return notificar();
  }

  async function prepararScrubber(): Promise<void> {
    const lista = await pronto();
    if (motor.estado().bloqueado || !motor.estado().ok) return;
    for (const r of lista) {
      try {
        await decifrarEntrada(r);
      } catch {
        // entrada ilegível já gerou aviso (só o nome)
      }
    }
    scrubberPronto = true;
  }

  const persistir = (): Promise<void> => serializar(async () => (sujo && entradas !== null ? gravarArquivo() : undefined));

  const exigirMestra = (): MotorSenhaMestra => {
    if (!ehMestra(motor)) throw new CofreErro("cofre_indisponivel");
    return motor;
  };

  return {
    estado: montarEstado,

    guardar(p) {
      return serializar(async () => {
        validarNome(p.nome);
        if (typeof p.valor !== "string" || p.valor.length === 0 || p.valor.length > VALOR_MAX || p.valor.includes("\0")) throw new CofreErro("valor_invalido", p.nome);
        if ((p.escopo === "workspace") !== (p.workspace_id !== null)) throw new CofreErro("nome_invalido", p.nome);
        const lista = await pronto();
        exigirDesbloqueado();
        const ws: string | null = p.escopo === "workspace" ? p.workspace_id : null;
        let r = (p.id !== null ? lista.find((e) => e.id === p.id) : undefined) ?? lista.find((e) => e.nome === p.nome && e.escopo === p.escopo && e.workspace_id === ws);
        if (p.id !== null && r === undefined) throw new CofreErro("entrada_inexistente", p.nome);
        const duplicada = lista.find((e) => e !== r && e.nome === p.nome && e.escopo === p.escopo && e.workspace_id === ws);
        if (duplicada !== undefined) throw new CofreErro("nome_invalido", p.nome);
        const antigo = r === undefined ? null : { ...r };
        if (r === undefined) {
          r = { id: gerarId(), nome: p.nome, escopo: p.escopo, workspace_id: ws, sensivel: p.sensivel, cifrado_b64: "", criado_em: agora().toISOString(), ultimo_uso_em: null };
          lista.push(r);
        } else {
          scrubber.remover(r.nome);
          r.nome = p.nome;
          r.escopo = p.escopo;
          r.workspace_id = ws;
          r.sensivel = p.sensivel;
        }
        try {
          r.cifrado_b64 = motor.cifrar(contextoDe(r), p.valor);
          await gravarArquivo();
        } catch (e) {
          if (antigo === null) lista.splice(lista.indexOf(r), 1);
          else Object.assign(r, antigo);
          throw e instanceof CofreErro ? e : new CofreErro("arquivo_ilegivel", p.nome);
        }
        scrubber.adicionar(p.nome, p.valor);
        armarInatividade();
        return publica(r);
      });
    },

    async existe(nome, chave = {}) {
      validarNome(nome);
      return acha(await pronto(), nome, chave.workspace_id ?? null) !== undefined;
    },

    obter,

    async usar(nome, fn, chave = {}) {
      const v = await obter(nome, chave);
      try {
        return await fn(v);
      } catch (e) {
        return limpar(e);
      }
    },

    async usarSemSalvar(valor, fn) {
      if (typeof valor !== "string" || valor.length === 0 || valor.length > VALOR_MAX) throw new CofreErro("valor_invalido");
      const nome = "TEMPORARIO";
      const tinha = scrubber.nomes().includes(nome);
      scrubber.adicionar(nome, valor);
      try {
        return await fn(valor);
      } catch (e) {
        return limpar(e);
      } finally {
        if (!tinha) scrubber.remover(nome);
      }
    },

    apagar(id) {
      return serializar(async () => {
        const lista = await pronto();
        const i = lista.findIndex((e) => e.id === id);
        if (i < 0) return false;
        const [r] = lista.splice(i, 1) as [RegistroEntrada];
        try {
          await gravarArquivo();
        } catch (e) {
          lista.splice(i, 0, r);
          throw e;
        }
        scrubber.remover(r.nome);
        return true;
      });
    },

    async listar() {
      const lista = await pronto();
      return lista.map(publica).sort((a, b) => a.nome.localeCompare(b.nome) || (a.workspace_id ?? "").localeCompare(b.workspace_id ?? ""));
    },

    resolver: (texto, chave = {}) => resolverPlaceholders(texto, (n) => obter(n, chave)),

    async ambienteDoPane(workspace_id, injetar) {
      if (!injetar) return {};
      const lista = await pronto();
      if (motor.estado().bloqueado || !motor.estado().ok) return {};
      const saida: Record<string, string> = {};
      const nomes = [...new Set(lista.filter((e) => !e.sensivel && (e.escopo === "global" || e.workspace_id === workspace_id)).map((e) => e.nome))];
      for (const n of nomes) {
        const r = acha(lista, n, workspace_id);
        if (r === undefined || r.sensivel) continue;
        saida[n] = await decifrarEntrada(r);
      }
      return saida;
    },

    prepararScrubber,

    async scrub(texto) {
      if (!scrubberPronto) await prepararScrubber();
      return scrubber.scrub(texto);
    },
    scrubSincrono: (texto) => scrubber.scrub(texto),

    async definirSenhaMestra(senha) {
      const m = exigirMestra();
      await serializar(async () => {
        const lista = await pronto();
        const cabAntigo = m.cabecalho();
        if (cabAntigo === null) {
          if (lista.length > 0) throw new CofreErro("cofre_indisponivel");
          await m.definir(senha);
          await gravarArquivo();
          return;
        }
        if (!m.desbloqueado()) throw new CofreErro("cofre_bloqueado");
        // troca de senha: decifra tudo com a chave atual, regrava com a nova (tudo ou nada).
        const claros = lista.map((r) => ({ r, v: m.decifrar(contextoDe(r), r.cifrado_b64) }));
        const antigos = lista.map((r) => r.cifrado_b64);
        await m.definir(senha);
        try {
          for (const { r, v } of claros) r.cifrado_b64 = m.cifrar(contextoDe(r), v);
          await gravarArquivo();
        } catch (e) {
          lista.forEach((r, i) => (r.cifrado_b64 = antigos[i] as string));
          m.carregarCabecalho(cabAntigo);
          throw e;
        }
      });
      armarInatividade();
      return notificar();
    },

    async desbloquear(senha) {
      const m = exigirMestra();
      await pronto();
      await m.desbloquear(senha);
      armarInatividade();
      return notificar();
    },

    bloquear,

    persistir,

    async encerrar() {
      await persistir().catch(() => undefined);
      temporizador?.cancelar();
      temporizador = null;
      scrubber.limpar();
      if (ehMestra(motor)) motor.bloquear();
    },
  };
}

export type { EscopoCofre };
