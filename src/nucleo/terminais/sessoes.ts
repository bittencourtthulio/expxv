// Gerenciador de sessões de terminal (PTY). O cwd de cada sessão é decidido pelo main
// (`resolverCwd(workspace_id)`); o renderer nunca envia cwd. Lançamento por argv separado (nunca shell),
// backpressure (64 KB por evento; pausa acima de 256 KB pendentes; retoma abaixo de 128 KB),
// sanitização de OSC, sequência monotônica por sessão e recuperação de sessões do daemon.

import { randomUUID } from "node:crypto";
import {
  LIMITES_TERMINAIS,
  type AtividadeTerminal,
  type EstadoSessao,
  type EventoTerminal,
  type MetadadosSessao,
  type RespostaAbrirSessao,
  type PedidoAbrirSessao,
} from "../../compartilhado/terminais";
import type { InfoSessaoDaemon } from "../../daemon/protocolo";
import { ambienteSeguro, combinarAmbiente } from "./ambiente";
import { validarPedidoAbrirSessao } from "./ipc-validadores";
import type { AdaptadorPty, Descartavel, ExecutavelPty, ProcessoPty } from "./lancamento";
import { SanitizadorOsc } from "./osc";

export type { AdaptadorPty, Descartavel, ExecutavelPty, ProcessoPty } from "./lancamento";

/** Pedaço máximo de saída por evento. */
export const PEDACO_SAIDA_BYTES = 64 * 1_024;
/** Acima disto pendente de confirmação o PTY é pausado. */
export const PAUSA_ACIMA_BYTES = 256 * 1_024;
/** Abaixo disto o PTY volta a correr. */
export const RETOMA_ABAIXO_BYTES = 128 * 1_024;

const ESPERA_ENCERRAR_MS = 3_000;

/** Encerramento limpo pedido pelo app (D-520): SIGINT, espera; SIGTERM, espera; SIGKILL. Nenhuma CLI fica órfã no daemon. */
export interface PrazosDeEncerramento { sigint_ms: number; sigterm_ms: number; sigkill_ms: number }
export const PRAZOS_ENCERRAMENTO: PrazosDeEncerramento = { sigint_ms: 800, sigterm_ms: 2_000, sigkill_ms: 1_000 };

export interface RegistroDeExecutaveis { obter(id: string): ExecutavelPty | undefined }

/** O que a sessão precisa saber de cada ferramenta (o catálogo real é injetado pelo main). */
export interface CatalogoSessoes {
  /** Só se o workspace permitir (D-14); o catálogo decide. */
  argumentosAutomaticos(ferramenta_id: string, workspace_id: string | null): readonly string[];
  argumentosDeRetomada(ferramenta_id: string, conversa_id: string): string[] | null;
  argumentosDePromptInicial(ferramenta_id: string, prompt: string): string[] | null;
  teclaDeInterrupcao(ferramenta_id: string): string;
}

// grok fica de fora de propósito: o Esc dele não cancela o turno (só Ctrl+C).
const INTERROMPEM_COM_ESC = ["claude", "codex", "gemini", "opencode", "qwen", "kilo"];

/** Padrão neutro: nada automático, sem retomada nem prompt inicial; ESC nas CLIs de IA, Ctrl+C no resto. */
export const CATALOGO_NEUTRO: CatalogoSessoes = {
  argumentosAutomaticos: () => [],
  argumentosDeRetomada: () => null,
  argumentosDePromptInicial: () => null,
  teclaDeInterrupcao: (id) => (INTERROMPEM_COM_ESC.includes(id) ? "\x1b" : "\x03"),
};

/** Quem observa as sessões por fora (sinaleira/hooks): dá argumentos e ambiente extras e é avisado do fim. */
export interface ObservadorSessoes {
  observar(ferramenta_id: string, sessao_id: string, workspace_id: string | null): { argumentos: string[]; ambiente: Record<string, string> };
  encerrada(sessao_id: string): void;
}

type EventoSemEnvelope = EventoTerminal extends infer E
  ? E extends unknown ? Omit<E, "versao" | "sequencia" | "sessao_id"> : never
  : never;
export type EventoEmitivel = EventoSemEnvelope;

