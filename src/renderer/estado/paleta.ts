// Registro de comandos da paleta (⌘K / Ctrl+Shift+P). Puro: recebe o contexto (workspace, recentes,
// trabalhos do método, tema) e devolve a lista de comandos; quem executa são as `acoes` injetadas.
// Comando só aparece quando faz sentido: sem workspace não há "Nova Missão" nem "Novo terminal".
import { GRUPOS, TELAS, type TelaId } from "../casca/telas";
import { pedirAcao, pedirConfiguracoes, pedirTela } from "./navegacao";
import { pedirSquads } from "./squads-acoes";
import { pedirVcs } from "./vcs-acoes";
import { pedirHarness } from "./harness-acoes";
import { pedirOpenRouter } from "./openrouter-acoes";
import { pedirLojaMcp } from "./loja-mcp-acoes";
import { pedirCatalogo } from "./catalogo-acoes";
import { pedirMemoria } from "./memoria-acoes";
import { pedirChat, pedirConhecimento } from "./conhecimento-acoes";
import { pedirAgil } from "./agil-acoes";
import { pedirCusto } from "./custo-acoes";
import { pedirRelatorios } from "./relatorios-acoes";
import { pedirBench } from "./bench-acoes";
import { pedirMapa } from "./mapa-acoes";
import { pedirCaptura } from "./captura-acoes";
import { pedirMaestro } from "./maestro-acoes";
import { pedirAlertas, pedirPanicoTelegram } from "./alertas-acoes";
import { pedirJarvis } from "./jarvis-acoes";
import { storeExecutar } from "./executar";
import { storePublicar } from "./vcs-publicar";
import { storeSuite } from "./suite";
import { storePainelWorkspaces } from "./painel-workspaces";
import { storeAdicionarWorkspace } from "./adicionar-workspace";
import { pedirExecutar } from "./executar-acoes";
import { storeAlertas } from "./alertas";
import { silenciarAte } from "./alertas-formato";
import { ade } from "../ade";
import { storeLimites } from "./limites";
import { abrirPopoverLimites } from "./popover-limites";
import { alternarMedidorSistema } from "./sistema-acoes";

export type GrupoComando = "Navegar" | "Ações" | "Tema" | "Método" | "Workspaces" | "Versionamento" | "Consumo e harness" | "Squads" | "Memória" | "Conhecimento" | "Loja de MCPs" | "Catálogo" | "Maestro" | "Gestão ágil" | "Relatórios" | "Mapa" | "Alertas" | "Jarvis" | "Custo" | "Bench" | "Voz e captura" | "Executar";

export interface Comando {
  id: string;
  titulo: string;
  grupo: GrupoComando;
  detalhe?: string;
  atalho?: string;
  /** texto extra só para a busca (sinônimos). */
  busca?: string;
  executar: () => void;
}

export interface AcoesPaleta {
  navegar(tela: TelaId): void;
  abrirProjeto(): void;
  novaMissao(): void;
  novoTerminal(): void;
  alternarTema(): void;
  irParaWorkspace(id: string): void;
  abrirTrabalho(id: string): void;
}

export interface ContextoPaleta {
  mac: boolean;
  workspaceAtual: { id: string; nome: string } | null;
  recentes: ReadonlyArray<{ id: string; nome: string; raiz?: string }>;
  trabalhos: ReadonlyArray<{ id: string; titulo: string; tipo: string; estagio: string }>;
  temaEfetivo: "claro" | "escuro";
  acoes: AcoesPaleta;
  /** Resumo do repositório do workspace atual (T-06.36); null/ausente = sem repositório: os comandos de versionamento não aparecem. */
  vcs?: { tipo: "git" | "svn" | "git-svn" | "nenhum"; sujo: boolean; staged: number; ahead: number; behind: number; operacao: boolean } | null;
}

/** Teto de itens de "trabalho" e "workspace" no registro (a busca é local, mas a lista é curta e barata). */
const MAX_TRABALHOS = 2000;
const MAX_RECENTES = 30;

