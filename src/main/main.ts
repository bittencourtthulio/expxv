import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, protocol, shell, Tray } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { TemaEfetivo, TemaPreferencia } from "../compartilhado/ipc";
import { corFundoJanela } from "../compartilhado/tema";
import { PRODUTO, variavelDeAmbiente } from "../nucleo/produto";
import { autorizarRemetente } from "./autorizador";
import { criarBarramento } from "./barramento";
import { executarBoot } from "./boot";
import type { ContextoTerminais } from "./contexto-terminais";
import type { DominioBase } from "./dominio-base";
import type { GanchoE2E } from "./gancho-e2e";
import type { ServicosDominio } from "./servicos";
import type { Orquestracao } from "./orquestracao";
import { tratarSegundaInstancia } from "./instancia";
import { criarJanela, caminhoDoPreload } from "./janela";
import { registrarIpcApp, estadoDoTema } from "./ipc/app";
import { criarRegistroIpc, type RegistroIpc } from "./ipc/registro";
import { decidirAbertura, urlDocumentoPrincipalPermitida, urlPermitida } from "./navegacao";
import { criarMarcasPerf } from "./perf";
import { limitePaineisDe, permissaoPadraoDe } from "./config-app";
import { encaminharEventoMenu } from "./encaminhar-menu";
import { criarPreferencias, type Preferencias } from "./preferencias";
import { criarPreferenciaNotificacoes, type PreferenciaNotificacoes } from "./preferencia-notificacoes";
import { ligarRecargaDev } from "./recarga-dev";
import { smokeAtivo } from "./smoke";
import { cabecalhosDoRenderer, caminhoDoRecurso, SCHEME, urlDoApp } from "./scheme";

const marcas = criarMarcasPerf(Date.now() - Math.round(process.uptime() * 1000));
const barramento = criarBarramento();

// O scheme privilegiado precisa ser registrado ANTES de `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** UMA instância das preferências (cache único: tema, config, notificações e bandeja enxergam o mesmo valor). */
let preferenciasApp: Preferencias | null = null;
function preferencias(): Preferencias {
  preferenciasApp ??= criarPreferencias(app.getPath("userData"));
  return preferenciasApp;
}
const notificacoes: PreferenciaNotificacoes = criarPreferenciaNotificacoes({
  obter: (chave) => preferencias().obter(chave),
  definir: (chave, valor) => preferencias().definir(chave, valor),
});
/** bandeja e menu nativo: instalados na onda 2 (nunca na onda 1, P-01). */
let bandeja: { destruir(): void; atualizar(): void } | null = null;

let janela: BrowserWindow | null = null;
let janelaId: number | null = null;
/** terminais (detecção, daemon, sessões, sinaleira): carregado logo DEPOIS de a janela ser criada (P-01). */
let terminais: ContextoTerminais | null = null;
/** registro único de canais IPC (app agora; terminais logo depois de a janela abrir). */
let registroIpc: RegistroIpc | null = null;
/** banco + workspaces (criados logo depois da janela e antes dos terminais). */
let base: DominioBase | null = null;
/** workspaces, provedores, missões e método (registrados depois dos terminais). */
let dominio: ServicosDominio | null = null;
/** orquestração piloto/workers + servidor MCP (onda 2; nada disto existe na onda 1). */
let orquestracao: Orquestracao | null = null;
/** gancho de TESTE (só existe com a variável E2E do produto): ver `gancho-e2e.ts`. */
let gancho: GanchoE2E | null = null;
/** a saída do app já passou pelo encerramento limpo (`before-quit`). */
let saidaLiberada = false;
let encerrando = false;

function raizDoRenderer(): string {
  return join(__dirname, "..", "renderer");
}

function registrarScheme(): void {
  const raiz = raizDoRenderer();
  protocol.handle(SCHEME, async (pedido) => {
    const arquivo = caminhoDoRecurso(pedido.url, raiz);
    if (arquivo === null) return new Response("não encontrado", { status: 404 });
    const resposta = await net.fetch(pathToFileURL(arquivo).toString());
    const cabecalhos = new Headers(resposta.headers);
    for (const [nome, valor] of Object.entries(cabecalhosDoRenderer())) cabecalhos.set(nome, valor);
    return new Response(resposta.body, { status: resposta.status, headers: cabecalhos });
  });
}

