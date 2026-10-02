// Loja de MCPs no main (Fase 7B, onda C): liga o núcleo (`nucleo/loja-mcp`) ao app. O serviço NASCE barato (nenhum arquivo é lido na
// criação): catálogo, bloqueio, cofre e ciclo só são carregados no primeiro uso (clique na Loja, Pane com servidor habilitado ou a
// manutenção ociosa quando já há algo instalado). Nada baixa por conta própria: toda instalação/atualização é ação explícita da UI com
// o consentimento (hash do plano) que a pessoa viu. Segredo só no cofre do SO e só chega ao processo do servidor real (lançador).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  BloqueioPlanoDto, CartaoMcp, ConsentimentoLoja, DetalheMcp, DiagnosticoLojaMcp, DiffAtualizacaoMcp, EstadoKitMcp, EventoLojaMcp,
  HabilitacaoMcp, ListaLojaMcp, LogMcp, PedidoInstalarMcp, PlanoInstalacaoDto, PlanoKitMcp, PreviaCliMcp, ResultadoAcaoMcp, ResultadoCliMcp,
  ResultadoPlanoLoja, ResultadoDescobertaMcp, ResultadoTesteMcp, VariavelMcpEstado, AlvoHabilitacaoTipo, CliLojaMcp, InstaladoMcp,
} from "../compartilhado/loja-mcp";
import type { Cofre } from "../nucleo/cofre";
import {
  CLIS_COM_INJECAO, carregarBloqueio, carregarCatalogo, configuracaoDeMcpLoja, criarCatalogo, criarCicloLoja, criarExecutorProcesso, criarKit, criarServicoCliUsuario,
  criarServicoSegredos, criarSegredosMcp, decidirToolLoja, descobrirNoRegistro, listarServidoresParaAgente, hashDoComando, localizarExecutavel, montarComando, montarLancamento, montarPermissoes, previaCliUsuario,
  variaveisFaltando,
  type Bloqueio, type BinariosMcp, type FiltroMcpStore, type ServidorMcpStore, type CatalogoCarregado, type CicloLoja, type DecisaoGate, type DepsCiclo, type DiagnosticoMcp, type EntradaMcp, type Executor, type Kit,
  type PlanoInstalacao, type RepoLojaMcp, type SegredosMcp, type ServicoCliUsuario,
} from "../nucleo/loja-mcp";
import { VARIAVEL_LOJA_TOKEN, VARIAVEL_LOJA_URL, type LojaNoComando } from "../nucleo/orquestracao/piloto";
import type { ModoMissao } from "../nucleo/dominio";
import type { LancamentoServidor } from "../nucleo/gateway-mcp/conector";

/** Onde vivem o seed, o bloqueio, os locks e o lançador: `<resources>/mcp` empacotado, `<app>/resources/mcp` em desenvolvimento. */
export function pastaDaLojaMcp(o: { empacotado: boolean; resourcesPath: string; appPath: string; existe?: (c: string) => boolean }): string | null {
  const existe = o.existe ?? existsSync;
  const candidatas = o.empacotado ? [join(o.resourcesPath, "mcp")] : [join(o.appPath, "resources", "mcp"), join(o.appPath, "dist", "resources", "mcp")];
  return candidatas.find((c) => existe(c)) ?? null;
}

export interface ServicoLojaMcp {
  listar(): Promise<ListaLojaMcp>;
  detalhe(id: string, workspaceId: string | null): Promise<DetalheMcp | null>;
  planoInstalacao(ids: string[], workspaceId: string | null): Promise<ResultadoPlanoLoja>;
  instalar(pedido: PedidoInstalarMcp): Promise<{ instalacao_id: string }>;
  cancelar(instalacaoId: string): Promise<{ ok: boolean }>;
  desinstalar(id: string, apagarSegredos: boolean): Promise<{ ok: boolean; codigo: string | null; residuos: string[] }>;
  planoAtualizacao(id: string, workspaceId: string | null): Promise<DiffAtualizacaoMcp | null>;
  atualizar(id: string, consentimento: ConsentimentoLoja, workspaceId: string | null): Promise<{ instalacao_id: string }>;
  variaveisEstado(id: string): Promise<VariavelMcpEstado[]>;
  gravarVariavel(id: string, nome: string, valor: string): Promise<{ ok: boolean; codigo: string | null }>;
  apagarVariavel(id: string, nome: string): Promise<{ ok: boolean }>;
  testar(id: string, workspaceId: string | null): Promise<ResultadoTesteMcp>;
  habilitar(id: string, alvoTipo: AlvoHabilitacaoTipo, alvoValor: string, habilitado: boolean): Promise<ResultadoAcaoMcp>;
  habilitacoes(workspaceId: string): Promise<HabilitacaoMcp[]>;
  previaCliUsuario(id: string, cli: CliLojaMcp, workspaceId: string | null): Promise<{ ok: true; previa: PreviaCliMcp } | { ok: false; codigo: string; motivo: string }>;
  instalarNaCli(id: string, cli: CliLojaMcp, confirmacao: string, workspaceId: string | null): Promise<ResultadoCliMcp>;
  removerDaCli(id: string, cli: CliLojaMcp): Promise<ResultadoCliMcp>;
  logs(id: string, limite: number): Promise<LogMcp[]>;
  kitEstado(): Promise<EstadoKitMcp>;
  kitPlano(workspaceId: string | null): Promise<PlanoKitMcp>;
  kitInstalar(consentimento: ConsentimentoLoja, workspaceId: string | null): Promise<{ instalacao_id: string }>;
  kitOptOut(valor: boolean): Promise<EstadoKitMcp>;
  diagnostico(): Promise<DiagnosticoLojaMcp>;
  /** T-07B.32 (P2): consulta o Registro Oficial SÓ por clique; resultado não curado e não instalável. */
  descobrir(consulta: string): Promise<ResultadoDescobertaMcp>;
}

