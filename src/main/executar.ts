// "Executar projeto" no main (D-430…): o botão ▶/■ do cabeçalho. Detecta ou lê as configurações do workspace, pede confiança antes de rodar código do
// repositório, abre UMA sessão de PTY no daemon (mesma pipeline dos terminais: executável e argumentos SEPARADOS, `ambienteSeguro`, OSC removido),
// acompanha a saída (URL/porta só em loopback), para a árvore com SIGINT → SIGTERM → SIGKILL e publica `run.started/stopped/failed`.
//
// COMO LIGAR (main.ts), depois do domínio: `criarServicoExecutar({...})` + `registrarIpcExecutar({ registro, servico })`. Nada é lido, varrido nem
// lançado aqui antes do primeiro clique/menu (lazy; boot sem custo).
import { randomUUID } from "node:crypto";
import { statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PRODUTO } from "../nucleo/produto";
import { corpoDaConfig, detectarConfiguracoes, type LeitorProjeto, type ResultadoDeteccao } from "../nucleo/executar/detectar";
import { criarArmazemExecutar, leitorDeDisco, type ArmazemExecutar } from "../nucleo/executar/armazem";
import { comandoEmTexto, hashDeConfianca, linhasDoComando } from "../nucleo/executar/hash";
import { estaAtiva, reduzir, type EventoMaquina } from "../nucleo/executar/maquina";
import {
  ARQUIVO_CONFIG_EXECUTAR, ESTADO_OCIOSO, LIMITES_EXECUTAR, type ArquivoConfigExecutar, type ConfigExecucao, type EntradaHistoricoExecutar, type EstadoExecucao, type EventoExecutar,
  type ItemConfigExecucao, type ListaExecucao, type PassoExecucao, type PedidoConfirmacaoExecutar, type ResultadoIniciar, type ResumoExecutarMcp,
} from "../nucleo/executar/modelo";
import { prechecar } from "../nucleo/executar/prechecagens";
import { resolverCwd, resolverExecutavel } from "../nucleo/executar/resolver";
import { traduzirSaida } from "../nucleo/executar/saida";
import { criarVarredor, urlAbrivel } from "../nucleo/executar/url";
import type { EventoTerminal } from "../compartilhado/terminais";

/** Erro com texto seguro para a UI (nunca stack, nunca caminho de máquina além do que o usuário configurou). */
export class ErroExecutar extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = "ErroExecutar"; }
}

/** O que o serviço usa do gerenciador de sessões (o real cumpre; o teste injeta um falso ou um com processos reais). */
export interface SessoesExecucao {
  abrir(pedido: unknown, opcoes?: { cwd?: string; ambiente?: Record<string, string> }): { sessao_id: string };
  encerrar(id: string): boolean;
  forcarEncerramento(id: string): boolean;
  escrever(id: string, dados: string): boolean;
  descartar(id: string): boolean;
  assinar(fn: (evento: EventoTerminal) => void): () => void;
}

export interface PreferenciasExecutar {
  /** focar o painel "Execução" ao rodar (padrão sim); `false` só sinaliza */
  focar: boolean;
  /** manter a execução viva no daemon ao fechar o app (padrão não: o app PARA e avisa) */
  manter_ao_fechar: boolean;
  /** notificação nativa ao terminar build/teste longo (padrão sim) */
  notificar: boolean;
}
const PREFERENCIAS_PADRAO: PreferenciasExecutar = { focar: true, manter_ao_fechar: false, notificar: true };

export interface DependenciasExecutar {
  pastaDados: string;
  /** raiz do workspace (nunca vem do renderer) ou `null` */
  raizDe(workspaceId: string): string | null;
  sessoes(): Promise<SessoesExecucao>;
  /** registra um executável absoluto no registro do detector e devolve o `executavel_id` (ferramenta `personalizado`) */
  registrarExecutavel(caminho: string): string | null;
  emitir(evento: EventoExecutar): void;
  barramento?: { emitir(tipo: string, payload: unknown): void };
  abrirExterno?(url: string): void | Promise<void>;
  /** `{{vault:NOME}}` → valor; só no main, o valor nunca sai daqui */
  resolverCofre?(texto: string, workspaceId: string): Promise<string>;
  notificar?(titulo: string, corpo: string): void;
  preferencias?(): Partial<PreferenciasExecutar>;
  aviso?(mensagem: string): void;
  // ---- injeções de teste
  armazem?: ArmazemExecutar;
  leitor?(raiz: string): LeitorProjeto;
  agora?(): number;
  esperas?: { sigint_ms: number; sigterm_ms: number; sigkill_ms: number };
  observar?(raiz: string, aoMudar: () => void): () => void;
  plataforma?: NodeJS.Platform;
  path?: string;
  /** build/teste mais longos que isto notificam ao terminar (padrão 30 s) */
  notificar_apos_ms?: number;
  /** teste: o programa existe no PATH? (padrão: `resolverExecutavel` com as pastas convencionais) */
  programaNoPath?(nome: string): boolean;
}