function remetenteDe(evento: unknown): { url: string; frame_principal: boolean; janela_id: number } | null {
  const e = evento as Partial<IpcMainInvokeEvent & IpcMainEvent>;
  const frame = e.senderFrame;
  const remetente = e.sender;
  if (frame === undefined || frame === null || remetente === undefined) return null;
  return { url: frame.url, frame_principal: frame === remetente.mainFrame, janela_id: remetente.id };
}

function aplicarTema(estado: { preferencia: TemaPreferencia; efetivo: TemaEfetivo }): void {
  nativeTheme.themeSource = estado.preferencia === "sistema" ? "system" : estado.preferencia === "escuro" ? "dark" : "light";
  janela?.setBackgroundColor(corFundoJanela(estado.efetivo));
  if (janela !== null && !janela.isDestroyed()) janela.webContents.send("app:tema_mudou", estado);
}

function abrirJanela(): void {
  const tema = estadoDoTema({ preferencias: preferencias(), sistemaEscuro: () => nativeTheme.shouldUseDarkColors });
  const nova = criarJanela({
    url: urlDoApp(),
    preload: caminhoDoPreload(__dirname),
    tema: tema.efetivo,
    BrowserWindow: BrowserWindow as never,
    aoMostrar: () => {
      marcas.marcar("janela:visivel");
      if (smokeAtivo(process.env)) app.exit(0);
    },
  }) as unknown as BrowserWindow;
  janela = nova;
  janelaId = nova.webContents.id;
  // modo dev (não empacotado + variável DEV do produto): recarrega a janela quando o renderer é reconstruído
  if (!app.isPackaged && process.env[variavelDeAmbiente("DEV")] === "1") {
    const parar = ligarRecargaDev({ pasta: raizDoRenderer(), recarregar: () => { if (!nova.isDestroyed()) nova.webContents.reloadIgnoringCache(); } });
    nova.on("closed", parar);
  }

  nova.webContents.setWindowOpenHandler(({ url }) => ({
    action: decidirAbertura(url, (u) => void shell.openExternal(u)),
  }));
  nova.webContents.on("will-navigate", (evento, url) => {
    if (urlPermitida(url) && urlDocumentoPrincipalPermitida(url)) return;
    evento.preventDefault();
    decidirAbertura(url, (u) => void shell.openExternal(u));
  });
  if (terminais !== null) ligarJanelaTerminais(nova);
  nova.on("closed", () => {
    if (janela === nova) {
      janela = null;
      janelaId = null;
    }
  });
}

/** Foco invalida a detecção de CLIs; fechar passa pelo guardião (com daemon só solta as sessões). */
function ligarJanelaTerminais(nova: BrowserWindow): void {
  const contexto = terminais;
  if (contexto === null) return;
  if (gancho !== null) void import("./gancho-e2e").then((m) => m.ligarGanchoNoRenderer(gancho, nova.webContents));
  void import("./ipc/terminais").then(({ ligarInvalidacaoNoFoco }) => ligarInvalidacaoNoFoco(nova, contexto.detector));
  let fechamentoAutorizado = false;
  nova.on("close", (evento) => {
    if (fechamentoAutorizado || saidaLiberada) return;
    evento.preventDefault();
    void contexto.transicoes.fecharJanela(async () => {
      fechamentoAutorizado = true;
      contexto.aoFecharJanela();
    }).then((fechou) => {
      if (fechou && !nova.isDestroyed()) nova.close();
    });
  });
}

function registrarIpc(): void {
  const registro = criarRegistroIpc({
    ipcMain: ipcMain as never,
    autorizar: (evento) => {
      const r = remetenteDe(evento);
      return r !== null && autorizarRemetente(r, janelaId);
    },
  });
  registroIpc = registro;
  registrarIpcApp({
    registro,
    versao: app.getVersion(),
    preferencias: preferencias(),
    marcas,
    sistemaEscuro: () => nativeTheme.shouldUseDarkColors,
    aoMudarTema: aplicarTema,
  });
}

