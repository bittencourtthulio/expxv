// Harness no main (Fase 9, T-09.14/15/16/17/24/25): junta os módulos puros de `nucleo/harness` ao banco, ao serviço de limites, ao cofre e à rede.
// Nada aqui decide rota por conta própria: `rotear` (roteador.ts) decide, `pickAccount` escolhe conta, `montarEquivalencia` monta a tabela.
// LEVEZA (P-01): `criarHarnessMain` só guarda referências; o que custa (semear, ler o arquivo de equivalência, retenção) roda em `iniciar()`
// na onda 2. O decisor externo só é INSTANCIADO com ele ligado e consentido; o cofre só é aberto quando alguém precisa da chave.
import { join } from "node:path";
import type {
  ConfigDecisor,
  ConfigDecisorEntrada,
  ConfigHarness,
  ConfigHarnessEntrada,
  ContaRoteamento,
  ContaRoteamentoEntrada,
  Decisao,
  EntradaEquivalencia,
  EstadoEquivalencia,
  PaginaDecisoes,
  PedidoListarDecisoes,
  PedidoResolverPerfil,
  Politica,
  PoliticaEntrada,
  ResultadoDeRota,
  ResultadoIntencao,
  ResultadoTesteDecisor,
  TabelaEquivalencia,
  TaskType,
  TaskTypeEntrada,
  ContextoIntencao,
  CandidataConta,
  OpcoesPick,
} from "../compartilhado/harness";
import type { AccountUsage, CotaGeral, RespostaLimites } from "../compartilhado/limites";
import type { Repositorios } from "../nucleo/banco/repos";
import type { Cofre } from "../nucleo/cofre";
import { criarDecisor, consentimentoValido, destinoDoDecisor, exigirConsentimentoDecisor, type Decisor } from "../nucleo/harness/decisor/cliente";
import { criarServicoDecisoes, type ServicoDecisoes } from "../nucleo/harness/decisoes";
import { carregarEquivalenciaPadrao, equivalenciaMinima, montarEquivalencia, validarDiferencas, type EquivalenciaMontada, type OpenRouterNaEquivalencia } from "../nucleo/harness/equivalencia";
import { lerEquivalenciaDeArquivo } from "../nucleo/harness/equivalencia-arquivo";
import { medirUso, pickAccount } from "../nucleo/harness/escolher-conta";
import { classificarParaRoteador } from "../nucleo/harness/classificar";
import { classificarIntencao } from "../nucleo/harness/intencao";
import { criarResolvedorHarness, paraResultadoDeRota, type ResolvedorHarness } from "../nucleo/harness/perfil";
import { gravarPolitica, restaurarSemente, type ContextoPolitica } from "../nucleo/harness/politica";
import { gerarSemente, ordenarProvedores } from "../nucleo/harness/semente";
import { rotear, type ContaDoSistema, type DepsRoteador, type Rota } from "../nucleo/harness/roteador";
import { TASK_TYPES_EMBUTIDOS, taskTypeDoGesto } from "../nucleo/harness/task-types";
import type { DecisaoInfo, PedidoDefinirPolitica, PedidoRotaSpawn, PoliticaInfo, PortaHarness, PortaLimites, PortaRota, RecomendacaoInfo, ResultadoDefinirPolitica, ResultadoEscolhaConta, ResultadoRotaSpawn, RotaDoSpawn } from "../nucleo/mcp/portas";
import type { EntradaPreparoDePane, PreparadorDePane, PreparoDaSessao } from "../nucleo/missoes/panes";
import { clisUtilizaveis, type ServicoOpenRouter } from "../nucleo/openrouter";
import type { ServicoContas } from "../nucleo/provedores/contas";
import type { ServicoProvedores } from "../nucleo/provedores/servico";
import { ambienteDoCofre, definirScrubDoAmbiente } from "../nucleo/terminais/ambiente";
import { criarClienteRede, criarRegistroConsentimento, type ClienteRede, type RegistroConsentimento } from "../nucleo/rede";
import type { ServicoWorkspaces } from "../nucleo/workspaces/servico";
import type { Barramento } from "./barramento";

// ---------------------------------------------------------------- chaves de `config` (fora do banco de domínio)
export const CHAVE_CONFIG_DECISOR = "decisor";
export const CHAVE_CONFIG_EQUIVALENCIA = "harness.equivalencia";
export const CHAVE_CONFIG_PROVEDORES_PREFERIDOS = "harness.provedores_preferidos";
export const CHAVE_CONFIG_OPENROUTER = "openrouter";

/** Erro nominal que o renderer pode ver (código + campo; nunca valor de segredo). */
export class ErroHarness extends Error {
  constructor(
    readonly codigo: string,
    readonly campo: string | null,
    mensagem: string,
  ) {
    super(`${codigo}: ${mensagem}`);
    this.name = "ErroHarness";
  }
}

/** Padrões do decisor (D-58): DESLIGADO, sem consentimento, sem endpoint, nada usado. */
export function configDecisorPadrao(): ConfigDecisor {
  return {
    habilitado: false,
    modo: "jev_direto",
    formato: "probs_json",
    endpoint: null,
    cabecalho_chave: "Authorization",
    prefixo_chave: "Bearer ",
    modelo: null,
    conta_openrouter_id: null,
    chave_ref: null,
    usar_para: { task_type: false, modelo_esforco: false, intencao: false },
    confianca_minima: 0.5,
    timeout_ms: 2000,
    custo_por_decisao_usd: null,
    alerta_diario: 1000,
    consentimento: null,
  };
}

