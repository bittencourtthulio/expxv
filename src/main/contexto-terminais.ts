// Cola dos terminais no main: junta detecção, daemon, sessões, sinaleira, conversas e o envio em lote
// ao renderer. Nada aqui começa sozinho: criar o contexto e registrar os canais não abre socket, não
// varre disco nem lança processo. Tudo que é pesado vive em `servicosOnda2()`, que o boot só dispara
// DEPOIS de a janela estar aberta (P-01), cada serviço com erro isolado (`executarBoot`).

import { join } from "node:path";
import type { CanaisEvento } from "../compartilhado/ipc";
import type { EventoTerminal, FerramentaDetectada } from "../compartilhado/terminais";
import { AdaptadorNodePty } from "../nucleo/terminais/adaptador-node-pty";
import type { PermissaoWorkspace } from "../nucleo/terminais/catalogo";
import { criarArmazemConversas, type ArmazemConversas } from "../nucleo/terminais/conversas";
import { DetectorFerramentas, resolverPathDoShellDeLogin } from "../nucleo/terminais/deteccao";
import { GuardiaoTransicoes } from "../nucleo/terminais/guardiao";
import { criarArmazemLayout } from "../nucleo/terminais/layout";
import { HeuristicaOciosidade, ServicoAtividade, type EventoAtividadeParcial, type ObservacaoSessao, type OpcoesServicoAtividade } from "../nucleo/terminais/atividade/servico";
import { GerenciadorSessoes, type AdaptadorPty } from "../nucleo/terminais/sessoes";
import { ajustarArgumentosDasSessoes } from "../nucleo/terminais/settings-claude";
import { PRODUTO } from "../nucleo/produto";
import type { ServicosSecundarios } from "./boot";
import { criarServicoDaemon, type ServicoDaemon } from "./daemon";
import { criarLoteSaida, type LoteSaida } from "./ipc/lote-saida";
import type { RegistroIpc } from "./ipc/registro";
import { criarCatalogoDeSessoes, criarTransicoesTerminais, registrarIpcTerminais, type DetectorUsado, type TransicoesTerminais } from "./ipc/terminais";
import type { Notificador } from "./notificar";

/** O que o contexto usa do serviço de atividade (o real cumpre; teste injeta um falso). */
export type ServicoAtividadeUsado = Pick<ServicoAtividade, "iniciar" | "observacaoPara" | "encerrarSessao" | "fechar">;

/** Ferramentas sem agente por trás: a heurística de ociosidade não faz sentido num shell comum. */
const SEM_HEURISTICA: readonly string[] = ["terminal", "personalizado"];

export interface DependenciasContexto {
  /** pasta de dados do app (userData). */
  dadosApp: string;
  /** pasta temporária do app (arquivos de apoio dos hooks por sessão). */
  pastaTemp: string;
  /** executável do app e script do daemon (já resolvido para fora do asar). */
  executavelApp: string;
  scriptDaemon: string;
  e2e: boolean;
  semDaemon: boolean;
  /** cwd do workspace; lança se o workspace não existe. NUNCA vem do renderer. */
  resolverCwd: (workspace_id: string | null) => string;
  /** permissão do workspace (D-14); qualquer coisa diferente de `automatico` vale `seguro`. */
  permissaoDe: (workspace_id: string | null) => PermissaoWorkspace;
  /** envia ao renderer da janela atual (no-op sem janela). */
  enviar: <C extends "terminais:evento" | "terminais:falha">(canal: C, payload: CanaisEvento[C]) => void;
  janelaId: () => number;
  /** Limite de sessões da janela (config `limite_paineis`, 1–64); lido a cada abertura. Ausente = padrão do contrato. */
  limiteSessoes?: () => number;
  notificar: Notificador;
  /** Pergunta antes de encerrar sessões ativas (só é chamado sem daemon). Padrão: não encerra. */
  confirmarEncerramento?: (acao: string) => Promise<boolean>;
  /** troca do PATH do processo depois de resolvido o do shell de login. Padrão: `process.env.PATH`. */
  aplicarPath?: (path: string) => void;
  // ---- injeções (teste)
  detector?: DetectorFerramentas;
  servicoDaemon?: ServicoDaemon;
  criarServicoAtividade?: (op: OpcoesServicoAtividade) => ServicoAtividadeUsado;
  resolverPathDeLogin?: () => Promise<string>;
  adaptadorReserva?: AdaptadorPty;
  quadro_ms?: number;
  /** Quanto a detecção pedida pela UI espera o PATH do shell de login antes de varrer com o que há (padrão 400 ms). */
  espera_path_ms?: number;
}

export interface OpcoesRegistroContexto {
  registro: RegistroIpc;
  escolherExecutavel: Parameters<typeof registrarIpcTerminais>[0]["escolherExecutavel"];
  abrirExterno: Parameters<typeof registrarIpcTerminais>[0]["abrirExterno"];
  infoApp: Parameters<typeof registrarIpcTerminais>[0]["infoApp"];
  aoDescartar?: (sessao_id: string) => void;
}