/**
 * Carrega e liga os terminais. Roda DEPOIS de a janela ser criada: os módulos (detecção, sessões, daemon,
 * sinaleira) custam ~20 ms de require e não entram no caminho até a janela (P-01). Os canais são
 * registrados no mesmo turno da criação da janela, antes de qualquer mensagem do renderer.
 */
async function prepararTerminais(): Promise<void> {
  const [{ criarContextoTerminais }, { scriptDoDaemon, variavelSemDaemon }, { criarGanchoE2E }, { criarNotificador }, { CATALOGO_TERMINAIS }, { DetectorFerramentas }] = await Promise.all([
    import("./contexto-terminais"),
    import("./daemon"),
    import("./gancho-e2e"),
    import("./notificar"),
    import("../nucleo/terminais/catalogo"),
    import("../nucleo/terminais/deteccao"),
  ]);
  gancho = criarGanchoE2E(process.env, app.isPackaged);
  const ganchoAtual = gancho;
  const notificar = criarNotificador({
    suportado: () => Notification.isSupported(),
    criar: (dados) => new Notification(dados),
    janelaEmFoco: () => janela !== null && !janela.isDestroyed() && janela.isFocused(),
    nomeDaFerramenta: (id) => CATALOGO_TERMINAIS.find((f) => f.id === id)?.nome ?? id,
    ativo: notificacoes.ativo, // config `notificacoes` e "Pausar notificações" da bandeja
  });
  const contexto = criarContextoTerminais({
    dadosApp: app.getPath("userData"),
    pastaTemp: app.getPath("temp"),
    executavelApp: process.execPath,
    scriptDaemon: scriptDoDaemon(__dirname, app.isPackaged),
    e2e: ganchoAtual !== null,
    // só com o gancho de teste: as CLIs falsas de uma pasta são as ÚNICAS detectadas (a CLI real nunca roda em teste)
    ...(ganchoAtual?.pastaClis != null ? { detector: new DetectorFerramentas({ path: ganchoAtual.pastaClis, diretorios_convencionais: [] }) } : {}),
    semDaemon: process.env[variavelSemDaemon()] === "1",
    // O cwd NUNCA vem do renderer: é a raiz do workspace (ou o worktree da Missão, resolvido no domínio).
    // Com o gancho de teste, o workspace atual nulo cai na raiz do gancho.
    resolverCwd: (workspaceId) => {
      if (workspaceId === null && ganchoAtual?.raiz !== undefined && ganchoAtual.raiz !== null) return ganchoAtual.raiz;
      return base !== null ? base.workspaces.resolverCwd(workspaceId) : homedir();
    },
    permissaoDe: (workspaceId) => (base !== null ? base.workspaces.permissaoDe(workspaceId) : "seguro"), // D-14
    enviar: (canal, payload) => {
      if (janela !== null && !janela.isDestroyed()) janela.webContents.send(canal, payload);
    },
    janelaId: () => janelaId ?? 0,
    limiteSessoes: () => limitePaineisDe(preferencias()), // config `limite_paineis`: vale para as próximas sessões
    notificar,
    confirmarEncerramento: async (acao) => {
      const opcoes = {
        type: "warning" as const,
        title: "Sessões de terminal ativas",
        message: `Para ${acao}, as sessões de terminal precisam ser encerradas.`,
        buttons: ["Encerrar sessões", "Cancelar"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const r = janela !== null && !janela.isDestroyed() ? await dialog.showMessageBox(janela, opcoes) : await dialog.showMessageBox(opcoes);
      return r.response === 0;
    },
  });
  if (registroIpc !== null) {
    contexto.registrarIpc({
      registro: registroIpc,
      // com o gancho de teste a CLI falsa entra sem o diálogo nativo; sem ele é sempre o diálogo
      escolherExecutavel: async (ferramentaId) => {
        if (ganchoAtual !== null && ganchoAtual.executavel !== null && ferramentaId === "personalizado") return ganchoAtual.executavel;
        const opcoes = { title: "Escolher executável", properties: ["openFile" as const, "showHiddenFiles" as const] };
        const r = janela !== null && !janela.isDestroyed() ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
      abrirExterno: (url) => shell.openExternal(url),
      // descartar a sessão encerra o Pane no banco ('descartado'), avisa a UI e a Orquestração revoga o token MCP
      aoDescartar: (sessaoId) => void dominio?.panes.marcarDescartada(sessaoId),
      infoApp: () => ({ versao_app: app.getVersion(), versao_electron: process.versions.electron ?? "desconhecida" }),
    });
  }
  terminais = contexto;
  ligarEncerramento();
  if (janela !== null) ligarJanelaTerminais(janela);
}

/** Banco + workspaces: antes dos terminais (eles precisam de resolverCwd/permissaoDe). */
async function prepararBase(): Promise<void> {
  const { abrirDominioBase } = await import("./dominio-base");
  base = await abrirDominioBase({
    pastaDeDados: app.getPath("userData"),
    permissaoPadrao: () => permissaoPadraoDe(preferencias()), // config `permissao_padrao` (novos workspaces)
    escolherPasta: async () => {
      const opcoes = { title: "Abrir projeto", properties: ["openDirectory" as const] };
      const r = janela !== null && !janela.isDestroyed() ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
  });
}

/** Workspaces, provedores, missões e método: registra os canais; `iniciar()` roda na onda 2. */
async function prepararDominio(): Promise<void> {
  if (base === null || terminais === null || registroIpc === null) return;
  const { registrarServicosDominio } = await import("./servicos");
  const contexto = terminais;
  dominio = registrarServicosDominio({
    registro: registroIpc,
    banco: base.banco,
    barramento,
    detector: contexto.detector as never,
    sessoes: () => contexto.sessoes() as never,
    pastaDeDados: app.getPath("userData"),
    escolherPasta: async () => null, // o serviço de workspaces já foi criado em `base` com o diálogo real
    workspaces: base.workspaces,
    emitir: (canal, payload) => {
      if (janela !== null && !janela.isDestroyed()) janela.webContents.send(canal, payload);
    },
    caminhoWorker: join(__dirname, "..", "nucleo", "metodo", "worker.js").replace("app.asar", "app.asar.unpacked"),
    aviso: (mensagem) => console.error(`[${PRODUTO.id}] ${mensagem}`),
  });
}

/** Orquestração (onda 2): preparador de lançamento dos Panes, servidor MCP em worker thread e eventos das sessões. */
async function iniciarOrquestracao(): Promise<void> {
  if (base === null || terminais === null || dominio === null) return;
  const [{ criarOrquestracao }, { resolverAtivos }] = await Promise.all([import("./orquestracao"), import("./ativos-orquestracao")]);
  const contexto = terminais;
  const orq = criarOrquestracao({
    dominio,
    banco: base.banco,
    barramento,
    sessoes: () => contexto.sessoes(),
    dirApp: app.getPath("userData"),
    executavelNode: process.execPath,
    electronComoNode: process.versions.electron !== undefined,
    ativos: resolverAtivos({ dirMain: __dirname, empacotado: app.isPackaged }),
    avisar: (mensagem) => console.error(`[${PRODUTO.id}] ${mensagem}`),
  });
  orquestracao = orq;
  await orq.iniciar();
}

function mostrarJanela(): void {
  if (janela === null || janela.isDestroyed()) { abrirJanela(); return; }
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

/** Menu nativo + bandeja (onda 2): os eventos do menu seguem ao renderer pelo canal `app:menu`. */
async function instalarMenuEBandeja(): Promise<void> {
  const [{ criarMenu }, { criarTray, criarIconeTray, diretorioBaseDoIcone }] = await Promise.all([import("./menu"), import("./tray")]);
  criarMenu({
    plataforma: process.platform,
    Menu: Menu as never,
    emitir: (evento) => encaminharEventoMenu(evento, {
      enviar: (canal, payload) => { if (janela !== null && !janela.isDestroyed()) janela.webContents.send(canal, payload); },
      definirTema: (preferencia) => {
        void preferencias().definir("tema_preferencia", preferencia).then(() => aplicarTema(estadoDoTema({ preferencias: preferencias(), sistemaEscuro: () => nativeTheme.shouldUseDarkColors })));
      },
    }),
  }).instalar();
  const tray = criarTray({
    Tray: Tray as never,
    Menu: Menu as never,
    icone: criarIconeTray(diretorioBaseDoIcone(__dirname), nativeImage as never), // build/icone-32.png (entra no pacote por `files`)
    abrir: mostrarJanela,
    sair: () => app.quit(),
    notificacoes,
  });
  tray.instalar();
  bandeja = tray;
  // a pausa pode mudar pela tela de Configurações: refaz o item da bandeja quando a janela volta ao foco
  app.on("browser-window-focus", () => bandeja?.atualizar());
}

/** Saída limpa: solta as sessões (o daemon as mantém vivas) e encerra o daemon só se não há nada a preservar. */
function ligarEncerramento(): void {
  app.on("before-quit", (evento) => {
    if (saidaLiberada || (terminais === null && base === null)) return;
    evento.preventDefault();
    if (encerrando) return;
    encerrando = true;
    const limite = new Promise<void>((resolver) => { setTimeout(resolver, 4_000).unref(); });
    // rede de segurança final (AUD-06): se algo ainda segurar o encerramento, o app sai de qualquer jeito; o SO libera os handles
    setTimeout(() => { try { app.exit(0); } catch { /* sem o que fazer */ } }, 7_000).unref();
    const encerramento = (async (): Promise<void> => {
      bandeja?.destruir();
      bandeja = null;
      await orquestracao?.encerrar().catch(() => undefined);
      await dominio?.encerrar().catch(() => undefined);
      await terminais?.encerrar().catch(() => undefined);
      base?.fechar();
    })();
    void Promise.race([encerramento, limite]).finally(() => {
      saidaLiberada = true;
      app.quit();
    });
  });
}

function configurarPermissoes(): void {
  const { session } = require("electron") as typeof import("electron");
  session.defaultSession.setPermissionRequestHandler((_wc, _permissao, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

async function iniciar(): Promise<void> {
  await app.whenReady();
  marcas.marcar("app:pronto");
  configurarPermissoes();
  registrarScheme();
  registrarIpc();
  let onda2: ReturnType<ContextoTerminais["servicosOnda2"]> | null = null;
  const daOnda2 = (nome: string) => async (): Promise<void> => {
    onda2 ??= terminais?.servicosOnda2() ?? {};
    await onda2[nome]?.();
  };
  await executarBoot({
    abrir: async () => {
      abrirJanela();
      try {
        await prepararBase();
      } catch (erro) {
        console.error(`[${PRODUTO.id}] banco indisponível:`, erro instanceof Error ? erro.message : String(erro));
      }
      try {
        await prepararTerminais();
      } catch (erro) {
        console.error(`[${PRODUTO.id}] terminais indisponíveis:`, erro instanceof Error ? erro.message : String(erro));
      }
      try {
        await prepararDominio();
      } catch (erro) {
        console.error(`[${PRODUTO.id}] domínio indisponível:`, erro instanceof Error ? erro.message : String(erro));
      }
    },
    servicos: {
      // onda 2 (nunca na onda 1, P-01): daemon de PTY, atividade, PATH do shell de login e detecção de CLIs,
      // cada um com erro isolado. Banco, watchers e indexação entram aqui nas fases seguintes.
      daemon: daOnda2("daemon"),
      atividade: daOnda2("atividade"),
      path_login: daOnda2("path_login"),
      deteccao: daOnda2("deteccao"),
      // religa os Panes das Missões e começa a observar o workspace atual (método)
      dominio: async () => {
        await dominio?.iniciar();
      },
      // servidor MCP (worker thread) + wake/hooks dos Panes orquestrados: só aqui, nunca na onda 1
      orquestracao: () => iniciarOrquestracao(),
      // menu nativo e bandeja (módulos puros já testados): só na onda 2
      menu_bandeja: () => instalarMenuEBandeja(),
    },
    aoFalhar: (nome, erro) => console.error(`[${PRODUTO.id}] serviço ${nome} falhou:`, erro instanceof Error ? erro.message : String(erro)),
    marcar: (nome) => marcas.marcar(nome),
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    tratarSegundaInstancia({ janela, reabrirJanela: abrirJanela });
  });
  app.on("activate", () => {
    if (janela === null) abrirJanela();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  void iniciar().catch((erro: unknown) => {
    console.error(`[${PRODUTO.id}] falha ao iniciar:`, erro instanceof Error ? erro.message : String(erro));
    app.exit(1);
  });
}

export { barramento };
