// Motor de invocação de agentes de squad (Fase 14, T-14.11/12/13/14). Liga o squad ao que o MVP já faz (piloto/workers, portões,
// handoff, MCP) SEM reescrevê-lo: resolve o perfil do membro (CLI, modelo, esforço, conta) pela porta da Fase 9, compõe o prompt
// efetivo (base do papel + papel na squad + prompt do membro LIDO NO INSTANTE DO SPAWN + rigor), aplica limites por membro, por squad
// e global, e registra cada invocação (`invocacao_agente`). Sem Electron: tudo entra por injeção; o main só liga as pontas.
//
// Três pontos de entrada, todos chamados pelo main/orquestração:
//  - `registrarIntencao` + `prepararPane`  → o preparador de lançamento do Pane (piloto e workers);
//  - `ajustarSpawn`                        → `pane_spawn` e `agent_invoke` com `agent_id`: o perfil do membro MANDA;
//  - `invocar` / `agentList`               → a tool `agent_invoke` / `agent_list` (porta RPC do MCP).
import type { Banco } from "../banco";
import type { Repositorios } from "../banco/repos";
import { ErroMcp, naoEncontrado, violacaoDeRegra } from "../mcp/erros";
import type { AgenteDoSquad, PedidoSpawn, PortaMissoes, PortaPanes, PortaProvedores } from "../mcp/portas";
import type { EntradaPreparoDePane } from "../missoes/panes";
import { verificarSpawn } from "../orquestracao/regras";
import { NIVEL_POR_CLI } from "../catalogo/politica";
import { PRODUTO } from "../produto";
import type { Achado, NivelRigidez, PermissaoMembro, PortaoMissao, Squad } from "./tipos";
import { PAPEL_INTERNO, agentIdDe } from "./tipos";
import { PromptDoMembroInvalidoErro, SquadAusenteErro } from "./erros";
import { limiteEfetivoDaSquad, podeInvocar } from "./limites";
import { comCadeado, montarComandoDoMembro, paraPerfilCompleto, permissaoEfetiva, type PortaResolverPerfil, type ResolucaoPerfil } from "./perfil";
import { carregarBaseDoPapel, compor, hashDoPrompt, type EntradaCompor } from "./prompt";
import { rigidezEfetiva } from "./rigor";
import { partirAgentId, type ServicoSquads } from "./servico";
import { temErro, validarPrompt } from "./validar";

export const CHAVE_MAX_PARALELOS = (missionId: string): string => `squads.max_paralelos.${missionId}`;
/** Cadeado do wizard: CLI imposta a todos os membros nesta Missão (a squad em disco não muda). */
export const CHAVE_CLI_CADEADO = (missionId: string): string => `squads.cli_cadeado.${missionId}`;

/** O que o preparador de lançamento soma ao Pane do agente. */
export interface AgenteDoPane {
  agente_id: string;
  invocation_id: string;
  /** texto composto (base do papel + papel na squad + prompt do membro + rigor + regras inalteráveis). */
  instrucoes: string;
  /** `--model`, esforço por flag/config. Nunca o prompt; nunca flags de permissão (o workspace as decide). */
  argumentos: string[];
  ambiente: Record<string, string>;
  /** permissão efetiva do membro (`membro ?? missão ?? workspace`, limitada pelo workspace; D-232). */
  permissao: PermissaoMembro;
  /** Fase 7: o perfil do membro (`skills_permitidas`/`mcps_permitidos`) vira filtro REAL na política do Pane (só estreita). */
  skills_permitidas: string[];
  mcps_permitidos: string[];
}

/** Prompt enviado pela caixa da área Squads, à espera da Missão que vai nascer (o piloto abre dentro de `missoes.criar`). */
export interface IntencaoDeExecucao {
  execucao_id: string;
  squad_slug: string;
  squad_hash: string;
  contexto_rag: string | null;
  /** perfil do orquestrador já resolvido (a CLI do Pane foi escolhida a partir dele). */
  resolucao: ResolucaoPerfil;
  nivel_rigidez: NivelRigidez;
  plano_antes: boolean;
  pendentes: PortaoMissao[];
  liberar: PortaoMissao[];
  max_paralelos: number | null;
  /** CLI do cadeado do wizard (`null`/ausente = cada membro com a sua). */
  cli_cadeado?: string | null;
  /** modo (padrão `squad`) e título da Missão que vai nascer: uma Missão alheia (criada na mesma janela de tempo) NÃO consome a intenção. */
  modo?: "squad" | "agentico";
  titulo?: string;
}