export interface ContextoTerminais {
  readonly detector: DetectorFerramentas;
  readonly daemon: ServicoDaemon;
  readonly transicoes: TransicoesTerminais;
  readonly conversas: Pick<ArmazemConversas, "listar">;
  /** O gerenciador da janela atual; espera a onda 2 (daemon e atividade iniciados). */
  sessoes(): Promise<GerenciadorSessoes>;
  /** Existe gerenciador em memória agora? (sem criar nem esperar) */
  sessoesAgora(): GerenciadorSessoes | null;
  registrarIpc(op: OpcoesRegistroContexto): void;
  /** Serviços da onda 2 do boot: nada aqui roda antes de `executarBoot` terminar a janela. */
  servicosOnda2(): ServicosSecundarios;
  /** A janela fechou mas o app continua (macOS): solta as sessões (daemon) ou as encerra (sem daemon). */
  aoFecharJanela(): void;
  /** Saída do app: solta as sessões, encerra a sinaleira e o daemon só se não há sessão a preservar. */
  encerrar(): Promise<{ preservou: boolean }>;
  /** Explícito (menu "sair e encerrar", instalar atualização): mata todas as sessões e o daemon. */
  encerrarTudo(): Promise<void>;
}

function adiada<T = void>(): { promise: Promise<T>; resolver: (v: T) => void } {
  let resolver!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolver = r; });
  return { promise, resolver };
}

const VAZIA: ObservacaoSessao = { argumentos: [], ambiente: {} };

