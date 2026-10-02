// Ligação do Maestro no main (Fase 16, onda 2). Monta o `ServicoMaestro` do núcleo (src/nucleo/maestro) sobre os serviços reais: banco (repositório
// SQLite da `PortaPersistencia`), Panes, índice do método (disco), harness (perfil/conta por consumo), decisor externo (Fase 9, desligado por
// padrão), notificação e `.expx/hooks.json` (única escrita fora da pasta do produto, só por ação do usuário: D-04 exceção D-221).
// LEVEZA: criar a ligação não toca o disco nem cria o serviço; o `ServicoMaestro` nasce no primeiro pedido (`servico()`), ou em `iniciar()` SÓ se já
// houver pipeline ativo (retomada). O temporizador de 30 s só existe com pipeline ativo. Nada de rede aqui: o decisor passa pelo `nucleo/rede` da Fase 9.
// Segurança: o renderer nunca envia caminho/cwd; texto do usuário só vira argumento normalizado; erros nominais saem como `<codigo>: <mensagem>`.
import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AchadoPipeline, CatalogoPipelines, CelaDto, ConfigMaestroDto, DetalhePipeline, EstadoHooksDto, EstadoRigidez, EtapaConfig, EtapaConfigEfetiva, EtapaId, EventoMaestro, EventoRigidez, ItemDePisoDto, MatrizRigidezDto,
  NivelRigidez, PedidoAcaoPipeline, PedidoAplicarPronto, PedidoConfigGravar, PedidoConfigRestaurar, PedidoConfirmarMaestro, PedidoDefinirRigidez, PedidoExportarPipelines, PedidoGravarConfigMaestro,
  PedidoHooksEstado, PedidoImportarConfirmarPipelines, PedidoImportarPreviaPipelines, PedidoLerRigidez, PedidoListarPipelines, PedidoListarRecibos, PedidoPedirMaestro, PedidoPreviaPlano, PedidoValidarConfigs,
  PerfilProntoDto, PipelineEstado, PipelineId, PipelineResumo, PreviaImportacaoPipelines, ReciboMaestro, RespostaPedirMaestro, ResultadoConfigGravar, ResultadoDefinirRigidez, ResultadoExportarPipelines,
} from "../compartilhado/maestro";
import { ESTADOS_PIPELINE_TERMINAIS, ETAPA_IDS } from "../compartilhado/maestro";
import type { MaestroDaOrquestracao } from "./orquestracao";
import { criarGanchoMaestroPrompt } from "../nucleo/maestro/gancho/prompt";
import { criarPortaMaestroMcp } from "../nucleo/maestro/mcp";
import type { Barramento } from "./barramento";
import type { HarnessMain } from "./harness";
import type { Repositorios } from "../nucleo/banco/repos";
import type { Workspace } from "../nucleo/dominio";
import { branchAtual, executarGit } from "../nucleo/git";
import { resumirParaDecisor } from "../nucleo/harness/decisor/resumo";
import { consentimentoValido, destinoDoDecisor } from "../nucleo/harness/decisor/cliente";
import {
  acharTrabalho as acharTrabalhoNoIndice,
  type IndicesPorRaiz,
} from "../nucleo/metodo/missao";
import type { Trabalho } from "../nucleo/metodo/tipos";
import { harnessDaCli } from "../nucleo/metodo/comandos";
import type { ServicoPanes } from "../nucleo/missoes/panes";
import { gravarNaPastaDoProduto, resolverDentroReal } from "../nucleo/orquestracao/pasta";
import { PRODUTO } from "../nucleo/produto";
import { niveisDaCli } from "../nucleo/squads/esforco";
import { modelosDaFerramenta } from "../nucleo/terminais/catalogo";
import {
  aplicarHooks, aplicarPerfilProntoAsEtapas, avaliarMudancaDeNivel, CAMINHO_DE_EXPORTACAO, configDeFabrica, criarDecisorDeIntencao, criarPortaArquivosHooksNode, criarServicoMaestro, estadoDosHooks, ETAPAS,
  etapaDef, exportarConfig, HOOKS_POR_NIVEL, importarPrevia, lerRelatorioRapido, MATRIZ_RIGIDEZ, MaestroErro, NIVEIS, nivelMinimoTravado, normalizarConfigMaestro, PARAMETROS_POR_NIVEL, perfisProntosDoMaestro,
  PIPELINES, planoDeEtapas, refDoTrabalho, resolverNivel, resumoDoPipeline, resumoDoPiso, TAMANHO_MAX_IMPORTACAO, temErro, validarConfig, varrerSegredosNoDiff, verificarPiso, caminhoRelatorioRapido,
  CONFIG_DECISOR_PADRAO, type LeitoresDeNivel,
  type ArgsAbrirPane, type ConfigDecisorMaestro, type ConfigMaestro, type ContextoDoMetodo, type ContextoTrava, type ContextoValidacao, type EvidenciaDoDisco, type FontesDePerfil, type ItemDePiso,
  type NotificacaoMaestro, type PortaAsk, type PortaPersistencia, type PortasServico, type ResultadoDoHarness, type ServicoMaestro, type SondaDeDisco, type TrabalhoParaMaestro,
} from "../nucleo/maestro";

// ---------------------------------------------------------------- erro nominal que atravessa o IPC (`<codigo>: <mensagem>`)
export class ErroDeMaestroIpc extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(`${codigo}: ${mensagem}`);
    this.name = "ErroDeMaestroIpc";
  }
}
/** Erros nominais do núcleo e do domínio passam com a mensagem; o resto vira texto genérico (nunca vaza caminho de máquina). */
export function sanearErroDeMaestro(e: unknown): Error {
  if (e instanceof MaestroErro) return new ErroDeMaestroIpc(e.codigo, e.message);
  if (e instanceof ErroDeMaestroIpc) return e;
  return new ErroDeMaestroIpc("indisponivel", "falha ao executar a operação do Maestro");
}

/** Origem da Missão do pipeline pela intenção (só as de trabalho; as demais não criam Missão). */
const ORIGEM_DA_INTENCAO: Partial<Record<import("../compartilhado/maestro").Intencao, "feature" | "ocorrencia" | "pedido" | "projeto">> = {
  bug: "ocorrencia",
  feature: "feature",
  refatoracao: "feature",
  pedido: "pedido",
  projeto: "projeto",
};

// ---------------------------------------------------------------- tipos de injeção
export interface GerenciadorDoMetodo {
  garantir(ws: { id: string; raiz: string; e_git: boolean }): Promise<void>;
  estado(workspaceId: string): { camadas: { convencoes: boolean; perfil_legado: boolean; design_system: boolean; produto: boolean } ; trabalhos: Trabalho[] } | null;
  indices(workspaceId: string): Promise<IndicesPorRaiz>;
}
export interface DadosNotificacaoMaestro {
  title: string;
  body: string;
}
export interface DependenciasMaestro {
  repos: Repositorios;
  workspaces: { exigir(id: string): Workspace; permissaoDe(id: string): "seguro" | "equilibrado" | "automatico" };
  panes: Pick<ServicoPanes, "abrirPane" | "enviarComando" | "encerrarPane">;
  /** T-16.21: cria a Missão do pipeline (livre, sem worktree: a skill cria o dela). Ausente = pipeline sem Missão (painéis livres, como na onda 2). */
  missoes?: Pick<import("../nucleo/missoes/servico").ServicoMissoes, "criar">;
  metodo: GerenciadorDoMetodo;
  /** módulos da suíte desligados no workspace (D-480): o plano que usa um deles fica indisponível e o pedido de agente é recusado (`module_disabled`). */
  modulosDesligados?: (workspaceId: string) => ReadonlySet<string>;
  /** lido de forma preguiçosa: o harness nasce depois do domínio. */
  harness: () => Pick<HarnessMain, "resolvedor" | "decisorDeIntencao" | "decisorLer"> | null;
  barramento: Pick<Barramento, "emitir" | "emitirCoalescido" | "assinar">;
  emitirRenderer(canal: "maestro:evento" | "rigidez:evento", payload: EventoMaestro | EventoRigidez): void;
  /** notificação nativa (Electron `Notification` injetado); ausente = só o evento no renderer. */
  notificarNativa?(d: DadosNotificacaoMaestro): void;
  escolherArquivoDeSaida?(nomeSugerido: string): Promise<string | null>;
  escolherArquivoDeEntrada?(): Promise<string | null>;
  /** remove valores do cofre de texto que vai a log/DB (padrão: identidade). */
  scrub?: (t: string) => string;
  agora?: () => number;
  avisar?: (mensagem: string) => void;
  /** intervalo do `tick` (padrão 30 s; teste: menor). */
  tickMs?: number;
  /** debounce dos observadores (padrão 300 ms). */
  debounceMs?: number;
  /** Fase 9: o Pane filho (respawn) criado pela troca de conta a partir de `pane_antigo`; `null` = desconhecido. */
  paneDeRespawn?: (pane_antigo: string) => string | null;
  /** injeção de teste do ServicoMaestro. */
  criarServico?: (portas: PortasServico) => ServicoMaestro;
  /** D-662: o hook `UserPromptSubmit` viu `/expx:<skill>` num painel livre (fora do Maestro); o painel de progresso acompanha. Ausente = ignora. */
  aoSkillDoUsuario?(e: { workspace_id: string; pane_id: string; skill: string }): void;
  /** Fase 15: portas de RAG presas ao workspace (`consultar` antes da etapa e `aprender` ao concluir); ausente/`null` = sem RAG. */
  rag?: (workspaceId: string) => import("./conhecimento").PortasRagDoMaestro | null;
}

