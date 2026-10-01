// Panes de Missão persistidos (T-02.06): `abrirPane` resolve o cwd (worktree da Missão ou raiz), grava
// pane + sessão, liga ao gerenciador de sessões e acompanha os eventos da sessão (estado do Pane).
// `restaurar` religa os Panes vivos ao reabrir o app; o que morreu vira `encerrado` e sai do layout.
// O cwd NUNCA vem do renderer: ou é a raiz/worktree da Missão ou um worktree que o main reconheceu.
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { EventoTerminal, FerramentaDetectada, PedidoAbrirSessao, RespostaAbrirSessao } from "../../compartilhado/terminais";
import type { Banco } from "../banco";
import type { Repositorios } from "../banco/repos";
import { ErroDominio, ValorInvalidoErro, type EstadoPane, type Mission, type Pane, type Papel, type Workspace } from "../dominio";
import { motivoRecusaDeEntrada, type MotivoRecusaEntrada } from "../metodo/comandos";
import type { ServicoContas } from "../provedores/contas";
import { argumentosDeModelo, CATALOGO_TERMINAIS } from "../terminais/catalogo";
import type { ArmazemLayout } from "../terminais/layout";
import { restaurarLayout } from "../terminais/layout";
import type { NoLayout } from "../../compartilhado/terminais";
import { PastaInexistenteErro } from "../workspaces/servico";

export class CliIndisponivelErro extends ErroDominio {
  override name = "CliIndisponivelErro";
  constructor(readonly cli: string) {
    super(`A CLI "${cli}" não está instalada ou não foi detectada.`);
  }
}
export class ContaInvalidaErro extends ErroDominio {
  override name = "ContaInvalidaErro";
  constructor(readonly motivo: "inexistente" | "desabilitada" | "outro_provedor") {
    super(`Conta não utilizável (${motivo}).`);
  }
}
export class PaneAtivoErro extends ErroDominio {
  override name = "PaneAtivoErro";
  constructor(readonly paneId: string) {
    super(`O Pane ${paneId} ainda está ativo: só se renasce o que encerrou.`);
  }
}
export type MotivoComandoRecusado = MotivoRecusaEntrada | "entrada_pendente" | "texto_invalido";
export class PaneNaoAceitaComandoErro extends ErroDominio {
  override name = "PaneNaoAceitaComandoErro";
  constructor(readonly motivo: MotivoComandoRecusado) {
    super(`O Pane não aceita comando agora (${motivo}).`);
  }
}

/** O que o serviço usa do gerenciador de sessões (o real cumpre; teste injeta um falso). */
export interface SessoesDePanes {
  abrir(pedido: PedidoAbrirSessao, opcoes: { cwd: string; ambiente?: Record<string, string> }): RespostaAbrirSessao;
  escrever(id: string, dados: string): boolean;
  encerrar(id: string): boolean;
  obter(id: string): { estado: string } | undefined;
  recuperar(): Promise<unknown>;
  assinar(fn: (evento: EventoTerminal) => void): () => void;
}

export interface PedidoAbrirPane {
  missao_id?: string | null;
  /** obrigatório quando não há Missão. */
  workspace_id?: string | null;
  cli: string;
  papel?: Papel;
  modelo?: string | null;
  esforco?: string | null;
  conta_id?: string | null;
  prompt_inicial?: string;
  respawn_de?: string | null;
  argumentos?: string[];
  colunas?: number;
  linhas?: number;
  /** Só do main: worktree ABSOLUTO que saiu de `git worktree list`. Substitui o cwd padrão. */
  cwd?: string;
  /** Só do main: dados opacos entregues ao preparador de lançamento (ex.: o card de um worker). */
  contexto?: Readonly<Record<string, unknown>>;
}

/** O que um preparador soma ao lançamento de um Pane (argumentos e ambiente da sessão). */
export interface PreparoDaSessao {
  argumentos: string[];
  ambiente: Record<string, string>;
}