/** Quem pede os servidores da Loja para um Pane que está abrindo. */
export interface AlvoPaneLoja {
  pane_id: string;
  workspace_id: string;
  missao_id: string | null;
  agente_id: string | null;
  /** Fase 7: `mcps_permitidos` do perfil do membro de squad (só estreita as habilitações). */
  membro_mcps?: readonly string[] | null;
  modo: ModoMissao;
  cli: string;
  /** raiz absoluta onde o Pane trabalha (`{{WORKSPACE}}`). */
  raiz: string;
}

/** Servidores da Loja resolvidos para UM Pane (política + snapshot já gravados). `configurar` é síncrona e pura. */
export interface InjecaoLoja {
  ids: string[];
  /** `null` = a CLI não recebe injeção (Gemini). `arquivo` é o `mcp.json` 0600 do Pane. */
  configurar: LojaNoComando["configurar"];
}

/** O que a orquestração usa da Loja (lançamento do Pane, gate `pre-mcp` e rota de segredos). */
export interface PortaLojaDoPane {
  /** `null` = nada da Loja neste Pane (nada habilitado, CLI sem injeção, ou política vazia). Não lê catálogo se nada está habilitado. */
  resolver(alvo: AlvoPaneLoja): Promise<InjecaoLoja | null>;
  segredos(paneId: string, servidor: unknown): Promise<{ status: number; corpo: unknown }>;
  gate(paneId: string, ferramenta: string): DecisaoGate;
  /**
   * `mcp_store_list` (D-138): só o que está habilitado e configurado PARA ESTE Pane (snapshot do lançamento), ainda instalado e não bloqueado.
   * Nunca URL, argumentos, variáveis nem descrição. Pane sem snapshot (ou já encerrado) = lista vazia.
   */
  listarHabilitados(paneId: string, filtro: FiltroMcpStore): Promise<{ servers: ServidorMcpStore[] }>;
  /** `true` se algum Pane VIVO usa o servidor. */
  emUso(id: string): boolean;
  /** esquece o Pane (snapshot) e apaga os arquivos temporários que a Loja criou para ele. */
  liberar(paneId: string): void;
  /** Fase 7C: ids dos servidores habilitados (política deny-by-default) para o Pane, SEM injetar nada; o gateway os serve. */
  servidoresDoPane(alvo: AlvoPaneLoja): Promise<string[]>;
  /** Fase 7C: filtra para os que AINDA estão instalados, não bloqueados e com o comando consentido (a lista do snapshot é do lançamento). */
  servidoresValidos(ids: readonly string[]): Promise<string[]>;
  /** Fase 7C: comando exato (segredos do cofre aplicados) para o gateway lançar NO MAIN; nunca vai ao Pane. Lança se o servidor não vale mais. */
  lancamentoDoServidor(id: string, raiz: string | null): Promise<LancamentoServidor>;
}

/** Fase 7C (R-3): retrato do Pane que sobrevive ao restart do app (só ids, modo e raiz; nunca segredo/token). */
export interface SnapshotLojaPersistido {
  workspace_id: string;
  mission_id: string | null;
  modo: ModoMissao;
  agente_id: string | null;
  papel: string;
  ids: string[];
  raiz: string;
}

export interface LojaMcpMain extends ServicoLojaMcp, PortaLojaDoPane {
  /** Manutenção ociosa (onda 2, depois do boot): só faz algo se já houver servidor instalado; nunca baixa nada. */
  ocioso(): Promise<void>;
  encerrar(): void;
}

export interface DepsLojaMcp {
  repo: RepoLojaMcp;
  userData: string;
  /** pasta `mcp` de recursos (seed, bloqueio, locks, lançador); `null` = sem recursos (Loja vazia e só leitura). */
  pasta: string | null;
  /** sob demanda: o cofre só abre quando a Loja grava/lê segredo ou testa/lança um servidor com variável. */
  cofre: () => Promise<Cofre>;
  /** raiz absoluta do workspace (`{{WORKSPACE}}`); `null` se não existe. */
  raizDoWorkspace: (workspaceId: string) => string | null;
  /** o Pane existe e não está encerrado. */
  paneAtivo: (paneId: string) => boolean;
  emitirRenderer: (e: EventoLojaMcp) => void;
  /** barramento de domínio (`mcp_store.*`): só nomes, nunca valor. */
  barramento?: (nome: string, payload: Record<string, unknown>) => void;
  node?: string;
  nodeEhElectron?: boolean;
  /** apaga arquivos de um Pane (injeção em Pane livre); padrão: `rm` dentro de `<userData>/panes/<id>`. */
  limparArquivosDoPane?: (paneId: string) => void;
  // ---- injeções (testes)
  /** catálogo já pronto (o arquivo de `pasta` não é lido). */
  catalogo?: CatalogoCarregado;
  executor?: Executor;
  instalacao?: DepsCiclo["instalacao"];
  diagnostico?: () => Promise<DiagnosticoMcp>;
  fetch?: typeof fetch;
  /** só testes: URL do Registro Oficial (padrão: o oficial). */
  urlRegistro?: string;
  agora?: () => string;
  origem?: NodeJS.ProcessEnv;
  localizar?: (nome: string) => string | null;
  avisar?: (mensagem: string) => void;
  /** Fase 7C (R-3): persistência do snapshot do Pane para sobreviver ao restart (Pane vivo no daemon). Ausente = só memória (como antes). */
  persistirSnapshot?: (paneId: string, s: SnapshotLojaPersistido) => void;
  reidratarSnapshot?: (paneId: string) => SnapshotLojaPersistido | null;
  esquecerSnapshotPersistido?: (paneId: string) => void;
}