export interface DependenciasHarnessMain {
  repos: Repositorios;
  contas: Pick<ServicoContas, "listar" | "obter" | "ambienteDaConta">;
  provedores: Pick<ServicoProvedores, "listar">;
  workspaces: Pick<ServicoWorkspaces, "permissaoDe">;
  /** Serviço de limites (liga na onda 2). `null` = ainda não ligado: toda conta fica "sem dado" (nunca 0%). */
  limites: () => { snapshot(): RespostaLimites } | null;
  /** Cofre sob demanda (chave do decisor); só é chamado quando o decisor está ligado e consentido. */
  cofre: () => Promise<Cofre>;
  barramento: Pick<Barramento, "emitir">;
  /** Caminhos candidatos de `equivalencia.json` (o primeiro que existir vale). */
  caminhosEquivalencia: readonly string[];
  agora?: () => number;
  aviso?: (mensagem: string) => void;
  /**
   * Serviço do OpenRouter (T-09.26/28): CLIs utilizáveis (adaptador `verificado` e instalada) e modelos habilitados. Sem ele, vale a leitura direta
   * da `config` `openrouter` (mesmas regras). `openrouter` só é provedor viável com consentimento, conta, ≥ 1 modelo habilitado e CLI compatível.
   */
  openrouter?: () => Pick<ServicoOpenRouter, "resumo"> | null;
  /** Injeção de teste: rede e consentimento do decisor. */
  rede?: ClienteRede;
  consentimento?: RegistroConsentimento;
}

/** Origem da Missão → gesto do método (D-103); `livre` não tem gesto (`geral`). */
const GESTO_DA_ORIGEM: Readonly<Record<string, string>> = { feature: "nova_feature", ocorrencia: "nova_ocorrencia", pedido: "pedido_cru", projeto: "projeto" };

export interface PedidoCliAutomatico {
  workspace_id: string;
  mission_id?: string | null;
  origem: string;
  papel: "piloto" | "executor" | "explorador" | "revisor" | "nenhum";
  /** texto do pedido (só alimenta o classificador; nunca é gravado). */
  pedido: string;
}
export interface ResolucaoCliAutomatica {
  cli: string;
  modelo: string | null;
  conta_id: string | null;
  esforco: string | null;
  rota: RotaDoSpawn;
}

export interface HarnessMain {
  /** Onda 2: semeia tipos e política global, lê a equivalência, compacta decisões antigas. Idempotente. */
  iniciar(): Promise<void>;
  /** A mesma implementação que a Fase 14 (squads) recebe como `PortaResolverPerfil` e o Maestro (Fase 16) usa por (skill, etapa). */
  resolvedor: ResolvedorHarness;
  decisoes: ServicoDecisoes;
  contexto(workspaceId: string): Promise<DepsRoteador>;
  recomendar(workspaceId: string, descricao: string): Promise<Rota>;
  // ---- manipuladores `harness:*`
  configLer(workspaceId: string): ConfigHarness;
  configGravar(c: ConfigHarnessEntrada): ConfigHarness;
  taskTypesListar(): TaskType[];
  taskTypesGravar(t: TaskTypeEntrada): TaskType;
  taskTypesApagar(slug: string): boolean;
  politicaListar(workspaceId: string | null): Politica[];
  politicaGravar(p: PoliticaEntrada, por?: "usuario" | "mcp"): Promise<Politica>;
  politicaRestaurarSemente(workspaceId: string | null, taskType?: string): Promise<Politica[]>;
  equivalenciaLer(): Promise<EstadoEquivalencia>;
  equivalenciaGravar(provedores: TabelaEquivalencia): Promise<EstadoEquivalencia>;
  equivalenciaRestaurar(): Promise<EstadoEquivalencia>;
  decisoesListar(p: PedidoListarDecisoes): PaginaDecisoes;
  contasConfigListar(): ContaRoteamento[];
  contasConfigGravar(c: ContaRoteamentoEntrada): ContaRoteamento;
  decisorLer(): ConfigDecisor;
  decisorGravar(c: ConfigDecisorEntrada): ConfigDecisor;
  decisorTestar(chave?: string): Promise<ResultadoTesteDecisor>;
  /** Fase 16 (Maestro): o decisor externo SÓ se estiver ligado, consentido e com `usar_para.intencao`; `null` = nada é instanciado (zero rede). */
  decisorDeIntencao(): Pick<Decisor, "ask"> | null;
  classificarIntencao(texto: string, contexto: ContextoIntencao): Promise<ResultadoIntencao>;
  resolverPerfil(pedido: PedidoResolverPerfil): Promise<ResultadoDeRota>;
  // ---- portas do MCP (T-09.17) e opt-in
  portaHarness: PortaHarness;
  portaLimites: PortaLimites;
  /** T-09.16: rota do `pane_spawn` sem provedor (usa o mesmo `rotear`; grava `pane_rota`). */
  portaRota: PortaRota;
  /** T-09.16: Missão "Automático" (CLI `auto`): resolve pelo Router com o `task_type` do gesto e devolve o lançamento. */
  resolverCliAutomatico(p: PedidoCliAutomatico): Promise<ResolucaoCliAutomatica>;
  /** Grava `pane_rota` de um Pane já aberto (Missão automática). */
  gravarRotaDoPane(paneId: string, rota: RotaDoSpawn, agenteId: string | null): void;
  /** Tabela de equivalência efetiva (padrão + diferenças do usuário + OpenRouter): a troca por consumo a lê a cada ciclo. */
  equivalenciaEfetiva(): EntradaEquivalencia;
  pilotoEditaPolitica(workspaceId: string): boolean;
  /** Revoga o token do decisor e solta a instância (idempotente). */
  encerrar(): void;
}

const SEM_USO_GERAL: CotaGeral = { pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 }, em_alerta: 0, esgotadas: 0 };

const semUndef = <T extends Record<string, unknown>>(x: T): { [K in keyof T]?: Exclude<T[K], undefined> } => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