export interface LigacaoMaestro {
  /** Cria o serviço sob demanda (nada no boot). */
  servico(): Promise<ServicoMaestro>;
  pedir(p: PedidoPedirMaestro): Promise<RespostaPedirMaestro>;
  confirmar(p: PedidoConfirmarMaestro): Promise<PipelineResumo>;
  cancelar(id: string): Promise<{ ok: true }>;
  listarPipelines(p: PedidoListarPipelines): Promise<PipelineResumo[]>;
  detalhe(id: string): Promise<DetalhePipeline | null>;
  acao(p: PedidoAcaoPipeline): Promise<PipelineResumo>;
  listarRecibos(p: PedidoListarRecibos): Promise<ReciboMaestro[]>;
  lerConfig(workspaceId: string): ConfigMaestroDto;
  gravarConfig(p: PedidoGravarConfigMaestro): ConfigMaestroDto;
  catalogo(): CatalogoPipelines;
  listarConfigEtapas(workspaceId: string | null): EtapaConfigEfetiva[];
  gravarConfigEtapa(p: PedidoConfigGravar): Promise<ResultadoConfigGravar>;
  restaurarConfig(p: PedidoConfigRestaurar): EtapaConfigEfetiva[];
  validar(workspaceId: string | null, configs: EtapaConfig[]): AchadoPipeline[];
  perfisProntos(): PerfilProntoDto[];
  aplicarPronto(p: PedidoAplicarPronto): Promise<EtapaConfigEfetiva[]>;
  exportar(p: PedidoExportarPipelines): Promise<ResultadoExportarPipelines>;
  importarPrevia(p: PedidoImportarPreviaPipelines): Promise<PreviaImportacaoPipelines>;
  importarConfirmar(p: PedidoImportarConfirmarPipelines): EtapaConfigEfetiva[];
  lerRigidez(p: PedidoLerRigidez): Promise<EstadoRigidez>;
  definirRigidez(p: PedidoDefinirRigidez): Promise<ResultadoDefinirRigidez>;
  matriz(): MatrizRigidezDto;
  previaPlano(p: PedidoPreviaPlano): Promise<import("../compartilhado/maestro").EtapaDoPlano[]>;
  hooksEstado(p: PedidoHooksEstado): Promise<EstadoHooksDto>;
  hooksReverter(p: PedidoHooksEstado): Promise<{ revertidas: string[] }>;
  /** O Maestro visto pela orquestração (tool `maestro_request` e hook `UserPromptSubmit`). Nunca `null`: o serviço nasce no primeiro uso, não aqui. */
  paraOrquestracao(): MaestroDaOrquestracao;
  /** Onda 2 (ocioso): assina os eventos e, SÓ com pipeline ativo, retoma e arma o temporizador. Idempotente. */
  iniciar(): Promise<void>;
  /** há pipeline não terminal (temporizador/observadores só então). */
  temPipelineAtivo(): boolean;
  encerrar(): void;
}

// ---------------------------------------------------------------- utilidades
const CHAVE_CONFIG = (ws: string): string => `maestro.config.${ws}`;
const TICK_MS = 30_000;
const DEBOUNCE_MS = 300;
const PREVIA_VALIDADE_MS = 10 * 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const terminal = (e: PipelineEstado["estado"]): boolean => ESTADOS_PIPELINE_TERMINAIS.includes(e);
const TIPO_DO_PIPELINE: Readonly<Partial<Record<PipelineId, Trabalho["tipo"]>>> = { runx: "ocorrencia", sprintx: "feature", sprintx_legadox: "feature", prodx: "pedido", buildx: "projeto" };
const RELS_FIXOS = [
  "docs/produto/PRODUTO.md", "docs/produto/pedidos/INDICE.md", "docs/legado/PERFIL.md", "docs/legado/DIVIDA.md", "docs/legado/MANUAL.md", "docs/stack/CONVENCOES.md", "docs/design-system/DESIGN-SYSTEM.md", "docs/design-system/AUDIT.md",
] as const;
const relsDoTrabalho = (t: Pick<Trabalho, "id" | "tipo" | "pasta">): string[] => {
  const ref = refDoTrabalho(t);
  return [`${t.pasta}/QA.md`, `${t.pasta}/00-ESTIMATIVA.md`, `${t.pasta}/00-AUDITORIA.md`, `docs/entregas/${ref}/ATENCAO.md`, `docs/entregas/${ref}/QA-PACOTE.md`, `docs/entregas/${ref}/PR.md`, `docs/legado/caracterizacao/${ref}.md`];
};
const relSeguro = (rel: string): boolean => !rel.includes("..") && !rel.startsWith("/") && !rel.includes("\0") && !/^[A-Za-z]:/.test(rel);

/** Sondas por `stat` ASSÍNCRONO de um conjunto fixo de caminhos; o resultado é uma tabela síncrona (o núcleo só consulta). */
export async function montarSondas(raiz: string, rels: readonly string[]): Promise<SondaDeDisco> {
  const tabela = new Map<string, number>();
  await Promise.all(
    [...new Set(rels)].filter(relSeguro).map(async (rel) => {
      try {
        const s = await stat(join(raiz, rel));
        if (s.isFile()) tabela.set(rel, s.mtimeMs);
      } catch {
        /* ausente */
      }
    }),
  );
  return { existe: (r) => tabela.has(r), mtime: (r) => tabela.get(r) ?? null };
}

const DTO_CONFIG = (c: ConfigMaestro): ConfigMaestroDto => ({
  confirmar_plano: c.confirmar_plano, hook_modo: c.hook_modo, hook_confianca_min: c.hook_confianca_min, producao: c.producao, branches_protegidas: [...c.branches_protegidas], escrever_hooks: c.escrever_hooks,
  hooks_aplicar_ja: c.hooks_aplicar_ja, max_terminais: c.max_terminais, fechar_concluidos: c.fechar_concluidos, timeout_sem_progresso_min: c.timeout_sem_progresso_min, proposta_expira_min: c.proposta_expira_min,
});

const TEXTO_NOTIFICACAO: Readonly<Record<NotificacaoMaestro["motivo"], string>> = {
  humano: "Precisa de você",
  raio_alto: "Raio ALTO: aprovação humana",
  confirmacao: "Confirmação necessária",
  usuario_responde: "O método está perguntando no terminal",
  sem_progresso: "Sem progresso",
  trava: "Trava de segurança",
  piso: "Piso de qualidade violado",
  falhou: "Etapa falhou",
  concluido: "Pipeline concluído",
  limite_de_voltas: "Limite de voltas atingido",
  expirado: "Proposta expirou",
};

