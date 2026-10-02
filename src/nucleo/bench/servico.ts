// ServicoBench (núcleo): orquestra catálogo, alvos, estimativa, consentimento, execução em workdir isolado, medição, julgamento, comparação e recomendação. Sem Electron: tudo que é do mundo
// (sandbox, processos, contas, limites, preços da Fase 10, salvar arquivo) entra por PORTA. Nada roda no boot: o main só cria o serviço no primeiro uso.
//
// Garantias (cada uma tem teste): nenhuma Run/re-run/julgamento começa sem token de consentimento humano de uso único (TTL 120 s) atrelado à estimativa; sem sandbox utilizável a Run é
// RECUSADA (Windows só com a frase reforçada); o ambiente do filho nasce por allowlist; cada par roda em `<userData>/bench/exec/<run>/<tarefa>/<alvo>/` descartável, fora de repositório;
// custo desconhecido nunca vira zero; `mapa_cego` nunca sai do núcleo; o log lido pela UI e o relatório passam por redação de segredo e de caminho absoluto.
import { createHash } from "node:crypto";
import { readFileSync, statSync, openSync, readSync, closeSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Banco } from "../banco/banco";
import { adaptadorDaCli } from "./adaptadores";
import { lerAjudaDaCli, verificarFlags, type AdaptadorHeadless, type ComandoAdaptador } from "./adaptadores/adaptador";
import { assinaturaDe, criarCofreConsentimento, type CofreConsentimento, type EstimativaGuardada, type FinalidadeToken } from "./consentimento";
import { compararHistorico, montarRelatorio, rascunhoDasAtividades, recomendarHistorico } from "./consulta";
import { criarExecutor, criarRegistroPidsMemoria, limparOrfaos, type ExecutorProcessos, type RegistroPids } from "./execucao/executor";
import { escalonar, limitarParalelo, type EstadoConta, type MotivoPulo } from "./execucao/escalonador";
import { caminhoRelativoSeguro, criarWorkdir, garantirDentro, listarArtefatos, limparRun, resolverArtefato, tipoDoArquivo } from "./execucao/workdir";
import { julgar as julgarCego, juizIgualAExecutor, type NotaJuiz } from "./julgamento/juiz";
import type { EntregaParaPacote } from "./julgamento/pacote-cego";
import { executarChecagens } from "./medicao/checagens";
import { calcularCusto, congelar, mediana, precoVigente, validarPreco, type UsoMedido } from "./precos";
import { limpar, redigirSegredos } from "./redacao";
import { criarReposBench, slugDoAlvo, type ReposBench } from "./repositorios";
import { montarAmbiente } from "./sandbox/ambiente";
import { negadosPadrao } from "./sandbox/macos";
import type { Sandbox } from "./sandbox/sandbox";
import { sementes, fixturesDaTarefa } from "./tarefas/catalogo";
import { promptEfetivo } from "./tarefas/semente";
import { validarTarefa } from "./tarefas/validacao";
import {
  ErroBench, FRASE_CONSENTIMENTO, FRASE_CONSENTIMENTO_SEM_SANDBOX, MAX_EXECUCOES_POR_RUN, MAX_EXECUCOES_SEM_CUSTO, MAX_LOG_PAGINA, PESOS_PADRAO,
  type AlvoBench, type AlvoDisponivel, type AlvoEditavel, type Comparacao, type DetalheResultado, type Estimativa, type EstadoRun, type EstadoTarefa, type Estrategia, type ErroRodar, type ErroTarefa,
  type EventoBenchIpc, type GradeRun, type LinhaResultado, type LinhaRun, type ModoSandbox, type Pagina, type PrecoBench, type PrecoCongelado, type RascunhoPolitica, type Recomendacao,
  type ResumoResultado, type ResumoRun, type Restricoes, type TarefaBench, type TarefaEditavel,
} from "./tipos";

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- portas

export interface ContaDedicada { home: string; configDir: string; assinatura?: boolean }
export interface PortaContas { resolver(contaId: string): ContaDedicada | null }
export interface PortaLimites { estadoConta(contaId: string): EstadoConta }
export interface PortaPrecos { preco(modelo: string, ts: string): PrecoCongelado | null }
export interface PortaProvedores { habilitados(): ReadonlySet<string> }
export interface PortaSalvar { salvar(nomeSugerido: string, conteudo: string): Promise<string | null> }

export interface DepsServicoBench {
  banco: Banco;
  /** `<userData>/bench`. Dentro dela: `exec/` (workdirs), `pids/`. */
  pastaBench: string;
  /** `<userData>`: leitura negada ao filho (cofre, banco), com a conta dedicada e o workdir reabertos. */
  pastaDados: string;
  /** HOME REAL do usuário (para negar credenciais). */
  homeReal: string;
  sandboxPara(cli: AlvoBench["cli"]): Sandbox;
  /** sandbox das checagens (código gerado pela IA); padrão: o do Claude (externo). */
  sandboxChecagens?: Sandbox;
  contas: PortaContas;
  limites?: PortaLimites;
  precos?: PortaPrecos;
  provedores?: PortaProvedores;
  salvar?: PortaSalvar;
  emitir?: (e: EventoBenchIpc) => void;
  executor?: ExecutorProcessos;
  registroPids?: RegistroPids;
  /** ambiente do processo pai (só lido); padrão `process.env`. */
  ambientePai?: () => Readonly<Record<string, string | undefined>>;
  scrub?: (t: string) => string;
  /** teste: variáveis extras no filho (passam pelo filtro de nome). */
  ambienteExtra?: Readonly<Record<string, string>>;
  /** teste: troca o executável/argv montado (ex.: `node cli-bench.mjs`). */
  prepararComando?: (c: ComandoAdaptador, cli: AlvoBench["cli"]) => { executavel: string; args: string[] };
  /** teste: `--help` simulado. */
  lerAjuda?: (executavel: string, env: Record<string, string>) => Promise<string>;
  /** teste: juiz injetado (devolve o texto do modelo). */
  chamarJuiz?: (alvo: AlvoBench, prompt: string, runId: string) => Promise<{ texto: string; custo_usd: number | null }>;
  relogio?: () => number;
  timeoutPadraoMs?: number;
  timeoutChecagemMs?: number;
  plataforma?: NodeJS.Platform;
}

export interface SalvarTarefaResultado { tarefa?: TarefaBench; erro?: ErroTarefa }

const FINAIS: ReadonlySet<string> = new Set(["concluido", "falhou", "tempo_esgotado"]);
const ENCERRADOS: ReadonlySet<string> = new Set(["concluido", "falhou", "tempo_esgotado", "cancelado", "interrompido", "substituido"]);
const PROGRESSO_MIN_MS = 250;
const CACHE_AJUDA_MS = 60_000;