export function criarContextoTerminais(d: DependenciasContexto): ContextoTerminais {
  const detector = d.detector ?? new DetectorFerramentas();
  const reserva = d.adaptadorReserva ?? new AdaptadorNodePty(); // o node-pty só carrega no primeiro spawn
  const daemon = d.servicoDaemon ?? criarServicoDaemon({
    dadosApp: d.dadosApp, executavel: d.executavelApp, script: d.scriptDaemon, e2e: d.e2e, desligado: d.semDaemon, reserva,
  });
  const aplicarPath = d.aplicarPath ?? ((p: string): void => { process.env["PATH"] = p; });
  const resolverPath = d.resolverPathDeLogin ?? (() => resolverPathDoShellDeLogin());
  const criarAtividade = d.criarServicoAtividade ?? ((op: OpcoesServicoAtividade): ServicoAtividadeUsado => new ServicoAtividade(op));
  const guardiao = new GuardiaoTransicoes();

  const daemonPronto = adiada();
  const atividadePronto = adiada();
  const pathPronto = adiada();
  const ondaDoisPronta = Promise.all([daemonPronto.promise, atividadePronto.promise]);

  let gerenciador: GerenciadorSessoes | null = null;
  let atividade: ServicoAtividadeUsado | null = null;
  let geracao = 0;

  const armazemDeConversas = (workspace_id: string | null): ArmazemConversas => criarArmazemConversas(join(d.dadosApp, "conversas"), d.resolverCwd(workspace_id));
  const conversas = { listar: (): Record<string, string> => { try { return armazemDeConversas(null).listar(); } catch { return {}; } } };

  const lote: LoteSaida = criarLoteSaida({
    enviar: (e: EventoTerminal) => d.enviar("terminais:evento", e),
    ...(d.quadro_ms === undefined ? {} : { quadro_ms: d.quadro_ms }),
  });

  /** Permissão do workspace da sessão; qualquer dúvida ou erro = `seguro` (D-14). */
  const permissaoSegura = (workspace_id: string | null): "seguro" | "automatico" => {
    try { return d.permissaoDe(workspace_id) === "automatico" ? "automatico" : "seguro"; } catch { return "seguro"; }
  };

  /** Sem hook, a sinaleira é estimada pela ociosidade da saída (só para CLIs de IA; sem notificação). */
  const heuristica = new HeuristicaOciosidade({
    emitir: (sessaoId, a) => void gerenciador?.emitirEvento(sessaoId, { tipo: "atividade", atividade: a }),
  });

  function emitirDeAtividade(sessaoId: string, evento: EventoAtividadeParcial): void {
    const g = gerenciador;
    if (g === null) return;
    g.emitirEvento(sessaoId, evento);
    const sessao = g.obter(sessaoId);
    if (sessao === undefined) return;
    if (evento.tipo === "conversa") {
      // a conversa da CLI fica guardada no main, fora do daemon, para "Retomar conversa" depois de encerrar
      try { armazemDeConversas(sessao.workspace_id).gravar(sessaoId, sessao.ferramenta_id, evento.conversa_id); } catch { /* acessório */ }
    } else if (evento.tipo === "atividade") {
      d.notificar(sessao.ferramenta_id, evento.atividade);
    }
  }

  function criarGerenciador(): GerenciadorSessoes {
    const g = new GerenciadorSessoes({
      resolverCwd: d.resolverCwd,
      janela_id: d.janelaId(),
      geracao: ++geracao,
      ...(d.limiteSessoes === undefined ? {} : { limite_sessoes: d.limiteSessoes }),
      registro: detector.registro,
      adaptador: daemon.adaptador(),
      catalogo: criarCatalogoDeSessoes(d.permissaoDe),
      ajustar_argumentos: ajustarArgumentosDasSessoes,
      observador: {
        observar: (ferramenta, sessao, workspace_id) => atividade?.observacaoPara(ferramenta, sessao, permissaoSegura(workspace_id)) ?? VAZIA,
        encerrada: (sessao) => { atividade?.encerrarSessao(sessao); heuristica.remover(sessao); lote.liberar(sessao); },
      },
      ao_descartar: (id) => { try { armazemDeConversas(null).apagar(id); } catch { /* acessório */ } },
    });
    g.assinar((evento) => {
      if (evento.tipo === "saida") {
        const ferramenta = g.obter(evento.sessao_id)?.ferramenta_id;
        if (ferramenta !== undefined && !SEM_HEURISTICA.includes(ferramenta)) heuristica.registrarSaida(evento.sessao_id);
      }
      lote.push(evento);
    });
    return g;
  }

  async function sessoes(): Promise<GerenciadorSessoes> {
    await ondaDoisPronta;
    gerenciador ??= criarGerenciador();
    return gerenciador;
  }

  /**
   * A detecção pedida pela UI espera um pouco o PATH do shell de login (apps GUI do macOS não herdam o do
   * terminal). O shell de login pode levar segundos: passado o limite varre com o PATH atual mais os diretórios
   * convencionais, e quando o PATH de login chega o cache é invalidado (o serviço `path_login`).
   */
  const esperaPath = d.espera_path_ms ?? 400;
  const detectorDoIpc: DetectorUsado = {
    detectar: async (): Promise<FerramentaDetectada[]> => {
      await Promise.race([pathPronto.promise, new Promise<void>((r) => { setTimeout(r, esperaPath).unref(); })]);
      return detector.detectar();
    },
    invalidar: () => detector.invalidar(),
    registro: detector.registro,
  };

  const transicoes = criarTransicoesTerminais({
    guardiao,
    sessoes: () => gerenciador,
    persistente: () => gerenciador?.persistente === true,
    confirmar: d.confirmarEncerramento ?? (async () => false),
  });

  return {
    detector, daemon, transicoes, conversas,
    sessoes,
    sessoesAgora: () => gerenciador,

    registrarIpc(op) {
      registrarIpcTerminais({
        registro: op.registro,
        sessoes,
        detector: detectorDoIpc,
        escolherExecutavel: op.escolherExecutavel,
        abrirExterno: op.abrirExterno,
        armazemLayout: (ws) => criarArmazemLayout(d.dadosApp, ws),
        conversas,
        infoApp: op.infoApp,
        ...(op.aoDescartar === undefined ? {} : { aoDescartar: op.aoDescartar }),
        enviarFalha: (f) => d.enviar("terminais:falha", f),
      });
    },

    servicosOnda2() {
      return {
        daemon: () => {
          try { daemon.iniciar(); } finally { daemonPronto.resolver(); }
        },
        atividade: async () => {
          try {
            const servico = criarAtividade({
              diretorio: join(d.pastaTemp, PRODUTO.prefixoSubagentes),
              emitir: emitirDeAtividade,
              heuristica,
            });
            await servico.iniciar();
            atividade = servico;
            heuristica.iniciar();
          } finally { atividadePronto.resolver(); }
        },
        path_login: async () => {
          try {
            aplicarPath(await resolverPath());
            detector.invalidar(); // o que foi varrido com o PATH antigo não vale mais
          } finally { pathPronto.resolver(); }
        },
        deteccao: async () => {
          await pathPronto.promise;
          await new Promise<void>((r) => setImmediate(r)); // aquece fora da volta do boot
          await detector.detectar();
        },
      };
    },

    aoFecharJanela() {
      const g = gerenciador;
      gerenciador = null;
      lote.fechar();
      if (g === null) return;
      if (g.persistente) g.desanexar(); else g.encerrarTodas();
    },

    async encerrar() {
      lote.fechar();
      heuristica.parar();
      const g = gerenciador;
      gerenciador = null;
      if (g !== null) {
        if (g.persistente) g.desanexar(); else await g.encerrarTodasEAguardar();
      }
      await atividade?.fechar().catch(() => undefined);
      atividade = null;
      const { preservou } = await daemon.aoSairDoApp();
      return { preservou };
    },

    async encerrarTudo() {
      gerenciador?.encerrarTodas();
      await daemon.encerrarTudo();
    },
  };
}