export function criarHarnessMain(d: DependenciasHarnessMain): HarnessMain {
  const { repos } = d;
  const agora = d.agora ?? Date.now;
  const aviso = (m: string): void => d.aviso?.(m);
  const configGeral = <T>(chave: string): T | undefined => repos.config.obter<T>(chave);

  // ---------------------------------------------------------------- decisões (grava pelo banco; nunca derruba a rota)
  const decisoes = criarServicoDecisoes({ decisoes: repos.decisao, trocas: repos.trocaLog, agora });

  // ---------------------------------------------------------------- equivalência
  let padrao: EntradaEquivalencia = equivalenciaMinima();
  let avisosPadrao: string[] = [];
  let padraoCarregado = false;
  function carregarPadrao(): void {
    if (padraoCarregado) return;
    padraoCarregado = true;
    for (const caminho of d.caminhosEquivalencia) {
      const r = lerEquivalenciaDeArquivo(caminho);
      if (r.origem === "arquivo") {
        padrao = r.padrao;
        avisosPadrao = r.avisos;
        return;
      }
      avisosPadrao = r.avisos;
    }
    padrao = carregarEquivalenciaPadrao(null).padrao;
    for (const a of avisosPadrao) aviso(a);
  }
  function openrouterNaEquivalencia(): OpenRouterNaEquivalencia {
    const cfg = configGeral<{ habilitado?: boolean; consentimento_em?: string | null }>(CHAVE_CONFIG_OPENROUTER);
    const consentido = cfg?.habilitado === true && typeof cfg.consentimento_em === "string";
    return { habilitado: cfg?.habilitado === true, consentido, modelos: consentido ? repos.openrouterModelo.habilitados() : [] };
  }
  function equivalenciaMontada(): EquivalenciaMontada {
    carregarPadrao();
    return montarEquivalencia(padrao, configGeral<unknown>(CHAVE_CONFIG_EQUIVALENCIA), openrouterNaEquivalencia());
  }
  const estadoEquivalencia = (m: EquivalenciaMontada): EstadoEquivalencia => ({ padrao: m.padrao, efetiva: m.efetiva, diferencas: m.diferencas });

  // ---------------------------------------------------------------- ambiente do roteador
  async function provedoresInstalados(): Promise<string[]> {
    try {
      const lista = await d.provedores.listar(false);
      return lista.filter((p) => p.ferramenta.instalado && p.ferramenta.id !== "terminal").map((p) => p.ferramenta.id);
    } catch {
      return [];
    }
  }
  const preferidos = (): string[] => {
    const p = configGeral<unknown>(CHAVE_CONFIG_PROVEDORES_PREFERIDOS);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  };
  const contasDoSistema = (): ContaDoSistema[] =>
    d.contas.listar().map((c) => ({ conta_id: c.id, provedor: c.provedor, habilitada: c.habilitada, roteamento: repos.contaRoteamento.obter(c.id) ?? null }));

  async function ambienteDeProvedores(contas: readonly ContaDoSistema[]): Promise<{ viaveis: string[]; instalados: string[]; openrouterConsentido: boolean; clisOpenrouter: string[] }> {
    const instalados = await provedoresInstalados();
    const comConta = new Set(contas.filter((c) => c.habilitada).map((c) => c.provedor));
    const orCfg = configGeral<{ habilitado?: boolean; consentimento_em?: string | null; clis_preferidas?: string[] }>(CHAVE_CONFIG_OPENROUTER);
    const resumo = await (d.openrouter?.()?.resumo() ?? Promise.resolve(null)).catch(() => null);
    const consentido = resumo !== null ? resumo.consentido : orCfg?.habilitado === true && typeof orCfg.consentimento_em === "string";
    const openrouterConsentido = consentido && comConta.has("openrouter");
    // só CLI com adaptador `verificado` conta (CT-9.35); instalada e na ordem de preferência do dono
    const clisOpenrouter = openrouterConsentido ? (resumo !== null ? resumo.clis : clisUtilizaveis(instalados, orCfg?.clis_preferidas)) : [];
    const base = instalados.filter((p) => comConta.has(p));
    const temModelo = resumo !== null ? resumo.modelos_habilitados > 0 : repos.openrouterModelo.contagem().habilitados > 0;
    if (openrouterConsentido && temModelo) base.push("openrouter");
    return { viaveis: ordenarProvedores(base, preferidos()), instalados, openrouterConsentido, clisOpenrouter };
  }

  function usosAtuais(): AccountUsage[] {
    try {
      return d.limites()?.snapshot().contas ?? [];
    } catch {
      return [];
    }
  }

  async function contexto(workspaceId: string): Promise<DepsRoteador> {
    const contas = contasDoSistema();
    const amb = await ambienteDeProvedores(contas);
    let permissao: "seguro" | "automatico" = "seguro";
    try {
      permissao = d.workspaces.permissaoDe(workspaceId) === "automatico" ? "automatico" : "seguro";
    } catch {
      /* workspace desconhecido: padrão seguro */
    }
    return {
      politica: { globais: repos.politica.listar(null), doWorkspace: repos.politica.listar(workspaceId) },
      usos: usosAtuais(),
      contas,
      equivalencia: equivalenciaMontada().efetiva,
      config: repos.harnessWorkspace.obter(workspaceId),
      agora: agora(),
      permissaoWorkspace: permissao,
      provedoresViaveis: amb.viaveis,
      clisOpenrouter: amb.clisOpenrouter,
      openrouterConsentido: amb.openrouterConsentido,
      taskTypes: new Set(repos.taskType.listar().map((t) => t.slug)),
      classificar: classificarParaRoteador,
      registrar: (e) => decisoes.registrar(e),
    };
  }

  // ---------------------------------------------------------------- resolvedor (Fases 14 e 16) e recomendação
  const resolvedor = criarResolvedorHarness({
    contexto,
    ambienteDaConta: (contaId) => {
      const c = d.contas.obter(contaId);
      return c === undefined ? undefined : d.contas.ambienteDaConta(c);
    },
  });

  async function recomendar(workspaceId: string, descricao: string): Promise<Rota> {
    // `recomendar` NÃO registra Decisão de conta: é consulta (nada foi escolhido de fato); o resto da rota é o mesmo `rotear`
    const deps = await contexto(workspaceId);
    const { registrar: _naoRegistrar, ...semRegistro } = deps;
    void _naoRegistrar;
    return rotear({ taskType: null, workspace: workspaceId, papel: "executor", descricao, origem: "piloto", modoRota: "auto" }, semRegistro);
  }

  // ---------------------------------------------------------------- rota de Pane novo (pane_spawn auto e Missão "Automático")
  const rotaDeRota = (rota: Rota, decisaoId: string | null): RotaDoSpawn | null => {
    if (!rota.ok || rota.executor === null) return null;
    return {
      provedor: rota.executor.provider,
      cli: rota.cli ?? rota.executor.cli ?? rota.executor.provider,
      modelo: rota.executor.model,
      esforco: rota.executor.effort,
      conta_id: rota.conta_id,
      faixa: rota.faixa,
      task_type: rota.task_type,
      recibo: rota.recibo,
      decisoes: rota.decisoes,
      skills: rota.skills,
      decisao_id: decisaoId,
    };
  };

  /** `rotear` COM registro de Decisão; captura o id da Decisão de conta para ligar em `pane_rota`. */
  async function rotearComDecisao(pedido: Parameters<typeof rotear>[0]): Promise<{ rota: Rota; decisaoId: string | null }> {
    const deps = await contexto(pedido.workspace);
    let decisaoId: string | null = null;
    const registrar = (e: Parameters<NonNullable<DepsRoteador["registrar"]>>[0]): unknown => {
      const g = decisoes.registrar(e);
      if (e.proposito === "selecao_conta") decisaoId = g.id;
      return g;
    };
    const rota = rotear(pedido, { ...deps, registrar });
    return { rota, decisaoId };
  }

  function gravarRotaDoPane(paneId: string, r: RotaDoSpawn, agenteId: string | null): void {
    repos.paneRota.gravar({
      pane_id: paneId,
      perfil: { agente_id: agenteId, provider: r.provedor, cli: r.cli, modelo: r.modelo, esforco: r.esforco, faixa: r.faixa ?? "medio" },
      task_type: r.task_type,
      decisao_id: r.decisao_id,
      saltos: 0,
    });
  }

  const portaRota: PortaRota = {
    async nivel(workspaceId) {
      try {
        return repos.harnessWorkspace.obter(workspaceId).nivel;
      } catch {
        return 1;
      }
    },
    async rotear(p: PedidoRotaSpawn): Promise<ResultadoRotaSpawn> {
      const { rota, decisaoId } = await rotearComDecisao({
        taskType: p.task_type,
        workspace: p.workspace_id,
        papel: p.papel,
        descricao: p.descricao,
        origem: "piloto",
        mission_id: p.mission_id,
        modoRota: "auto",
        ...(p.faixa === null ? {} : { faixa: p.faixa }),
      });
      const r = rotaDeRota(rota, decisaoId);
      if (r === null) return { ok: false, erro: rota.erro ?? "no_capacity", mensagem: rota.recibo };
      return { ok: true, ...r };
    },
    async gravar(paneId, rota, agenteId) {
      // Fase 14: com `agent_id` o perfil do membro sobrepõe a rota daqui; a rota do agente (perfil efetivo, gravada no preparo) é a que vale
      if (agenteId !== null && repos.paneRota.obter(paneId)?.perfil.agente_id === agenteId) return;
      gravarRotaDoPane(paneId, rota, agenteId);
    },
  };

  async function resolverCliAutomatico(p: PedidoCliAutomatico): Promise<ResolucaoCliAutomatica> {
    const taskType = taskTypeDoGesto(GESTO_DA_ORIGEM[p.origem] ?? "geral");
    const { rota, decisaoId } = await rotearComDecisao({
      taskType,
      workspace: p.workspace_id,
      papel: p.papel,
      descricao: p.pedido,
      origem: "metodo",
      mission_id: p.mission_id ?? null,
      modoRota: "auto",
    });
    const r = rotaDeRota(rota, decisaoId);
    if (r === null) throw new ErroHarness(rota.erro ?? "no_capacity", null, rota.recibo);
    return { cli: r.cli, modelo: r.modelo, conta_id: r.conta_id, esforco: r.esforco, rota: r };
  }

  // ---------------------------------------------------------------- política
  async function contextoPolitica(): Promise<ContextoPolitica> {
    const contas = contasDoSistema();
    const amb = await ambienteDeProvedores(contas);
    const habilitados = new Set(amb.viaveis);
    return {
      taskTypes: new Set(repos.taskType.listar().map((t) => t.slug)),
      provedoresHabilitados: habilitados,
      contasHabilitadas: new Map(contas.filter((c) => c.habilitada).map((c) => [c.conta_id, c.provedor])),
      clisInstaladas: new Set(amb.instalados),
      openrouter: { consentido: amb.openrouterConsentido, modelosHabilitados: new Set(repos.openrouterModelo.habilitados().map((m) => m.id)), clisCompativeis: amb.clisOpenrouter },
      esforcoDe: () => [], // hoje nenhuma CLI expõe níveis: o esforço vira `null` com aviso
    };
  }
  const emitirPolitica = (e: { task_type: string; por: "usuario" | "mcp" | "semente" }): void => {
    try {
      d.barramento.emitir("policy.changed", e);
    } catch {
      /* evento nunca derruba a gravação */
    }
  };

  async function politicaGravar(p: PoliticaEntrada, por: "usuario" | "mcp" = "usuario"): Promise<Politica> {
    const r = gravarPolitica(repos.politica, p, por, await contextoPolitica(), emitirPolitica);
    if (!r.ok) throw new ErroHarness(r.erro, r.campo, r.mensagem);
    return r.politica;
  }

  async function semente(): Promise<PoliticaEntrada[]> {
    const instalados = await provedoresInstalados();
    return gerarSemente(instalados, preferidos(), equivalenciaMontada().efetiva, repos.taskType.listar());
  }

  async function politicaRestaurarSemente(workspaceId: string | null, taskType?: string): Promise<Politica[]> {
    const s = workspaceId === null ? await semente() : [];
    restaurarSemente(repos.politica, workspaceId, s, taskType, emitirPolitica);
    return repos.politica.listar(workspaceId);
  }

  // ---------------------------------------------------------------- decisor externo (desligado por padrão)
  const consentimento = d.consentimento ?? criarRegistroConsentimento();
  let rede: ClienteRede | null = d.rede ?? null;
  const redeAgora = (): ClienteRede => (rede ??= criarClienteRede({ consentimento, scrub: (t) => scrubSeAberto(t) }));
  let cofreAberto: Cofre | null = null;
  const scrubSeAberto = (t: string): string => (cofreAberto === null ? t : cofreAberto.scrubSincrono(t));
  let tokenPermanente: { host: string; token: string } | null = null;
  const decisorLer = (): ConfigDecisor => ({ ...configDecisorPadrao(), ...(configGeral<Partial<ConfigDecisor>>(CHAVE_CONFIG_DECISOR) ?? {}) });

  /** O consentimento gravado vale para o host: libera o host e emite UM token permanente por host (re-emitido quando o host muda). */
  function tokenDoConsentimento(host: string): string {
    if (tokenPermanente === null || tokenPermanente.host !== host) {
      if (tokenPermanente !== null) consentimento.revogar(tokenPermanente.token);
      consentimento.permitirHost(host);
      tokenPermanente = { host, token: consentimento.conceder(host, { permanente: true }) };
    }
    return tokenPermanente.token;
  }
  async function chaveDoDecisor(cfg: ConfigDecisor): Promise<string> {
    const cofre = await d.cofre();
    cofreAberto = cofre;
    const nome = cfg.modo === "jev_openrouter" ? (cfg.conta_openrouter_id === null ? null : (repos.contaOpenrouter.obter(cfg.conta_openrouter_id)?.cofre_entrada_id ?? null)) : cfg.chave_ref;
    if (nome === null) throw new Error("chave não configurada");
    return cofre.obter(nome);
  }
  let decisor: Decisor | null = null;
  const novoDecisor = (): Decisor =>
    criarDecisor({
      config: decisorLer,
      rede: redeAgora(),
      obterChave: chaveDoDecisor,
      tokenDeConsentimento: tokenDoConsentimento,
      gravarDecisao: (e) => decisoes.registrar(e),
      aoPausar: (info) => {
        try {
          d.barramento.emitir("decisor.pausado", info);
        } catch {
          /* melhor esforço */
        }
      },
    });
  /** `null` com o decisor desligado ou sem consentimento: NADA é instanciado (CT-9.04). */
  function decisorAtivo(): Decisor | null {
    const cfg = decisorLer();
    if (!cfg.habilitado || !consentimentoValido(cfg)) return null;
    decisor ??= novoDecisor();
    return decisor;
  }

  function decisorGravar(entrada: ConfigDecisorEntrada): ConfigDecisor {
    exigirConsentimentoDecisor({ ...entrada, consentimento: entrada.consentimento === null ? null : { ...entrada.consentimento, em: "" } });
    const anterior = decisorLer();
    const destinoNovo = destinoDoDecisor({ ...entrada, consentimento: null });
    const mesmoDestino = anterior.consentimento !== null && entrada.consentimento !== null && anterior.consentimento.host === entrada.consentimento.host && anterior.consentimento.modo === entrada.consentimento.modo;
    // trocar host/modo exige NOVO consentimento: o carimbo de data só se mantém para o mesmo host+modo; desligar apaga o consentimento
    const consentimentoFinal = !entrada.habilitado && entrada.consentimento === null ? null : entrada.consentimento === null ? null : { host: entrada.consentimento.host.toLowerCase(), modo: entrada.consentimento.modo, em: mesmoDestino && anterior.consentimento !== null ? anterior.consentimento.em : new Date(agora()).toISOString() };
    const final: ConfigDecisor = { ...entrada, consentimento: entrada.habilitado ? consentimentoFinal : null };
    repos.config.definir(CHAVE_CONFIG_DECISOR, final);
    decisor = null; // próxima decisão relê a configuração
    if (tokenPermanente !== null) {
      consentimento.revogar(tokenPermanente.token);
      tokenPermanente = null;
    }
    if (!final.habilitado && destinoNovo !== null) consentimento.revogarHost(destinoNovo.host);
    return final;
  }

  async function decisorTestar(chave?: string): Promise<ResultadoTesteDecisor> {
    const cfg = decisorLer();
    const destino = destinoDoDecisor(cfg);
    if (destino === null) return { ok: false, latencia_ms: null, motivo: "configuracao_incompleta" };
    if (!consentimentoValido(cfg)) return { ok: false, latencia_ms: null, motivo: "sem_consentimento" };
    // única chamada de rede por botão: o clique emite um token de UM uso; com `chave` o valor vale só nesta chamada (não é gravado)
    consentimento.permitirHost(destino.host);
    const token = consentimento.conceder(destino.host, { usos: 1, validade_ms: 30_000 });
    return (decisor ?? novoDecisor()).testar({ token, config: cfg, ...(chave === undefined ? {} : { chave }) });
  }

  // ---------------------------------------------------------------- intenção
  const intencao = (texto: string, ctx: ContextoIntencao): Promise<ResultadoIntencao> => {
    const ativo = ctx.workspace_id !== undefined && decisorLer().usar_para.intencao ? decisorAtivo() : null;
    return classificarIntencao(texto, ctx, { decisor: ativo, scrub: scrubSeAberto });
  };

  /** `{perfil, ctx}` (squads): o mesmo `rotear`, sem criar Pane (só leitura; não grava Decisão). */
  async function rotaDoPerfil(p: Extract<PedidoResolverPerfil, { perfil: unknown }>): Promise<Rota> {
    const ctx = p.ctx;
    const deps = await contexto(ctx.workspace_id);
    const { registrar: _r, ...semRegistro } = deps;
    void _r;
    const avaliador = ctx.papel === "revisor" && ctx.implementador_provedor != null;
    const excluir = [...(ctx.excluir ?? []), ...(avaliador && ctx.implementador_provedor != null ? [ctx.implementador_provedor] : [])];
    return rotear(
      {
        taskType: avaliador ? "auditar" : null,
        workspace: ctx.workspace_id,
        papel: ctx.papel,
        origem: "metodo",
        mission_id: ctx.mission_id,
        perfil: { cli: p.perfil.cli ?? p.perfil.provider, modelo: p.perfil.modelo, esforco: p.perfil.esforco, faixa: p.perfil.faixa },
        ...(excluir.length === 0 ? {} : { excluirProvedores: excluir }),
        ...((ctx.excluir ?? []).length === 0 ? {} : { excluirContas: ctx.excluir as string[] }),
      },
      semRegistro,
    );
  }

  async function resolverPerfil(p: PedidoResolverPerfil): Promise<ResultadoDeRota> {
    const rota =
      "skill" in p
        ? await resolvedor.resolverPerfilDeEtapa(p.skill, p.etapa, { workspace_id: p.ctx.workspace_id, papel: p.ctx.papel, mission_id: p.ctx.mission_id, ...semUndef({ implementador_provedor: p.ctx.implementador_provedor, excluir: p.ctx.excluir }) })
        : await rotaDoPerfil(p);
    const r = paraResultadoDeRota(rota);
    if (r === null) throw new ErroHarness(rota.erro ?? "no_capacity", null, rota.recibo);
    return r;
  }

  // ---------------------------------------------------------------- portas do MCP
  const executorInfo = (p: Politica): PoliticaInfo => {
    const tipo = repos.taskType.listar().find((t) => t.slug === p.task_type);
    return { task_type: p.task_type, categoria: tipo?.categoria ?? "geral", rotulo: tipo?.rotulo ?? p.task_type, executor: p.executor, alternativas: p.alternativas, fallback: p.fallback, habilitada: p.habilitada };
  };

  const portaHarness: PortaHarness = {
    async listar(workspaceId, categoria) {
      const contas = contasDoSistema();
      const habilitados = new Set((await ambienteDeProvedores(contas)).viaveis);
      const tipos = new Map(repos.taskType.listar().map((t) => [t.slug, t]));
      const saida: PoliticaInfo[] = [];
      for (const p of repos.politica.efetivas(workspaceId)) {
        if (!habilitados.has(p.executor.provider)) continue; // só provedores habilitados são expostos às CLIs
        if (categoria !== null && tipos.get(p.task_type)?.categoria !== categoria) continue;
        saida.push({ ...executorInfo(p), alternativas: p.alternativas.filter((e) => habilitados.has(e.provider)), fallback: p.fallback.filter((e) => habilitados.has(e.provider)) });
      }
      return saida;
    },
    async recomendar(workspaceId, descricao): Promise<RecomendacaoInfo> {
      const r = await recomendar(workspaceId, descricao);
      const num = { alta: 0.9, media: 0.6, baixa: 0.3 }[r.confianca];
      return {
        task_type: r.task_type,
        confianca: num,
        executor: r.executor,
        conta_id: r.conta_id,
        fonte: r.fontes.task_type === "decisor" ? "decisor" : r.fontes.task_type === "regra" ? "heuristica" : "regra",
        recibo: r.recibo,
        erro: r.ok ? null : (r.erro ?? "no_capacity"),
      };
    },
    async definir(p: PedidoDefinirPolitica): Promise<ResultadoDefinirPolitica> {
      const existente = repos.politica.efetiva(p.workspace_id, p.task_type);
      const executor = { provider: p.provedor, cli: p.cli ?? (p.provedor === "openrouter" ? null : p.provedor), model: p.modelo, effort: p.esforco, faixa: p.faixa };
      const entrada: PoliticaEntrada = {
        workspace_id: p.workspace_id,
        task_type: p.task_type,
        executor,
        alternativas: existente?.alternativas ?? [],
        fallback: p.fallback ?? existente?.fallback ?? [executor],
        skills: existente?.skills ?? [],
        agente: existente?.agente ?? null,
        conta_fixa_id: existente?.conta_fixa_id ?? null,
        evitar_reservadas: existente?.evitar_reservadas ?? true,
        habilitada: true,
      };
      const r = gravarPolitica(repos.politica, entrada, "mcp", await contextoPolitica(), emitirPolitica);
      if (!r.ok) return { ok: false, erro: r.erro, mensagem: r.mensagem };
      return { ok: true, politica: executorInfo(r.politica), avisos: r.avisos };
    },
    async pilotoEditaPolitica(workspaceId) {
      return repos.harnessWorkspace.obter(workspaceId).piloto_edita_politica;
    },
    async decisoes(f) {
      // o token vale para UM workspace: filtra por ele (cursor, até 5 páginas) para não vazar recibo de outro
      const itens: Decisao[] = [];
      let cursor: string | undefined;
      let totais = { consultas: 0, custo_usd: null as number | null };
      for (let i = 0; i < 5 && itens.length < f.limite; i++) {
        const pg = decisoes.listar(semUndef({ desde: f.desde ?? undefined, proposito: f.proposito ?? undefined, cursor, limite: 200 }));
        totais = { consultas: pg.totais.consultas, custo_usd: pg.totais.custo_usd };
        for (const x of pg.itens) if (x.workspace_id === f.workspace_id && itens.length < f.limite) itens.push(x);
        if (pg.proximo === null) break;
        cursor = pg.proximo;
      }
      const info: DecisaoInfo[] = itens.map((x) => ({ id: x.id, criado_em: x.criado_em, proposito: x.proposito, escolhida: x.escolhida, fonte: x.fonte, recibo: x.recibo, custo_usd: x.custo_usd }));
      const custo = itens.some((x) => x.custo_usd !== null) ? itens.reduce((s, x) => s + (x.custo_usd ?? 0), 0) : null;
      return { decisoes: info, total: itens.length, custo_usd: custo };
    },
  };

  const portaLimites: PortaLimites = {
    async limites(provedor) {
      const r = d.limites()?.snapshot();
      if (r === undefined) return { contas: [], geral: SEM_USO_GERAL };
      return { contas: provedor === null ? r.contas : r.contas.filter((c) => c.provider === provedor), geral: r.geral };
    },
    async escolher(p): Promise<ResultadoEscolhaConta | null> {
      // ÚNICA implementação de escolha de conta: `pickAccount`. Aqui só se montam as candidatas e se traduz o resultado.
      const cfg = repos.harnessWorkspace.obter(p.workspace_id);
      const usos = new Map(usosAtuais().map((u) => [u.account_id, u]));
      const candidatas: CandidataConta[] = contasDoSistema()
        .filter((c) => c.provedor === p.provedor)
        .map((c) => ({
          conta_id: c.conta_id,
          provedor: c.provedor,
          habilitada: c.habilitada,
          auth: c.roteamento?.auth ?? "desconhecida",
          reservada_modelos: c.roteamento?.reservada_modelos ?? [],
          reservada_papeis: c.roteamento?.reservada_papeis ?? [],
          fixada_em: c.roteamento?.workspaces_fixados ?? [],
          cooldown_ate: c.roteamento?.em_cooldown_ate ?? null,
          uso: usos.get(c.conta_id) ?? null,
        }));
      const opcoes: OpcoesPick = {
        modelo: p.modelo,
        papel: "piloto",
        workspace_id: p.workspace_id,
        agora: agora(),
        limiar_esgotamento_pct: cfg.limiar_esgotamento_pct,
        limiar_troca_pct: cfg.limiar_troca_pct,
        estrategia: p.estrategia,
        janela: p.janela,
        conta_fixa_id: null,
        evitar_reservadas: false,
        excluir: [],
      };
      const r = pickAccount(candidatas, opcoes);
      if (r.escolhida === null) return null;
      const escolhida = candidatas.find((c) => c.conta_id === r.escolhida) as CandidataConta;
      const g = medirUso(escolhida, opcoes).gargalo;
      const linha = r.ranking.find((x) => x.conta_id === r.escolhida);
      return { conta_id: r.escolhida, folga_pct: g === null ? null : Math.max(0, Math.round((100 - g.used_pct) * 10) / 10), motivo: linha?.motivo ?? "escolhida" };
    },
  };

  // ---------------------------------------------------------------- boot (onda 2)
  let iniciado = false;
  async function iniciar(): Promise<void> {
    if (iniciado) return;
    iniciado = true;
    carregarPadrao();
    for (const a of avisosPadrao) aviso(a);
    repos.taskType.semear(TASK_TYPES_EMBUTIDOS);
    // política global: só semeia se não existe NENHUMA (nunca sobrescreve o que o usuário editou); "restaurar semente" refaz sob pedido
    if (repos.politica.listar(null).length === 0) {
      const s = await semente();
      for (const p of s) repos.politica.gravar(p, "semente");
    }
    // consentimento já gravado do decisor: re-libera o host (o token permanente nasce no primeiro uso)
    const cfg = decisorLer();
    if (cfg.habilitado && consentimentoValido(cfg)) {
      const dest = destinoDoDecisor(cfg);
      if (dest !== null) consentimento.permitirHost(dest.host);
    }
    // retenção: compacta o que passou de 90 dias, em lotes (já assíncrono em relação ao boot)
    setImmediate(() => {
      try {
        decisoes.aplicarRetencao();
      } catch (e) {
        aviso(`retenção de decisões falhou: ${e instanceof Error ? e.message : "erro"}`);
      }
    });
  }

  return {
    iniciar,
    resolvedor,
    decisoes,
    contexto,
    recomendar,
    configLer: (ws) => repos.harnessWorkspace.obter(ws),
    configGravar: (c) => repos.harnessWorkspace.gravar(c),
    taskTypesListar: () => repos.taskType.listar(),
    taskTypesGravar: (t) => repos.taskType.gravar(t),
    taskTypesApagar: (slug) => repos.taskType.apagar(slug),
    politicaListar: (ws) => repos.politica.efetivas(ws),
    politicaGravar,
    politicaRestaurarSemente,
    equivalenciaLer: async () => estadoEquivalencia(equivalenciaMontada()),
    async equivalenciaGravar(provedores) {
      const v = validarDiferencas(provedores);
      if (!v.ok) throw new ErroHarness("invalid_argument", v.erros[0]?.campo ?? null, v.erros[0]?.motivo ?? "equivalência inválida");
      repos.config.definir(CHAVE_CONFIG_EQUIVALENCIA, v.valor);
      return estadoEquivalencia(equivalenciaMontada());
    },
    async equivalenciaRestaurar() {
      repos.config.remover(CHAVE_CONFIG_EQUIVALENCIA);
      return estadoEquivalencia(equivalenciaMontada());
    },
    decisoesListar: (p) => decisoes.listar(p),
    contasConfigListar: () => repos.contaRoteamento.listar(),
    contasConfigGravar: (c) => repos.contaRoteamento.gravarConfig(c),
    decisorLer,
    decisorGravar,
    decisorTestar,
    decisorDeIntencao: () => (decisorLer().usar_para.intencao ? decisorAtivo() : null),
    classificarIntencao: intencao,
    resolverPerfil,
    portaHarness,
    portaLimites,
    portaRota,
    resolverCliAutomatico,
    gravarRotaDoPane,
    equivalenciaEfetiva: () => equivalenciaMontada().efetiva,
    pilotoEditaPolitica: (ws) => {
      try {
        return repos.harnessWorkspace.obter(ws).piloto_edita_politica;
      } catch {
        return false;
      }
    },
    encerrar() {
      if (tokenPermanente !== null) consentimento.revogar(tokenPermanente.token);
      tokenPermanente = null;
      decisor = null;
    },
  };
}