export interface EntradaPreparoDePane {
  pane: Pane;
  pedido: PedidoAbrirPane;
  missao: Mission | undefined;
  workspace: Workspace;
  /** cwd absoluto em que a sessão vai abrir */
  cwd: string;
  ferramenta: FerramentaDetectada;
}

/**
 * Gancho do main (orquestração): roda DEPOIS de o Pane existir (há `pane.id` para o token) e ANTES de a
 * sessão abrir. `null` = lançamento comum. Quando devolve um preparo, os argumentos dele substituem o
 * `prompt_inicial` do pedido (o preparador já o embute no argv) e o ambiente é somado ao da conta.
 */
export type PreparadorDePane = (e: EntradaPreparoDePane) => Promise<PreparoDaSessao | null>;

export interface PaneAberto {
  pane: Pane;
  sessao_id: string;
}

export interface ResultadoRestauracao {
  religados: string[];
  encerrados: string[];
  /** O daemon não respondeu: nenhum Pane foi tocado (encerrar é irreversível); tentar de novo mais tarde. */
  indeterminado?: true;
}

export interface DependenciasPanes {
  banco: Banco;
  repos: Repositorios;
  workspaces: { exigir(id: string): Workspace };
  sessoes: () => Promise<SessoesDePanes>;
  detector: { detectar(): Promise<FerramentaDetectada[]> };
  contas: Pick<ServicoContas, "obter" | "ambienteDaConta">;
  armazemLayout?: (workspaceId: string | null) => ArmazemLayout;
  aoMudar?: (e: { workspace_id: string; mission_id: string | null }) => void;
  agora?: () => number;
  /** Esperas entre as tentativas de `restaurar` quando o daemon ainda não responde (padrão 250 ms, 750 ms, 2 s). */
  atrasosRestauracaoMs?: readonly number[];
}

export interface ServicoPanes {
  /** Liga (uma vez) o acompanhamento dos eventos das sessões. Idempotente. */
  ligar(): Promise<void>;
  exigirCli(cli: string): Promise<FerramentaDetectada>;
  abrirPane(pedido: PedidoAbrirPane): Promise<PaneAberto>;
  encerrarPane(paneId: string, motivo: string): Promise<Pane>;
  respawn(paneId: string): Promise<PaneAberto>;
  /**
   * `terminais.descartar`: marca o Pane da sessão como encerrado (motivo 'descartado'), numa transação do repositório,
   * e avisa (o `aoMudar` coalescido faz a Orquestração revogar o token MCP). `null` se a sessão não tem Pane ativo.
   */
  marcarDescartada(sessaoId: string): Pane | null;
  restaurar(): Promise<ResultadoRestauracao>;
  enviarComando(paneId: string, texto: string): Promise<void>;
  rotulo(pane: Pane): string;
  /** Liga (ou remove, com `null`) o preparador de lançamento. Só o main chama. */
  definirPreparador(preparador: PreparadorDePane | null): void;
}

const ATIVIDADE_PARA_ESTADO = { trabalhando: "trabalhando", aguardando: "aguardando", pronto: "pronto" } as const;
/** Sem aviso de atividade (CLI sem hook), a entrada pendente expira sozinha. */
const PENDENCIA_MS = 15_000;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

function folhas(no: NoLayout): string[] {
  return no.tipo === "terminal" ? [no.sessao_id] : [...folhas(no.primeiro), ...folhas(no.segundo)];
}