export interface DepsMotorDeAgentes {
  servico: Pick<ServicoSquads, "obter" | "lerPrompt">;
  repos: Pick<Repositorios, "missionSquad" | "invocacaoAgente" | "squadExecucao" | "config" | "pane" | "paneRota">;
  banco: Banco;
  resolver: PortaResolverPerfil;
  /** a CLI está instalada e habilitada (providerList)? */
  cliHabilitada(cli: string): Promise<boolean>;
  permissaoDoWorkspace?: (workspaceId: string) => PermissaoMembro;
  /** flags lidas do `--help` (cache em ocioso); `null` = desconhecido (vale a tabela). Nunca roda `--help` no caminho do spawn. */
  flagsDaCli?: (cli: string) => ReadonlySet<string> | null;
  /** sem a Fase 7 o enforcement de skills não existe: a lista entra como instrução. */
  /**
   * A restrição de skills do membro é APLICADA em código para esta CLI? (Fase 7: padrão = a CLI tem isolamento duro, i.e. Claude Code). `true` tira do prompt a
   * instrução textual "não use outras skills" (o gate e o `permissions.deny` já impõem).
   */
  skillsAplicadas?: (cli?: string) => boolean;
  pastaDePrompts?: string;
  maxPanesParalelos?: number;
  definirSquad(missionId: string, agentes: AgenteDoSquad[]): void;
  liberarPortao(missionId: string, portao: PortaoMissao): void;
  emitir?: (tipo: string, payload: Record<string, unknown>) => void;
  avisar?: (mensagem: string) => void;
  agora?: () => Date;
}

export interface ClaimsDoChamador {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: AgenteDoSquad["papel"];
  mode: "livre" | "squad" | "agentico";
}
export interface PortasDoInvocar {
  panes: PortaPanes;
  missoes: PortaMissoes;
  provedores: PortaProvedores;
  /** grava o briefing do card dentro da pasta do produto e devolve o caminho relativo à raiz da Missão. */
  gravarBriefing(missionId: string, workspaceId: string, texto: string): Promise<string>;
}
export interface PedidoInvocar {
  agent_id: string;
  briefing_path?: string | null;
  /** ≤ 4 000; vira a seção Contrato do briefing quando não há `briefing_path`. */
  prompt?: string | null;
}

export const PROMPT_INVOCAR_MAX = 4000;

