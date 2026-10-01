import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, normalize } from "node:path";
import type { AtividadeTerminal, EventoTerminal, LinhaSubagente } from "../../../compartilhado/terminais";
import type { AdaptadorAtividade, ObservacaoSessao } from "./contrato";
import { adaptadorClaude } from "./adaptadores/claude";
import { adaptadorCodex } from "./adaptadores/codex";
import { adaptadorOpenCode } from "./adaptadores/opencode";
import { SeguidorArquivo } from "./seguidor";

export type { ObservacaoSessao };

/** Um adaptador por CLI; é a única lista a editar para o app passar a observar outra ferramenta. */
export const ADAPTADORES_ATIVIDADE: readonly AdaptadorAtividade[] = [adaptadorClaude, adaptadorCodex, adaptadorOpenCode];

type SemEnvelope<T> = T extends unknown ? Omit<T, "versao" | "sequencia" | "sessao_id"> : never;
/** Evento de terminal sem o envelope (`versao`, `sequencia`, `sessao_id`): o gerenciador de sessões completa. */
export type EventoAtividadeParcial = SemEnvelope<Extract<EventoTerminal, { tipo: "atividade" | "conversa" | "subagente_iniciado" | "subagente_saida" | "subagente_concluido" }>>;

const LIMITE_CORPO = 1024 * 1024;
const LIMITE_LINHAS_POR_ENVIO = 300;

interface Subagente { rotulo: string; arquivo: string | null; seguidor: SeguidorArquivo | null; deslocamento: number; ativo: boolean; entregou: boolean }
interface SessaoObservada { token: string; adaptador: AdaptadorAtividade; subagentes: Map<string, Subagente>; atividade: AtividadeTerminal | null; conversa: string | null }