const ESPERAS_PADRAO = { sigint_ms: 3_000, sigterm_ms: 3_000, sigkill_ms: 2_000 };
const ARQUIVOS_ASSINATURA = [
  "package.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "Makefile", "makefile", "justfile", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt",
  "manage.py", "main.py", "app.py", "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml", "pom.xml", "build.gradle", "build.gradle.kts", "pubspec.yaml",
  "deno.json", "deno.jsonc", "artisan", "Gemfile", "index.html", "mvnw", "gradlew", ARQUIVO_CONFIG_EXECUTAR,
];

interface Execucao {
  chave: string;
  workspace_id: string;
  config: ConfigExecucao;
  raiz: string;
  estado: EstadoExecucao;
  passos: Array<{ caminho: string; argumentos: string[] }>;
  cwd: string;
  ambiente: Record<string, string>;
  comando: string;
  sessao_id: string | null;
  parada_pedida: boolean;
  desassinar: (() => void) | null;
  desobservar: (() => void) | null;
  varredor: ReturnType<typeof criarVarredor>;
  navegador_aberto: boolean;
  aguardando_saida: Array<() => void>;
  reiniciar_pedido: boolean;
}

export interface ServicoExecutar {
  listar(workspaceId: string): ListaExecucao;
  estado(workspaceId: string): EstadoExecucao;
  estados(workspaceId: string): EstadoExecucao[];
  iniciar(workspaceId: string, pedido: { config_id?: string | undefined; confirmar_hash?: string | undefined }): Promise<ResultadoIniciar>;
  parar(workspaceId: string, configId?: string): Promise<boolean>;
  reiniciar(workspaceId: string, configId?: string): Promise<ResultadoIniciar>;
  gravarConfig(workspaceId: string, config: ConfigExecucao, confirmouShell: boolean): ListaExecucao;
  removerConfig(workspaceId: string, configId: string): ListaExecucao;
  definirPadrao(workspaceId: string, configId: string): ListaExecucao;
  revogarConfianca(workspaceId: string, configId?: string): ListaExecucao;
  historico(workspaceId: string): EntradaHistoricoExecutar[];
  abrirUrl(workspaceId: string): Promise<boolean>;
  resumoMcp(workspaceId: string): ResumoExecutarMcp;
  /**
   * O usuário FECHOU a aba "Execução" (descarte da sessão): o processo morre junto, sem evento de saída. Conta como "parado", não como falha.
   * Sessão que não é a execução ativa (a antiga de um reuso) é ignorada.
   */
  aoSessaoDescartada(sessaoId: string): void;
  /** ao sair do app: para tudo (padrão) ou mantém no daemon (preferência) */
  encerrar(): Promise<void>;
}