export function montarComandos(c: ContextoPaleta): Comando[] {
  const { acoes } = c;
  const tecla = (mac: string, outro: string) => (c.mac ? mac : outro);
  const lista: Comando[] = [];
  for (const t of TELAS) {
    lista.push({ id: `ir:${t.id}`, titulo: `Ir para ${t.rotulo}`, grupo: "Navegar", detalhe: GRUPOS.find((g) => g.id === t.grupo)!.rotulo, executar: () => acoes.navegar(t.id) });
  }
  lista.push({ id: "abrir-projeto", titulo: "Abrir pasta…", grupo: "Ações", detalhe: "Diálogo nativo, direto", atalho: tecla("⌘O", "Ctrl+Alt+O"), busca: "abrir projeto workspace pasta", executar: acoes.abrirProjeto });
  // modal "Adicionar workspace" (D-600…): já na seção certa; lazy, o modal só carrega ao executar
  lista.push({ id: "adicionar-workspace", titulo: "Adicionar workspace…", grupo: "Workspaces", detalhe: "pasta, clonar repositório ou novo projeto", atalho: tecla("⌘⇧O", "Ctrl+Shift+O"), busca: "adicionar workspace projeto pasta clonar novo criar", executar: () => storeAdicionarWorkspace.abrir("pasta") });
  lista.push({ id: "adicionar-workspace:clonar", titulo: "Clonar repositório…", grupo: "Workspaces", detalhe: "GitHub, GitLab, Bitbucket, Azure DevOps", busca: "clonar clone git github gitlab repositorio baixar url", executar: () => storeAdicionarWorkspace.abrir("clonar") });
  lista.push({ id: "adicionar-workspace:novo", titulo: "Novo projeto…", grupo: "Workspaces", detalhe: "criar uma pasta de projeto", busca: "novo projeto criar pasta template init git", executar: () => storeAdicionarWorkspace.abrir("novo") });
  lista.push({ id: "painel-workspaces:fixar", titulo: "Fixar/desafixar painel de workspaces", grupo: "Workspaces", detalhe: "coluna com todos os projetos e seus agentes", atalho: tecla("⌘⌥W", "Ctrl+Alt+W"), busca: "painel workspaces projetos agentes coluna lateral fixar desafixar barra sidebar alfinete", executar: () => storePainelWorkspaces.alternarFixado() });
  if (c.workspaceAtual !== null) {
    lista.push({ id: "nova-missao", titulo: "Nova Missão", grupo: "Ações", detalhe: c.workspaceAtual.nome, executar: acoes.novaMissao });
    lista.push({ id: "novo-terminal", titulo: "Novo terminal", grupo: "Ações", atalho: tecla("⌘N", "Ctrl+Shift+N"), busca: "aba sessao", executar: acoes.novoTerminal });
  }
  if (c.workspaceAtual !== null) {
    // Executar projeto (D-430…): ▶/■ do cabeçalho. F5 exige fn no macOS: ⌘R/⌘./⌘⇧R são os equivalentes.
    const d = c.workspaceAtual.nome;
    lista.push({ id: "executar:executar", titulo: "Executar projeto", grupo: "Executar", detalhe: d, atalho: tecla("F5 · ⌘R", "F5"), busca: "executar rodar run play iniciar dev build subir app projeto f5", executar: () => void storeExecutar.executar() });
    lista.push({ id: "executar:parar", titulo: "Parar execução", grupo: "Executar", detalhe: d, atalho: tecla("⇧F5 · ⌘.", "Shift+F5"), busca: "parar stop encerrar matar execucao rodando", executar: () => void storeExecutar.parar() });
    lista.push({ id: "executar:reiniciar", titulo: "Reiniciar execução", grupo: "Executar", detalhe: d, atalho: tecla("⌘⇧F5 · ⌘⇧R", "Ctrl+Shift+F5"), busca: "reiniciar restart recarregar execucao", executar: () => void storeExecutar.reiniciar() });
    lista.push({ id: "executar:escolher", titulo: "Executar configuração…", grupo: "Executar", detalhe: "escolher dev, build, testes…", busca: "executar configuracao dev build testes start preview escolher menu", executar: () => pedirExecutar("escolher") });
    lista.push({ id: "executar:editar", titulo: "Editar configurações de execução…", grupo: "Executar", detalhe: d, busca: "configurar editar execucao comando ambiente porta confianca padrao", executar: () => storeExecutar.abrirEditor("editar") });
    // Commit e push / Enviar PR (D-630…): só quando os botões do cabeçalho estão visíveis (tela Terminais, repositório com origin no GitHub) e habilitados
    const pub = storePublicar.obter().botoes;
    if (pub?.commit.visivel === true && pub.commit.habilitado) lista.push({ id: "publicar:commit-push", titulo: `${pub.commit.rotulo}…`, grupo: "Versionamento", detalhe: pub.commit.tooltip, atalho: tecla("⌘⇧U", "Ctrl+Shift+U"), busca: "commit push github enviar subir git publicar commitar", executar: () => void storePublicar.abrir("commit_push") });
    if (pub?.pr.visivel === true && pub.pr.habilitado) lista.push({ id: "publicar:pr", titulo: "Enviar PR…", grupo: "Versionamento", detalhe: pub.pr.tooltip, atalho: tecla("⌘⇧Y", "Ctrl+Shift+Y"), busca: "pr pull request github enviar abrir revisao publicar", executar: () => void storePublicar.abrir("pr") });
    if (pub?.atualizar.visivel === true && pub.atualizar.habilitado) lista.push({ id: "publicar:atualizar", titulo: "Atualizar (pull)", grupo: "Versionamento", detalhe: pub.atualizar.tooltip, busca: "atualizar pull puxar trazer baixar git github sincronizar", executar: () => void storePublicar.abrirAtualizar() });
    if (pub?.commit.visivel === true && !pub.commit.habilitado && pub.commit.abreMesmoDesabilitado === true) lista.push({ id: "publicar:suite", titulo: "Pastas da suíte: ignorar ou incluir…", grupo: "Versionamento", detalhe: pub.commit.tooltip, busca: "suite expxdev ignorar exclude pastas nao rastreadas commit", executar: () => void storePublicar.abrir("commit_push") });
    // Suíte ExpxDev (D-470…): só aparece quando falta instalar/reparar neste workspace (estado já conhecido; a paleta não consulta o main)
    const suite = storeSuite.obter().estados[c.workspaceAtual.id];
    if (suite !== undefined && (suite.estado === "ausente" || suite.estado === "incompleta" || suite.estado === "desatualizada")) {
      const rotulo = suite.estado === "incompleta" ? "Reparar suíte ExpxDev" : suite.estado === "desatualizada" ? "Atualizar suíte ExpxDev" : "Instalar suíte ExpxDev";
      lista.push({ id: "suite:instalar", titulo: rotulo, grupo: "Método", detalhe: c.workspaceAtual.nome, busca: "suite expxdev instalar reparar atualizar skills metodo expx sprintx runx npm", executar: () => storeSuite.abrirModal() });
    }
  }
  lista.push({ id: "squads:nova", titulo: "Squads: nova squad", grupo: "Squads", busca: "criar squad agentes equipe", executar: () => pedirSquads("nova-squad") });
  lista.push({ id: "squads:importar", titulo: "Squads: importar squad…", grupo: "Squads", busca: "importar squad json arquivo", executar: () => pedirSquads("importar") });
  if (c.workspaceAtual !== null) {
    lista.push({ id: "squads:nova-missao", titulo: "Nova Missão com squad…", grupo: "Squads", detalhe: c.workspaceAtual.nome, busca: "missao squad agentes orquestrador prompt", executar: () => pedirSquads("nova-missao-squad") });
    lista.push({ id: "squads:abrir-agente", titulo: "Abrir agente…", grupo: "Squads", detalhe: "terminal avulso com um membro de squad", busca: "agente livre conversar membro squad", executar: () => pedirSquads("abrir-agente") });
  }
  const v = c.vcs;
  if (c.workspaceAtual !== null && v != null && v.tipo !== "nenhum") {
    const git = v.tipo !== "svn";
    const d = c.workspaceAtual.nome;
    lista.push({ id: "vcs:commit", titulo: "Versionamento: comitar", grupo: "Versionamento", detalhe: git ? `${v.staged} no stage` : "enviar ao servidor", busca: "commit comitar salvar", executar: () => pedirVcs("commit") });
    if (git) {
      lista.push({ id: "vcs:branches", titulo: "Versionamento: trocar de branch", grupo: "Versionamento", detalhe: d, busca: "checkout branch ramo", executar: () => pedirVcs("branches") });
      lista.push({ id: "vcs:fetch", titulo: "Versionamento: fetch", grupo: "Versionamento", detalhe: "busca do remoto sem alterar a árvore", busca: "buscar atualizar remoto", executar: () => pedirVcs("fetch") });
      lista.push({ id: "vcs:pull", titulo: "Versionamento: pull", grupo: "Versionamento", ...(v.behind > 0 ? { detalhe: `${v.behind} para receber` } : {}), busca: "receber baixar", executar: () => pedirVcs("pull") });
      if (v.ahead > 0) lista.push({ id: "vcs:push", titulo: "Versionamento: push", grupo: "Versionamento", detalhe: `${v.ahead} para enviar`, busca: "enviar publicar", executar: () => pedirVcs("push") });
      lista.push({ id: "vcs:prs", titulo: "Versionamento: abrir PR", grupo: "Versionamento", busca: "pull request pr merge request", executar: () => pedirVcs("abrir-prs") });
      if (v.sujo) lista.push({ id: "vcs:stash", titulo: "Versionamento: guardar em stash", grupo: "Versionamento", busca: "stash guardar", executar: () => pedirVcs("stash") });
    }
  }
  lista.push({ id: "limites:ver", titulo: "Consumo: ver cotas por conta", grupo: "Consumo e harness", busca: "limites cota consumo contas rodape", executar: abrirPopoverLimites });
  lista.push({ id: "limites:atualizar", titulo: "Consumo: atualizar limites", grupo: "Consumo e harness", busca: "limites cota consumo atualizar ler", executar: () => void storeLimites.atualizar() });
  lista.push({ id: "harness:politica", titulo: "Harness: política de roteamento", grupo: "Consumo e harness", busca: "roteamento modelo conta tipo de tarefa", executar: () => pedirHarness("politica") });
  lista.push({ id: "harness:equivalencia", titulo: "Harness: equivalência de modelos", grupo: "Consumo e harness", busca: "faixa modelo equivalente provedor", executar: () => pedirHarness("equivalencia") });
  lista.push({ id: "harness:contas", titulo: "Harness: contas, limites e modo de troca", grupo: "Consumo e harness", busca: "troca automatica sugerir manual limiar reserva", executar: () => pedirHarness("contas") });
  lista.push({ id: "harness:decisoes", titulo: "Harness: decisões e decisor externo", grupo: "Consumo e harness", busca: "decisor consentimento jev openrouter", executar: () => pedirHarness("decisoes") });
  lista.push({ id: "harness:cofre", titulo: "Harness: cofre de segredos", grupo: "Consumo e harness", busca: "segredo chave senha", executar: () => pedirHarness("cofre") });
  lista.push({ id: "openrouter:abrir", titulo: "OpenRouter: ativar e configurar", grupo: "Consumo e harness", busca: "openrouter consentimento rede provedor modelos catalogo", executar: () => pedirOpenRouter("secao") });
  lista.push({ id: "openrouter:chave", titulo: "OpenRouter: adicionar ou testar chave", grupo: "Consumo e harness", busca: "openrouter chave api key cofre testar saldo", executar: () => pedirOpenRouter("chave") });
  lista.push({ id: "loja-mcp:abrir", titulo: "Loja de MCPs: abrir", grupo: "Loja de MCPs", busca: "mcp servidores catalogo instalar loja ferramentas", executar: () => pedirLojaMcp("abrir") });
  lista.push({ id: "loja-mcp:kit", titulo: "Loja de MCPs: instalar o Kit de desenvolvimento", grupo: "Loja de MCPs", detalhe: "git, filesystem, fetch e servidores padrão", busca: "mcp kit git filesystem fetch context7 deepwiki padrao um clique", executar: () => pedirLojaMcp("kit") });
  lista.push({ id: "catalogo:abrir", titulo: "Catálogo: abrir", grupo: "Catálogo", busca: "catalogo skills agentes comandos hooks regras plugins mcp clis instalar symlink", executar: () => pedirCatalogo("abrir") });
  lista.push({ id: "catalogo:atualizar", titulo: "Catálogo: atualizar", grupo: "Catálogo", detalhe: "varre as CLIs de novo", busca: "catalogo varrer atualizar skills scan", executar: () => pedirCatalogo("atualizar") });
  lista.push({ id: "catalogo:politica", titulo: "Catálogo: política de skills por Pane", grupo: "Catálogo", busca: "catalogo politica skills permitidas allow deny papel agente missao isolamento", executar: () => pedirCatalogo("politica") });
  lista.push({ id: "gateway:abrir", titulo: "Gateway MCP: abrir", grupo: "Loja de MCPs", detalhe: "endpoint único, filtro por papel e auditoria", busca: "gateway mcp agregador proxy filtro ferramentas papel auditoria limite", executar: () => pedirLojaMcp("gateway") });
  lista.push({ id: "openrouter:modelos", titulo: "OpenRouter: modelos e preços", grupo: "Consumo e harness", busca: "openrouter modelos preco habilitar faixa ordem", executar: () => pedirOpenRouter("modelos") });
  if (c.workspaceAtual !== null) {
    lista.push({ id: "maestro:pedir", titulo: "Pedir ao Maestro…", grupo: "Maestro", detalhe: c.workspaceAtual.nome, atalho: tecla("⌘⇧E", "Ctrl+Shift+E"), busca: "maestro pedir intencao bug feature pipeline corrigir implementar plano orquestrar", executar: () => pedirMaestro() });
  }
  lista.push({ id: "maestro:pipelines", titulo: "Maestro: acompanhar pipelines", grupo: "Maestro", busca: "maestro pipelines andamento etapas terminais plano", executar: () => pedirTela("pipelines") });
  lista.push({ id: "maestro:rigidez", titulo: "Maestro: rigidez, etapas e perfis", grupo: "Maestro", busca: "maestro rigidez nivel leve rigoroso total etapas perfis economico equilibrado maxima qualidade", executar: () => pedirTela("pipelines") });
  // Fase 10: custo e board (telas lazy; o pedido espera a tela montar)
  lista.push({ id: "custo:board", titulo: "Custo: abrir o board de cards", grupo: "Custo", busca: "board kanban cards tasks colunas wip custo por card delegar", executar: () => pedirCusto("board") });
  lista.push({ id: "custo:detalhe", titulo: "Custo: uso por modelo, Missão e Pane", grupo: "Custo", busca: "custo consumo uso tokens modelo missao pane workspace sprint previsao teto relatorio", executar: () => pedirCusto("detalhe") });
  lista.push({ id: "custo:fontes", titulo: "Custo: fontes de uso e preços", grupo: "Custo", busca: "precos tabela reprecificar reindexar fontes cambio teto diagnostico", executar: () => pedirCusto("fontes") });
  lista.push({ id: "agil:abrir", titulo: "Gestão ágil: abrir", grupo: "Gestão ágil", atalho: tecla("⌘⇧A", "Ctrl+Shift+A"), busca: "agil scrum backlog sprint story points kanban lean xp dashboards", executar: () => pedirAgil("abrir") });
  lista.push({ id: "agil:painel", titulo: "Gestão ágil: dashboards", grupo: "Gestão ágil", busca: "burndown burnup velocidade cfd cycle lead throughput wip graficos metricas", executar: () => pedirAgil("painel") });
  lista.push({ id: "agil:backlog", titulo: "Gestão ágil: backlog", grupo: "Gestão ágil", busca: "backlog itens story points estimar priorizar", executar: () => pedirAgil("backlog") });
  lista.push({ id: "agil:sprint", titulo: "Gestão ágil: planejar sprint", grupo: "Gestão ágil", busca: "sprint planejamento capacidade compromisso fechar review", executar: () => pedirAgil("sprint") });
  lista.push({ id: "agil:daily", titulo: "Gestão ágil: gerar daily", grupo: "Gestão ágil", atalho: tecla("⌘⌥D", "Ctrl+Alt+D"), busca: "daily standup ontem hoje bloqueios", executar: () => pedirAgil("daily") });
  lista.push({ id: "agil:retro", titulo: "Gestão ágil: retrospectiva", grupo: "Gestão ágil", atalho: tecla("⌘⌥R", "Ctrl+Alt+R"), busca: "retro retrospectiva acoes melhoria", executar: () => pedirAgil("retro") });
  lista.push({ id: "agil:qualidade", titulo: "Gestão ágil: retrabalho e qualidade", grupo: "Gestão ágil", busca: "retrabalho first time right xp lean checklist qualidade", executar: () => pedirAgil("qualidade") });
  lista.push({ id: "agil:sincronizar", titulo: "Gestão ágil: sincronizar com o método", grupo: "Gestão ágil", busca: "sincronizar atualizar tasks rastro", executar: () => pedirAgil("sincronizar") });
  lista.push({ id: "relatorios:abrir", titulo: "Relatórios: abrir", grupo: "Relatórios", busca: "relatorios documentacao entrega pacote sprint tecnico usuario html markdown csv divulgacao", executar: () => pedirRelatorios("abrir") });
  lista.push({ id: "relatorios:gerar", titulo: "Relatórios: gerar pacote da sprint", grupo: "Relatórios", busca: "gerar relatorio pacote sprint fechada entrega notas de versao", executar: () => pedirRelatorios("gerar") });
  lista.push({ id: "relatorios:revisao", titulo: "Relatórios: revisar o texto do cliente", grupo: "Relatórios", busca: "revisar texto cliente usuario aprovar rascunho jargao", executar: () => pedirRelatorios("revisao") });
  lista.push({ id: "relatorios:divulgacao", titulo: "Relatórios: divulgação e canais", grupo: "Relatórios", busca: "divulgacao novidades redes email telegram release copiar enviar consentimento", executar: () => pedirRelatorios("divulgacao") });
  lista.push({ id: "relatorios:config", titulo: "Relatórios: configurações", grupo: "Relatórios", busca: "relatorios configurar gerar ao fechar redacao ia consentimento csv hashtags", executar: () => pedirRelatorios("config") });
  // Fase 12: Bench (tela lazy). NENHUM comando inicia Run: rodar exige o diálogo de consentimento digitado dentro da tela.
  lista.push({ id: "bench:abrir", titulo: "Bench: abrir", grupo: "Bench", atalho: tecla("⌘⇧B", "Ctrl+Shift+B"), busca: "bench benchmark comparar modelos clis esforco custo tempo qualidade tarefas bateria", executar: () => pedirBench("abrir") });
  lista.push({ id: "bench:comparar", titulo: "Bench: comparar alvos", grupo: "Bench", busca: "bench comparar placar veredito score alvos modelos", executar: () => pedirBench("comparar") });
  lista.push({ id: "bench:alvos", titulo: "Bench: configurar alvos", grupo: "Bench", busca: "bench alvos cli modelo esforco conta dedicada", executar: () => pedirBench("alvos") });
  lista.push({ id: "bench:precos", titulo: "Bench: preços", grupo: "Bench", busca: "bench precos custo mtok tokens tabela", executar: () => pedirBench("precos") });
  lista.push({ id: "bench:sugestao", titulo: "Bench: sugestão para o harness", grupo: "Bench", detalhe: "só sugere; você aplica com confirmação", busca: "bench sugestao harness politica recomendar melhor modelo por atividade", executar: () => pedirBench("sugestao") });
  // Fase 11: captura de tela e voz (tudo local; permissão do SO só depois de um diálogo do app; o fluxo é lazy)
  lista.push({ id: "captura:regiao", titulo: "Capturar região da tela", grupo: "Voz e captura", atalho: tecla("⌘⇧5", "Ctrl+Shift+5"), busca: "captura screenshot print tela regiao recorte imagem mostrar bug anexar", executar: () => pedirCaptura("regiao-tela") });
  lista.push({ id: "captura:regiao-janela", titulo: "Capturar região da janela do app", grupo: "Voz e captura", busca: "captura janela app regiao recorte sem permissao", executar: () => pedirCaptura("regiao-janela") });
  lista.push({ id: "captura:janela", titulo: "Capturar a janela do app inteira", grupo: "Voz e captura", busca: "captura janela app inteira screenshot sem permissao", executar: () => pedirCaptura("janela") });
  lista.push({ id: "captura:quadros", titulo: "Gravar quadros da tela", grupo: "Voz e captura", atalho: tecla("⌘⇧6", "Ctrl+Shift+6"), detalhe: "sequência de imagens, sem vídeo", busca: "gravar quadros frames sequencia tela fps bug video", executar: () => pedirCaptura("quadros-tela") });
  lista.push({ id: "captura:quadros-janela", titulo: "Gravar quadros da janela do app", grupo: "Voz e captura", busca: "gravar quadros frames janela app fps", executar: () => pedirCaptura("quadros-janela") });
  lista.push({ id: "captura:quadros-parar", titulo: "Parar a gravação de quadros", grupo: "Voz e captura", busca: "parar quadros frames gravacao", executar: () => pedirCaptura("quadros-parar") });
  lista.push({ id: "captura:galeria", titulo: "Capturas: abrir a galeria", grupo: "Voz e captura", detalhe: "anexar ao terminal, anotar, copiar caminho", busca: "capturas galeria imagens anotar anexar pane copiar caminho remover", executar: () => pedirCaptura("galeria") });
  lista.push({ id: "voz:configurar", titulo: "Voz: configurar o ditado", grupo: "Voz e captura", detalhe: "motor, microfone, atalho e dicionário", busca: "voz ditado microfone falar stt transcricao motor atalho permissao dicionario", executar: () => pedirConfiguracoes("voz") });
  // Fase 17: mapa lógico do código (tela lazy; o pedido espera a tela montar; nenhum comando analisa sem a ação do usuário na tela)
  lista.push({ id: "mapa:abrir", titulo: "Mapa: abrir o mapa do código", grupo: "Mapa", busca: "mapa codigo grafo dependencias arquitetura legado", executar: () => pedirMapa("abrir") });
  lista.push({ id: "mapa:analisar", titulo: "Mapa: analisar este projeto", grupo: "Mapa", detalhe: "roda em segundo plano", busca: "mapa analisar escanear indexar codigo legado stackx legadox", executar: () => pedirMapa("analisar") });
  lista.push({ id: "mapa:atualizar", titulo: "Mapa: atualizar (só o que mudou)", grupo: "Mapa", busca: "mapa atualizar incremental reanalisar mudou", executar: () => pedirMapa("atualizar") });
  lista.push({ id: "mapa:buscar", titulo: "Mapa: buscar símbolo", grupo: "Mapa", busca: "mapa buscar simbolo funcao classe arquivo procurar", executar: () => pedirMapa("buscar") });
  lista.push({ id: "mapa:hotspots", titulo: "Mapa: hotspots (churn x complexidade)", grupo: "Mapa", busca: "mapa hotspots churn complexidade risco arquivos quentes", executar: () => pedirMapa("hotspots") });
  lista.push({ id: "mapa:ciclos", titulo: "Mapa: ciclos e dívida candidata", grupo: "Mapa", busca: "mapa ciclos dependencia circular divida codigo morto candidato duplicacao", executar: () => pedirMapa("ciclos") });
  lista.push({ id: "mapa:perfil", titulo: "Mapa: perfil provisório do projeto", grupo: "Mapa", busca: "mapa perfil provisorio stack entradas zonas risco legadox", executar: () => pedirMapa("perfil") });
  lista.push({ id: "jarvis:abrir", titulo: "Jarvis: abrir o assistente de comando", grupo: "Jarvis", busca: "jarvis assistente comando conversa pedir maestro status", executar: () => pedirJarvis("conversa") });
  lista.push({ id: "jarvis:remoto", titulo: "Controle remoto: dispositivos e pareamento", grupo: "Jarvis", detalhe: "desligado por padrão", busca: "remoto controle celular parear dispositivo servidor rede local", executar: () => pedirJarvis("remoto") });
  lista.push({ id: "jarvis:remoto-desligar", titulo: "Controle remoto: desligar agora", grupo: "Jarvis", detalhe: "kill-switch", busca: "remoto desligar kill switch parar servidor celular", executar: () => void ade()?.remoto?.desligar() });
  lista.push({ id: "relay:abrir", titulo: "Relay: abrir (experimental)", grupo: "Jarvis", detalhe: "desligado por padrão", busca: "relay acesso remoto estendido celular experimental ligar", executar: () => pedirJarvis("relay") });
  lista.push({ id: "relay:parear", titulo: "Relay: parear celular", grupo: "Jarvis", busca: "relay parear celular qr código pareamento", executar: () => pedirJarvis("relay") });
  lista.push({ id: "relay:panico", titulo: "Relay: pânico (fechar tudo)", grupo: "Jarvis", detalhe: "revoga todos", busca: "relay pânico panico fechar tudo revogar kill switch", executar: () => void ade()?.relay?.panico() });
  lista.push({ id: "jarvis:auditoria", titulo: "Jarvis: auditoria de ações", grupo: "Jarvis", busca: "jarvis auditoria historico remoto log", executar: () => pedirJarvis("auditoria") });
  lista.push({ id: "sistema:medidor", titulo: "Mostrar/ocultar medidor de CPU e memória", grupo: "Ações", atalho: tecla("⌘⌥U", "Ctrl+Alt+U"), busca: "cpu memoria ram processador medidor maquina desempenho uso sistema", executar: alternarMedidorSistema });
  lista.push({ id: "alertas:abrir", titulo: "Abrir Centro de Alertas", grupo: "Alertas", busca: "alertas notificacoes avisos central telegram", executar: () => pedirAlertas("alertas") });
  lista.push({ id: "alertas:lidos", titulo: "Marcar alertas como lidos", grupo: "Alertas", busca: "alertas lido limpar notificacoes", executar: () => void storeAlertas.marcarTodosLidos() });
  lista.push({ id: "alertas:silenciar", titulo: "Silenciar alertas por 1 h", grupo: "Alertas", busca: "alertas silenciar mudo nao perturbe", executar: () => void ade()?.alertas?.silencioLer().then((s) => ade()?.alertas?.silencioGravar({ ...s, temporario_ate: silenciarAte(1, Date.now()) })).catch(() => undefined) });
  lista.push({ id: "alertas:canais", titulo: "Alertas: canais e Telegram", grupo: "Alertas", busca: "telegram bot canais assistente parear token", executar: () => pedirAlertas("canais") });
  lista.push({ id: "alertas:panico", titulo: "Telegram: pânico (parar tudo)", grupo: "Alertas", detalhe: "pede confirmação", busca: "telegram panico parar desligar revogar bot", executar: pedirPanicoTelegram });
  lista.push({ id: "memoria:abrir", titulo: "Memória: abrir", grupo: "Memória", busca: "memoria entradas decisoes riscos checkpoint lembrar agentes", executar: () => pedirTela("memoria") });
  lista.push({ id: "memoria:preferencias", titulo: "Memória: preferências do usuário", grupo: "Memória", busca: "memoria preferencias anel usuario regras idioma", executar: () => pedirMemoria("preferencias") });
  lista.push({ id: "memoria:saude", titulo: "Memória: saúde, métricas e teto", grupo: "Memória", busca: "memoria saude metricas tamanho teto retencao fts memox", executar: () => pedirMemoria("saude") });
  lista.push({ id: "memoria:ajustes", titulo: "Memória: ligar, desligar e retenção", grupo: "Memória", busca: "memoria ligar desligar retencao orcamento brief configuracoes", executar: () => pedirTela("config") });
  if (c.workspaceAtual !== null) {
    lista.push({ id: "memoria:restaurar", titulo: "Memória: restaurar painel", grupo: "Memória", detalhe: "reabrir um painel encerrado sabendo onde parou", busca: "memoria restaurar painel pane encerrado brief retomar", executar: () => pedirMemoria("restaurar") });
    lista.push({ id: "memoria:exportar", titulo: "Memória: exportar…", grupo: "Memória", detalhe: c.workspaceAtual.nome, busca: "memoria exportar json salvar", executar: () => pedirMemoria("exportar") });
  }
  lista.push({ id: "conhecimento:chat", titulo: "Abrir chat", grupo: "Conhecimento", atalho: tecla("⌘⇧K", "Ctrl+Shift+K"), busca: "chat conversa orquestrador rag perguntar", executar: () => pedirChat("abrir") });
  lista.push({ id: "conhecimento:grafo", titulo: "Abrir grafo", grupo: "Conhecimento", atalho: tecla("⌘⇧G", "Ctrl+Shift+G"), busca: "grafo conhecimento rag nos arestas mapa aprendizados", executar: () => pedirConhecimento("grafo") });
  if (c.workspaceAtual !== null) {
    lista.push({ id: "conhecimento:perguntar", titulo: "Perguntar ao RAG…", grupo: "Conhecimento", detalhe: c.workspaceAtual.nome, busca: "rag perguntar conhecimento busca pergunta chat", executar: () => pedirChat("perguntar") });
    lista.push({ id: "conhecimento:orquestrar", titulo: "Pedir ao orquestrador…", grupo: "Conhecimento", detalhe: c.workspaceAtual.nome, busca: "orquestrador pedir plano executar missao chat implementar", executar: () => pedirChat("orquestrar") });
    lista.push({ id: "conhecimento:reindexar", titulo: "Reindexar", grupo: "Conhecimento", detalhe: "docs, código, git e transcrições", busca: "reindexar indexar rag conhecimento atualizar indice", executar: () => pedirConhecimento("reindexar") });
    lista.push({ id: "conhecimento:sincronizar", titulo: "Sincronizar RAG", grupo: "Conhecimento", detalhe: "backend online opcional", busca: "sincronizar rag backend espelho remoto supabase qdrant", executar: () => pedirConhecimento("sincronizar") });
  }
  lista.push({
    id: "tema", titulo: c.temaEfetivo === "escuro" ? "Trocar para tema claro" : "Trocar para tema escuro", grupo: "Tema",
    atalho: tecla("⌘⇧L", "Ctrl+Shift+L"), busca: "tema claro escuro aparencia", executar: acoes.alternarTema,
  });
  for (const t of c.trabalhos.slice(0, MAX_TRABALHOS)) {
    lista.push({ id: `trabalho:${t.id}`, titulo: t.titulo, grupo: "Método", detalhe: `${t.id} · ${t.tipo} · ${t.estagio}`, busca: t.id, executar: () => acoes.abrirTrabalho(t.id) });
  }
  for (const w of c.recentes.slice(0, MAX_RECENTES)) {
    if (w.id === c.workspaceAtual?.id) continue;
    lista.push({ id: `ws:${w.id}`, titulo: `Ir para ${w.nome}`, grupo: "Workspaces", detalhe: "workspace recente", busca: w.nome, executar: () => acoes.irParaWorkspace(w.id) });
  }
  return lista;
}

/** Texto pesquisável de um comando (título + detalhe + sinônimos). */
export const textoDeBusca = (c: Comando): string => `${c.titulo} ${c.detalhe ?? ""} ${c.busca ?? ""}`;

/**
 * Ações ligadas à casca por eventos próprios (`estado/navegacao`): navegar pede a tela; "Nova Missão" e
 * "Novo terminal" pedem a ação à tela dona, que a trata (mesmo se ainda estiver carregando).
 */
export function criarAcoesDom(extras: Pick<AcoesPaleta, "abrirProjeto" | "alternarTema" | "irParaWorkspace">): AcoesPaleta {
  return {
    ...extras,
    navegar: (tela) => pedirTela(tela),
    novaMissao() { pedirTela("missoes"); pedirAcao("nova-missao"); },
    novoTerminal() { pedirTela("terminais"); pedirAcao("novo-terminal"); },
    abrirTrabalho() { pedirTela("trabalhos"); },
  };
}
