// Ligação de squads e agentes no main (Fase 14, T-14.09..T-14.16). Monta o serviço, a portabilidade, o motor de agentes e a
// execução por prompt direto sobre os serviços reais e devolve UMA mão de pontas para o `main.ts` ligar (nada aqui importa
// Electron: janelas, seletores de arquivo e relógio entram por injeção). LEVEZA: criar não toca o disco; `iniciar()` (onda 2,
// em ocioso) carrega o índice, atualiza o cache de CLIs e liga o observador de edição externa (debounce 300 ms).
import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { EventoSquad, PedidoAbrirAgente } from "../compartilhado/squads";
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import type { Workspace } from "../nucleo/dominio";
import type { ClaimsDoChamador, PedidoInvocar } from "../nucleo/squads/invocacao";
import { criarMotorDeAgentes } from "../nucleo/squads/invocacao";
import { criarExecucaoDeSquads, type PortaContextoRag } from "../nucleo/squads/execucao";
import { abrirAgenteLivre } from "../nucleo/squads/livre";
import { ErroDeSquad } from "../nucleo/squads/erros";
import { criarLoja } from "../nucleo/squads/loja";
import { criarPortabilidade } from "../nucleo/squads/portabilidade";
import { resolverPerfilDireto, type PortaResolverPerfil } from "../nucleo/squads/perfil";
import { nivelRigidezPadrao, type PortaNivelRigidez } from "../nucleo/squads/rigor";
import { criarServicoSquads } from "../nucleo/squads/servico";
import { niveisDaCli } from "../nucleo/squads/esforco";
import type { PermissaoMembro } from "../nucleo/squads/tipos";
import type { ContextoValidacao } from "../nucleo/squads/validar";
import { lerPortoes } from "../nucleo/orquestracao/portoes";
import { gravarNaPastaDoProduto } from "../nucleo/orquestracao/pasta";
import type { ServicoMissoes } from "../nucleo/missoes/servico";
import type { ServicoPanes } from "../nucleo/missoes/panes";
import type { ServicoProvedores } from "../nucleo/provedores/servico";
import { PRODUTO } from "../nucleo/produto";
import type { Barramento } from "./barramento";
import type { Orquestracao } from "./orquestracao";

export const DEBOUNCE_EXTERNO_MS = 300;
/** O cache de CLIs vale por este tempo (a validação ao vivo da UI não deve tocar o detector a cada tecla). */
const VALIDADE_CLIS_MS = 30_000;

export interface ObservadorDePasta {
  fechar(): void;
}
export type ObservarPastaRecursiva = (dir: string, aoMudar: () => void) => ObservadorDePasta;

/** Observação nativa e leve; falha ao observar = sem observação (o app relê ao focar a tela). */
export const observarPastaDeSquads: ObservarPastaRecursiva = (dir, aoMudar) => {
  try {
    const w = watch(dir, { persistent: false, recursive: true }, () => aoMudar());
    w.on("error", () => undefined);
    return { fechar: () => w.close() };
  } catch {
    return { fechar: () => undefined };
  }
};

/**
 * Onde estão as squads de fábrica (somente leitura). Empacotado: `<resources>/squads` (extraResources); não empacotado: a cópia em
 * `dist/squads` (scripts/lib/ativos.mjs) se existir, senão `resources/squads` do repositório.
 */
export function pastaDeFabricaDeSquads(o: { empacotado: boolean; resourcesPath: string; appPath: string; existe: (caminho: string) => boolean }): string | null {
  const candidatas = o.empacotado ? [join(o.resourcesPath, "squads")] : [join(o.appPath, "dist", "squads"), join(o.appPath, "resources", "squads")];
  return candidatas.find((c) => o.existe(c)) ?? null;
}