export function criarMotorDeAgentes(deps: DepsMotorDeAgentes) {
  const { servico, repos, banco } = deps;
  const agora = deps.agora ?? ((): Date => new Date());
  const maxGlobal = deps.maxPanesParalelos ?? 8;
  const intencoes = new Map<string, IntencaoDeExecucao>(); // por workspace; consumida pelo piloto da Missão
  const ragDaMissao = new Map<string, string | null>();
  const emitir = (tipo: string, payload: Record<string, unknown>): void => deps.emitir?.(tipo, payload);

  // ---- reservas de vaga (auditoria): o limite era conferido ANTES de a invocação existir; chamadas paralelas do orquestrador passavam todas ----
  const RESERVA_TTL_MS = 60_000;
  const reservas: Array<{ mission: string; agente: string; em: number }> = [];
  function podarReservas(): void {
    const corte = agora().getTime() - RESERVA_TTL_MS;
    for (let i = reservas.length - 1; i >= 0; i--) if ((reservas[i] as { em: number }).em <= corte) reservas.splice(i, 1);
  }
  const reservadas = (mission: string, agente?: string | string[]): number => reservas.filter((r) => r.mission === mission && (agente === undefined || (Array.isArray(agente) ? agente.includes(r.agente) : r.agente === agente))).length;
  function soltarReserva(mission: string, agente: string): void {
    const i = reservas.findIndex((r) => r.mission === mission && r.agente === agente);
    if (i >= 0) reservas.splice(i, 1);
  }
  const cadeadoDaMissao = (missionId: string): string | null => {
    const v = repos.config.obter<unknown>(CHAVE_CLI_CADEADO(missionId));
    return typeof v === "string" ? v : null;
  };
  /**
   * Respawn e troca de conta (Fase 9, `harness-mover`/`respawn`) abrem um Pane NOVO sem `agente_id` nem `contexto.agente`: sem isto o agente
   * voltaria como terminal comum (sem prompt do membro e, pior, sem a restrição de permissão do membro). O agente é herdado do Pane
   * antigo SÓ se ele era da MESMA Missão; qualquer outra coisa não concede agente.
   */
  function agenteDoRespawn(e: EntradaPreparoDePane): string | null {
    const de = e.pedido.respawn_de;
    if (typeof de !== "string" || e.missao === undefined) return null;
    const antigo = repos.pane.obter(de);
    return antigo !== undefined && antigo.mission_id === e.missao.id ? (antigo.agente_id ?? null) : null;
  }
  const agentesDaSquad = (s: Squad): AgenteDoSquad[] => s.membros.map((m) => ({ agente_id: agentIdDe(s.slug, m.slug), papel: PAPEL_INTERNO[m.papel] }));

  function squadOuErro(slug: string): Squad {
    try {
      return servico.obter(slug);
    } catch {
      throw new SquadAusenteErro(slug);
    }
  }

  /** Invocações cujo Pane já terminou deixam de ocupar vaga (`pane.closed` por qualquer caminho). */
  function sincronizarEncerradas(): number {
    const abertas = banco.consultar<{ id: string; agente_id: string; pane_id: string; mission_id: string | null }>(
      "SELECT id, agente_id, pane_id, mission_id FROM invocacao_agente WHERE encerrada_em IS NULL AND pane_id IN (SELECT id FROM pane WHERE estado = 'encerrado')",
    );
    for (const a of abertas) {
      repos.invocacaoAgente.fechar(a.id, agora().toISOString());
      emitir("agent.closed", { invocation_id: a.id, agente_id: a.agente_id, pane_id: a.pane_id, mission_id: a.mission_id });
    }
    return abertas.length;
  }

  const contar = (sql: string, params: Array<string | number>): number => Number(banco.consultarUm<{ n: number }>(sql, params)?.n ?? 0);

  // ---------------------------------------------------------------- execução por prompt direto
  /** A caixa de prompt registra a intenção ANTES de `missoes.criar`; o preparador do piloto a consome ao abrir o Pane. */
  function registrarIntencao(workspaceId: string, i: IntencaoDeExecucao): void {
    intencoes.set(workspaceId, i);
  }
  const descartarIntencao = (workspaceId: string): void => void intencoes.delete(workspaceId);

  function vincularMissao(missionId: string, workspaceId: string, i: IntencaoDeExecucao): void {
    repos.missionSquad.gravar({
      mission_id: missionId,
      squad_slug: i.squad_slug,
      squad_hash: i.squad_hash,
      portoes_pendentes: i.pendentes,
      nivel_rigidez: i.nivel_rigidez,
      plano_antes: i.plano_antes,
    });
    repos.squadExecucao.vincularMissao(i.execucao_id, missionId);
    if (i.max_paralelos !== null) repos.config.definir(CHAVE_MAX_PARALELOS(missionId), i.max_paralelos);
    if (i.cli_cadeado != null) repos.config.definir(CHAVE_CLI_CADEADO(missionId), i.cli_cadeado);
    ragDaMissao.set(missionId, i.contexto_rag);
    deps.definirSquad(missionId, agentesDaSquad(squadOuErro(i.squad_slug)));
    for (const p of i.liberar) deps.liberarPortao(missionId, p);
    void workspaceId;
  }

  // ---------------------------------------------------------------- preparador de lançamento
  const lerAgenteDoContexto = (contexto: EntradaPreparoDePane["pedido"]["contexto"]): { agente_id: string; resolucao: ResolucaoPerfil } | null => {
    const a = contexto?.["agente"];
    if (typeof a !== "object" || a === null) return null;
    const { agente_id, resolucao } = a as { agente_id?: unknown; resolucao?: unknown };
    return typeof agente_id === "string" && typeof resolucao === "object" && resolucao !== null ? { agente_id, resolucao: resolucao as ResolucaoPerfil } : null;
  };

  /**
   * Preparo do Pane de um agente. `null` = Pane sem agente (o MVP segue idêntico). Erro nominal = o Pane NÃO abre (nada órfão: o
   * serviço de Panes o encerra como `falha_ao_abrir`).
   */
  async function prepararPane(e: EntradaPreparoDePane): Promise<AgenteDoPane | null> {
    try {
      return await prepararPaneInterno(e);
    } finally {
      // a vaga reservada por `ajustarSpawn` vira invocação (ou falha) aqui: em qualquer caso a reserva acaba
      const a = lerAgenteDoContexto(e.pedido.contexto);
      if (a !== null && e.missao !== undefined && !e.pane.eh_piloto) soltarReserva(e.missao.id, a.agente_id);
    }
  }

  async function prepararPaneInterno(e: EntradaPreparoDePane): Promise<AgenteDoPane | null> {
    const { pane, missao, workspace } = e;
    if (missao === undefined || missao.modo === "livre") return null;
    let vinculo = repos.missionSquad.obter(missao.id);
    const doContexto = lerAgenteDoContexto(e.pedido.contexto);
    let agenteId: string | null;
    let resolucao: ResolucaoPerfil | null = doContexto?.resolucao ?? null;
    if (pane.eh_piloto) {
      if (vinculo === undefined) {
        const candidata = missao.modo === "squad" || missao.modo === "agentico" ? (intencoes.get(workspace.id) ?? null) : null;
        const i = candidata !== null && (candidata.modo ?? "squad") === missao.modo && (candidata.titulo === undefined || candidata.titulo === missao.titulo) ? candidata : null;
        if (i === null) return null; // Missão de squad sem squad (fluxo do MVP): nada muda
        intencoes.delete(workspace.id);
        vincularMissao(missao.id, workspace.id, i);
        vinculo = repos.missionSquad.exigir(missao.id);
        resolucao = i.resolucao;
      }
      const orq = squadOuErro(vinculo.squad_slug).membros.find((m) => m.papel === "orchestrator");
      if (orq === undefined) throw new SquadAusenteErro(vinculo.squad_slug);
      agenteId = agentIdDe(vinculo.squad_slug, orq.slug);
    } else {
      if (vinculo === undefined) return null;
      agenteId = doContexto?.agente_id ?? pane.agente_id ?? agenteDoRespawn(e) ?? null;
      if (agenteId === null) return null;
    }

    const partes = partirAgentId(agenteId);
    if (partes === null) return null;
    const squad = squadOuErro(partes.squad);
    const membro = squad.membros.find((m) => m.slug === partes.membro);
    if (membro === undefined) throw new SquadAusenteErro(`${partes.squad}.${partes.membro}`);

    // D-211: o prompt é lido do arquivo AGORA; edição feita depois da Missão criada vale na próxima invocação.
    const texto = (await servico.lerPrompt(agenteId)).texto;
    const achados: Achado[] = validarPrompt(texto, "prompt");
    if (temErro(achados)) throw new PromptDoMembroInvalidoErro(agenteId, achados);

    let membroEf = comCadeado(membro, cadeadoDaMissao(missao.id));
    if (resolucao === null && typeof e.pedido.respawn_de === "string") {
      // respawn/troca: CLI, modelo, esforço e conta já foram decididos por quem pediu (harness); o perfil NOMINAL do membro não os desfaz
      // (mesma CLI do membro e pedido sem modelo/esforço = reinício comum: vale o perfil do membro)
      const cliNova = pane.cli ?? e.pedido.cli;
      const mesma = cliNova === membroEf.perfil.cli;
      const modelo = e.pedido.modelo ?? (mesma ? membroEf.perfil.modelo : null);
      const esforco = e.pedido.esforco ?? (mesma ? membroEf.perfil.esforco : null);
      membroEf = { ...membroEf, perfil: { ...membroEf.perfil, cli: cliNova, modelo, esforco } };
      resolucao = { cli: cliNova, modelo, conta: e.pedido.conta_id ?? null, motivo: "respawn: perfil do pedido (decidido pelo harness)" };
    }
    resolucao ??= await deps.resolver.resolverPerfil(paraPerfilCompleto(membroEf, agenteId), { workspace_id: workspace.id, papel: PAPEL_INTERNO[membro.papel], mission_id: missao.id });
    // a CLI do Pane já foi escolhida; os argumentos precisam combinar com ela
    if (pane.cli !== null && pane.cli !== resolucao.cli) {
      deps.avisar?.(`${agenteId}: a CLI do Pane (${pane.cli}) difere da resolvida (${resolucao.cli}); vale a do Pane.`);
      resolucao = { ...resolucao, cli: pane.cli };
    }

    const nivel = rigidezEfetiva(membro.rigidez, vinculo.nivel_rigidez, squad.rigidez_padrao);
    const card = (e.pedido.contexto?.["card"] as { task_ref?: unknown } | undefined)?.task_ref;
    const cardRef = typeof card === "string" ? card : undefined;
    const base = await carregarBaseDoPapel(membro.papel, { missao: missao.id, ...(cardRef === undefined ? {} : { card: cardRef }), ...(deps.pastaDePrompts === undefined ? {} : { pastaPrompts: deps.pastaDePrompts }) });
    const execucao = repos.squadExecucao.porMissao(missao.id);
    const avisosDeComposicao: string[] = [];
    const renderizador = {
      renderizar: (en: { rigor: string; esforco_indicativo: string | null }): string => {
        const entrada: EntradaCompor = {
          squad: { slug: squad.slug, nome: squad.nome },
          membro: membroEf,
          textoDoMembro: texto,
          base,
          variaveis: {
            objetivo: execucao?.objetivo ?? null,
            contexto_rag: ragDaMissao.get(missao.id) ?? null,
            arquivos: null,
            missao: missao.id,
            ...(cardRef === undefined ? {} : { card: cardRef }),
            pasta: `${PRODUTO.pastaNoProjeto}/missoes/${missao.id}`,
          },
          elenco: squad.membros,
          rigor: en.rigor,
          ...(en.esforco_indicativo !== null && membroEf.perfil.esforco !== null ? { esforco: { nivel: membroEf.perfil.esforco, modo: "indicativo" as const } } : {}),
          skillsAplicadas: deps.skillsAplicadas?.(resolucao.cli) ?? (NIVEL_POR_CLI as Record<string, string>)[resolucao.cli] === "duro",
        };
        const c = compor(entrada);
        avisosDeComposicao.push(...c.avisos);
        return c.instrucoes;
      },
    };
    const flags = deps.flagsDaCli?.(resolucao.cli) ?? null;
    const comando = montarComandoDoMembro(membroEf, {
      squad_slug: squad.slug,
      executavel: pane.executavel_id ?? pane.cli ?? resolucao.cli,
      // as flags automáticas do workspace já entram pela camada de sessões; aqui nunca se repetem
      permissao_workspace: "seguro",
      permissao_missao: null,
      rigidez: nivel,
      renderizador,
      objetivo: execucao?.objetivo ?? null,
      workspace_id: workspace.id,
      mission_id: missao.id,
      resolucao,
      agente_id: agenteId,
      ...(flags === null ? {} : { esforco: { flagsDetectadas: flags } }),
    });
    for (const a of [...comando.perfil_efetivo.avisos, ...avisosDeComposicao]) deps.avisar?.(`${agenteId}: ${a}`);

    banco.executar("UPDATE pane SET agente_id = ?, modelo = ?, esforco = ? WHERE id = ?", [agenteId, comando.modelo, comando.perfil_efetivo.esforco, pane.id]);
    // Fase 9: a troca por consumo lê `pane_rota`; para agente de squad ela precisa refletir o perfil que de fato roda (não a rota do harness,
    // que o `agent_id` sobrepõe). O harness não regrava rota de Pane que já é do agente (ver `portaRota.gravar`).
    try {
      repos.paneRota.gravar({ pane_id: pane.id, perfil: { agente_id: agenteId, provider: comando.perfil_efetivo.cli, cli: comando.perfil_efetivo.cli, modelo: comando.modelo, esforco: comando.perfil_efetivo.esforco, faixa: comando.perfil_efetivo.faixa }, saltos: repos.paneRota.obter(pane.id)?.saltos ?? 0 });
    } catch (erro) {
      deps.avisar?.(`${agenteId}: rota do Pane não gravada (${erro instanceof Error ? erro.message : "erro"}).`);
    }
    repos.invocacaoAgente.fecharPorPane(pane.id, agora().toISOString()); // respawn do piloto: a invocação anterior termina
    const taskRef = cardRef ?? null;
    const permissao = permissaoEfetiva(membro.permissao, null, deps.permissaoDoWorkspace?.(workspace.id) ?? "seguro");
    const inv = repos.invocacaoAgente.abrir({
      mission_id: missao.id,
      pane_id: pane.id,
      agente_id: agenteId,
      task_ref: taskRef,
      perfil: { ...comando.perfil_efetivo, recibo: resolucao.motivo },
      prompt_hash: hashDoPrompt(comando.prompt),
      recibo: `${resolucao.motivo} | permissão ${permissao}`,
    });
    emitir("agent.invoked", { invocation_id: inv.id, agente_id: agenteId, pane_id: pane.id, mission_id: missao.id });
    return { agente_id: agenteId, invocation_id: inv.id, instrucoes: comando.prompt, argumentos: comando.argumentos, ambiente: comando.ambiente, permissao, skills_permitidas: [...membro.skills_permitidas], mcps_permitidos: [...membro.mcps_permitidos] };
  }

  // ---------------------------------------------------------------- pane_spawn / agent_invoke com agent_id
  /**
   * Aplica o perfil do membro ao pedido de spawn: o provedor/modelo informados pelo chamador são IGNORADOS (o perfil do membro
   * manda). Valida pertencimento, papel, instâncias por membro/squad/global e a CLI resolvida. Missão sem squad vinculada = MVP.
   */
  async function ajustarSpawn(p: PedidoSpawn): Promise<{ pedido: PedidoSpawn; contexto: Record<string, unknown> | null }> {
    if (p.agente_id === null || p.mission_id === null) return { pedido: p, contexto: null };
    const vinculo = repos.missionSquad.obter(p.mission_id);
    if (vinculo === undefined) return { pedido: p, contexto: null };
    const partes = partirAgentId(p.agente_id);
    const fora = (): ErroMcp => violacaoDeRegra("forbidden_role", `O agente "${p.agente_id}" não pertence ao squad da Missão.`);
    if (partes === null || partes.squad !== vinculo.squad_slug) throw fora();
    let squad: Squad;
    try {
      squad = servico.obter(partes.squad);
    } catch {
      throw fora();
    }
    const membro = squad.membros.find((m) => m.slug === partes.membro);
    if (membro === undefined) throw fora();
    if (membro.papel === "orchestrator") throw violacaoDeRegra("forbidden_role", "O piloto não invoca o orquestrador nem a si mesmo.");

    sincronizarEncerradas();
    podarReservas();
    const orqId = squad.membros.filter((m) => m.papel === "orchestrator").map((m) => agentIdDe(squad.slug, m.slug));
    // + reservas de chamadas ainda em voo (o orquestrador pode emitir várias de uma vez)
    const doMembro = contar("SELECT COUNT(*) AS n FROM invocacao_agente WHERE mission_id = ? AND agente_id = ? AND encerrada_em IS NULL", [p.mission_id, p.agente_id]) + reservadas(p.mission_id, p.agente_id);
    const daSquad = contar(`SELECT COUNT(*) AS n FROM invocacao_agente WHERE mission_id = ? AND encerrada_em IS NULL AND agente_id NOT IN (${orqId.map(() => "?").join(",")})`, [p.mission_id, ...orqId]) + reservadas(p.mission_id);
    const globais = contar("SELECT COUNT(*) AS n FROM pane WHERE mission_id = ? AND eh_piloto = 0 AND estado <> 'encerrado'", [p.mission_id]) + reservadas(p.mission_id);
    const configurado = repos.config.obter<unknown>(CHAVE_MAX_PARALELOS(p.mission_id));
    const limite = limiteEfetivoDaSquad(squad.max_instancias_paralelas, typeof configurado === "number" ? configurado : null, maxGlobal);
    const v = podeInvocar({ max_instancias_membro: membro.max_instancias, max_instancias_paralelas_squad: limite, vivos_do_membro: doMembro, vivos_da_squad: daSquad, vivos_globais: globais, max_global: maxGlobal });
    if (!v.ok) throw violacaoDeRegra("limit_reached", v.mensagem);

    // reserva SÍNCRONA (nenhum `await` entre a conferência e ela): a próxima chamada já enxerga esta vaga ocupada
    const agenteReservado = p.agente_id;
    const missaoReservada = p.mission_id;
    reservas.push({ mission: missaoReservada, agente: agenteReservado, em: agora().getTime() });
    try {
    const resolucao = await deps.resolver.resolverPerfil(paraPerfilCompleto(comCadeado(membro, cadeadoDaMissao(p.mission_id)), p.agente_id), { workspace_id: p.workspace_id, papel: PAPEL_INTERNO[membro.papel], mission_id: p.mission_id });
    if (!(await deps.cliHabilitada(resolucao.cli))) throw violacaoDeRegra("provider_disabled", `O provedor "${resolucao.cli}" do agente "${p.agente_id}" não está habilitado.`);
    if (membro.papel === "reviewer") {
      const mesmaCli = contar("SELECT COUNT(*) AS n FROM pane WHERE mission_id = ? AND papel = 'executor' AND estado <> 'encerrado' AND cli = ?", [p.mission_id, resolucao.cli]);
      if (mesmaCli > 0) deps.avisar?.(`O revisor "${p.agente_id}" usa a mesma CLI ("${resolucao.cli}") de um executor ativo; uma revisão independente prefere outro provedor.`);
    }
    return {
      // `modelo: null`: o modelo e o esforço entram pelo preparador (uma vez só), nunca duplicados pelo serviço de Panes
      pedido: { ...p, provedor: resolucao.cli, modelo: null, conta_id: resolucao.conta ?? p.conta_id, papel: PAPEL_INTERNO[membro.papel] },
      contexto: { agente: { agente_id: p.agente_id, resolucao } },
    };
    } catch (erro) {
      soltarReserva(missaoReservada, agenteReservado); // falhou depois de reservar: a vaga volta
      throw erro;
    }
  }

  // ---------------------------------------------------------------- tools agent_list / agent_invoke
  function membrosDaMissao(missionId: string): AgenteDoSquad[] | null {
    const v = repos.missionSquad.obter(missionId);
    if (v === undefined) return null;
    try {
      return agentesDaSquad(servico.obter(v.squad_slug));
    } catch {
      return null;
    }
  }

  /** `agent_list`: só a squad da Missão do token; nunca o texto do prompt; o orquestrador não é invocável e não aparece. */
  function agentList(missionId: string): { agents: Array<{ agent_id: string; role: string; label: string; description: string; tier: string; max_instances: number; in_flight: number }> } {
    const v = repos.missionSquad.obter(missionId);
    if (v === undefined) throw naoEncontrado("A Missão não tem squad.");
    sincronizarEncerradas();
    const squad = squadOuErro(v.squad_slug);
    return {
      agents: squad.membros
        .filter((m) => m.papel !== "orchestrator")
        .map((m) => ({
          agent_id: agentIdDe(squad.slug, m.slug),
          role: m.papel,
          label: m.rotulo,
          description: m.descricao,
          tier: m.perfil.faixa,
          max_instances: m.max_instancias,
          in_flight: repos.invocacaoAgente.contarVivas(missionId, agentIdDe(squad.slug, m.slug)),
        })),
    };
  }

  /**
   * `agent_invoke`: gate → papel → limite (membro, squad, global) → provedor, o mesmo caminho do `pane_spawn` com agente. A identidade
   * (Missão, Pane, papel) vem do token. O provedor é checado DEPOIS da resolução do perfil (a Fase 9 pode reroutear a CLI).
   */
  async function invocar(claims: ClaimsDoChamador, args: PedidoInvocar, portas: PortasDoInvocar): Promise<{ pane_id: string; invocation_id: string }> {
    if (claims.mission_id === null) throw violacaoDeRegra("not_in_mission", "O Pane não pertence a uma Missão.");
    const vinculo = repos.missionSquad.obter(claims.mission_id);
    if (vinculo === undefined) throw violacaoDeRegra("forbidden_role", "A Missão não tem squad: não há agentes para invocar.");
    const partes = partirAgentId(args.agent_id);
    let squad: Squad;
    try {
      squad = servico.obter(vinculo.squad_slug);
    } catch {
      throw naoEncontrado("A squad da Missão não existe mais.");
    }
    const membro = partes !== null && partes.squad === squad.slug ? squad.membros.find((m) => m.slug === partes.membro) : undefined;
    if (membro === undefined) throw violacaoDeRegra("forbidden_role", `O agente "${args.agent_id}" não pertence ao squad da Missão.`);
    if (args.prompt !== undefined && args.prompt !== null && [...args.prompt].length > PROMPT_INVOCAR_MAX) throw new ErroMcp("invalid_argument", `O campo "prompt" excede ${PROMPT_INVOCAR_MAX} caracteres.`);

    const [missao, provedores, panes] = await Promise.all([portas.missoes.obter(claims.mission_id), portas.provedores.listar(claims.workspace_id), portas.panes.listar({ workspace_id: claims.workspace_id, mission_id: claims.mission_id })]);
    // gate → papel → limite global (verificarSpawn); o provedor declarado é aceito aqui e conferido após a resolução
    const declarado = membro.perfil.cli === "auto" ? "claude" : membro.perfil.cli;
    verificarSpawn({
      chamador: { pane_id: claims.pane_id, papel: claims.role, modo: claims.mode },
      missao,
      papel_pedido: null,
      agente_id: args.agent_id,
      provedor: declarado,
      provedores: [...provedores.filter((x) => x.provedor !== declarado), { provedor: declarado, cli: declarado, contas: [], habilitado: true }],
      panes_vivos: panes,
      max_paralelos: maxGlobal,
    });

    let briefing = args.briefing_path ?? null;
    if (briefing === null && args.prompt !== undefined && args.prompt !== null && args.prompt.trim() !== "") {
      briefing = await portas.gravarBriefing(claims.mission_id, claims.workspace_id, `# Briefing do agente ${args.agent_id}\n\n## Contrato\n\n${args.prompt.trim()}\n\n## Resultado\n\n(a preencher pelo agente)\n\n## Executado_por\n\n${args.agent_id}\n`);
    }
    const { pane_id } = await portas.panes.spawn({
      workspace_id: claims.workspace_id,
      mission_id: claims.mission_id,
      pedido_por_pane_id: claims.pane_id,
      provedor: declarado,
      modelo: null,
      conta_id: null,
      papel: PAPEL_INTERNO[membro.papel],
      agente_id: args.agent_id,
      briefing_path: briefing,
      cwd: null,
    });
    const inv = banco.consultarUm<{ id: string }>("SELECT id FROM invocacao_agente WHERE pane_id = ? ORDER BY id DESC LIMIT 1", [pane_id]);
    return { pane_id, invocation_id: inv?.id ?? "" };
  }

  return { registrarIntencao, descartarIntencao, prepararPane, ajustarSpawn, membrosDaMissao, agentList, invocar, sincronizarEncerradas };
}
export type MotorDeAgentes = ReturnType<typeof criarMotorDeAgentes>;
