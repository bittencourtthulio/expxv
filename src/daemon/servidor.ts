// Servidor do daemon de PTY: mantém os processos vivos quando o app fecha, guarda a saída (memória e
// disco) e fala NDJSON por socket Unix / named pipe, autenticado por token.

import { connect, createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { LIMITES_TERMINAIS } from "../compartilhado/terminais";
import type { AdaptadorPty, ProcessoPty } from "../nucleo/terminais/lancamento";
import { apagarSessao, gravarMeta, ID_SESSAO_DAEMON, LogSessao, varrerSessoes } from "./historico";
import {
  PROTOCOLO_DAEMON, separarLinhas,
  type EstadoDaemon, type EventoDaemon, type InfoSessaoDaemon, type MetaSessao, type PedidoNumerado, type Resposta,
} from "./protocolo";

export interface OpcoesServidor {
  dir: string;
  socket: string;
  token: string;
  adaptador: AdaptadorPty;
  /** Tamanho máximo do histórico por sessão, em caracteres (mesma medida do armazém da interface). */
  limite?: number;
  /** Tempo sem cliente e sem processo vivo até o daemon sair (padrão 60 s). */
  ociosoMs?: number;
  /** Só para teste: versão do protocolo que este servidor fala. */
  protocolo?: number;
  aoEncerrar?: () => void;
}

export interface ServidorDaemon {
  fechar(): Promise<void>;
}

interface SessaoDaemon {
  id: string;
  meta: MetaSessao;
  estado: EstadoDaemon;
  codigo: number | null;
  sinal: number | null;
  processo: ProcessoPty | null;
  total: number;
  cauda: string[];
  tamanho_cauda: number;
  log: LogSessao | null;
  anexados: Set<Conexao>;
  descartada: boolean;
  matar_pedido: boolean;
}

interface Conexao {
  socket: Socket;
  resto: string;
  autenticada: boolean;
  pausadas: Set<string>;
}

export async function iniciarServidor(op: OpcoesServidor): Promise<ServidorDaemon> {
  const limite = op.limite ?? LIMITES_TERMINAIS.buffer_saida_bytes;
  const ociosoMs = op.ociosoMs ?? 60_000;
  const protocolo = op.protocolo ?? PROTOCOLO_DAEMON;
  const sessoes = new Map<string, SessaoDaemon>();
  const conexoes = new Set<Conexao>();
  let temporizadorOcioso: NodeJS.Timeout | null = null;
  let fechado = false;
  mkdirSync(op.dir, { recursive: true, mode: 0o700 });

  const info = (s: SessaoDaemon): InfoSessaoDaemon => ({ ...s.meta, sessao_id: s.id, estado: s.estado, codigo: s.codigo, sinal: s.sinal });
  const persistir = (s: SessaoDaemon): void => gravarMeta(op.dir, info(s));

  const aparar = (s: SessaoDaemon): void => {
    while (s.tamanho_cauda > limite && s.cauda.length > 1) s.tamanho_cauda -= (s.cauda.shift() as string).length;
    if (s.tamanho_cauda > limite) {
      const unico = (s.cauda[0] as string).slice(-limite);
      s.cauda = [unico];
      s.tamanho_cauda = unico.length;
    }
  };

  const enviar = (c: Conexao, mensagem: Resposta | EventoDaemon): void => {
    if (!c.socket.destroyed) c.socket.write(`${JSON.stringify(mensagem)}\n`);
  };

  const algumaViva = (): boolean => [...sessoes.values()].some((s) => s.estado === "executando");

  const avaliarOcioso = (): void => {
    const ocioso = !fechado && conexoes.size === 0 && !algumaViva();
    if (!ocioso) {
      if (temporizadorOcioso !== null) { clearTimeout(temporizadorOcioso); temporizadorOcioso = null; }
      return;
    }
    if (temporizadorOcioso !== null) return; // já contando: reavaliar não reinicia a espera
    temporizadorOcioso = setTimeout(() => { void encerrarDaemon(); }, ociosoMs);
    temporizadorOcioso.unref();
  };

  // sessões que sobraram de um daemon anterior: as vivas viraram interrompidas, as encerradas guardam o histórico
  for (const { info: anterior, cauda } of varrerSessoes(op.dir, limite)) {
    const { sessao_id: id, estado, codigo, sinal, ...meta } = anterior;
    const viva = estado === "executando";
    const sessao: SessaoDaemon = {
      id, meta, estado: viva ? "erro" : estado, codigo: viva ? null : codigo, sinal: viva ? null : sinal,
      processo: null, total: cauda.length, cauda: cauda === "" ? [] : [cauda], tamanho_cauda: cauda.length, log: null,
      anexados: new Set(), descartada: false, matar_pedido: false,
    };
    sessoes.set(id, sessao);
    if (viva) persistir(sessao);
  }

  const receber = (s: SessaoDaemon, dados: string): void => {
    s.total += dados.length;
    s.cauda.push(dados);
    s.tamanho_cauda += dados.length;
    aparar(s);
    s.log?.gravar(dados, () => s.cauda.join(""));
    for (const c of s.anexados) enviar(c, { ev: "dados", id: s.id, dados, fim: s.total });
  };

  const ligarProcesso = (s: SessaoDaemon, processo: ProcessoPty): void => {
    processo.onData((dados) => receber(s, dados));
    processo.onExit(({ exitCode, signal }) => {
      s.estado = exitCode === 0 || s.matar_pedido ? "encerrada" : "erro";
      s.codigo = Number.isInteger(exitCode) ? exitCode : null;
      s.sinal = Number.isInteger(signal) ? signal as number : null;
      s.processo = null;
      s.log?.fechar();
      s.log = null;
      if (!s.descartada) persistir(s);
      for (const c of s.anexados) enviar(c, { ev: "saiu", id: s.id, codigo: s.codigo, sinal: s.sinal });
      avaliarOcioso();
    });
  };

  const descartar = (s: SessaoDaemon): void => {
    s.descartada = true;
    if (s.processo !== null) { s.matar_pedido = true; s.processo.kill(); }
    s.log?.fechar();
    s.log = null;
    apagarSessao(op.dir, s.id);
    sessoes.delete(s.id);
  };

  const criar = (c: Conexao, pedido: Extract<PedidoNumerado, { op: "criar" }>): void => {
    if (!ID_SESSAO_DAEMON.test(pedido.id) || sessoes.has(pedido.id)) throw new Error("identificador de sessão inválido ou repetido");
    // o `meta` guarda só o que a interface precisa: nunca o ambiente do processo nem o caminho do executável
    const m = pedido.meta;
    const meta: MetaSessao = {
      ferramenta_id: m.ferramenta_id, executavel_id: m.executavel_id, argumentos: m.argumentos, raiz: m.raiz,
      workspace_id: m.workspace_id ?? null, colunas: m.colunas, linhas: m.linhas, criada_em: m.criada_em,
    };
    const s: SessaoDaemon = {
      id: pedido.id, meta, estado: "executando", codigo: null, sinal: null, processo: null,
      total: 0, cauda: [], tamanho_cauda: 0, log: new LogSessao(op.dir, pedido.id, limite), anexados: new Set([c]), descartada: false, matar_pedido: false,
    };
    let processo: ProcessoPty;
    try {
      processo = op.adaptador.spawn(pedido.executavel, pedido.argumentos, { cwd: pedido.cwd, colunas: pedido.colunas, linhas: pedido.linhas, env: pedido.env, sessao_id: pedido.id, meta });
    } catch (e) {
      s.log?.fechar();
      apagarSessao(op.dir, pedido.id);
      throw e;
    }
    s.processo = processo;
    sessoes.set(s.id, s);
    ligarProcesso(s, processo);
    persistir(s);
    avaliarOcioso();
  };

  const obter = (id: string): SessaoDaemon => {
    const s = sessoes.get(id);
    if (s === undefined) throw new Error("sessão desconhecida");
    return s;
  };

  const soltarConexao = (c: Conexao): void => {
    for (const s of sessoes.values()) {
      s.anexados.delete(c);
      // cliente sumiu pausado: retoma, senão o processo trava no buffer do PTY sem ninguém para consumir
      if (c.pausadas.has(s.id)) s.processo?.resume();
    }
    c.pausadas.clear();
  };

  const tratar = (c: Conexao, pedido: PedidoNumerado): void => {
    const responder = (resposta: Record<string, unknown> = {}): void => { if (pedido.n !== undefined) enviar(c, { re: pedido.n, ok: true, ...resposta }); };
    const falhar = (erro: string): void => { if (pedido.n !== undefined) enviar(c, { re: pedido.n, ok: false, erro }); };
    if (!c.autenticada) {
      if (pedido.op !== "ola") { c.socket.destroy(); return; }
      if (pedido.token !== op.token) { falhar("token inválido"); c.socket.end(); return; }
      if (pedido.protocolo !== protocolo) { falhar(`protocolo ${String(pedido.protocolo)} incompatível com ${protocolo}`); c.socket.end(); return; }
      c.autenticada = true;
      responder({ protocolo });
      return;
    }
    try {
      switch (pedido.op) {
        case "ola": responder({ protocolo }); break;
        case "listar": responder({ sessoes: [...sessoes.values()].map(info) }); break;
        case "criar": criar(c, pedido); responder(); break;
        case "anexar": {
          const s = obter(pedido.id);
          s.anexados.add(c);
          if (c.pausadas.delete(s.id)) s.processo?.resume();
          responder({ info: info(s), fim: s.total });
          break;
        }
        case "soltar": {
          const s = sessoes.get(pedido.id);
          if (s !== undefined) { s.anexados.delete(c); if (c.pausadas.delete(s.id)) s.processo?.resume(); }
          responder();
          break;
        }
        case "historico": { const s = obter(pedido.id); responder({ dados: s.cauda.join(""), fim: s.total }); break; }
        case "escrever": obter(pedido.id).processo?.write(pedido.dados); responder(); break;
        case "redimensionar": obter(pedido.id).processo?.resize(pedido.colunas, pedido.linhas); responder(); break;
        case "pausar": { const s = obter(pedido.id); if (s.processo !== null) { c.pausadas.add(s.id); s.processo.pause(); } responder(); break; }
        case "retomar": { const s = obter(pedido.id); if (c.pausadas.delete(s.id)) s.processo?.resume(); responder(); break; }
        case "matar": { const s = obter(pedido.id); s.matar_pedido = true; s.processo?.kill(pedido.sinal); responder(); break; }
        case "descartar": { const s = sessoes.get(pedido.id); if (s !== undefined) descartar(s); responder(); break; }
        case "encerrar_tudo":
          for (const s of sessoes.values()) if (s.processo !== null) { s.matar_pedido = true; s.processo.kill(); }
          responder();
          setTimeout(() => { void encerrarDaemon(); }, 10).unref();
          break;
      }
    } catch (e) {
      falhar(e instanceof Error ? e.message : String(e));
    }
  };

  const servidor: Server = createServer((socket) => {
    const c: Conexao = { socket, resto: "", autenticada: false, pausadas: new Set() };
    conexoes.add(c);
    if (temporizadorOcioso !== null) { clearTimeout(temporizadorOcioso); temporizadorOcioso = null; }
    socket.setEncoding("utf8");
    socket.on("data", (pedaco: string) => {
      const { linhas, resto } = separarLinhas(c.resto, pedaco);
      c.resto = resto;
      for (const linha of linhas) {
        let pedido: PedidoNumerado;
        try { pedido = JSON.parse(linha) as PedidoNumerado; } catch { socket.destroy(); return; }
        tratar(c, pedido);
      }
    });
    socket.on("error", () => { /* fechamento abrupto do app: tratado no close */ });
    socket.on("close", () => { conexoes.delete(c); soltarConexao(c); avaliarOcioso(); });
  });

  if (process.platform !== "win32") {
    mkdirSync(dirname(op.socket), { recursive: true, mode: 0o700 });
    // socket de um daemon que morreu é lixo; socket de um daemon vivo não pode ser tomado
    if (existsSync(op.socket) && await responde(op.socket)) throw Object.assign(new Error("já existe um daemon neste socket"), { code: "EADDRINUSE" });
    rmSync(op.socket, { force: true });
  }
  await new Promise<void>((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(op.socket, () => resolver());
  });
  if (process.platform !== "win32") { try { chmodSync(op.socket, 0o600); } catch { /* o diretório do socket já é privado */ } }
  avaliarOcioso();
  // rede de segurança: conexão que morreu sem avisar não pode manter o daemon vivo para sempre
  const vigia = setInterval(() => {
    for (const c of [...conexoes]) if (c.socket.destroyed) { conexoes.delete(c); soltarConexao(c); }
    avaliarOcioso();
  }, Math.min(5_000, Math.max(20, ociosoMs)));
  vigia.unref();

  async function encerrarDaemon(): Promise<void> {
    if (fechado) return;
    await fechar();
    op.aoEncerrar?.();
  }

  async function fechar(): Promise<void> {
    if (fechado) return;
    fechado = true;
    clearInterval(vigia);
    if (temporizadorOcioso !== null) clearTimeout(temporizadorOcioso);
    for (const c of conexoes) c.socket.destroy();
    for (const s of sessoes.values()) s.log?.fechar();
    await new Promise<void>((resolver) => { servidor.close(() => resolver()); });
    if (process.platform !== "win32" && existsSync(op.socket)) rmSync(op.socket, { force: true });
  }

  return { fechar };
}

function responde(caminho: string): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = connect(caminho);
    socket.once("connect", () => { socket.destroy(); resolver(true); });
    socket.once("error", () => { socket.destroy(); resolver(false); });
  });
}