function tokenIgual(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface OpcoesServicoAtividade {
  /** Pasta de trabalho do app onde ficam os arquivos de apoio por sessão (hooks, plugins). */
  diretorio: string;
  emitir: (sessaoId: string, evento: EventoAtividadeParcial) => void;
  adaptadores?: readonly AdaptadorAtividade[];
  intervalo_ms?: number;
  /** Quando presente, sessões com hook saem da heurística de ociosidade (o hook é exato). */
  heuristica?: HeuristicaOciosidade;
}

/**
 * Recebe os avisos das CLIs (um endpoint local por sessão, com token) e os transforma em eventos de terminal:
 * `atividade`, `conversa` e subagentes. Só escuta 127.0.0.1; o token vive só em memória, na sessão que o recebeu
 * (o arquivo de hook que o leva é apagado junto com a sessão). Sem token válido: 401.
 */
export class ServicoAtividade {
  readonly #adaptadores: Map<string, AdaptadorAtividade>;
  readonly #diretorio: string;
  readonly #emitir: OpcoesServicoAtividade["emitir"];
  readonly #intervalo: number | undefined;
  readonly #heuristica: HeuristicaOciosidade | undefined;
  readonly #sessoes = new Map<string, SessaoObservada>();
  #servidor: Server | null = null;
  #porta = 0;

  constructor(opcoes: OpcoesServicoAtividade) {
    this.#adaptadores = new Map((opcoes.adaptadores ?? ADAPTADORES_ATIVIDADE).map((a) => [a.ferramenta_id, a]));
    this.#diretorio = opcoes.diretorio;
    this.#emitir = opcoes.emitir;
    this.#intervalo = opcoes.intervalo_ms;
    this.#heuristica = opcoes.heuristica;
  }

  get porta(): number { return this.#porta; }

  async iniciar(): Promise<void> {
    if (this.#servidor !== null) return;
    const servidor = createServer((pedido, resposta) => {
      const partes = (pedido.url ?? "").split("?")[0]!.split("/");
      if (partes[1] !== "atividade" || partes.length !== 4) { resposta.writeHead(404).end(); return; }
      const sessaoId = partes[2] ?? "";
      const sessao = this.#sessoes.get(sessaoId);
      if (sessao === undefined || !tokenIgual(sessao.token, partes[3] ?? "")) { resposta.writeHead(401).end(); return; }
      if (pedido.method !== "POST") { resposta.writeHead(405, { allow: "POST" }).end(); return; }
      const declarado = Number(pedido.headers["content-length"] ?? 0);
      if (declarado > LIMITE_CORPO) { resposta.writeHead(413, { connection: "close" }).end(); return; }
      const blocos: Buffer[] = [];
      let total = 0;
      let estourou = false;
      pedido.on("data", (bloco: Buffer) => {
        total += bloco.length;
        if (total > LIMITE_CORPO) {
          if (!estourou) { estourou = true; blocos.length = 0; resposta.writeHead(413, { connection: "close" }).end(); }
          return;
        }
        blocos.push(bloco);
      });
      pedido.on("end", () => {
        if (estourou) return;
        resposta.writeHead(200, { "content-type": "application/json", "content-length": 2 }).end("{}"); // responde já (a CLI espera) e com JSON válido: hooks do Codex exigem
        let corpo: unknown;
        try { corpo = JSON.parse(Buffer.concat(blocos).toString("utf8")); } catch { return; }
        void this.receber(sessaoId, corpo);
      });
    });
    await new Promise<void>((resolve, reject) => { servidor.once("error", reject); servidor.listen(0, "127.0.0.1", () => resolve()); });
    this.#servidor = servidor;
    this.#porta = (servidor.address() as AddressInfo).port;
  }

  /** Argumentos e ambiente extras para a sessão avisar o serviço; vazios quando a ferramenta não tem adaptador ou o servidor não subiu. */
  observacaoPara(ferramentaId: string, sessaoId: string, permissao: "seguro" | "automatico" = "seguro"): ObservacaoSessao {
    const vazia: ObservacaoSessao = { argumentos: [], ambiente: {} };
    const adaptador = this.#adaptadores.get(ferramentaId);
    if (adaptador === undefined || this.#servidor === null) return vazia;
    const observada: SessaoObservada = { token: randomBytes(24).toString("hex"), adaptador, subagentes: new Map(), atividade: null, conversa: null };
    this.#sessoes.set(sessaoId, observada);
    const pastaDaSessao = join(this.#diretorio, sessaoId);
    const alvo = {
      url: `http://127.0.0.1:${this.#porta}/atividade/${sessaoId}/${observada.token}`,
      sessao_id: sessaoId,
      permissao,
      gravarArquivo: (nome: string, conteudo: string): string => {
        const caminho = join(pastaDaSessao, normalize(nome));
        if (!caminho.startsWith(`${pastaDaSessao}/`) && !caminho.startsWith(`${pastaDaSessao}\\`)) throw new Error("nome de arquivo fora da pasta da sessão");
        mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 });
        writeFileSync(caminho, conteudo, { mode: 0o600 });
        return caminho;
      },
    };
    try {
      const resultado = { argumentos: adaptador.argumentosDeObservacao(alvo), ambiente: adaptador.ambienteDeObservacao?.(alvo) ?? {} };
      if (resultado.argumentos.length === 0 && Object.keys(resultado.ambiente).length === 0) {
        // o adaptador não observa esta sessão (ex.: Codex em workspace seguro): sem hook, vale a heurística de ociosidade
        this.encerrarSessao(sessaoId);
        return vazia;
      }
      this.#heuristica?.usarHook(sessaoId);
      return resultado;
    } catch {
      this.encerrarSessao(sessaoId);
      return vazia; // observar é acessório: falhar aqui nunca impede a sessão de abrir
    }
  }

  argumentosPara(ferramentaId: string, sessaoId: string, permissao: "seguro" | "automatico" = "seguro"): string[] { return this.observacaoPara(ferramentaId, sessaoId, permissao).argumentos; }

  /** Processa um aviso já validado pelo endpoint. Exposto para teste e para adaptadores que não usem HTTP. */
  async receber(sessaoId: string, corpo: unknown): Promise<void> {
    const sessao = this.#sessoes.get(sessaoId);
    if (sessao === undefined) return;
    const conversa = sessao.adaptador.conversaDoHook?.(corpo) ?? null;
    if (conversa !== null && conversa !== sessao.conversa) {
      sessao.conversa = conversa;
      this.#emitir(sessaoId, { tipo: "conversa", conversa_id: conversa });
    }
    const atividade = sessao.adaptador.interpretarAtividade?.(corpo) ?? null;
    if (atividade !== null && atividade !== sessao.atividade) {
      sessao.atividade = atividade;
      this.#emitir(sessaoId, { tipo: "atividade", atividade });
    }
    const sinal = sessao.adaptador.interpretar(corpo);
    if (sinal === null) return;
    const atual = sessao.subagentes.get(sinal.subagente_id);
    if (sinal.tipo === "atividade") {
      // os avisos de início e de atividade chegam por processos independentes e podem se inverter: a atividade também anuncia
      if (atual === undefined) {
        sessao.subagentes.set(sinal.subagente_id, { rotulo: sinal.rotulo, arquivo: null, seguidor: null, deslocamento: 0, ativo: true, entregou: false });
        this.#emitir(sessaoId, { tipo: "subagente_iniciado", subagente_id: sinal.subagente_id, rotulo: sinal.rotulo, descricao: null });
      }
      if (sinal.linhas.length > 0) {
        const subagente = sessao.subagentes.get(sinal.subagente_id);
        if (subagente !== undefined) subagente.entregou = true;
        this.#emitir(sessaoId, { tipo: "subagente_saida", subagente_id: sinal.subagente_id, linhas: sinal.linhas });
      }
      return;
    }
    if (sinal.tipo === "iniciado") {
      if (atual?.ativo === true) return; // aviso de início repetido (retomada em andamento)
      const subagente: Subagente = atual ?? { rotulo: sinal.rotulo, arquivo: sinal.arquivo, seguidor: null, deslocamento: 0, ativo: false, entregou: false };
      subagente.ativo = true;
      sessao.subagentes.set(sinal.subagente_id, subagente);
      this.#emitir(sessaoId, { tipo: "subagente_iniciado", subagente_id: sinal.subagente_id, rotulo: subagente.rotulo, descricao: sinal.descricao });
      const arquivo = subagente.arquivo ?? sinal.arquivo;
      if (arquivo !== null) {
        subagente.arquivo = arquivo;
        subagente.seguidor = new SeguidorArquivo({
          arquivo,
          deslocamento: subagente.deslocamento,
          ...(this.#intervalo === undefined ? {} : { intervalo_ms: this.#intervalo }),
          aoLinhas: (linhas) => this.#entregar(sessaoId, sessao, sinal.subagente_id, linhas),
        });
        subagente.seguidor.iniciar();
      }
      return;
    }
    if (atual === undefined || !atual.ativo) return; // fim de agente interno da CLI que nunca foi anunciado
    atual.ativo = false;
    if (atual.seguidor === null && sinal.arquivo !== null) {
      const seguidor = new SeguidorArquivo({ arquivo: sinal.arquivo, deslocamento: atual.deslocamento, aoLinhas: (linhas) => this.#entregar(sessaoId, sessao, sinal.subagente_id, linhas) });
      await seguidor.parar();
      atual.deslocamento = seguidor.deslocamento;
    } else if (atual.seguidor !== null) {
      await atual.seguidor.parar();
      atual.deslocamento = atual.seguidor.deslocamento;
      atual.seguidor = null;
    }
    // sem transcript legível (a CLI não o gravou), o resumo final ainda mostra o que o subagente concluiu
    if (!atual.entregou && sinal.resumo !== null) this.#emitir(sessaoId, { tipo: "subagente_saida", subagente_id: sinal.subagente_id, linhas: [{ papel: "texto", texto: sinal.resumo }] });
    this.#emitir(sessaoId, { tipo: "subagente_concluido", subagente_id: sinal.subagente_id });
  }

  /** A sessão acabou: para de seguir, apaga os arquivos de apoio e invalida o token. */
  encerrarSessao(sessaoId: string): void {
    this.#heuristica?.remover(sessaoId);
    const sessao = this.#sessoes.get(sessaoId);
    if (sessao === undefined) return;
    this.#sessoes.delete(sessaoId);
    for (const subagente of sessao.subagentes.values()) void subagente.seguidor?.parar();
    rmSync(join(this.#diretorio, sessaoId), { recursive: true, force: true });
  }

  async fechar(): Promise<void> {
    [...this.#sessoes.keys()].forEach((id) => this.encerrarSessao(id));
    const servidor = this.#servidor;
    this.#servidor = null;
    if (servidor !== null) await new Promise<void>((resolve) => { servidor.close(() => resolve()); servidor.closeAllConnections(); });
  }

  #entregar(sessaoId: string, sessao: SessaoObservada, subagenteId: string, brutas: string[]): void {
    if (this.#sessoes.get(sessaoId) !== sessao) return;
    const linhas: LinhaSubagente[] = brutas.flatMap((linha) => sessao.adaptador.analisarLinha(linha));
    if (linhas.length === 0) return;
    const subagente = sessao.subagentes.get(subagenteId);
    if (subagente !== undefined) subagente.entregou = true;
    // transcript longo (retomada): a UI só precisa do fim, e o IPC não deve carregar megabytes de uma vez
    this.#emitir(sessaoId, { tipo: "subagente_saida", subagente_id: subagenteId, linhas: linhas.slice(-LIMITE_LINHAS_POR_ENVIO) });
  }
}

// ---------------------------------------------------------------- ociosidade (sem hook)

export interface OpcoesHeuristica {
  /** Silêncio da saída que separa "trabalhando" de "pronto". */
  ocioso_ms?: number;
  agora?: () => number;
  /** `estimada` é sempre true: a UI deve marcar o estado como aproximado (sem hook não há certeza). */
  emitir: (sessaoId: string, atividade: AtividadeTerminal, estimada: true) => void;
}

interface EstadoOciosidade { ultimaSaida: number; atividade: AtividadeTerminal | null }

/**
 * Sinaleira aproximada para CLIs sem hook: saída recente = trabalhando; silêncio prolongado = pronto.
 * Nunca distingue "aguardando" (precisa de hook). Sessões com hook são ignoradas: o hook é exato.
 */
export class HeuristicaOciosidade {
  readonly #ocioso: number;
  readonly #agora: () => number;
  readonly #emitir: OpcoesHeuristica["emitir"];
  readonly #sessoes = new Map<string, EstadoOciosidade>();
  readonly #comHook = new Set<string>();
  #relogio: NodeJS.Timeout | null = null;

  constructor(opcoes: OpcoesHeuristica) {
    this.#ocioso = opcoes.ocioso_ms ?? 4_000;
    this.#agora = opcoes.agora ?? Date.now;
    this.#emitir = opcoes.emitir;
  }

  usarHook(sessaoId: string): void { this.#comHook.add(sessaoId); this.#sessoes.delete(sessaoId); }

  remover(sessaoId: string): void { this.#comHook.delete(sessaoId); this.#sessoes.delete(sessaoId); }

  registrarSaida(sessaoId: string): void {
    if (this.#comHook.has(sessaoId)) return;
    const estado = this.#sessoes.get(sessaoId) ?? { ultimaSaida: 0, atividade: null };
    estado.ultimaSaida = this.#agora();
    this.#sessoes.set(sessaoId, estado);
    if (estado.atividade !== "trabalhando") { estado.atividade = "trabalhando"; this.#emitir(sessaoId, "trabalhando", true); }
  }

  verificar(): void {
    const agora = this.#agora();
    for (const [id, estado] of this.#sessoes) {
      if (estado.atividade === "trabalhando" && agora - estado.ultimaSaida >= this.#ocioso) {
        estado.atividade = "pronto";
        this.#emitir(id, "pronto", true);
      }
    }
  }

  iniciar(intervalo_ms = 1_000): void {
    if (this.#relogio !== null) return;
    this.#relogio = setInterval(() => this.verificar(), intervalo_ms);
    this.#relogio.unref();
  }

  parar(): void {
    if (this.#relogio !== null) { clearInterval(this.#relogio); this.#relogio = null; }
  }
}