export interface DependenciasSquads {
  repos: Repositorios;
  banco: Banco;
  /** `<userData>/squads` (fonte da verdade das squads do usuário; D-201). */
  pastaDoUsuario: string;
  /** squads de fábrica (somente leitura); `null` = sem fábrica. */
  pastaDeFabrica: string | null;
  workspaces: { exigir(id: string): Workspace };
  missoes: Pick<ServicoMissoes, "criar" | "abortar">;
  provedores: Pick<ServicoProvedores, "providerList">;
  orquestracao: Pick<Orquestracao, "definirSquad" | "liberarPortao" | "definirAgentes" | "portas">;
  /** Serviço de Panes: o modo livre (`agentes:abrir_pane`, T-14.17) abre um Pane avulso. Ausente: o canal responde "indisponível". */
  panes?: Pick<ServicoPanes, "abrirPane">;
  /** diretório do app (userData) onde ficam as instruções por Pane; padrão = a pasta-mãe de `pastaDoUsuario`. */
  dirApp?: string;
  barramento: Pick<Barramento, "emitir" | "assinar">;
  /** `squads:evento` para o renderer (no-op sem janela). */
  emitirRenderer(evento: EventoSquad): void;
  /** seletor nativo "salvar como" (arquivo de exportação); `null` = cancelado. */
  escolherArquivoDeSaida(nomeSugerido: string): Promise<string | null>;
  /** seletor nativo "abrir" (arquivo de importação); `null` = cancelado. */
  escolherArquivoDeEntrada(): Promise<string | null>;
  /** pasta de `piloto.md`, `worker.md`, `revisor.md` e `intake.md` (a base inalterável de cada papel). */
  pastaDePrompts: string;
  maxPanesParalelos?: number;
  /** Fase 9: `criarResolvedorHarness(...)`. Ausente: resolução direta (o perfil do membro, sem troca de conta). */
  resolver?: PortaResolverPerfil;
  /** Fase 16: nível de rigidez efetivo. Ausente: 3. */
  rigidez?: PortaNivelRigidez;
  /** Fase 15: contexto do RAG. Ausente: a execução segue sem. */
  contextoRag?: PortaContextoRag;
  permissaoDoWorkspace?: (workspaceId: string) => PermissaoMembro;
  /** Fase 7: skills do catálogo (para filtrar a importação e avisar `skill_desconhecida`); `null` = não verifica. */
  skillsConhecidas?: () => ReadonlySet<string> | null;
  /** Fase 7: com enforcement duro de skills por agente, devolva `true` (a lista deixa de entrar como instrução). */
  skillsAplicadas?: () => boolean;
  /** flags lidas do `--help` (cache em ocioso); `null` = desconhecido. */
  flagsDaCli?: (cli: string) => ReadonlySet<string> | null;
  observarPasta?: ObservarPastaRecursiva;
  agora?: () => number;
  avisar?: (mensagem: string) => void;
}

export interface LigacaoSquads {
  servico: ReturnType<typeof criarServicoSquads>;
  portabilidade: ReturnType<typeof criarPortabilidade>;
  motor: ReturnType<typeof criarMotorDeAgentes>;
  execucao: ReturnType<typeof criarExecucaoDeSquads>;
  /** Modo livre (T-14.17): abre um Pane avulso com o perfil, o prompt e a permissão do agente; sem Missão nem portões. */
  abrirAgente(pedido: PedidoAbrirAgente): Promise<{ pane_id: string }>;
  /** Onda 2 (ocioso): carrega o índice, atualiza CLIs, liga a porta de agentes na orquestração e o observador de edição externa. Idempotente. */
  iniciar(): Promise<void>;
  /** Fecha observadores e solta a porta de agentes. Idempotente. */
  encerrar(): void;
  /** Relê as CLIs instaladas (cache de 30 s; `forcar` ignora a validade). */
  atualizarClis(forcar?: boolean): Promise<string[]>;
  /**
   * Porta para o MCP (pedido em docs/ade/pedidos/14-pedidos.md): `agent_list` e `agent_invoke` rodam NO MAIN (o worker do MCP só
   * as chama por RPC). Identidade (Missão, Pane, papel) vem do token, nunca dos argumentos.
   */
  portaSquads: {
    listar(missionId: string): { agents: Array<{ agent_id: string; role: string; label: string; description: string; tier: string; max_instances: number; in_flight: number }> };
    invocar(claims: ClaimsDoChamador, args: PedidoInvocar): Promise<{ pane_id: string; invocation_id: string }>;
  };
}