/** Candidatos de `equivalencia.json`: empacotado em `<resources>/harness`, ou `resources/harness` na raiz do repositório (dev). */
export function caminhosDaEquivalencia(o: { dirMain: string; resourcesPath: string | null; empacotado: boolean }): string[] {
  const empacotado = o.resourcesPath === null ? [] : [join(o.resourcesPath, "harness", "equivalencia.json")];
  const dev = join(o.dirMain, "..", "..", "resources", "harness", "equivalencia.json");
  return o.empacotado ? [...empacotado, dev] : [dev, ...empacotado];
}

// ---------------------------------------------------------------- complementos de lançamento de Pane (vaga única em `ServicoPanes`)
/** `ServicoPanes.definirComplemento` tem UMA vaga; limites (statusline) e cofre (ambiente) a dividem sem que um conheça o outro. */
export function combinarComplementos(panes: { definirComplemento(fn: PreparadorDePane | null): void }): {
  /** o que o `ligarLimites` recebe no lugar de `panes` (só `definirComplemento` importa). */
  vagaDeLimites: { definirComplemento(fn: PreparadorDePane | null): void };
  definirCofre(fn: PreparadorDePane | null): void;
  encerrar(): void;
} {
  let limites: PreparadorDePane | null = null;
  let cofre: PreparadorDePane | null = null;
  const seguro = async (fn: PreparadorDePane | null, e: EntradaPreparoDePane): Promise<PreparoDaSessao | null> => {
    if (fn === null) return null;
    try {
      return await fn(e);
    } catch {
      return null; // um complemento nunca impede o Pane de abrir
    }
  };
  const instalar = (): void => {
    if (limites === null && cofre === null) {
      panes.definirComplemento(null);
      return;
    }
    panes.definirComplemento(async (e) => {
      const [a, b] = await Promise.all([seguro(limites, e), seguro(cofre, e)]);
      if (a === null && b === null) return null;
      return { argumentos: [...(a?.argumentos ?? []), ...(b?.argumentos ?? [])], ambiente: { ...(a?.ambiente ?? {}), ...(b?.ambiente ?? {}) } };
    });
  };
  return {
    vagaDeLimites: {
      definirComplemento(fn) {
        limites = fn;
        instalar();
      },
    },
    definirCofre(fn) {
      cofre = fn;
      instalar();
    },
    encerrar() {
      limites = null;
      cofre = null;
      instalar();
    },
  };
}