export interface ServicoBench {
  tarefasListar(atividade: string | null, estado: EstadoTarefa | null): TarefaBench[];
  tarefaSalvar(t: TarefaEditavel): TarefaBench | { erro: ErroTarefa };
  alvosListar(): Promise<AlvoDisponivel[]>;
  alvosSalvar(a: AlvoEditavel[]): AlvoBench[];
  precosLer(): PrecoBench[];
  precosGravar(p: PrecoBench[]): PrecoBench[];
  estimar(p: { tarefas: string[]; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null }): Promise<Estimativa>;
  consentir(estimativaId: string, confirmacao: string, finalidade?: FinalidadeToken): ReturnType<CofreConsentimento["consentir"]>;
  descartarConsentimento(estimativaId: string): void;
  rodar(estimativaId: string, token: string): Promise<{ run_id: string } | { erro: ErroRodar }>;
  cancelar(runId: string): Promise<boolean>;
  rerodar(runId: string, tarefa: string, alvo: string, token: string): Promise<{ resultado_id: string } | { erro: ErroRodar }>;
  julgar(runId: string, tarefa: string | null, juizAlvo: string, token: string): Promise<{ veredito_ids: string[] } | { erro: "juiz_igual_a_executor" | "sem_resultados" | "consentimento_invalido" }>;
  notaManual(resultadoId: string, nota: number, notas: string | null): boolean;
  runsListar(depois: string | null): Pagina<ResumoRun>;
  estadoRun(runId: string): GradeRun;
  resultado(resultadoId: string): DetalheResultado;
  logLer(resultadoId: string, depois: number, max: number): { texto: string; proximo: number };
  artefatoLer(resultadoId: string, nome: string): { bytes: Uint8Array; tipo: string };
  comparar(alvos: string[], tarefas: string[] | null, agrupar: "tarefa" | "atividade"): Comparacao | { erro: "nao_comparavel" };
  recomendar(atividade: string, restricoes: Restricoes | null, estrategia: Estrategia | null): Recomendacao;
  exportarPolitica(atividades: string[] | null): { rascunho: RascunhoPolitica[]; avisos: string[] };
  exportarRelatorio(runIds: string[] | null, formato: "md" | "json"): Promise<{ caminho: string | null }>;
  limparExecucoes(runId: string): void;
  /** espera as Runs em andamento terminarem (teste/encerramento). */
  aguardar(): Promise<void>;
  /** cancela tudo, mata as árvores e espera. */
  encerrar(): Promise<void>;
  readonly repos: ReposBench;
}

/** tira da lista os arquivos de fixture que a IA não mexeu (só o que ela criou ou mudou é entrega). */
function semFixturesIntactas(lista: ReturnType<typeof listarArtefatos>, fixtures: Readonly<Record<string, string>>): ReturnType<typeof listarArtefatos> {
  const hash = new Map(Object.entries(fixtures).map(([k, v]) => [k, createHash("sha256").update(v).digest("hex")]));
  return lista.filter((a) => hash.get(a.nome) !== a.sha256);
}

function limiteMais<T>(xs: T[], n: number): T[] { return xs.slice(0, n); }

