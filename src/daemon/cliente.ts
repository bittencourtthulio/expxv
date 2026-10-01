// Cliente do daemon de PTY (AdaptadorPty remoto). Pedidos feitos antes da conexão ficam na fila, na
// ordem. Se o daemon não sobe (ou recusa token/protocolo), as sessões criadas nesse meio-tempo e as
// seguintes passam para a `reserva` (AdaptadorNodePty no próprio processo): a sessão nasce, só não
// sobrevive ao app.

import { connect, type Socket } from "node:net";
import type { AdaptadorPty, Descartavel, ExecutavelPty, OpcoesSpawn, ProcessoPty } from "../nucleo/terminais/lancamento";
import { PROTOCOLO_DAEMON, separarLinhas, type InfoSessaoDaemon, type MensagemDoDaemon, type Pedido } from "./protocolo";

export interface OpcoesCliente {
  socket: string;
  token: string;
  /** Sobe o daemon quando o socket não responde; sem isto só se conecta a um daemon que já existe. */
  iniciarDaemon?: () => void;
  /** Usado quando o daemon não está disponível: as sessões viram do próprio processo, como antes do daemon. */
  reserva?: AdaptadorPty;
  tentativas?: number;
  intervaloMs?: number;
  /** Religação quando um daemon JÁ conectado cai (AUD-09): tentativas com backoff exponencial. Padrão: 5 tentativas, 250 ms a 4 s. */
  religar?: { tentativas?: number; base_ms?: number; teto_ms?: number };
  /** Avisa as mudanças de estado (a UI/main mostra "reconectando…" e a falha final). */
  aoMudarEstado?: (estado: EstadoCliente) => void;
}

/** `reconectando`: o daemon caiu e o cliente tenta religar; as sessões ficam como estão até saber se ainda existem. */
export type EstadoCliente = "conectando" | "conectado" | "reconectando" | "falhou";

/** Teto de linhas guardadas enquanto o daemon não responde (conectando/reconectando). */
const LIMITE_FILA = 2_000;

type Pendente = { resolver: (r: Record<string, unknown>) => void; rejeitar: (e: Error) => void };
type SaidaPty = { exitCode: number; signal?: number | undefined };

class ProcessoRemoto implements ProcessoPty {
  pid = 0;
  readonly #dados = new Set<(dados: string, fim?: number) => void>();
  readonly #saidas = new Set<(e: SaidaPty) => void>();
  /** Operações feitas antes da conexão: se o daemon não sobe, são repetidas no processo da reserva. */
  readonly #operacoes: Array<(p: ProcessoPty) => void> = [];
  #real: ProcessoPty | null = null;
  #ligacoes: Descartavel[] = [];

  constructor(readonly id: string, readonly cliente: ClienteDaemon, readonly adotavel: boolean) {}