export interface DependenciasComplementoCofre {
  repos: Pick<Repositorios, "harnessWorkspace">;
  /** o cofre SÓ é aberto se `injetar_cofre_no_env` está ligado no workspace do Pane, ou se o arquivo do cofre já existe (scrubber). */
  cofre: () => Promise<Cofre>;
  /** o arquivo do cofre existe? (`<userData>/cofre.json`): sem ele não há valor a proteger. */
  existeArquivo: () => boolean;
  /** liga o scrubber ao ambiente seguro (padrão: `definirScrubDoAmbiente`). */
  ligarScrub?: (scrub: ((t: string) => string) | null) => void;
}

/**
 * Complemento de ambiente do cofre (T-09.22): (1) se o cofre já existe em disco, carrega o scrubber e o liga ao `ambienteSeguro` (variável
 * herdada com valor do cofre sai do Pane); (2) só com `injetar_cofre_no_env` no workspace soma as entradas NÃO sensíveis como variáveis.
 */
export function criarComplementoDoCofre(d: DependenciasComplementoCofre): PreparadorDePane {
  const ligar = d.ligarScrub ?? definirScrubDoAmbiente;
  return async ({ workspace }) => {
    const injetar = d.repos.harnessWorkspace.obter(workspace.id).injetar_cofre_no_env;
    if (!injetar && !d.existeArquivo()) return null;
    const cofre = await d.cofre();
    await cofre.prepararScrubber().catch(() => undefined);
    ligar((t) => cofre.scrubSincrono(t));
    const ambiente = await ambienteDoCofre(cofre, { workspace_id: workspace.id, injetar });
    return Object.keys(ambiente).length === 0 ? null : { argumentos: [], ambiente };
  };
}