export function criarServicoBench(d: DepsServicoBench): ServicoBench {
  const repos = criarReposBench(d.banco);
  const relogio = d.relogio ?? Date.now;
  const cofre = criarCofreConsentimento(relogio);
  const executor = d.executor ?? criarExecutor({ registro: d.registroPids ?? criarRegistroPidsMemoria() });
  const raizExec = join(d.pastaBench, "exec");
  const plataforma = d.plataforma ?? process.platform;
  const ativos = new Map<string, { abort: AbortController; fim: Promise<void> }>();
  const ajudaCache = new Map<string, { texto: string; em: number }>();
  const progressoPendente = new Map<string, { ev: EventoBenchIpc; timer: ReturnType<typeof setTimeout> | null; ultimo: number }>();

  // ---- boot (primeiro uso): órfãos de um app que morreu e Runs que ficaram "executando" viram interrompidas; NADA retoma sozinho
  if (d.registroPids !== undefined) limparOrfaos(d.registroPids);
  repos.runs.interromperPendentes();
  repos.tarefas.semear(sementes());

  const emitir = (e: EventoBenchIpc): void => { try { d.emitir?.(e); } catch { /* o ouvinte nunca derruba a Run */ } };

  function contagem(runId: string): { total: number; concluidos: number; custo: number | null } {
    const rs = repos.resultados.daRun(runId);
    const conhecidos = rs.filter((r) => r.custo_usd !== null);
    return { total: rs.length, concluidos: rs.filter((r) => ENCERRADOS.has(r.estado)).length, custo: conhecidos.length === 0 ? null : conhecidos.reduce((s, r) => s + (r.custo_usd as number), 0) };
  }
  /** `bench:progresso` coalescido (≤ 4/s por Run): o primeiro sai na hora, o resto vira um envio final. */
  function emitirProgresso(runId: string, resultadoId: string | null, estado: LinhaResultado["estado"], forcar = false): void {
    const c = contagem(runId);
    const ev: EventoBenchIpc = { tipo: "progresso", run_id: runId, resultado_id: resultadoId, estado, concluidos: c.concluidos, total: c.total, custo_acumulado_usd: c.custo === null ? null : Math.round(c.custo * 1e6) / 1e6 };
    const p = progressoPendente.get(runId) ?? { ev, timer: null, ultimo: 0 };
    progressoPendente.set(runId, p);
    p.ev = ev;
    const agora = Date.now();
    if (forcar || agora - p.ultimo >= PROGRESSO_MIN_MS) { if (p.timer !== null) clearTimeout(p.timer); p.timer = null; p.ultimo = agora; emitir(ev); return; }
    if (p.timer === null) {
      p.timer = setTimeout(() => { p.timer = null; p.ultimo = Date.now(); emitir(p.ev); }, PROGRESSO_MIN_MS - (agora - p.ultimo));
      if (typeof p.timer === "object" && "unref" in p.timer) p.timer.unref();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------- alvos

  async function ajudaDaCli(a: AdaptadorHeadless, env: Record<string, string>): Promise<string> {
    const chave = a.cli;
    const c = ajudaCache.get(chave);
    if (c !== undefined && Date.now() - c.em < CACHE_AJUDA_MS) return c.texto;
    const texto = await (d.lerAjuda ?? ((exe, e) => lerAjudaDaCli(exe, e)))(a.executavel, env);
    ajudaCache.set(chave, { texto, em: Date.now() });
    return texto;
  }
  const ambienteBase = (home: string, configDir: string, a: AdaptadorHeadless): Record<string, string> =>
    montarAmbiente({ pai: (d.ambientePai ?? ((): Readonly<Record<string, string | undefined>> => process.env))(), home, configCli: { [a.variavelConfig]: configDir }, ...(d.scrub === undefined ? {} : { scrub: d.scrub }), ...(d.ambienteExtra === undefined ? {} : { extra: d.ambienteExtra }) });

  async function avaliarAlvo(a: AlvoBench): Promise<{ disponivel: boolean; motivo: string | null }> {
    const ad = adaptadorDaCli(a.cli);
    if (ad === null) return { disponivel: false, motivo: "CLI ainda sem adaptador do Bench (não suportada)" };
    if (!ad.esforcoValido(a.esforco)) return { disponivel: false, motivo: `esforço "${a.esforco ?? ""}" inválido para esta CLI` };
    if (a.conta_id === null) return { disponivel: false, motivo: "crie uma conta dedicada em Provedores e escolha-a neste alvo" };
    const conta = d.contas.resolver(a.conta_id);
    if (conta === null) return { disponivel: false, motivo: "conta dedicada não encontrada" };
    const sbx = d.sandboxPara(a.cli);
    if (sbx.modo === "indisponivel" || !(await sbx.disponivel())) return { disponivel: false, motivo: "sandbox indisponível neste sistema: o Bench se recusa a rodar sem isolamento" };
    const ajuda = await ajudaDaCli(ad, ambienteBase(conta.home, conta.configDir, ad));
    if (ajuda.trim() === "") return { disponivel: false, motivo: `não consegui ler o --help de ${ad.executavel} (CLI instalada?)` };
    const v = verificarFlags(ad, ajuda);
    return v.ok ? { disponivel: true, motivo: null } : { disponivel: false, motivo: v.motivo };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------- estimativa / consentimento

  function assinaturaCorrente(tarefas: readonly TarefaBench[], alvos: readonly AlvoBench[], p: { teto_usd: number | null; max_paralelo: number; juiz_alvo: string | null }): string {
    return assinaturaDe({ tarefas: tarefas.map((t) => `${t.slug}@${t.versao}`), alvos: alvos.map((a) => `${a.slug}|${a.conta_id ?? ""}|${a.esforco ?? ""}|${a.modelo}|${a.cli}`), pesos: PESOS_PADRAO, teto_usd: p.teto_usd, max_paralelo: p.max_paralelo, juiz_alvo: p.juiz_alvo });
  }
  const modoAgregado = (modos: ReadonlyArray<ModoSandbox | "indisponivel">): ModoSandbox | "indisponivel" =>
    modos.includes("indisponivel") ? "indisponivel" : modos.includes("nenhum") ? "nenhum" : modos.includes("macos") ? "macos" : "nativo_cli";

  async function estimar(p: { tarefas: string[]; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null }): Promise<Estimativa> {
    const avisos: string[] = [];
    const tarefas = p.tarefas.map((s) => repos.tarefas.obter(s)).filter((t): t is TarefaBench => t !== undefined);
    const alvos = p.alvos.map((s) => repos.alvos.obter(s)).filter((a): a is AlvoBench => a !== undefined);
    let bloqueada = false;
    if (tarefas.length !== p.tarefas.length) { avisos.push("Há tarefa inexistente na seleção."); bloqueada = true; }
    if (alvos.length !== p.alvos.length) { avisos.push("Há alvo inexistente na seleção."); bloqueada = true; }
    if (tarefas.length === 0 || alvos.length === 0) { avisos.push("Escolha ao menos uma tarefa e um alvo."); bloqueada = true; }
    for (const t of tarefas) if (t.estado !== "ativa") { avisos.push(`A tarefa "${t.slug}" não está ativa (${t.estado}).`); bloqueada = true; }
    const modos: Array<ModoSandbox | "indisponivel"> = [];
    for (const a of alvos) {
      const av = await avaliarAlvo(a);
      if (!av.disponivel) { avisos.push(`Alvo "${a.slug}" indisponível: ${av.motivo ?? ""}`); bloqueada = true; }
      const sb = d.sandboxPara(a.cli);
      modos.push(sb.modo === "indisponivel" ? "indisponivel" : (sb.modo === "nenhum" && plataforma !== "win32" ? "indisponivel" : sb.modo));
    }
    const sandbox = modos.length === 0 ? "indisponivel" : modoAgregado(modos);
    if (sandbox === "indisponivel") { avisos.push("Sandbox indisponível: não posso rodar. O Bench recusa executar código gerado por IA sem isolamento."); bloqueada = true; }
    if (sandbox === "nenhum") avisos.push("Sem sandbox neste sistema: o código gerado roda sem isolamento do sistema de arquivos. Só prossiga com a frase reforçada.");
    if (sandbox === "nativo_cli" || modos.includes("nativo_cli")) avisos.push("Alvos Codex usam o sandbox da própria CLI (modo workspace-write), não o do Bench.");
    avisos.push("Isto executa código gerado por IA sem pedir confirmação. A rede continua aberta, pois a CLI precisa falar com o provedor; nada sensível fica acessível (credenciais negadas, ambiente limpo, conta dedicada).");
    if (p.juiz_alvo !== null) {
      const j = repos.alvos.obter(p.juiz_alvo);
      if (j === undefined) { avisos.push("Juiz inexistente."); bloqueada = true; }
      else if (juizIgualAExecutor(j, alvos)) { avisos.push("O juiz não pode ser um dos alvos que executam as tarefas (provedor e modelo iguais)."); bloqueada = true; }
      else avisos.push(`Julgar envia os arquivos entregues (sem nome de modelo, CLI nem caminho) ao provedor do juiz (${j.provedor}/${j.modelo}), que pode ser outro além dos executores.`);
    }
    const maxPar = limitarParalelo(p.max_paralelo);
    if (maxPar !== p.max_paralelo) avisos.push(`Paralelo ajustado para ${maxPar} (1 a 5).`);
    const execucoes = tarefas.length * alvos.length;
    if (execucoes > MAX_EXECUCOES_POR_RUN) { avisos.push(`Esta Run teria ${execucoes} execuções; o teto é ${MAX_EXECUCOES_POR_RUN} por Run. Divida em Runs menores.`); bloqueada = true; }

    // custo e duração: mediana do histórico por (alvo, tarefa); sem histórico = desconhecido (NUNCA zero)
    let min = 0, max = 0, conhecidos = 0, durTotal = 0, durConhecidas = 0;
    const alvosSemCusto = new Set<string>();
    for (const a of alvos) for (const t of tarefas) {
      const h = repos.resultados.historico({ alvo: a.slug, tarefa: t.slug, estados: ["concluido", "falhou", "tempo_esgotado"], limite: 50 });
      const custos = h.map((r) => r.custo_usd).filter((x): x is number => x !== null);
      if (custos.length === 0) alvosSemCusto.add(a.slug);
      else { min += Math.min(...custos); max += Math.max(...custos); conhecidos++; }
      const med = mediana(h.map((r) => r.duracao_s).filter((x): x is number => x !== null));
      if (med !== null) { durTotal += med; durConhecidas++; }
    }
    if (alvosSemCusto.size > 0) avisos.push(`Custo desconhecido para ${alvosSemCusto.size} alvo(s): sem histórico nem preço cadastrado. Informe preços para ver custo.`);
    if (execucoes > MAX_EXECUCOES_SEM_CUSTO && alvosSemCusto.size > 0) avisos.push(`Com custo desconhecido vale o teto de ${MAX_EXECUCOES_SEM_CUSTO} execuções por Run; o resto fica na fila.`);
    if (p.teto_usd === null && alvosSemCusto.size > 0) avisos.push("Sem teto de custo definido.");
    const frase = bloqueada || sandbox === "indisponivel" ? null : sandbox === "nenhum" ? FRASE_CONSENTIMENTO_SEM_SANDBOX : FRASE_CONSENTIMENTO;
    const est: Estimativa = {
      estimativa_id: `est_${relogio().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      execucoes, tarefas: tarefas.map((t) => t.slug), alvos: alvos.map((a) => a.slug),
      custo_min_usd: conhecidos === 0 ? null : Math.round(min * 1e6) / 1e6, custo_max_usd: conhecidos === 0 ? null : Math.round(max * 1e6) / 1e6, alvos_sem_custo: alvosSemCusto.size,
      duracao_estimada_s: durConhecidas === 0 ? null : Math.round(durTotal / maxPar), sandbox, frase_exigida: frase, teto_usd: p.teto_usd, avisos: limiteMais(avisos, 20),
    };
    cofre.guardarEstimativa({ estimativa: est, assinatura: assinaturaCorrente(tarefas, alvos, { teto_usd: p.teto_usd, max_paralelo: maxPar, juiz_alvo: p.juiz_alvo }), pesos: PESOS_PADRAO, max_paralelo: maxPar, juiz_alvo: p.juiz_alvo, criada_em: relogio() });
    return est;
  }

  /** valida token (uso único), reconfere o estado ATUAL (versões, alvos, sandbox) e devolve o que a Run precisa. */
  async function validarParaRodar(token: string, estimativaId: string | null, finalidade: FinalidadeToken, tarefasSlugs: string[], alvosSlugs: string[], opcoes: { teto_usd: number | null; max_paralelo: number; juiz_alvo: string | null } | null): Promise<{ g: EstimativaGuardada; tarefas: TarefaBench[]; alvos: AlvoBench[] } | { erro: ErroRodar }> {
    const tarefas = tarefasSlugs.map((s) => repos.tarefas.obter(s));
    const alvos = alvosSlugs.map((s) => repos.alvos.obter(s));
    let assinatura: string | null = null;
    if (opcoes !== null && tarefas.every((t) => t !== undefined) && alvos.every((a) => a !== undefined)) assinatura = assinaturaCorrente(tarefas as TarefaBench[], alvos as AlvoBench[], opcoes);
    const g = cofre.consumir(token, estimativaId, opcoes === null ? null : (assinatura ?? "assinatura-invalida"), finalidade);
    if (g === null) return { erro: "consentimento_invalido" };
    if (tarefas.some((t) => t === undefined || t.estado !== "ativa")) return { erro: "tarefa_inativa" };
    if (alvos.some((a) => a === undefined)) return { erro: "alvo_indisponivel" };
    const modos: Array<ModoSandbox | "indisponivel"> = [];
    for (const a of alvos as AlvoBench[]) {
      const sb = d.sandboxPara(a.cli);
      modos.push(sb.modo === "indisponivel" || !(await sb.disponivel()) ? "indisponivel" : sb.modo === "nenhum" && plataforma !== "win32" ? "indisponivel" : sb.modo);
    }
    const modo = modoAgregado(modos);
    if (modo === "indisponivel") return { erro: "sandbox_indisponivel" };
    for (const a of alvos as AlvoBench[]) if (!(await avaliarAlvo(a)).disponivel) return { erro: "alvo_indisponivel" };
    return { g, tarefas: tarefas as TarefaBench[], alvos: alvos as AlvoBench[] };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------- execução

  const dirLog = (runId: string): string => join(raizExec, runId, "_logs");

  /** o fd do log fica numa pasta DEDICADA do par, reaberta para leitura: o sandbox checa o caminho do fd e o Node aborta ao iniciar se o log estiver numa pasta negada. */
  function politicaSandbox(workdir: string, conta: ContaDedicada, pastaLog: string, somenteLeitura = false) {
    return {
      workdir,
      escrita: [conta.home, conta.configDir],
      leitura_negada: [...negadosPadrao(d.homeReal), d.pastaDados],
      leitura_liberada: [conta.home, conta.configDir, pastaLog],
      ...(somenteLeitura ? { somente_leitura: true } : {}),
    };
  }

  async function rodarProcesso(a: AlvoBench, ad: AdaptadorHeadless, conta: ContaDedicada, cmd: ComandoAdaptador, workdir: string, logAbs: string, sinal: AbortSignal, timeoutMs: number, rotulo: string, somenteLeitura = false) {
    const sbx = d.sandboxPara(a.cli);
    const final = d.prepararComando === undefined ? { executavel: cmd.executavel, args: cmd.args } : d.prepararComando(cmd, a.cli);
    const env = ambienteBase(conta.home, conta.configDir, ad);
    const envolvido = sbx.envolver(final.executavel, final.args, politicaSandbox(workdir, conta, dirname(logAbs), somenteLeitura));
    try {
      return await executor.executar({ executavel: envolvido.executavel, args: envolvido.args, cwd: workdir, env, stdin: cmd.stdin, logAbs, timeoutMs, rotulo }, sinal);
    } finally { envolvido.limpar(); }
  }

  function lerCauda(arquivo: string, max = 256 * 1024): string {
    try {
      const tam = statSync(arquivo).size;
      const fd = openSync(arquivo, "r");
      try {
        const n = Math.min(tam, max);
        const buf = Buffer.alloc(n);
        readSync(fd, buf, 0, n, tam - n);
        return buf.toString("utf8");
      } finally { closeSync(fd); }
    } catch { return ""; }
  }

  async function executarPar(runId: string, resId: string, sinal: AbortSignal): Promise<void> {
    const r0 = repos.resultados.obter(resId) as LinhaResultado;
    const run = repos.runs.obter(runId) as LinhaRun;
    const alvo = repos.alvos.obter(r0.alvo_slug);
    const tarefa = repos.tarefas.obter(r0.tarefa_slug);
    const ad = alvo === undefined ? null : adaptadorDaCli(alvo.cli);
    const conta = alvo?.conta_id == null ? null : d.contas.resolver(alvo.conta_id);
    if (alvo === undefined || tarefa === undefined || ad === null || conta === null) {
      repos.resultados.atualizar(resId, { estado: "falhou", aviso: "alvo, tarefa ou conta dedicada indisponível", custo_fonte: "desconhecido", custo_usd: null });
      emitirProgresso(runId, resId, "falhou", true);
      return;
    }
    repos.resultados.atualizar(resId, { estado: "executando" });
    emitirProgresso(runId, resId, "executando");
    const sbx = d.sandboxPara(alvo.cli);
    const t0 = Date.now();
    try {
      const wd = criarWorkdir({ raizExec, run: runId, tarefa: tarefa.slug, alvo: alvo.slug, fixtures: fixturesDaTarefa(tarefa.slug) });
      mkdirSync(conta.home, { recursive: true, mode: 0o700 });
      const pastaLogRel = `${runId}/_logs/${tarefa.slug}__${alvo.slug}__t${r0.tentativa}`;
      mkdirSync(join(raizExec, pastaLogRel), { recursive: true, mode: 0o700 });
      const logRel = `${pastaLogRel}/exec.log`;
      const logAbs = join(raizExec, logRel);
      const prompt = r0.prompt_efetivo !== "" ? r0.prompt_efetivo : promptEfetivo(tarefa);
      repos.resultados.atualizar(resId, { workdir: wd.rel, log_ref: logRel, prompt_efetivo: prompt, isolamento: ad.capacidades.harness_zero === "garantido" && sbx.modo !== "nenhum" ? "garantido" : "parcial" });
      const cmd = ad.montar({ modelo: alvo.modelo, esforco: alvo.esforco, workdir: wd.abs, prompt });
      const r = await rodarProcesso(alvo, ad, conta, cmd, wd.abs, logAbs, sinal, d.timeoutPadraoMs ?? 1_800_000, `${runId}/${tarefa.slug}/${alvo.slug}`);
      const artefatos = semFixturesIntactas(listarArtefatos(wd.abs), fixturesDaTarefa(tarefa.slug));
      const uso = ad.interpretarUso(lerCauda(logAbs));
      const medido: UsoMedido = { tokens_in: uso.tokens_in, tokens_out: uso.tokens_out, tokens_cache: uso.tokens_cache, custo_relatado_usd: uso.custo_relatado_usd };
      const preco = tabelaPreco(alvo);
      const custo = calcularCusto(medido, preco, { assinatura: conta.assinatura === true });
      let checagens: LinhaResultado["checagens"] = [];
      if (r.estado !== "cancelado") {
        checagens = await executarChecagens(tarefa.checagens, {
          workdir: wd.abs,
          rodarComando: async (argv) => {
            const exe = argv[0] as string;
            const c2: ComandoAdaptador = { executavel: exe, args: argv.slice(1), stdin: null };
            // as checagens rodam código gerado pela IA: SEMPRE sob o sandbox externo (nunca o passthrough do Codex)
            const envolver = (d.sandboxChecagens ?? d.sandboxPara("claude")).envolver(exe, c2.args, politicaSandbox(wd.abs, conta, join(raizExec, pastaLogRel)));
            try {
              const x = await executor.executar({ executavel: envolver.executavel, args: envolver.args, cwd: wd.abs, env: ambienteBase(conta.home, conta.configDir, ad), stdin: null, logAbs: join(raizExec, pastaLogRel, "chk.log"), timeoutMs: d.timeoutChecagemMs ?? 60_000, rotulo: `${runId}/chk` }, sinal);
              return x.estado === "concluido" ? 0 : x.codigo;
            } finally { envolver.limpar(); }
          },
        });
      }
      const tokensTotal = uso.tokens_in === null && uso.tokens_out === null ? null : (uso.tokens_in ?? 0) + (uso.tokens_out ?? 0) + (uso.tokens_cache ?? 0);
      const estadoFinal = r.estado === "cancelado" ? "cancelado" : r.estado;
      const semArtefato = (estadoFinal === "falhou" || estadoFinal === "tempo_esgotado") && artefatos.length === 0;
      repos.resultados.atualizar(resId, {
        estado: estadoFinal, duracao_s: r.duracao_s, custo_usd: custo.custo_usd, custo_fonte: custo.custo_fonte, custo_tipo: custo.custo_tipo, preco: custo.preco,
        tokens_in: uso.tokens_in, tokens_out: uso.tokens_out, tokens_total: tokensTotal, turnos: uso.turnos, revisoes: null,
        artefatos, checagens, aviso: r.truncado ? "saída truncada (acima do teto)" : r.erro !== null && estadoFinal === "falhou" ? limpar(r.erro, d.scrub).slice(0, 200) : null,
        ...(semArtefato ? { juiz_estado: "feito" as const, qualidade: 0, notas: "falha sem artefato: nota 0 automática" } : {}),
      });
      emitirProgresso(runId, resId, estadoFinal);
    } catch (e) {
      const msg = e instanceof ErroBench ? e.message : "falha ao executar o par";
      repos.resultados.atualizar(resId, { estado: "falhou", duracao_s: (Date.now() - t0) / 1000, aviso: limpar(msg, d.scrub).slice(0, 200), custo_fonte: "desconhecido", custo_usd: null, juiz_estado: "feito", qualidade: 0, notas: "falha na execução: nota 0 automática" });
      emitirProgresso(runId, resId, "falhou", true);
    }
  }

  function tabelaPreco(a: AlvoBench): PrecoCongelado | null {
    const ts = new Date(relogio()).toISOString();
    const p = precoVigente(repos.precos.listar(), a.provedor, a.modelo, ts);
    if (p !== null) return congelar(p);
    return d.precos?.preco(a.modelo, ts) ?? null;
  }

  function recalcularEstadoRun(runId: string): EstadoRun {
    const run = repos.runs.obter(runId) as LinhaRun;
    if (run.estado === "cancelada" || run.estado === "interrompida") return run.estado;
    const rs = repos.resultados.daRun(runId);
    if (rs.some((r) => r.estado === "executando")) return "executando";
    const pendentesFila = rs.filter((r) => r.estado === "enfileirado").length;
    const aJulgar = rs.filter((r) => r.estado === "concluido" && (r.juiz_estado === "pendente" || r.juiz_estado === "erro")).length;
    const estado: EstadoRun = aJulgar > 0 ? "julgando" : pendentesFila > 0 ? "parcial" : "concluida";
    repos.runs.atualizar(runId, { estado, ...(estado === "concluida" || estado === "parcial" ? { terminada_em: new Date().toISOString() } : {}) });
    return estado;
  }

  function iniciarEscalonamento(runId: string, resultadosIds: string[]): void {
    const ac = new AbortController();
    const run = repos.runs.obter(runId) as LinhaRun;
    repos.runs.atualizar(runId, { estado: "executando", iniciada_em: run.iniciada_em ?? new Date().toISOString(), terminada_em: null });
    const pares = resultadosIds.map((id) => ({ id, conta_id: repos.alvos.obter((repos.resultados.obter(id) as LinhaResultado).alvo_slug)?.conta_id ?? null }));
    const fim = escalonar(pares, {
      maxParalelo: run.max_paralelo, tetoUsd: run.teto_usd, sinal: ac.signal,
      custo: () => { const rs = repos.resultados.daRun(runId); return { conhecido_usd: rs.reduce((s, r) => s + (r.custo_usd ?? 0), 0), algum_desconhecido: rs.some((r) => FINAIS.has(r.estado) && r.custo_usd === null) }; },
      ...(d.limites === undefined ? {} : { estadoConta: (c: string) => d.limites?.estadoConta(c) ?? "desconhecido" }),
      executar: (par) => executarPar(runId, par.id, ac.signal),
      aoPular: (par, motivo: MotivoPulo) => {
        if (motivo === "cancelado") { repos.resultados.atualizar(par.id, { estado: "cancelado" }); emitirProgresso(runId, par.id, "cancelado"); return; }
        const aviso = motivo === "sem_limite" ? "conta sem limite: o par ficou na fila e a conta NÃO foi trocada" : motivo === "teto_usd" ? "teto de custo da Run atingido: par não lançado" : `teto de ${MAX_EXECUCOES_SEM_CUSTO} execuções com custo desconhecido atingido: par não lançado`;
        repos.resultados.atualizar(par.id, { aviso });
      },
    }).then(() => {
      const estado = ac.signal.aborted ? "cancelada" : recalcularEstadoRun(runId);
      if (ac.signal.aborted) repos.runs.atualizar(runId, { estado: "cancelada", terminada_em: new Date().toISOString() });
      emitirProgresso(runId, null, "concluido", true);
      emitir({ tipo: "run_terminou", run_id: runId, estado });
    }).catch(() => {
      repos.runs.atualizar(runId, { estado: "interrompida", terminada_em: new Date().toISOString() });
      emitir({ tipo: "run_terminou", run_id: runId, estado: "interrompida" });
    }).finally(() => { ativos.delete(runId); const p = progressoPendente.get(runId); if (p?.timer != null) clearTimeout(p.timer); progressoPendente.delete(runId); });
    ativos.set(runId, { abort: ac, fim });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------- consultas

  function resumoResultado(r: LinhaResultado): ResumoResultado {
    return { id: r.id, tarefa: r.tarefa_slug, tarefa_versao: r.tarefa_versao, alvo: r.alvo_slug, tentativa: r.tentativa, estado: r.estado, duracao_s: r.duracao_s, custo_usd: r.custo_usd, custo_fonte: r.custo_fonte, tokens_out: r.tokens_out, qualidade: r.qualidade, juiz_estado: r.juiz_estado, aviso: r.aviso };
  }
  function resumoRun(l: LinhaRun): ResumoRun {
    const c = contagem(l.id);
    return { id: l.id, nome: l.nome, estado: l.estado, iniciada_em: l.iniciada_em, terminada_em: l.terminada_em, total: c.total, concluidos: c.concluidos, custo_usd: c.custo === null ? null : Math.round(c.custo * 1e6) / 1e6 };
  }
  const exigirResultado = (id: string): LinhaResultado => { const r = repos.resultados.obter(id); if (r === undefined) throw new ErroBench("nao_encontrado", "resultado inexistente"); return r; };
  const tarefasMeta = (): Map<string, TarefaBench> => new Map(repos.tarefas.listar().map((t) => [t.slug, t]));

  // ---------------------------------------------------------------------------------------------------------------------------------------------- julgamento

  async function chamarJuizPadrao(alvo: AlvoBench, prompt: string, runId: string): Promise<{ texto: string; custo_usd: number | null }> {
    const ad = adaptadorDaCli(alvo.cli);
    const conta = alvo.conta_id === null ? null : d.contas.resolver(alvo.conta_id);
    if (ad === null || conta === null) throw new ErroBench("juiz_indisponivel", "juiz sem adaptador ou conta dedicada");
    const wd = criarWorkdir({ raizExec, run: runId, tarefa: "_juiz", alvo: `${alvo.slug}-${Date.now().toString(36)}`, fixtures: {} });
    const pastaJuiz = join(dirLog(runId), `juiz-${alvo.slug}-${Date.now().toString(36)}`);
    mkdirSync(pastaJuiz, { recursive: true, mode: 0o700 });
    const logAbs = join(pastaJuiz, "exec.log");
    const cmd = ad.montar({ modelo: alvo.modelo, esforco: alvo.esforco, workdir: wd.abs, prompt, somente_leitura: true });
    const ac = new AbortController();
    const r = await rodarProcesso(alvo, ad, conta, cmd, wd.abs, logAbs, ac.signal, 600_000, `${runId}/juiz`, true);
    const saida = lerCauda(logAbs, 1024 * 1024);
    if (r.estado !== "concluido") throw new ErroBench("juiz_falhou", "a CLI do juiz não concluiu");
    const uso = ad.interpretarUso(saida);
    const custo = calcularCusto({ tokens_in: uso.tokens_in, tokens_out: uso.tokens_out, tokens_cache: uso.tokens_cache, custo_relatado_usd: uso.custo_relatado_usd }, tabelaPreco(alvo), { assinatura: conta.assinatura === true });
    return { texto: ad.extrairTexto(saida), custo_usd: custo.custo_usd };
  }

  function entregaDe(r: LinhaResultado, alvo: AlvoBench): EntregaParaPacote {
    const wd = r.workdir === null ? null : join(raizExec, ...r.workdir.split("/"));
    const artefatos = r.artefatos.slice(0, 12).map((a) => {
      let conteudo: Buffer | null = null;
      try {
        if (wd !== null && a.bytes <= 5 * 1024 * 1024) {
          const bruto = readFileSync(resolverArtefato(wd, a.nome));
          // o juiz (e o provedor dele) nunca recebe segredo que o código gerado tenha copiado (achado B-04)
          const t = tipoDoArquivo(a.nome);
          conteudo = t.startsWith("text/") || t === "application/json" ? Buffer.from(redigirSegredos(bruto.toString("utf8"), d.scrub), "utf8") : bruto;
        }
      } catch { conteudo = null; }
      return { nome: a.nome, conteudo };
    });
    const checagens = r.checagens.length === 0 ? "nenhuma checagem automática" : r.checagens.map((c) => `${c.tipo} ${c.alvo}: ${c.ok ? "ok" : "falhou"}${c.critica ? " (crítica)" : ""}`).join("; ");
    return { alvo: alvo.slug, termos: [alvo.provedor, alvo.modelo, alvo.cli, alvo.rotulo, alvo.conta_id ?? ""], artefatos, checagens };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------- API

  return {
    repos,
    tarefasListar: (atividade, estado) => repos.tarefas.listar({ atividade, estado }),
    tarefaSalvar(t) {
      const erro = validarTarefa(t);
      if (erro !== null) return { erro };
      const existente = repos.tarefas.obter(t.slug);
      if (existente?.embutida === true && existente.tem_fixture && t.checagens.length === 0) return { erro: "checagem_invalida" };
      return repos.tarefas.salvar(t);
    },
    async alvosListar() {
      const out: AlvoDisponivel[] = [];
      for (const a of repos.alvos.listar()) out.push({ ...a, ...(await avaliarAlvo(a)) });
      return out;
    },
    alvosSalvar(lista) {
      for (const a of lista) {
        if (!/^[a-z0-9][a-z0-9._-]{0,40}$/i.test(a.provedor) || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,80}$/.test(a.modelo) || !["claude", "codex"].includes(a.cli)) throw new ErroBench("alvo_invalido", "alvo inválido");
        const ad = adaptadorDaCli(a.cli);
        if (ad !== null && !ad.esforcoValido(a.esforco)) throw new ErroBench("esforco_invalido", "esforço inválido para a CLI");
      }
      return repos.alvos.substituir(lista);
    },
    precosLer: () => repos.precos.listar(),
    precosGravar(lista) {
      if (!lista.every(validarPreco)) throw new ErroBench("preco_invalido", "preço inválido");
      return repos.precos.substituir(lista);
    },
    estimar,
    consentir: (id, frase, finalidade) => cofre.consentir(id, frase, finalidade),
    descartarConsentimento: (id) => cofre.descartar(id),

    async rodar(estimativaId, token) {
      const g0 = cofre.estimativa(estimativaId);
      if (g0 === null) { cofre.consumir(token, estimativaId, null, "rodar"); return { erro: "consentimento_invalido" }; }
      const e = g0.estimativa;
      const v = await validarParaRodar(token, estimativaId, "rodar", e.tarefas, e.alvos, { teto_usd: e.teto_usd, max_paralelo: g0.max_paralelo, juiz_alvo: g0.juiz_alvo });
      if ("erro" in v) return v;
      const modos = v.alvos.map((a) => d.sandboxPara(a.cli).modo);
      const sandbox = modoAgregado(modos);
      const run = repos.runs.criar({ nome: `Bench ${new Date(relogio()).toISOString().slice(0, 16).replace("T", " ")}`, tarefas: v.tarefas.map((t) => ({ slug: t.slug, versao: t.versao })), alvos: v.alvos.map((a) => a.slug), max_paralelo: g0.max_paralelo, teto_usd: e.teto_usd, juiz_alvo: g0.juiz_alvo, pesos: g0.pesos, sandbox: sandbox === "indisponivel" ? "nenhum" : sandbox });
      const ids: string[] = [];
      for (const t of v.tarefas) for (const a of v.alvos) ids.push(repos.resultados.criar({ run_id: run.id, tarefa_slug: t.slug, tarefa_versao: t.versao, alvo_slug: a.slug, prompt_efetivo: promptEfetivo(t) }).id);
      iniciarEscalonamento(run.id, ids);
      return { run_id: run.id };
    },

    async cancelar(runId) {
      const run = repos.runs.obter(runId);
      if (run === undefined) return false;
      const a = ativos.get(runId);
      if (a === undefined) {
        // Run sem processo vivo (ex.: `julgando`/`parcial`): só marca
        if (run.estado === "cancelada" || run.estado === "concluida") return false;
        repos.runs.atualizar(runId, { estado: "cancelada", terminada_em: new Date().toISOString() });
        for (const r of repos.resultados.daRun(runId)) if (r.estado === "enfileirado") repos.resultados.atualizar(r.id, { estado: "cancelado" });
        return true;
      }
      a.abort.abort();
      await a.fim;
      return true;
    },

    async rerodar(runId, tarefaSlug, alvoSlug, token) {
      const run = repos.runs.obter(runId);
      const atual = repos.resultados.daRun(runId).find((r) => r.tarefa_slug === tarefaSlug && r.alvo_slug === alvoSlug);
      if (run === undefined || atual === undefined) { cofre.consumir(token, null, null, "rerodar"); throw new ErroBench("nao_encontrado", "resultado inexistente"); }
      const g = await validarParaRodar(token, null, "rerodar", [tarefaSlug], [alvoSlug], null);
      if ("erro" in g) return g;
      const e = g.g.estimativa;
      if (e.tarefas.length !== 1 || e.alvos.length !== 1 || e.tarefas[0] !== tarefaSlug || e.alvos[0] !== alvoSlug) return { erro: "consentimento_invalido" };
      if (!ENCERRADOS.has(atual.estado) || atual.estado === "substituido") throw new ErroBench("em_andamento", "o resultado ainda não terminou");
      if (ativos.has(runId)) throw new ErroBench("run_ativa", "a Run ainda está em andamento");
      const novo = repos.resultados.substituir(atual.id, promptEfetivo(g.tarefas[0] as TarefaBench));
      iniciarEscalonamento(runId, [novo.id]);
      return { resultado_id: novo.id };
    },

    async julgar(runId, tarefaSlug, juizSlug, token) {
      const g = cofre.consumir(token, null, null, "julgar");
      if (g === null || g.juiz_alvo !== juizSlug) return { erro: "consentimento_invalido" };
      const run = repos.runs.obter(runId);
      const juiz = repos.alvos.obter(juizSlug);
      if (run === undefined || juiz === undefined) return { erro: "sem_resultados" };
      const todos = repos.resultados.daRun(runId).filter((r) => (tarefaSlug === null || r.tarefa_slug === tarefaSlug) && r.estado !== "enfileirado" && r.estado !== "executando" && r.estado !== "cancelado" && r.estado !== "interrompido");
      const alvosDosResultados = todos.map((r) => repos.alvos.obter(r.alvo_slug)).filter((a): a is AlvoBench => a !== undefined);
      if (todos.length === 0) return { erro: "sem_resultados" };
      if (juizIgualAExecutor(juiz, alvosDosResultados)) return { erro: "juiz_igual_a_executor" };
      const chamar = d.chamarJuiz ?? chamarJuizPadrao;
      const ids: string[] = [];
      const porTarefa = new Map<string, LinhaResultado[]>();
      for (const r of todos) porTarefa.set(r.tarefa_slug, [...(porTarefa.get(r.tarefa_slug) ?? []), r]);
      repos.runs.atualizar(runId, { estado: "julgando" });
      for (const [slug, rs] of porTarefa) {
        const tarefa = repos.tarefas.obter(slug) as TarefaBench;
        const comEntrega = rs.filter((r) => r.artefatos.length > 0 || r.estado === "concluido");
        if (comEntrega.length === 0) continue;
        let custoJuiz: number | null = null;
        const r = await julgarCego({
          pedido: promptEfetivo(tarefa),
          entregas: comEntrega.map((x) => entregaDe(x, repos.alvos.obter(x.alvo_slug) as AlvoBench)),
          chamar: async (prompt) => { const o = await chamar(juiz, prompt, runId); custoJuiz = o.custo_usd; return o.texto; },
        });
        if (!r.ok) {
          for (const x of comEntrega) if (x.juiz_estado !== "manual") repos.resultados.atualizar(x.id, { juiz_estado: "erro", qualidade: null, notas: "o juiz não devolveu um veredito válido: rejulgue ou dê nota manual" });
          continue;
        }
        const notas: Record<string, NotaJuiz> = r.veredito.notas;
        for (const x of comEntrega) {
          if (x.juiz_estado === "manual") continue;
          const n = notas[x.alvo_slug];
          if (n !== undefined) repos.resultados.atualizar(x.id, { juiz_estado: "feito", qualidade: n.nota, qualidade_detalhe: n.detalhe, notas: null });
        }
        const v = repos.vereditos.criar({ run_id: runId, tarefa_slug: slug, tarefa_versao: comEntrega[0]?.tarefa_versao ?? tarefa.versao, juiz_modelo: `${juiz.provedor}/${juiz.modelo}`, mapa_cego: r.veredito.mapa, notas: Object.fromEntries(Object.entries(notas).map(([k, n]) => [k, { nota: n.nota, detalhe: n.detalhe }])), ranking: r.veredito.ranking, custo_juiz_usd: custoJuiz });
        ids.push(v.id);
      }
      recalcularEstadoRun(runId);
      emitir({ tipo: "run_terminou", run_id: runId, estado: (repos.runs.obter(runId) as LinhaRun).estado });
      return { veredito_ids: ids };
    },

    notaManual(resultadoId, nota, notas) {
      const r = repos.resultados.obter(resultadoId);
      if (r === undefined || !Number.isFinite(nota) || nota < 0 || nota > 10 || !ENCERRADOS.has(r.estado) || r.estado === "substituido") return false;
      repos.resultados.atualizar(resultadoId, { juiz_estado: "manual", qualidade: Math.round(nota * 10) / 10, notas: notas === null ? null : limpar(notas, d.scrub).slice(0, 500) });
      if (!ativos.has(r.run_id)) recalcularEstadoRun(r.run_id);
      return true;
    },

    runsListar(depois) {
      const p = repos.runs.listar(depois);
      return { itens: p.itens.map(resumoRun), proximo: p.proximo };
    },
    estadoRun(runId) {
      const run = repos.runs.obter(runId);
      if (run === undefined) throw new ErroBench("nao_encontrado", "Run inexistente");
      return { run: { ...resumoRun(run), tarefas: run.tarefas, alvos: run.alvos, max_paralelo: run.max_paralelo, teto_usd: run.teto_usd, juiz_alvo: run.juiz_alvo, pesos: run.pesos, sandbox: run.sandbox }, resultados: repos.resultados.daRun(runId).map(resumoResultado) };
    },
    resultado(id) {
      const r = exigirResultado(id);
      let logBytes = 0;
      try { if (r.log_ref !== null) logBytes = statSync(join(raizExec, ...r.log_ref.split("/"))).size; } catch { logBytes = 0; }
      return { ...resumoResultado(r), run_id: r.run_id, prompt_efetivo: r.prompt_efetivo, tokens_in: r.tokens_in, tokens_total: r.tokens_total, turnos: r.turnos, custo_tipo: r.custo_tipo, checagens: r.checagens, artefatos: r.artefatos.map((a) => ({ nome: a.nome, tipo: a.tipo, bytes: a.bytes })), isolamento: r.isolamento, qualidade_detalhe: r.qualidade_detalhe, notas: r.notas, log_bytes: logBytes };
    },
    logLer(id, depois, max) {
      const r = exigirResultado(id);
      if (r.log_ref === null) return { texto: "", proximo: 0 };
      if (!Number.isInteger(depois) || depois < 0) throw new ErroBench("intervalo_invalido", "posição inválida");
      const tam = Math.max(1, Math.min(MAX_LOG_PAGINA, Math.trunc(max)));
      const abs = join(raizExec, ...r.log_ref.split("/"));
      if (!existsSync(abs)) return { texto: "", proximo: depois };
      garantirDentro(raizExec, abs);
      const total = statSync(abs).size;
      if (depois >= total) return { texto: "", proximo: total };
      const n = Math.min(tam, total - depois);
      const buf = Buffer.alloc(n);
      const fd = openSync(abs, "r");
      try { readSync(fd, buf, 0, n, depois); } finally { closeSync(fd); }
      // não corta no meio de um caractere UTF-8 (a próxima página recomeça nele), exceto no fim do arquivo
      let fim = n;
      if (depois + n < total) { let i = n - 1, k = 0; while (i >= 0 && k < 3 && ((buf[i] as number) & 0xc0) === 0x80) { i--; k++; } if (i >= 0 && (buf[i] as number) >= 0xc0) fim = i; }
      return { texto: limpar(buf.subarray(0, fim).toString("utf8"), d.scrub), proximo: depois + fim };
    },
    artefatoLer(id, nome) {
      const r = exigirResultado(id);
      if (r.workdir === null || !caminhoRelativoSeguro(nome) || !r.artefatos.some((a) => a.nome === nome)) throw new ErroBench("artefato_invalido", "artefato inexistente");
      const wd = join(raizExec, ...r.workdir.split("/"));
      const abs = resolverArtefato(wd, nome);
      if (statSync(abs).size > 5 * 1024 * 1024) throw new ErroBench("artefato_grande", "artefato grande demais para pré-visualizar");
      const tipo = tipoDoArquivo(nome);
      const bruto = readFileSync(abs);
      // o código gerado pode ter lido a credencial da conta dedicada (a CLI precisa dela) e gravado no artefato: texto sai com segredo e caminho absoluto REDIGIDOS (achado B-04)
      const bytes = tipo.startsWith("text/") || tipo === "application/json" ? new Uint8Array(Buffer.from(limpar(bruto.toString("utf8"), d.scrub), "utf8")) : new Uint8Array(bruto);
      return { bytes, tipo };
    },

    comparar(alvos, tarefas, agrupar) {
      const hist = alvos.flatMap((a) => repos.resultados.historico({ alvo: a, estados: ["concluido", "falhou", "tempo_esgotado"] }));
      hist.sort((x, y) => (x.criado_em < y.criado_em ? 1 : x.criado_em > y.criado_em ? -1 : 0));
      const c = compararHistorico(alvos, hist, { tarefas, agrupar, tarefasMeta: tarefasMeta() });
      return "erro" in c ? { erro: "nao_comparavel" } : c;
    },
    recomendar(atividade, restricoes, estrategia) {
      const alvos = repos.alvos.listar();
      const hist = repos.resultados.historico({ estados: ["concluido", "falhou", "tempo_esgotado"] });
      return recomendarHistorico(atividade, hist, repos.tarefas.listar(), alvos, { restricoes, estrategia, habilitados: d.provedores?.habilitados() ?? null });
    },
    exportarPolitica(atividades) {
      const todas = atividades ?? [...new Set(repos.tarefas.listar({ estado: "ativa" }).map((t) => t.atividade))];
      return rascunhoDasAtividades(todas.map((a) => this.recomendar(a, null, null)));
    },
    async exportarRelatorio(runIds, formato) {
      const ids = runIds ?? repos.runs.listar(null, 20).itens.map((r) => r.id);
      const grades = ids.filter((i) => repos.runs.obter(i) !== undefined).map((i) => this.estadoRun(i));
      const conteudo = montarRelatorio(grades, formato, d.scrub);
      const caminho = (await d.salvar?.salvar(`bench-relatorio.${formato}`, conteudo)) ?? null;
      return { caminho };
    },
    limparExecucoes(runId) {
      // achado D-04: id de Run só no formato `brun_…` (nunca `..` nem separador) e UMA remoção, dentro de `exec/` (`limparRun` revalida o segmento)
      if (!/^brun_[0-9A-Za-z]{10,40}$/.test(runId)) throw new ErroBench("run_invalida", "identificador de Run inválido");
      limparRun(raizExec, runId);
    },
    async aguardar() { await Promise.all([...ativos.values()].map((a) => a.fim)); },
    async encerrar() {
      for (const a of ativos.values()) a.abort.abort();
      await executor.cancelarTodos();
      await Promise.all([...ativos.values()].map((a) => a.fim));
      for (const p of progressoPendente.values()) if (p.timer !== null) clearTimeout(p.timer);
      progressoPendente.clear();
    },
  };
}