interface SessaoInterna {
  id: string;
  ferramenta_id: string;
  executavel_id: string;
  workspace_id: string | null;
  cwd: string;
  estado: EstadoSessao;
  processo: ProcessoPty;
  sequencia: number;
  descartaveis: Descartavel[];
  encerramento_solicitado: boolean;
  bytes_pendentes: number;
  saida_pausada: boolean;
  osc: SanitizadorOsc;
  /** Enquanto o histórico é lido do daemon, a saída ao vivo espera aqui para sair depois dele, na ordem. */
  retido: Array<{ dados: string; fim: number | undefined }> | null;
  tamanho_retido: number;
  atividade: AtividadeTerminal | null;
  criada_em: number | null;
  quantidade_argumentos: number;
}

/** Sessão que sobreviveu ao app: o que a interface precisa para remontar a aba (a saída vai por eventos). */
export interface SessaoRecuperada extends MetadadosSessao {
  executavel_id: string;
  argumentos: string[];
  colunas: number;
  linhas: number;
}

export interface InfoDiagnosticoSessao {
  sessao_id: string;
  ferramenta_id: string;
  estado: EstadoSessao;
  atividade: AtividadeTerminal | null;
  pid: number;
  criada_em: number | null;
  quantidade_argumentos: number;
}

export interface SessaoPublica {
  sessao_id: string;
  ferramenta_id: string;
  estado: EstadoSessao;
  geracao: number;
}

const PROCESSO_INERTE: ProcessoPty = {
  pid: 0,
  onData: () => ({ dispose: () => undefined }),
  onExit: () => ({ dispose: () => undefined }),
  write: () => undefined,
  resize: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  kill: () => undefined,
};

export interface OpcoesGerenciador {
  /** Decide o cwd a partir do workspace (null = atual); lança se o workspace não existe. */
  resolverCwd: (workspace_id: string | null) => string;
  janela_id: number;
  geracao: number;
  registro: RegistroDeExecutaveis;
  adaptador: AdaptadorPty;
  catalogo?: CatalogoSessoes;
  criar_id?: (sequencia: number) => string;
  observador?: ObservadorSessoes;
  /** Chamado quando uma sessão é descartada de vez (a conversa guardada sai junto). */
  ao_descartar?: (id: string) => void;
  /** Quais sessões do daemon esta janela adota ao recuperar (padrão: todas). */
  filtrar_recuperacao?: (info: InfoSessaoDaemon) => boolean;
  /** Limite de sessões ativas (padrão: LIMITES_TERMINAIS.sessoes_por_janela). Função = lido a cada `abrir` (config em voo). */
  limite_sessoes?: number | (() => number);
  /** Última palavra sobre o argv final (ex.: juntar dois `--settings`). Não pode lançar; `argv` é uma cópia. */
  ajustar_argumentos?: (ferramenta_id: string, argv: string[]) => string[];
}

const iso = (ms: number | null): string => new Date(ms ?? 0).toISOString();

export class GerenciadorSessoes {
  readonly #sessoes = new Map<string, SessaoInterna>();
  readonly #assinantes = new Set<(evento: EventoTerminal) => void>();
  readonly #janelaId: number;
  readonly #geracao: number;
  readonly #resolverCwd: (workspace_id: string | null) => string;
  readonly #registro: RegistroDeExecutaveis;
  readonly #adaptador: AdaptadorPty;
  readonly #catalogo: CatalogoSessoes;
  readonly #criarId: (sequencia: number) => string;
  readonly #observador: ObservadorSessoes | undefined;
  readonly #aoDescartar: ((id: string) => void) | undefined;
  readonly #filtrar: (info: InfoSessaoDaemon) => boolean;
  readonly #limite: () => number;
  readonly #ajustarArgv: ((ferramenta_id: string, argv: string[]) => string[]) | undefined;
  readonly #ouvintesTamanho = new Set<(id: string, colunas: number, linhas: number) => void>();
  /** quem espera o fim do processo de uma sessão (encerramento limpo com prazos) */
  readonly #esperandoSaida = new Map<string, Set<() => void>>();
  /** sessões que o app está fechando agora (idempotência de `fecharPelaApp`) */
  readonly #fechando = new Set<string>();
  #contador = 0;
  #admissao = true;
  #recuperacao: Promise<unknown> = Promise.resolve();