export function ligarMaestro(d: DependenciasMaestro): LigacaoMaestro {
  const { repos } = d;
  const repo = repos.maestro;
  const agora = d.agora ?? Date.now;
  const avisar = (m: string): void => d.avisar?.(m);
  const scrub = d.scrub ?? ((t: string) => t);
  let servicoCriado: ServicoMaestro | null = null;
  let criando: Promise<ServicoMaestro> | null = null;
  let iniciado = false;
  let encerrado = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const desassinar: Array<() => void> = [];
  const debounces = new Map<string, ReturnType<typeof setTimeout>>();
  /** pipeline ativo → (workspace, Panes): os eventos de Pane consultam este mapa, nunca o banco. */
  const ativos = new Map<string, { ws: string; panes: Set<string> }>();
  const raizPorPipeline = new Map<string, string>();
  const raizPorTrabalho = new Map<string, string>();
  const brancheCache = new Map<string, { em: number; branch: string | null }>();
  const pisoCache = new Map<string, { chave: string; itens: ItemDePiso[] }>();
  const previas = new Map<string, { ws: string | null; configs: EtapaConfig[]; expira: number }>();
  let seqPrevia = 0;

  // ---------------------------------------------------------------- leitura de workspace/config
  const workspace = (id: string): Workspace => d.workspaces.exigir(id);
  const configDoWorkspace = (ws: string): ConfigMaestro => {
    const bruto = repos.config.obter<Record<string, unknown>>(CHAVE_CONFIG(ws));
    // `confirmar_plano = false` só chega aqui por `gravarConfig` (que exige `confirmado: true`): ao ler, vale o que foi gravado
    const base = normalizarConfigMaestro(bruto ?? {}, { confirmado: bruto?.confirmar_plano === false });
    return { ...base, permissao: d.workspaces.permissaoDe(ws) };
  };
  const raizDoPipeline = (id: string, ws: string): string => raizPorPipeline.get(id) ?? workspace(ws).raiz;
  const wsDoPipelineId = (id: string): string | null => ativos.get(id)?.ws ?? repo.carregarPipeline(id)?.workspace_id ?? null;

  // ---------------------------------------------------------------- cache de ativos (alimenta os observadores sem tocar o banco)
  const atualizarAtivo = (p: PipelineEstado): void => {
    if (terminal(p.estado)) {
      ativos.delete(p.id);
      pisoCache.delete(p.id);
      return;
    }
    ativos.set(p.id, { ws: p.workspace_id, panes: new Set(p.execs.map((e) => e.pane_id).filter((x): x is string => x !== null)) });
  };
  const emitirEvento = (p: PipelineEstado): void => {
    const e = p.execs.find((x) => x.estado === "executando" || x.estado === "despachando" || x.estado.startsWith("aguardando")) ?? null;
    const payload: EventoMaestro = { workspace_id: p.workspace_id, pipeline_id: p.id, tipo: "pipeline", estado: p.estado, etapa_id: e?.etapa_id ?? null };
    d.barramento.emitirCoalescido("maestro:evento", p.id, payload, 250); // no máximo 1 a cada 250 ms por pipeline
  };

  // ---------------------------------------------------------------- persistência (PortaPersistencia sobre o repositório SQLite)
  const persistencia: PortaPersistencia = {
    async salvar(p) {
      repo.salvarPipeline(p);
      atualizarAtivo(p);
      emitirEvento(p);
      if (!terminal(p.estado)) armarTimer();
    },
    async carregar(id) {
      return repo.carregarPipeline(id);
    },
    async listarAtivos(ws) {
      return repo.listarAtivos(ws);
    },
    async salvarRecibo(r, dados) {
      repo.salvarRecibo(r, dados);
    },
    async lerRecibo(pipelineId) {
      return repo.lerRecibo(pipelineId);
    },
    async registrarRigidezLog(e) {
      repo.registrarRigidezLog({ ...e, mission_id: null });
    },
  };

  // ---------------------------------------------------------------- método (disco)
  const trabalhosDoWorkspace = async (ws: string): Promise<{ indices: IndicesPorRaiz; raiz: string }> => {
    const w = workspace(ws);
    if (d.metodo.estado(ws) === null) await d.metodo.garantir({ id: w.id, raiz: w.raiz, e_git: w.e_git }).catch(() => undefined);
    return { indices: await d.metodo.indices(ws), raiz: w.raiz };
  };
  const branchDe = async (raiz: string): Promise<string | null> => {
    const c = brancheCache.get(raiz);
    if (c !== undefined && agora() - c.em < 5_000) return c.branch;
    const b = await branchAtual(raiz).catch(() => null);
    brancheCache.set(raiz, { em: agora(), branch: b });
    return b;
  };
  const evidenciaDe = (ws: string, raiz: string, t: Trabalho | null, indices: IndicesPorRaiz): EvidenciaDoDisco => {
    const camadas = (indices.get(raiz) ?? indices.get(workspace(ws).raiz))?.camadas;
    const faixa = t?.raio?.faixa;
    return {
      legado: camadas?.perfil_legado ?? false,
      perfil_legado: camadas?.perfil_legado ?? false,
      convencoes: camadas?.convencoes ?? false,
      design_system: camadas?.design_system ?? false,
      produto: camadas?.produto ?? true,
      raio: faixa === "baixo" || faixa === "medio" || faixa === "alto" ? faixa : null,
    };
  };
  const metodoPorta: PortasServico["metodo"] = {
    async contexto(ws, { trabalho_id }) {
      const { indices, raiz: wsRaiz } = await trabalhosDoWorkspace(ws);
      const achado = trabalho_id === null ? null : acharTrabalhoNoIndice(indices, wsRaiz, trabalho_id);
      const raiz = achado?.raiz ?? wsRaiz;
      if (achado !== null) raizPorTrabalho.set(achado.trabalho.id, raiz);
      const sondas = await montarSondas(raiz, [...RELS_FIXOS, ...(achado === null ? [] : relsDoTrabalho(achado.trabalho))]);
      const ultima = achado?.trabalho.ultima_atividade == null ? null : Date.parse(achado.trabalho.ultima_atividade);
      const ctx: ContextoDoMetodo = {
        trabalho: (achado?.trabalho as TrabalhoParaMaestro | undefined) ?? null,
        sondas,
        evidencia: evidenciaDe(ws, raiz, achado?.trabalho ?? null, indices),
        ultima_task_concluida_ms: null,
        ultima_mudanca_ms: ultima !== null && Number.isFinite(ultima) ? ultima : null,
        branch: await branchDe(raiz),
      };
      return ctx;
    },
    async slugsAbertos(ws) {
      const { indices } = await trabalhosDoWorkspace(ws);
      const ids = new Set<string>();
      for (const indice of indices.values()) for (const t of indice.trabalhos) if (t.status !== "concluido") ids.add(t.id);
      return [...ids].slice(0, 300);
    },
    async acharTrabalho(ws, ref) {
      const { indices, raiz: wsRaiz } = await trabalhosDoWorkspace(ws);
      let melhor: { trabalho: Trabalho; raiz: string } | null = null;
      for (const [raiz, indice] of indices) {
        for (const t of indice.trabalhos) {
          if (!(t.id === ref.id || t.id.startsWith(`${ref.id}-`))) continue;
          if (melhor === null || (t.ultima_atividade ?? "") > (melhor.trabalho.ultima_atividade ?? "") || ((t.ultima_atividade ?? "") === (melhor.trabalho.ultima_atividade ?? "") && raiz === wsRaiz)) melhor = { trabalho: t, raiz };
        }
      }
      if (melhor === null) return null;
      raizPorTrabalho.set(melhor.trabalho.id, melhor.raiz);
      return { trabalho: melhor.trabalho as TrabalhoParaMaestro, sondas: await montarSondas(melhor.raiz, [...RELS_FIXOS, ...relsDoTrabalho(melhor.trabalho)]) };
    },
    async descobrirTrabalho(ws, p, desdeMs) {
      const tipo = TIPO_DO_PIPELINE[p.pipeline_id];
      if (tipo === undefined) return null;
      const { indices, raiz: wsRaiz } = await trabalhosDoWorkspace(ws);
      const usados = new Set(repo.listarAtivos(ws).filter((a) => a.id !== p.id).map((a) => a.trabalho_id).filter((x): x is string => x !== null));
      let melhor: { id: string; em: number; raiz: string } | null = null;
      for (const [raiz, indice] of indices) {
        for (const t of indice.trabalhos) {
          if (t.tipo !== tipo || usados.has(t.id) || t.ultima_atividade === null) continue;
          const em = Date.parse(t.ultima_atividade);
          if (!Number.isFinite(em) || em < desdeMs - 1_000) continue;
          if (melhor === null || em > melhor.em || (em === melhor.em && raiz !== wsRaiz)) melhor = { id: t.id, em, raiz };
        }
      }
      if (melhor === null) return null;
      raizPorTrabalho.set(melhor.id, melhor.raiz);
      return melhor.id;
    },
  };

  // ---------------------------------------------------------------- arquivos do pipeline (dentro da pasta do produto; nunca em docs/**)
  const arquivos: PortasServico["arquivos"] = {
    async gravar(ws, rel, texto) {
      const id = /\/maestro\/([A-Za-z0-9_-]+)\//.exec(rel)?.[1];
      const raiz = id === undefined ? workspace(ws).raiz : raizDoPipeline(id, ws);
      // a pasta do produto nunca pode ser link simbólico (o alvo poderia estar fora do repositório)
      try {
        if ((await lstat(join(raiz, PRODUTO.pastaNoProjeto))).isSymbolicLink()) throw new Error(`${PRODUTO.pastaNoProjeto} é um link simbólico: o Maestro não escreve através dele`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await gravarNaPastaDoProduto(raiz, rel, texto);
    },
    async ler(ws, rel) {
      const id = /\/maestro\/([A-Za-z0-9_-]+)\//.exec(rel)?.[1];
      const raiz = id === undefined ? workspace(ws).raiz : raizDoPipeline(id, ws);
      const real = await resolverDentroReal(raiz, rel);
      if (real === null) return null;
      try {
        const s = await stat(real);
        if (!s.isFile() || s.size > 256 * 1024) return null;
        return await readFile(real, "utf8");
      } catch {
        return null;
      }
    },
  };

  // o despachante grava instruções/contexto pela MESMA porta de arquivos, resolvida pelo id do pipeline que vem no caminho
  const arquivosDoDespachante: PortasServico["despachante"]["arquivos"] = {
    gravar(rel, texto) {
      const id = /\/maestro\/([A-Za-z0-9_-]+)\//.exec(rel)?.[1];
      const ws = id === undefined ? null : wsDoPipelineId(id);
      return ws === null ? Promise.resolve() : arquivos.gravar(ws, rel, texto);
    },
  };

  // ---------------------------------------------------------------- Panes
  const panesPorta: PortasServico["despachante"]["panes"] = {
    async abrirPane(a: ArgsAbrirPane) {
      const ws = wsDoPipelineId(a.pipeline_id);
      if (ws === null) throw new Error("pipeline sem workspace");
      const ambiente: Record<string, string> = {};
      const r = await d.panes.abrirPane({
        ...(a.mission_id === null ? { workspace_id: ws } : { missao_id: a.mission_id }),
        cli: a.cli,
        papel: a.papel,
        modelo: a.modelo,
        esforco: a.esforco,
        conta_id: a.conta_id,
        prompt_inicial: a.prompt_inicial,
        ...(a.cwd === null ? {} : { cwd: a.cwd }),
        // o preparador (orquestração) e o token do MCP tratam `maestro_etapa` como Pane de etapa: sem tool e sem hook (anti-loop)
        contexto: { maestro_etapa: true, pipeline_id: a.pipeline_id, etapa_id: a.etapa_id },
        ...(Object.keys(ambiente).length === 0 ? {} : { ambiente }),
      });
      return { pane_id: r.pane.id };
    },
    async enviarComando(paneId, texto) {
      await d.panes.enviarComando(paneId, texto);
    },
    estado(paneId) {
      return (repos.pane.obter(paneId)?.estado as import("../nucleo/dominio/enums").EstadoPane | undefined) ?? null;
    },
  };

  // ---------------------------------------------------------------- perfis (config por etapa → fontes; harness → conta/modelo por consumo)
  const fontes = (ws: string): FontesDePerfil => {
    const doWs = new Map(repo.listarConfig(ws).map((l) => [l.config.etapa_id, l.config] as const));
    const global = new Map(repo.listarConfig(null).map((l) => [l.config.etapa_id, l.config] as const));
    return { workspace: (e) => doWs.get(e) ?? null, global: (e) => global.get(e) ?? null };
  };
  const harnessPorta: PortasServico["despachante"]["harness"] = {
    async resolverPerfilDeEtapa(skill, etapa, ctx, perfil) {
      const h = d.harness();
      if (h === null) return { ok: false, executor: null, cli: null, conta_id: null, faixa: null, recibo: "harness indisponível" } satisfies ResultadoDoHarness;
      const r = await h.resolvedor.resolverPerfilDeEtapa(skill, etapa, ctx, perfil);
      return {
        ok: r.ok,
        executor: r.executor === null ? null : { provider: r.executor.provider, cli: r.cli ?? null, model: r.executor.model ?? null, effort: r.executor.effort ?? null },
        cli: r.cli ?? null,
        conta_id: r.conta_id ?? null,
        faixa: r.faixa ?? null,
        recibo: r.recibo,
        erro: r.erro ?? null,
      };
    },
  };

  // ---------------------------------------------------------------- decisor externo (Fase 9; desligado por padrão: ZERO instâncias e ZERO rede)
  const configDoDecisor = (): ConfigDecisorMaestro => {
    const h = d.harness();
    if (h === null) return CONFIG_DECISOR_PADRAO;
    const c = h.decisorLer();
    const destino = destinoDoDecisor(c);
    const ok = c.habilitado && c.usar_para.intencao && consentimentoValido(c);
    return {
      habilitado: ok,
      fonte: c.modo === "jev_openrouter" ? "openrouter" : "jev_direto",
      consentimento_em: ok ? (c.consentimento?.em ?? null) : null,
      usar_no_hook: false,
      confianca_minima: c.confianca_minima,
      timeout_ms: c.timeout_ms,
      modelo: c.modelo,
      endpoint_host: destino?.host ?? null,
    };
  };
  const decisor = criarDecisorDeIntencao({
    config: configDoDecisor,
    criarAsk: (): PortaAsk => ({
      async ask(p) {
        const ativo = d.harness()?.decisorDeIntencao() ?? null;
        if (ativo === null) throw new Error("decisor desligado");
        const r = await ativo.ask({ kind: p.kind, purpose: p.purpose, question: p.question, options: p.options });
        return { probs: r.probs, choice: r.choice, confidence: r.confidence, latency_ms: r.latency_ms, cost_usd: r.cost_usd, raw_model: r.raw_model };
      },
    }),
    scrub,
  });

  // ---------------------------------------------------------------- piso (I1..I10) com varredura de segredo só quando há implementação concluída
  const calcularPiso = async (p: PipelineEstado, ctx: ContextoDoMetodo): Promise<ItemDePiso[]> => {
    const raiz = raizDoPipeline(p.id, p.workspace_id);
    const implementou = p.execs.some((e) => e.tipo === "implementador" && e.estado === "concluida");
    const chave = `${ctx.ultima_mudanca_ms ?? 0}|${p.execs.map((e) => e.estado).join(",")}|${implementou ? 1 : 0}`;
    const c = pisoCache.get(p.id);
    if (c !== undefined && c.chave === chave) return c.itens;
    let segredos: Awaited<ReturnType<typeof varrerSegredosNoDiff>> | undefined;
    if (implementou) {
      segredos = await varrerSegredosNoDiff({
        diff: async () => (await executarGit(["diff", "--no-color", "--no-ext-diff", "HEAD"], { cwd: raiz, timeoutMs: 4_000, maxBytes: 512 * 1024 })).stdout,
      });
    }
    const rel = p.execs.some((e) => e.etapa_id === "rapido.executar" && e.estado !== "pendente") ? lerRelatorioRapido(await arquivos.ler(p.workspace_id, caminhoRelatorioRapido(p.id)).catch(() => null)) : null;
    const itens = verificarPiso({
      pipeline_id: p.pipeline_id,
      nivel: p.nivel_atual,
      evidencia: ctx.evidencia,
      trabalho: ctx.trabalho,
      violacoes: (ctx.trabalho as Trabalho | null)?.violacoes ?? [],
      rapido: rel,
      ...(segredos === undefined ? {} : { segredos }),
      plano: p.plano.etapas,
      execs: p.execs.map((e) => ({ etapa_id: e.etapa_id, tipo: e.tipo, pane_id: e.pane_id, reutilizou_pane: e.reutilizou_pane, perfil: e.perfil === null ? null : { cli: e.perfil.cli, modelo: e.perfil.modelo }, despachada: e.comando !== null, comando: e.comando })),
      cli_implementador: p.execs.find((e) => e.tipo === "implementador" && e.perfil !== null)?.perfil?.cli ?? null,
      permissao: configDoWorkspace(p.workspace_id).permissao,
      pr_confirmado: p.execs.some((e) => e.etapa_id === "mergex.pr" && e.confirmada),
    });
    pisoCache.set(p.id, { chave, itens });
    return itens;
  };

  // ---------------------------------------------------------------- hooks.json do diretório onde as etapas rodam
  const portaHooks = (ws: string, p: PipelineEstado | null): ReturnType<typeof criarPortaArquivosHooksNode> | null => {
    try {
      return criarPortaArquivosHooksNode(p === null ? workspace(ws).raiz : raizDoPipeline(p.id, ws));
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------- notificação
  const notificar = (n: NotificacaoMaestro): void => {
    d.barramento.emitir("maestro.notification", { pipeline_id: n.pipeline_id, motivo: n.motivo, etapa_id: n.etapa_id });
    try {
      d.notificarNativa?.({ title: `${PRODUTO.nome}: ${TEXTO_NOTIFICACAO[n.motivo]}`, body: [...scrub(n.detalhe)].slice(0, 200).join("") });
    } catch {
      /* acessório */
    }
  };

  const leitoresDeNivel: LeitoresDeNivel = {
    async workspace(ws) {
      return repo.lerRigidez("workspace", ws)?.nivel ?? null;
    },
    async missao(m) {
      return repo.lerRigidez("missao", m)?.nivel ?? null;
    },
  };

  // ---------------------------------------------------------------- serviço (sob demanda)
  async function servico(): Promise<ServicoMaestro> {
    if (servicoCriado !== null) return servicoCriado;
    criando ??= Promise.resolve().then(() => {
      const portas: PortasServico = {
        relogio: { agora },
        novoId: (prefixo) => `${prefixo}_${agora().toString(36)}${Math.random().toString(36).slice(2, 10)}`.replace(/[^A-Za-z0-9_]/g, ""),
        persistencia,
        metodo: metodoPorta,
        niveis: leitoresDeNivel,
        config: (ws) => configDoWorkspace(ws),
        // Fase 15: registra a consulta ao RAG antes da etapa (cumpre a regra de consulta obrigatória) e o aprendizado ao concluir; falha nunca bloqueia
        ...(d.rag === undefined
          ? {}
          : {
              async consultar(ws: string, etapa: import("../compartilhado/maestro").EtapaId, texto: string): Promise<void> {
                await d.rag?.(ws)?.consultar(etapa, texto);
              },
              async aprender(p: import("../compartilhado/maestro").PipelineEstado): Promise<void> {
                await d.rag?.(p.workspace_id)?.aprender({ titulo: `Pipeline ${p.pipeline_id} (${p.intencao})`, texto: `${p.texto_resumo} — ${p.motivo_fim ?? "concluído"}`, tipo: "fato", mission_id: p.mission_id });
              },
            }),
        // T-16.21: o pipeline de trabalho (bug, feature, refatoração, pedido, projeto) ganha a Missão dele ao confirmar; qualquer falha segue sem Missão
        ...(d.missoes === undefined
          ? {}
          : {
              async criarMissao(p: PipelineEstado): Promise<string | null> {
                const origem = ORIGEM_DA_INTENCAO[p.intencao];
                if (origem === undefined) return null;
                const titulo = [...scrub(p.texto_resumo).replace(/\s+/g, " ").trim()].slice(0, 120).join("") || `Pipeline ${p.pipeline_id}`;
                const m = await d.missoes?.criar({ workspace_id: p.workspace_id, modo: "livre", origem, titulo, pedido: "", clis: {} }, { sem_worktree: true });
                return m?.id ?? null;
              },
            }),
        despachante: {
          panes: panesPorta,
          harness: harnessPorta,
          fontes,
          arquivos: arquivosDoDespachante,
          // Fase 15: contexto prévio do RAG do workspace do pipeline (leitura preguiçosa; ≤ 150 ms no despachante; falha segue sem o bloco)
          ...(d.rag === undefined ? {} : { conhecimento: { contextoPrevio: async (texto: string, arquivos: string[], ws: string) => (await d.rag?.(ws)?.conhecimento.contextoPrevio(texto, arquivos)) ?? null } }),
          cwdDoPipeline(p, trabalho) {
            const raiz = trabalho === null ? raizPorPipeline.get(p.id) ?? workspace(p.workspace_id).raiz : (raizPorTrabalho.get(trabalho.id) ?? workspace(p.workspace_id).raiz);
            raizPorPipeline.set(p.id, raiz);
            return raiz;
          },
        },
        arquivos,
        hooks: portaHooks,
        decisor,
        piso: calcularPiso,
        estadosDosPanes(ids) {
          const saida: Record<string, { estado: import("../nucleo/dominio/enums").EstadoPane }> = {};
          for (const id of ids) {
            const pane = repos.pane.obter(id);
            if (pane !== undefined) saida[id] = { estado: pane.estado as import("../nucleo/dominio/enums").EstadoPane };
          }
          return saida;
        },
        async fecharPane(id) {
          await d.panes.encerrarPane(id, "maestro_etapa_concluida");
        },
        async restaurarNivel(p) {
          if (p.mission_id === null) return;
          const g = repo.lerRigidez("missao", p.mission_id);
          if (g === null || !g.voltar_ao_padrao) return;
          repo.removerRigidez("missao", p.mission_id);
          repo.registrarRigidezLog({ ts: iso(agora()), workspace_id: p.workspace_id, mission_id: p.mission_id, pipeline_id: p.id, etapa_atual: null, escopo: "missao", de: g.nivel, para: 3, por: "sistema", trava: null, justificativa: null, hooks_escritos: false });
          d.emitirRenderer("rigidez:evento", { workspace_id: p.workspace_id, mission_id: p.mission_id, nivel: 3, escopo: "missao" });
        },
        notificar,
        ...(d.modulosDesligados === undefined ? {} : { modulosDesligados: d.modulosDesligados }),
        evento: (e) => {
          // nomes de domínio (`maestro.*`) para quem escuta o barramento; o recibo/Pane não passam por aqui
          d.barramento.emitir(e.tipo, { pipeline_id: e.pipeline_id, ...(e.detalhe === undefined ? {} : { detalhe: e.detalhe }) });
        },
      };
      const s = (d.criarServico ?? criarServicoMaestro)(portas);
      servicoCriado = s;
      return s;
    });
    return criando;
  }

  // ---------------------------------------------------------------- orquestração (tool MCP + hook): lazy, o serviço só nasce quando alguém pede
  const donoDoPane = (id: string): boolean => servicoCriado?.ehPaneDoMaestro(id) === true || [...ativos.values()].some((a) => a.panes.has(id));
  const servicoParaMcp = {
    pedir: async (p: Parameters<ServicoMaestro["pedir"]>[0]) => {
      const r = await (await servico()).pedir(p);
      armarTimerSeAtivo();
      return r;
    },
    estado: async (id: string) => (await servico()).estado(id),
    status: async (ws: string) => (await servico()).status(ws),
    ehPaneDoMaestro: donoDoPane,
  };
  const configOuPadrao = (ws: string): ConfigMaestro => {
    try {
      return configDoWorkspace(ws);
    } catch {
      return normalizarConfigMaestro({});
    }
  };
  const paraOrquestracaoObj: MaestroDaOrquestracao = {
    portaMcp: criarPortaMaestroMcp(servicoParaMcp, { niveis: leitoresDeNivel }),
    ehPaneDoMaestro: donoDoPane,
    hookAtivo: (ws) => configOuPadrao(ws).hook_modo !== "desligado",
    gancho: criarGanchoMaestroPrompt({
      classificar: async (texto, ctx) => (await servico()).classificar(texto, ctx),
      pedir: servicoParaMcp.pedir,
      ehPaneDoMaestro: donoDoPane,
      config: configOuPadrao,
      evento: (e) => d.barramento.emitir(e.tipo, { pipeline_id: e.pipeline_id, ...(e.detalhe === undefined ? {} : { detalhe: e.detalhe }) }),
      ...(d.aoSkillDoUsuario === undefined ? {} : { skillDetectada: d.aoSkillDoUsuario }),
    }),
  };

  // ---------------------------------------------------------------- temporizador (30 s, só com pipeline ativo) e observadores
  function armarTimer(): void {
    if (timer !== null || encerrado) return;
    timer = setInterval(() => {
      if (ativos.size === 0 || servicoCriado === null) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        return;
      }
      void servicoCriado.tick().catch((e: unknown) => avisar(`maestro tick: ${e instanceof Error ? e.message : String(e)}`));
    }, d.tickMs ?? TICK_MS);
    timer.unref?.();
  }
  const agendarAvanco = (id: string): void => {
    if (encerrado || debounces.has(id)) return;
    debounces.set(
      id,
      setTimeout(() => {
        debounces.delete(id);
        if (servicoCriado === null || !ativos.has(id)) return;
        void servicoCriado.avancarPipeline(id).catch((e: unknown) => avisar(`maestro avancar: ${e instanceof Error ? e.message : String(e)}`));
      }, d.debounceMs ?? DEBOUNCE_MS),
    );
    debounces.get(id)?.unref?.();
  };

  // ---------------------------------------------------------------- IPC: pedido, confirmação, ações
  const contextoSeguro = (c: PedidoPedirMaestro["contexto"], ws: string): PedidoPedirMaestro["contexto"] => {
    if (c === null) return null;
    if (c.mission_id !== null && repos.mission.obter(c.mission_id)?.workspace_id !== ws) throw new ErroDeMaestroIpc("invalid_argument", "Missão fora do workspace");
    if (c.pane_id !== null && repos.pane.obter(c.pane_id)?.workspace_id !== ws) throw new ErroDeMaestroIpc("invalid_argument", "painel fora do workspace");
    return {
      pane_id: c.pane_id,
      mission_id: c.mission_id,
      trabalho_id: c.trabalho_id,
      arquivos: c.arquivos.filter(relSeguro).slice(0, 20),
      // a seleção do terminal pode carregar segredo: sai redigida (e curta) antes de qualquer uso
      trecho: c.trecho === null ? null : resumirParaDecisor(scrub(c.trecho), { max: 500 }),
    };
  };
  const comTrava = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      throw sanearErroDeMaestro(e);
    }
  };

  async function pedir(p: PedidoPedirMaestro): Promise<RespostaPedirMaestro> {
    workspace(p.workspace_id);
    return comTrava(async () => {
      const s = await servico();
      const r = await s.pedir({ workspace_id: p.workspace_id, texto: p.texto, contexto: contextoSeguro(p.contexto, p.workspace_id), via: p.via, nivel_pedido: p.nivel_pedido, executar_direto: p.executar_direto });
      armarTimerSeAtivo();
      return r;
    });
  }
  function armarTimerSeAtivo(): void {
    if (ativos.size > 0) armarTimer();
  }

  const resumoDe = (p: PipelineEstado): PipelineResumo => resumoDoPipeline(p) as PipelineResumo;

  // ---------------------------------------------------------------- rigidez
  const ctxDeTrava = async (ws: string, mission: string | null): Promise<{ ctx: ContextoTrava; cfg: ConfigMaestro; ativo: PipelineEstado | null }> => {
    const cfg = configDoWorkspace(ws);
    const ativo = repo.listarAtivos(ws).filter((a) => mission === null || a.mission_id === mission).at(-1) ?? null;
    const raiz = ativo === null ? workspace(ws).raiz : raizDoPipeline(ativo.id, ws);
    let raio: ContextoTrava["raio_faixa"] = null;
    if (ativo?.trabalho_id != null) {
      const { indices, raiz: wsRaiz } = await trabalhosDoWorkspace(ws);
      const f = acharTrabalhoNoIndice(indices, wsRaiz, ativo.trabalho_id)?.trabalho.raio?.faixa;
      raio = f === "baixo" || f === "medio" || f === "alto" ? f : null;
    }
    return { ctx: { raio_faixa: raio, branch: await branchDe(raiz), branches_protegidas: cfg.branches_protegidas, producao: cfg.producao }, cfg, ativo };
  };
  async function lerRigidez(p: PedidoLerRigidez): Promise<EstadoRigidez> {
    workspace(p.workspace_id);
    const ws = repo.lerRigidez("workspace", p.workspace_id)?.nivel ?? null;
    const missao = p.mission_id === null ? null : (repo.lerRigidez("missao", p.mission_id)?.nivel ?? null);
    const plano = p.plano_id === null ? null : repo.carregarPipeline(p.plano_id);
    const { ctx, ativo } = await ctxDeTrava(p.workspace_id, p.mission_id);
    const minimo = nivelMinimoTravado({ raio_faixa: ctx.raio_faixa });
    const efetivo = resolverNivel({ pedido: plano?.nivel_pedido ?? null, missao, workspace: ws, minimo_travado: minimo.minimo, motivo_trava: minimo.motivo, override_trava: (plano ?? ativo)?.override_trava === true });
    return {
      efetivo: efetivo.efetivo,
      origem: efetivo.origem,
      workspace: (ws ?? null) as NivelRigidez | null,
      missao: (missao ?? null) as NivelRigidez | null,
      minimo_travado: efetivo.minimo_travado,
      motivo_trava: efetivo.motivo_trava,
      lembrete: efetivo.efetivo < 3 ? `Rigidez ${NIVEIS[efetivo.efetivo].nome} (nível ${efetivo.efetivo}): o método roda mais leve que o Padrão.` : null,
    };
  }
  async function definirRigidez(p: PedidoDefinirRigidez): Promise<ResultadoDefinirRigidez> {
    workspace(p.workspace_id);
    return comTrava(async () => {
      const antes = await lerRigidez({ workspace_id: p.workspace_id, mission_id: p.mission_id, plano_id: p.plano_id });
      if (p.escopo === "pedido") {
        if (p.plano_id === null) throw new MaestroErro("invalid_argument", "plano_id é obrigatório no escopo pedido");
        const pe = repo.carregarPipeline(p.plano_id);
        if (pe === null) throw new MaestroErro("plano_inexistente", "pipeline não encontrado");
        if (pe.estado === "proposto") throw new MaestroErro("estado_invalido", "mude o nível ao executar o plano");
        const s = await servico();
        const r = await s.mudarNivel(p.plano_id, p.nivel, { via: "ui", justificativa: p.justificativa, confirmacao_digitada: p.confirmacao_digitada, aplicar_hooks_ja: p.aplicar_hooks_ja });
        d.emitirRenderer("rigidez:evento", { workspace_id: p.workspace_id, mission_id: p.mission_id, nivel: r.efetivo, escopo: "pedido" });
        return { efetivo: r.efetivo, hooks: r.hooks, estado: await lerRigidez({ workspace_id: p.workspace_id, mission_id: p.mission_id, plano_id: p.plano_id }) };
      }
      if (p.escopo === "missao" && p.mission_id === null) throw new MaestroErro("invalid_argument", "mission_id é obrigatório no escopo missão");
      const { ctx, cfg } = await ctxDeTrava(p.workspace_id, p.escopo === "missao" ? p.mission_id : null);
      const m = avaliarMudancaDeNivel({ via: "ui", de: antes.efetivo, para: p.nivel, ctx, justificativa: p.justificativa, confirmacao_digitada: p.confirmacao_digitada });
      if (!m.ok) throw new MaestroErro(m.erro, m.mensagem);
      if (p.escopo === "workspace") repo.gravarRigidez("workspace", p.workspace_id, p.nivel, false);
      else repo.gravarRigidez("missao", p.mission_id as string, p.nivel, p.voltar_ao_padrao);
      // única escrita em área do método, por ação do usuário e com backup (D-221); `.expx/` ausente = não cria nada
      let hooks: ResultadoDefinirRigidez["hooks"] = { escrito: false, agendado: false, arquivo: null, aviso: null };
      const porta = portaHooks(p.workspace_id, null);
      if (porta !== null && cfg.escrever_hooks) {
        const evidenciaLegado = (d.metodo.estado(p.workspace_id)?.camadas.perfil_legado ?? false) === true;
        const h = await aplicarHooks(porta, p.nivel, { legado: evidenciaLegado, escrever_hooks: true, agendar: false }).catch(() => null);
        hooks = h === null ? { ...hooks, aviso: "Não consegui gravar o hooks.json (link simbólico ou sem permissão): nada foi alterado." } : { escrito: h.escrito, agendado: h.agendado, arquivo: h.arquivo, aviso: h.aviso };
        if (h?.escrito === true) d.barramento.emitir("maestro.hooks_written", { pipeline_id: null });
      }
      repo.registrarRigidezLog({ ts: iso(agora()), workspace_id: p.workspace_id, mission_id: p.mission_id, pipeline_id: null, etapa_atual: null, escopo: p.escopo, de: antes.efetivo, para: p.nivel, por: "usuario", trava: m.log.trava, justificativa: m.log.justificativa, hooks_escritos: hooks.escrito, arquivo_hooks: hooks.arquivo });
      d.barramento.emitir("maestro.rigidez_changed", { escopo: p.escopo, de: antes.efetivo, para: p.nivel });
      d.emitirRenderer("rigidez:evento", { workspace_id: p.workspace_id, mission_id: p.mission_id, nivel: p.nivel, escopo: p.escopo });
      return { efetivo: p.nivel, hooks, estado: await lerRigidez({ workspace_id: p.workspace_id, mission_id: p.mission_id, plano_id: null }) };
    });
  }

  // ---------------------------------------------------------------- configuração por etapa
  const estaticoDeNivel = (): MatrizRigidezDto["niveis"] => ([1, 2, 3, 4, 5] as const).map((n) => ({ ...NIVEIS[n] }));
  const contextoDeValidacao = (nivel?: NivelRigidez): ContextoValidacao => {
    const conta = repos.conta.listar({ apenasHabilitadas: true, limite: 100 });
    const provedores = new Set(conta.itens.map((c) => c.provedor));
    const openrouter = new Set(repos.openrouterModelo.listar({ so_habilitados: true, limite: 500 }).itens.map((m) => m.id));
    return {
      ...(nivel === undefined ? {} : { nivel }),
      cli(cli) {
        if (cli === "auto") return null;
        let niveis: string[] | null = null;
        let modo: "flag" | "config" | "indicativo" | "nenhum" | null = null;
        try {
          const n = niveisDaCli(cli);
          niveis = n.niveis;
          modo = n.modo;
        } catch {
          /* CLI fora da tabela de esforço */
        }
        const modelos = modelosDaFerramenta(cli).map((m) => m.modelo);
        return { modelos: modelos.length === 0 ? null : modelos, niveis_esforco: niveis, modo_esforco: modo };
      },
      provedorDaCli: (cli) => (cli === "auto" ? null : cli),
      provedoresHabilitados: provedores.size,
      modelosOpenRouter: openrouter,
    };
  };
  const efetivas = (ws: string | null): EtapaConfigEfetiva[] => {
    const doWs = new Map(ws === null ? [] : repo.listarConfig(ws).map((l) => [l.config.etapa_id, l.config] as const));
    const global = new Map(repo.listarConfig(null).map((l) => [l.config.etapa_id, l.config] as const));
    return ETAPAS.filter((e) => !e.humano).map((e) => {
      const w = doWs.get(e.id);
      if (w !== undefined) return { config: w, origem: "workspace" as const };
      const g = global.get(e.id);
      if (g !== undefined) return { config: g, origem: "global" as const };
      return { config: configDeFabrica(e.id), origem: "fabrica" as const };
    });
  };
  const achados = (cfgs: readonly EtapaConfig[], nivel?: NivelRigidez): AchadoPipeline[] => validarConfig(cfgs, contextoDeValidacao(nivel)).map((a) => ({ codigo: a.codigo, severidade: a.severidade, etapa_id: a.etapa_id, mensagem: a.mensagem, ...(a.relacionadas === undefined ? {} : { relacionadas: a.relacionadas }) }));
  const exigirWs = (ws: string | null): void => {
    if (ws !== null) workspace(ws);
  };
  const guardar = (ws: string | null, c: EtapaConfig): void => repo.gravarConfig(ws, { ...c, atualizado_por: c.atualizado_por === "fabrica" ? "usuario" : c.atualizado_por });

  async function lerArquivoImportacao(origem: "repo" | "arquivo", ws: string | null): Promise<string | null> {
    if (origem === "repo") {
      if (ws === null) throw new MaestroErro("invalid_argument", "workspace obrigatório para importar do repositório");
      const real = await resolverDentroReal(workspace(ws).raiz, CAMINHO_DE_EXPORTACAO);
      if (real === null) return null;
      const s = await stat(real);
      if (!s.isFile() || s.size > TAMANHO_MAX_IMPORTACAO) throw new MaestroErro("invalid_argument", "arquivo grande demais");
      return readFile(real, "utf8");
    }
    const alvo = (await d.escolherArquivoDeEntrada?.()) ?? null;
    if (alvo === null) return null;
    const s = await stat(alvo);
    if (!s.isFile() || s.size > TAMANHO_MAX_IMPORTACAO) throw new MaestroErro("invalid_argument", "arquivo grande demais");
    return readFile(alvo, "utf8");
  }

  // ---------------------------------------------------------------- detalhe
  const arquivoHumano = (p: PipelineEstado, trabalho: Pick<Trabalho, "id" | "tipo" | "pasta"> | null): string | null => {
    const e = p.execs.find((x) => x.estado === "aguardando_humano");
    if (e === undefined || trabalho === null) return null;
    if (e.etapa_id === "prodx.assinatura") return `${trabalho.pasta}/VEREDITO.md`;
    if (e.etapa_id === "mergex.revisar") return `docs/entregas/${refDoTrabalho(trabalho)}/PR.md`;
    return trabalho.pasta;
  };

  const ligacao: LigacaoMaestro = {
    servico,
    pedir,
    async confirmar(p) {
      return comTrava(async () => {
        const s = await servico();
        const r = await s.confirmar(p.plano_id, {
          ...(p.nivel === null ? {} : { nivel: p.nivel }),
          ...(p.etapas_desligadas.length === 0 ? {} : { etapas_desligadas: p.etapas_desligadas }),
          ...(p.intencao === null ? {} : { intencao: p.intencao }),
          ...(p.justificativa === null ? {} : { justificativa: p.justificativa }),
          ...(p.confirmacao_digitada === null ? {} : { confirmacao_digitada: p.confirmacao_digitada }),
        });
        armarTimerSeAtivo();
        return r as PipelineResumo;
      });
    },
    async cancelar(id) {
      return comTrava(async () => {
        await (await servico()).cancelar(id);
        return { ok: true as const };
      });
    },
    async listarPipelines(p) {
      workspace(p.workspace_id);
      return repo.listarPipelines(p.workspace_id, p.so_ativos, p.limite).map(resumoDe);
    },
    async detalhe(id) {
      const p = repo.carregarPipeline(id);
      if (p === null) return null;
      let piso: ItemDePisoDto[] = [];
      let trabalho: Pick<Trabalho, "id" | "tipo" | "pasta"> | null = null;
      try {
        const ctx = await metodoPorta.contexto(p.workspace_id, { trabalho_id: p.trabalho_id, pipeline_id: p.pipeline_id });
        trabalho = ctx.trabalho as Trabalho | null;
        piso = terminal(p.estado) && pisoCache.get(p.id) === undefined ? [] : (await calcularPiso(p, ctx)).map((i) => ({ id: i.id, titulo: i.titulo, estado: i.estado, detalhe: i.detalhe }));
      } catch {
        /* sem leitura do disco: o painel mostra o que há */
      }
      return {
        id: p.id, workspace_id: p.workspace_id, mission_id: p.mission_id, trabalho_id: p.trabalho_id, pipeline_id: p.pipeline_id, intencao: p.intencao, estado: p.estado, via: p.via, texto_resumo: p.texto_resumo,
        nivel_atual: p.nivel_atual, nivel_base: p.nivel_base, override_trava: p.override_trava, plano: p.plano, execs: p.execs, recibo: repo.lerRecibo(p.id), piso, motivo_fim: p.motivo_fim, criado_em: p.criado_em,
        atualizado_em: p.atualizado_em, concluido_em: p.concluido_em, arquivo_humano: arquivoHumano(p, trabalho),
      };
    },
    async acao(p) {
      return comTrava(async () => {
        const pe = repo.carregarPipeline(p.id);
        if (pe === null) throw new MaestroErro("plano_inexistente", "pipeline não encontrado");
        if (p.etapa_id !== null && !(ETAPA_IDS as readonly string[]).includes(p.etapa_id)) throw new MaestroErro("invalid_argument", "etapa fora do catálogo");
        if (p.acao === "abrir_arquivo") return resumoDe(pe); // só a UI mostra o caminho (`arquivo_humano` no detalhe); nada é aberto aqui
        const r = await (await servico()).acao(p.id, p.acao, p.etapa_id as EtapaId | null);
        armarTimerSeAtivo();
        return r as PipelineResumo;
      });
    },
    async listarRecibos(p) {
      workspace(p.workspace_id);
      return repo.listarRecibos(p.workspace_id, p.limite);
    },
    lerConfig(ws) {
      workspace(ws);
      return DTO_CONFIG(configDoWorkspace(ws));
    },
    gravarConfig(p) {
      workspace(p.workspace_id);
      const confirmar = p.config.confirmar_plano;
      if (!confirmar && !p.confirmado) throw new ErroDeMaestroIpc("confirmacao_necessaria", "desligar a confirmação do plano exige confirmação própria");
      const n = normalizarConfigMaestro(p.config, { confirmado: p.confirmado });
      // `confirmado` é exigido só ao DESLIGAR; o valor gravado carrega o booleano já confirmado
      repos.config.definir(CHAVE_CONFIG(p.workspace_id), DTO_CONFIG(n));
      return DTO_CONFIG(configDoWorkspace(p.workspace_id));
    },
    catalogo() {
      return {
        etapas: ETAPAS.map((e) => ({ id: e.id, skill: e.skill, nome: e.nome, comando: e.comando, tipo: e.tipo, interativa: e.interativa, humano: e.humano, piso: e.piso })),
        pipelines: Object.values(PIPELINES).map((pl) => ({ id: pl.id, nome: pl.nome, passos: pl.passos.map((x) => ({ etapa: x.etapa, piso: x.piso === true, laco: x.laco ?? null })) })),
        niveis: estaticoDeNivel(),
      };
    },
    listarConfigEtapas(ws) {
      exigirWs(ws);
      return efetivas(ws);
    },
    async gravarConfigEtapa(p) {
      exigirWs(p.workspace_id);
      if (etapaDef(p.config.etapa_id) === null || etapaDef(p.config.etapa_id)?.humano === true) throw new ErroDeMaestroIpc("invalid_argument", "etapa sem perfil configurável");
      const todas = efetivas(p.workspace_id).map((e) => (e.config.etapa_id === p.config.etapa_id ? p.config : e.config));
      const a = achados(todas);
      const meus = a.filter((x) => x.severidade === "erro" && (x.etapa_id === p.config.etapa_id || (x.relacionadas ?? []).includes(p.config.etapa_id)));
      if (meus.length > 0) throw new ErroDeMaestroIpc("perfil_invalido", meus[0]?.mensagem ?? "perfil inválido");
      guardar(p.workspace_id, { ...p.config, atualizado_por: "usuario" });
      const salvo = efetivas(p.workspace_id).find((e) => e.config.etapa_id === p.config.etapa_id) as EtapaConfigEfetiva;
      return { config: salvo, achados: a };
    },
    restaurarConfig(p) {
      exigirWs(p.workspace_id);
      repo.restaurarConfig(p.workspace_id, p.etapa_id);
      return efetivas(p.workspace_id);
    },
    validar(ws, configs) {
      exigirWs(ws);
      const porId = new Map(efetivas(ws).map((e) => [e.config.etapa_id, e.config] as const));
      for (const c of configs) porId.set(c.etapa_id, c);
      return achados([...porId.values()]);
    },
    perfisProntos() {
      return perfisProntosDoMaestro().map((x) => ({ id: x.id, nome: x.nome, descricao: x.descricao }));
    },
    async aplicarPronto(p) {
      exigirWs(p.workspace_id);
      const pronto = perfisProntosDoMaestro().find((x) => x.id === p.pronto_id);
      if (pronto === undefined) throw new ErroDeMaestroIpc("invalid_argument", "perfil pronto desconhecido");
      const atuais = efetivas(p.workspace_id).map((e) => e.config);
      const novos = aplicarPerfilProntoAsEtapas(pronto, atuais, { cli: p.cli, esforco: true });
      const a = achados(novos);
      if (temErro(validarConfig(novos, contextoDeValidacao()))) throw new ErroDeMaestroIpc("perfil_invalido", a.find((x) => x.severidade === "erro")?.mensagem ?? "perfil inválido");
      for (const c of novos) if (c.atualizado_por === "usuario") guardar(p.workspace_id, c);
      return efetivas(p.workspace_id);
    },
    async exportar(p) {
      exigirWs(p.workspace_id);
      const texto = exportarConfig(efetivas(p.workspace_id).map((e) => e.config));
      if (p.destino === "repo") {
        if (p.workspace_id === null) throw new ErroDeMaestroIpc("invalid_argument", "workspace obrigatório para exportar ao repositório");
        await arquivos.gravar(p.workspace_id, CAMINHO_DE_EXPORTACAO, texto);
        return { cancelado: false, caminho_relativo: CAMINHO_DE_EXPORTACAO };
      }
      const alvo = (await d.escolherArquivoDeSaida?.("pipelines.json")) ?? null;
      if (alvo === null) return { cancelado: true, caminho_relativo: null };
      await writeFile(alvo, texto, "utf8");
      return { cancelado: false, caminho_relativo: null };
    },
    async importarPrevia(p) {
      exigirWs(p.workspace_id);
      return comTrava(async () => {
        const texto = await lerArquivoImportacao(p.origem, p.workspace_id);
        if (texto === null) return { previa_id: null, configs: [], achados: [], erros: [], cancelado: p.origem === "arquivo" };
        const r = importarPrevia(texto, contextoDeValidacao());
        if (!r.ok) return { previa_id: null, configs: [], achados: [], erros: r.erros, cancelado: false };
        // a prévia também enxerga o conjunto resultante (etapas não importadas ficam como estão)
        const porId = new Map(efetivas(p.workspace_id).map((e) => [e.config.etapa_id, e.config] as const));
        for (const c of r.configs) porId.set(c.etapa_id, c);
        const id = `previa_${agora().toString(36)}_${++seqPrevia}`;
        previas.set(id, { ws: p.workspace_id, configs: r.configs, expira: agora() + PREVIA_VALIDADE_MS });
        for (const [k, v] of previas) if (v.expira < agora()) previas.delete(k);
        return { previa_id: id, configs: r.configs, achados: achados([...porId.values()]), erros: [], cancelado: false };
      });
    },
    importarConfirmar(p) {
      const previa = previas.get(p.previa_id);
      if (previa === undefined || previa.expira < agora() || previa.ws !== p.workspace_id) throw new ErroDeMaestroIpc("plano_inexistente", "a prévia expirou: importe de novo");
      const porId = new Map(efetivas(p.workspace_id).map((e) => [e.config.etapa_id, e.config] as const));
      for (const c of previa.configs) porId.set(c.etapa_id, c);
      if (temErro(validarConfig([...porId.values()], contextoDeValidacao()))) throw new ErroDeMaestroIpc("perfil_invalido", "a configuração importada tem erros: corrija antes de aplicar");
      for (const c of previa.configs) guardar(p.workspace_id, { ...c, atualizado_por: "importado" });
      previas.delete(p.previa_id);
      return efetivas(p.workspace_id);
    },
    lerRigidez,
    definirRigidez,
    matriz() {
      const celulas: MatrizRigidezDto["celulas"] = ETAPA_IDS.map((etapa) => {
        const por: Record<string, CelaDto> = {};
        for (const n of [1, 2, 3, 4, 5] as const) {
          const c = MATRIZ_RIGIDEZ[etapa][n];
          por[String(n)] = { modo: c.modo, agrupa: c.agrupa === true, avaliacoes: c.avaliacoes ?? null, confirma: c.confirma === true, nota: c.nota ?? null };
        }
        return { etapa_id: etapa, por_nivel: por };
      });
      const parametros: Record<string, Record<string, unknown>> = {};
      const hooks: Record<string, Record<string, "aviso" | "bloqueio" | "desligado">> = {};
      for (const n of [1, 2, 3, 4, 5] as const) {
        parametros[String(n)] = { ...PARAMETROS_POR_NIVEL[n] };
        hooks[String(n)] = { ...HOOKS_POR_NIVEL[n] } as Record<string, "aviso" | "bloqueio" | "desligado">;
      }
      return { niveis: estaticoDeNivel(), parametros, celulas, hooks_por_nivel: hooks };
    },
    async previaPlano(p) {
      workspace(p.workspace_id);
      const { indices, raiz } = await trabalhosDoWorkspace(p.workspace_id);
      return planoDeEtapas(p.pipeline_id, p.nivel, { evidencia: evidenciaDe(p.workspace_id, raiz, null, indices), permissao: d.workspaces.permissaoDe(p.workspace_id) });
    },
    async hooksEstado(p) {
      const w = workspace(p.workspace_id);
      const porta = criarPortaArquivosHooksNode(w.raiz);
      const e = await estadoDosHooks(porta);
      return { arquivo: e.arquivo, presente: e.presente, invalido: e.invalido, gerenciadas: e.gerenciadas, nivel_aplicado: e.nivel_aplicado, metodo_instalado: await porta.existeExpx() };
    },
    async hooksReverter(p) {
      workspace(p.workspace_id);
      return comTrava(async () => ({ revertidas: await (await servico()).reverterHooks(p.workspace_id, null) }));
    },
    paraOrquestracao: () => paraOrquestracaoObj,
    temPipelineAtivo: () => ativos.size > 0,
    async iniciar() {
      if (iniciado || encerrado) return;
      iniciado = true;
      // observadores baratos: só agem sobre pipeline ativo (mapa em memória), sem tocar o banco nem criar o serviço
      desassinar.push(
        d.barramento.assinar<{ workspace_id?: string }>("metodo:mudou", (e) => {
          for (const [id, a] of ativos) if (e?.workspace_id === undefined || a.ws === e.workspace_id) agendarAvanco(id);
        }),
        d.barramento.assinar<{ workspace_id?: string }>("method.changed", (e) => {
          for (const [id, a] of ativos) if (e?.workspace_id === undefined || a.ws === e.workspace_id) agendarAvanco(id);
        }),
        d.barramento.assinar<{ pane_id?: string }>("pane.state_changed", (e) => {
          if (typeof e?.pane_id !== "string") return;
          for (const [id, a] of ativos) if (a.panes.has(e.pane_id)) agendarAvanco(id);
        }),
        d.barramento.assinar<{ pane_id?: string; workspace_id?: string }>("account.switched", (e) => {
          // troca de conta no meio da etapa (Fase 9): `pane_id` é o Pane ANTIGO; o filho (respawn) é o mesmo trabalho em outra conta.
          // A etapa passa a apontar para ele (sem despachar de novo) e o pipeline reavalia pelo disco, que manda.
          if (typeof e?.pane_id !== "string") return;
          const antigo = e.pane_id;
          const dono = [...ativos.entries()].find(([, a]) => a.panes.has(antigo));
          if (dono === undefined) return;
          const novo = d.paneDeRespawn?.(antigo) ?? null;
          void (async () => {
            try {
              if (novo !== null && servicoCriado !== null && (await servicoCriado.adotarNovoPane(antigo, novo))) {
                const a = ativos.get(dono[0]);
                if (a !== undefined) a.panes.add(novo);
              }
            } catch (erro) {
              avisar(`maestro troca de conta: ${erro instanceof Error ? erro.message : String(erro)}`);
            }
            agendarAvanco(dono[0]);
          })();
        }),
        d.barramento.assinar<EventoMaestro>("maestro:evento", (e) => d.emitirRenderer("maestro:evento", e)),
      );
      const vivos = repo.listarAtivos(null);
      for (const p of vivos) atualizarAtivo(p);
      if (vivos.length > 0) {
        // retomada: reconstrói do banco + disco e segue, sem duplicar despacho
        const s = await servico();
        await s.retomarAposReinicio().catch((e: unknown) => avisar(`maestro retomada: ${e instanceof Error ? e.message : String(e)}`));
        armarTimer();
      }
      // retenção (recibo/etapa 90 d, log de rigidez 365 d): em lotes, em ocioso, sem bloquear o main
      const purga = (): void => {
        if (encerrado) return;
        let n = 0;
        try {
          n = repo.purgarLote(agora());
        } catch {
          return;
        }
        if (n > 0) setImmediate(purga);
      };
      setTimeout(purga, 15_000).unref?.();
    },
    encerrar() {
      encerrado = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      for (const t of debounces.values()) clearTimeout(t);
      debounces.clear();
      for (const f of desassinar.splice(0)) f();
    },
  };
  return ligacao;
}

// ---------------------------------------------------------------- porta do MCP (preguiçosa): o worker só conhece este contrato
let ligacaoAtual: LigacaoMaestro | null = null;
export function definirLigacaoMaestro(l: LigacaoMaestro | null): void {
  ligacaoAtual = l;
}
/** O serviço do Maestro para quem precisa dele tardiamente (MCP, hook): cria sob demanda; sem ligação ⇒ erro. */
export async function obterServicoMaestro(): Promise<ServicoMaestro> {
  if (ligacaoAtual === null) throw new Error("O Maestro ainda não iniciou.");
  return ligacaoAtual.servico();
}