  onData(fn: (dados: string, fim?: number) => void): Descartavel { this.#dados.add(fn); return { dispose: () => { this.#dados.delete(fn); } }; }
  onExit(fn: (e: SaidaPty) => void): Descartavel { this.#saidas.add(fn); return { dispose: () => { this.#saidas.delete(fn); } }; }

  #agir(enviarAoDaemon: () => void, aoReal: (p: ProcessoPty) => void): void {
    if (this.#real !== null) { aoReal(this.#real); return; }
    if (this.adotavel && this.cliente.estado === "conectando") this.#operacoes.push(aoReal);
    enviarAoDaemon();
  }

  write(dados: string): void { this.#agir(() => this.cliente.enviarSemResposta({ op: "escrever", id: this.id, dados }), (p) => p.write(dados)); }
  resize(colunas: number, linhas: number): void { this.#agir(() => this.cliente.enviarSemResposta({ op: "redimensionar", id: this.id, colunas, linhas }), (p) => p.resize(colunas, linhas)); }
  pause(): void { this.#agir(() => this.cliente.enviarSemResposta({ op: "pausar", id: this.id }), (p) => p.pause()); }
  resume(): void { this.#agir(() => this.cliente.enviarSemResposta({ op: "retomar", id: this.id }), (p) => p.resume()); }
  kill(sinal?: string): void {
    this.#agir(() => this.cliente.enviarSemResposta(sinal === undefined ? { op: "matar", id: this.id } : { op: "matar", id: this.id, sinal }), (p) => p.kill(sinal));
  }

  emitirDados(dados: string, fim?: number): void { for (const fn of [...this.#dados]) fn(dados, fim); }
  emitirSaida(exitCode: number, signal?: number): void { for (const fn of [...this.#saidas]) fn({ exitCode, signal }); }

  /** O daemon não subiu: passa a falar com o processo da reserva, repetindo o que já foi pedido. */
  adotar(real: ProcessoPty): void {
    this.#real = real;
    this.pid = real.pid;
    this.#ligacoes = [
      real.onData((dados) => this.emitirDados(dados)),
      real.onExit((e) => this.emitirSaida(e.exitCode, e.signal)),
    ];
    for (const operacao of this.#operacoes.splice(0)) operacao(real);
  }

  soltarReal(): void { this.#ligacoes.splice(0).forEach((d) => d.dispose()); }
}

interface SpawnPendente { processo: ProcessoRemoto; executavel: ExecutavelPty; argumentos: string[]; opcoes: OpcoesSpawn }

export class ClienteDaemon implements AdaptadorPty {
  readonly pronto: Promise<boolean>;
  readonly #op: OpcoesCliente;
  readonly #procs = new Map<string, ProcessoRemoto>();
  readonly #pendentes = new Map<number, Pendente>();
  readonly #fila: string[] = [];
  readonly #criando: SpawnPendente[] = [];
  /** Até onde a saída de cada sessão já foi entregue (deslocamento do daemon): preenche o buraco de uma queda. */
  readonly #fims = new Map<string, number>();
  #socket: Socket | null = null;
  #estado: EstadoCliente = "conectando";
  #n = 0;
  #resto = "";
  #fechando = false;

  constructor(op: OpcoesCliente) {
    this.#op = op;
    this.pronto = this.#conectar();
  }

  get estado(): EstadoCliente { return this.#estado; }
  /** Deixa de ser persistente se o daemon cair: dali em diante as sessões novas são do próprio processo (reserva). */
  get persistente(): boolean { return this.#estado !== "falhou"; }

  spawn(executavel: ExecutavelPty, argumentos: readonly string[], opcoes: OpcoesSpawn): ProcessoPty {
    if (this.#estado === "falhou" && this.#op.reserva !== undefined) return this.#op.reserva.spawn(executavel, argumentos, opcoes);
    const id = opcoes.sessao_id;
    if (id === undefined || opcoes.meta === undefined) throw new Error("O daemon precisa do identificador e dos metadados da sessão.");
    const processo = new ProcessoRemoto(id, this, this.#op.reserva !== undefined);
    this.#procs.set(id, processo);
    if (this.#estado === "conectando" && this.#op.reserva !== undefined) this.#criando.push({ processo, executavel, argumentos: [...argumentos], opcoes });
    this.#transmitir({ op: "criar", id, executavel, argumentos: [...argumentos], cwd: opcoes.cwd, colunas: opcoes.colunas, linhas: opcoes.linhas, env: opcoes.env, meta: opcoes.meta })
      .then(() => { const i = this.#criando.findIndex((p) => p.processo === processo); if (i >= 0) this.#criando.splice(i, 1); })
      .catch(() => { /* o #falhar decide: reserva ou saída com erro */ });
    return processo;
  }

  async listar(): Promise<InfoSessaoDaemon[]> {
    // daemon indisponível NÃO é "nenhuma sessão": quem decide encerrar algo com base nisto (restaurar) precisa saber a diferença
    if (!await this.pronto) throw new Error("daemon indisponível");
    return (await this.#transmitir({ op: "listar" }))["sessoes"] as InfoSessaoDaemon[];
  }

  anexar(sessaoId: string): ProcessoPty {
    const processo = new ProcessoRemoto(sessaoId, this, false);
    this.#procs.set(sessaoId, processo);
    this.#transmitir({ op: "anexar", id: sessaoId }).catch(() => { this.#procs.delete(sessaoId); processo.emitirSaida(-1); });
    return processo;
  }

  async historico(sessaoId: string): Promise<{ dados: string; fim: number }> {
    const r = await this.#transmitir({ op: "historico", id: sessaoId });
    return { dados: String(r["dados"]), fim: Number(r["fim"]) };
  }

  soltar(sessaoId: string): void {
    this.#procs.delete(sessaoId);
    this.enviarSemResposta({ op: "soltar", id: sessaoId });
  }

  descartar(sessaoId: string): void {
    this.#procs.delete(sessaoId);
    this.enviarSemResposta({ op: "descartar", id: sessaoId });
  }

  /** Mata todos os processos e manda o daemon sair (menu "sair e encerrar"). */
  async encerrarTudo(): Promise<void> {
    if (!await this.pronto) return;
    await this.#transmitir({ op: "encerrar_tudo" }).catch(() => undefined);
  }

  async fechar(): Promise<void> {
    this.#fechando = true;
    // end() e não destroy(): o que já foi escrito (soltar, encerrar_tudo) precisa chegar ao daemon
    this.#socket?.end();
    this.#socket = null;
  }

  enviarSemResposta(pedido: Pedido): void {
    if (this.#estado === "falhou") return;
    this.#escrever(JSON.stringify(pedido));
  }

  #escrever(linha: string): void {
    if (this.#estado === "conectado" && this.#socket !== null) this.#socket.write(`${linha}\n`);
    else if (this.#estado === "conectando" || this.#estado === "reconectando") {
      if (this.#fila.length < LIMITE_FILA) this.#fila.push(linha);
    }
  }

  #transmitir(pedido: Pedido): Promise<Record<string, unknown>> {
    if (this.#estado === "falhou") return Promise.reject(new Error("daemon indisponível"));
    return new Promise((resolver, rejeitar) => {
      const n = ++this.#n;
      this.#pendentes.set(n, { resolver, rejeitar });
      this.#escrever(JSON.stringify({ ...pedido, n }));
    });
  }

  #mudar(estado: EstadoCliente): void {
    if (this.#estado === estado) return;
    this.#estado = estado;
    try { this.#op.aoMudarEstado?.(estado); } catch { /* observador não derruba a conexão */ }
  }

  async #conectar(): Promise<boolean> {
    const tentativas = this.#op.tentativas ?? 50;
    const intervalo = this.#op.intervaloMs ?? 100;
    let iniciou = false;
    let socket: Socket | null = null;
    for (let i = 0; i < tentativas && socket === null; i++) {
      socket = await tentarConectar(this.#op.socket);
      if (socket !== null) break;
      if (!iniciou && this.#op.iniciarDaemon !== undefined) { iniciou = true; try { this.#op.iniciarDaemon(); } catch { /* segue tentando: pode já haver um daemon subindo */ } }
      await new Promise((r) => setTimeout(r, intervalo));
    }
    if (socket === null) return this.#falhar();
    if (!await this.#apertarMao(socket)) return this.#falhar();
    this.#mudar("conectado");
    for (const linha of this.#fila.splice(0)) socket.write(`${linha}\n`);
    return true;
  }

  /** Liga os ouvintes e faz o `ola` com o token. Não muda o estado. */
  async #apertarMao(socket: Socket): Promise<boolean> {
    this.#resto = "";
    socket.setEncoding("utf8");
    socket.on("data", (pedaco: string) => { if (this.#socket === socket) this.#receber(pedaco); });
    socket.on("error", () => { /* o close cuida */ });
    socket.on("close", () => this.#aoFechar(socket));
    this.#socket = socket;
    const ola = new Promise<Record<string, unknown>>((resolver, rejeitar) => {
      const n = ++this.#n;
      this.#pendentes.set(n, { resolver, rejeitar });
      socket.write(`${JSON.stringify({ op: "ola", protocolo: PROTOCOLO_DAEMON, token: this.#op.token, n })}\n`);
    });
    try { await ola; return true; } catch { return false; }
  }

  #aoFechar(socket: Socket): void {
    if (this.#fechando || socket !== this.#socket) return;
    // daemon que já estava conectado e caiu: religa em vez de matar as sessões; antes disso (conectando), falha como sempre
    if (this.#estado === "conectado") void this.#religar();
    else if (this.#estado === "conectando") this.#falhar();
  }

  /**
   * AUD-09: o daemon caiu com o app aberto. Tenta religar (e subir um daemon novo, uma vez) com backoff e limite.
   * Religou: reanexa as sessões que ainda existem e só dá por mortas as que o daemon não conhece mais.
   */
  async #religar(): Promise<void> {
    const cfg = this.#op.religar ?? {};
    const tentativas = cfg.tentativas ?? 5;
    const base = cfg.base_ms ?? 250;
    const teto = cfg.teto_ms ?? 4_000;
    this.#socket?.destroy();
    this.#socket = null;
    for (const p of this.#pendentes.values()) p.rejeitar(new Error("daemon indisponível"));
    this.#pendentes.clear();
    this.#mudar("reconectando");
    let iniciou = false;
    for (let i = 0; i < tentativas && !this.#fechando; i++) {
      await new Promise<void>((r) => { const t = setTimeout(r, Math.min(teto, base * 2 ** i)); t.unref(); });
      if (this.#fechando) return;
      const socket = await tentarConectar(this.#op.socket);
      if (socket === null) {
        if (!iniciou && this.#op.iniciarDaemon !== undefined) { iniciou = true; try { this.#op.iniciarDaemon(); } catch { /* a próxima tentativa decide */ } }
        continue;
      }
      if (!await this.#apertarMao(socket)) { socket.destroy(); this.#socket = null; continue; }
      this.#mudar("conectado");
      await this.#reanexar();
      if (!this.#ligadoA(socket)) return; // caiu de novo durante a reanexação: o novo #religar cuida
      for (const linha of this.#fila.splice(0)) socket.write(`${linha}\n`);
      return;
    }
    if (!this.#fechando) this.#falhar();
  }

  #ligadoA(socket: Socket): boolean { return this.#estado === "conectado" && this.#socket === socket; }

  /** Reanexa cada sessão conhecida. Existe: preenche o que saiu durante a queda. Não existe mais: só então ela acabou. */
  async #reanexar(): Promise<void> {
    const ids = [...this.#procs.keys()];
    await Promise.all(ids.map(async (id) => {
      const processo = this.#procs.get(id);
      if (processo === undefined) return;
      try {
        const r = await this.#transmitir({ op: "anexar", id });
        const info = r["info"] as InfoSessaoDaemon | undefined;
        const fim = Number(r["fim"] ?? 0);
        const visto = this.#fims.get(id) ?? 0;
        if (fim > visto) {
          const h = await this.#transmitir({ op: "historico", id });
          const dados = String(h["dados"]);
          const perdido = Number(h["fim"]) - visto;
          if (perdido > 0) processo.emitirDados(dados.slice(Math.max(0, dados.length - perdido)), Number(h["fim"]));
        }
        if (info !== undefined && info.estado !== "executando") {
          this.#procs.delete(id);
          processo.emitirSaida(info.codigo ?? -1, info.sinal ?? undefined);
        }
      } catch {
        if (this.#estado !== "conectado") return; // a conexão caiu de novo: não é prova de que a sessão morreu
        this.#procs.delete(id);
        processo.emitirSaida(-1);
      }
    }));
  }

  #falhar(): false {
    const eraConectado = this.#estado === "conectado" || this.#estado === "reconectando";
    this.#mudar("falhou");
    this.#socket?.destroy();
    this.#socket = null;
    this.#fila.length = 0;
    for (const p of this.#pendentes.values()) p.rejeitar(new Error("daemon indisponível"));
    this.#pendentes.clear();
    // sessões que ainda esperavam o daemon nascem na reserva (não sobrevivem ao app, mas funcionam)
    const reserva = this.#op.reserva;
    for (const { processo, executavel, argumentos, opcoes } of this.#criando.splice(0)) {
      if (reserva === undefined || !this.#procs.has(processo.id)) continue;
      this.#procs.delete(processo.id);
      try { processo.adotar(reserva.spawn(executavel, argumentos, opcoes)); } catch { processo.emitirSaida(-1); }
    }
    // o daemon sumiu com as sessões dentro: o que estava anexado acabou
    if (eraConectado || this.#procs.size > 0) for (const p of [...this.#procs.values()]) p.emitirSaida(-1);
    this.#procs.clear();
    return false;
  }

  #receber(pedaco: string): void {
    const { linhas, resto } = separarLinhas(this.#resto, pedaco);
    this.#resto = resto;
    for (const linha of linhas) {
      let m: MensagemDoDaemon;
      try { m = JSON.parse(linha) as MensagemDoDaemon; } catch { continue; }
      if ("re" in m) {
        const pendente = this.#pendentes.get(m.re);
        this.#pendentes.delete(m.re);
        if (pendente === undefined) continue;
        if (m.ok) pendente.resolver(m); else pendente.rejeitar(new Error(m.erro));
      } else if (m.ev === "dados") {
        if (typeof m.fim === "number") this.#fims.set(m.id, m.fim);
        this.#procs.get(m.id)?.emitirDados(m.dados, m.fim);
      } else {
        const p = this.#procs.get(m.id);
        this.#procs.delete(m.id);
        this.#fims.delete(m.id);
        p?.emitirSaida(m.codigo ?? -1, m.sinal ?? undefined);
      }
    }
  }
}

function tentarConectar(caminho: string): Promise<Socket | null> {
  return new Promise((resolver) => {
    const socket = connect(caminho);
    socket.once("connect", () => { socket.removeAllListeners("error"); resolver(socket); });
    socket.once("error", () => { socket.destroy(); resolver(null); });
  });
}