export function criarServicoPanes(deps: DependenciasPanes): ServicoPanes {
  const { banco, repos } = deps;
  const agora = deps.agora ?? Date.now;
  const porSessao = new Map<string, string>();
  const entradaEm = new Map<string, number>();
  let ligacao: Promise<void> | null = null;
  let preparador: PreparadorDePane | null = null;

  const avisar = (p: Pane): void => deps.aoMudar?.({ workspace_id: p.workspace_id, mission_id: p.mission_id });

  const paneDaSessao = (sessaoId: string): Pane | undefined => {
    const id = porSessao.get(sessaoId) ?? banco.consultarUm<{ id: string }>("SELECT id FROM pane WHERE sessao_pty_id = ? AND estado <> 'encerrado' LIMIT 1", [sessaoId])?.id;
    if (id === undefined) return undefined;
    porSessao.set(sessaoId, id);
    return repos.pane.obter(id);
  };

  function aoEvento(ev: EventoTerminal): void {
    const pane = paneDaSessao(ev.sessao_id);
    if (pane === undefined || pane.estado === "encerrado") return;
    try {
      if (ev.tipo === "estado") {
        if (ev.estado === "executando" && pane.estado === "iniciando") avisar(repos.pane.atualizar(pane.id, { estado: "pronto" }));
      } else if (ev.tipo === "atividade") {
        entradaEm.delete(pane.id);
        avisar(repos.pane.atualizar(pane.id, { estado: ATIVIDADE_PARA_ESTADO[ev.atividade] }));
      } else if (ev.tipo === "conversa") {
        repos.pane.registrarSessao(pane.id, ev.conversa_id);
      } else if (ev.tipo === "encerramento") {
        entradaEm.delete(pane.id);
        porSessao.delete(ev.sessao_id);
        avisar(repos.pane.encerrar(pane.id, "processo_encerrado"));
      }
    } catch {
      // um evento que não cabe no banco (Pane sumiu no meio) nunca derruba o gerenciador de sessões
    }
  }

  const ligar = (): Promise<void> => {
    ligacao ??= deps.sessoes().then((g) => void g.assinar(aoEvento));
    return ligacao;
  };

  async function exigirCli(cli: string): Promise<FerramentaDetectada> {
    const lista = await deps.detector.detectar();
    const f = lista.find((x) => x.id === cli);
    if (f === undefined || !f.instalado || f.executavel_id === null) throw new CliIndisponivelErro(cli);
    return f;
  }

  const nomeDaCli = (cli: string | null): string => (cli === null ? "shell" : (CATALOGO_TERMINAIS.find((f) => f.id === cli)?.nome ?? cli));

  async function abrirPane(p: PedidoAbrirPane): Promise<PaneAberto> {
    let missao: Mission | undefined;
    let ws: Workspace;
    if (p.missao_id !== undefined && p.missao_id !== null) {
      missao = repos.mission.exigir(p.missao_id);
      ws = deps.workspaces.exigir(missao.workspace_id);
    } else {
      if (typeof p.workspace_id !== "string") throw new ValorInvalidoErro("workspace_id", p.workspace_id);
      ws = deps.workspaces.exigir(p.workspace_id);
    }
    const cwd = p.cwd ?? (missao?.worktree != null ? resolve(ws.raiz, missao.worktree) : ws.raiz);
    if (!existsSync(cwd)) throw new PastaInexistenteErro(cwd);

    const ferramenta = await exigirCli(p.cli);
    let ambiente: Record<string, string> = {};
    if (p.conta_id !== undefined && p.conta_id !== null) {
      const conta = deps.contas.obter(p.conta_id);
      if (conta === undefined) throw new ContaInvalidaErro("inexistente");
      if (!conta.habilitada) throw new ContaInvalidaErro("desabilitada");
      if (conta.provedor !== p.cli) throw new ContaInvalidaErro("outro_provedor");
      ambiente = deps.contas.ambienteDaConta(conta);
    }
    await ligar();

    const criado = repos.pane.criar({
      workspace_id: ws.id,
      mission_id: missao?.id ?? null,
      tipo: p.cli === "terminal" ? "shell" : "cli",
      cli: p.cli,
      executavel_id: ferramenta.executavel_id,
      conta_id: p.conta_id ?? null,
      modelo: p.modelo ?? null,
      esforco: p.esforco ?? null,
      papel: p.papel ?? "nenhum",
      cwd: relative(ws.raiz, cwd).replaceAll("\\", "/") || ".",
      respawn_de: p.respawn_de ?? null,
    });

    let resposta: RespostaAbrirSessao;
    try {
      const preparo = preparador === null ? null : await preparador({ pane: criado, pedido: p, missao, workspace: ws, cwd, ferramenta });
      const pedido: PedidoAbrirSessao = {
        versao: 1,
        ferramenta_id: ferramenta.id,
        executavel_id: ferramenta.executavel_id as string,
        argumentos: [...(p.argumentos ?? []), ...argumentosDeModelo(ferramenta.id, p.modelo), ...(preparo?.argumentos ?? [])],
        colunas: p.colunas ?? 120,
        linhas: p.linhas ?? 32,
        workspace_id: ws.id,
        ...(p.prompt_inicial === undefined || preparo !== null ? {} : { prompt_inicial: p.prompt_inicial }),
      };
      const g = await deps.sessoes();
      // sem `await` entre `abrir` e o mapa: o primeiro evento da sessão já acha o Pane
      resposta = g.abrir(pedido, { cwd, ambiente: preparo === null ? ambiente : { ...ambiente, ...preparo.ambiente } });
      porSessao.set(resposta.sessao_id, criado.id);
    } catch (erro) {
      avisar(repos.pane.encerrar(criado.id, "falha_ao_abrir"));
      throw erro;
    }
    const pane = repos.pane.atualizar(criado.id, { sessao_pty_id: resposta.sessao_id });
    repos.pane.registrarSessao(pane.id, null);
    avisar(pane);
    return { pane, sessao_id: resposta.sessao_id };
  }

  async function encerrarPane(paneId: string, motivo: string): Promise<Pane> {
    const antes = repos.pane.exigir(paneId);
    const pane = repos.pane.encerrar(paneId, motivo);
    entradaEm.delete(paneId);
    if (antes.estado !== "encerrado" && antes.sessao_pty_id !== null) {
      try {
        (await deps.sessoes()).encerrar(antes.sessao_pty_id);
      } catch {
        // a sessão já não existe: o Pane está encerrado de qualquer forma
      }
      porSessao.delete(antes.sessao_pty_id);
    }
    avisar(pane);
    return pane;
  }

  function marcarDescartada(sessaoId: string): Pane | null {
    const pane = paneDaSessao(sessaoId);
    if (pane === undefined) return null;
    const encerrado = repos.pane.encerrar(pane.id, "descartado");
    entradaEm.delete(pane.id);
    porSessao.delete(sessaoId);
    avisar(encerrado);
    return encerrado;
  }

  async function respawn(paneId: string): Promise<PaneAberto> {
    const antigo = repos.pane.exigir(paneId);
    if (antigo.estado !== "encerrado") throw new PaneAtivoErro(paneId);
    const ws = deps.workspaces.exigir(antigo.workspace_id);
    const missao = antigo.mission_id === null ? undefined : repos.mission.obter(antigo.mission_id);
    const herdado = missao === undefined && antigo.cwd !== null && antigo.cwd !== "." ? resolve(ws.raiz, antigo.cwd) : undefined;
    return abrirPane({
      ...(missao === undefined ? { workspace_id: ws.id } : { missao_id: missao.id }),
      cli: antigo.cli ?? "terminal",
      papel: antigo.papel,
      modelo: antigo.modelo,
      esforco: antigo.esforco,
      conta_id: antigo.conta_id,
      respawn_de: antigo.id,
      ...(herdado !== undefined && existsSync(herdado) ? { cwd: herdado } : {}),
    });
  }

  async function restaurar(): Promise<ResultadoRestauracao> {
    const g = await deps.sessoes();
    await ligar();
    // AUD-10: só dá Pane por morto depois de o daemon RESPONDER. Indisponível não é "sem sessões": tenta de novo e,
    // se continuar mudo, não encerra ninguém (a restauração seguinte resolve).
    const atrasos = deps.atrasosRestauracaoMs ?? [250, 750, 2_000];
    let respondeu = false;
    for (let tentativa = 0; ; tentativa++) {
      try { await g.recuperar(); respondeu = true; break; } catch {
        if (tentativa >= atrasos.length) break;
        await new Promise<void>((r) => { setTimeout(r, atrasos[tentativa]); });
      }
    }
    if (!respondeu) return { religados: [], encerrados: [], indeterminado: true };
    const ids = banco.consultar<{ id: string }>("SELECT id FROM pane WHERE estado <> 'encerrado' ORDER BY workspace_id, display_id").map((l) => l.id);
    const religados: string[] = [];
    const encerrados: string[] = [];
    const mortosPorWorkspace = new Map<string, Set<string>>();
    for (const id of ids) {
      const pane = repos.pane.exigir(id);
      const sessao = pane.sessao_pty_id === null ? undefined : g.obter(pane.sessao_pty_id);
      const viva = sessao !== undefined && (sessao.estado === "executando" || sessao.estado === "iniciando");
      if (viva && pane.sessao_pty_id !== null) {
        porSessao.set(pane.sessao_pty_id, pane.id);
        religados.push(pane.id);
        continue;
      }
      repos.pane.encerrar(pane.id, "sessao_morreu");
      encerrados.push(pane.id);
      if (pane.sessao_pty_id !== null) {
        const mortos = mortosPorWorkspace.get(pane.workspace_id) ?? new Set<string>();
        mortos.add(pane.sessao_pty_id);
        mortosPorWorkspace.set(pane.workspace_id, mortos);
      }
      avisar(repos.pane.exigir(pane.id));
    }
    if (deps.armazemLayout !== undefined) {
      for (const [workspaceId, mortos] of mortosPorWorkspace) {
        try {
          const armazem = deps.armazemLayout(workspaceId);
          const layout = armazem.ler();
          if (layout === null) continue;
          // só sai da árvore o que era Pane e morreu: terminais avulsos do layout não são da nossa conta
          const vivas = layout.abas.flatMap((a) => folhas(a.arvore)).filter((s) => !mortos.has(s));
          armazem.gravar(restaurarLayout(layout, vivas));
        } catch {
          // layout ilegível: o renderer recompõe a partir das sessões vivas
        }
      }
    }
    return { religados, encerrados };
  }

  async function enviarComando(paneId: string, texto: string): Promise<void> {
    if (typeof texto !== "string" || texto.trim() === "" || CONTROLE.test(texto) || texto.length > 2_000) throw new PaneNaoAceitaComandoErro("texto_invalido");
    const pane = repos.pane.exigir(paneId);
    const recusa = motivoRecusaDeEntrada(pane.estado as EstadoPane);
    if (recusa !== null) throw new PaneNaoAceitaComandoErro(recusa);
    const desde = entradaEm.get(paneId);
    if (desde !== undefined && agora() - desde < PENDENCIA_MS) throw new PaneNaoAceitaComandoErro("entrada_pendente");
    if (pane.sessao_pty_id === null) throw new PaneNaoAceitaComandoErro("encerrado");
    const escreveu = (await deps.sessoes()).escrever(pane.sessao_pty_id, `${texto}\r`);
    if (!escreveu) throw new PaneNaoAceitaComandoErro("encerrado");
    entradaEm.set(paneId, agora());
  }

  function rotulo(pane: Pane): string {
    const titulo = pane.mission_id === null ? "sem missão" : (repos.mission.obter(pane.mission_id)?.titulo ?? "sem missão");
    return `#${pane.display_id} · ${nomeDaCli(pane.cli)} · ${pane.papel} · ${titulo}`;
  }

  const definirPreparador = (fn: PreparadorDePane | null): void => {
    preparador = fn;
  };

  return { ligar, exigirCli, abrirPane, encerrarPane, marcarDescartada, respawn, restaurar, enviarComando, rotulo, definirPreparador };
}