interface Snapshot { ids: Set<string>; raiz: string }
interface Nucleo {
  catalogo: CatalogoCarregado;
  bloqueio: Bloqueio;
  segredos: SegredosMcp;
  ciclo: CicloLoja;
  kit: Kit;
  cliUsuario: ServicoCliUsuario;
  executor: Executor;
  rotaSegredos: ReturnType<typeof criarServicoSegredos>;
}

const idInstalacao = (): string => `inst_${randomBytes(8).toString("hex")}`;
const ERRO_CATALOGO = "catálogo ilegível: a Loja abre vazia e só em leitura";

function lerSha256Esperado(caminho: string): string | undefined {
  try {
    const t = readFileSync(`${caminho}.sha256`, "utf8").trim().split(/\s+/)[0] ?? "";
    return /^[0-9a-f]{64}$/i.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

function catalogoVazio(motivo: string): CatalogoCarregado {
  const vazio = criarCatalogo({ schema_version: 1, seed_versao: "vazio", gerado_em: "1970-01-01", fonte: "vazio", entradas: [] }, "");
  return Object.freeze({ ...vazio, somente_leitura: true, aviso: motivo });
}

const planoDto = (p: PlanoInstalacao): PlanoInstalacaoDto => ({
  id: p.id, nome: p.nome, versao: p.versao, metodo: p.metodo, nivel_verificacao: p.nivel_verificacao,
  passos: p.passos.map((x) => ({ id: x.id, rotulo: x.rotulo, detalhe: x.detalhe, aplicavel: x.aplicavel, requer_clique: x.requer_clique })),
  comando_exato: p.comando_exato, comando_instalacao: [...p.comando_instalacao], pasta: p.pasta, permissoes: JSON.parse(JSON.stringify(p.permissoes)) as PlanoInstalacaoDto["permissoes"],
  comando_hash: p.comando_hash, avisos: p.avisos.map((a) => ({ codigo: a.codigo, nivel: a.nivel, texto: a.texto })),
});

export function criarLojaMcp(d: DepsLojaMcp): LojaMcpMain {
  const agora = d.agora ?? ((): string => new Date().toISOString());
  const node = d.node ?? process.execPath;
  const nodeEhElectron = d.nodeEhElectron ?? process.versions.electron !== undefined;
  const snapshots = new Map<string, Snapshot>();
  const instalacoes = new Map<string, { controller: AbortController; ids: string[] }>();
  const idParaInstalacao = new Map<string, string>();
  const ultimoProgresso = new Map<string, number>();
  let diagCache: { em: number; valor: DiagnosticoMcp } | null = null;
  let nucleo: Promise<Nucleo> | null = null;
  let encerrado = false;

  const raizDe = (ws: string | null): string | undefined => (ws === null ? undefined : (d.raizDoWorkspace(ws) ?? undefined));
  /** `{ workspace }` só quando a raiz existe (exactOptionalPropertyTypes). */
  const comRaiz = (ws: string | null): { workspace?: string } => {
    const r = raizDe(ws);
    return r === undefined ? {} : { workspace: r };
  };
  const emitir = (e: EventoLojaMcp): void => { if (!encerrado) d.emitirRenderer(e); };

  // ---------------------------------------------------------------- núcleo preguiçoso
  function carregar(): Promise<Nucleo> {
    nucleo ??= (async (): Promise<Nucleo> => {
      const cat = d.catalogo ?? (d.pasta === null ? catalogoVazio(ERRO_CATALOGO) : (() => {
        const arquivo = join(d.pasta, "catalogo-mcps.json");
        try {
          const sha = lerSha256Esperado(arquivo);
          return carregarCatalogo(arquivo, sha === undefined ? {} : { sha256Esperado: sha });
        } catch (e) {
          d.avisar?.(`Loja de MCPs: ${e instanceof Error ? e.message : "catálogo inválido"}`);
          return catalogoVazio(ERRO_CATALOGO);
        }
      })());
      const bloqueio = d.pasta === null ? carregarBloqueio("") : carregarBloqueio(join(d.pasta, "bloqueio.json"));
      const portaCofre: Parameters<typeof criarSegredosMcp>[0] = {
        existe: async (n, c) => (await d.cofre()).existe(n, c),
        obter: async (n, c) => (await d.cofre()).obter(n, c),
        guardar: async (p) => (await d.cofre()).guardar(p),
        listar: async () => (await d.cofre()).listar(),
        apagar: async (id) => (await d.cofre()).apagar(id),
      };
      const segredos = criarSegredosMcp(portaCofre);
      const executor = d.executor ?? criarExecutorProcesso();
      const localizar = d.localizar ?? ((n: string): string | null => localizarExecutavel(n));
      const cliUsuario = criarServicoCliUsuario({ repo: d.repo, executor, agora, localizar });
      const ciclo = criarCicloLoja({
        repo: d.repo, catalogo: cat, segredos, executor, userData: d.userData, bloqueio,
        diagnostico: diagnosticoDoCiclo, node, nodeEhElectron, agora,
        instalacao: { ...(d.pasta === null ? {} : { locksDir: join(d.pasta, "locks") }), binarios: binarios(localizar), ...(d.instalacao ?? {}) },
        emUso: (id) => emUso(id),
        evento: (nome, payload) => d.barramento?.(nome, payload),
        progresso: (p) => progresso(p),
        cliUsuario,
        ...(d.fetch ? { fetch: d.fetch } : {}),
        ...(d.origem ? { origem: d.origem } : {}),
      });
      const kit = criarKit({ ciclo, repo: d.repo, catalogo: cat, agora });
      const rotaSegredos = criarServicoSegredos({
        segredos, catalogo: cat,
        permitidosDoToken: (paneId) => snapshotVivo(paneId)?.ids ?? null,
        comando: (e, v, paneId) => montarLancamento(e, v, { userData: d.userData, workspace: snapshots.get(paneId)?.raiz, node, nodeEhElectron, ...(d.origem ? { origem: d.origem } : {}) }),
      });
      return { catalogo: cat, bloqueio, segredos, ciclo, kit, cliUsuario, executor, rotaSegredos };
    })();
    nucleo.catch(() => { nucleo = null; });
    return nucleo;
  }

  function binarios(localizar: (n: string) => string | null): BinariosMcp {
    const npm = localizar("npm");
    const nodeSistema = localizar("node");
    const uv = localizar("uv");
    const docker = localizar("docker");
    return { ...(npm ? { npm } : {}), ...(nodeSistema ? { node: nodeSistema } : {}), ...(uv ? { uv } : {}), ...(docker ? { docker } : {}) };
  }

  /** `npm --version` é lento: o diagnóstico fica em cache por 60 s (o plano o consulta a cada abertura do consentimento). */
  async function diagnosticoDoCiclo(): Promise<DiagnosticoMcp> {
    if (d.diagnostico) return d.diagnostico();
    if (diagCache !== null && Date.now() - diagCache.em < 60_000) return diagCache.valor;
    const localizar = d.localizar ?? ((n: string): string | null => localizarExecutavel(n));
    const executor = d.executor ?? criarExecutorProcesso();
    const versao = async (exe: string | null): Promise<string | null> => {
      if (exe === null) return null;
      const r = await executor.rodar({ exe, args: ["--version"], env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" }, timeoutMs: 4000 }).catch(() => null);
      return r !== null && r.codigo === 0 ? r.saida.trim().slice(0, 40) : null;
    };
    const exeNpm = localizar("npm");
    const exeNode = localizar("node");
    const exeUv = localizar("uv");
    const exeDocker = localizar("docker");
    const [vNode, vNpm, vUv] = await Promise.all([versao(exeNode), versao(exeNpm), versao(exeUv)]);
    let cofreOk = false;
    try { cofreOk = (await (await d.cofre()).estado()).ok; } catch { cofreOk = false; }
    const valor: DiagnosticoMcp = {
      npm: { ok: exeNpm !== null && vNpm !== null, versao: vNpm }, node: { ok: exeNode !== null && vNode !== null, versao: vNode },
      uv: { ok: exeUv !== null && vUv !== null, versao: vUv }, docker: { ok: exeDocker !== null }, cofre: { disponivel: cofreOk },
    };
    diagCache = { em: Date.now(), valor };
    return valor;
  }

  function progresso(p: { id: string; passo: number; rotulo: string }): void {
    const inst = idParaInstalacao.get(p.id);
    if (inst === undefined) return;
    const t = Date.now();
    if (t - (ultimoProgresso.get(inst) ?? 0) < 100) return; // ≤ 10 eventos/s
    ultimoProgresso.set(inst, t);
    emitir({ tipo: "progresso", instalacao_id: inst, id: p.id, passo: p.passo, rotulo: p.rotulo });
  }

  // ---------------------------------------------------------------- snapshots por Pane
  function snapshotVivo(paneId: string): Snapshot | undefined {
    let s = snapshots.get(paneId);
    if (s === undefined) {
      // R-3: Pane que sobreviveu ao restart (daemon vivo) recupera o snapshot gravado, enquanto o Pane existir e o registro não vencer
      if (d.reidratarSnapshot === undefined || !d.paneAtivo(paneId)) return undefined;
      let r: SnapshotLojaPersistido | null = null;
      try { r = d.reidratarSnapshot(paneId); } catch { r = null; }
      if (r === null) return undefined;
      s = { ids: new Set(r.ids), raiz: r.raiz };
      snapshots.set(paneId, s);
      return s;
    }
    if (!d.paneAtivo(paneId)) { liberar(paneId); return undefined; }
    return s;
  }
  function emUso(id: string): boolean {
    for (const paneId of [...snapshots.keys()]) if (snapshotVivo(paneId)?.ids.has(id)) return true;
    return false;
  }
  /** Esquece o snapshot; só apaga os arquivos do Pane se ele de fato acabou (troca de conta reusa o `pane_id` com Pane vivo). */
  function liberar(paneId: string): void {
    const tinha = snapshots.delete(paneId);
    if (!d.paneAtivo(paneId)) { try { d.esquecerSnapshotPersistido?.(paneId); } catch { /* melhor esforço */ } }
    if (!tinha) return;
    if (d.paneAtivo(paneId)) return;
    try { d.limparArquivosDoPane?.(paneId); } catch { /* arquivo órfão sem segredo: some quando o Pane for limpo */ }
  }

  /** Entrada do catálogo se o servidor segue instalado, não bloqueado e com o MESMO comando que a pessoa consentiu; senão `null`. */
  function servidorAindaValido(n: Nucleo, id: string): EntradaMcp | null {
    const inst = d.repo.obterInstalado(id);
    if (inst === null || inst === undefined || inst.estado !== "instalado" || n.bloqueio.consultarId(id) !== null) return null;
    const entrada = n.catalogo.porId.get(id)?.entrada as EntradaMcp | undefined;
    if (entrada === undefined || !entrada.confirmado || inst.comando_hash !== hashDoComando(entrada)) return null;
    return entrada;
  }

  // ---------------------------------------------------------------- cartões
  function cartao(n: Nucleo, x: CatalogoCarregado["entradas"][number], kitIds: Set<string>): CartaoMcp {
    const e = x.entrada as EntradaMcp;
    const reg = d.repo.obterInstalado(e.id);
    const definidas = new Set(d.repo.variaveisDe(e.id).filter((v) => v.definida).map((v) => v.nome));
    const saude = d.repo.obterSaude(e.id);
    const instalado: InstaladoMcp | null = reg === null ? null : {
      estado: reg.estado, versao: reg.versao, nivel_verificacao: reg.nivel_verificacao, erro_codigo: reg.erro_codigo, instalado_em: reg.instalado_em,
      atualizacao_disponivel: reg.estado === "instalado" && (hashDoComando(e) !== reg.comando_hash || reg.versao !== (e.instalacao.versao ?? "remoto")),
    };
    return {
      id: e.id, nome: e.nome, descricao_pt: e.descricao_pt, categoria: e.categoria, classificacao: e.classificacao, mantenedor: e.mantenedor, mantenedor_nome: e.mantenedor_nome,
      licenca_spdx: e.licenca_spdx, licenca_restritiva: x.licenca_restritiva, selo_gratuito: x.selo_gratuito, pede_chave: x.pede_chave, autenticacao: e.autenticacao,
      metodo: e.instalacao.metodo, transporte: e.transporte, versao: e.instalacao.versao, riscos: [...e.riscos], confirmado: e.confirmado,
      instalavel: x.instalavel, motivo_nao_instalavel: x.motivo_nao_instalavel, tools_principais: [...e.tools_principais], instalado, saude,
      precisa_configurar: reg?.estado === "instalado" && variaveisFaltando(e, definidas).length > 0, no_kit: kitIds.has(e.id),
    };
  }

  const bloqueioDto = (id: string, b: { codigo: string; motivo: string; acao: string | null }): BloqueioPlanoDto => ({ id, codigo: b.codigo, motivo: b.motivo, acao: b.acao });

  // ---------------------------------------------------------------- execução em segundo plano
  /** Roda `trabalho` para cada id, emitindo estado; devolve o `instalacao_id` na hora. Erro inesperado vira `falhou`, nunca exceção solta. */
  function emSegundoPlano(ids: string[], trabalho: (id: string, sinal: AbortSignal) => Promise<{ ok: boolean; codigo: string | null }>, workspace: string | null): string {
    const instalacaoId = idInstalacao();
    const controller = new AbortController();
    instalacoes.set(instalacaoId, { controller, ids });
    for (const id of ids) idParaInstalacao.set(id, instalacaoId);
    void (async () => {
      const n = await carregar().catch(() => null);
      for (const id of ids) {
        if (controller.signal.aborted) { emitir({ tipo: "estado", id, estado: "falhou", erro_codigo: "cancelado" }); continue; }
        emitir({ tipo: "estado", id, estado: "instalando", erro_codigo: null });
        try {
          const r = await trabalho(id, controller.signal);
          if (r.ok) {
            emitir({ tipo: "estado", id, estado: "instalado", erro_codigo: null });
            if (n !== null) await testarEEmitir(n, id, workspace);
          } else emitir({ tipo: "estado", id, estado: "falhou", erro_codigo: r.codigo });
        } catch {
          emitir({ tipo: "estado", id, estado: "falhou", erro_codigo: "falha_instalacao" });
        } finally {
          idParaInstalacao.delete(id);
        }
      }
    })().finally(() => { instalacoes.delete(instalacaoId); ultimoProgresso.delete(instalacaoId); });
    return instalacaoId;
  }

  /** D-139: ao terminar a instalação, UM handshake explícito (≤ 3 s, árvore morta ao fim). */
  async function testarEEmitir(n: Nucleo, id: string, workspace: string | null): Promise<ResultadoTesteMcp> {
    const r = await n.ciclo.testar(id, comRaiz(workspace));
    emitir({ tipo: "saude", id, estado: r.estado, n_ferramentas: r.n_ferramentas, latencia_ms: r.latencia_ms });
    return r;
  }

  const acao = (r: { ok: true } | { ok: false; codigo: string; detalhe?: string | undefined }): ResultadoAcaoMcp =>
    r.ok ? { ok: true, codigo: null, detalhe: null } : { ok: false, codigo: r.codigo, detalhe: r.detalhe ?? null };

  // ---------------------------------------------------------------- serviço (IPC)
  const servico: ServicoLojaMcp = {
    async listar() {
      const n = await carregar();
      const kitIds = new Set(n.kit.idsDoKit());
      return {
        entradas: n.catalogo.entradas.map((x) => cartao(n, x, kitIds)), seed_versao: n.catalogo.seed_versao, gerado_em: n.catalogo.gerado_em,
        somente_leitura: n.catalogo.somente_leitura, aviso: n.catalogo.aviso,
      };
    },

    async detalhe(id, workspaceId) {
      const n = await carregar();
      const x = n.catalogo.porId.get(id);
      if (!x) return null;
      const e = x.entrada as EntradaMcp;
      let permissoes: DetalheMcp["permissoes"] = null;
      let permissoes_erro: string | null = null;
      try {
        permissoes = JSON.parse(JSON.stringify(montarPermissoes(e, { userData: d.userData, workspace: raizDe(workspaceId), node, nodeEhElectron, modo: "exibicao" }))) as DetalheMcp["permissoes"];
      } catch (erro) {
        permissoes_erro = erro instanceof Error ? erro.message.slice(0, 200) : "comando indisponível";
      }
      const definidas = new Set(d.repo.variaveisDe(id).filter((v) => v.definida).map((v) => v.nome));
      const kitIds = new Set(n.kit.idsDoKit());
      const base = cartao(n, x, kitIds);
      const diff = base.instalado?.estado === "instalado" ? await n.ciclo.planoAtualizacao(id, raizDe(workspaceId)) : null;
      return {
        ...base, permissoes, permissoes_erro,
        variaveis: e.variaveis.map((v) => ({ nome: v.nome, obrigatoria: v.obrigatoria, secreta: v.secreta, definida: definidas.has(v.nome) })),
        ferramentas: d.repo.ferramentasDe(id).map((f) => ({ nome: f.nome, descricao: f.descricao })),
        fontes: e.fontes.map((f) => ({ ...f })), links: { ...e.links }, riscos_texto: e.riscos_texto, observacoes: e.observacoes, maturidade: { ...e.maturidade },
        plano_atualizacao_disponivel: diff?.disponivel === true,
        clis: d.repo.cliInstalacoesDe(id).map((c) => ({ cli: c.cli, nome_na_cli: c.nome_na_cli })),
      };
    },

    async planoInstalacao(ids, workspaceId) {
      const n = await carregar();
      const planos: PlanoInstalacaoDto[] = [];
      const bloqueios: BloqueioPlanoDto[] = [];
      for (const id of ids) {
        const r = await n.ciclo.planoInstalacao(id, raizDe(workspaceId));
        if (r.ok) planos.push(planoDto(r.plano)); else bloqueios.push(bloqueioDto(id, r.bloqueio));
      }
      return { planos, bloqueios };
    },

    async instalar(pedido) {
      const hashes = pedido.consentimento.comando_hashes;
      const instalacao_id = emSegundoPlano(pedido.ids, async (id, sinal) => {
        const n = await carregar();
        const hash = hashes[id];
        if (hash === undefined) return { ok: false, codigo: "consentimento_invalido" };
        const r = await n.ciclo.instalar(id, { aceito: true, comando_hash: hash }, { origem: "loja", sinal, ...comRaiz(pedido.workspace_id) });
        return r.ok ? { ok: true, codigo: null } : { ok: false, codigo: r.codigo };
      }, pedido.workspace_id);
      return { instalacao_id };
    },

    async cancelar(instalacaoId) {
      const i = instalacoes.get(instalacaoId);
      if (!i) return { ok: false };
      i.controller.abort();
      return { ok: true };
    },

    async desinstalar(id, apagarSegredos) {
      const n = await carregar();
      const r = await n.ciclo.desinstalar(id, { apagar_segredos: apagarSegredos });
      if (r.ok) emitir({ tipo: "estado", id, estado: "removido", erro_codigo: null });
      return { ok: r.ok, codigo: r.codigo ?? null, residuos: r.residuos };
    },

    async planoAtualizacao(id, workspaceId) {
      const n = await carregar();
      return n.ciclo.planoAtualizacao(id, raizDe(workspaceId));
    },

    async atualizar(id, consentimento, workspaceId) {
      const instalacao_id = emSegundoPlano([id], async (alvo, sinal) => {
        const n = await carregar();
        const r = await n.ciclo.atualizar(alvo, consentimento, { sinal, ...comRaiz(workspaceId) });
        return r.ok ? { ok: true, codigo: null } : { ok: false, codigo: r.codigo };
      }, workspaceId);
      return { instalacao_id };
    },

    async variaveisEstado(id) {
      return (await carregar()).ciclo.variaveisEstado(id);
    },

    async gravarVariavel(id, nome, valor) {
      const r = await (await carregar()).ciclo.gravarVariavel(id, nome, valor);
      return r.ok ? { ok: true, codigo: null } : { ok: false, codigo: r.codigo };
    },

    async apagarVariavel(id, nome) {
      return (await carregar()).ciclo.apagarVariavel(id, nome);
    },

    async testar(id, workspaceId) {
      const n = await carregar();
      return testarEEmitir(n, id, workspaceId);
    },

    async habilitar(id, alvoTipo, alvoValor, habilitado) {
      const n = await carregar();
      if (alvoTipo === "workspace" && d.raizDoWorkspace(alvoValor) === null) return { ok: false, codigo: "alvo_invalido", detalhe: null };
      const r = acao(await n.ciclo.habilitar(id, alvoTipo, alvoValor, habilitado));
      if (r.ok) emitir({ tipo: "estado", id, estado: "habilitacao", erro_codigo: null });
      return r;
    },

    async habilitacoes(workspaceId) {
      return (await carregar()).ciclo.habilitacoes(workspaceId).map((h) => ({ ...h }));
    },

    async previaCliUsuario(id, cli, workspaceId) {
      const n = await carregar();
      const e = n.catalogo.porId.get(id)?.entrada as EntradaMcp | undefined;
      if (!e) return { ok: false, codigo: "catalogo_desconhecido", motivo: "servidor desconhecido" };
      const publicos = (await n.segredos.valores(e)).publicos;
      const r = previaCliUsuario(e, cli, { userData: d.userData, workspace: raizDe(workspaceId), node, nodeEhElectron, publicos });
      if (!r.ok) return { ok: false, codigo: r.codigo, motivo: r.motivo };
      const previa: PreviaCliMcp = { cli: r.previa.cli, nome_na_cli: r.previa.nome_na_cli, texto: r.previa.texto, avisos: [...r.previa.avisos] };
      return { ok: true, previa };
    },

    async instalarNaCli(id, cli, confirmacao, workspaceId) {
      const n = await carregar();
      const e = n.catalogo.porId.get(id)?.entrada as EntradaMcp | undefined;
      if (!e) return { ok: false, codigo: "catalogo_desconhecido", motivo: "servidor desconhecido" };
      if (d.repo.obterInstalado(id)?.estado !== "instalado") return { ok: false, codigo: "nao_instalado", motivo: "instale o servidor na Loja antes" };
      // escreve na configuração GLOBAL da CLI da pessoa: servidor que entrou na lista de bloqueio depois de instalado nunca vai para lá
      if (n.bloqueio.consultarEntrada(e) !== null) return { ok: false, codigo: "bloqueado", motivo: "servidor na lista de bloqueio" };
      const publicos = (await n.segredos.valores(e)).publicos;
      const p = previaCliUsuario(e, cli, { userData: d.userData, workspace: raizDe(workspaceId), node, nodeEhElectron, publicos });
      if (!p.ok) return { ok: false, codigo: p.codigo, motivo: p.motivo };
      const r = await n.cliUsuario.instalar(e, p.previa, confirmacao);
      return r.ok ? { ok: true, codigo: null, motivo: null } : { ok: false, codigo: r.codigo, motivo: r.motivo };
    },

    async removerDaCli(id, cli) {
      const r = await (await carregar()).cliUsuario.remover(id, cli);
      return r.ok ? { ok: true, codigo: null, motivo: null } : { ok: false, codigo: r.codigo, motivo: r.motivo };
    },

    async logs(id, limite) {
      return d.repo.logsDe(id, limite).map((l) => ({ em: l.em, nivel: l.nivel, evento: l.evento, detalhe: l.detalhe_json }));
    },

    async kitEstado() {
      return (await carregar()).kit.estado();
    },

    async kitPlano(workspaceId) {
      const p = await (await carregar()).kit.plano(raizDe(workspaceId));
      return { planos: p.planos.map(planoDto), bloqueios: p.bloqueios.map((b) => bloqueioDto(b.id, b.bloqueio)), comando_hash: p.comando_hash };
    },

    async kitInstalar(consentimento, workspaceId) {
      const instalacaoId = idInstalacao();
      const controller = new AbortController();
      instalacoes.set(instalacaoId, { controller, ids: [] });
      // o Kit instala o CONJUNTO com UM consentimento (hash do conjunto); o estado de cada item sai pelo mesmo canal de eventos
      void (async () => {
        const n = await carregar();
        const plano = await n.kit.plano(raizDe(workspaceId));
        const ids = plano.planos.map((x) => x.id);
        for (const id of ids) { idParaInstalacao.set(id, instalacaoId); emitir({ tipo: "estado", id, estado: "instalando", erro_codigo: null }); }
        const res = await n.kit.instalar(consentimento, { ...comRaiz(workspaceId), sinal: controller.signal });
        for (const r of res) {
          if (r.resultado.ok) {
            emitir({ tipo: "estado", id: r.id, estado: "instalado", erro_codigo: null });
            await testarEEmitir(n, r.id, workspaceId);
          } else emitir({ tipo: "estado", id: r.id, estado: "falhou", erro_codigo: r.resultado.codigo });
        }
        for (const id of ids) idParaInstalacao.delete(id);
      })()
        .catch(() => undefined)
        .finally(() => { instalacoes.delete(instalacaoId); ultimoProgresso.delete(instalacaoId); });
      return { instalacao_id: instalacaoId };
    },

    async kitOptOut(valor) {
      const n = await carregar();
      n.kit.definirOptOut(valor);
      return n.kit.estado();
    },

    async diagnostico() {
      const v = await diagnosticoDoCiclo();
      return {
        npm: { ok: v.npm?.ok === true, versao: v.npm?.versao ?? null }, node: { ok: v.node?.ok === true, versao: v.node?.versao ?? null },
        uv: { ok: v.uv?.ok === true, versao: v.uv?.versao ?? null }, docker: { ok: v.docker?.ok === true }, cofre: { disponivel: v.cofre?.disponivel === true },
      };
    },
    // Sem catálogo, cofre ou banco: só um GET por clique (timeout 8 s). O que volta é dado de terceiro e nunca habilita nada.
    descobrir: (consulta) => descobrirNoRegistro(consulta, { ...(d.fetch ? { fetch: d.fetch } : {}), ...(d.urlRegistro ? { url: d.urlRegistro } : {}) }),
  };

  // ---------------------------------------------------------------- Panes
  const porta: PortaLojaDoPane = {
    async resolver(alvo) {
      // Sem NENHUMA habilitação ativa (ou CLI sem injeção, como shell e Gemini) não há o que injetar: não carrega catálogo, não toca o cofre.
      if (!(CLIS_COM_INJECAO as readonly string[]).includes(alvo.cli)) return null;
      if (!d.repo.listarHabilitacoes().some((h) => h.habilitado)) return null;
      const n = await carregar();
      const { servidores } = await n.ciclo.servidoresDoPane({ workspace: alvo.workspace_id, missao: alvo.missao_id, agente: alvo.agente_id, modo: alvo.modo, membro_mcps: alvo.membro_mcps ?? null });
      if (servidores.length === 0) return null;
      const lancador = d.pasta === null ? "" : join(d.pasta, "mcp-run.mjs");
      const ctx = {
        userData: d.userData, workspace: alvo.raiz, node, nodeEhElectron,
        lancador: { script: lancador, variavelUrl: VARIAVEL_LOJA_URL, variavelToken: VARIAVEL_LOJA_TOKEN },
        estrito: alvo.missao_id !== null && alvo.modo !== "livre",
      };
      // só vale se a CLI recebe injeção (Gemini: nenhuma) — e só então o Pane entra no snapshot
      if (configuracaoDeMcpLoja(alvo.cli, servidores, ctx, "") === null) return null;
      const ids = servidores.map((s) => s.entrada.id);
      snapshots.set(alvo.pane_id, { ids: new Set(ids), raiz: alvo.raiz });
      try {
        d.persistirSnapshot?.(alvo.pane_id, { workspace_id: alvo.workspace_id, mission_id: alvo.missao_id, modo: alvo.modo, agente_id: alvo.agente_id, papel: "nenhum", ids, raiz: alvo.raiz });
      } catch { /* sem persistência o Pane só não sobrevive a um restart do app */ }
      d.barramento?.("mcp_store.injected", { pane_id: alvo.pane_id, cli: alvo.cli, ids });
      return { ids, configurar: (cli, arquivo) => configuracaoDeMcpLoja(cli, servidores, ctx, arquivo) };
    },

    async segredos(paneId, servidor) {
      const n = await carregar();
      const r = await n.rotaSegredos.resolver(paneId, servidor);
      // só o comando resolvido sai (o `env` solto é redundante e é o que mais convém não repetir)
      return r.status === 200 ? { status: 200, corpo: { comando: r.comando } } : { status: r.status, corpo: { erro: r.erro } };
    },

    async servidoresDoPane(alvo) {
      if (!(CLIS_COM_INJECAO as readonly string[]).includes(alvo.cli)) return [];
      if (!d.repo.listarHabilitacoes().some((h) => h.habilitado)) return [];
      const n = await carregar();
      const { servidores } = await n.ciclo.servidoresDoPane({ workspace: alvo.workspace_id, missao: alvo.missao_id, agente: alvo.agente_id, modo: alvo.modo, membro_mcps: alvo.membro_mcps ?? null });
      return servidores.map((x) => x.entrada.id);
    },
    async servidoresValidos(ids) {
      if (ids.length === 0) return [];
      const n = await carregar();
      return ids.filter((id) => servidorAindaValido(n, id) !== null);
    },
    async lancamentoDoServidor(id, raiz) {
      const n = await carregar();
      const entrada = servidorAindaValido(n, id);
      if (entrada === null) throw new Error("servidor indisponível");
      const v = await n.segredos.valores(entrada);
      const ctx = { userData: d.userData, node, nodeEhElectron, ...(raiz === null ? {} : { workspace: raiz }), ...(d.origem ? { origem: d.origem } : {}) };
      const c = montarComando(entrada, { userData: d.userData, variaveis: v.publicos, segredos: v.secretos, modo: "execucao", node, nodeEhElectron, ...(raiz === null ? {} : { workspace: raiz }) });
      if (c.tipo === "remoto") {
        if (c.url === null) throw new Error("servidor remoto sem URL");
        return { tipo: "remoto", url: c.url };
      }
      const l = montarLancamento(entrada, v, ctx);
      return { tipo: "stdio", executavel: l.executavel, args: l.args, env: l.env, cwd: l.cwd };
    },

    gate: (paneId, ferramenta) => decidirToolLoja(ferramenta, snapshotVivo(paneId)?.ids),
    async listarHabilitados(paneId, filtro) {
      const snap = snapshotVivo(paneId);
      if (snap === undefined || snap.ids.size === 0) return { servers: [] };
      const n = await carregar();
      // o snapshot é do lançamento: reconfere agora (desinstalado, falhou ou bloqueado depois sai da lista na hora)
      const entradas = [...snap.ids]
        .filter((id) => d.repo.obterInstalado(id)?.estado === "instalado" && n.bloqueio.consultarId(id) === null)
        .map((id) => n.catalogo.porId.get(id)?.entrada as EntradaMcp | undefined)
        .filter((e): e is EntradaMcp => e !== undefined);
      return listarServidoresParaAgente(entradas, (id) => d.repo.ferramentasDe(id).map((f) => f.nome), filtro);
    },
    emUso,
    liberar,
  };

  return {
    ...servico,
    ...porta,

    async ocioso() {
      // arquivos temporários de Pane que já não existe (app fechado à força, Pane livre morto): varredura barata, não depende de nada instalado
      await varrerArquivosOrfaosDaLoja(d.userData, (id) => d.paneAtivo(id) || snapshots.has(id)).catch(() => undefined);
      if (d.repo.listarInstalados().length === 0 && instalacoes.size === 0) return;
      const n = await carregar();
      await n.ciclo.limparTmpOrfaos();
      n.ciclo.aplicarBloqueio();
      d.repo.podarLogs(new Date(Date.now() - 30 * 86_400_000).toISOString());
    },

    encerrar() {
      encerrado = true;
      for (const i of instalacoes.values()) i.controller.abort();
      snapshots.clear();
    },
  };
}

/** Os dois arquivos temporários (0600) que a Loja grava por Pane: podem conter cabeçalho de chave de servidor remoto (D-133). */
const ARQUIVOS_TEMPORARIOS_DO_PANE = ["mcp.json", "claude-settings.json"] as const;

/**
 * Varredura no boot ocioso: apaga `mcp.json`/`claude-settings.json` de `<userData>/panes/<id>/` cujo Pane não está mais ativo. Só toca
 * esses dois nomes e só em pastas com nome de id válido (nunca segue symlink de pasta). Devolve os ids varridos.
 */
export async function varrerArquivosOrfaosDaLoja(userData: string, paneVivo: (paneId: string) => boolean): Promise<string[]> {
  const raiz = join(userData, "panes");
  let nomes: import("node:fs").Dirent[];
  try { nomes = await readdir(raiz, { withFileTypes: true }); } catch { return []; }
  const varridos: string[] = [];
  for (const n of nomes) {
    if (!n.isDirectory() || !/^[A-Za-z0-9_-]{1,128}$/.test(n.name) || paneVivo(n.name)) continue;
    const pasta = join(raiz, n.name);
    let achou = false;
    for (const a of ARQUIVOS_TEMPORARIOS_DO_PANE) {
      const alvo = join(pasta, a);
      if (existsSync(alvo)) { achou = true; await rm(alvo, { force: true }).catch(() => undefined); }
    }
    if (achou) varridos.push(n.name);
  }
  return varridos;
}

/** Apaga o `mcp.json` e o settings do Pane livre (só o que a Loja gravou em `<userData>/panes/<id>/`). */
export async function apagarArquivosLojaDoPane(userData: string, paneId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(paneId)) return;
  const pasta = join(userData, "panes", paneId);
  await Promise.all(ARQUIVOS_TEMPORARIOS_DO_PANE.map((a) => rm(join(pasta, a), { force: true }).catch(() => undefined)));
}