export function ligarSquads(deps: DependenciasSquads): LigacaoSquads {
  const { repos, banco } = deps;
  const resolver = deps.resolver ?? resolverPerfilDireto();
  const maxGlobal = deps.maxPanesParalelos ?? 8;
  const agora = deps.agora ?? ((): number => Date.now());
  const avisar = (m: string): void => deps.avisar?.(m);
  let clisCache: string[] = [];
  let clisEm = 0;
  let iniciado = false;
  let encerrado = false;
  let observador: ObservadorDePasta | null = null;
  let temporizador: NodeJS.Timeout | null = null;
  let desligar: Array<() => void> = [];

  const habilitadas = async (): Promise<string[]> => (await deps.provedores.providerList()).filter((p) => p.enabled).map((p) => p.provider);
  async function atualizarClis(forcar = false): Promise<string[]> {
    if (!forcar && agora() - clisEm < VALIDADE_CLIS_MS) return clisCache;
    try {
      clisCache = await habilitadas();
      clisEm = agora();
    } catch (e) {
      avisar(`Squads: não foi possível listar as CLIs (${e instanceof Error ? e.message : "erro"}).`);
    }
    return clisCache;
  }

  const contextoDe = (workspaceId: string | null): ContextoValidacao => ({
    clisInstaladas: workspaceId === null ? null : clisCache,
    niveisEsforco: (cli) => {
      try {
        return niveisDaCli(cli).niveis;
      } catch {
        return null;
      }
    },
    modoEsforco: (cli) => {
      try {
        return niveisDaCli(cli).modo;
      } catch {
        return null;
      }
    },
    skillsConhecidas: deps.skillsConhecidas?.() ?? null,
    maxParallelPanes: maxGlobal,
    permissaoWorkspace: workspaceId === null ? null : (deps.permissaoDoWorkspace?.(workspaceId) ?? null),
  });

  const loja = criarLoja({
    pastaUsuario: deps.pastaDoUsuario,
    pastaFabrica: deps.pastaDeFabrica,
    contexto: () => contextoDe(null),
    emUso: (slug) => repos.missionSquad.emUso(slug),
  });
  const servico = criarServicoSquads({
    loja,
    emitir: (tipo, payload) => deps.barramento.emitir(tipo, payload),
    aoMudar: (e) => deps.emitirRenderer(e),
    vivasPorAgente: (squad) => repos.invocacaoAgente.vivasPorAgente(squad),
    contextoDe,
    cliInstalada: (cli) => clisCache.includes(cli),
  });
  const portabilidade = criarPortabilidade({
    loja,
    raizDoWorkspace: (id) => {
      try {
        return deps.workspaces.exigir(id).raiz;
      } catch {
        return null;
      }
    },
    pastaProduto: PRODUTO.pastaNoProjeto,
    escolherDestino: deps.escolherArquivoDeSaida,
    escolherOrigem: deps.escolherArquivoDeEntrada,
    ...(deps.skillsConhecidas === undefined ? {} : { skillsConhecidas: deps.skillsConhecidas }),
    emitir: (tipo, payload) => deps.barramento.emitir(tipo, payload),
    aoMudar: (e) => deps.emitirRenderer(e),
  });
  const motor = criarMotorDeAgentes({
    servico,
    repos,
    banco,
    resolver,
    cliHabilitada: async (cli) => (await habilitadas()).includes(cli),
    pastaDePrompts: deps.pastaDePrompts,
    maxPanesParalelos: maxGlobal,
    definirSquad: (id, agentes) => deps.orquestracao.definirSquad(id, agentes),
    liberarPortao: (id, portao) => deps.orquestracao.liberarPortao(id, portao),
    emitir: (tipo, payload) => deps.barramento.emitir(tipo, payload),
    avisar,
    ...(deps.permissaoDoWorkspace === undefined ? {} : { permissaoDoWorkspace: deps.permissaoDoWorkspace }),
    ...(deps.skillsAplicadas === undefined ? {} : { skillsAplicadas: deps.skillsAplicadas }),
    ...(deps.flagsDaCli === undefined ? {} : { flagsDaCli: deps.flagsDaCli }),
  });
  const execucao = criarExecucaoDeSquads({
    servico,
    motor,
    repos,
    workspaces: deps.workspaces,
    missoes: deps.missoes,
    resolver,
    rigidez: deps.rigidez ?? nivelRigidezPadrao,
    clisHabilitadas: () => atualizarClis(true),
    ...(deps.contextoRag === undefined ? {} : { contextoRag: deps.contextoRag }),
    portoesLiberados: (missionId) => lerPortoes(repos.config, missionId),
    emitir: (tipo, payload) => deps.barramento.emitir(tipo, payload),
    avisar,
  });

  class ModoLivreIndisponivelErro extends ErroDeSquad {
    readonly codigo = "modo_livre_indisponivel";
    constructor() {
      super("O modo livre ainda não está disponível: o serviço de terminais não foi ligado.");
      this.name = "ModoLivreIndisponivelErro";
    }
  }
  async function abrirAgente(pedido: PedidoAbrirAgente): Promise<{ pane_id: string }> {
    if (deps.panes === undefined) throw new ModoLivreIndisponivelErro();
    const panes = deps.panes;
    return abrirAgenteLivre(
      {
        servico,
        banco,
        repos,
        resolver,
        workspaces: deps.workspaces,
        cliHabilitada: async (cli) => (await habilitadas()).includes(cli),
        abrirPane: (p) => panes.abrirPane(p),
        dirApp: deps.dirApp ?? dirname(deps.pastaDoUsuario),
        pastaDePrompts: deps.pastaDePrompts,
        maxLivres: maxGlobal,
        sincronizar: () => motor.sincronizarEncerradas(),
        emitir: (tipo, payload) => deps.barramento.emitir(tipo, payload),
        avisar,
        ...(deps.permissaoDoWorkspace === undefined ? {} : { permissaoDoWorkspace: deps.permissaoDoWorkspace }),
        ...(deps.skillsAplicadas === undefined ? {} : { skillsAplicadas: deps.skillsAplicadas }),
        ...(deps.flagsDaCli === undefined ? {} : { flagsDaCli: deps.flagsDaCli }),
      },
      pedido,
    );
  }

  /** Briefing gravado pelo orquestrador via `prompt`: dentro da pasta do produto da árvore da Missão; devolve o caminho RELATIVO. */
  async function gravarBriefing(missionId: string, workspaceId: string, texto: string): Promise<string> {
    const ws = deps.workspaces.exigir(workspaceId);
    const missao = repos.mission.obter(missionId);
    const base = missao?.worktree != null ? resolve(ws.raiz, missao.worktree) : ws.raiz;
    const nome = `briefing-agente-${Date.now().toString(36)}.md`;
    const rel = join(PRODUTO.pastaNoProjeto, "missoes", missionId, nome).split("\\").join("/");
    await gravarNaPastaDoProduto(base, rel, texto);
    return rel;
  }

  const portaSquads: LigacaoSquads["portaSquads"] = {
    listar: (missionId) => motor.agentList(missionId),
    invocar: (claims, args) =>
      motor.invocar(claims, args, {
        panes: deps.orquestracao.portas.panes,
        missoes: deps.orquestracao.portas.missoes,
        provedores: deps.orquestracao.portas.provedores,
        gravarBriefing,
      }),
  };

  function recarregarDepois(): void {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      if (!encerrado) void servico.recarregar().catch((e: unknown) => avisar(`Squads: falha ao reler as pastas (${e instanceof Error ? e.message : "erro"}).`));
    }, DEBOUNCE_EXTERNO_MS);
    temporizador.unref();
  }

  return {
    servico,
    portabilidade,
    motor,
    execucao,
    abrirAgente,
    atualizarClis,
    portaSquads,
    async iniciar() {
      if (iniciado || encerrado) return;
      iniciado = true;
      deps.orquestracao.definirAgentes({
        preparar: (e) => motor.prepararPane(e),
        ajustarSpawn: (p) => motor.ajustarSpawn(p),
      });
      try {
        await mkdir(deps.pastaDoUsuario, { recursive: true, mode: 0o700 });
      } catch {
        // sem pasta não há squads do usuário; a fábrica continua valendo
      }
      await atualizarClis(true);
      await servico.carregar();
      for (const a of servico.avisosDeCarga()) avisar(`Squads: ${a}`);
      if (encerrado) return;
      observador = (deps.observarPasta ?? observarPastaDeSquads)(deps.pastaDoUsuario, recarregarDepois);
      // invocações cujo Pane terminou deixam de ocupar vaga (toda mudança de Missão/Pane já chega coalescida)
      desligar.push(deps.barramento.assinar("missoes:mudou", () => void motor.sincronizarEncerradas()));
    },
    encerrar() {
      if (encerrado) return;
      encerrado = true;
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
      observador?.fechar();
      observador = null;
      for (const f of desligar.splice(0)) f();
      deps.orquestracao.definirAgentes(null);
      desligar = [];
    },
  };
}