export function criarServicoExecutar(deps: DependenciasExecutar): ServicoExecutar {
  const armazem = deps.armazem ?? criarArmazemExecutar(deps.pastaDados);
  const agora = deps.agora ?? Date.now;
  const esperas = deps.esperas ?? ESPERAS_PADRAO;
  const plataforma = deps.plataforma ?? process.platform;
  const aviso = (m: string): void => deps.aviso?.(m);
  const prefs = (): PreferenciasExecutar => ({ ...PREFERENCIAS_PADRAO, ...(deps.preferencias?.() ?? {}) });
  const leitorDe = (raiz: string): LeitorProjeto => (deps.leitor ?? leitorDeDisco)(raiz);
  const execucoes = new Map<string, Execucao>(); // chave `${ws}|${grupo}` — só as ATIVAS
  const ultimos = new Map<string, EstadoExecucao>(); // último estado por workspace (terminado ou ocioso)
  const sessaoAnterior = new Map<string, string>(); // chave → sessão do painel "Execução" a reaproveitar
  const cacheDeteccao = new Map<string, { assinatura: string; resultado: ResultadoDeteccao }>();
  let encerrado = false;

  const chaveDe = (ws: string, cfg: Pick<ConfigExecucao, "grupo">): string => `${ws}|${cfg.grupo ?? "_principal"}`;
  const ativasDe = (ws: string): Execucao[] => [...execucoes.values()].filter((e) => e.workspace_id === ws);

  // ---------------------------------------------------------------- configurações
  function assinatura(raiz: string, leitor: LeitorProjeto): string {
    // barato: existência + tamanho do texto dos poucos arquivos de projeto (o leitor real usa stat; aqui basta o conteúdo curto em cache)
    return ARQUIVOS_ASSINATURA.map((n) => (leitor.existe(n) ? "1" : "0")).join("") + raiz;
  }

  function detectar(ws: string, raiz: string): ResultadoDeteccao {
    const leitor = leitorDe(raiz);
    const ass = `${assinaturaMtime(raiz)}|${assinatura(raiz, leitor)}`;
    const cache = cacheDeteccao.get(ws);
    if (cache !== undefined && cache.assinatura === ass) return cache.resultado;
    const resultado = detectarConfiguracoes(leitor);
    cacheDeteccao.set(ws, { assinatura: ass, resultado });
    return resultado;
  }

  function assinaturaMtime(raiz: string): string {
    // mtime dos arquivos de projeto: cache por mtime (nada de reanalisar a cada abertura do menu)
    const partes: string[] = [];
    for (const n of ARQUIVOS_ASSINATURA) {
      try { partes.push(String(statSync(join(raiz, n)).mtimeMs)); } catch { partes.push("-"); }
    }
    return partes.join(",");
  }

  /** Lista final: configurações do usuário (arquivo/app) vencem as detectadas de mesmo id. */
  function mesclar(ws: string, raiz: string): { itens: ConfigExecucao[]; arquivo: ArquivoConfigExecutar; onde: ListaExecucao["armazenamento"]; det: ResultadoDeteccao } {
    const lida = armazem.lerConfig(ws, raiz);
    for (const a of lida.avisos) aviso(`executar: ${a}`);
    const det = detectar(ws, raiz);
    const ids = new Set(lida.arquivo.configuracoes.map((c) => c.id));
    const itens = [...lida.arquivo.configuracoes, ...det.configuracoes.filter((c) => !ids.has(c.id))];
    return { itens, arquivo: lida.arquivo, onde: lida.onde, det };
  }

  function corpoDe(raiz: string, cfg: ConfigExecucao, det: ResultadoDeteccao): string | null {
    // corpo real do script no momento (relido do disco: mudou depois de confiar = novo hash)
    void det;
    return corpoDaConfig(leitorDe(raiz), cfg);
  }

  const cachePath = new Map<string, { em: number; achou: boolean }>();
  function programaNoPath(nome: string): boolean {
    if (deps.programaNoPath !== undefined) return deps.programaNoPath(nome);
    const c = cachePath.get(nome);
    if (c !== undefined && agora() - c.em < 30_000) return c.achou;
    const r = resolverExecutavel(".", nome, { ...(deps.path === undefined ? {} : { path: deps.path }), plataforma, extras: [join(homedir(), ".local", "bin"), join(homedir(), ".volta", "bin"), join(homedir(), ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"] });
    cachePath.set(nome, { em: agora(), achou: r.ok });
    return r.ok;
  }

  function avisosDe(leitor: LeitorProjeto, c: ConfigExecucao): NonNullable<ItemConfigExecucao["avisos"]> {
    try { return prechecar(leitor, c, { programaNoPath }); } catch { return []; }
  }

  function montarLista(ws: string, raiz: string): ListaExecucao {
    const { itens, arquivo, onde, det } = mesclar(ws, raiz);
    const leitor = leitorDe(raiz);
    const padraoId = arquivo.padrao !== null && itens.some((c) => c.id === arquivo.padrao) ? arquivo.padrao : det.padrao_sugerido !== null && itens.some((c) => c.id === det.padrao_sugerido) ? det.padrao_sugerido : (itens[0]?.id ?? null);
    const configuracoes: ItemConfigExecucao[] = itens.map((c) => ({
      ...c, padrao: c.id === padraoId, comando: comandoEmTexto(c),
      confiavel: armazem.hashConfiado(ws, c.id) === hashDeConfianca(c, corpoDe(raiz, c, det)),
      avisos: avisosDe(leitor, c),
    }));
    return { workspace_id: ws, configuracoes, padrao_id: padraoId, armazenamento: onde, vazio: itens.length === 0 };
  }

  const raizObrigatoria = (ws: string): string => {
    const raiz = deps.raizDe(ws);
    if (raiz === null) throw new ErroExecutar("Workspace desconhecido.");
    return raiz;
  };

  // ---------------------------------------------------------------- estado
  const estadoAtual = (ws: string): EstadoExecucao => {
    const ativas = ativasDe(ws).sort((a, b) => (a.estado.iniciado_em ?? 0) - (b.estado.iniciado_em ?? 0));
    return ativas[0]?.estado ?? ultimos.get(ws) ?? ESTADO_OCIOSO(ws);
  };

  function aplicar(e: Execucao, ev: EventoMaquina): void {
    const novo = reduzir(e.estado, ev);
    if (novo === e.estado) return;
    e.estado = novo;
    if (!estaAtiva(novo)) ultimos.set(e.workspace_id, novo);
    deps.emitir({ tipo: "estado", estado: novo });
  }

  // ---------------------------------------------------------------- iniciar
  function confirmacao(ws: string, raiz: string, cfg: ConfigExecucao, corpo: string | null, hash: string): PedidoConfirmacaoExecutar {
    void ws; void raiz;
    return {
      config_id: cfg.id, nome: cfg.nome, hash, linhas: linhasDoComando(cfg), cwd: cfg.cwd, shell: cfg.shell !== null, ambiente: Object.keys(cfg.ambiente).sort(),
      corpo: corpo === null ? null : corpo.slice(0, 1_500), motivo: armazem.hashConfiado(ws, cfg.id) === null ? "primeira_vez" : "comando_mudou",
    };
  }

  function passosDe(cfg: ConfigExecucao): PassoExecucao[] {
    const principal: PassoExecucao = cfg.shell !== null
      ? plataforma === "win32" ? { executavel: process.env["ComSpec"] ?? "cmd.exe", argumentos: ["/d", "/s", "/c", cfg.shell] } : { executavel: "/bin/sh", argumentos: ["-c", cfg.shell] }
      : { executavel: cfg.executavel, argumentos: cfg.argumentos };
    return [...cfg.pre_passos, principal];
  }

  async function ambienteDe(ws: string, cfg: ConfigExecucao): Promise<Record<string, string>> {
    const saida: Record<string, string> = {};
    for (const [nome, valor] of Object.entries(cfg.ambiente)) {
      if (!valor.includes("{{vault:")) { saida[nome] = valor; continue; }
      if (deps.resolverCofre === undefined) throw new ErroExecutar(`A variável ${nome} usa o cofre, que não está disponível.`);
      try { saida[nome] = await deps.resolverCofre(valor, ws); } catch { throw new ErroExecutar(`Não foi possível ler do cofre o valor de ${nome}. Confira o nome da entrada.`); }
    }
    return saida;
  }

  async function iniciar(ws: string, pedido: { config_id?: string | undefined; confirmar_hash?: string | undefined }): Promise<ResultadoIniciar> {
    if (encerrado) throw new ErroExecutar("O app está fechando.");
    const raiz = raizObrigatoria(ws);
    const { itens, arquivo, det } = mesclar(ws, raiz);
    if (itens.length === 0) return { resultado: "configurar" };
    const id = pedido.config_id ?? (arquivo.padrao !== null && itens.some((c) => c.id === arquivo.padrao) ? arquivo.padrao : det.padrao_sugerido) ?? itens[0]!.id;
    const cfg = itens.find((c) => c.id === id);
    if (cfg === undefined) throw new ErroExecutar("Configuração de execução desconhecida.");

    // conflito: exclusiva (`grupo` nulo) conflita com tudo; grupo nomeado só com o mesmo grupo
    const ativas = ativasDe(ws);
    const conflita = ativas.find((a) => cfg.grupo === null || a.config.grupo === null || a.config.grupo === cfg.grupo);
    if (conflita !== undefined) throw new ErroExecutar(`Já há uma execução em andamento (${conflita.config.nome}). Pare antes ou use Reiniciar.`);

    // confiança: rodar script do repositório é executar código
    const corpo = corpoDe(raiz, cfg, det);
    const hash = hashDeConfianca(cfg, corpo);
    if (armazem.hashConfiado(ws, cfg.id) !== hash) {
      if (pedido.confirmar_hash !== hash) return { resultado: "confirmar", pedido: confirmacao(ws, raiz, cfg, corpo, hash) };
      armazem.confiar(ws, cfg.id, hash);
    }

    // resolução confinada ANTES de reservar o estado: erro de configuração aparece na hora
    const cwd = resolverCwd(raiz, cfg.cwd);
    if (!cwd.ok) throw new ErroExecutar(cwd.erro);
    const passos: Array<{ caminho: string; argumentos: string[] }> = [];
    const lista = passosDe(cfg);
    for (const [i, p] of lista.entries()) {
      // o shell (opt-in) é o interpretador do sistema: caminho absoluto fixo, nunca resolvido pelo PATH do repositório
      const ehShell = cfg.shell !== null && i === lista.length - 1;
      const r = ehShell
        ? { ok: true as const, caminho: p.executavel }
        : resolverExecutavel(raiz, p.executavel, { ...(deps.path === undefined ? {} : { path: deps.path }), plataforma, extras: [join(homedir(), ".local", "bin"), join(homedir(), ".volta", "bin"), join(homedir(), ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"] });
      if (!r.ok) throw new ErroExecutar(r.erro);
      passos.push({ caminho: r.caminho, argumentos: p.argumentos });
    }
    const ambiente = await ambienteDe(ws, cfg);

    const execucao: Execucao = {
      chave: chaveDe(ws, cfg), workspace_id: ws, config: cfg, raiz, estado: ESTADO_OCIOSO(ws), passos, cwd: cwd.caminho, ambiente, comando: comandoEmTexto(cfg),
      sessao_id: null, parada_pedida: false, desassinar: null, desobservar: null, varredor: criarVarredor(), navegador_aberto: false, aguardando_saida: [], reiniciar_pedido: false,
    };
    execucoes.set(execucao.chave, execucao);
    aplicar(execucao, { t: "iniciar", execucao_id: `exe_${randomUUID().replaceAll("-", "").slice(0, 20)}`, config_id: cfg.id, nome: cfg.nome, tipo: cfg.tipo, passos_total: passos.length, agora: agora() });
    deps.barramento?.emitir("run.started", { workspace_id: ws, config_id: cfg.id, nome: cfg.nome, execucao_id: execucao.estado.execucao_id, iniciado_em: execucao.estado.iniciado_em, comando: execucao.comando });
    try {
      await abrirPasso(execucao, 1);
    } catch (e) {
      finalizarComFalha(execucao, e instanceof ErroExecutar ? e.message : "Não foi possível iniciar o processo.");
      throw e instanceof ErroExecutar ? e : new ErroExecutar("Não foi possível iniciar o processo.");
    }
    if (cfg.reiniciar_ao_salvar) ligarObservador(execucao);
    return { resultado: "iniciado", estado: execucao.estado };
  }

  async function abrirPasso(e: Execucao, numero: number): Promise<void> {
    const passo = e.passos[numero - 1]!;
    const exeId = deps.registrarExecutavel(passo.caminho);
    if (exeId === null) throw new ErroExecutar("O programa não pôde ser registrado para execução.");
    const sessoes = await deps.sessoes();
    const anterior = sessaoAnterior.get(e.chave) ?? null;
    const pedido = { versao: 1, ferramenta_id: "personalizado", executavel_id: exeId, argumentos: passo.argumentos, colunas: 120, linhas: 30, workspace_id: e.workspace_id };
    let aberta: { sessao_id: string };
    try { aberta = sessoes.abrir(pedido, { cwd: e.cwd, ambiente: e.ambiente }); } catch (erro) {
      throw new ErroExecutar(erro instanceof Error && /Limite de sessões/.test(erro.message) ? erro.message : "Não foi possível abrir o terminal de execução.");
    }
    const sid = aberta.sessao_id;
    e.sessao_id = sid;
    sessaoAnterior.set(e.chave, sid);
    e.desassinar?.();
    e.desassinar = sessoes.assinar((ev) => aoEventoDaSessao(e, numero, sid, ev));
    aplicar(e, { t: "passo", passo: numero, sessao_id: sid });
    deps.emitir({ tipo: "sessao", workspace_id: e.workspace_id, sessao_id: sid, anterior, focar: prefs().focar, nome: e.config.nome });
    // o painel é reutilizado: a sessão anterior (já encerrada ou de um passo anterior) sai de vez
    if (anterior !== null && anterior !== sid) { try { sessoes.descartar(anterior); } catch { /* já saiu */ } }
  }

  function aoEventoDaSessao(e: Execucao, numero: number, sid: string, ev: EventoTerminal): void {
    if (ev.sessao_id !== sid) return;
    if (ev.tipo === "saida") {
      if (e.varredor.encerrado()) return;
      const achado = e.varredor.alimentar(ev.dados);
      if (achado !== null && urlAbrivel(achado.url)) {
        aplicar(e, { t: "porta", porta: achado.porta, url: achado.url });
        if (e.config.abrir_navegador && !e.navegador_aberto && numero === e.passos.length) {
          e.navegador_aberto = true;
          void Promise.resolve(deps.abrirExterno?.(achado.url)).catch(() => undefined);
        }
      }
      return;
    }
    if (ev.tipo !== "encerramento") return;
    e.desassinar?.();
    e.desassinar = null;
    e.aguardando_saida.splice(0).forEach((f) => f());
    const codigo = ev.codigo;
    const sinal = ev.sinal;
    if (!e.parada_pedida && codigo === 0 && sinal === null && numero < e.passos.length) {
      // pré-passo concluído: segue para o próximo, no mesmo painel
      void abrirPasso(e, numero + 1).catch((erro: unknown) => finalizarComFalha(e, erro instanceof ErroExecutar ? erro.message : "Não foi possível iniciar o próximo passo."));
      return;
    }
    finalizar(e, codigo, sinal, numero);
  }

  function finalizarComFalha(e: Execucao, mensagem: string): void {
    pararObservador(e);
    e.desassinar?.();
    e.desassinar = null;
    execucoes.delete(e.chave);
    aplicarFinal(e, { t: "falha_ao_iniciar", agora: agora(), mensagem });
    deps.barramento?.emitir("run.failed", { workspace_id: e.workspace_id, config_id: e.config.id, nome: e.config.nome, execucao_id: e.estado.execucao_id, mensagem, codigo: null });
  }

  function aplicarFinal(e: Execucao, ev: EventoMaquina): void {
    // a execução já saiu do mapa de ativas: aplica direto no estado dela e publica
    const novo = reduzir({ ...e.estado, fase: e.estado.fase === "ocioso" ? "preparando" : e.estado.fase }, ev);
    e.estado = novo;
    ultimos.set(e.workspace_id, novo);
    deps.emitir({ tipo: "estado", estado: novo });
  }

  function finalizar(e: Execucao, codigo: number | null, sinal: number | null, numero: number): void {
    pararObservador(e);
    e.desassinar?.();
    e.desassinar = null;
    execucoes.delete(e.chave);
    const t = traduzirSaida(numero < e.passos.length ? "build" : e.config.tipo, { codigo, sinal, parado_pelo_usuario: e.parada_pedida }, numero < e.passos.length ? `O pré-passo ${numero}` : e.config.nome);
    if (t.resultado === "falha" && numero < e.passos.length) t.mensagem = `Pré-passo ${numero} de ${e.passos.length - 1} falhou${codigo === null ? "" : ` (código ${codigo})`}: veja o painel Execução.`;
    const fim = agora();
    aplicarFinal(e, { t: "terminou", agora: fim, resultado: t.resultado, codigo, sinal, mensagem: t.mensagem });
    const duracao = Math.max(0, fim - (e.estado.iniciado_em ?? fim));
    const base = { workspace_id: e.workspace_id, config_id: e.config.id, nome: e.config.nome, execucao_id: e.estado.execucao_id, codigo, sinal, duracao_ms: duracao };
    if (t.resultado === "falha") deps.barramento?.emitir("run.failed", { ...base, mensagem: t.mensagem });
    else deps.barramento?.emitir("run.stopped", { ...base, resultado: t.resultado });
    try {
      armazem.registrarHistorico(e.workspace_id, {
        execucao_id: e.estado.execucao_id ?? "", config_id: e.config.id, nome: e.config.nome, comando: e.comando.slice(0, 400),
        iniciado_em: new Date(e.estado.iniciado_em ?? fim).toISOString(), duracao_ms: duracao, codigo, sinal, resultado: t.resultado,
      });
    } catch { aviso("executar: não foi possível gravar o histórico"); }
    if (prefs().notificar && e.config.tipo !== "rodar" && !e.parada_pedida && duracao >= (deps.notificar_apos_ms ?? 30_000)) {
      try { deps.notificar?.(`${e.config.nome}: ${t.resultado === "sucesso" ? "concluído" : "falhou"}`, t.mensagem); } catch { /* notificação é cortesia */ }
    }
    if (e.reiniciar_pedido && !encerrado) void iniciar(e.workspace_id, { config_id: e.config.id }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- parar
  const dormir = (ms: number, e: Execucao): Promise<boolean> => new Promise<boolean>((resolver) => {
    let feito = false;
    const fim = (saiu: boolean): void => { if (feito) return; feito = true; clearTimeout(t); resolver(saiu); };
    const t = setTimeout(() => fim(false), ms);
    t.unref();
    e.aguardando_saida.push(() => fim(true));
  });

  async function pararExecucao(e: Execucao, ms = esperas): Promise<void> {
    if (!execucoes.has(e.chave)) return;
    if (e.parada_pedida) { await dormir(ms.sigint_ms + ms.sigterm_ms + ms.sigkill_ms, e); return; }
    e.parada_pedida = true;
    aplicar(e, { t: "parar" });
    pararObservador(e);
    const sid = e.sessao_id;
    if (sid === null) { finalizar(e, null, null, e.passos.length); return; }
    const sessoes = await deps.sessoes();
    // 1) SIGINT (Ctrl+C no PTY: vai ao grupo em primeiro plano, que inclui os filhos do npm/vite/etc.)
    try { sessoes.escrever(sid, "\x03"); } catch { /* sessão já saiu */ }
    if (await dormir(ms.sigint_ms, e)) return;
    // 2) SIGTERM na árvore
    try { sessoes.encerrar(sid); } catch { /* idem */ }
    if (await dormir(ms.sigterm_ms, e)) return;
    // 3) SIGKILL na árvore
    try { sessoes.forcarEncerramento(sid); } catch { /* idem */ }
    if (await dormir(ms.sigkill_ms, e)) return;
    aviso(`executar: o processo de ${e.config.nome} não respondeu a SIGKILL`);
    finalizar(e, null, 9, e.passos.length);
  }

  async function parar(ws: string, configId?: string): Promise<boolean> {
    const alvos = ativasDe(ws).filter((e) => configId === undefined || e.config.id === configId);
    if (alvos.length === 0) return false;
    await Promise.all(alvos.map((e) => pararExecucao(e)));
    return true;
  }

  async function reiniciar(ws: string, configId?: string): Promise<ResultadoIniciar> {
    const ativas = ativasDe(ws).filter((e) => configId === undefined || e.config.id === configId);
    const id = configId ?? ativas[0]?.config.id ?? ultimos.get(ws)?.config_id ?? undefined;
    if (ativas.length > 0) await Promise.all(ativas.map((e) => pararExecucao(e)));
    return iniciar(ws, { config_id: id });
  }

  // ---------------------------------------------------------------- reiniciar ao salvar (opcional por configuração)
  const IGNORADOS = /(^|[\\/])(node_modules|\.git|dist|dist-app|build|target|\.next|\.nuxt|__pycache__|\.venv|venv|coverage|\.turbo)([\\/]|$)/;
  const pastaDoProduto = PRODUTO.pastaNoProjeto;
  function observarPadrao(raiz: string, aoMudar: () => void): () => void {
    let w: FSWatcher | null = null;
    try {
      w = watch(raiz, { recursive: true }, (_tipo, nome) => { if (typeof nome === "string" && !IGNORADOS.test(nome) && !nome.startsWith(pastaDoProduto)) aoMudar(); });
      w.on("error", () => undefined);
    } catch { /* plataforma sem watch recursivo: o recurso simplesmente não liga */ }
    return () => { try { w?.close(); } catch { /* já fechado */ } };
  }
  function ligarObservador(e: Execucao): void {
    let t: ReturnType<typeof setTimeout> | null = null;
    const parar = (deps.observar ?? observarPadrao)(e.raiz, () => {
      if (t !== null) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        if (!execucoes.has(e.chave) || e.parada_pedida) return;
        e.reiniciar_pedido = true;
        void pararExecucao(e);
      }, 800);
      t.unref();
    });
    e.desobservar = () => { if (t !== null) clearTimeout(t); parar(); };
  }
  function pararObservador(e: Execucao): void { e.desobservar?.(); e.desobservar = null; }

  // ---------------------------------------------------------------- escrita das configurações
  function gravarArquivo(ws: string, raiz: string, mudar: (a: ArquivoConfigExecutar) => ArquivoConfigExecutar): ListaExecucao {
    const lida = armazem.lerConfig(ws, raiz);
    const novo = mudar({ versao: 1, padrao: lida.arquivo.padrao, configuracoes: [...lida.arquivo.configuracoes] });
    if (novo.configuracoes.length > LIMITES_EXECUTAR.configuracoes) throw new ErroExecutar("Configurações demais.");
    armazem.gravarConfig(ws, raiz, novo);
    deps.emitir({ tipo: "configuracoes", workspace_id: ws });
    return montarLista(ws, raiz);
  }

  return {
    listar: (ws) => montarLista(ws, raizObrigatoria(ws)),
    estado: estadoAtual,
    estados: (ws) => [...ativasDe(ws).map((e) => e.estado), ...(ativasDe(ws).length === 0 && ultimos.has(ws) ? [ultimos.get(ws)!] : [])],
    iniciar,
    parar,
    reiniciar,

    gravarConfig(ws, config, confirmouShell) {
      const raiz = raizObrigatoria(ws);
      if (config.shell !== null && !confirmouShell) throw new ErroExecutar("Executar em shell exige confirmação explícita do comando exato.");
      return gravarArquivo(ws, raiz, (a) => {
        const i = a.configuracoes.findIndex((c) => c.id === config.id);
        const nova: ConfigExecucao = { ...config, origem: "usuario" };
        return { ...a, configuracoes: i < 0 ? [...a.configuracoes, nova] : a.configuracoes.map((c, k) => (k === i ? nova : c)) };
      });
    },
    removerConfig(ws, configId) {
      const raiz = raizObrigatoria(ws);
      return gravarArquivo(ws, raiz, (a) => ({ ...a, padrao: a.padrao === configId ? null : a.padrao, configuracoes: a.configuracoes.filter((c) => c.id !== configId) }));
    },
    definirPadrao(ws, configId) {
      const raiz = raizObrigatoria(ws);
      if (!mesclar(ws, raiz).itens.some((c) => c.id === configId)) throw new ErroExecutar("Configuração de execução desconhecida.");
      return gravarArquivo(ws, raiz, (a) => ({ ...a, padrao: configId }));
    },
    revogarConfianca(ws, configId) {
      const raiz = raizObrigatoria(ws);
      armazem.revogar(ws, configId);
      deps.emitir({ tipo: "configuracoes", workspace_id: ws });
      return montarLista(ws, raiz);
    },
    historico: (ws) => { raizObrigatoria(ws); return armazem.historico(ws); },

    async abrirUrl(ws) {
      const url = estadoAtual(ws).url;
      if (url === null || !urlAbrivel(url) || deps.abrirExterno === undefined) return false;
      await deps.abrirExterno(url);
      return true;
    },

    resumoMcp(ws) {
      const e = estadoAtual(ws);
      return {
        workspace_id: ws, fase: e.fase, config_id: e.config_id, nome: e.nome, porta: e.porta, url: e.url, codigo: e.codigo, mensagem: e.mensagem,
        rodando_ha_s: estaAtiva(e) && e.iniciado_em !== null ? Math.floor((agora() - e.iniciado_em) / 1000) : null,
      };
    },

    aoSessaoDescartada(sessaoId) {
      const e = [...execucoes.values()].find((x) => x.sessao_id === sessaoId);
      if (e === undefined) return;
      e.parada_pedida = true;
      e.reiniciar_pedido = false;
      aplicar(e, { t: "parar" });
      e.aguardando_saida.splice(0).forEach((f) => f());
      finalizar(e, null, null, e.passos.length);
    },

    async encerrar() {
      if (encerrado) return;
      encerrado = true;
      if (prefs().manter_ao_fechar) { for (const e of execucoes.values()) pararObservador(e); return; }
      const curtas = { sigint_ms: Math.min(esperas.sigint_ms, 800), sigterm_ms: Math.min(esperas.sigterm_ms, 800), sigkill_ms: Math.min(esperas.sigkill_ms, 600) };
      await Promise.all([...execucoes.values()].map((e) => { e.reiniciar_pedido = false; return pararExecucao(e, curtas); }));
    },
  };
}