  constructor(opcoes: OpcoesGerenciador) {
    this.#resolverCwd = opcoes.resolverCwd;
    this.#janelaId = opcoes.janela_id;
    this.#geracao = opcoes.geracao;
    this.#registro = opcoes.registro;
    this.#adaptador = opcoes.adaptador;
    this.#catalogo = opcoes.catalogo ?? CATALOGO_NEUTRO;
    this.#observador = opcoes.observador;
    this.#aoDescartar = opcoes.ao_descartar;
    this.#filtrar = opcoes.filtrar_recuperacao ?? (() => true);
    const limite = opcoes.limite_sessoes ?? LIMITES_TERMINAIS.sessoes_por_janela;
    this.#limite = typeof limite === "function" ? limite : () => limite;
    this.#ajustarArgv = opcoes.ajustar_argumentos;
    this.#criarId = opcoes.criar_id ?? (() => `sessao_${randomUUID().replaceAll("-", "")}`);
  }

  get janela_id(): number { return this.#janelaId; }
  get geracao(): number { return this.#geracao; }
  /** Verdadeiro quando as sessões vivem no daemon e continuam depois que o app fecha. */
  get persistente(): boolean { return this.#adaptador.persistente === true; }
  get tem_sessoes_ativas(): boolean { return this.temAtivas() > 0; }

  assinar(assinante: (evento: EventoTerminal) => void): () => void {
    this.#assinantes.add(assinante);
    return () => this.#assinantes.delete(assinante);
  }

  /**
   * `opcoes` é só do main (nunca vem do renderer): `cwd` substitui o cwd do workspace (worktree da Missão) e
   * `ambiente` soma variáveis da conta (ex.: CLAUDE_CONFIG_DIR). Sem `opcoes` o comportamento é o de sempre.
   */
  abrir(pedidoBruto: unknown, opcoes?: { cwd?: string; ambiente?: Record<string, string>; permissao?: "seguro" | "equilibrado" | "automatico" }): RespostaAbrirSessao {
    if (!this.#admissao) throw new Error("As sessões estão sendo encerradas. Tente novamente depois.");
    const validacao = validarPedidoAbrirSessao(pedidoBruto);
    if (!validacao.ok) throw new Error(validacao.erro);
    if (this.temAtivas() >= this.#limite()) throw new Error("Limite de sessões por janela atingido.");
    const pedido: PedidoAbrirSessao = validacao.valor;
    const executavel = this.#registro.obter(pedido.executavel_id);
    if (executavel === undefined || executavel.ferramenta_id !== pedido.ferramenta_id) throw new Error("Executável desconhecido para esta janela.");
    let cwd: string;
    try { cwd = opcoes?.cwd ?? this.#resolverCwd(pedido.workspace_id); } catch { throw new Error("Workspace desconhecido."); }
    const retomada = pedido.retomar === undefined ? [] : this.#catalogo.argumentosDeRetomada(pedido.ferramenta_id, pedido.retomar);
    if (retomada === null) throw new Error("Esta ferramenta não retoma conversa.");
    const inicial = pedido.prompt_inicial === undefined ? [] : this.#catalogo.argumentosDePromptInicial(pedido.ferramenta_id, pedido.prompt_inicial);
    if (inicial === null) throw new Error("Esta ferramenta não aceita prompt inicial.");
    const id = this.#criarId(++this.#contador);
    let processo: ProcessoPty;
    try {
      const observacao = this.#observador?.observar(pedido.ferramenta_id, id, pedido.workspace_id) ?? { argumentos: [], ambiente: {} };
      // o prompt inicial sempre por último
      const bruto = [
        // permissão efetiva do Pane (agente de squad, D-232): só `automatico` herda a flag do workspace; mais restrita nunca a recebe
        ...(opcoes?.permissao !== undefined && opcoes.permissao !== "automatico" ? [] : this.#catalogo.argumentosAutomaticos(pedido.ferramenta_id, pedido.workspace_id)),
        ...observacao.argumentos, ...pedido.argumentos, ...retomada, ...inicial,
      ];
      const argv = this.#ajustarArgv === undefined ? bruto : this.#ajustarArgv(pedido.ferramenta_id, [...bruto]);
      processo = this.#adaptador.spawn(executavel, argv, {
        cwd,
        colunas: pedido.colunas,
        linhas: pedido.linhas,
        env: combinarAmbiente(combinarAmbiente(ambienteSeguro(executavel), opcoes?.ambiente ?? {}), observacao.ambiente),
        sessao_id: id,
        meta: {
          ferramenta_id: pedido.ferramenta_id, executavel_id: pedido.executavel_id, argumentos: pedido.argumentos,
          raiz: cwd, workspace_id: pedido.workspace_id, colunas: pedido.colunas, linhas: pedido.linhas, criada_em: Date.now(),
        },
      });
    } catch {
      this.#observador?.encerrada(id);
      throw new Error("Não foi possível iniciar o terminal.");
    }
    processo.pause();
    const sessao: SessaoInterna = {
      id, ferramenta_id: pedido.ferramenta_id, executavel_id: pedido.executavel_id, workspace_id: pedido.workspace_id, cwd,
      estado: "iniciando", processo, sequencia: 0, descartaveis: [], encerramento_solicitado: false, bytes_pendentes: 0,
      saida_pausada: false, osc: new SanitizadorOsc(), retido: null, tamanho_retido: 0, atividade: null,
      criada_em: Date.now(), quantidade_argumentos: pedido.argumentos.length,
    };
    this.#sessoes.set(id, sessao);
    this.#ligar(sessao);
    setImmediate(() => {
      if (sessao.encerramento_solicitado || sessao.estado !== "iniciando") return;
      sessao.estado = "executando";
      this.#emitir(sessao, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
      processo.resume();
    });
    return { versao: 1, sessao_id: id, estado: "iniciando" };
  }

  #ligar(sessao: SessaoInterna): void {
    const { id, processo } = sessao;
    sessao.descartaveis.push(
      processo.onData((dados, fim) => this.#aoReceber(sessao, dados, fim)),
      processo.onExit(({ exitCode, signal }) => {
        sessao.estado = exitCode === 0 || sessao.encerramento_solicitado ? "encerrada" : "erro";
        this.#emitir(sessao, { tipo: "encerramento", codigo: Number.isInteger(exitCode) ? exitCode : null, sinal: Number.isInteger(signal) ? signal! : null, ...(sessao.encerramento_solicitado ? { solicitado: true as const } : {}) });
        this.#emitir(sessao, {
          tipo: "estado", estado: sessao.estado,
          erro_codigo: sessao.estado === "erro" ? "processo_falhou" : null,
          mensagem: sessao.estado === "erro" ? "O terminal foi encerrado com erro." : null,
        });
        sessao.descartaveis.splice(0).forEach((d) => d.dispose());
        this.#observador?.encerrada(id);
        const esperando = this.#esperandoSaida.get(id);
        this.#esperandoSaida.delete(id);
        esperando?.forEach((f) => f());
      }),
    );
  }

  #aoReceber(sessao: SessaoInterna, dados: string, fim: number | undefined): void {
    if (sessao.retido === null) { this.#receberSaida(sessao, dados); return; }
    sessao.retido.push({ dados, fim });
    sessao.tamanho_retido += dados.length;
    while (sessao.tamanho_retido > LIMITES_TERMINAIS.buffer_saida_bytes && sessao.retido.length > 1) sessao.tamanho_retido -= (sessao.retido.shift() as { dados: string }).dados.length;
  }

  /**
   * Remonta as sessões que o daemon manteve vivas (ou que terminaram enquanto o app estava fechado) e
   * reproduz o histórico de cada uma como eventos de saída. A saída que chegou durante a leitura sai
   * depois do histórico, sem repetir o que ele já cobre (`fim`). Chamar de novo reproduz o histórico
   * outra vez (tela recriada) sem anexar de novo a sessão já adotada.
   */
  recuperar(): Promise<SessaoRecuperada[]> {
    const rodada = this.#recuperacao.then(() => this.#recuperar(), () => this.#recuperar());
    this.#recuperacao = rodada;
    return rodada;
  }

  async #recuperar(): Promise<SessaoRecuperada[]> {
    const adaptador = this.#adaptador;
    if (!this.#admissao || adaptador.listar === undefined || adaptador.anexar === undefined || adaptador.historico === undefined) return [];
    const infos = (await adaptador.listar()).filter(this.#filtrar);
    const recuperadas: SessaoRecuperada[] = [];
    for (const info of infos) {
      let sessao = this.#sessoes.get(info.sessao_id);
      if (sessao === undefined) {
        const viva = info.estado === "executando";
        sessao = {
          id: info.sessao_id, ferramenta_id: info.ferramenta_id, executavel_id: info.executavel_id,
          workspace_id: info.workspace_id ?? null, cwd: info.raiz,
          estado: viva ? "executando" : info.estado, processo: viva ? adaptador.anexar(info.sessao_id) : PROCESSO_INERTE,
          sequencia: 0, descartaveis: [], encerramento_solicitado: false, bytes_pendentes: 0, saida_pausada: false,
          osc: new SanitizadorOsc(), retido: null, tamanho_retido: 0, atividade: null,
          criada_em: info.criada_em ?? null, quantidade_argumentos: info.argumentos.length,
        };
        this.#sessoes.set(sessao.id, sessao);
        if (viva) this.#ligar(sessao);
      }
      sessao.retido = [];
      sessao.tamanho_retido = 0;
      try {
        const historico = await adaptador.historico(info.sessao_id);
        if (historico.dados !== "") this.#receberSaida(sessao, historico.dados);
        for (const pedaco of sessao.retido) if (pedaco.fim === undefined || pedaco.fim > historico.fim) this.#receberSaida(sessao, pedaco.dados);
      } finally {
        sessao.retido = null;
        sessao.tamanho_retido = 0;
      }
      recuperadas.push({
        ...this.#metadados(sessao), executavel_id: info.executavel_id, argumentos: info.argumentos, colunas: info.colunas, linhas: info.linhas,
      });
    }
    return recuperadas;
  }

  /**
   * Larga as sessões sem encerrá-las: o daemon as mantém vivas e o próximo contexto as recupera.
   * Sem daemon não há onde elas continuarem, então cai no encerramento.
   */
  desanexar(): void {
    if (!this.persistente) { this.encerrarTodas(); return; }
    this.#admissao = false;
    for (const sessao of this.#sessoes.values()) {
      sessao.descartaveis.splice(0).forEach((d) => d.dispose());
      this.#adaptador.soltar?.(sessao.id);
    }
    this.#sessoes.clear();
  }

  /** Fechar a aba de vez: encerra o processo se ainda vive e apaga a sessão (e o histórico) do daemon. */
  descartar(id: string): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) return false;
    this.encerrar(id);
    sessao.descartaveis.splice(0).forEach((d) => d.dispose());
    this.#observador?.encerrada(id);
    this.#adaptador.descartar?.(id);
    this.#sessoes.delete(id);
    this.#aoDescartar?.(id);
    return true;
  }

  /** Evento de domínio (atividade, conversa, subagente) no envelope da sessão: herda a ordem (`sequencia`) dela. */
  emitirEvento(id: string, evento: EventoEmitivel): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) return false;
    if (evento.tipo === "atividade") sessao.atividade = evento.atividade;
    this.#emitir(sessao, evento);
    return true;
  }

  obter(id: string): { sessao_id: string; ferramenta_id: string; executavel_id: string; estado: EstadoSessao; atividade: AtividadeTerminal | null; workspace_id: string | null; cwd: string } | undefined {
    const s = this.#sessoes.get(id);
    return s === undefined ? undefined : { sessao_id: s.id, ferramenta_id: s.ferramenta_id, executavel_id: s.executavel_id, estado: s.estado, atividade: s.atividade, workspace_id: s.workspace_id, cwd: s.cwd };
  }

  /** Tecla de interrupção da ferramenta (ESC nas CLIs de IA, Ctrl+C no shell); nunca encerra o processo. */
  interromper(id: string): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) throw new Error("Sessão desconhecida nesta janela.");
    if (sessao.estado !== "executando") return false;
    sessao.processo.write(this.#catalogo.teclaDeInterrupcao(sessao.ferramenta_id));
    return true;
  }

  diagnostico(): InfoDiagnosticoSessao[] {
    return [...this.#sessoes.values()].map((s) => ({
      sessao_id: s.id, ferramenta_id: s.ferramenta_id, estado: s.estado, atividade: s.atividade,
      pid: s.processo.pid, criada_em: s.criada_em, quantidade_argumentos: s.quantidade_argumentos,
    }));
  }

  /** Quem quer saber quando um terminal muda de tamanho. */
  observarTamanho(fn: (id: string, colunas: number, linhas: number) => void): () => void {
    this.#ouvintesTamanho.add(fn);
    return () => this.#ouvintesTamanho.delete(fn);
  }

  listar(): SessaoPublica[] {
    return [...this.#sessoes.values()].map((s) => ({ sessao_id: s.id, ferramenta_id: s.ferramenta_id, estado: s.estado, geracao: this.#geracao }));
  }

  /** `terminais:listar_sessoes`. */
  listarMetadados(): MetadadosSessao[] {
    return [...this.#sessoes.values()].map((s) => this.#metadados(s));
  }

  #metadados(s: SessaoInterna): MetadadosSessao {
    return { sessao_id: s.id, ferramenta_id: s.ferramenta_id as MetadadosSessao["ferramenta_id"], estado: s.estado, workspace_id: s.workspace_id, criada_em: iso(s.criada_em), persistente: this.persistente };
  }

  escrever(id: string, dados: string): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) throw new Error("Sessão desconhecida nesta janela.");
    if (sessao.estado !== "executando") return false;
    if (Buffer.byteLength(dados) > LIMITES_TERMINAIS.entrada_bytes || dados.includes("\0")) throw new Error("Entrada de terminal inválida ou excessiva.");
    sessao.processo.write(dados);
    return true;
  }

  redimensionar(id: string, colunas: number, linhas: number): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) throw new Error("Sessão desconhecida nesta janela.");
    if (sessao.estado !== "executando") return false;
    if (!Number.isInteger(colunas) || colunas < LIMITES_TERMINAIS.colunas_min || colunas > LIMITES_TERMINAIS.colunas_max || !Number.isInteger(linhas) || linhas < LIMITES_TERMINAIS.linhas_min || linhas > LIMITES_TERMINAIS.linhas_max) throw new Error("Dimensões de terminal inválidas.");
    sessao.processo.resize(colunas, linhas);
    this.#ouvintesTamanho.forEach((fn) => fn(id, colunas, linhas));
    return true;
  }

  encerrar(id: string): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) return false;
    if (sessao.estado === "encerrada" || sessao.estado === "erro" || sessao.encerramento_solicitado) return true;
    sessao.encerramento_solicitado = true;
    sessao.processo.kill();
    return true;
  }

  /**
   * D-520: o app fecha a sessão de propósito (orquestrador, dono ou fim do trabalho do worker). O renderer é avisado ANTES (`fechada`: o painel sai da grade na hora, sem
   * "Sessão encerrada" pendurada) e o processo termina com SIGINT → SIGTERM → SIGKILL em prazos curtos; só então a sessão é descartada (histórico do daemon incluído).
   * O fim do processo sai marcado como `solicitado`: o 143 não é falha. Idempotente. `false` = sessão desconhecida.
   */
  fecharPelaApp(id: string, prazos: Partial<PrazosDeEncerramento> = {}): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) return false;
    if (this.#fechando.has(id)) return true;
    this.#fechando.add(id);
    this.#emitir(sessao, { tipo: "fechada" });
    void this.#encerrarComPrazos(sessao, { ...PRAZOS_ENCERRAMENTO, ...prazos }).then(() => {
      this.#fechando.delete(id);
      this.descartar(id);
    });
    return true;
  }

  async #encerrarComPrazos(sessao: SessaoInterna, p: PrazosDeEncerramento): Promise<void> {
    if (sessao.estado === "encerrada" || sessao.estado === "erro") return;
    sessao.encerramento_solicitado = true;
    const terminou = (): boolean => (sessao.estado as EstadoSessao) === "encerrada" || (sessao.estado as EstadoSessao) === "erro";
    const esperar = (ms: number): Promise<void> => new Promise<void>((resolver) => {
      if (terminou()) { resolver(); return; }
      const esperando = this.#esperandoSaida.get(sessao.id) ?? new Set<() => void>();
      this.#esperandoSaida.set(sessao.id, esperando);
      const t = setTimeout(() => { esperando.delete(feito); resolver(); }, ms);
      t.unref();
      const feito = (): void => { clearTimeout(t); resolver(); };
      esperando.add(feito);
    });
    for (const [sinal, prazo] of [["SIGINT", p.sigint_ms], ["SIGTERM", p.sigterm_ms], ["SIGKILL", p.sigkill_ms]] as const) {
      try { sessao.processo.kill(sinal); } catch { /* o processo já saiu */ }
      await esperar(prazo);
      if (terminou()) return;
    }
  }

  /** Última etapa de "parar" da execução do projeto: SIGKILL na árvore (SIGINT e SIGTERM já foram tentados por quem chama). */
  forcarEncerramento(id: string): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined) return false;
    if (sessao.estado === "encerrada" || sessao.estado === "erro") return true;
    sessao.encerramento_solicitado = true;
    sessao.processo.kill("SIGKILL");
    return true;
  }

  /** O renderer confirma o que o xterm já processou; libera o PTY pausado por backpressure. */
  confirmarConsumo(id: string, bytes: number): boolean {
    const sessao = this.#sessoes.get(id);
    if (sessao === undefined || !Number.isFinite(bytes) || bytes < 0) return false;
    sessao.bytes_pendentes = Math.max(0, sessao.bytes_pendentes - Math.floor(bytes));
    if (sessao.saida_pausada && sessao.bytes_pendentes < RETOMA_ABAIXO_BYTES && sessao.estado === "executando") {
      sessao.saida_pausada = false;
      sessao.processo.resume();
    }
    return true;
  }

  bloquearAdmissao(): void { this.#admissao = false; }
  liberarAdmissao(): void { this.#admissao = true; }
  encerrarTodas(): void {
    this.#admissao = false;
    [...this.#sessoes].forEach(([id]) => this.encerrar(id));
  }

  async encerrarTodasEAguardar(): Promise<void> {
    this.encerrarTodas();
    if (!this.tem_sessoes_ativas) return;
    await new Promise<void>((resolve) => {
      const inicio = Date.now();
      const verificar = (): void => {
        if (!this.tem_sessoes_ativas) resolve();
        else if (Date.now() - inicio >= ESPERA_ENCERRAR_MS) {
          [...this.#sessoes.values()]
            .filter((s) => s.estado === "iniciando" || s.estado === "executando")
            .forEach((s) => s.processo.kill("SIGKILL"));
          resolve();
        } else setTimeout(verificar, 10);
      };
      verificar();
    });
  }

  temAtivas(): number {
    return [...this.#sessoes.values()].filter((s) => s.estado === "iniciando" || s.estado === "executando").length;
  }

  #receberSaida(sessao: SessaoInterna, entrada: string): void {
    const limpa = sessao.osc.processar(entrada);
    for (let inicio = 0; inicio < limpa.length;) {
      let fim = Math.min(limpa.length, inicio + PEDACO_SAIDA_BYTES);
      // não parte um par substituto (emoji) entre dois eventos
      if (fim < limpa.length && limpa.charCodeAt(fim - 1) >= 0xd800 && limpa.charCodeAt(fim - 1) <= 0xdbff) fim -= 1;
      const dados = limpa.slice(inicio, fim);
      inicio = fim;
      sessao.bytes_pendentes += Buffer.byteLength(dados);
      this.#emitir(sessao, { tipo: "saida", dados });
    }
    if (!sessao.saida_pausada && sessao.bytes_pendentes > PAUSA_ACIMA_BYTES) {
      sessao.saida_pausada = true;
      sessao.processo.pause();
    }
  }

  #emitir(sessao: SessaoInterna, dados: EventoSemEnvelope): void {
    const evento = { versao: 1, sequencia: ++sessao.sequencia, sessao_id: sessao.id, ...dados } as EventoTerminal;
    this.#assinantes.forEach((fn) => fn(evento));
  }
}
